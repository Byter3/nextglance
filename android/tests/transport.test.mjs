import test from 'node:test'
import assert from 'node:assert/strict'
import {accountUrl, createSsoFetch, transportCapabilities} from '../src/transport.mjs'
import {NextcloudClient} from '@nextspace/nextcloud-client'

const account = {name: 'test@example.test', username: 'test', serverUrl: 'https://example.test/nextcloud'}
const url = `${account.serverUrl}/remote.php/dav/`
const response = (overrides = {}) => ({url, status: 207, headers: {ETag: '"exact"', 'Content-Type': 'application/xml'}, bodyBase64: Buffer.from('héllo 😀').toString('base64'), ...overrides})
const failure = code => Object.assign(new Error('Private native failure'), {code})
const tick = () => new Promise(resolve => setImmediate(resolve))
const query = '<?xml version="1.0"?><c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav"><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>'

test('REPORT requires an explicit transport capability and a bounded calendar query', async () => {
  const calls = [], native = {request: async input => { calls.push(input); return response() }}
  const options = {method: 'REPORT', headers: {'Content-Type': 'application/xml'}, body: query}
  for (const capabilities of [undefined, {}, {davReadMode: 'future'}, {davReadMode: 'propfind-get'}]) {
    assert.equal(transportCapabilities(capabilities).davReadMode, 'propfind-get')
    await assert.rejects(createSsoFetch(native, account, capabilities)(url, options), {code: 'SECURITY'})
  }
  const fetch = createSsoFetch(native, account, {davReadMode: 'report'})
  await fetch(url, options)
  assert.equal(calls.length, 1); assert.equal(calls[0].method, 'REPORT'); assert.equal(calls[0].body, query)
  await assert.rejects(fetch(url, {...options, body: '<c:calendar-query'}), {code: 'VALIDATION'})
  await assert.rejects(fetch(url, {...options, body: query + ' '.repeat(1024 * 1024)}), {code: 'LIMIT'})
  await assert.rejects(fetch(url, {...options, headers: {'Content-Type': 'text/plain'}}), {code: 'VALIDATION'})
  await assert.rejects(fetch(url, {...options, method: 'POST'}), {code: 'SECURITY'})
  assert.equal(calls.length, 1)
})

test('SSO requests stay inside the selected origin/base path and reject traversal encodings', () => {
  assert.equal(accountUrl(account, url), url)
  for (const target of ['https://evil.test/nextcloud', 'https://example.test/outside', 'https://example.test/nextcloud-other/x', `${url}../file`, `${url}%2e%2e/file`, `${url}one%2Ftwo`, `${url}one%5Ctwo`, `${url}%252e%252e/x`, `${url}%zz`, `${url}x#fragment`, String.raw`${url}x\y`, 'not-a-url', 'https://u:p@example.test/nextcloud/x']) assert.throws(() => accountUrl(account, target), {code: 'SECURITY'}, target)
  assert.throws(() => accountUrl({...account, serverUrl: 'http://example.test'}, 'http://example.test/x'), {code: 'SECURITY'})
})

test('native request preserves DAV method, headers, UTF-8 body and response ETags', async () => {
  const calls = []
  const fetch = createSsoFetch({request: async input => { calls.push(input); return response() }}, account)
  const result = await fetch(url, {method: 'PROPFIND', headers: {'If-Match': '"version"', Depth: '1'}, body: '<propfind/>'})
  assert.equal(calls[0].accountName, account.name)
  assert.equal(calls[0].method, 'PROPFIND'); assert.equal(calls[0].headers['if-match'], '"version"')
  assert.equal(calls[0].body, '<propfind/>'); assert.equal(result.status, 207)
  assert.equal(result.headers.get('ETag'), '"exact"'); assert.equal(await result.text(), 'héllo 😀')
})

test('explicit refresh priority is bounded and user requests default to high priority', async () => {
  const priorities=[],fetch=createSsoFetch({request:async input=>{priorities.push(input.priority);return response()}},account)
  await fetch(url);await fetch(url,{priority:'low'});await fetch(url,{priority:'high'})
  await assert.rejects(fetch(url,{priority:'urgent'}),{code:'VALIDATION'})
  assert.deepEqual(priorities,['high','low','high'])
})

