import {createHash, randomUUID} from 'node:crypto'
import {beginLogin, pollLogin} from '@nextspace/nextcloud-client'
import {checkedServer, checkedIdentity, checkedFlowUrl, checkedRequest, publicResponseHeaders, failure} from './preview-policy.mjs'

const FLOW_LIFETIME = 10 * 60 * 1000
const AUTH_LIMIT = 1024 * 1024

/** All secrets live in this closure. The injected ports make lifecycle/network tests deterministic. */
export function createPreviewHost({fetch: fetcher = globalThis.fetch, now = Date.now, newId = randomUUID, timeoutMs = 25_000} = {}) {
  let active = null, flow = null, generation = 0, barrier = Promise.resolve(), closed = false
  const requests = new Set(), controllers = new Set()
  const accountResult = () => active ? {account: {...active.account}, capabilities: {davReadMode: 'report', nativeEdits: 'notes-dates-scheduling'}} : {account: null}
  const ensureOpen = () => { if (closed) throw failure('UNAVAILABLE', 'The development preview has stopped.') }

  async function read(url, options, maxBytes, signal) {
    const controller = new AbortController()
    controllers.add(controller)
    let reader, timer
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, {once: true})
    if (signal?.aborted) controller.abort()
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure('NETWORK', 'The Nextcloud request timed out. Please try again.')) }, timeoutMs)
    })
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(failure('NETWORK', 'The Nextcloud request was interrupted. Please try again.')), {once: true}))
    try {
      if (controller.signal.aborted) throw failure('NETWORK', 'The Nextcloud request was interrupted. Please try again.')
      return await Promise.race([timeout, aborted, (async () => {
        const headers = new Headers(options.headers)
        headers.set('User-Agent', 'NextGlance/0.6.0 Preview')
        const response = await fetcher(url, {...options, headers: Object.fromEntries(headers), redirect: 'manual', credentials: 'omit', signal: controller.signal})
        if (response.status >= 300 && response.status < 400 && response.status !== 304 || response.redirected || response.url && response.url !== url) throw failure('REDIRECT', 'Nextcloud redirected this request. Enter its final HTTPS server URL.')
        const responseHeaders = publicResponseHeaders(response.headers)
        const sizeHint = Number(response.headers.get('content-length'))
        if (Number.isFinite(sizeHint) && sizeHint > maxBytes) throw failure('LIMIT', 'Nextcloud returned too much data.')
        const chunks = []
        let size = 0
        if (response.body) {
          reader = response.body.getReader()
          for (;;) {
            const {done, value} = await reader.read()
            if (done) break
            if (controller.signal.aborted) throw failure('NETWORK', 'The Nextcloud request was interrupted. Please try again.')
            size += value.byteLength
            if (size > maxBytes) throw failure('LIMIT', 'Nextcloud returned too much data.')
            chunks.push(Buffer.from(value))
          }
        }
        return {status: response.status, headers: responseHeaders, bytes: Buffer.concat(chunks, size)}
      })()])
    } catch (error) {
      if (reader) void reader.cancel().catch(() => {})
      if (['NETWORK', 'LIMIT', 'REDIRECT'].includes(error?.code)) throw error
      throw failure('NETWORK', 'Could not reach Nextcloud. Check the server address, network and certificate.')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      controller.abort()
      controllers.delete(controller)
    }
  }

  const authFetch = signal => async (url, options) => {
    const result = await read(url, options, AUTH_LIMIT, signal)
    return new Response([204, 205, 304].includes(result.status) ? null : result.bytes, {status: result.status, headers: result.headers})
  }
  function invalidate() {
    generation++
    flow?.controller.abort()
    flow = null
  }
  function current(candidate) {
    ensureOpen()
    if (flow !== candidate || candidate.generation !== generation) throw failure('CANCELLED', 'This sign-in was cancelled or replaced.')
    if (now() >= candidate.expiresAt) {
      invalidate()
      throw failure('EXPIRED', 'This sign-in expired. Start again.')
    }
  }
  function setBarrier(change) {
    const earlier = barrier
    const pending = (async () => { await earlier; await Promise.allSettled([...requests]); return change() })()
    barrier = pending.then(() => undefined, () => undefined)
    return pending
  }

  async function discover(credentials, candidate) {
    const serverUrl = checkedServer(credentials.serverUrl)
    if (serverUrl !== candidate.details.serverUrl) throw failure('SECURITY', 'Nextcloud changed the configured installation during sign-in.')
    const username = checkedIdentity(credentials.username, true)
    if (typeof credentials.appPassword !== 'string' || !credentials.appPassword || credentials.appPassword.length > 4096 || /[\u0000-\u001f\u007f]/.test(credentials.appPassword)) throw failure('FORMAT', 'Nextcloud returned invalid sign-in information.')
    const authorization = `Basic ${Buffer.from(`${username}:${credentials.appPassword}`, 'utf8').toString('base64')}`
    const response = await read(`${serverUrl}/ocs/v2.php/cloud/user?format=json`, {method: 'GET', headers: {Authorization: authorization, Accept: 'application/json', 'OCS-APIRequest': 'true'}}, AUTH_LIMIT, candidate.controller.signal)
    if (response.status === 401) throw failure('AUTH', 'Nextcloud rejected this sign-in. Please sign in again.')
    if (response.status === 403) throw failure('PERMISSION', 'Nextcloud denied access to this account.')
    if (response.status < 200 || response.status >= 300) throw failure('NEXTCLOUD', 'Nextcloud could not verify this account. Retry sign-in.')
    let data
    try { data = JSON.parse(response.bytes.toString('utf8')) } catch { throw failure('FORMAT', 'Nextcloud returned an invalid account response.') }
    if (![100, 200].includes(Number(data?.ocs?.meta?.statuscode))) throw failure('FORMAT', 'Nextcloud could not verify the account identity.')
    const canonical = checkedIdentity(data?.ocs?.data?.id)
    const name = active?.account.serverUrl === serverUrl && active.account.username === canonical ? active.account.name : `nextspace-direct:${createHash('sha256').update(`${serverUrl}\0${canonical}`).digest('hex')}`
    return {account: {name, serverUrl, username: canonical}, authorization}
  }

  async function start(input) {
    ensureOpen()
    const serverUrl = checkedServer(input?.serverUrl)
    if (flow?.commit) await flow.commit
    invalidate()
    const candidate = {id: newId(), generation, expiresAt: now() + FLOW_LIFETIME, nextPollAt: now() + 1800, controller: new AbortController(), details: null, credentials: null, polling: null, commit: null}
    flow = candidate
    try {
      await barrier
      current(candidate)
      const details = await beginLogin(serverUrl, {fetch: authFetch(candidate.controller.signal)})
      current(candidate)
      if (!details.token || details.token.length > 16384) throw failure('FORMAT', 'Nextcloud returned an invalid sign-in flow.')
      details.loginUrl = checkedFlowUrl(serverUrl, details.loginUrl)
      details.pollEndpoint = checkedFlowUrl(serverUrl, details.pollEndpoint)
      candidate.details = details
      candidate.nextPollAt = now() + 1800
      return {flowId: candidate.id, loginUrl: details.loginUrl}
    } catch (error) {
      if (error?.code === 'EXPIRED') throw error
      if (flow !== candidate) throw failure('CANCELLED', 'This sign-in was cancelled or replaced.')
      invalidate()
      throw error
    }
  }

  async function poll(input) {
    ensureOpen()
    const candidate = flow
    if (!candidate || typeof input?.flowId !== 'string' || input.flowId.length > 256 || input.flowId !== candidate.id) throw failure('CANCELLED', 'This sign-in was cancelled or replaced.')
    if (candidate.commit) return candidate.commit
    current(candidate)
    if (candidate.polling) return candidate.polling
    if (!candidate.details || now() < candidate.nextPollAt) return {pending: true}
    candidate.nextPollAt = now() + 2000
    candidate.polling = (async () => {
      try {
        const result = candidate.credentials || await pollLogin(candidate.details, {fetch: authFetch(candidate.controller.signal)})
        current(candidate)
        if (result.pending) return {pending: true}
        // Login Flow v2 consumes a successful poll token. Retry discovery using
        // only this host-memory candidate after a transient account read failure.
        candidate.credentials = result
        const next = await discover(result, candidate)
        current(candidate)
        // Once this barrier starts, cancellation returns the committed account.
        candidate.commit = setBarrier(() => {
          ensureOpen()
          active = next
          invalidate()
          return {pending: false, ...accountResult()}
        })
        return await candidate.commit
      } catch (error) {
        if (error?.code === 'EXPIRED') throw error
        if (!candidate.commit && flow !== candidate) throw failure('CANCELLED', 'This sign-in was cancelled or replaced.')
        throw error
      } finally { candidate.polling = null }
    })()
    return candidate.polling
  }

  async function request(input) {
    ensureOpen()
    for (;;) {
      const waitingFor = barrier
      await waitingFor
      if (waitingFor === barrier) break
    }
    ensureOpen()
    if (!active) throw failure('RECONNECT_REQUIRED', 'The preview has no active authorization. Sign in to Nextcloud again.')
    const selected = active
    const checked = checkedRequest(selected.account, input)
    const pending = (async () => {
      const result = await read(checked.url, {method: checked.method, headers: {...checked.headers, Authorization: selected.authorization, 'OCS-APIRequest': 'true'}, body: checked.body}, checked.maxBytes)
      return {status: result.status, url: checked.url, headers: result.headers, bodyBase64: result.bytes.toString('base64')}
    })()
    requests.add(pending)
    try { return await pending } finally { requests.delete(pending) }
  }

  return {
    async uploadAttachment(input){
      await barrier;ensureOpen();const selected=active
      if(!selected||selected.account.name!==input.accountName)throw failure('RECONNECT_REQUIRED','Reconnect the selected account before uploading.')
      const {file}=input
      if(!file||typeof file.arrayBuffer!=='function'||file.size>20*1024*1024||!file.name||file.name.length>255||/[\\/\u0000-\u001f\u007f]/.test(file.name))throw failure('LIMIT','Choose a file up to 20 MiB with a valid name.')
      for(const key of ['boardId','stackId','cardId'])if(!/^[1-9]\d*$/.test(input[key])||!Number.isSafeInteger(Number(input[key])))throw failure('VALIDATION','Choose a valid Deck card.')
      const form=new FormData();form.append('type','file');form.append('data',file.name);form.append('file',file,file.name)
      const pending=(async()=>{const response=await read(`${selected.account.serverUrl}/index.php/apps/deck/api/v1.1/boards/${input.boardId}/stacks/${input.stackId}/cards/${input.cardId}/attachments`,{method:'POST',headers:{Authorization:selected.authorization,'OCS-APIRequest':'true'},body:form},1024*1024);if(response.status<200||response.status>=300)throw failure(response.status===401?'AUTH':response.status===403?'PERMISSION':'NEXTCLOUD','Nextcloud did not accept the attachment.');return {uploaded:true}})()
      requests.add(pending);try{return await pending}finally{requests.delete(pending)}
    },
    async command(method, args = {}) {
      ensureOpen()
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw failure('VALIDATION', 'Invalid preview command arguments.')
      switch (method) {
        case 'getAccount': await barrier; return accountResult()
        case 'beginLogin': return start(args)
        case 'pollLogin': return poll(args)
        case 'cancelLogin': {
          if (args.flowId != null && (typeof args.flowId !== 'string' || args.flowId.length > 256)) throw failure('VALIDATION', 'Invalid sign-in flow.')
          if (!args.flowId || args.flowId === flow?.id) {
            if (flow?.commit) await flow.commit
            else invalidate()
          }
          await barrier
          return {pending: false, ...accountResult()}
        }
        case 'disconnect': {
          if (flow?.commit) await flow.commit
          invalidate()
          return setBarrier(() => { active = null; return accountResult() })
        }
        case 'request': return request(args)
        default: throw failure('UNAVAILABLE', 'This operation is unavailable in the browser preview.')
      }
    },
    close() {
      closed = true
      invalidate()
      active = null
      for (const controller of controllers) controller.abort()
      controllers.clear()
    },
  }
}
