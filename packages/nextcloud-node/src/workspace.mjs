import { createHash, randomUUID } from 'node:crypto'
import {constants as fsConstants} from 'node:fs'
import { mkdir, readFile, rename, open, copyFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { validateWorkspace, migrateWorkspace, jsonValue } from '@nextspace/core/planner-schema.mjs'
import { normalizeTheme } from '@nextspace/core/theme-cache.mjs'
import { projectNativeIdentities, promoteNativeIdentities, publicTaskIdentity } from '@nextspace/core/identity.mjs'
import { createPlannerWorkspace } from '@nextspace/core/planner.mjs'
import { deviceViewKeys, mergeWorkspaces, withDeviceViewPreferences } from '@nextspace/core/workspace-merge.mjs'
import {FolderWorkspaceClient, PLANNER_FOLDER} from './planner-folder.mjs'

export { validateWorkspace, migrateWorkspace } from '@nextspace/core/planner-schema.mjs'
export { normalizeTheme } from '@nextspace/core/theme-cache.mjs'
const clone = value => structuredClone(value)
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export const workspaceHash = value => createHash('sha256').update(stable(value)).digest('hex')

export function accountScope(serverUrl, username) {
  const server = new URL(serverUrl)
  server.hash = ''; server.search = ''
  const identity = `${server.href.replace(/\/+$/, '')}\n${username}`
  return `account-${createHash('sha256').update(identity).digest('hex')}`
}

/** Same-directory rename prevents a partial JSON file becoming the current workspace. */
export async function atomicWriteJson(path, value, { backup = true, fileOperations = { copyFile, rename } } = {}) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const backupTemporary = `${path}.${randomUUID()}.bak.tmp`
  // Antivirus, indexing and cloud-folder clients can briefly hold Windows
  // replacement handles. Retry only these lock errors; never delete the current
  // file to make a rename succeed. All three operations wait at most 900 ms total.
  const replace = async operation => {
    for (let attempt = 0; ; attempt++) {
      try { return await operation() }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 4) throw error
        await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
  }
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await file.sync() } finally { await file.close() }
    if (backup) {
      try {
        await replace(() => fileOperations.copyFile(path, backupTemporary))
        await replace(() => fileOperations.rename(backupTemporary, `${path}.bak`))
      }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    await replace(() => fileOperations.rename(temporary, path))
  } finally {
    await unlink(temporary).catch(() => {})
    await unlink(backupTemporary).catch(() => {})
  }
}

function validateCache(cache) {
  if (!cache || !Array.isArray(cache.records) || !Array.isArray(cache.collections) || !Array.isArray(cache.statuses)) throw new Error('Invalid cached source data.')
  const encoded = JSON.stringify(cache)
  if (Buffer.byteLength(encoded) > 50 * 1024 * 1024) throw new Error('Cached source data exceeds the 50 MB prototype limit.')
  const normalized = JSON.parse(encoded)
  if (Object.hasOwn(normalized, 'theme')) {
    const theme = normalizeTheme(normalized.theme)
    if (theme) normalized.theme = theme
    else delete normalized.theme
  }
  jsonValue(normalized, 0, 24, 4 * 1024 * 1024)
  return normalized
}
function validateEnvelope(value) {
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Unsupported saved workspace format.')
  value.workspace = validateWorkspace(value.workspace); value.cache = validateCache(value.cache)
  if (!value.sync || !['local', 'synced', 'pending', 'conflict', 'error'].includes(value.sync.status)) throw new Error('Invalid saved sync information.')
  for (const key of ['baseHash', 'initialHash']) if (value.sync[key] !== null && !/^[a-f0-9]{64}$/.test(value.sync[key] || '')) throw new Error('Invalid saved sync hash.')
  if (value.sync.etag !== null && (typeof value.sync.etag !== 'string' || value.sync.etag.length > 1000)) throw new Error('Invalid saved sync version.')
  for (const key of ['baseWorkspace', 'initialWorkspace', 'conflictWorkspace']) if (value.sync[key] !== undefined) value.sync[key] = validateWorkspace(value.sync[key])
  if (value.sync.baseWorkspace && workspaceHash(value.sync.baseWorkspace) !== value.sync.baseHash) throw new Error('Invalid saved sync baseline.')
  if (value.sync.initialWorkspace && workspaceHash(value.sync.initialWorkspace) !== value.sync.initialHash) throw new Error('Invalid initial sync baseline.')
  if (value.sync.folder !== undefined && (!/^data-[a-f0-9-]{36}$/.test(value.sync.folder?.generation||'') || !Array.isArray(value.sync.folder.paths) || value.sync.folder.paths.length > 60000 || value.sync.folder.paths.some(path=>typeof path!=='string'||path.length>200||path.includes('..')||path.startsWith('/')))) throw new Error('Invalid saved planner folder checkpoint.')
  return value
}

