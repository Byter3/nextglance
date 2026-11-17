/** Nextcloud cookie-session transport. No credentials or private data are persisted. */
export const webProblem = (message, code = 'NEXTCLOUD') => Object.assign(new Error(message), {code})
const nativePaths = /^(?:remote\.php\/dav(?:\/|$)|ocs\/v[12]\.php\/(?:cloud\/(?:user|capabilities)(?:\/|$)|apps\/(?:collectives|files_sharing|related_resources)(?:\/|$))|(?:index\.php\/)?apps\/(?:deck|notes|theming)(?:\/|$)|(?:index\.php\/)?settings\/user\/theming$)/
const methods = new Set(['GET','HEAD','POST','PUT','DELETE','PROPFIND','REPORT','MKCOL','PROPPATCH','SEARCH'])
const safeUrl = (value, base) => {
  if (typeof value !== 'string' || /[\\\u0000-\u001f]/.test(value) || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(value) || /%2f|%5c/i.test(value)) throw webProblem('Unsafe Nextcloud request path.', 'SECURITY')
  const url = new URL(value, base)
  if (url.username || url.password || !['http:','https:'].includes(url.protocol)) throw webProblem('Unsafe Nextcloud request URL.', 'SECURITY')
  return url
}

export function createSessionTransport({fetch: fetcher, origin, sessionUrl, requestToken, onExpired = () => {}, online = () => true, timeoutMs = 25000}) {
  const root = new URL(origin).origin, session = safeUrl(sessionUrl, root)
  if (session.origin !== root || !/\/(?:index\.php\/)?apps\/nextglance\/session$/.test(session.pathname)) throw webProblem('Invalid NextGlance session endpoint.', 'SECURITY')
  let identity = null, generation = 0, disposed = false
  const pending = new Set()
  function expire(message) {
    generation++; identity = null
    for (const controller of pending) controller.abort()
    pending.clear(); onExpired(message)
  }
  async function request(url, options = {}, isSession = false) {
    if (disposed) throw webProblem('This page has closed.', 'CANCELLED')
    if (!online()) throw webProblem('You are offline. Reconnect to Nextcloud before continuing.', 'OFFLINE')
    const target = safeUrl(String(url), root), method = String(options.method || 'GET').toUpperCase()
    const headers = new Headers(options.headers)
    if (target.origin !== root || headers.has('Authorization') || !methods.has(method)) throw webProblem('Only this Nextcloud session can be used.', 'SECURITY')
    if (!isSession) {
      if (!identity) throw webProblem('Check your Nextcloud session first.', 'AUTH')
      const prefix = new URL(identity.serverUrl).pathname.replace(/\/$/, '') + '/'
      if (!target.pathname.startsWith(prefix) || !nativePaths.test(target.pathname.slice(prefix.length))) throw webProblem('This request is outside the supported Nextcloud APIs.', 'SECURITY')
    }
    const token = requestToken?.()
    if (typeof token !== 'string' || !token.trim()) { expire('Your Nextcloud session token is unavailable. Reload this page.'); throw webProblem('Nextcloud session token unavailable.', 'AUTH') }
    headers.set('requesttoken', token); headers.set('X-Requested-With', 'XMLHttpRequest')
    const epoch = generation, controller = new AbortController()
    const cancel = () => controller.abort()
    options.signal?.addEventListener('abort', cancel, {once:true})
    if(options.signal?.aborted)controller.abort()
    pending.add(controller)
    const timer = setTimeout(cancel, timeoutMs)
    try {
      const response = await fetcher(target.href, {...options, method, headers, credentials:'same-origin', redirect:'manual', cache:'no-store', signal:controller.signal})
      if (epoch !== generation || disposed) throw webProblem('The Nextcloud session changed.', 'CANCELLED')
      if (response.status === 401 || response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400 && response.status !== 304 || isSession && [403,412].includes(response.status) || /text\/html/i.test(response.headers.get('content-type') || '') && !/settings\/user\/theming$/.test(target.pathname)) {
        expire('Your Nextcloud session expired. Sign in again, then reload this page.')
        throw webProblem('Nextcloud session expired.', 'AUTH')
      }
      // Consume within the bounded request lifetime, then return a standard Response.
      // The portable client still enforces its operation-specific transfer budget.
      const limit = Number.isSafeInteger(options.maxResponseBytes) ? options.maxResponseBytes : 16 * 1024 * 1024
      const chunks = []; let bytes = 0
      if (response.body?.getReader) {
        const reader = response.body.getReader()
        for (;;) {
          const part = await reader.read(); if (part.done) break
          bytes += part.value.byteLength
          if (bytes > limit) { await reader.cancel(); throw webProblem('Nextcloud response exceeded its transfer limit.', 'LIMIT') }
          chunks.push(part.value)
        }
      } else { const value = new Uint8Array(await response.arrayBuffer()); bytes = value.byteLength; chunks.push(value) }
      if (bytes > limit) throw webProblem('Nextcloud response exceeded its transfer limit.', 'LIMIT')
      if (epoch !== generation || disposed) throw webProblem('The Nextcloud session changed.', 'CANCELLED')
      const body = new Uint8Array(bytes); let offset = 0
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
      return new Response([204,205,304].includes(response.status) ? null : body, {status:response.status, statusText:response.statusText, headers:response.headers})
    } catch (error) {
      if (error.name === 'AbortError') throw webProblem(options.signal?.aborted ? 'Request cancelled.' : 'Nextcloud request timed out. Retry when connected.', options.signal?.aborted ? 'CANCELLED' : 'TIMEOUT')
      if(error.code)throw error
      throw webProblem('Nextcloud could not be reached. Check your connection and retry.', 'NETWORK')
    } finally { clearTimeout(timer); pending.delete(controller); options.signal?.removeEventListener('abort', cancel) }
  }
  return {
    fetch: (url, options) => request(url, options),
    async verify() {
      const response = await request(session.href, {headers:{Accept:'application/json'}}, true)
      if (!response.ok) throw webProblem('Nextcloud could not verify this session. Retry.', 'NETWORK')
      const value = await response.json(), server = safeUrl(value.serverUrl, root)
      if (value.appId !== 'nextglance' || typeof value.userId !== 'string' || !value.userId.trim() || server.origin !== root || server.search || server.hash || typeof value.basePath !== 'string' || server.pathname.replace(/\/$/,'') !== value.basePath.replace(/\/$/,'') || safeUrl(value.sessionUrl, root).href !== session.href || !session.pathname.startsWith(value.basePath.replace(/\/$/,'') + '/')) throw webProblem('Nextcloud returned an invalid session identity.', 'FORMAT')
      if (identity && (identity.userId !== value.userId || identity.serverUrl !== value.serverUrl)) {
        expire('The signed-in Nextcloud account changed. Reload this page to open its planner.')
        throw webProblem('Nextcloud account changed.', 'AUTH')
      }
      identity = value
      return {...value}
    },
    expire,
    dispose() { disposed = true; generation++; for (const controller of pending) controller.abort(); pending.clear(); identity = null },
  }
}
