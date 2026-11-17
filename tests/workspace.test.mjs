import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, copyFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceStore, accountScope, atomicWriteJson, validateWorkspace, normalizeTheme } from '@nextspace/nextcloud-node/workspace.mjs'
import security from '../win/electron/security.cjs'
import { createPlannerWorkspace } from '@nextspace/core/planner.mjs'
import { reconcileIdentities } from '@nextspace/core/identity.mjs'
import { normalizeTheme as normalizePortableTheme } from '@nextspace/core/theme-cache.mjs'

const workspace = (title = 'Today') => ({ ...createPlannerWorkspace(), name: title, updatedAt: '2026-09-29T08:00:00.000Z' })
const initialState = () => ({ workspace: workspace(), records: [], collections: [], statuses: [] })
const scope = accountScope('https://cloud.example.com', 'alex')
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nextspace-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
async function live(t) { return WorkspaceStore.open({ dataDir: await temporary(t), scope, initialState: initialState() }) }
function fakeRemote(initial = null) {
  let current = initial ? structuredClone(initial) : null
  let version = current ? 1 : 0
  const writes = []
  return {
    writes,
    readWorkspace: async () => ({ workspace: structuredClone(current), etag: current ? `"v${version}"` : null }),
    writeWorkspace: async (value, etag) => {
      const expected = current ? `"v${version}"` : null
      if (etag !== expected) throw Object.assign(new Error('Changed remotely'), { code: 'CONFLICT' })
      writes.push({ value: structuredClone(value), etag })
      current = structuredClone(value); version++
      return { etag: `"v${version}"` }
    },
    mutate: value => { current = structuredClone(value); version++ },
    current: () => structuredClone(current),
  }
}

test('demo and different server/account workspaces persist in isolated directories', async t => {
  const dataDir = await temporary(t)
  const demo = await WorkspaceStore.open({ dataDir, scope: 'demo', initialState: initialState() })
  const account = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  const otherAccount = await WorkspaceStore.open({ dataDir, scope: accountScope('https://cloud.example.com', 'bea'), initialState: initialState() })
  const otherServer = await WorkspaceStore.open({ dataDir, scope: accountScope('https://other.example.com', 'alex'), initialState: initialState() })
  await demo.saveWorkspace(workspace('Personal demo'), 0)
  await account.saveWorkspace(workspace('Live private workspace'), 0)
  await account.updateCache({ records: [{ id: 'private-note', source: 'notes', title: 'Account-only data', optional: undefined }], collections: [], statuses: [] })
  assert.equal(demo.snapshot().cache.records.length, 0)
  assert.equal(otherAccount.snapshot().workspace.name, 'Today')
  assert.equal(otherServer.snapshot().workspace.name, 'Today')
  const reopened = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  assert.equal(reopened.snapshot().workspace.name, 'Live private workspace')
  assert.equal(reopened.snapshot().cache.records[0].title, 'Account-only data')
  assert.equal(reopened.snapshot().revision, 2, 'The identity registry update advances the metadata revision')
  assert.notEqual(demo.path, account.path)
  assert.equal(accountScope('https://cloud.example.com/', 'alex'), scope)
  await assert.rejects(() => WorkspaceStore.open({ dataDir, scope: '../escape', initialState: initialState() }), /scope/)
})

test('stale and concurrently stale revisions cannot overwrite a newer workspace', async t => {
  const store = await live(t)
  const results = await Promise.allSettled([store.saveWorkspace(workspace('First'), 0), store.saveWorkspace(workspace('Stale second'), 0)])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.equal(results[1].reason.code, 'REVISION_CONFLICT')
  assert.equal(store.snapshot().workspace.name, 'First')
  const persisted = JSON.parse(await readFile(store.path, 'utf8'))
  assert.equal(persisted.revision, 1)
  assert.equal(persisted.workspace.name, 'First')
})

test('atomic writes retain a complete previous backup and clean temporary files', async t => {
  const dataDir = await temporary(t)
  const file = join(dataDir, 'example.json')
  await atomicWriteJson(file, { revision: 1, text: 'Original' })
  await atomicWriteJson(file, { revision: 2, text: 'New' })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, 2)
  assert.equal(JSON.parse(await readFile(`${file}.bak`, 'utf8')).revision, 1)
  assert.deepEqual((await readdir(dataDir)).sort(), ['example.json', 'example.json.bak'])
})