test('bridge refuses source writes and credential headers before invoking native code', async () => {
  const fetch = createSsoFetch({request: async () => assert.fail('Unsafe request reached native code')}, account)
  for (const method of ['PUT', 'POST', 'DELETE', 'PATCH', 'MOVE', 'MKCOL', 'REPORT']) await assert.rejects(fetch(url, {method}), {code: 'SECURITY'})
  for (const header of ['Authorization', 'Cookie', 'Proxy-Authorization', 'Host']) await assert.rejects(fetch(url, {headers: {[header]: 'secret'}}), {code: 'SECURITY'})
  await assert.rejects(fetch(url, {method: 'PROPFIND', body: new Uint8Array([1])}), {code: 'VALIDATION'})
})

test('aborting a pending bridge read rejects promptly and ignores its late native response', async () => {
  let resolve
  const fetch = createSsoFetch({request: () => new Promise(yes => { resolve = yes })}, account)
  const controller = new AbortController()
  const pending = fetch(url, {signal: controller.signal})
  await tick(); controller.abort()
  await assert.rejects(pending, {name: 'AbortError'})
  resolve(response()); await tick()
  await assert.rejects(fetch(url, {signal: controller.signal}), {name: 'AbortError'})
})

test('native authentication failures become HTTP permission statuses for cache revocation', async () => {
  for (const [code, status] of [['AUTH', 401], ['PERMISSION', 403]]) {
    const fetch = createSsoFetch({request: () => { throw failure(code) }}, account)
    assert.equal((await fetch(url)).status, status)
    const client = new NextcloudClient({serverUrl: account.serverUrl, username: account.username}, {authentication: 'delegated', fetch})
    const data = await client.readAll()
    assert.ok(data.statuses.every(value => value.permissionDenied))
  }
})

test('native response validation blocks redirects, malformed encoding, invalid statuses and excess bodies', async () => {
  const cases = [
    [response({url: `${account.serverUrl}/elsewhere`}), 'REDIRECT'],
    [response({url: 'https://evil.test/x'}), 'SECURITY'],
    [response({status: 199}), 'NEXTCLOUD'], [response({status: 700}), 'NEXTCLOUD'],
    [response({bodyBase64: 'invalid%'}), 'NEXTCLOUD'], [response({bodyBase64: 'Y Q=='}), 'NEXTCLOUD'],
    [response({bodyBase64: 'A'.repeat(24 * 1024 * 1024 / 3 * 4 + 4)}), 'LIMIT'],
  ]
  for (const [value, code] of cases) await assert.rejects(createSsoFetch({request: async () => value}, account)(url), {code})
})

test('HEAD, empty 204 and conditional 304 responses have no synthetic body', async () => {
  for (const [method, status] of [['HEAD', 200], ['GET', 204], ['GET', 304]]) {
    const result = await createSsoFetch({request: async () => response({status, bodyBase64: ''})}, account)(url, {method})
    assert.equal(await result.text(), '')
    assert.equal(result.headers.get('ETag'), '"exact"')
  }
})

test('per-resource limits reach native streaming and bound the returned bridge payload', async () => {
  const limits = []
  const fetch = createSsoFetch({request: async input => { limits.push(input.maxBytes); return response() }}, account)
  await fetch(url, {maxResponseBytes: 1024})
  await fetch(url, {maxResponseBytes: 50 * 1024 * 1024})
  assert.deepEqual(limits, [1024, 24 * 1024 * 1024])
  await assert.rejects(fetch(url, {maxResponseBytes: 4}), {code: 'LIMIT'})
})

const generation = 'data-01234567-89ab-cdef-0123-456789abcdef'
const planner = `${account.serverUrl}/remote.php/dav/files/test/Workspace/Nextspace/`
const conditionalJson = {method: 'PUT', headers: {'Content-Type': 'application/json; charset=utf-8', 'If-None-Match': '*'}, body: '{"value":"héllo"}'}

test('only conditional folder-protocol metadata writes reach native SSO', async () => {
  const calls = []
  const fetch = createSsoFetch({request: async input => { calls.push(input); return response({url: input.url, status: 200, bodyBase64: ''}) }}, account)
  for (const path of ['manifest.json', `${generation}/organization.json`, `${generation}/legacy-import.json`, `${generation}/links/${'a'.repeat(64)}.json`]) {
    await fetch(planner + path, conditionalJson)
    await fetch(planner + path, {...conditionalJson, headers: {'Content-Type': 'application/json', 'If-Match': '"exact"'}})
  }
  for (const path of ['Workspace', 'Workspace/Nextspace', `Workspace/Nextspace/${generation}`, `Workspace/Nextspace/${generation}/links`]) await fetch(`${account.serverUrl}/remote.php/dav/files/test/${path}`, {method: 'MKCOL'})
  assert.equal(calls.length, 12)
  assert.equal(calls[0].body, conditionalJson.body)
  assert.equal(calls[1].headers['if-match'], '"exact"')
})

