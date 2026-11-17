import test from 'node:test'
import assert from 'node:assert/strict'
import {createMetadataStore} from '../src/metadata.mjs'
import {createSlotCache} from '../src/cache.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {FolderWorkspaceClient, assembleWorkspace, sharedFolderHash} from '@nextspace/nextcloud-client/planner-folder.mjs'

const clone = value => structuredClone(value)
const KEY = 'a'.repeat(64), OTHER_KEY = 'b'.repeat(64)
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return {promise, resolve} }
const org = workspace => ({spaces: workspace.spaces, categories: workspace.categories, projects: workspace.projects})
function workspace() {
  const result = createPlannerWorkspace()
  result.spaces = [{id: 'life', name: 'Daily life', color: '#1166aa', collectionIds: ['deck', 'calendar'], defaultCalendarId: 'calendar'}, {id: 'work', name: 'Client work', color: '#226644', collectionIds: ['deck']}]
  result.categories = [{id: 'personal', spaceId: 'life', name: 'Personal', color: '#778899', collectionIds: ['deck']}, {id: 'home', spaceId: 'work', name: 'Home', color: '#554433', collectionIds: ['deck']}]
  result.projects = [{id: 'project', spaceId: 'life', categoryId: 'personal', name: 'Website', collectionIds: [], recordIds: ['unavailable-record']}]
  result.relations = [{id: 'link', type: 'reference', fromId: 'unavailable-record', toId: 'note'}]
  result.properties.item = {estimate: 90}
  return result
}
function disk() {
  const files = new Map()
  const io = {size: async path => files.has(path) ? Buffer.byteLength(files.get(path)) : null, read: async path => files.get(path) ?? null, write: async (path, text) => { files.set(path, text) }, remove: async path => { files.delete(path) }}
  return {files, io, cache: () => createSlotCache(io)}
}
function cloud(legacy = null) {
  const files = new Map(), writes = []
  let version = 0
  const api = {
    files, writes, beforeWrite: null, beforeRead: null,
    readWorkspace: async () => ({workspace: clone(legacy), etag: legacy ? '"legacy"' : null}),
    listPlannerFiles: async directory => {
      const prefix = `${directory}/`, entries = new Map()
      for (const [path, value] of files) if(path.startsWith(prefix)) {
        const relative = path.slice(prefix.length), slash = relative.indexOf('/')
        if(slash < 0) entries.set(path,{path,etag:value.etag})
        else {const child=prefix+relative.slice(0,slash);entries.set(child,{path:child,collection:true})}
      }
      return {exists:true,files:[...entries.values()]}
    },
    readPlannerFile: async path => { if (api.beforeRead) await api.beforeRead(path); return clone(files.get(path) || {document: null, etag: null}) },
    writePlannerFile: async (path, document, etag) => {
      if (api.beforeWrite) await api.beforeWrite(path, clone(document))
      if (etag !== (files.get(path)?.etag || null)) throw Object.assign(new Error('Conditional conflict'), {code: 'CONFLICT', status: 412})
      const saved = {document: clone(document), etag: `"v${++version}"`}
      files.set(path, saved); writes.push({path, document: clone(document), etag}); return {etag: saved.etag}
    },
    mutate: (path, update) => { const saved = files.get(path); files.set(path, {document: update(clone(saved.document)), etag: `"v${++version}"`}) },
    manifest: () => files.get('manifest.json')?.document,
    data: () => { const marker = api.manifest(), prefix = `${marker.generation}/`; return assembleWorkspace(new Map([...files].filter(([path]) => path.startsWith(prefix) && !/\/legacy-(?:import|original)\.json$/.test(path)).map(([path, data]) => [path.slice(prefix.length), data.document]))) },
  }
  return api
}
async function seed(remote, value = workspace()) { const folder = new FolderWorkspaceClient(remote), read = await folder.readWorkspace(); await folder.writeWorkspace(value, read.etag); return remote }
async function mobile(remote, storage = disk(), key = KEY, options = {}) { const store = createMetadataStore({cache: storage.cache(), key, client: remote, ...options}); await store.load(); return {store, storage} }
async function edit(store, callback) { const current = store.getState(); callback(current.workspace); return store.saveWorkspace(current.workspace, current.revision) }
test('fresh Android reads populated organization before edits and performs no initialization writes', async () => {
  const remote = await seed(cloud()), {store} = await mobile(remote), count = remote.writes.length
  assert.equal(store.getState().metadata.ready, false)
  await assert.rejects(edit(store, value => { value.spaces = [] }), {code: 'METADATA_NOT_READY'})
  await store.sync()
  assert.equal(store.getState().metadata.ready, true)
  assert.deepEqual(org(store.getState().workspace), org(workspace()))
  assert.equal(remote.writes.length, count)
})