test('atomic writes recover from transient Windows copy and replacement locks without deleting the target', async t => {
  const dataDir = await temporary(t), file = join(dataDir, 'example.json')
  await atomicWriteJson(file, { revision: 1 })
  const attempts = { copy: 0, backup: 0, current: 0 }
  const assertCurrentIntact = async () => assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, 1)
  await atomicWriteJson(file, { revision: 2 }, { fileOperations: {
    copyFile: async (...args) => {
      await assertCurrentIntact()
      if (++attempts.copy <= 2) throw Object.assign(new Error('Indexer holds source'), { code: 'EACCES' })
      return copyFile(...args)
    },
    rename: async (source, target) => {
      await assertCurrentIntact()
      const operation = target === file ? 'current' : 'backup'
      if (++attempts[operation] <= 2) throw Object.assign(new Error('Scanner holds replacement'), { code: operation === 'current' ? 'EPERM' : 'EBUSY' })
      return rename(source, target)
    },
  } })
  assert.deepEqual(attempts, { copy: 3, backup: 3, current: 3 })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, 2)
  assert.equal(JSON.parse(await readFile(`${file}.bak`, 'utf8')).revision, 1)
  assert.deepEqual((await readdir(dataDir)).sort(), ['example.json', 'example.json.bak'])
})

for (const failingOperation of ['copy', 'backup', 'current']) {
  test(`atomic writes bound permanent ${failingOperation} lock retries and preserve saved data`, async t => {
    const dataDir = await temporary(t), file = join(dataDir, 'example.json')
    await atomicWriteJson(file, { revision: 1 })
    await atomicWriteJson(file, { revision: 2 })
    let attempts = 0
    const locked = () => { attempts++; throw Object.assign(new Error('Still locked'), { code: 'EPERM' }) }
    await assert.rejects(() => atomicWriteJson(file, { revision: 3 }, { fileOperations: {
      copyFile: (...args) => failingOperation === 'copy' ? locked() : copyFile(...args),
      rename: (source, target) => (target === file ? 'current' : 'backup') === failingOperation ? locked() : rename(source, target),
    } }), { code: 'EPERM' })
    assert.equal(attempts, 5, 'Replacement retries have a fixed upper bound')
    assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, 2)
    assert.equal(JSON.parse(await readFile(`${file}.bak`, 'utf8')).revision, failingOperation === 'current' ? 2 : 1)
    assert.deepEqual((await readdir(dataDir)).sort(), ['example.json', 'example.json.bak'])
  })
}

test('atomic writes do not retry non-lock errors or disturb the previous saved file', async t => {
  const dataDir = await temporary(t), file = join(dataDir, 'example.json')
  await atomicWriteJson(file, { revision: 1 })
  let attempts = 0
  await assert.rejects(() => atomicWriteJson(file, { revision: 2 }, { fileOperations: {
    copyFile: async () => { attempts++; throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }) },
    rename,
  } }), { code: 'ENOSPC' })
  assert.equal(attempts, 1)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, 1)
  assert.deepEqual(await readdir(dataDir), ['example.json'])
})

test('a corrupted current file recovers the last complete backup without destroying it', async t => {
  const dataDir = await temporary(t)
  const store = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  await store.saveWorkspace(workspace('Version one'), 0)
  await store.saveWorkspace(workspace('Version two'), 1)
  await writeFile(store.path, '{broken', 'utf8')
  const recovered = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  assert.equal(recovered.snapshot().workspace.name, 'Version one')
  assert.match(recovered.storage().message, /Recovered/)
  assert.equal(JSON.parse(await readFile(`${store.path}.bak`, 'utf8')).workspace.name, 'Version one')
})