test('metadata policy rejects arbitrary files, other users, unconditional updates and weak ETags', async () => {
  const fetch = createSsoFetch({request: async () => assert.fail('Unsafe write reached native code')}, account)
  for (const target of [planner + 'notes.json', planner + `${generation}/arbitrary.json`, planner + `${generation}/organization.json?x=1`, planner.replace('/test/', '/other/') + 'manifest.json', planner.replace('/Nextspace/', '/') + 'planner.json']) await assert.rejects(fetch(target, conditionalJson), {code: 'SECURITY'})
  for (const headers of [{'Content-Type': 'application/json'}, {'Content-Type': 'application/json', 'If-Match': '*'}, {'Content-Type': 'application/json', 'If-Match': 'W/"weak"'}, {'Content-Type': 'application/json', 'If-Match': '"a"', 'If-None-Match': '*'}, {'Content-Type': 'application/json', 'If-Match': '"a\tb"'}, {'Content-Type': 'application/json', 'If-Match': '"has space"'}, {'Content-Type': 'application/json', 'If-Match': `"${'a'.repeat(999)}"`}]) await assert.rejects(fetch(planner + 'manifest.json', {...conditionalJson, headers}), {code: 'SECURITY'})
  for (const path of ['Other', 'Workspace/Other', `Workspace/Nextspace/${generation}/other`]) await assert.rejects(fetch(`${account.serverUrl}/remote.php/dav/files/test/${path}`, {method: 'MKCOL'}), {code: 'SECURITY'})
  await assert.rejects(fetch(planner + 'manifest.json', {...conditionalJson, body: 'not json'}), {code: 'VALIDATION'})
})

test('manual ordering uses only account-scoped conditional arrangement documents', async () => {
  const calls = []
  const fetch = createSsoFetch({request: async input => { calls.push(input); return response({url: input.url, status: 200, bodyBase64: ''}) }}, account)
  const directory = planner + `${generation}/arrangements`, target = `${directory}/${'a'.repeat(64)}.json`
  await fetch(directory, {method: 'MKCOL'})
  await fetch(target, conditionalJson)
  await fetch(target, {...conditionalJson, headers: {'Content-Type': 'application/json', 'If-Match': '"arrangement-version"'}})
  assert.equal(calls.length, 3)
  for (const invalid of [`${directory}/all.json`, `${directory}/${'a'.repeat(63)}.json`, target.replace('/test/', '/other/'), target + '?x=1']) {
    await assert.rejects(fetch(invalid, conditionalJson), {code: 'SECURITY'})
  }
  await assert.rejects(fetch(target, {...conditionalJson, headers: {'Content-Type': 'application/json'}}), {code: 'SECURITY'})
  await assert.rejects(fetch(target, {method: 'DELETE'}), {code: 'SECURITY'})
  assert.equal(calls.length, 3, 'Rejected mutations never reach the native host')
})

test('shared metadata writer handles normalized SSO success with ETag readback and preserves HTTP conflicts', async () => {
  let current = null, puts = 0
  const native = {request: async input => {
    const value = response({url: input.url, status: 200, headers: {}, bodyBase64: ''})
    if (input.method === 'PUT') {
      puts++
      if (current) return {...value, status: 412}
      current = input.body
    } else if (input.method === 'GET') return {...value, headers: {ETag: '"saved"'}, bodyBase64: Buffer.from(current).toString('base64')}
    return value
  }}
  const client = new NextcloudClient({serverUrl: account.serverUrl, username: account.username}, {authentication: 'delegated', fetch: createSsoFetch(native, account)})
  client.discovered = true
  assert.equal((await client.writePlannerFile('manifest.json', {version: 1})).etag, '"saved"')
  await assert.rejects(client.writePlannerFile('manifest.json', {version: 1}), {code: 'CONFLICT'})
  assert.equal(puts, 2)
})