test('planner diagnostics preserve failure category and stage without exposing bridge details', async () => {
  const remote = await seed(cloud()), {store, storage} = await mobile(remote)
  await store.sync()
  const lastSuccess = store.getState().storage.lastSyncedAt
  for (const code of ['NETWORK', 'AUTH', 'PERMISSION', 'LIMIT', 'ETAG_UNAVAILABLE', 'UNKNOWN_PRIVATE']) {
    remote.beforeRead = () => { throw Object.assign(new Error('Private bridge payload and token'), {code}) }
    const failed = await store.sync()
    assert.equal(failed.storage.errorCode, code === 'UNKNOWN_PRIVATE' ? undefined : code)
    assert.equal(failed.storage.errorStage, 'planner-read')
    assert.equal(failed.storage.lastSyncedAt, lastSuccess)
    assert.doesNotMatch(failed.storage.message, /Private bridge|token/)
    const restarted = (await mobile(remote, storage)).store
    assert.equal(restarted.getState().storage.errorCode, failed.storage.errorCode)
  }
  remote.beforeRead = null
  const success = await store.sync()
  assert.equal(success.storage.errorCode, undefined); assert.equal(success.storage.errorStage, undefined)
  await edit(store, value => { value.name = 'Pending write' })
  remote.beforeWrite = () => { throw Object.assign(new Error('Private'), {code: 'PERMISSION'}) }
  const denied = await store.sync()
  assert.equal(denied.storage.errorCode, 'PERMISSION'); assert.equal(denied.storage.errorStage, 'planner-write')
  assert.equal(denied.workspace.name, 'Pending write')
})

test('background cancellation does not persist a false planner failure', async () => {
  const remote = await seed(cloud()), {store} = await mobile(remote)
  await store.sync()
  const before = store.getState()
  remote.beforeRead = () => { throw Object.assign(new Error('Host stopped'), {code: 'CANCELLED'}) }
  await assert.rejects(store.sync(), {code: 'CANCELLED'})
  assert.deepEqual(store.getState(), before)
})

test('metadata timestamps and canonical identities use injected effects with no UI dependency', async () => {
  const remote=await seed(cloud()), storage=disk(), timestamp=Date.parse('2026-11-11T10:00:00.123Z'), fixedId='44444444-4444-4444-8444-444444444444'
  const store=createMetadataStore({cache:storage.cache(),key:KEY,client:remote,now:()=>timestamp,makeId:()=>fixedId})
  await store.load();await store.sync()
  await store.reconcileRecords([{id:'new-source-row',source:'tasks',kind:'task',title:'New',identity:{source:'tasks',key:'canonical-new'}}])
  assert.equal(store.getState().workspace.identities.at(-1).id,fixedId)
  const current=store.getState();current.workspace.name='Clock-controlled save'
  await store.saveWorkspace(current.workspace,current.revision)
  assert.equal(store.getState().workspace.updatedAt,'2026-11-11T10:00:00.123Z')
  assert.equal(store.getState().storage.lastSyncedAt,'2026-11-11T10:00:00.123Z')
})

test('empty account and populated legacy reads establish baselines without writes', async () => {
  for (const legacy of [null, workspace()]) {
    const remote = cloud(legacy), {store, storage} = await mobile(remote)
    await store.sync()
    assert.equal(store.getState().metadata.ready, true)
    assert.equal(remote.writes.length, 0)
    const restart = await mobile(remote, storage)
    assert.equal(restart.store.getState().metadata.ready, true)
    await edit(restart.store, value => { value.name = 'Accepted edit' })
    await restart.store.sync()
    assert.equal(remote.data().name, 'Accepted edit')
    if (legacy) assert.deepEqual(org(remote.data()), org(legacy))
  }
})

