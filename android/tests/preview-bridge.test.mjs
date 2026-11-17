import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {Readable} from 'node:stream'
import {createPreviewHost} from '../dev/preview-host.mjs'
import {createPreviewBridge, previewBridgePlugin} from '../dev/preview-bridge.mjs'
import {checkedLocalRequest, checkedRequest, checkedServer, MAX_COMMAND_BYTES, PREVIEW_ORIGIN} from '../dev/preview-policy.mjs'

const server = 'https://cloud.example.test/nextcloud'
const secret = 'private-fixture-app-password'
const privateToken = 'private-fixture-poll-token'
const token = 'a'.repeat(64)
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json', ...headers}})
const login = () => json({login: `${server}/index.php/login/v2/flow/public-browser-id`, poll: {endpoint: `${server}/index.php/login/v2/poll`, token: privateToken}})
const credentials = () => json({server, loginName: 'login-alias', appPassword: secret})
const identity = user => json({ocs: {meta: {statuscode: 100}, data: {id: user}}})
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return {promise, resolve, reject} }
const tick = () => new Promise(resolve => setImmediate(resolve))

function fixture(override, hostOptions = {}) {
  let time = 0, ids = 0
  const calls = []
  const host = createPreviewHost({now: () => time, newId: () => `fixture-flow-${++ids}`, ...hostOptions, fetch: async (url, options) => {
    calls.push({url, ...options})
    const special = await override?.(url, options, calls)
    if (special) return special
    if (url.endsWith('/login/v2')) return login()
    if (url.endsWith('/login/v2/poll')) return credentials()
    if (url.endsWith('/cloud/user?format=json')) return identity('canonical-user')
    return new Response('native fixture data', {headers: {ETag: '"fixture-version"'}})
  }})
  const begin = () => host.command('beginLogin', {serverUrl: server})
  const poll = flowId => host.command('pollLogin', {flowId})
  return {host, calls, begin, poll, advance: amount => { time += amount }, async connect() { const flow = await begin(); time += 1800; return (await poll(flow.flowId)).account }}
}

test('canonical login uses the host-only poll token and returns only a stable public account', async t => {
  const f = fixture(); t.after(() => f.host.close())
  assert.deepEqual(await f.host.command('getAccount'), {account: null})
  const account = await f.connect()
  assert.deepEqual(account, {name: `nextspace-direct:${createHash('sha256').update(`${server}\0canonical-user`).digest('hex')}`, serverUrl: server, username: 'canonical-user'})
  assert.deepEqual((await f.host.command('getAccount')).capabilities, {davReadMode: 'report', nativeEdits: 'notes-dates-scheduling'})
  assert.equal(f.calls[1].body, `token=${privateToken}`)
  assert.equal(f.calls[2].headers.authorization, `Basic ${Buffer.from(`login-alias:${secret}`).toString('base64')}`)
  assert.ok(f.calls.every(call => call.headers['user-agent'] === 'NextGlance/0.6.0 Preview'))
  const exposed = JSON.stringify(await f.host.command('getAccount'))
  for (const value of [secret, privateToken, 'Authorization', 'appPassword']) assert.ok(!exposed.includes(value))
  assert.deepEqual(await f.host.command('disconnect'), {account: null})
})

test('host enforces initial and subsequent polling delays and maps 404 to pending', async t => {
  let pending = true
  const f = fixture(url => url.endsWith('/poll') && pending ? new Response(null, {status: 404}) : null); t.after(() => f.host.close())
  const flow = await f.begin()
  assert.deepEqual(await f.poll(flow.flowId), {pending: true}); assert.equal(f.calls.length, 1)
  f.advance(1799); assert.deepEqual(await f.poll(flow.flowId), {pending: true}); assert.equal(f.calls.length, 1)
  f.advance(1); assert.deepEqual(await f.poll(flow.flowId), {pending: true}); assert.equal(f.calls.length, 2)
  f.advance(1999); assert.deepEqual(await f.poll(flow.flowId), {pending: true}); assert.equal(f.calls.length, 2)
  pending = false; f.advance(1); assert.equal((await f.poll(flow.flowId)).pending, false)
})