test('unsupported metadata and prototype keys are rejected before persistence', async t => {
  const store = await live(t)
  const unsafe = workspace()
  unsafe.properties = JSON.parse('{"__proto__":{"polluted":true}}')
  assert.throws(() => validateWorkspace(unsafe), /unsafe property key/)
  const scripted = workspace()
  scripted.planner.script = 'execute()'
  await assert.rejects(() => store.saveWorkspace(scripted, 0), /unsupported field/)
  const duplicated = workspace()
  duplicated.spaces = [{ id: 'one', name: 'One', color: '#0082c9', collectionIds: [] }, { id: 'one', name: 'Two', color: '#0082c9', collectionIds: [] }]
  assert.throws(() => validateWorkspace(duplicated), /duplicate space/)
  assert.equal(store.snapshot().revision, 0)
  assert.equal({}.polluted, undefined)
})

test('initial cloud metadata is adopted only when the local workspace is untouched', async t => {
  const store = await live(t)
  const remote = fakeRemote(workspace('From cloud'))
  await store.syncWith(remote)
  assert.equal(store.snapshot().workspace.name, 'From cloud')
  assert.equal(store.snapshot().revision, 1)
  assert.equal(store.storage().syncStatus, 'synced')
  assert.equal(remote.writes.length, 0)
})

test('first-time cloud adoption never overwrites existing local customizations', async t => {
  const store = await live(t)
  const remote = fakeRemote(workspace('Cloud customizations'))
  await store.saveWorkspace(workspace('Local customizations'), 0)
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus, 'conflict')
  assert.equal(store.snapshot().workspace.name, 'Local customizations')
  assert.equal(remote.current().name, 'Cloud customizations')
  assert.equal(remote.writes.length, 0)
})

test('new metadata and local-only changes use conditional writes with the last fetched ETag', async t => {
  const store = await live(t)
  const remote = fakeRemote()
  await store.syncWith(remote)
  assert.equal(remote.writes[0].etag, null)
  await store.saveWorkspace(workspace('Local only'), 0)
  assert.equal(store.storage().syncStatus, 'pending')
  await store.syncWith(remote)
  assert.equal(remote.writes[1].etag, '"v1"')
  assert.equal(remote.current().name, 'Local only')
  assert.equal(store.storage().syncStatus, 'synced')
})

test('cloud-only changes are adopted after the previously synced base', async t => {
  const store = await live(t)
  const remote = fakeRemote()
  await store.syncWith(remote)
  remote.mutate(workspace('Updated elsewhere'))
  await store.syncWith(remote)
  assert.equal(store.snapshot().workspace.name, 'Updated elsewhere')
  assert.equal(remote.writes.length, 1)
})

test('both-local-and-cloud edits report conflict and retain both versions', async t => {
  const store = await live(t)
  const remote = fakeRemote()
  await store.syncWith(remote)
  await store.saveWorkspace(workspace('Local edit'), 0)
  remote.mutate(workspace('Remote edit'))
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus, 'conflict')
  assert.equal(store.snapshot().workspace.name, 'Local edit')
  assert.equal(remote.current().name, 'Remote edit')
  assert.equal(remote.writes.length, 1)
  assert.equal(JSON.parse(await readFile(store.path, 'utf8')).workspace.name, 'Local edit')
})

test('remote changes during a write and network failures preserve the local workspace', async t => {
  const store = await live(t)
  await store.saveWorkspace(workspace('Unsynced work'), 0)
  const racing = { readWorkspace: async () => ({ workspace: null, etag: null }), writeWorkspace: async () => { throw Object.assign(new Error('Race'), { code: 'CONFLICT' }) } }
  await store.syncWith(racing)
  assert.equal(store.storage().syncStatus, 'conflict')
  assert.equal(store.snapshot().workspace.name, 'Unsynced work')
  await store.syncWith({ readWorkspace: async () => { throw new Error('Network problem') } })
  assert.equal(store.storage().syncStatus, 'error')
  assert.equal(store.snapshot().workspace.name, 'Unsynced work')
})

test('cloud deletion is a conflict, and demo mode cannot sync', async t => {
  const store = await live(t)
  const remote = fakeRemote()
  await store.syncWith(remote)
  remote.mutate(null)
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus, 'conflict')
  assert.equal(remote.writes.length, 1)
  const demo = await WorkspaceStore.open({ dataDir: await temporary(t), scope: 'demo', initialState: initialState() })
  await assert.rejects(() => demo.syncWith(remote), /Connect Nextcloud/)
})