test('independent offline organization edits merge across devices', async () => {
  const remote = await seed(cloud()), first = (await mobile(remote)).store, second = (await mobile(remote, disk(), OTHER_KEY)).store
  await first.sync(); await second.sync()
  await edit(first, value => { value.spaces[0].name = 'Life revised' })
  await edit(second, value => { value.categories[1].color = '#abcdef' })
  await first.sync(); await second.sync(); await first.sync()
  assert.equal(first.getState().workspace.spaces[0].name, 'Life revised')
  assert.equal(first.getState().workspace.categories[1].color, '#abcdef')
  assert.equal(sharedFolderHash(first.getState().workspace), sharedFolderHash(second.getState().workspace))
})

test('same-field conflicts preserve baseline, local and remote copies through restart and explicit review', async () => {
  const remote = await seed(cloud()), first = (await mobile(remote)).store, other = await mobile(remote, disk(), OTHER_KEY)
  await first.sync(); await other.store.sync()
  await edit(first, value => { value.spaces[0].name = 'Cloud name' })
  await edit(other.store, value => { value.spaces[0].name = 'Phone name'; value.properties.phone = {keep: true} })
  await first.sync(); const count = remote.writes.length; await other.store.sync()
  const conflict = other.store.getState().metadata.conflict
  assert.equal(conflict.base.spaces[0].name, 'Daily life'); assert.equal(conflict.local.spaces[0].name, 'Phone name'); assert.equal(conflict.remote.spaces[0].name, 'Cloud name')
  assert.equal(remote.writes.length, count)
  const restarted = (await mobile(remote, other.storage, OTHER_KEY)).store
  assert.deepEqual(restarted.getState().metadata.conflict, conflict)
  const diskSnapshots = [...other.storage.files.values()].map(text => JSON.parse(text).value).filter(value => value.conflict)
  assert.ok(diskSnapshots.length)
  for (const saved of diskSnapshots) {
    assert.equal(Object.hasOwn(saved.conflict, 'base'), false)
    assert.equal(Object.hasOwn(saved.conflict, 'local'), false)
  }
  await assert.rejects(restarted.resolveConflict('local', restarted.getState().revision - 1), {code: 'REVISION_CONFLICT'})
  await restarted.resolveConflict('remote', restarted.getState().revision)
  await restarted.sync()
  assert.equal(remote.data().spaces[0].name, 'Cloud name')
  assert.deepEqual(remote.data().properties.phone, {keep: true}, 'Independent local metadata survives the organization choice')
})

test('concurrent source assignments become a visible conflict instead of invalid merged ownership', async () => {
  const remote = await seed(cloud()), a = (await mobile(remote)).store, b = (await mobile(remote, disk(), OTHER_KEY)).store
  await a.sync(); await b.sync()
  await edit(a, value => { value.categories[0].collectionIds.push('calendar') })
  await edit(b, value => { value.categories.push({id: 'new-group', spaceId: 'life', name: 'New group', color: '#112233', collectionIds: ['calendar']}) })
  await a.sync(); const count = remote.writes.length; await b.sync()
  assert.equal(b.getState().storage.syncStatus, 'conflict'); assert.equal(remote.writes.length, count)
  await b.resolveConflict('local', b.getState().revision); await b.sync()
  assert.equal(remote.data().categories.find(group => group.id === 'new-group').collectionIds[0], 'calendar')
  assert.deepEqual(remote.data().categories.find(group => group.id === 'personal').collectionIds, ['deck'])
})

test('delete versus edit is preserved for explicit conflict review', async () => {
  const remote = await seed(cloud()), a = (await mobile(remote)).store, b = (await mobile(remote, disk(), OTHER_KEY)).store
  await a.sync(); await b.sync()
  await edit(a, value => { value.categories = value.categories.filter(group => group.id !== 'personal'); delete value.projects[0].categoryId })
  await edit(b, value => { value.categories[0].name = 'Renamed on phone' })
  await a.sync(); await b.sync()
  assert.equal(b.getState().storage.syncStatus, 'conflict')
  assert.equal(b.getState().metadata.conflict.local.categories[0].name, 'Renamed on phone')
  assert.equal(b.getState().metadata.conflict.remote.categories.some(group => group.id === 'personal'), false)
})

