import {randomBytes} from 'node:crypto'
import {createPreviewHost} from './preview-host.mjs'
import {checkedLocalRequest, MAX_COMMAND_BYTES, failure} from './preview-policy.mjs'

const ERROR_STATUS = {SECURITY: 403, PREVIEW_SESSION_EXPIRED: 403, RECONNECT_REQUIRED: 503, AUTH: 401, PERMISSION: 403, VALIDATION: 400, LIMIT: 413, CANCELLED: 409, EXPIRED: 410, UNAVAILABLE: 503, NETWORK: 502, REDIRECT: 502, FORMAT: 502, NEXTCLOUD: 502}

export function createPreviewBridge({host = createPreviewHost(), token = randomBytes(32).toString('hex'), bodyTimeoutMs = 15_000} = {}) {
  let running = 0
  function reply(response, status, data) {
    if (response.destroyed || response.writableEnded) return
    response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"})
    response.end(JSON.stringify(data))
  }
  function readCommand(request, upload=false) {
    return new Promise((resolve, reject) => {
      let size = 0, chunks = [], settled = false
      const cleanup = () => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted) }
      const fail = error => { if (settled) return; settled = true; cleanup(); chunks = []; request.resume(); reject(error) }
      const timer = setTimeout(() => fail(failure('LIMIT', 'The preview command body timed out.')), bodyTimeoutMs)
      const data = chunk => { size += chunk.length; if (size > (upload ? 20*1024*1024+16384 : MAX_COMMAND_BYTES)) fail(failure('LIMIT', 'The preview command is too large.')); else chunks.push(chunk) }
      const error = () => fail(failure('VALIDATION', 'The preview command body was interrupted.'))
      const aborted = error
      const end = () => {
        if (settled) return
        settled = true; cleanup()
        try {
          if(upload){resolve(Buffer.concat(chunks,size));return}
          const value = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
          if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.method !== 'string' || value.method.length > 64 || Object.keys(value).some(key => !['method', 'args'].includes(key))) throw new Error()
          resolve(value)
        } catch { reject(failure('VALIDATION', 'Invalid preview command JSON.')) }
      }
      request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted)
    })
  }
  return {
    async middleware(request, response, next) {
      if (!request.url?.startsWith('/__nextglance/')) return next()
      let admitted = false
      try {
        const session = request.url === '/__nextglance/session' && request.method === 'GET'
        const command = request.url === '/__nextglance/command' && request.method === 'POST'
        const upload=request.url==='/__nextglance/upload'&&request.method==='POST'
        checkedLocalRequest(request, token, command||upload,upload)
        if (!session && !command && !upload) throw failure('UNAVAILABLE', 'Unknown preview endpoint or method.')
        if (session) return reply(response, 200, {token})
        if (running >= 12) throw failure('LIMIT', 'Too many preview operations are running. Please retry.')
        const size = Number(request.headers['content-length'])
        if (Number.isFinite(size) && size > (upload ? 20*1024*1024+16384 : MAX_COMMAND_BYTES)) throw failure('LIMIT', 'The preview command is too large.')
        running++; admitted = true
        if(upload){
          const body=await readCommand(request,true);if(body.length>20*1024*1024+16384)throw failure('LIMIT','Choose a file up to 20 MiB.')
          const form=await new Response(body,{headers:{'Content-Type':request.headers['content-type']}}).formData()
          if([...form.keys()].length!==5||!['accountName','boardId','stackId','cardId','file'].every(key=>form.has(key)))throw failure('VALIDATION','Invalid attachment upload.')
          return reply(response,200,await host.uploadAttachment(Object.fromEntries(form)))
        }
        const input = await readCommand(request)
        const result = await host.command(input.method, input.args)
        reply(response, 200, result)
      } catch (error) {
        const known = Object.hasOwn(ERROR_STATUS, error?.code)
        reply(response, known ? ERROR_STATUS[error.code] : 500, {error: {code: known ? error.code : 'NEXTCLOUD', message: known ? error.message : 'The preview could not complete this operation.'}})
      } finally { if (admitted) running-- }
    },
    close: () => host.close(),
  }
}

/** configureServer is never installed in a production build or vite preview. */
export function previewBridgePlugin() {
  return {
    name: 'nextglance-local-preview-bridge',
    apply: 'serve',
    configureServer(server) {
      const config = server.config.server
      if (config.host !== '127.0.0.1' || config.port !== 5174 || !config.strictPort || config.https) throw new Error('The NextGlance preview bridge requires http://127.0.0.1:5174 with strictPort.')
      const bridge = createPreviewBridge()
      server.middlewares.use(bridge.middleware)
      server.httpServer?.once('close', bridge.close)
    },
  }
}