test('a cloud workspace with unsupported content cannot replace local metadata', async t => {
  const store = await live(t)
  const invalid = workspace('Unsafe cloud')
  invalid.schemaVersion = 99
  await store.syncWith(fakeRemote(invalid))
  assert.equal(store.storage().syncStatus, 'error')
  assert.equal(store.snapshot().workspace.name, 'Today')
})

test('desktop URL policy rejects executable, credentialed and insecure external addresses', () => {
  for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,hello', 'http://cloud.example.com', 'http://127.0.0.1.evil.example', 'https://alex:secret@cloud.example.com', 'not a URL']) assert.throws(() => security.safeUrl(url))
  assert.equal(security.safeUrl('https://cloud.example.com/nextcloud/', true).pathname, '/nextcloud/')
  assert.equal(security.safeUrl('http://127.0.0.1:5173').port, '5173')
  assert.equal(security.safeUrl('http://[::1]:8080').hostname, '[::1]')
  assert.throws(() => security.safeUrl('https://cloud.example.com/?token=secret', true), /query/)
  assert.throws(() => security.safeUrl('https://cloud.example.com/#fragment', true), /fragment/)
})

test('desktop bridge accepts only the app main frame from the expected entry document', () => {
  const entry = 'file:///C:/Nextspace/dist/index.html'
  const frame = { url: entry }
  const contents = { mainFrame: frame }
  assert.equal(security.trustedSender({ sender: contents, senderFrame: frame }, contents, entry), true)
  assert.equal(security.trustedSender({ sender: {}, senderFrame: frame }, contents, entry), false)
  assert.equal(security.trustedSender({ sender: contents, senderFrame: { url: entry } }, contents, entry), false)
  frame.url = 'https://attacker.example/index.html'
  assert.equal(security.trustedSender({ sender: contents, senderFrame: frame }, contents, entry), false)
  frame.url = 'file:///C:/Nextspace/other.html'
  assert.equal(security.trustedSender({ sender: contents, senderFrame: frame }, contents, entry), false)
  frame.url = `${entry}#today`
  assert.equal(security.trustedSender({ sender: contents, senderFrame: frame }, contents, entry), true)
})

test('cancelled and replaced login flows cannot complete after asynchronous polling', () => {
  let now = 100
  const registry = new security.LoginFlowRegistry({ now: () => now })
  const generation = registry.begin()
  const pending = registry.publish('first', { token: 'backend-only' }, generation)
  assert.equal(registry.get('first'), pending)
  registry.cancel('first')
  assert.throws(() => registry.assertCurrent(pending), /cancelled/)
  const replacementGeneration = registry.begin()
  assert.throws(() => registry.publish('stale', {}, generation), /replaced/)
  const replacement = registry.publish('replacement', {}, replacementGeneration)
  now += 10 * 60 * 1000 + 1
  assert.throws(() => registry.assertCurrent(replacement), /expired/)
})

test('login cancellation during credential commit reports the committed state instead of falsely cancelling', () => {
  const registry = new security.LoginFlowRegistry()
  const entry = registry.publish('flow', {}, registry.begin())
  registry.beginCommit(entry)
  assert.equal(registry.cancel('flow'), false)
  assert.equal(registry.get('flow'), entry)
  registry.finish(entry)
  assert.throws(() => registry.get('flow'), /expired/)
})

test('transient failures retain cache, but confirmed denied sources and collections purge it', () => {
  const before = {
    records: [{ id: 'old', source: 'notes', collectionId: 'notes', title: 'Keep offline' }, { id: 'revoked', source: 'deck', collectionId: 'private-board', title: 'Remove access' }, { id: 'retained', source: 'deck', collectionId: 'accessible-board', title: 'Still available' }],
    collections: [{ id: 'notes', source: 'notes' }, { id: 'private-board', source: 'deck' }, { id: 'accessible-board', source: 'deck' }], statuses: [],
  }
  const transient = security.reconcileCache(before, { records: [], collections: [], statuses: [{ source: 'notes', state: 'error', message: 'Network unavailable' }, { source: 'deck', state: 'error' }] }, ['notes', 'deck'])
  assert.equal(transient.cache.records.length, 3)
  assert.equal(transient.purgeBackup, false)
  const denied = security.reconcileCache(before, { records: [{ id: 'new', source: 'deck', collectionId: 'accessible-board', title: 'New accessible card' }], collections: [], statuses: [{ source: 'notes', state: 'error', permissionDenied: true }, { source: 'deck', state: 'error', revokedCollectionIds: ['private-board'] }] }, ['notes', 'deck'])
  assert.deepEqual(denied.cache.records.map(record => record.id), ['retained', 'new'])
  assert.deepEqual(denied.cache.collections.map(collection => collection.id), ['accessible-board'])
  assert.equal(denied.purgeBackup, true)
  assert.equal(denied.successful.size, 0)
})