test('edits made while a sync is in flight stay durable and pending', async () => {
  const remote = await seed(cloud()), {store, storage} = await mobile(remote); await store.sync()
  await edit(store, value => { value.spaces[0].name = 'First save' })
  const gate = deferred(), entered = deferred()
  remote.beforeWrite = async path => { if (path.endsWith('/organization.json')) { entered.resolve(); await gate.promise } }
  const sync = store.sync(); await entered.promise
  await edit(store, value => { value.categories[0].name = 'Saved during sync' })
  gate.resolve(); await sync; remote.beforeWrite = null
  assert.equal(store.getState().storage.syncStatus, 'pending')
  assert.equal(store.getState().workspace.categories[0].name, 'Saved during sync')
  assert.equal(remote.data().categories[0].name, 'Personal')
  const restarted = (await mobile(remote, storage)).store; await restarted.sync()
  assert.equal(remote.data().categories[0].name, 'Saved during sync')
})

test('conditional write races retry the new remote version and retain independent edits', async () => {
  const remote = await seed(cloud()), {store} = await mobile(remote); await store.sync()
  await edit(store, value => { value.spaces[0].name = 'Phone' })
  let changed = false
  remote.beforeWrite = path => { if (!changed && path.endsWith('/organization.json')) { changed = true; remote.mutate(path, document => { document.value.categories[1].name = 'Other PC'; return document }) } }
  await store.sync()
  assert.equal(store.getState().storage.syncStatus, 'synced')
  assert.equal(remote.data().spaces[0].name, 'Phone'); assert.equal(remote.data().categories[1].name, 'Other PC')
})

test('local filters stay per account and never publish organization or settings', async () => {
  const remote = await seed(cloud()), {store, storage} = await mobile(remote); await store.sync()
  const count = remote.writes.length, revision = store.getState().revision
  const deviceState = {scopeId: 'life', scopes: {all: {query: 'overview'}, life: {query: 'phone', showCompleted: true}, work: {listKind: 'deck'}}}
  await store.saveDeviceState(deviceState); await store.sync()
  assert.equal(store.getState().revision, revision); assert.equal(remote.writes.length, count)
  const saved = store.getState().deviceState
  assert.equal(saved.scopes.life.pages.overview.showCompleted, true); assert.equal(saved.scopes.work.pages.overview.listKind, 'deck')
  const restarted = await mobile(remote, storage); assert.deepEqual(restarted.store.getState().deviceState, saved)
  const other = await mobile(remote, storage, OTHER_KEY); assert.deepEqual(other.store.getState().deviceState, {})
})

test('versioned page filters remain independent after real slot restart and never enter cloud files',async()=>{
  const remote=await seed(cloud()),{store,storage}=await mobile(remote);await store.sync()
  const writes=remote.writes.length,revision=store.getState().revision
  await store.saveDeviceState({scopeId:'life',scopePreferencesVersion:2,scopes:{life:{view:'board',pages:{
    board:{query:'board-only',assignment:'all',showCompleted:true,statusIds:['column-one'],hiddenCollectionIds:['hidden-board']},
    calendar:{query:'calendar-only',assignment:'me',showCompleted:false,hiddenCollectionIds:['hidden-calendar']},
  },boardGroupTasks:true,calendarMode:'month'}}})
  const saved=store.getState().deviceState
  assert.equal(saved.scopePreferencesVersion,2);assert.equal(saved.scopes.life.pages.board.query,'board-only')
  assert.equal(saved.scopes.life.pages.calendar.query,'calendar-only');assert.equal(saved.scopes.life.pages.calendar.showCompleted,false)
  assert.deepEqual(saved.scopes.life.pages.board.hiddenCollectionIds,['hidden-board'])
  assert.deepEqual(saved.scopes.life.pages.calendar.hiddenCollectionIds,['hidden-calendar'])
  assert.equal(saved.scopes.life.boardGroupTasks,true);assert.equal(saved.scopes.life.calendarMode,'month')
  await store.sync();assert.equal(remote.writes.length,writes);assert.equal(store.getState().revision,revision)
  const restarted=await mobile(remote,storage);assert.deepEqual(restarted.store.getState().deviceState,saved)
  const other=await mobile(remote,storage,OTHER_KEY);assert.deepEqual(other.store.getState().deviceState,{})
  for(const document of remote.files.values())assert.ok(!JSON.stringify(document).includes('board-only'))
})

