/** Windows/Android storage interoperability belongs to the repository integration suite. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMetadataStore} from '../android/src/metadata.mjs'
import {createSlotCache} from '../android/src/cache.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {FolderWorkspaceClient, assembleWorkspace} from '../packages/nextcloud/src/planner-folder.mjs'
import {FolderWorkspaceClient as WindowsFolderClient} from '@nextspace/nextcloud-node/planner-folder.mjs'
import {WorkspaceStore, accountScope} from '@nextspace/nextcloud-node/workspace.mjs'

const clone = value => structuredClone(value)
const KEY = 'a'.repeat(64)
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
      const prefix = `${directory}/`, descendants = [...files].filter(([path]) => path.startsWith(prefix))
      const directories = [...new Set(descendants.map(([path]) => path.slice(prefix.length)).filter(path => path.includes('/')).map(path => prefix + path.split('/')[0]))]
      return {exists: true, files: [...directories.map(path => ({path, collection: true, etag: '"directory"'})), ...descendants.filter(([path]) => !path.slice(prefix.length).includes('/')).map(([path, data]) => ({path, collection: false, etag: data.etag}))]}
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
async function mobile(remote, storage = disk(), key = KEY, options = {}) { const store = createMetadataStore({cache: storage.cache(), key, client: remote, ...options}); await store.load(); return {store, storage} }
async function edit(store, callback) { const current = store.getState(); callback(current.workspace); return store.saveWorkspace(current.workspace, current.revision) }
async function windows(t, remote) {
  const dataDir = await mkdtemp(join(tmpdir(), 'nextspace-android-parity-'))
  t.after(() => rm(dataDir, {recursive: true, force: true}))
  const store = await WorkspaceStore.open({dataDir, scope: accountScope('https://metadata-fixture.invalid', 'tester'), initialState: {workspace: createPlannerWorkspace(), records: [], collections: [], statuses: []}})
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus, 'synced', store.storage().message)
  return store
}

test('Windows and Android import one identical portable folder implementation', () => { assert.equal(FolderWorkspaceClient, WindowsFolderClient) })

test('Windows to Android to second Windows and restart preserve one organization envelope and unrelated files', async t => {
  const remote = cloud(), first = await windows(t, remote)
  const state = first.snapshot(); state.workspace = workspace(); await first.saveWorkspace(state.workspace, state.revision); await first.syncWith(remote)
  const {store, storage} = await mobile(remote); await store.sync()
  const before = new Map([...remote.files].map(([path, data]) => [path, clone(data)])), count = remote.writes.length
  await edit(store, value => { value.categories[0].name = 'Shared'; value.spaces[0].collectionIds.push('unavailable-source') })
  assert.equal(remote.writes.length, count, 'Save is durable locally before sync')
  await store.sync()
  assert.equal(store.getState().storage.syncStatus, 'synced')
  assert.equal(remote.writes.length - count, 1)
  assert.match(remote.writes.at(-1).path, /\/organization\.json$/)
  for (const [path, data] of before) if (!path.endsWith('/organization.json')) assert.deepEqual(remote.files.get(path), data)
  const second = await windows(t, remote)
  assert.deepEqual(org(second.snapshot().workspace), org(store.getState().workspace))
  assert.deepEqual(second.snapshot().workspace.relations, workspace().relations)
  const restarted = await mobile(remote, storage); await restarted.store.sync()
  assert.deepEqual(org(restarted.store.getState().workspace), org(second.snapshot().workspace))
})