test('permission cache purge also sanitizes the recovery backup', async t => {
  const store = await live(t)
  await store.updateCache({ records: [{ id: 'private', source: 'notes', title: 'Permission later revoked' }], collections: [], statuses: [] })
  await store.updateCache({ records: [], collections: [], statuses: [{ source: 'notes', state: 'error', permissionDenied: true }] }, { purgeBackup: true })
  assert.equal(JSON.parse(await readFile(store.path, 'utf8')).cache.records.length, 0)
  assert.equal(JSON.parse(await readFile(`${store.path}.bak`, 'utf8')).cache.records.length, 0)
  assert.equal(store.snapshot().workspace.name, 'Today')
})

function styledWorkspace() {
  const value = workspace('Life planner')
  value.spaces = [{ id: 'freelance', name: 'Freelance', color: '#336699', collectionIds: ['calendar-one', 'board-one'] }]
  value.projects = [{ id: 'project-one', name: 'Client project', spaceId: 'freelance', collectionIds: ['project-board'], recordIds: ['task-one'] }]
  value.relations = [{ id: 'relation-one', type: 'depends_on', fromId: 'card-one', toId: 'task-one' }]
  value.plans = [{ id: 'plan-one', recordId: 'task-one', start: '2026-11-02T08:00:00Z', end: '2026-11-02T09:00:00Z' }]
  value.appearance = { mode: 'dark', calendarColors: { 'calendar-one': '#123456' } }
  value.properties = { 'task-one': { context: 'Freelance preparation' } }
  return value
}

test('Spaces, projects, typed links, plans and preferences survive sync and reopen', async t => {
  const dataDir = await temporary(t)
  const store = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  const saved = await store.saveWorkspace(styledWorkspace(), 0)
  const remote = fakeRemote()
  await store.syncWith(remote)
  const reopened = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  assert.deepEqual(reopened.snapshot().workspace, saved.workspace)
  assert.deepEqual(remote.current(), saved.workspace)
  assert.equal(reopened.storage().remotePath, '/Workspace/planner.json')
  assert.equal(Object.hasOwn(remote.current(), 'cache'), false)
})

test('v1 migration retains source links and properties, with the original file untouched', async t => {
  const dataDir = await temporary(t)
  const directory = join(dataDir, 'workspaces', scope)
  await mkdir(directory, { recursive: true })
  const old = { schemaVersion: 1, revision: 7, workspace: { schemaVersion: 1, id: 'old', name: 'My real workspace', updatedAt: '2026-09-29T12:00:00Z', dashboards: [{ id: 'old-dashboard', title: 'Old layout', widgets: [] }], relations: [{ id: 'link', fromId: 'task-one', toId: 'note-one', label: 'Preparation' }], properties: { 'task-one': { estimate: 60 } }, appearance: { mode: 'dark', calendarColors: { cal: '#123456' } } }, cache: { records: [{ id: 'task-one', source: 'tasks', title: 'Actual task' }, { id: 'note-one', source: 'notes', title: 'Actual note' }], collections: [], statuses: [] }, sync: { status: 'synced', baseHash: '1'.repeat(64), initialHash: '1'.repeat(64), etag: 'old' } }
  const legacyFile = join(directory, 'workspace.json')
  const original = JSON.stringify(old)
  await writeFile(legacyFile, original)
  const store = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  const next = store.snapshot()
  assert.equal(next.workspace.schemaVersion, 2)
  assert.equal(next.revision, 8)
  assert.equal(Object.hasOwn(next.workspace, 'dashboards'), false)
  assert.equal(next.workspace.relations[0].type, 'related')
  assert.equal(next.workspace.relations[0].fromId, next.cache.records[0].id)
  assert.equal(next.workspace.relations[0].toId, next.cache.records[1].id)
  assert.equal(next.workspace.properties[next.cache.records[0].id].estimate, 60)
  assert.equal(await readFile(legacyFile, 'utf8'), original)
  assert.equal(next.sync.baseHash, null)
})