test('failed local persistence cannot acknowledge or publish an unsaved edit', async () => {
  const remote = await seed(cloud()), {store, storage} = await mobile(remote); await store.sync()
  const before = store.getState(), count = remote.writes.length
  storage.io.write = async () => { throw Error('Disk full') }
  await assert.rejects(edit(store, value => { value.spaces[0].name = 'Unsaved' }))
  assert.deepEqual(store.getState(), before); assert.equal(remote.writes.length, count)
})

test('missing manifest never reinitializes an existing planner', async () => {
  const remote = await seed(cloud()), {store} = await mobile(remote); await store.sync()
  await edit(store, value => { value.spaces[0].name = 'Keep local' })
  remote.files.delete('manifest.json'); const count = remote.writes.length
  await store.sync()
  assert.equal(store.getState().storage.syncStatus, 'conflict'); assert.equal(remote.writes.length, count)
  assert.equal(store.getState().workspace.spaces[0].name, 'Keep local')
})

test('inactive accounts cannot continue queued metadata writes', async () => {
  const remote = await seed(cloud()), gate = deferred(), entered = deferred()
  let active = true
  const {store} = await mobile(remote, disk(), KEY, {isActive: () => active}); await store.sync()
  await edit(store, value => { value.spaces[0].name = 'Do not publish' })
  remote.beforeRead = async path => { if (path === 'manifest.json') { entered.resolve(); await gate.promise } }
  const count = remote.writes.length, sync = store.sync(); await entered.promise
  active = false; gate.resolve(); await assert.rejects(sync, {code: 'CANCELLED'})
  assert.equal(remote.writes.length, count)
})

test('source identities reconcile to existing shared UUIDs and preserve unavailable references', async () => {
  const source = workspace(); source.identities = [{id: 'shared-id', source: 'tasks', key: 'server/task', aliases: ['old-id']}]
  const remote = await seed(cloud(), source), {store, storage} = await mobile(remote); await store.sync()
  const records = [{id: 'connector-id', source: 'tasks', kind: 'task', title: 'Native task', identity: {source: 'tasks', key: 'server/task'}}]
  const resolved = await store.reconcileRecords(records)
  assert.equal(resolved.records[0].id, 'shared-id')
  assert.equal(resolved.remap.get('connector-id'), 'shared-id')
  assert.equal(resolved.workspace.projects[0].recordIds[0], 'unavailable-record')
  const restarted = await mobile(remote, storage)
  assert.equal(restarted.store.getState().workspace.identities[0].id, 'shared-id')
  const snapshot = store.getState(); snapshot.workspace.identities = []
  await store.saveWorkspace(snapshot.workspace, snapshot.revision)
  assert.equal(store.getState().workspace.identities[0].id, 'shared-id')
})

test('either conflict choice preserves remote canonical UUIDs in curated project items', async () => {
  for (const choice of ['local', 'remote']) {
    const remote = await seed(cloud()), a = (await mobile(remote)).store, b = (await mobile(remote, disk(), OTHER_KEY)).store
    await a.sync(); await b.sync()
    const records = [{id: 'connector-id', source: 'tasks', kind: 'task', title: 'Native task', identity: {source: 'tasks', key: 'same-native-task'}}]
    const first = await a.reconcileRecords(records), second = await b.reconcileRecords(records)
    const canonical = first.records[0].id
    assert.notEqual(canonical, second.records[0].id)
    await edit(a, value => { value.spaces[0].name = 'Windows'; value.projects[0].recordIds = [canonical] })
    await edit(b, value => { value.spaces[0].name = 'Android'; value.projects[0].recordIds = [second.records[0].id] })
    await a.sync(); await b.sync()
    assert.equal(b.getState().storage.syncStatus, 'conflict')
    await b.resolveConflict(choice, b.getState().revision); await b.sync()
    assert.equal(b.getState().workspace.identities.find(item => item.key === 'same-native-task').id, canonical)
    assert.deepEqual(b.getState().workspace.projects[0].recordIds, [canonical])
    assert.deepEqual(remote.data().projects[0].recordIds, [canonical])
  }
})

