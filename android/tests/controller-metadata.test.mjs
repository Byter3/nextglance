/** Controller integration with real mobile persistence and shared folder protocol. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {createMobileController, cacheKey, launchKey, metadataKey} from '../src/controller.mjs'
import {createSlotCache} from '../src/cache.mjs'
import {createMetadataStore} from '../src/metadata.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {FolderWorkspaceClient, assembleWorkspace} from '@nextspace/nextcloud-client/planner-folder.mjs'

const clone = value => structuredClone(value)
const A = {name: 'a@example.test', serverUrl: 'https://example.test/nc', username: 'a'}
const B = {...A, name: 'b@example.test', username: 'b'}
const canonical = account => account.username === 'a' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222'
const sources = ['tasks', 'calendar', 'deck', 'notes', 'collectives']
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return {promise, resolve} }
// Source refresh and planner pull are independent in SYNC-03.
const ready = async api => { await api.refresh(); return api.syncWorkspace() }
const failure = code => Object.assign(new Error('Private native diagnostic'), {code})
function sourceData(account) {
  return {
    records: [{id: `${account.username}-item`, source: 'tasks', kind: 'task', title: `${account.username} task`, collectionId: `${account.username}-tasks`, identity: {source: 'tasks', key: `${account.username}/task.ics`}}],
    collections: [{id: `${account.username}-tasks`, source: 'tasks', title: `${account.username} tasks`, color: '#4477aa'}],
    statuses: sources.map(source => ({source, state: 'connected', count: source === 'tasks' ? 1 : 0})),
  }
}
function savedWorkspace(account) {
  const workspace = createPlannerWorkspace()
  workspace.spaces = [{id: `${account.username}-space`, name: `${account.username} saved Space`, color: '#335577', collectionIds: [`${account.username}-tasks`, 'unavailable-source']}]
  workspace.categories = [{id: `${account.username}-group`, spaceId: `${account.username}-space`, name: 'Personal', color: '#778899', collectionIds: [`${account.username}-tasks`]}]
  workspace.projects = [{id: `${account.username}-project`, spaceId: `${account.username}-space`, name: 'Curated', collectionIds: [], recordIds: [canonical(account)]}]
  workspace.identities = [{id: canonical(account), source: 'tasks', key: `${account.username}/task.ics`, aliases: [`${account.username}-item`]}]
  return workspace
}
function cloud(account) {
  const files = new Map(), writes = [], reads = []
  let sequence = 0
  const api = {
    files, writes, reads, beforeRead: null, beforeWrite: null, sourceFailure: null, result: sourceData(account),
    readAll: async () => { if (api.sourceFailure) throw failure(api.sourceFailure); return clone(api.result) },
    readPage: async () => ({body: 'Fixture page'}),
    readWorkspace: async () => ({workspace: null, etag: null}),
    listPlannerFiles: async directory => {
      const prefix = `${directory}/`, entries = new Map()
      for (const [path, value] of files) if(path.startsWith(prefix)) {
        const relative = path.slice(prefix.length), slash = relative.indexOf('/')
        if(slash < 0) entries.set(path,{path,etag:value.etag})
        else {const child=prefix+relative.slice(0,slash);entries.set(child,{path:child,collection:true})}
      }
      return {exists:true,files:[...entries.values()]}
    },
    readPlannerFile: async path => { reads.push(path); if (api.beforeRead) await api.beforeRead(path); return clone(files.get(path) || {document: null, etag: null}) },
    writePlannerFile: async (path, document, etag) => {
      if (api.beforeWrite) await api.beforeWrite(path)
      if (etag !== (files.get(path)?.etag || null)) throw Object.assign(new Error('Conditional conflict'), {code: 'CONFLICT', status: 412})
      const saved = {document: clone(document), etag: `"file-${++sequence}"`}
      files.set(path, saved); writes.push({path, document: clone(document)}); return {etag: saved.etag}
    },
    data: () => { const prefix = `${files.get('manifest.json').document.generation}/`; return assembleWorkspace(new Map([...files].filter(([path]) => path.startsWith(prefix) && !path.endsWith('/legacy-import.json')).map(([path, value]) => [path.slice(prefix.length), value.document]))) },
  }
  return api
}
async function fixture(options = {}) {
  let current = A, selection = A, capabilities
  const files = new Map(), nativeCalls = {selections: 0, metadataModes: []}, clients = [], loads = []
  const reconciliation = {calls: 0, failNext: false}
  const cache = createSlotCache({size: async path => files.has(path) ? Buffer.byteLength(files.get(path)) : null, read: async path => files.get(path) ?? null, write: async (path, text) => { files.set(path, text) }, remove: async path => { files.delete(path) }})
  const load = cache.load
  cache.load = (...args) => { loads.push(args[0]); return load(...args) }
  const clouds = new Map()
  for (const account of [A, B]) { const remote = cloud(account), folder = new FolderWorkspaceClient(remote), read = await folder.readWorkspace(); await folder.writeWorkspace(savedWorkspace(account), read.etag); remote.writes.length = 0; remote.reads.length = 0; clouds.set(account.username, remote) }
  const native = {
    getAccount: async () => ({account: current, capabilities}),
    selectAccount: async () => { nativeCalls.selections++; current = selection; return {account: selection, capabilities} },
    beginLogin: async () => ({flowId: 'fixture-flow', loginUrl: `${A.serverUrl}/login/flow`}),
    pollLogin: async () => ({pending: false, account: current, capabilities}),
    cancelLogin: async () => ({pending: false, account: current, capabilities}),
    disconnect: async () => { current = null },
  }
  const makeClient = (account, transport) => {
    const remote = clouds.get(account.username)
    const client = {...remote, davMode: transport.davReadMode, readPlannerFile: (...args) => { nativeCalls.metadataModes.push(transport.davReadMode); return remote.readPlannerFile(...args) }}
    clients.push(client); return client
  }
  const makeMetadataStore = ports => {
    const store = createMetadataStore(ports), reconcile = store.reconcileRecords
    store.reconcileRecords = records => {
      reconciliation.calls++
      if (reconciliation.failNext) { reconciliation.failNext = false; throw failure('FORMAT') }
      return reconcile(records)
    }
    return store
  }
  const create = (restartCache = cache) => createMobileController({native, cache: restartCache, makeClient, makeMetadataStore, openExternal: async () => {}, ...options})
  return {api: create(), create, cache, files, native, nativeCalls, clients, loads, reconciliation, a: clouds.get('a'), b: clouds.get('b'), select: account => { selection = account }, setCurrent: account => { current = account }, setCapabilities: value => { capabilities = value }}
}

test('unchanged metadata polls skip identity projection but keep snapshots detached and still read cloud', async t => {
  const f = await fixture(); t.after(() => f.api.dispose())
  await ready(f.api)
  const calls = f.reconciliation.calls, reads = f.a.reads.length
  let first, second
  const stopFirst = f.api.subscribe(state => { first = state; state.records[0].title = 'Subscriber mutation'; state.workspace.spaces[0].name = 'Subscriber mutation' })
  const stopSecond = f.api.subscribe(state => { second = state })
  t.after(stopFirst); t.after(stopSecond)
  const result = await f.api.syncWorkspace()
  await f.api.syncWorkspace()
  assert.equal(f.reconciliation.calls, calls)
  assert.ok(f.a.reads.length > reads, 'Cloud synchronization is not skipped')
  assert.notEqual(first.records, second.records)
  assert.equal(second.records[0].title, 'a task'); assert.equal(second.workspace.spaces[0].name, 'a saved Space')
  result.records[0].title = 'Caller mutation'
  assert.equal((await f.api.getState()).records[0].title, 'a task')
})

test('refresh, permission revocation, workspace revision and account transitions invalidate reconciliation reuse', async t => {
  const f = await fixture(); t.after(() => f.api.dispose())
  await ready(f.api)
  let calls = f.reconciliation.calls
  const refreshed = await f.api.refresh()
  assert.ok(f.reconciliation.calls > calls, 'An equal-content native refresh still verifies fresh identities')
  calls = f.reconciliation.calls
  refreshed.workspace.spaces[0].name = 'Changed organization'
  await f.api.saveWorkspace(refreshed.workspace, refreshed.revision); await f.api.syncWorkspace()
  assert.ok(f.reconciliation.calls > calls, 'New planner revision invalidates reuse')
  calls = f.reconciliation.calls
  f.a.result.records = []; f.a.result.collections = []
  f.a.result.statuses = f.a.result.statuses.map(status => status.source === 'tasks' ? {...status, state:'error', permissionDenied:true} : status)
  const revoked = await f.api.refresh()
  assert.ok(f.reconciliation.calls > calls); assert.deepEqual(revoked.records, [])
  assert.deepEqual((await f.cache.load(cacheKey(A))).records, [])
  calls = f.reconciliation.calls
  f.select(B); await f.api.selectAccount(); const other = await f.api.syncWorkspace()
  assert.ok(f.reconciliation.calls > calls); assert.equal(other.records[0].id, canonical(B))
})

test('a failed identity projection is retried for the same inputs before reuse is allowed', async t => {
  const f = await fixture(); t.after(() => f.api.dispose())
  const state = await ready(f.api)
  state.workspace.spaces[0].name = 'New revision'
  await f.api.saveWorkspace(state.workspace, state.revision)
  f.reconciliation.failNext = true
  const failed = await f.api.syncWorkspace(), calls = f.reconciliation.calls
  assert.equal(failed.storage.syncStatus, 'error')
  const retried = await f.api.syncWorkspace()
  assert.equal(f.reconciliation.calls, calls + 1); assert.equal(retried.storage.syncStatus, 'synced')
  await f.api.syncWorkspace()
  assert.equal(f.reconciliation.calls, calls + 1)
})

test('first metadata readiness invalidates reuse even at the same revision and with no source changes', async t => {
  const f = await fixture(); t.after(() => f.api.dispose()); f.a.files.clear()
  const initial = await f.api.getState(), calls = f.reconciliation.calls
  assert.equal(initial.metadata.ready, false)
  const ready = await f.api.syncWorkspace()
  assert.equal(ready.metadata.ready, true); assert.equal(ready.revision, initial.revision)
  assert.equal(f.reconciliation.calls, calls + 1)
  await f.api.syncWorkspace(); assert.equal(f.reconciliation.calls, calls + 1)
})

test('restore reads host capability and an unknown refreshed capability falls back conservatively', async t => {
  const f = await fixture(); t.after(() => f.api.dispose())
  f.setCapabilities({davReadMode: 'report'})
  await f.api.getState()
  assert.equal(f.clients[0].davMode, 'report')
  f.setCapabilities({davReadMode: 'unsupported-future-mode'})
  await ready(f.api)
  assert.deepEqual(f.clients.map(client => client.davMode), ['report', 'propfind-get'])
})

for (const transition of ['refresh', 'select', 'authorize', 'cancel']) test(`same-account ${transition} changes transport without reloading pending metadata or its baseline`, async t => {
  const f = await fixture(); t.after(() => f.api.dispose())
  const initial = await ready(f.api)
  initial.workspace.spaces[0].name = 'Pending same-account edit'
  const saved = await f.api.saveWorkspace(initial.workspace, initial.revision)
  await f.api.saveDeviceState({scopeId: 'a-space', scopes: {all: {query: 'Retained local view'}}})
  const before = await f.cache.load(metadataKey(A)), metadataLoads = f.loads.filter(key => key === metadataKey(A)).length
  f.a.beforeRead = () => { throw failure('NETWORK') }
  f.setCapabilities({davReadMode: 'report'})
  let state
  if (['authorize', 'cancel'].includes(transition)) {
    const flow = await f.api.beginLogin(A.serverUrl)
    state = transition === 'cancel' ? await f.api.cancelLogin(flow.flowId) : (await f.api.pollLogin(flow.flowId)).state
  } else state = await (transition === 'select' ? f.api.selectAccount() : f.api.refresh())
  state = await f.api.syncWorkspace()
  assert.equal(f.loads.filter(key => key === metadataKey(A)).length, metadataLoads, 'Transport changes must not reload the planner store')
  assert.deepEqual(f.clients.map(client => client.davMode), ['propfind-get', 'report'])
  assert.equal(f.nativeCalls.metadataModes.at(-1), 'report', 'Existing metadata store uses the replacement authenticated client')
  assert.equal(state.workspace.spaces[0].name, 'Pending same-account edit')
  assert.equal(state.deviceState.scopes.all.pages.overview.query, 'Retained local view')
  assert.equal(state.revision, saved.revision)
  const after = await f.cache.load(metadataKey(A))
  assert.deepEqual(after.baseline, before.baseline); assert.deepEqual(after.checkpoint, before.checkpoint)
  assert.equal(after.accountKey, before.accountKey)
  assert.equal(after.workspace.spaces[0].name, 'Pending same-account edit')
  assert.equal(f.a.writes.length, 0)
})

test('remote-first controller restore adopts saved organization and canonical project item IDs', async () => {
  const f = await fixture(), initial = await f.api.getState()
  assert.equal(initial.metadata.ready, false)
  assert.equal(f.a.reads.length, 0)
  await assert.rejects(f.api.saveWorkspace(initial.workspace, initial.revision), {code: 'METADATA_NOT_READY'})
  const state = await ready(f.api)
  assert.equal(state.metadata.ready, true)
  assert.equal(state.workspace.spaces[0].name, 'a saved Space')
  assert.deepEqual(state.workspace.spaces[0].collectionIds, ['a-tasks', 'unavailable-source'])
  assert.equal(state.records[0].id, canonical(A))
  assert.equal(state.workspace.projects[0].recordIds[0], state.records[0].id)
  assert.equal(state.recordIdAliases['a-item'], canonical(A))
  assert.equal(state.records[0].readonly, undefined)
  assert.equal(f.a.writes.length, 0)
  assert.equal((await f.cache.load(cacheKey(A))).records[0].id, canonical(A))
  assert.equal((await f.cache.load(metadataKey(A))).workspace.spaces[0].id, 'a-space')
})

test('metadata-only polls do not rewrite unchanged native source archives', async t => {
  const f = await fixture(); t.after(() => f.api.dispose())
  await ready(f.api)
  const sourcePaths = () => [...f.files].filter(([path]) => path.startsWith(`cache/${cacheKey(A)}.`))
  const before = sourcePaths()
  await f.api.syncWorkspace(); await f.api.syncWorkspace()
  assert.deepEqual(sourcePaths(), before, 'No source-cache generation or serialized archive changes on metadata-only sync')
  const saved = await f.api.getState()
  saved.workspace.spaces[0].name = 'Renamed Space'
  await f.api.saveWorkspace(saved.workspace, saved.revision)
  await f.api.syncWorkspace()
  assert.deepEqual(sourcePaths(), before, 'Planner organization changes do not rewrite source records')
  const restarted = f.create(); t.after(() => restarted.dispose())
  assert.equal((await restarted.getState()).records[0].id, canonical(A))
})

test('manual arrangements survive Android save, native folder sync and a fresh offline cache restart', async t => {
  const f = await fixture(); t.after(() => f.api.dispose())
  const state = await ready(f.api), boardKey = JSON.stringify(['mapped', '', 'doing'])
  const arrangements = {
    all: {timelineRows: ['unavailable-item', canonical(A)], timelineGroups: ['unavailable-group', 'a-group'], boardCards: {[boardKey]: [canonical(A), 'unavailable-item']}},
    'a-space': {timelineRows: [canonical(A), 'unavailable-item']},
  }
  state.workspace.planner.arrangements = clone(arrangements)
  const saved = await f.api.saveWorkspace(state.workspace, state.revision)
  assert.deepEqual(saved.workspace.planner.arrangements, arrangements)
  assert.equal(saved.storage.syncStatus, 'pending')
  assert.deepEqual((await f.cache.load(metadataKey(A))).workspace.planner.arrangements, arrangements)
  const synced = await f.api.syncWorkspace()
  assert.equal(synced.storage.syncStatus, 'synced')
  assert.deepEqual(f.a.data().planner.arrangements, arrangements)
  const orderingWrites = f.a.writes.filter(({path}) => /\/arrangements\/[a-f0-9]{64}\.json$/.test(path))
  assert.equal(orderingWrites.length, 2, 'Each scope uses its own native folder-protocol document')
  const persisted = await f.cache.load(metadataKey(A))
  assert.equal(persisted.checkpoint.paths.filter(path => path.startsWith('arrangements/')).length, 2)
  const settings = [...f.a.files].find(([path]) => path.endsWith('/settings.json'))[1].document.value.planner
  assert.equal(Object.hasOwn(settings, 'arrangements'), false, 'Orders are excluded from the global settings document')

  const restartedCache = createSlotCache({
    size: async path => f.files.has(path) ? Buffer.byteLength(f.files.get(path)) : null,
    read: async path => f.files.get(path) ?? null,
    write: async (path, text) => { f.files.set(path, text) },
    remove: async path => { f.files.delete(path) },
  })
  f.api.dispose()
  f.a.beforeRead = () => { throw failure('NETWORK') }
  f.a.sourceFailure = 'NETWORK'
  const restarted = f.create(restartedCache); t.after(() => restarted.dispose())
  assert.deepEqual((await restarted.getState()).workspace.planner.arrangements, arrangements, 'Public launch checkpoint keeps the same order')
  await restarted.refresh()
  const restored = await restarted.syncWorkspace()
  assert.equal(restored.metadata.ready, true, 'Durable metadata/checkpoint restoration remains valid without the cloud')
  assert.equal(restored.storage.syncStatus, 'error')
  assert.deepEqual(restored.workspace.planner.arrangements, arrangements, 'Offline restoration retains unavailable IDs and independent scope orders')
})

test('controller acknowledges durable local saves before asynchronous conditional cloud write', async () => {
  const f = await fixture(), state = await ready(f.api), entered = deferred(), gate = deferred()
  state.workspace.categories[0].name = 'Phone edit'
  f.a.beforeWrite = async path => { if (path.endsWith('/organization.json')) { entered.resolve(); await gate.promise } }
  const saved = await f.api.saveWorkspace(state.workspace, state.revision)
  assert.equal(saved.storage.syncStatus, 'pending')
  assert.equal((await f.cache.load(metadataKey(A))).workspace.categories[0].name, 'Phone edit')
  const syncing = f.api.syncWorkspace()
  await entered.promise
  assert.equal(f.a.data().categories[0].name, 'Personal')
  gate.resolve(); await syncing
  assert.equal(f.a.data().categories[0].name, 'Phone edit')
  assert.equal((await f.api.getState()).storage.syncStatus, 'synced')
  assert.equal(f.a.writes.length, 1)
  assert.match(f.a.writes[0].path, /\/organization\.json$/)
})

test('disconnect retains private source cache and unsynced metadata for same-account reselect', async () => {
  const f = await fixture(), state = await ready(f.api)
  f.a.beforeRead = () => { throw failure('NETWORK') }
  state.workspace.spaces[0].name = 'Saved offline'
  await f.api.saveWorkspace(state.workspace, state.revision); await f.api.syncWorkspace()
  const disconnected = await f.api.disconnect()
  assert.equal(disconnected.metadata.ready, false)
  assert.equal(disconnected.workspace.spaces.length, 0)
  assert.equal((await f.cache.load(cacheKey(A))).records[0].id, canonical(A))
  assert.equal((await f.cache.load(metadataKey(A))).workspace.spaces[0].name, 'Saved offline')
  const restored = await f.api.selectAccount()
  assert.equal(restored.metadata.ready, true)
  assert.equal(restored.workspace.spaces[0].name, 'Saved offline')
  assert.equal(restored.storage.syncStatus, 'error')
  await f.api.syncWorkspace() // Join the independent automatic pull before changing the fixture server.
  f.a.beforeRead = null; await f.api.syncWorkspace()
  assert.equal(f.a.data().spaces[0].name, 'Saved offline')
})

test('late prior-account metadata sync cannot overwrite or publish into the selected account', async () => {
  const f = await fixture(), state = await ready(f.api), entered = deferred(), gate = deferred()
  f.a.beforeRead = async path => { if (path === 'manifest.json') { entered.resolve(); await gate.promise } }
  state.workspace.spaces[0].name = 'Old account pending'
  await f.api.saveWorkspace(state.workspace, state.revision)
  const stale = f.api.syncWorkspace()
  await entered.promise
  f.select(B); const selecting = f.api.selectAccount()
  gate.resolve(); await Promise.all([stale, selecting]); await f.api.syncWorkspace()
  const current = await f.api.getState()
  assert.equal(current.connection.username, 'b')
  assert.equal(current.workspace.spaces[0].id, 'b-space')
  assert.equal(current.records[0].id, canonical(B))
  assert.equal(f.a.writes.length, 1); assert.equal(f.b.writes.length, 0)
  assert.equal((await f.cache.load(metadataKey(A))).workspace.spaces[0].name, 'Old account pending')
  assert.equal((await f.cache.load(metadataKey(B))).workspace.spaces[0].name, 'b saved Space')
})

test('local per-scope filters survive restart, stay account-specific and cause no cloud write', async () => {
  const f = await fixture(), state = await ready(f.api)
  const preferences = {scopeId: 'a-space', scopes: {all: {query: 'Overview', showCompleted: true, boardGroupTasks: false}, 'a-space': {listKind: 'tasks', query: 'Phone', boardGroupTasks: true}, 'a-group': {showCompleted: false}}}
  await f.api.saveDeviceState(preferences); await f.api.syncWorkspace()
  assert.equal((await f.api.getState()).revision, state.revision)
  assert.equal(f.a.writes.length, 0)
  const saved = (await f.api.getState()).deviceState
  assert.equal(saved.scopes.all.pages.overview.showCompleted, true); assert.equal(saved.scopes['a-space'].pages.overview.listKind, 'tasks')
  assert.equal(saved.scopes.all.boardGroupTasks, false); assert.equal(saved.scopes['a-space'].boardGroupTasks, true)
  assert.equal(JSON.stringify(f.a.data()).includes('boardGroupTasks'), false, 'Linked-task presentation stays device-local')
  const restarted = f.create(), restored = await restarted.getState()
  assert.deepEqual(restored.deviceState, saved)
  assert.equal(restored.workspace.spaces[0].id, 'a-space')
  f.select(B); const other = await restarted.selectAccount()
  assert.deepEqual(other.deviceState, {})
  f.select(A); const back = await restarted.selectAccount()
  assert.deepEqual(back.deviceState, saved)
  assert.equal(f.a.writes.length, 0); assert.equal(f.b.writes.length, 0)
})

test('same-account SSO authorization retry retains metadata and resumes source and metadata sync', async () => {
  const f = await fixture(), state = await ready(f.api)
  f.a.sourceFailure = 'AUTH'; f.a.beforeRead = () => { throw failure('AUTH') }
  state.workspace.spaces[0].name = 'Retain through reauthorization'
  await f.api.saveWorkspace(state.workspace, state.revision); await f.api.syncWorkspace()
  const denied = await f.api.refresh()
  assert.equal(denied.connection.reconnectRequired, true)
  assert.deepEqual(denied.records, [])
  assert.equal(await f.cache.load(cacheKey(A)), null)
  assert.equal((await f.cache.load(metadataKey(A))).workspace.spaces[0].name, 'Retain through reauthorization')
  f.a.sourceFailure = null; f.a.beforeRead = null
  await f.api.selectAccount(); const authorized = await f.api.syncWorkspace()
  assert.equal(f.nativeCalls.selections, 1)
  assert.equal(authorized.connection.connected, true)
  assert.equal(authorized.workspace.spaces[0].name, 'Retain through reauthorization')
  assert.equal(authorized.records[0].id, canonical(A))
  assert.equal(authorized.storage.syncStatus, 'synced')
  assert.equal(f.a.data().spaces[0].name, 'Retain through reauthorization')
})

test('a stale organization editor cannot overwrite a newer remote revision', async () => {
  const f = await fixture(), stale = await ready(f.api)
  const folder = new FolderWorkspaceClient(f.a), remote = await folder.readWorkspace()
  remote.workspace.categories[0].name = 'Windows update'
  await folder.writeWorkspace(remote.workspace, remote.etag)
  await f.api.syncWorkspace()
  stale.workspace.categories[0].name = 'Stale phone draft'
  await assert.rejects(f.api.saveWorkspace(stale.workspace, stale.revision), {code: 'REVISION_CONFLICT'})
  assert.equal((await f.api.getState()).workspace.categories[0].name, 'Windows update')
  assert.equal(f.a.data().categories[0].name, 'Windows update')
})

test('partial source refresh reconciles fresh and cached IDs once and keeps source counts accurate', async () => {
  const f = await fixture(); await ready(f.api)
  f.a.result.records[0].title = 'Fresh partial result'
  f.a.result.statuses = f.a.result.statuses.map(status => status.source === 'tasks' ? {...status, state: 'error', message: 'Another task list is unavailable.'} : status)
  const state = await f.api.refresh()
  assert.equal(state.records.length, 1)
  assert.equal(state.records[0].id, canonical(A))
  assert.equal(state.records[0].title, 'Fresh partial result')
  assert.equal(state.statuses.find(status => status.source === 'tasks').count, 1)
  assert.equal((await f.cache.load(cacheKey(A))).records.length, 1)
})

test('cancelling the account picker does not abandon same-account metadata sync', async () => {
  const f = await fixture(), state = await ready(f.api), entered = deferred(), gate = deferred()
  f.a.beforeRead = async path => { if (path === 'manifest.json') { entered.resolve(); await gate.promise } }
  state.workspace.spaces[0].name = 'Retained save'
  await f.api.saveWorkspace(state.workspace, state.revision)
  const syncing = f.api.syncWorkspace(); await entered.promise
  f.native.selectAccount = async () => ({account: null})
  const canceled = assert.rejects(f.api.selectAccount(), {code: 'CANCELLED'})
  gate.resolve(); await Promise.all([canceled, syncing])
  assert.equal((await f.api.getState()).connection.username, 'a')
  assert.equal((await f.api.getState()).workspace.spaces[0].name, 'Retained save')
  assert.equal(f.a.data().spaces[0].name, 'Retained save')
})

test('delayed UI saves from the former account are rejected before mutating the new account', async () => {
  const f = await fixture(), former = await ready(f.api)
  const expectedAccount = {serverUrl: A.serverUrl, username: A.username}
  f.select(B); await f.api.selectAccount()
  await f.api.syncWorkspace()
  const before = await f.api.getState(), savedBefore = await f.cache.load(metadataKey(B)), writes = f.b.writes.length
  former.workspace.spaces[0].name = 'Delayed old-account draft'
  await assert.rejects(f.api.saveWorkspace(former.workspace, before.revision, expectedAccount), {code: 'CANCELLED'})
  await assert.rejects(f.api.saveDeviceState({scopeId: 'a-space', scopes: {all: {query: 'Old account search'}}}, expectedAccount), {code: 'CANCELLED'})
  await assert.rejects(f.api.resolveWorkspaceConflict('local', before.revision, expectedAccount), {code: 'CANCELLED'})
  assert.deepEqual(await f.api.getState(), before)
  assert.deepEqual(await f.cache.load(metadataKey(B)), savedBefore)
  assert.equal(f.b.writes.length, writes)
})

test('conflict review publishes only areas, and a cloud change after review requires another choice', async t => {
  const f = await fixture(), saved = await ready(f.api)
  t.after(() => f.api.dispose())
  const folder = new FolderWorkspaceClient(f.a)
  const cloudRename = async name => {
    const base = await folder.readWorkspace()
    base.workspace.spaces[0].name = name
    await folder.writeWorkspace(base.workspace, base.etag)
  }
  saved.workspace.spaces[0].name = 'Device Space name'
  await f.api.saveWorkspace(saved.workspace, saved.revision)
  await cloudRename('Reviewed cloud name')
  const conflict = await f.api.syncWorkspace()
  assert.deepEqual(conflict.plannerConflict, {revision: conflict.revision, paths: ['spaces[a-space].name']})
  assert.deepEqual(conflict.metadata, {ready: true})
  await cloudRename('Newer cloud name')
  const writes = f.a.writes.length
  const selected = await f.api.resolveWorkspaceConflict('local', conflict.plannerConflict.revision, {serverUrl: A.serverUrl, username: A.username})
  assert.equal(selected.workspace.spaces[0].name, 'Device Space name')
  assert.equal(f.a.data().spaces[0].name, 'Newer cloud name')
  assert.equal(f.a.writes.length, writes)
  assert.notEqual(selected.plannerConflict.revision, conflict.plannerConflict.revision)
})

test('metadata is saved immediately while cloud synchronization is debounced by exactly 1200 ms', async () => {
  const timers={callbacks:new Map(), next:0, setTimeout(callback,delay){const id=++this.next;this.callbacks.set(id,{callback,delay});return id},clearTimeout(id){this.callbacks.delete(id)}}
  const f=await fixture({timers}), state=await ready(f.api)
  state.workspace.name='First change'
  const first=await f.api.saveWorkspace(state.workspace,state.revision)
  assert.equal((await f.cache.load(metadataKey(A))).workspace.name,'First change')
  assert.equal(f.a.writes.length,0);assert.equal(timers.callbacks.size,1)
  first.workspace.name='Latest change';await f.api.saveWorkspace(first.workspace,first.revision)
  assert.equal(timers.callbacks.size,1)
  const timer=[...timers.callbacks.values()][0];assert.equal(timer.delay,1200)
  timer.callback();await f.api.syncWorkspace()
  assert.equal(f.a.data().name,'Latest change');assert.equal(f.a.writes.length,1)
  f.api.dispose()
})

test('a checklist link save acknowledges durable metadata before a queued launch write', async t => {
  const timers = {callbacks: new Map(), next: 0, setTimeout(callback, delay) {const id = ++this.next; this.callbacks.set(id, {callback, delay}); return id}, clearTimeout(id) {this.callbacks.delete(id)}}
  const f = await fixture({timers}), initial = await ready(f.api)
  t.after(() => f.api.dispose())
  const held = deferred(), entered = deferred(), write = f.cache.save
  f.cache.save = (key, ...args) => {
    if (key === launchKey(A)) {entered.resolve(); return held.promise.then(() => write(key, ...args))}
    return write(key, ...args)
  }
  t.after(() => held.resolve())
  initial.workspace.relations.push({id: 'checklist-link', type: 'depends_on', fromId: 'fixture-card', toId: canonical(A)})
  const saved = await f.api.saveWorkspace(initial.workspace, initial.revision, {serverUrl: A.serverUrl, username: A.username}, {coalesceLaunch: true})
  assert.equal(saved.workspace.relations.at(-1).id, 'checklist-link')
  assert.equal(f.a.writes.length, 0)
  const launch = [...timers.callbacks.values()].find(timer => timer.delay === 100)
  assert.ok(launch)
  launch.callback()
  await entered.promise
  const reopened = f.create()
  t.after(() => reopened.dispose())
  const restored = await reopened.getState()
  assert.equal(restored.workspace.relations.at(-1).id, 'checklist-link')
  held.resolve()
})

for (const failed of [false, true]) test(`automatic metadata sync publishes one final ${failed ? 'error' : 'successful'} update`, async t => {
  const timers={callbacks:new Map(),next:0,setTimeout(callback,delay){const id=++this.next;this.callbacks.set(id,{callback,delay});return id},clearTimeout(id){this.callbacks.delete(id)}}
  const f=await fixture({timers});t.after(()=>f.api.dispose())
  const state=await ready(f.api)
  state.workspace.spaces[0].name='Latest local organization'
  await f.api.saveWorkspace(state.workspace,state.revision)
  if(failed)f.a.beforeRead=()=>{throw failure('NETWORK')}
  const finished=deferred(),updates=[]
  const unsubscribe=f.api.subscribe(value=>{updates.push(value);finished.resolve()});t.after(unsubscribe)
  const [id,timer]=[...timers.callbacks.entries()][0]
  timers.callbacks.delete(id);timer.callback()
  await finished.promise
  // Drain the promise completion handlers without real timers or network I/O.
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(updates.length,1,'The scheduled sync must not publish its snapshot twice')
  assert.equal(updates[0].workspace.spaces[0].name,'Latest local organization')
  assert.equal(updates[0].records[0].title,'a task')
  assert.equal(updates[0].storage.syncStatus,failed?'error':'synced')
  if(failed)assert.equal(updates[0].storage.errorCode,'NETWORK')
  else assert.equal(f.a.data().spaces[0].name,'Latest local organization')
})


test('planner retry works with authorized saved account even when every native source failed and baseline is not ready', async t => {
  const f = await fixture(); t.after(() => f.api.dispose())
  f.a.sourceFailure = 'NETWORK'
  const failedSources = await f.api.refresh()
  assert.equal(failedSources.connection.connected, false); assert.equal(failedSources.metadata.ready, false)
  assert.ok(failedSources.statuses.every(status => status.state === 'error'))
  const planner = await f.api.syncWorkspace()
  assert.equal(planner.metadata.ready, true); assert.equal(planner.storage.syncStatus, 'synced')
  assert.equal(planner.workspace.spaces[0].name, 'a saved Space')
  assert.equal(planner.connection.connected, false, 'Planner success does not pretend native sources refreshed')
  assert.equal(planner.deviceSync.plannerVerifiedAt, planner.storage.lastSyncedAt)
  const sourceRetry = await f.api.refresh()
  assert.equal(sourceRetry.connection.connected, false)
  assert.equal(sourceRetry.deviceSync.plannerVerifiedAt, planner.storage.lastSyncedAt, 'Native failures do not invalidate an independently verified planner')
  const restarted = f.create(); t.after(() => restarted.dispose())
  assert.equal((await restarted.getState()).deviceSync.plannerVerifiedAt, undefined, 'Saved timestamps are not restored as current session proof')
  assert.equal(f.a.writes.length, 0)
})


test('resolved planner errors record unsuccessful diagnostics and preserve prior verification', async t => {
  const f=await fixture();t.after(()=>f.api.dispose());await ready(f.api)
  const verified=(await f.api.getState()).deviceSync.plannerVerifiedAt
  f.api.startDiagnostics(); f.a.beforeRead=async()=>{throw failure('NETWORK')}
  const result=await f.api.syncWorkspace(); f.api.stopDiagnostics()
  assert.equal(result.storage.syncStatus,'error');assert.equal(result.deviceSync.plannerVerifiedAt,verified)
  const events=JSON.parse(f.api.readDiagnostics()).events.filter(event=>event.kind==='planner'&&event.durationMs!==undefined)
  assert.equal(events.length,1);assert.equal(events[0].success,false);assert.equal(events[0].code,'NETWORK');assert.equal(events[0].stage,'error')
})
