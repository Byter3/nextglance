import {checkedAccount} from './foundation.mjs'

/** Same-origin development transport. Authorization stays inside the host.
 * @param {{fetchImpl?: typeof fetch, identityStore?: {load: () => Promise<unknown>, save: (account: {name:string,serverUrl:string,username:string}) => Promise<void>, clear: () => Promise<void>}}} [options]
 */
export function createBrowserHost({fetchImpl = globalThis.fetch, identityStore} = {}) {
  let session
  const hostResponse = async (url, options) => {
    try { return await fetchImpl(url, options) }
    catch { throw Object.assign(new Error('The local sign-in service is unavailable. Restart the Android preview server; your saved planner is preserved.'), {code: 'PREVIEW_HOST'}) }
  }
  const hostJson = async response => {
    try { return await response.json() }
    catch { throw Object.assign(new Error('The local sign-in service returned an invalid response. Restart the Android preview server.'), {code: 'PREVIEW_HOST'}) }
  }
  const token = async () => {
    if (!session) session = hostResponse('/__nextglance/session', {credentials: 'same-origin', cache: 'no-store'})
      .then(async response => {
        if (!response.ok) throw Object.assign(new Error('The local sign-in service is unavailable. Restart the Android preview server.'), {code: 'PREVIEW_HOST'})
        const value = await hostJson(response)
        if (typeof value.token !== 'string' || value.token.length < 32) throw Object.assign(new Error('The local sign-in service returned an invalid session.'), {code: 'PREVIEW_HOST'})
        return value.token
      }).catch(error => { session = undefined; throw error })
    return session
  }
  const command = async (method, args = {}) => {
    const response = await hostResponse('/__nextglance/command', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: {'Content-Type': 'application/json', 'X-NextGlance-Token': await token()},
      body: JSON.stringify({method, args}),
    })
    const result = await hostJson(response)
    if (!response.ok) {
      if (result?.error?.code === 'PREVIEW_SESSION_EXPIRED') {
        session = undefined
        throw Object.assign(new Error('The preview server restarted. Sign in with Nextcloud again to reconnect; your saved planner remains on this device.'), {code: 'PREVIEW_SESSION_EXPIRED'})
      }
      const error = new Error(result?.error?.message || 'The local Nextcloud service could not complete this request.')
      error.code = result?.error?.code || 'PREVIEW_HOST'
      throw error
    }
    if (identityStore) {
      if (method === 'disconnect') await identityStore.clear()
      else if (result?.account) {
        const account = checkedAccount(result.account)
        // Validate and pick only the identity fields. Never persist the wire reply.
        await identityStore.save({name:account.name,serverUrl:account.serverUrl,username:account.username})
      } else if (method === 'getAccount') {
        const account = checkedAccount(await identityStore.load())
        if (account) return {...result,account,reconnectRequired:true}
      }
    }
    return result
  }
  return {...Object.fromEntries(['getAccount', 'beginLogin', 'pollLogin', 'cancelLogin', 'disconnect', 'request'].map(method => [method, async args => {
    try { return await command(method, args) }
    catch (error) {
      // An unavailable/restarted development host cannot authorize a remembered
      // identity. It can still restore that identity's own offline planner.
      if (method === 'getAccount' && identityStore && ['PREVIEW_SESSION_EXPIRED', 'PREVIEW_HOST'].includes(error?.code)) {
        const account = checkedAccount(await identityStore.load())
        if (account) return {account, reconnectRequired: true}
      }
      throw error
    }
  }])), getSavedAccount: async () => ({account: identityStore ? checkedAccount(await identityStore.load()) : null})}
}

/** Private source/metadata snapshots only; no authorization is accepted here. */
export {createBrowserCacheFiles} from './browser-cache-files.mjs'