test('concurrent same-name groups need review while legacy duplicates remain readable', async () => {
  const remote = await seed(cloud()), a = (await mobile(remote)).store, b = (await mobile(remote, disk(), OTHER_KEY)).store
  await a.sync(); await b.sync()
  await edit(a, value => { value.categories.push({id: 'new-a', spaceId: 'life', name: 'Learning', color: '#112233', collectionIds: []}) })
  await edit(b, value => { value.categories.push({id: 'new-b', spaceId: 'life', name: ' learning ', color: '#223344', collectionIds: []}) })
  await a.sync(); await b.sync()
  assert.equal(b.getState().storage.syncStatus, 'conflict')
  assert.ok(b.getState().metadata.conflict.paths.includes('categories.names'))
  const old = workspace(); old.categories.push({...old.categories[0], id: 'legacy-duplicate', collectionIds: []})
  const legacy = (await mobile(await seed(cloud(), old))).store
  await legacy.sync(); await legacy.sync()
  assert.equal(legacy.getState().storage.syncStatus, 'synced')
  assert.equal(legacy.getState().workspace.categories.length, 3)
})

test('source deselection versus a new project assignment cannot silently reintroduce the source', async () => {
  const remote = await seed(cloud()), a = (await mobile(remote)).store, b = (await mobile(remote, disk(), OTHER_KEY)).store
  await a.sync(); await b.sync()
  await edit(a, value => { value.spaces[0].collectionIds = ['deck']; delete value.spaces[0].defaultCalendarId })
  await edit(b, value => { value.projects[0].collectionIds.push('calendar') })
  await a.sync(); await b.sync()
  assert.equal(b.getState().storage.syncStatus, 'conflict')
  assert.ok(b.getState().metadata.conflict.paths.includes('spaces[life].collectionIds'))
})

test('failed remote read retains the offline organization and durable pending changes', async () => {
  const remote = await seed(cloud()), {store, storage} = await mobile(remote); await store.sync()
  await edit(store, value => { value.spaces[0].name = 'Offline edit' })
  remote.beforeRead = () => { throw new Error('Offline') }
  await store.sync()
  assert.equal(store.getState().storage.syncStatus, 'error')
  const restarted = (await mobile(remote, storage)).store
  assert.equal(restarted.getState().metadata.ready, true)
  assert.equal(restarted.getState().workspace.spaces[0].name, 'Offline edit')
  remote.beforeRead = null; await restarted.sync()
  assert.equal(remote.data().spaces[0].name, 'Offline edit')
})

test('in-flight overlapping edits retain the actual merge baseline through restart', async () => {
  const remote = await seed(cloud()), {store, storage} = await mobile(remote); await store.sync()
  await edit(store, value => { value.properties.phone = {keep: true} })
  const gate = deferred(), entered = deferred()
  const path = `${remote.manifest().generation}/organization.json`
  remote.mutate(path, document => { document.value.spaces[0].name = 'Incoming'; return document })
  remote.beforeRead = async path => { if (path === 'manifest.json') { entered.resolve(); await gate.promise } }
  const sync = store.sync(); await entered.promise
  await edit(store, value => { value.spaces[0].name = 'During sync' })
  gate.resolve(); await sync; remote.beforeRead = null
  assert.equal(store.getState().storage.syncStatus, 'conflict')
  const before = store.getState().metadata.conflict
  assert.deepEqual(before.base.properties.phone, {keep: true})
  const restarted = (await mobile(remote, storage)).store
  assert.deepEqual(restarted.getState().metadata.conflict, before)
  await restarted.resolveConflict('local', restarted.getState().revision); await restarted.sync()
  assert.equal(remote.data().spaces[0].name, 'During sync')
  assert.deepEqual(remote.data().properties.phone, {keep: true})
})


