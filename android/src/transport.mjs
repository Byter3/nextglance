import {normalizeServerUrl} from '@nextspace/nextcloud-client'
import {checkCalendarQuery} from '@nextspace/nextcloud-client/dav-query-policy.mjs'
import {checkNativeWrite, checkFileSearch} from './source-write-policy.mjs'

const MAX_BYTES = 24 * 1024 * 1024
const READ_METHODS = new Set(['GET', 'HEAD', 'PROPFIND'])
const GENERATION = 'data-[a-f0-9-]{36}'
const METADATA_FILE = new RegExp(`^(?:manifest\\.json|view-preferences\\.json|${GENERATION}/(?:(?:core|organization|settings|dependencies|identities|legacy-import|legacy-original)\\.json|(?:links|plans|properties|workflow|arrangements)/[a-f0-9]{64}\\.json))$`)
const METADATA_DIRECTORY = new RegExp(`^Workspace(?:/Nextspace(?:/${GENERATION}(?:/(?:links|plans|properties|workflow|arrangements))?)?)?$`)
const fail = (message, code) => Object.assign(new Error(message), {code})

/** Private transport information; never part of account identity or cloud data. */
export const transportCapabilities = value => ({davReadMode: value?.davReadMode === 'report' ? 'report' : 'propfind-get', ...(value?.nativeEdits === 'notes-dates-scheduling' ? {nativeEdits: 'notes-dates-scheduling'} : {})})

export function accountUrl(account, target) {
  let base, url
  try {
    if (typeof target !== 'string' || /[\\\u0000-\u0020\u007f]/.test(target)) throw new Error('Invalid request URL')
    base = new URL(normalizeServerUrl(account.serverUrl)); url = new URL(target)
    // URL parsing removes literal/encoded dot segments. Inspect the original
    // path as well so traversal cannot disappear before the boundary check.
    const rawPath = target.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0]
    for (const part of rawPath.split('/')) {
      const decoded = decodeURIComponent(part)
      if (decoded === '.' || decoded === '..' || /[\\/\u0000-\u001f\u007f]|%[\da-f]{2}/i.test(decoded)) throw new Error('Unsafe request path')
    }
  } catch { throw fail('Requests must stay inside the selected Nextcloud account.', 'SECURITY') }
  const prefix = base.pathname.replace(/\/$/, '')
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
      url.origin !== base.origin || url.username || url.password || url.hash ||
      (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))) {
    throw fail('Requests must stay inside the selected Nextcloud account.', 'SECURITY')
  }
  // Reject encoded separators and traversal before Android's URL handling.
  for (const part of url.pathname.split('/')) {
    let decoded
    try { decoded = decodeURIComponent(part) } catch { throw fail('Unsafe Nextcloud request path.', 'SECURITY') }
    if (decoded === '.' || decoded === '..' || /[\\/\u0000-\u001f\u007f]/.test(decoded)) throw fail('Unsafe Nextcloud request path.', 'SECURITY')
  }
  return url.href
}

/** Only the existing planner folder protocol can write through the mobile bridge. */
export function checkMetadataWrite(account, url, method, headers, body) {
  const target = new URL(url), base = new URL(account.serverUrl)
  const path = target.pathname.split('/').map(decodeURIComponent).join('/')
  const root = `${base.pathname.split('/').map(decodeURIComponent).join('/').replace(/\/$/, '')}/remote.php/dav/files/${account.username}/`
  const relative = path.startsWith(root) ? path.slice(root.length) : ''
  if (target.search || !relative || !['PUT', 'MKCOL'].includes(method)) throw fail('Only NextGlance planner metadata may be written.', 'SECURITY')
  if (method === 'MKCOL') {
    if (!METADATA_DIRECTORY.test(relative) || body != null && body !== '') throw fail('Only planner folders may be created.', 'SECURITY')
    return
  }
  const prefix = 'Workspace/Nextspace/'
  if (!relative.startsWith(prefix) || !METADATA_FILE.test(relative.slice(prefix.length))) throw fail('Only planner protocol documents may be written.', 'SECURITY')
  const match = headers['if-match'], none = headers['if-none-match']
  if (!(none === '*' && match === undefined || none === undefined && typeof match === 'string' && match.length <= 1000 && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(match))) throw fail('Planner writes require an exact version or a create-only condition.', 'SECURITY')
  if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '') || typeof body !== 'string') throw fail('Planner writes require a JSON document.', 'VALIDATION')
  if (new TextEncoder().encode(body).length > 8 * 1024 * 1024) throw fail('Planner document exceeds the mobile size limit.', 'LIMIT')
  let document
  try { document = JSON.parse(body) } catch { throw fail('Invalid planner JSON document.', 'VALIDATION') }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw fail('Invalid planner JSON document.', 'VALIDATION')
}