test('schema rejects unsupported rules, unsafe values and dependency cycles', () => {
  const changes = [
    w => { w.planner.assignment = 'owner' },
    w => { w.planner.workflow['task-one'] = 'complete-source' },
    w => { w.spaces[0].color = 'red;display:none' },
    w => { w.projects[0].spaceId = 'missing' },
    w => { w.projects[0].recordIds.push('task-one') },
    w => { w.plans[0].end = w.plans[0].start },
    w => { w.plans[0].start = '2026-02-30T08:00:00Z' },
    w => { w.plans[0].start = '2026-11-02T08:00:00' },
    w => { w.plans[0].start = '2026-11-02T24:00:00Z' },
    w => { w.relations[0].type = 'execute' },
    w => { w.relations.push({ id: 'reverse', type: 'depends_on', fromId: 'task-one', toId: 'card-one' }) },
    w => { w.planner.script = 'execute()' },
  ]
  for (const change of changes) { const value = styledWorkspace(); change(value); assert.throws(() => validateWorkspace(value), /Invalid workspace/) }
})

test('duplicate source rows resolve to one durable identity across repeated refreshes', () => {
  const record = { id: 'native:notes:42', source: 'notes', title: 'Actual note', identity: { source: 'notes', key: 'account:notes:42', locator: '/notes/42', aliases: ['native:notes:42'] } }
  let created = 0
  const first = reconcileIdentities(workspace(), [record, structuredClone(record)], () => `identity-${++created}`)
  const second = reconcileIdentities(first.workspace, [record, structuredClone(record)], () => `identity-${++created}`)
  assert.equal(first.records.length, 1)
  assert.equal(first.workspace.identities.length, 1)
  assert.equal(second.records[0].id, first.records[0].id)
  assert.equal(second.workspace.identities.length, 1)
  assert.equal(created, 1)
  validateWorkspace(second.workspace)
})

test('ambiguous duplicate identities at different locations reject refresh without changing metadata', () => {
  const before = workspace()
  const one = { id: 'one', source: 'calendar', identity: { source: 'calendar', key: 'same-key', locator: '/one.ics' } }
  const two = { id: 'two', source: 'calendar', identity: { source: 'calendar', key: 'same-key', locator: '/two.ics' } }
  assert.throws(() => reconcileIdentities(before, [one, two]), /ambiguous identities/)
  assert.deepEqual(before.identities, [])
})

test('unique UID moves retain links while simultaneous calendar copies keep separate identities', () => {
  const task = (calendar, id) => ({ id, source: 'tasks', identity: { source: 'tasks', key: `${calendar}:UID-one`, locator: `/${calendar}/${id}.ics`, aliases: [id, 'account:tasks:UID-one'] } })
  const initial = workspace()
  initial.relations = [{ id: 'relation', type: 'reference', fromId: 'old-native', toId: 'unavailable-note' }]
  const first = reconcileIdentities(initial, [task('calendar-a', 'old-native')])
  const moved = reconcileIdentities(first.workspace, [task('calendar-b', 'new-native')])
  assert.equal(moved.records[0].id, first.records[0].id)
  assert.equal(moved.workspace.relations[0].fromId, first.records[0].id)
  assert.equal(moved.workspace.relations[0].toId, 'unavailable-note')
  const copied = reconcileIdentities(first.workspace, [task('calendar-a', 'old-native'), task('calendar-b', 'copy-native')])
  assert.equal(copied.workspace.identities.length, 2)
  assert.notEqual(copied.records[0].id, copied.records[1].id)
})