test('cancelled planner pass cannot continue native writes or adopt a late cloud read; retry is independent', async () => {
  const remote = await seed(cloud()), {store} = await mobile(remote)
  await store.sync(); await edit(store, value => {value.spaces[0].name = 'Pending before timeout'})
  const before = store.getState(), blocked = deferred(), entered = deferred()
  let current = true, stop
  const stopped = new Promise((_, reject) => {stop = reject})
  remote.beforeRead = async path => {if (path === 'manifest.json') {entered.resolve(); await blocked.promise}}
  const syncing = store.sync({isCurrent: () => current, stopped})
  await entered.promise
  const writeCount = remote.writes.length
  current = false; store.cancelSync(); stop(Object.assign(new Error('Elapsed deadline'), {code: 'TIMEOUT'}))
  await assert.rejects(syncing, {code: 'TIMEOUT'})
  assert.deepEqual(store.getState(), before)
  blocked.resolve(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(remote.writes.length, writeCount)
  assert.deepEqual(store.getState(), before)
  remote.beforeRead = null
  await store.sync(); assert.equal(remote.data().spaces[0].name, 'Pending before timeout')
})

test('timed-out local sync commit never adopts late state or replaces a newer local edit', async () => {
  const remote = await seed(cloud()), storage = disk(), {store} = await mobile(remote, storage)
  await store.sync()
  const previous = store.getState(), entered = deferred(), blocked = deferred()
  const write = storage.io.write; let first = true, stop, current = true
  storage.io.write = async (...args) => {if (first) {first = false; entered.resolve(); await blocked.promise} return write(...args)}
  const stopped = new Promise((_, reject) => {stop = reject})
  const syncing = store.sync({isCurrent: () => current, stopped})
  await entered.promise
  current = false; store.cancelSync(); stop(Object.assign(new Error('Local persistence timeout'), {code: 'TIMEOUT'}))
  await assert.rejects(syncing, {code: 'TIMEOUT'})
  assert.deepEqual(store.getState(), previous)
  const editing = edit(store, value => {value.spaces[0].name = 'Newer local draft'})
  blocked.resolve(); await editing
  const restarted = await mobile(remote, storage)
  assert.equal(restarted.store.getState().workspace.spaces[0].name, 'Newer local draft')
  assert.equal(restarted.store.getState().storage.syncStatus, 'pending')
})


test('timeout during a native cache write preserves the previous durable sync state on restart', async () => {
  const remote = await seed(cloud()), storage = disk(), {store} = await mobile(remote, storage)
  await store.sync(); await edit(store, value => {value.spaces[0].name = 'Saved pending change'})
  const before = store.getState(), entered = deferred(), blocked = deferred(), write = storage.io.write
  let current = true, stop
  storage.io.write = async (...args) => {entered.resolve(); await blocked.promise; return write(...args)}
  const stopped = new Promise((_, reject) => {stop = reject})
  const syncing = store.sync({isCurrent: () => current, stopped})
  await entered.promise; current = false; store.cancelSync(); stop(Object.assign(new Error('Elapsed'), {code: 'TIMEOUT'}))
  await assert.rejects(syncing, {code: 'TIMEOUT'})
  blocked.resolve(); await new Promise(resolve => setImmediate(resolve))
  const restarted = await mobile(remote, storage)
  assert.deepEqual(restarted.store.getState(), {...before, deviceState: {scopeId: 'all', scopePreferencesVersion: 2, scopes: {}}})
})


test('a failed local metadata load can be retried without clearing files or requiring native source success', async () => {
  const remote = await seed(cloud()), storage = disk(), cache = storage.cache(), load = cache.load
  let attempts = 0
  cache.load = (...args) => {if (++attempts === 1) throw Object.assign(new Error('Temporary local read failure'), {code: 'CACHE_UNREADABLE'}); return load(...args)}
  const store = createMetadataStore({cache, key: KEY, client: remote})
  await assert.rejects(store.load(), {code: 'CACHE_UNREADABLE', syncStage: 'local-cache'})
  const count = remote.writes.length
  const restored = await store.sync()
  assert.equal(restored.metadata.ready, true); assert.deepEqual(restored.workspace.spaces, workspace().spaces)
  assert.equal(remote.writes.length, count, 'Retry only establishes the real remote baseline')
})


test('isolated planner passes retain the verified ETag document cache instead of redownloading every file', async () => {
  const remote = await seed(cloud()), original = remote.readPlannerFile, reads = []
  remote.readPlannerFile = async path => {reads.push(path); return original(path)}
  const {store} = await mobile(remote)
  await store.sync(); assert.ok(reads.some(path => path.endsWith('/organization.json')))
  reads.length = 0; await store.sync()
  assert.equal(reads.filter(path => path.endsWith('/organization.json')).length, 0)
  const path = [...remote.files.keys()].find(path => path.endsWith('/organization.json'))
  remote.mutate(path, document => {document.value.spaces[0].name = 'Updated elsewhere'; return document})
  await store.sync()
  assert.equal(reads.filter(path => path.endsWith('/organization.json')).length, 1)
  assert.equal(store.getState().workspace.spaces[0].name, 'Updated elsewhere')
})
