import test from 'node:test'
import assert from 'node:assert/strict'
import {createPreviewHost} from '../dev/preview-host.mjs'
import {createMobileController, cacheKey} from '../src/controller.mjs'
import {createPreviewResourceCache} from '../src/resource-cache.mjs'

const base = 'https://fixture.invalid/nextcloud', dav = `${base}/remote.php/dav/`
const principal = `${dav}principals/users/tester/`, home = `${dav}calendars/tester/`, calendar = `${home}work/`
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const row = (href, props) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const multi = rows => new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}</d:multistatus>`, {status: 207})
const ics = lines => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fixture//EN', ...lines, 'END:VCALENDAR', ''].join('\r\n')
const event = (id, date) => ics(['BEGIN:VEVENT', `UID:${id}`, `SUMMARY:${id}`, `DTSTART:${date}T090000Z`, `DTEND:${date}T100000Z`, 'END:VEVENT'])
const metadata = () => ({load: async () => ({}), getState: () => ({}), sync: async () => {}, reconcileRecords: async records => ({records, remap: new Map()})})
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return {promise, resolve} }
const tick = () => new Promise(resolve => setImmediate(resolve))
const sourceStatuses = state => state.statuses.filter(status => ['tasks', 'calendar'].includes(status.source))
const downloads = calls => calls.filter(call => call.url.endsWith('.ics') && call.method === 'GET')
const historicalTitles = Array.from({length: 300}, (_, index) => `Historical ${index}`)

async function fixture(mode, {isNative = false, incremental = false, checkpoint = false, canonicalIds = false} = {}) {
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const resources = [
    {name: '000-task.ics', body: ics(['BEGIN:VTODO', 'UID:work', 'SUMMARY:Current task', 'END:VTODO'])},
    {name: '001-event.ics', body: event('Current event', today)},
    ...historicalTitles.map((title, index) => ({name: `history-${index}.ics`, body: event(title, '20200101')})),
    {name: 'zzz-task.ics', body: ics(['BEGIN:VTODO', 'UID:later-work', 'SUMMARY:Task after historical files', 'END:VTODO'])},
  ]
  let time = 0
  const calls = [], cache = new Map(), hooks = {}, resourceValues = new Map(), resourceCalls = []
  const host = createPreviewHost({now: () => time, newId: () => 'fixture-flow', fetch: async (url, input) => {
    calls.push({url, method: input.method, body: input.body})
    if (url.endsWith('/login/v2')) return Response.json({login: `${base}/login/flow`, poll: {token: 'fixture-token', endpoint: `${base}/login/v2/poll`}})
    if (url.endsWith('/login/v2/poll')) return Response.json({server: base, loginName: 'tester', appPassword: 'fixture-password'})
    if (url.includes('/cloud/user?')) return Response.json({ocs: {meta: {statuscode: 200}, data: {id: 'tester'}}})
    if (url.includes('/cloud/capabilities?')) return Response.json({ocs: {meta: {statuscode: 200}, data: {capabilities: {}}}})
    if (incremental && url.includes('/apps/notes/api/v1/notes?')) return Response.json([{id:1,title:'Fixture note',content:'Body',etag:'note-1',modified:1}])
    if (incremental && url.endsWith('/apps/deck/api/v1.0/boards?details=true')) return Response.json([{id:1,title:'Fixture board',permissions:{PERMISSION_EDIT:true}}])
    if (incremental && url.endsWith('/apps/deck/api/v1.0/boards/1/stacks')) return Response.json([{id:1,title:'To do',cards:[{id:1,title:'Fixture card',description:'',lastModified:1,attachmentCount:0}]}],{headers:{ETag:'"deck-1"'}})
    if (url === dav) return multi(row(dav, `<d:current-user-principal><d:href>${principal}</d:href></d:current-user-principal>`))
    if (url === principal) return multi(row(principal, `<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`))
    if (url === home) return multi(row(calendar, (checkpoint ? '<d:sync-token>fixture-token-1</d:sync-token>' : '') + '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set>'))
    if (url === calendar && input.method === 'REPORT') {
      const task = input.body.includes('name="VTODO"')
      assert.equal(input.body.includes('<c:time-range'), !task, 'Only event queries carry the shared server-side window')
      const resource = resources[task ? 0 : 1]
      return multi(row(`${calendar}${resource.name}`, `<d:getetag>"v1"</d:getetag><c:calendar-data>${escape(resource.body)}</c:calendar-data>`))
    }
    if (url === calendar && input.method === 'PROPFIND') return multi(row(calendar, '<d:resourcetype><d:collection/></d:resourcetype>') + resources.map(resource => row(`${calendar}${resource.name}`, `<d:getetag>${escape(resource.etag || '"v1"')}</d:getetag><d:resourcetype/>`)).join(''))
    const resource = resources.find(value => url === `${calendar}${value.name}`)
    if (resource) {
      await hooks.beforeDownload?.(resource)
      return new Response(resource.body, {headers: {ETag: resource.etag || '"v1"', 'Content-Type': 'text/calendar'}})
    }
    return new Response(null, {status: 404})
  }})
  const flow = await host.command('beginLogin', {serverUrl: base}); time = 1800
  const authorization = await host.command('pollLogin', {flowId: flow.flowId})
  assert.deepEqual(authorization.capabilities, {davReadMode: 'report', nativeEdits: 'notes-dates-scheduling'})
  const native = {
    getAccount: async () => ({...await host.command('getAccount'), ...(mode ? {capabilities: {davReadMode: mode}} : {})}),
    selectAccount: async () => native.getAccount(),
    request: args => host.command('request', args),
  }
  const resourceFiles={keys:async()=>[...resourceValues.keys()],size:async key=>resourceValues.has(key)?Buffer.byteLength(resourceValues.get(key)):null,read:async key=>resourceValues.get(key)??null,write:async(key,text)=>resourceValues.set(key,text),remove:async key=>resourceValues.delete(key)}
  const makeResourceCache = incremental ? (account,isActive) => {
    const port=createPreviewResourceCache(resourceFiles,account,isActive)
    return Object.fromEntries(Object.entries(port).map(([name,operation])=>[name,async value=>{resourceCalls.push({name,kind:value?.kind});await hooks.beforeResource?.(name,value);return operation(value)}]))
  } : undefined
  const create = () => createMobileController({native, isNative, hostAvailable: true, openExternal: async () => {}, makeMetadataStore: canonicalIds ? () => ({...metadata(), reconcileRecords: async records => ({records: records.map(record => ({...record, id: `canonical-${record.identity?.key || record.id}`})), remap: new Map()})}) : metadata, makeResourceCache, cache: {load: async key => cache.get(key), save: async (key, value) => cache.set(key, structuredClone(value))}})
  return {api:create(), create, host, calls, resources, cache, hooks, native, resourceCalls, account: authorization.account}
}

test('concurrent Deck maintenance, Notes and CalDAV complete through the real reader and account cache port', {timeout:10000}, async t => {
  const f=await fixture('propfind-get',{incremental:true,isNative:true}), davStarted=deferred(), deckMaintained=deferred()
  t.after(()=>{davStarted.resolve();deckMaintained.resolve();f.api.dispose();f.host.close()})
  f.hooks.beforeResource=async(name,value)=>{
    if(name==='retainCollections'&&value.kind==='deck'){await davStarted.promise;deckMaintained.resolve()}
    if(name==='get'&&value.kind==='dav'){davStarted.resolve();await deckMaintained.promise}
  }
  await f.api.getState(); f.api.startDiagnostics()
  const state=await f.api.refresh()
  assert.deepEqual(state.statuses.filter(status=>['tasks','calendar','deck','notes'].includes(status.source)).map(status=>[status.source,status.state]),[['tasks','connected'],['calendar','connected'],['deck','connected'],['notes','connected']])
  assert.equal(state.records.length, f.resources.length + 2)
  assert.ok(f.resourceCalls.some(call=>call.name==='prune'&&call.kind==='dav'))
  assert.ok(f.resourceCalls.some(call=>call.name==='retainCollections'&&call.kind==='deck'))
  const terminal=JSON.parse(f.api.readDiagnostics()).events.filter(event=>event.kind==='source'&&['finish','error'].includes(event.stage)&&!event.source)
  assert.equal(terminal.length,1); assert.equal(terminal[0].stage,'finish')
  const firstDownloads=downloads(f.calls).length
  const next=await f.api.refresh()
  assert.equal(downloads(f.calls).length,firstDownloads,'Routine maintenance preserves verified native cache bodies for the next pass')
  assert.deepEqual(next.records.map(item=>item.id).sort(),state.records.map(item=>item.id).sort())
})

test('preview authorization selects REPORT and loads Tasks/Calendar without scanning 300 historical files', async t => {
  const f = await fixture(); t.after(() => { f.api.dispose(); f.host.close() })
  const state = await f.api.refresh()
  assert.deepEqual(state.records.map(record => record.source).sort(), ['calendar', 'tasks'])
  assert.ok(state.statuses.filter(status => ['calendar', 'tasks'].includes(status.source)).every(status => status.state === 'connected'))
  assert.equal(f.calls.filter(call => call.method === 'REPORT').length, 2)
  assert.equal(f.calls.filter(call => call.url === calendar && call.method === 'PROPFIND').length, 0)
  assert.equal(f.calls.filter(call => call.url.endsWith('.ics')).length, 0)
  assert.ok(f.calls.every(call => !['PUT', 'MKCOL', 'DELETE'].includes(call.method)))
})

test('SSO completes more than 250 resources, reuses verified bodies, and prunes deleted records', async t => {
  const f = await fixture('propfind-get'); t.after(() => { f.api.dispose(); f.host.close() })
  const state = await f.api.refresh()
  assert.equal(f.calls.filter(call => call.method === 'REPORT').length, 0)
  assert.equal(downloads(f.calls).length, f.resources.length, 'Tasks and Calendar share one download for each resource')
  assert.deepEqual(state.records.map(record => record.title).sort(), ['Current event', 'Current task', 'Task after historical files', ...historicalTitles].sort())
  assert.ok(sourceStatuses(state).every(status => status.state === 'connected'))
  assert.deepEqual(sourceStatuses(state).map(status => [status.source, status.count]).sort(), [['calendar', historicalTitles.length + 1], ['tasks', 2]])

  const firstDownloads = downloads(f.calls).length
  const refreshed = await f.api.refresh()
  assert.ok(sourceStatuses(refreshed).every(status => status.state === 'connected'))
  assert.equal(downloads(f.calls).length, firstDownloads, 'New inventories verify strong ETags before reusing the same client cache')
  assert.equal(f.calls.filter(call => call.url === calendar && call.method === 'PROPFIND').length, 2)

  f.resources.splice(f.resources.findIndex(resource => resource.name === 'zzz-task.ics'), 1)
  const pruned = await f.api.refresh()
  const remaining = ['Current event', 'Current task', ...historicalTitles].sort()
  assert.deepEqual(pruned.records.map(record => record.title).sort(), remaining)
  assert.equal(pruned.statuses.find(status => status.source === 'tasks').count, 1)
  assert.deepEqual(f.cache.get(cacheKey(f.account)).records.map(record => record.title).sort(), remaining)
  assert.equal(downloads(f.calls).length, firstDownloads)
})

test('same-account Files reauthorization keeps transient reuse while allowing the new read generation', async t => {
  const f = await fixture('propfind-get', {isNative: true}); t.after(() => { f.api.dispose(); f.host.close() })
  await f.api.refresh()
  const count = downloads(f.calls).length
  const reauthorized = await f.api.selectAccount()
  assert.ok(sourceStatuses(reauthorized).every(status => status.state === 'connected'))
  assert.equal(reauthorized.records.length, f.resources.length)
  assert.equal(downloads(f.calls).length, count)
})

test('disposal stops queued scan work and cannot adopt or persist a late source result', {timeout: 10000}, async t => {
  const f = await fixture('propfind-get'), held = deferred(), entered = deferred()
  t.after(() => { held.resolve(); f.api.dispose(); f.host.close() })
  f.hooks.beforeDownload = async () => { entered.resolve(); await held.promise }
  const refreshing = f.api.refresh()
  await entered.promise
  f.api.dispose()
  held.resolve()
  const late = await refreshing
  assert.ok(downloads(f.calls).length <= 4, 'Only the already-issued bounded downloads may finish')
  assert.equal(late.records.length, 0)
  assert.ok(!f.cache.has(cacheKey(f.account)), 'No obsolete source snapshot is saved after disposal')
  assert.ok(sourceStatuses(late).every(status => status.state !== 'connected'))
})

test('Files selection cancels source continuation before the barrier without erasing saved data', {timeout: 10000}, async t => {
  const f = await fixture('propfind-get', {isNative: true}), held = deferred(), entered = deferred()
  t.after(() => { held.resolve(); f.api.dispose(); f.host.close() })
  await f.api.refresh()
  const saved = structuredClone(f.cache.get(cacheKey(f.account))), start = downloads(f.calls).length
  for (const resource of f.resources) resource.etag = '"v2"'
  f.hooks.beforeDownload = async () => { entered.resolve(); await held.promise }
  let selected = false
  f.native.selectAccount = async () => { selected = true; return {account: null} }
  const refreshing = f.api.refresh()
  await entered.promise
  const selection = assert.rejects(f.api.selectAccount(), {code: 'CANCELLED'})
  await tick()
  assert.equal(selected, true, 'Cancelled read-only work does not delay the account picker; native mutations retain their separate barrier')
  await Promise.all([refreshing, selection])
  assert.deepEqual(f.cache.get(cacheKey(f.account)), saved, 'The cancelled scan cannot publish an intermediate cache')
  held.resolve()
  for (let index = 0; index < 8; index++) await tick()
  assert.equal(selected, true)
  assert.ok(downloads(f.calls).length - start <= 4, 'A selection does not wait for the remaining hundreds of resources')
  assert.deepEqual(f.cache.get(cacheKey(f.account)), saved)
  assert.ok(sourceStatuses(await f.api.getState()).every(status => status.state === 'connected'), 'Cancellation is not permission revocation or a failed refresh')
})


test('durable source checkpoint survives host recreation and skips unchanged DAV inventory and body replay',async t=>{
  const f=await fixture('propfind-get',{incremental:true,isNative:true,checkpoint:true,canonicalIds:true});t.after(()=>{f.api.dispose();f.host.close()})
  const first=await f.api.refresh(), key=cacheKey(f.account)
  assert.equal(f.cache.get(key).davCheckpoint.collections.length,1)
  const firstCalls=f.calls.length,firstResources=f.resourceCalls.length
  f.api.dispose();f.api=f.create()
  const restored=await f.api.getState();assert.deepEqual(restored.records.map(row=>row.title).sort(),first.records.map(row=>row.title).sort())
  const next=await f.api.refresh()
  assert.deepEqual(sourceStatuses(next).map(row=>row.state),['connected','connected'])
  assert.equal(f.calls.slice(firstCalls).filter(call=>call.url===calendar).length,0,'Fresh discovery token is enough after exact baseline hydration')
  assert.equal(downloads(f.calls.slice(firstCalls)).length,0)
  assert.equal(f.resourceCalls.slice(firstResources).filter(call=>call.kind==='dav'&&['get','getMany','list'].includes(call.name)).length,0)
  assert.ok(f.calls.slice(firstCalls).some(call=>call.url===home),'Permissions and collection token are still checked')
  // Disposable acceleration metadata cannot poison valid source snapshots.
  f.api.dispose();f.cache.get(key).davCheckpoint.accountKey='another-account';f.api=f.create()
  assert.equal((await f.api.getState()).records.length,next.records.length)
  const count=f.calls.length;await f.api.refresh();assert.ok(f.calls.slice(count).some(call=>call.url===calendar),'Invalid seed uses authoritative inventory')
})