test('adopting cloud registry remaps cached IDs before exposing cloud relationships', async t => {
  const store = await live(t)
  const record = { id: 'native:notes:42', source: 'notes', title: 'Actual note', identity: { source: 'notes', key: 'account:notes:42', locator: '/notes/42', aliases: ['native:notes:42'] } }
  await store.updateCache({ records: [record], collections: [], statuses: [] })
  const remoteWorkspace = workspace('Cloud planner')
  const cloudId = 'd075a71a-fd63-45af-b26a-42efb03dad53'
  remoteWorkspace.identities = [{ id: cloudId, ...record.identity }]
  remoteWorkspace.relations = [{ id: 'link', type: 'reference', fromId: 'unavailable-task', toId: cloudId }]
  await store.syncWith(fakeRemote(remoteWorkspace))
  const saved = store.snapshot()
  assert.equal(store.storage().syncStatus, 'synced')
  assert.equal(saved.cache.records[0].id, cloudId)
  assert.equal(saved.workspace.relations[0].toId, cloudId)
  assert.equal(saved.workspace.identities.length, 1)
})

test('server theme normalization allows only safe presentation fields', () => {
  assert.deepEqual(normalizeTheme({ name: 'My cloud', color: '#AABBCC', textColor: 'red;display:none', backgroundColor: '#112233', logoUrl: 'javascript:alert(1)', backgroundUrl: 'https://user:secret@cloud.example.com/image', dark: true, appPassword: 'secret', css: 'body{}' }), { name: 'My cloud', color: '#aabbcc', backgroundColor: '#112233', dark: true })
  assert.deepEqual(normalizeTheme({ logoUrl: 'https://cloud.example.com/logo.png?v=2' }), { logoUrl: 'https://cloud.example.com/logo.png?v=2' })
  assert.equal(normalizeTheme({ backgroundUrl: 'file:///private-image.png' }), undefined)
})

const themePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ0cAAAAASUVORK5CYII='

test('portable theme normalization needs no Node Buffer and preserves the workspace export', () => {
  assert.equal(normalizeTheme, normalizePortableTheme)
  const nodeBuffer = globalThis.Buffer
  try {
    globalThis.Buffer = undefined
    assert.deepEqual(normalizePortableTheme({backgroundDataUrl: themePng, color: '#AABBCC'}), {color: '#aabbcc', backgroundDataUrl: themePng})
    for (const backgroundDataUrl of [
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
      'data:image/gif;base64,R0lGODlhAQABAIAA',
      'data:image/webp;base64,UklGRgwAAABXRUJQVlA4TA==',
    ]) assert.deepEqual(normalizePortableTheme({backgroundDataUrl}), {backgroundDataUrl})
    assert.equal(normalizePortableTheme({backgroundDataUrl: 'data:image/png;base64,iVBORw0KGgp='}), undefined, 'noncanonical padding bits must remain rejected')
  } finally { globalThis.Buffer = nodeBuffer }
})

test('personal theme palettes are allowlisted values, never CSS or external image references', () => {
  assert.deepEqual(normalizeTheme({
    mode: 'dark', backgroundTextColor: '#FEFEFE', backgroundDataUrl: themePng,
    light: { surfaceColor: '#FFF', textColor: '#222222', primaryColor: '#AABBCC', borderColor: 'var(--injected)', backgroundImage: 'url(https://third-party.example/track)' },
    darkPalette: { surfaceColor: '#121212', mutedColor: '#BBBBBB', primaryTextColor: '#FFFFFF', css: 'body{display:none}' },
  }), {
    mode: 'dark', backgroundTextColor: '#fefefe', backgroundDataUrl: themePng,
    light: { surfaceColor: '#fff', textColor: '#222222', primaryColor: '#aabbcc' },
    darkPalette: { surfaceColor: '#121212', mutedColor: '#bbbbbb', primaryTextColor: '#ffffff' },
  })
  assert.equal(normalizeTheme({ mode: 'url(javascript:alert(1))', light: [], darkPalette: { surfaceColor: 'rgb(1 2 3); display:none' } }), undefined)
  for (const mode of ['light', 'dark', 'system']) assert.equal(normalizeTheme({ mode }).mode, mode)
})

test('theme cache preserves explicit contrast booleans without coercing remote values', () => {
  for (const highContrast of [true, false]) assert.deepEqual(normalizePortableTheme({highContrast}), {highContrast})
  for (const highContrast of ['true', 'false', 1, 0, null, {}, []]) assert.equal(normalizePortableTheme({highContrast}), undefined)
})