test('replacement invalidates an in-flight begin reply without exposing its token', async t => {
  const first = deferred()
  const f = fixture((url, _options, calls) => calls.length === 1 ? first.promise : null); t.after(() => f.host.close())
  const old = f.begin(); const rejected = assert.rejects(old, {code: 'CANCELLED'})
  await tick()
  const next = await f.begin()
  await rejected
  first.resolve(login()); await tick()
  f.advance(1800)
  assert.equal((await f.poll(next.flowId)).pending, false)
})

test('cancel and replacement discard late poll credentials and retain an earlier account', async t => {
  const late = deferred()
  let hold = false
  const f = fixture(url => hold && url.endsWith('/poll') ? late.promise : null); t.after(() => f.host.close())
  const prior = await f.connect()
  hold = true
  const flow = await f.begin(); f.advance(1800)
  const pending = f.poll(flow.flowId); const rejected = assert.rejects(pending, {code: 'CANCELLED'})
  await tick()
  assert.deepEqual(await f.host.command('cancelLogin', {flowId: flow.flowId}), {pending: false, account: prior, capabilities: {davReadMode: 'report', nativeEdits: 'notes-dates-scheduling'}})
  await rejected; late.resolve(credentials()); await tick()
  assert.deepEqual(await f.host.command('getAccount'), {account: prior, capabilities: {davReadMode: 'report', nativeEdits: 'notes-dates-scheduling'}})
  await assert.rejects(f.poll(flow.flowId), {code: 'CANCELLED'})
})

test('ten-minute client expiry rejects polling without network activity', async t => {
  const f = fixture(); t.after(() => f.host.close())
  const flow = await f.begin(); f.advance(600000)
  await assert.rejects(f.poll(flow.flowId), {code: 'EXPIRED'})
  assert.equal(f.calls.length, 1); assert.deepEqual(await f.host.command('getAccount'), {account: null})
})

test('canonical discovery retries a consumed successful poll using only its host-memory candidate', async t => {
  let discoveries = 0
  const f = fixture(url => {
    if (url.endsWith('/cloud/user?format=json') && ++discoveries === 1) throw new Error(`raw upstream failure ${secret}`)
  }); t.after(() => f.host.close())
  const flow = await f.begin(); f.advance(1800)
  await assert.rejects(f.poll(flow.flowId), error => error.code === 'NETWORK' && !error.message.includes(secret))
  assert.deepEqual(await f.host.command('getAccount'), {account: null})
  f.advance(2000)
  assert.equal((await f.poll(flow.flowId)).account.username, 'canonical-user')
  assert.equal(f.calls.filter(call => call.url.endsWith('/poll')).length, 1)
  assert.equal(discoveries, 2)
})

test('cancel during canonical discovery prevents account activation', async t => {
  const late = deferred()
  const f = fixture(url => url.endsWith('/cloud/user?format=json') ? late.promise : null); t.after(() => f.host.close())
  const flow = await f.begin(); f.advance(1800)
  const pending = f.poll(flow.flowId); const rejected = assert.rejects(pending, {code: 'CANCELLED'})
  await tick(); await f.host.command('cancelLogin')
  await rejected; late.resolve(identity('late-user')); await tick()
  assert.deepEqual(await f.host.command('getAccount'), {account: null})
})

