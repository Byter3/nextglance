import {timingSafeEqual} from 'node:crypto'
import {normalizeServerUrl} from '@nextspace/nextcloud-client'
import {checkCalendarQuery} from '@nextspace/nextcloud-client/dav-query-policy.mjs'
import {accountUrl, checkMetadataWrite} from '../src/transport.mjs'
import {checkNativeWrite, checkFileSearch} from '../src/source-write-policy.mjs'

export const PREVIEW_ORIGIN = 'http://127.0.0.1:5174'
export const MAX_RESPONSE_BYTES = 24 * 1024 * 1024
export const MAX_COMMAND_BYTES = 50 * 1024 * 1024 // Includes JSON escaping of an 8 MiB metadata body.
export const failure = (code, message) => Object.assign(new Error(message), {code})
const METHODS = new Set(['GET', 'HEAD', 'PROPFIND', 'REPORT', 'SEARCH', 'PUT', 'MKCOL', 'POST', 'DELETE'])
const OWNED_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'host', 'connection', 'transfer-encoding', 'content-length', 'expect', 'upgrade', 'trailer', 'te'])
const PUBLIC_HEADERS = new Set(['content-type', 'content-length', 'content-encoding', 'etag', 'last-modified', 'date', 'cache-control', 'expires', 'retry-after', 'dav', 'allow', 'x-notes-api-versions', 'x-notes-chunk-cursor', 'location', 'content-location'])

export function checkedServer(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\u0000-\u0020\u007f]/.test(value)) throw failure('VALIDATION', 'Enter a valid Nextcloud server URL.')
  const server = normalizeServerUrl(value)
  accountUrl({serverUrl: server}, value)
  if (new URL(value).pathname.includes('//')) throw failure('VALIDATION', 'Enter the final Nextcloud installation URL.')
  return server
}

export function checkedIdentity(value, login = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value) || login && value.includes(':')) throw failure('FORMAT', 'Nextcloud did not return a valid account identity.')
  return value
}

export function checkedFlowUrl(server, value) {
  if (typeof value !== 'string' || !value || value.length > 16384 || /[\\\u0000-\u0020\u007f]/.test(value)) throw failure('SECURITY', 'Nextcloud returned an unsafe sign-in URL.')
  const url = new URL(value, `${server}/`)
  if (url.origin !== new URL(server).origin || url.username || url.password || url.hash) throw failure('SECURITY', 'Nextcloud sign-in must stay on the selected server.')
  return url.href
}

export function checkedRequest(account, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.accountName !== account.name) throw failure('CANCELLED', 'The selected Nextcloud account changed. Reconnect and retry.')
  if (typeof input.url !== 'string' || input.url.length > 16384) throw failure('VALIDATION', 'A bounded Nextcloud request URL is required.')
  const url = accountUrl(account, input.url)
  if (new URL(url).pathname.includes('//')) throw failure('SECURITY', 'Unsafe Nextcloud request path.')
  const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET'
  if (!METHODS.has(method)) throw failure('SECURITY', 'This native operation is not available in the preview.')
  const source = input.headers ?? {}
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw failure('VALIDATION', 'Invalid Nextcloud request headers.')
  const headers = Object.create(null)
  let total = 0, count = 0
  for (const [key, value] of Object.entries(source)) {
    const lower = key.toLowerCase()
    if (OWNED_HEADERS.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) throw failure('SECURITY', 'Authentication and transport headers belong to the preview host.')
    if (typeof value !== 'string' || !/^[!#$%&'*+.^_`|~a-zA-Z0-9-]+$/.test(key) || /[\r\n\u0000]/.test(value) || Object.hasOwn(headers, lower)) throw failure('VALIDATION', 'Invalid or ambiguous Nextcloud request headers.')
    total += key.length + value.length
    if (total > 16384 || ++count > 32) throw failure('LIMIT', 'Too many Nextcloud request headers.')
    headers[lower] = value
  }
  const body = input.body
  if (body != null && typeof body !== 'string') throw failure('VALIDATION', 'Unsupported Nextcloud request body.')
  if (['PUT', 'MKCOL', 'POST', 'DELETE'].includes(method)) {
    if (method === 'MKCOL' || new URL(url).pathname.includes('/remote.php/dav/files/')) checkMetadataWrite(account, url, method, headers, body)
    else checkNativeWrite(account, url, method, headers, body)
  }
  else if(method==='SEARCH')checkFileSearch(account,url,body)
  else if (method === 'REPORT') checkCalendarQuery(headers, body)
  else if (body != null && (method !== 'PROPFIND' || Buffer.byteLength(body) > 1024 * 1024)) throw failure('LIMIT', 'Only bounded DAV read bodies are supported.')
  const maxBytes = input.maxBytes ?? MAX_RESPONSE_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_RESPONSE_BYTES) throw failure('LIMIT', 'Invalid Nextcloud response limit.')
  return {url, method, headers, body: body ?? undefined, maxBytes}
}

export function publicResponseHeaders(source) {
  const headers = Object.create(null)
  let total = 0
  for (const [key, value] of source.entries()) {
    total += key.length + value.length
    if (total > 65536) throw failure('LIMIT', 'Nextcloud returned too many response headers.')
    const lower = key.toLowerCase()
    if (PUBLIC_HEADERS.has(lower)) headers[lower] = value
  }
  return headers
}

/** Independent of Vite, so request-origin policy is exercised without a UI build. */
export function checkedLocalRequest(request, token, command, multipart=false) {
  const headers = request.headers
  if (headers.host !== '127.0.0.1:5174' || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress)) throw failure('SECURITY', 'The preview bridge is available only on its local address.')
  if (headers['sec-fetch-site'] !== 'same-origin' || !['cors', 'same-origin'].includes(headers['sec-fetch-mode']) || headers['sec-fetch-dest'] !== 'empty') throw failure('SECURITY', 'The preview bridge requires a same-origin application request.')
  if (headers.origin !== undefined && headers.origin !== PREVIEW_ORIGIN || command && headers.origin !== PREVIEW_ORIGIN) throw failure('SECURITY', 'Cross-origin preview requests are not allowed.')
  if (command) {
    if (!(multipart?/^multipart\/form-data;\s*boundary=[^\r\n]{1,100}$/i:/^application\/json(?:\s*;\s*charset=utf-8)?$/i).test(headers['content-type'] || '')) throw failure('VALIDATION', 'Preview commands require JSON.')
    const provided = headers['x-nextglance-token']
    if (typeof provided !== 'string' || provided.length !== token.length || Buffer.byteLength(provided) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) throw failure('PREVIEW_SESSION_EXPIRED', 'The preview server restarted or this session expired. Reload and sign in again.')
  }
}