function sharedWorkspaceHash(workspace) {
  const shared = clone(workspace)
  delete shared.updatedAt
  for (const key of deviceViewKeys) delete shared.planner[key]
  return workspaceHash(shared)
}
function onlyViewChanges(workspace, initial = createPlannerWorkspace()) {
  const content = value => {
    const result = clone(value)
    delete result.updatedAt; delete result.identities
    for (const key of deviceViewKeys) delete result.planner[key]
    return result
  }
  return workspaceHash(content(workspace)) === workspaceHash(content(initial))
}

export class WorkspaceStore {
  static async open({ dataDir, scope, initialState }) {
    if (!['local', 'demo'].includes(scope) && !/^account-[a-f0-9]{64}$/.test(scope)) throw new Error('Invalid workspace account scope.')
    const store = new WorkspaceStore()
    store.directory = join(dataDir, 'workspaces', scope)
    store.path = join(store.directory, 'planner.json')
    store.scope = scope
    store.queue = Promise.resolve()
    store.syncQueue = Promise.resolve()
    store.recordAliases = new Map()
    await mkdir(store.directory, { recursive: true, mode: 0o700 })
    try {
      store.value = validateEnvelope(JSON.parse(await readFile(store.path, 'utf8')))
    } catch (error) {
      let backup
      try { backup = validateEnvelope(JSON.parse(await readFile(`${store.path}.bak`, 'utf8'))) } catch {}
      if (backup) {
        store.value = backup
        store.value.sync.message = 'Recovered the last complete local backup after a storage error.'
        await atomicWriteJson(store.path, store.value, { backup: false })
      } else if (error.code === 'ENOENT') {
        let legacy = null
        // Local disconnected mode never imports the retired demo workspace.
        if (!['local', 'demo'].includes(scope)) {
          try { legacy = JSON.parse(await readFile(join(store.directory, 'workspace.json'), 'utf8')) }
          catch (legacyError) {
            if (legacyError.code !== 'ENOENT') throw new Error('The previous workspace could not be migrated. Its original file was preserved.')
          }
        }
        if (legacy && (legacy.schemaVersion !== 1 || !Number.isSafeInteger(legacy.revision) || legacy.revision < 0 || !legacy.cache)) throw new Error('The previous workspace format could not be migrated. Its original file was preserved.')
        const workspace = migrateWorkspace(legacy?.workspace || initialState.workspace)
        const cache = validateCache(legacy?.cache || { records: initialState.records || [], collections: initialState.collections || [], statuses: initialState.statuses || [], ...(initialState.theme ? { theme: initialState.theme } : {}) })
        const resolved = projectNativeIdentities(workspace, cache.records)
        cache.records = resolved.records
        const validated = validateWorkspace(resolved.workspace)
        store.value = { schemaVersion: 1, revision: legacy ? legacy.revision + 1 : 0, workspace: validated, cache, sync: { baseHash: null, initialHash: workspaceHash(validated), ...(!legacy ? {initialWorkspace: clone(validated)} : {}), etag: null, status: 'local', message: legacy ? 'Planning data migrated. The original workspace.json remains untouched on this device. Connect to sync these customizations to Nextcloud.' : 'Saved on this device. Connect to sync planner customizations automatically.' } }
        await atomicWriteJson(store.path, store.value)
      } else {
        throw new Error('The local workspace and its backup could not be read. Existing files were preserved; restore a valid export before continuing.')
      }
    }
    return store
  }
  snapshot() { return clone(this.value) }
  cacheSnapshot() { return clone(this.value.cache) }
  statusSnapshot() { return clone(this.value.cache.statuses) }
  recordSnapshot(id, source) {
    const resolved = this.resolveRecordId(id)
    return clone(this.value.cache.records.find(item => item.id === resolved && (!source || item.source === source)))
  }
  collectionSnapshot(id, source) {
    return clone(this.value.cache.collections.find(item => item.id === id && (!source || item.source === source)))
  }
  publicSnapshot() {
    // Project before cloning: raw ICS, native Deck snapshots and sync baselines
    // are private backend data and can dwarf the state sent to the renderer.
    const publicItem = ({ remote, identity, ...item }) => item
    const publicRecord = record => {const item=publicItem(record),identity=publicTaskIdentity(record);return identity?{...item,identity}:item}
    const {workspace, revision, cache} = this.value
    return clone({workspace, revision, cache:{records:cache.records.map(publicRecord),collections:cache.collections.map(publicItem),statuses:cache.statuses,...(cache.theme?{theme:cache.theme}:{})}})
  }
  resolveRecordId(id) {
    const current = new Set([...this.value.workspace.identities.map(identity => identity.id),...this.value.cache.records.map(record=>record.id)])
    if (current.has(id)) return id
    const seen = new Set()
    let resolved = id
    while (this.recordAliases.has(resolved) && !seen.has(resolved)) { seen.add(resolved); resolved = this.recordAliases.get(resolved) }
    return current.has(resolved) ? resolved : id
  }
  recordIdAliases() {
    return Object.fromEntries([...this.recordAliases.keys()].map(id => [id, this.resolveRecordId(id)]).filter(([id, resolved]) => id !== resolved))
  }
  storage() {
    const sync = this.value.sync
    const disconnected = ['local', 'demo'].includes(this.scope)
    return { localPath: this.path, remotePath: disconnected ? undefined : sync.folder ? PLANNER_FOLDER : '/Workspace/planner.json', syncStatus: disconnected ? 'local' : sync.status, message: disconnected ? 'Local planner. Connect Nextcloud to load your calendars, tasks, boards and notes.' : sync.message, lastSyncedAt: sync.lastSyncedAt }
  }
  exclusive(operation) {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => {})
    return next
  }
  async commit(next, { returnSnapshot = true } = {}) {
    await atomicWriteJson(this.path, next)
    // A cloud registry can choose a canonical UUID while a native edit still
    // carries the previous session ID. Keep this account-local alias only for
    // in-flight callers; never retarget an ID to a different native source key.
    const identities=value=>[...value.workspace.identities,...value.cache.records.filter(record=>record.identity?.key).map(record=>({...record.identity,source:record.source,id:record.id}))]
    const canonical = new Map(identities(next).map(identity => [JSON.stringify([identity.source,identity.key]),identity.id]))
    for (const identity of identities(this.value)) {
      const id = canonical.get(JSON.stringify([identity.source,identity.key]))
      if (id && id !== identity.id) this.recordAliases.set(identity.id,id)
    }
    this.value = next
    return returnSnapshot ? this.snapshot() : undefined
  }
  updateRecordMetadata(id, update) {
    return this.exclusive(async () => {
      const resolved = this.resolveRecordId(id)
      const record = this.value.cache.records.find(item => item.id === resolved)
      if (!record) return false
      const metadata = typeof update === 'function' ? update(clone(record)) : update
      const keys = Object.keys(metadata || {})
      const allowed = record.source === 'deck' ? ['attachmentFileIds'] : record.source === 'notes' ? ['fileTags','tagDetails','tags'] : []
      if (!metadata || Array.isArray(metadata) || keys.some(key => !allowed.includes(key))) throw new Error('Only native attachment or note-tag metadata can be updated here.')
      if (keys.every(key => isDeepStrictEqual(record[key], metadata[key]))) return false
      // Metadata cannot change native identity or planning fields. Reconcile the
      // latest cache under the lock, but avoid rehashing/reconciling every ID on
      // an inspector read. Repeated unchanged reads perform no disk write.
      const changed = {...record,...clone(metadata)}
      const cache = validateCache({...this.value.cache,records:this.value.cache.records.map(item => item.id === resolved ? changed : item)})
      await this.commit({...this.value,cache}, {returnSnapshot:false})
      return true
    })
  }
  saveWorkspace(workspace, expectedRevision) {
    return this.exclusive(async () => {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== this.value.revision) {
        const error = new Error('This workspace changed since you opened it. Reload the latest workspace before saving. Your newer saved version is intact.')
        error.code = 'REVISION_CONFLICT'; throw error
      }
      const validated = validateWorkspace(workspace)
      const next = this.snapshot()
      // The connector owns native identity; UI edits cannot accidentally remove
      // the registry while saving a Space or a view preference.
      validated.identities = clone(next.workspace.identities)
      const resolved=promoteNativeIdentities(validated,next.cache.records)
      next.workspace = validateWorkspace(resolved.workspace)
      next.cache.records = resolved.records
      next.workspace.updatedAt = new Date().toISOString()
      next.revision++
      next.sync.status = next.sync.baseHash ? 'pending' : 'local'
      next.sync.message = 'Saved on this device. Waiting to sync planner customizations to Nextcloud.'
      await this.commit(next, {returnSnapshot:false})
      return { workspace: clone(next.workspace), revision: next.revision, storage: this.storage() }
    })
  }
  updateCache(cache, { purgeBackup = false } = {}) {
    return this.exclusive(async () => {
      const next = this.snapshot()
      // next is already detached from the committed envelope. Do not copy all
      // native bodies again merely to hand this snapshot to the update callback.
      if (typeof cache === 'function') cache = cache(next.cache)
      next.cache = validateCache({ ...(!Object.hasOwn(cache, 'theme') && next.cache.theme ? { theme: next.cache.theme } : {}), ...cache })
      const beforeHash = workspaceHash(next.workspace)
      const untouched = !next.sync.baseHash && beforeHash === next.sync.initialHash
      const resolved = projectNativeIdentities(next.workspace, next.cache.records)
      let metadataError
      try { next.workspace = validateWorkspace(resolved.workspace) }
      catch(error) {
        if(!error.message?.startsWith('Invalid workspace:'))throw error
        // Verified native reads and planner metadata have separate outcomes.
        // Keep the last valid customization document and its exact revision.
        metadataError='Planner metadata could not be updated. Your previous planner customizations are preserved. Native source data was saved; reduce planner metadata before retrying its sync.'
      }
      next.cache.records = resolved.records
      const afterHash = workspaceHash(next.workspace)
      if (beforeHash !== afterHash) {
        next.revision++
        if (untouched) { next.sync.initialHash = afterHash; if (next.sync.initialWorkspace) next.sync.initialWorkspace = clone(next.workspace) }
        if (next.sync.status === 'synced') next.sync.status = 'pending'
      }
      if(metadataError){next.sync.status='error';next.sync.message=metadataError}
      await this.commit(next, {returnSnapshot:false})
      // A normal backup retains the former cache. After confirmed permission
      // revocation, replace that backup too so recovery cannot expose old content.
      if (purgeBackup) await atomicWriteJson(`${this.path}.bak`, next, { backup: false })
      return this.snapshot()
    })
  }
  syncWith(client) {
    // Network work must not hold the local persistence lock. Only snapshot and
    // final reconciliation run on that lock; cloud cycles still serialize.
    const operation = this.syncQueue.then(() => this.syncSnapshotWith(client))
    this.syncQueue = operation.catch(() => {})
    return operation
  }
  async syncSnapshotWith(client) {
      if (['local', 'demo'].includes(this.scope)) throw new Error('Connect Nextcloud to sync this planner.')
      const next = await this.exclusive(() => this.snapshot())
      const startedWorkspace = clone(next.workspace)
      const originalHash = workspaceHash(next.workspace)
      const originalSharedHash = sharedWorkspaceHash(next.workspace)
      const folderCapable = typeof client.listPlannerFiles === 'function' && typeof client.readPlannerFile === 'function' && typeof client.writePlannerFile === 'function'
      if(folderCapable && this.folderClient?.client !== client)this.folderClient=new FolderWorkspaceClient(client)
      const transport=folderCapable?this.folderClient:client
      if(folderCapable)transport.setCheckpoint(next.sync.folder)
      const fail = async (status, message, remote, paths) => {
        return this.exclusive(async () => {
          const latest = this.snapshot()
          latest.sync.status = status; latest.sync.message = message
          if (remote) latest.sync.conflictWorkspace = clone(remote)
          if (paths) latest.sync.conflictPaths = paths
          return this.commit(latest)
        })
      }
      try {
        // A conditional-write race is retried against the newly read remote base.
        // This sync publishes no local state before acknowledgment; independent
        // local edits continue and are merged into its final short commit.
        if(folderCapable&&!next.sync.folder){
          // Keep the exact pre-migration local envelope independently of the
          // rotating .bak recovery file. Never replace an existing backup.
          try{await copyFile(this.path,join(this.directory,'planner-before-folder-migration.json'),fsConstants.COPYFILE_EXCL)}
          catch(error){if(error.code!=='EEXIST')throw error}
        }
        for (let attempt = 0; attempt < 3; attempt++) {
          const remote = await transport.readWorkspace()
          const remoteWorkspace = remote.workspace === null ? null : validateWorkspace(remote.workspace)
          const remoteHash = remoteWorkspace ? workspaceHash(remoteWorkspace) : null
          const baseHash = next.sync.baseHash
          const baseSharedHash = next.sync.baseWorkspace ? sharedWorkspaceHash(next.sync.baseWorkspace) : null
          const remoteSharedHash = remoteWorkspace ? sharedWorkspaceHash(remoteWorkspace) : null
          const localChanged = baseSharedHash ? originalSharedHash !== baseSharedHash : originalHash !== (baseHash || next.sync.initialHash)
          let candidate = clone(next.workspace)
          if (remoteWorkspace && remoteSharedHash !== originalSharedHash) {
            if (!baseHash) {
              // initialHash can describe a customized migrated workspace; it is
              // not evidence that the device has no work to protect.
              if (onlyViewChanges(next.workspace, next.sync.initialWorkspace)) candidate = remoteWorkspace
              else return fail('conflict', 'This device and Nextcloud both have planner customizations without a shared sync history. Both copies are preserved. Export the local planner before choosing how to combine them.', remoteWorkspace, ['first-sync'])
            } else if (!localChanged) candidate = remoteWorkspace
            else if (baseSharedHash ? remoteSharedHash !== baseSharedHash : remoteHash !== baseHash) {
              const base = next.sync.baseWorkspace
              if (!base) return fail('conflict', 'Both devices changed this older planner before a merge baseline was saved. Both copies are preserved; export the local planner and review /Workspace/planner.json.', remoteWorkspace, ['missing-base'])
              const merged = mergeWorkspaces(base, next.workspace, remoteWorkspace)
              if (merged.conflicts.length) return fail('conflict', `Planner sync needs review: both devices changed ${merged.conflicts.slice(0, 3).join(', ')}${merged.conflicts.length > 3 ? ' and other fields' : ''}. Both copies are preserved.`, remoteWorkspace, merged.conflicts)
              try { candidate = validateWorkspace(merged.workspace) }
              catch { return fail('conflict', 'Changes from different devices overlap in linked planner settings. Both copies are preserved; review the local and cloud planner before retrying.', remoteWorkspace, ['combined-settings']) }
            }
          }
          if (!remoteWorkspace && baseHash) return fail('conflict', 'The previously synced cloud workspace was removed. Your local workspace was preserved. Restore the cloud file before syncing again.')
          const resolved = projectNativeIdentities(candidate, next.cache.records)
          candidate = validateWorkspace(resolved.workspace)
          // Preserve the published device fields instead of alternating them
          // between PCs. Timestamp-only/view-only saves need no cloud write.
          let published = remoteWorkspace
          let etag = remote.etag
          if (remote.migrate || !remoteWorkspace || remoteSharedHash !== sharedWorkspaceHash(candidate)) {
            published = withDeviceViewPreferences(candidate, remoteWorkspace || createPlannerWorkspace())
            if (remoteWorkspace && !etag) return fail('error', 'Nextcloud did not provide a file version (ETag). The cloud file was left unchanged to prevent an unsafe overwrite.')
            try { const written=await transport.writeWorkspace(published, etag || null);etag=written.etag;if(written.workspace)published=validateWorkspace(written.workspace) }
            catch (error) {
              if ((error.code === 'CONFLICT' || error.status === 412 || error.statusCode === 412) && attempt < 2) continue
              throw error
            }
          }
          candidate = withDeviceViewPreferences(published, next.workspace)
          if (sharedWorkspaceHash(candidate) === originalSharedHash) candidate.updatedAt = next.workspace.updatedAt
          return this.exclusive(async () => {
            const latest = this.snapshot(), currentHash = workspaceHash(latest.workspace)
            const merged = mergeWorkspaces(startedWorkspace, latest.workspace, candidate)
            let workspace
            try { if (!merged.conflicts.length) workspace = validateWorkspace(merged.workspace) } catch {}
            if (!workspace) {
              latest.sync.status = 'conflict'
              latest.sync.message = 'Planner changes made during sync overlap with incoming changes. Both copies are preserved; review them before retrying.'
              latest.sync.conflictWorkspace = clone(published)
              latest.sync.conflictPaths = merged.conflicts.length ? merged.conflicts : ['combined-settings']
              return this.commit(latest)
            }
            const final = projectNativeIdentities(workspace, latest.cache.records)
            latest.workspace = validateWorkspace(final.workspace); latest.cache.records = final.records
            if (currentHash !== workspaceHash(latest.workspace)) latest.revision++
            const pending = sharedWorkspaceHash(latest.workspace) !== sharedWorkspaceHash(published)
            latest.sync = { ...latest.sync, baseHash: workspaceHash(published), baseWorkspace: clone(published), etag: etag || null, status: pending ? 'pending' : 'synced', message: pending ? 'Newer local changes are saved. Waiting for the next background sync.' : 'Planner customizations synced to Nextcloud Files. Native items stay in their source apps.', lastSyncedAt: new Date().toISOString() }
            if(folderCapable){latest.sync.folder=transport.checkpointValue();if(!pending)latest.sync.message='Planner files synced to Workspace/Nextspace in Nextcloud Files. Only changed links and settings are uploaded.'}
            delete latest.sync.conflictWorkspace; delete latest.sync.conflictPaths
            return this.commit(latest)
          })
        }
      } catch (error) {
        if(['ETAG_UNAVAILABLE','STORAGE_LAYOUT','LEGACY_CHANGED','FOLDER_MISSING','FOLDER_CONFLICT','FOLDER_FORMAT'].includes(error.code))return fail(['LEGACY_CHANGED','FOLDER_MISSING','FOLDER_CONFLICT'].includes(error.code)?'conflict':'error',error.message)
        if (error.code === 'CONFLICT' || error.status === 412 || error.statusCode === 412) return fail('conflict', 'Nextcloud rejected a conditional planner save after three attempts. Your local changes are preserved. Another edit or a server/proxy file-version issue may be responsible; retry sync.')
        return fail('error', error.message?.startsWith('Invalid workspace:') ? 'The cloud workspace is not a supported metadata file. Your local customizations were preserved.' : 'Workspace sync could not finish. Your local customizations are saved. Check the connection and try again.')
      }
  }
}