test('login endpoints, returned installation and canonical identity are validated before selection', async t => {
  const scenarios = [
    [url => url.endsWith('/login/v2') ? json({login: 'https://evil.test/login', poll: {endpoint: `${server}/poll`, token: privateToken}}) : null, 'SECURITY', false],
    [url => url.endsWith('/login/v2') ? json({login: `${server}/login`, poll: {endpoint: 'https://evil.test/poll', token: privateToken}}) : null, 'SECURITY', false],
    [url => url.endsWith('/poll') ? json({server: 'https://cloud.example.test/other-installation', loginName: 'alias', appPassword: secret}) : null, 'SECURITY', true],
    [url => url.endsWith('/cloud/user?format=json') ? identity('bad\nidentity') : null, 'FORMAT', true],
    [url => url.endsWith('/poll') ? json({server, loginName: 'colon:alias', appPassword: secret}) : null, 'FORMAT', true],
  ]
  for (const [override, code, poll] of scenarios) {
    const f = fixture(override); t.after(() => f.host.close())
    if (poll) { const flow = await f.begin(); f.advance(1800); await assert.rejects(f.poll(flow.flowId), {code}) }
    else await assert.rejects(f.begin(), {code})
    assert.deepEqual(await f.host.command('getAccount'), {account: null})
  }
})

test('authenticated requests preserve bounded data and expose only public response headers', async t => {
  const f = fixture(url => url.endsWith('/fixture') ? new Response('héllo 😀', {headers: {ETag: '"safe"', 'Content-Type': 'text/plain', 'Set-Cookie': 'private-session', Authorization: secret, 'X-Private-Session': secret, 'X-Notes-Chunk-Cursor': 'cursor'}}) : null); t.after(() => f.host.close())
  const account = await f.connect()
  const result = await f.host.command('request', {accountName: account.name, url: `${server}/fixture`, method: 'GET', headers: {}, maxBytes: 100})
  assert.equal(Buffer.from(result.bodyBase64, 'base64').toString('utf8'), 'héllo 😀')
  assert.equal(result.headers.etag, '"safe"'); assert.equal(result.headers['x-notes-chunk-cursor'], 'cursor')
  for (const key of ['set-cookie', 'authorization', 'x-private-session']) assert.equal(result.headers[key], undefined)
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.equal(f.calls.at(-1).redirect, 'manual'); assert.equal(f.calls.at(-1).credentials, 'omit')
})

test('authenticated redirects never follow or send credentials to another endpoint', async t => {
  const f = fixture(url => url.endsWith('/redirect') ? new Response(null, {status: 302, headers: {Location: 'https://evil.test/collect'}}) : null); t.after(() => f.host.close())
  const account = await f.connect(), before = f.calls.length
  await assert.rejects(f.host.command('request', {accountName: account.name, url: `${server}/redirect`}), {code: 'REDIRECT'})
  assert.equal(f.calls.length, before + 1)
  assert.equal(f.calls.at(-1).url, `${server}/redirect`)
  assert.equal(f.calls.at(-1).redirect, 'manual')
})

test('request guard rejects cross-account/origin/path, traversal, auth headers and native writes', () => {
  const account = {name: 'local-account', serverUrl: server, username: 'canonical-user'}
  const request = {accountName: account.name, url: `${server}/remote.php/dav/`, headers: {}}
  for (const url of ['https://evil.test/', 'https://cloud.example.test/outside', `${server}/../outside`, `${server}/%2e%2e/file`, `${server}/%252e%252e/file`, `${server}/a%2fb`, `${server}//unsafe`, `${server}/file#fragment`]) assert.throws(() => checkedRequest(account, {...request, url}), {code: 'SECURITY'})
  assert.throws(() => checkedRequest(account, {...request, accountName: 'other-account'}), {code: 'CANCELLED'})
  for (const method of ['POST', 'DELETE', 'PATCH', 'MOVE', 'PUT', 'MKCOL']) assert.throws(() => checkedRequest(account, {...request, method}), {code: 'SECURITY'})
  assert.throws(() => checkedRequest(account, {...request, method: 'SEARCH'}), {code:'VALIDATION'})
  assert.throws(() => checkedRequest(account, {...request, method: 'REPORT'}), {code: 'VALIDATION'})
  assert.throws(() => checkedRequest(account, {...request, method: 'REPORT', headers: {'Content-Type': 'application/xml'}, body: '<d:expand-property xmlns:d="DAV:"/>'}), {code: 'VALIDATION'})
  for (const name of ['Authorization', 'Cookie', 'Proxy-Authorization', 'Host', 'Connection', 'Content-Length', 'Transfer-Encoding', 'Proxy-Connection', 'Sec-Fetch-Site']) assert.throws(() => checkedRequest(account, {...request, headers: {[name]: 'private'}}), {code: 'SECURITY'})
  assert.throws(() => checkedRequest(account, {...request, headers: {Accept: 'a', accept: 'b'}}), {code: 'VALIDATION'})
  assert.throws(() => checkedRequest(account, {...request, method: 'GET', body: 'body'}), {code: 'LIMIT'})
  assert.throws(() => checkedRequest(account, {...request, method: 'PROPFIND', body: 'a'.repeat(1024 * 1024 + 1)}), {code: 'LIMIT'})
  for (const maxBytes of [0, -1, 1.5, 24 * 1024 * 1024 + 1]) assert.throws(() => checkedRequest(account, {...request, maxBytes}), {code: 'LIMIT'})
})