test('cached backgrounds require matching bounded raster data URLs', () => {
  assert.equal(normalizeTheme({ backgroundDataUrl: themePng }).backgroundDataUrl, themePng)
  for (const [mime, signature] of [
    ['jpeg', 'ffd8ffe000104a464946000101'], ['gif', '47494638396101000100800000'], ['webp', '524946460c000000574542505650384c'],
  ]) {
    const image = `data:image/${mime};base64,${Buffer.from(signature, 'hex').toString('base64')}`
    assert.equal(normalizeTheme({ backgroundDataUrl: image }).backgroundDataUrl, image)
  }
  const invalid = [
    'https://cloud.example.com/private-wallpaper.png',
    `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`,
    `data:text/html;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`,
    `data:image/png;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`,
    themePng.replace('image/png', 'image/jpeg'),
    themePng.replace(';base64,', ';name="foo";base64,'),
    `${themePng}\n`, `${themePng}#fragment`, 'data:image/png;base64,%%%%', 'data:image/png;base64,aQ=',
  ]
  for (const value of invalid) assert.equal(normalizeTheme({ backgroundDataUrl: value }), undefined)
  const maximum = Buffer.alloc(2 * 1024 * 1024)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(maximum)
  const bounded = `data:image/png;base64,${maximum.toString('base64')}`
  assert.equal(normalizeTheme({ backgroundDataUrl: bounded }).backgroundDataUrl, bounded)
  const oversized = `data:image/png;base64,${Buffer.concat([maximum, Buffer.from([0])]).toString('base64')}`
  assert.deepEqual(normalizeTheme({ color: '#336699', backgroundDataUrl: oversized }), { color: '#336699' })
})

test('theme survives per-account cache refresh and metadata mutation without leaking to demo', async t => {
  const dataDir = await temporary(t)
  const account = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  const demo = await WorkspaceStore.open({ dataDir, scope: 'demo', initialState: initialState() })
  const personalTheme = { name: 'Personal cloud', color: '#336699', dark: true, mode: 'dark', backgroundDataUrl: themePng, light: { surfaceColor: '#ffffff' }, darkPalette: { surfaceColor: '#181818' } }
  await account.updateCache({ records: [], collections: [], statuses: [], theme: { ...personalTheme, unexpected: 'drop me' } })
  await account.saveWorkspace(styledWorkspace(), 0)
  const reconciled = security.reconcileCache(account.snapshot().cache, { records: [], collections: [], statuses: [] }, ['notes'])
  await account.updateCache(reconciled.cache)
  await account.updateCache({ records: [], collections: [], statuses: [] })
  const reopened = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  assert.deepEqual(reopened.snapshot().cache.theme, personalTheme)
  assert.equal(demo.snapshot().cache.theme, undefined)
  const otherAccount = await WorkspaceStore.open({ dataDir, scope: accountScope('https://cloud.example.com', 'bea'), initialState: initialState() })
  assert.equal(otherAccount.snapshot().cache.theme, undefined)
  assert.equal(Object.hasOwn(reopened.snapshot().workspace, 'theme'), false)
})

test('confirmed theme removal clears persisted branding while omitted theme preserves it during failures', async t => {
  const dataDir = await temporary(t)
  const store = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  await store.updateCache({ records: [], collections: [], statuses: [], theme: { name: 'Old cloud', color: '#335577', backgroundDataUrl: themePng, mode: 'dark' } })
  const failedRefresh = security.reconcileCache(store.snapshot().cache, { records: [], collections: [], statuses: [{ source: 'notes', state: 'error' }] }, ['notes'])
  await store.updateCache(failedRefresh.cache)
  assert.equal(store.snapshot().cache.theme.name, 'Old cloud')
  assert.equal(store.snapshot().cache.theme.backgroundDataUrl, themePng)
  const confirmedRemoval = security.reconcileCache(store.snapshot().cache, { records: [], collections: [], statuses: [{ source: 'notes', state: 'connected' }], theme: undefined }, ['notes'])
  assert.equal(Object.hasOwn(confirmedRemoval.cache, 'theme'), true)
  await store.updateCache(confirmedRemoval.cache)
  assert.equal(store.snapshot().cache.theme, undefined)
  const reopened = await WorkspaceStore.open({ dataDir, scope, initialState: initialState() })
  assert.equal(Object.hasOwn(reopened.snapshot().cache, 'theme'), false)
})