/** The host attaches credentials; source mutation capability is explicit. */
export function createSsoFetch(native, account, capabilities) {
  const supportsReport = transportCapabilities(capabilities).davReadMode === 'report'
  const supportsEdits = transportCapabilities(capabilities).nativeEdits === 'notes-dates-scheduling'
  return async (target, options = {}) => {
    const priority = options.priority ?? 'high'
    if (!['high', 'low'].includes(priority)) throw fail('Invalid request priority.', 'VALIDATION')
    const maxBytes = Number.isInteger(options.maxResponseBytes) && options.maxResponseBytes > 0 ? Math.min(MAX_BYTES, options.maxResponseBytes) : MAX_BYTES
    const url = accountUrl(account, target)
    const method = String(options.method || 'GET').toUpperCase()
    const headers = Object.fromEntries(new Headers(options.headers).entries())
    if (Object.keys(headers).some(key => ['authorization', 'cookie', 'proxy-authorization', 'host'].includes(key))) throw fail('Credentials belong to the Nextcloud Files app.', 'SECURITY')
    if (options.body != null && typeof options.body !== 'string') throw fail('Unsupported native request body.', 'VALIDATION')
    if (options.body && new TextEncoder().encode(options.body).length > MAX_BYTES) throw fail('Request exceeds the mobile size limit.', 'LIMIT')
    if(method==='SEARCH'&&supportsReport)checkFileSearch(account,url,options.body)
    else if (method === 'REPORT' && supportsReport) checkCalendarQuery(headers, options.body)
    else if (!READ_METHODS.has(method)) {
      const path = new URL(url).pathname
      if (method === 'MKCOL' || path.includes('/remote.php/dav/files/')) checkMetadataWrite(account, url, method, headers, options.body)
      else {
        if (!supportsEdits) throw fail('Native editing is not available through this connection.', 'SECURITY')
        checkNativeWrite(account, url, method, headers, options.body)
      }
    }
    if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError')
    let abort
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(new DOMException('Request cancelled', 'AbortError'))
      options.signal?.addEventListener('abort', abort, {once: true})
    })
    try {
      let result
      try {
        result = await Promise.race([Promise.resolve().then(() => native.request({accountName: account.name, url, method, headers, body: options.body, maxBytes, priority})), cancelled])
      } catch (error) {
        // Feed native revocation into the shared connector's HTTP permission path.
        if (error?.code === 'AUTH') return new Response(null, {status: 401})
        if (error?.code === 'PERMISSION') return new Response(null, {status: 403})
        throw error
      }
      if (!result || typeof result.url !== 'string') throw fail('Invalid native HTTP response.', 'NEXTCLOUD')
      if (accountUrl(account, result.url) !== url) throw fail('Nextcloud redirected the native request.', 'REDIRECT')
      if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599) throw fail('Invalid native HTTP status.', 'NEXTCLOUD')
      if (typeof result.bodyBase64 !== 'string' || result.bodyBase64.length > Math.ceil(maxBytes / 3) * 4) throw fail('Response exceeds the mobile size limit.', 'LIMIT')
      if (result.bodyBase64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.bodyBase64)) throw fail('Invalid native response encoding.', 'NEXTCLOUD')
      const binary = atob(result.bodyBase64)
      if (binary.length > maxBytes) throw fail('Response exceeds the mobile size limit.', 'LIMIT')
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
      return new Response([204, 205, 304].includes(result.status) || method === 'HEAD' ? null : bytes, {status: result.status, headers: result.headers})
    } finally { options.signal?.removeEventListener('abort', abort) }
  }
}