test('only conditional folder-protocol metadata writes pass host policy', () => {
  const account = {name: 'local-account', serverUrl: server, username: 'canonical-user'}
  const base = `${server}/remote.php/dav/files/canonical-user/`
  const request = {accountName: account.name, url: `${base}Workspace/Nextspace/manifest.json`, method: 'PUT', headers: {'Content-Type': 'application/json', 'If-None-Match': '*'}, body: '{"version":1}'}
  assert.equal(checkedRequest(account, request).method, 'PUT')
  assert.equal(checkedRequest(account, {...request, url: `${base}Workspace/Nextspace`, method: 'MKCOL', headers: {}, body: undefined}).method, 'MKCOL')
  for (const change of [{headers: {'Content-Type': 'application/json'}}, {headers: {'Content-Type': 'application/json', 'If-Match': 'W/"weak"'}}, {url: `${base}notes.txt`}, {url: request.url.replace('/canonical-user/', '/other-user/')}, {url: `${request.url}?query=1`}]) assert.throws(() => checkedRequest(account, {...request, ...change}), {code: 'SECURITY'})
})

test('response streaming, declared sizes and timeouts are bounded', async t => {
  for (const [response, code] of [[() => new Response('12345'), 'LIMIT'], [() => new Response('1', {headers: {'Content-Length': '5'}}), 'LIMIT'], [() => new Promise(() => {}), 'NETWORK']]) {
    const f = fixture(url => url.endsWith('/large') ? response() : null, {timeoutMs: 25}); t.after(() => f.host.close())
    const account = await f.connect()
    await assert.rejects(f.host.command('request', {accountName: account.name, url: `${server}/large`, maxBytes: 4}), {code})
  }
})

test('account commit waits for earlier metadata writes and cancellation returns committed state', async t => {
  const write = deferred()
  let user = 'first-user'
  const f = fixture((url, options) => options.method === 'PUT' ? write.promise : url.endsWith('/cloud/user?format=json') ? identity(user) : null); t.after(() => f.host.close())
  const prior = await f.connect()
  const writing = f.host.command('request', {accountName: prior.name, url: `${server}/remote.php/dav/files/first-user/Workspace/Nextspace/manifest.json`, method: 'PUT', headers: {'Content-Type': 'application/json', 'If-None-Match': '*'}, body: '{}'})
  await tick(); user = 'second-user'
  const next = await f.begin(); f.advance(1800)
  const committing = f.poll(next.flowId)
  await tick()
  let settled = false
  const cancelling = f.host.command('cancelLogin', {flowId: next.flowId}).then(value => { settled = true; return value })
  const staleRequest = f.host.command('request', {accountName: prior.name, url: `${server}/fixture`})
  const rejected = assert.rejects(staleRequest, {code: 'CANCELLED'})
  await tick(); assert.equal(settled, false)
  write.resolve(new Response(null, {status: 201}))
  await writing
  assert.equal((await committing).account.username, 'second-user')
  assert.equal((await cancelling).account.username, 'second-user')
  await rejected
})

test('closing a development host discards authorization and stops pending network work', async () => {
  const f = fixture(url => url.endsWith('/hang') ? new Promise(() => {}) : null)
  const account = await f.connect()
  const pending = f.host.command('request', {accountName: account.name, url: `${server}/hang`})
  const rejected = assert.rejects(pending, {code: 'NETWORK'})
  await tick(); f.host.close(); await rejected
  await assert.rejects(f.host.command('getAccount'), {code: 'UNAVAILABLE'})
})

const localHeaders = (command = false) => ({host: '127.0.0.1:5174', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', ...(command ? {origin: PREVIEW_ORIGIN, 'content-type': 'application/json', 'x-nextglance-token': token} : {})})
function localRequest(headers = localHeaders(), remoteAddress = '127.0.0.1') { return {headers, socket: {remoteAddress}} }

test('bootstrap rejects foreign origins, navigation, missing fetch metadata and DNS rebinding hosts', () => {
  assert.doesNotThrow(() => checkedLocalRequest(localRequest(), token, false))
  for (const change of [{host: 'localhost:5174'}, {host: 'evil.test:5174'}, {origin: 'https://evil.test'}, {'sec-fetch-site': 'cross-site'}, {'sec-fetch-site': 'same-site'}, {'sec-fetch-site': undefined}, {'sec-fetch-mode': 'navigate'}, {'sec-fetch-dest': 'image'}]) assert.throws(() => checkedLocalRequest(localRequest({...localHeaders(), ...change}), token, false), {code: 'SECURITY'})
  assert.throws(() => checkedLocalRequest(localRequest(localHeaders(), '192.168.1.5'), token, false), {code: 'SECURITY'})
})

test('command requires exact Origin, JSON and a timing-safe process token', () => {
  assert.doesNotThrow(() => checkedLocalRequest(localRequest(localHeaders(true)), token, true))
  for (const change of [{origin: undefined}, {origin: 'https://evil.test'}]) assert.throws(() => checkedLocalRequest(localRequest({...localHeaders(true), ...change}), token, true), {code: 'SECURITY'})
  for (const value of [undefined, 'b'.repeat(64), 'é'.repeat(64)]) assert.throws(() => checkedLocalRequest(localRequest({...localHeaders(true), 'x-nextglance-token': value}), token, true), {code: 'PREVIEW_SESSION_EXPIRED'})
  for (const type of ['text/plain', 'application/x-www-form-urlencoded']) assert.throws(() => checkedLocalRequest(localRequest({...localHeaders(true), 'content-type': type}), token, true), {code: 'VALIDATION'})
})

async function invoke(bridge, {path = '/__nextglance/command', method = 'POST', headers = localHeaders(true), body = {method: 'getAccount', args: {}}, raw} = {}) {
  const request = Readable.from([Buffer.from(raw ?? JSON.stringify(body))])
  Object.assign(request, {url: path, method, headers, socket: {remoteAddress: '127.0.0.1'}})
  const response = {writeHead(status, value) { this.status = status; this.headers = value }, end(value) { this.value = JSON.parse(value); this.writableEnded = true }}
  await bridge.middleware(request, response, () => { response.next = true })
  return response
}

test('middleware returns native results and sanitized errors, with no-store and no CORS', async () => {
  const commands = []
  const bridge = createPreviewBridge({token, host: {command: async (method, args) => { commands.push({method, args}); if (method === 'explode') throw new Error(secret); return {account: null} }, close() {}}})
  const bootstrap = await invoke(bridge, {path: '/__nextglance/session', method: 'GET', headers: localHeaders()})
  assert.deepEqual(bootstrap.value, {token})
  const response = await invoke(bridge)
  assert.equal(response.status, 200); assert.deepEqual(response.value, {account: null})
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.equal(response.headers['Access-Control-Allow-Origin'], undefined)
  assert.equal(commands.length, 1)
  const failed = await invoke(bridge, {body: {method: 'explode'}})
  assert.equal(failed.status, 500); assert.equal(failed.value.error.code, 'NEXTCLOUD'); assert.ok(!JSON.stringify(failed.value).includes(secret))
  const denied = await invoke(bridge, {headers: {...localHeaders(true), origin: 'https://evil.test'}})
  assert.equal(denied.status, 403); assert.equal(commands.length, 2)
  const restarted = await invoke(bridge, {headers: {...localHeaders(true), 'x-nextglance-token': 'b'.repeat(64)}})
  assert.equal(restarted.value.error.code, 'PREVIEW_SESSION_EXPIRED'); assert.equal(commands.length, 2)
})

test('middleware rejects oversized, malformed, unknown-method and non-JSON commands', async () => {
  const host = createPreviewHost({fetch: () => assert.fail('No network expected')})
  const bridge = createPreviewBridge({host, token})
  for (const options of [{raw: 'invalid'}, {body: []}, {body: {method: 'getAccount', extra: true}}, {headers: {...localHeaders(true), 'content-type': 'text/plain'}}]) assert.equal((await invoke(bridge, options)).status, 400)
  assert.equal((await invoke(bridge, {headers: {...localHeaders(true), 'content-length': String(MAX_COMMAND_BYTES + 1)}})).status, 413)
  assert.equal((await invoke(bridge, {body: {method: 'selectAccount'}})).status, 503)
  assert.equal((await invoke(bridge, {body: {method: 'request', args: {accountName: 'saved', url: `${server}/fixture`}}})).value.error.code, 'RECONNECT_REQUIRED')
  assert.equal((await invoke(bridge, {method: 'GET'})).status, 503)
  assert.equal((await invoke(bridge, {path: '/__nextglance/session?token=true', method: 'GET'})).status, 503)
  assert.equal((await invoke(bridge, {path: '/other'})).next, true)
  bridge.close()
})

test('bridge plugin is development-only and refuses non-loopback or non-strict servers', () => {
  const plugin = previewBridgePlugin()
  assert.equal(plugin.apply, 'serve'); assert.equal(plugin.configurePreviewServer, undefined)
  for (const change of [{host: '0.0.0.0'}, {port: 5175}, {strictPort: false}, {https: {}}]) assert.throws(() => plugin.configureServer({config: {server: {host: '127.0.0.1', port: 5174, strictPort: true, ...change}}}), /127\.0\.0\.1:5174/)
  for (const value of ['https://user:pass@example.test', 'http://example.test', `${server}?x=y`, `${server}#fragment`, `${server}/%252e%252e`, `${server}/../other`, 'x'.repeat(4097)]) assert.throws(() => checkedServer(value))
})

test('explicit multipart upload keeps loopback guards and validates the bounded form',async()=>{
  const calls=[],bridge=createPreviewBridge({token,host:{uploadAttachment:async value=>{calls.push(value);return {uploaded:true}},close(){}}})
  const form=new FormData();for(const [key,value]of Object.entries({accountName:'account',boardId:'1',stackId:'2',cardId:'3'}))form.append(key,value);form.append('file',new File(['data'],'fixture.txt'))
  const encoded=new Request('http://fixture.test',{method:'POST',body:form}),raw=Buffer.from(await encoded.arrayBuffer()),headers={...localHeaders(true),'content-type':encoded.headers.get('content-type')}
  assert.equal((await invoke(bridge,{path:'/__nextglance/upload',headers,raw})).status,200)
  assert.equal(calls.length,1);assert.equal(await calls[0].file.text(),'data')
  assert.equal((await invoke(bridge,{path:'/__nextglance/upload',headers:{...headers,origin:'https://foreign.example.test'},raw})).status,403)
  assert.equal((await invoke(bridge,{path:'/__nextglance/upload',headers:{...headers,'content-length':String(20*1024*1024+16385)},raw})).status,413)
  assert.equal(calls.length,1)
})
