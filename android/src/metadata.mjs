/** Durable, account-local metadata. Cloud files use the same protocol as Windows. */
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {reconcileIdentities} from '@nextspace/core/identity.mjs'
import {sourceGroupNameKey} from '@nextspace/core/source-groups.mjs'
import {alignWorkspaceIdentities, mergeWorkspaces, withDeviceViewPreferences} from '@nextspace/core/workspace-merge.mjs'
import {FolderWorkspaceClient, PLANNER_FOLDER, sharedFolderHash} from '@nextspace/nextcloud-client/planner-folder.mjs'
import {jsonEqual} from '@nextspace/nextcloud-client/runtime.mjs'
import {syncDiagnostic, plannerFailureMessage} from '@nextspace/nextcloud-client/sync-diagnostics.mjs'
import {normalizeDeviceState} from './foundation.mjs'

const clone = value => structuredClone(value)
const problem = (message, code) => Object.assign(new Error(message), {code})
const sharedEqual = (a, b) => sharedFolderHash(a) === sharedFolderHash(b)
const organization = ['spaces', 'categories', 'projects']
const initial = (key, timestamp) => ({version: 1, accountKey: key, ready: false, revision: 0, workspace: {...createPlannerWorkspace(), updatedAt: timestamp}, baseline: null, remoteExists: false, checkpoint: null, etag: null, deviceState: {}, status: 'local', message: 'Connect to load saved Spaces before editing.'})

function validateEnvelope(input, key) {
  const value = clone(input)
  if (value?.version !== 1 || value.accountKey !== key || typeof value.ready !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.remoteExists !== 'boolean' || !['local', 'synced', 'pending', 'conflict', 'error'].includes(value.status)) throw problem('Saved planner metadata could not be read. Its files were preserved.', 'METADATA_FORMAT')
  value.workspace = validateWorkspace(value.workspace)
  if (value.baseline !== null) value.baseline = validateWorkspace(value.baseline)
  if (value.ready !== Boolean(value.baseline)) throw problem('The saved planner baseline is incomplete. Its files were preserved.', 'METADATA_FORMAT')
  if (value.checkpoint !== null && (!/^data-[a-f0-9-]{36}$/.test(value.checkpoint?.generation || '') || !Array.isArray(value.checkpoint.paths) || value.checkpoint.paths.length > 60000 || value.checkpoint.paths.some(path => !/^(?:(?:core|organization|settings|dependencies|identities)\.json|(?:links|plans|properties|workflow|arrangements)\/[a-f0-9]{64}\.json)$/.test(path)))) throw problem('The saved planner checkpoint is invalid.', 'METADATA_FORMAT')
  if (value.conflict) {
    value.conflict.base = validateWorkspace(value.conflict.base || clone(value.baseline))
    value.conflict.local = validateWorkspace(value.conflict.local || clone(value.workspace))
    if (value.conflict.remote !== null) value.conflict.remote = validateWorkspace(value.conflict.remote)
    if (!Array.isArray(value.conflict.paths) || value.conflict.paths.some(path => typeof path !== 'string')) throw problem('The saved planner conflict is invalid.', 'METADATA_FORMAT')
  }
  value.deviceState = normalizeDeviceState(value.deviceState)
  const diagnostic = syncDiagnostic({code: value.errorCode}, value.errorStage)
  delete value.errorCode; delete value.errorStage
  Object.assign(value, diagnostic)
  return value
}
function mergedWorkspace(base, local, remote) {
  const result = mergeWorkspaces(base, local, remote)
  if (result.conflicts.length) return result
  // Legacy duplicate names remain readable. A merge may not introduce a new
  // collision that neither independently saved organization contained.
  const duplicateNames = workspace => {
    const seen = new Map(), pairs = new Set()
    for (const group of workspace.categories || []) {
      const key = JSON.stringify([group.spaceId, sourceGroupNameKey(group.name)])
      for (const previous of seen.get(key) || []) pairs.add(JSON.stringify([key, ...[previous, group.id].sort()]))
      seen.set(key, [...(seen.get(key) || []), group.id])
    }
    return pairs
  }
  const existingNames = new Set([...duplicateNames(local), ...duplicateNames(remote)])
  if ([...duplicateNames(result.workspace)].some(pair => !existingNames.has(pair))) result.conflicts.push('categories.names')
  // A source removed on one device must not be silently reintroduced through a
  // new group/project assignment from the other device.
  const memberships = (workspace, spaceId) => {
    const space = workspace.spaces.find(item => item.id === spaceId)
    const entries = [...(space?.collectionIds || []).map(id => [id, 'space'])]
    for (const group of workspace.categories || []) if (group.spaceId === spaceId) for (const id of group.collectionIds) entries.push([id, `group:${group.id}`])
    for (const project of workspace.projects) if (project.spaceId === spaceId) for (const id of project.collectionIds) entries.push([id, `project:${project.id}`])
    const result = new Map()
    for (const [id, owner] of entries) result.set(id, [...(result.get(id) || []), owner].sort())
    return result
  }
  for (const space of base.spaces) {
    const before = memberships(base, space.id), here = memberships(local, space.id), there = memberships(remote, space.id)
    if ([...before].some(([id, owners]) => !here.has(id) && there.has(id) && !jsonEqual(there.get(id), owners) || !there.has(id) && here.has(id) && !jsonEqual(here.get(id), owners))) result.conflicts.push(`spaces[${space.id}].collectionIds`)
  }
  if (result.conflicts.length) return result
  try { result.workspace = validateWorkspace(result.workspace) }
  catch { result.conflicts = ['combined-organization-or-settings'] }
  return result
}

export function createMetadataStore({cache, key, client, isActive = () => true, now = Date.now, makeId = () => globalThis.crypto.randomUUID()}) {
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw problem('Invalid metadata account key.', 'METADATA_ACCOUNT')
  const stamp = () => new Date(now()).toISOString()
  let value = initial(key, stamp()), loaded = false, loading, queue = Promise.resolve(), syncing, syncGeneration = 0
  const active = () => { if (!isActive()) throw problem('The selected Nextcloud account changed.', 'CANCELLED') }
  // A multi-document save checks account selection before every cloud mutation.
  const guardedClient = new Proxy(client, {get(target, name) {
    const method = target[name]
    if (typeof method !== 'function') return method
    return (...args) => { active(); return method.apply(target, args) }
  }})
  const folder = new FolderWorkspaceClient(guardedClient)
  const exclusive = operation => { const next = queue.then(operation); queue = next.catch(() => {}); return next }
  const state = () => ({workspace: clone(value.workspace), revision: value.revision, storage: {localPath: 'Android app storage', remotePath: PLANNER_FOLDER, syncStatus: value.status, message: value.message, ...syncDiagnostic({code: value.errorCode}, value.errorStage), ...(value.lastSyncedAt ? {lastSyncedAt: value.lastSyncedAt} : {})}, metadata: {ready: value.ready, ...(value.conflict ? {conflict: clone(value.conflict)} : {})}, deviceState: clone(value.deviceState)})
  const commit = async (next, context) => {
    active(); context?.check()
    const persisted = clone(next)
    if (persisted.conflict) {
      // These are the same values as baseline/workspace. Store each snapshot
      // once so three maximum-size workspaces fit the bounded local cache.
      delete persisted.conflict.base; delete persisted.conflict.local
    }
    try { await (context ? context.wait(cache.save(key, persisted, {isCurrent: () => {context.check(); return true}})) : cache.save(key, persisted)) }
    catch (error) { error.syncStage = 'local-cache'; throw error }
    active(); context?.check(); value = next; return state()
  }
  const load = () => loading ||= exclusive(async () => {
    const saved = await cache.load(key, candidate => validateEnvelope(candidate, key))
    active()
    if (saved !== null) value = cache.validatedLoads ? saved : validateEnvelope(saved, key)
    loaded = true
    folder.setCheckpoint(value.checkpoint)
    return state()
  }).catch(reason => { loading = null; reason.syncStage = 'local-cache'; throw reason })
  const requireLoaded = () => { if (!loaded) throw problem('Load the local planner before using it.', 'METADATA_NOT_LOADED'); active() }
  const requireRevision = expected => { if (!Number.isSafeInteger(expected) || expected !== value.revision) throw problem('This planner changed while the editor was open. Your draft is preserved; review the latest saved version before saving.', 'REVISION_CONFLICT') }
  const conflict = async (base, remote, paths, message, context) => exclusive(async () => {
    active(); context?.check()
    const next = clone(value)
    next.baseline = clone(base)
    next.conflict = {base: clone(base), local: clone(next.workspace), remote: clone(remote), paths: [...paths]}
    next.status = 'conflict'; next.message = message
    Object.assign(next, syncDiagnostic({code: 'CONFLICT'}, 'planner-read'))
    return commit(next, context)
  })

  async function syncCycle(options = {}) {
    const epoch = syncGeneration
    const check = () => {active(); if (epoch !== syncGeneration || options.isCurrent?.() === false) throw problem('Planner synchronization was cancelled.', 'CANCELLED')}
    const context = {check, wait: promise => options.stopped ? Promise.race([promise, options.stopped]) : promise}
    await context.wait(load()); check()
    const started = await context.wait(exclusive(() => {check(); return clone(value)}))
    // Each pass owns its folder/checkpoint. An obsolete provider response can
    // neither continue writing files nor alter the next pass's checkpoint.
    const passClient = new Proxy(client, {get(target, name) {
      const method = target[name]
      if (typeof method !== 'function') return method
      return async (...args) => {check(); const result = await context.wait(method.apply(target, args)); check(); return result}
    }})
    const passFolder = new FolderWorkspaceClient(passClient)
    passFolder.setCheckpoint(started.checkpoint)
    passFolder.cache = new Map(folder.cache)
    const commitPass = async next => {
      const result = await commit(next, context)
      check(); folder.cache = passFolder.cache; folder.setCheckpoint(next.checkpoint)
      return result
    }
    let stage = 'planner-read'
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        check()
        stage = 'planner-read'; options.onStage?.(stage)
        const read = await context.wait(passFolder.readWorkspace())
        check()
        const remote = read.workspace === null ? null : validateWorkspace(read.workspace)
        if (started.ready && started.remoteExists && remote === null) return conflict(started.baseline, null, ['remote-removed'], 'The cloud planner was removed. Your saved changes are preserved; restore it in Nextcloud Files before syncing.', context)
        let candidate
        if (!started.ready) candidate = remote || started.workspace
        else {
          const merged = mergedWorkspace(started.baseline, started.workspace, remote || started.baseline)
          if (merged.conflicts.length) return conflict(started.baseline, remote, merged.conflicts, 'Both devices changed the same planner settings. Review the saved local and cloud copies before syncing.', context)
          candidate = merged.workspace
        }
        // A first read establishes the durable baseline. It never initializes an
        // empty account or migrates a populated legacy account just by opening it.
        const localChanged = started.ready && !sharedEqual(started.workspace, started.baseline)
        let published = remote || candidate, etag = read.etag, wrote = false
        if (localChanged && (remote === null || !sharedEqual(candidate, remote) || read.migrate)) {
          check()
          try {
            stage = 'planner-write'; options.onStage?.(stage)
            const written = await passFolder.writeWorkspace(withDeviceViewPreferences(candidate, remote || createPlannerWorkspace()), read.etag)
            check(); published = validateWorkspace(written.workspace); etag = written.etag; wrote = true
          } catch (reason) {
            if ((reason.code === 'CONFLICT' || reason.status === 412 || reason.statusCode === 412) && attempt < 2) continue
            throw reason
          }
        }
        return exclusive(async () => {
          check()
          const latest = clone(value)
          const incoming = withDeviceViewPreferences(published, started.workspace)
          const merged = mergedWorkspace(started.workspace, latest.workspace, incoming)
          if (merged.conflicts.length) {
            latest.baseline = clone(started.workspace)
            latest.conflict = {base: clone(started.workspace), local: clone(latest.workspace), remote: clone(published), paths: merged.conflicts}
            latest.status = 'conflict'; latest.message = 'Changes saved during sync overlap with incoming changes. Both copies are preserved for review.'
            Object.assign(latest, syncDiagnostic({code: 'CONFLICT'}, 'planner-write'))
            options.onStage?.('local-cache'); return commitPass(latest)
          }
          const nextWorkspace = merged.workspace
          if (sharedEqual(nextWorkspace, latest.workspace)) nextWorkspace.updatedAt = latest.workspace.updatedAt
          if (!jsonEqual(nextWorkspace, latest.workspace)) latest.revision++
          latest.workspace = nextWorkspace
          latest.baseline = clone(published); latest.ready = true; latest.remoteExists = remote !== null || wrote
          latest.etag = etag; latest.checkpoint = passFolder.checkpointValue(); latest.lastSyncedAt = stamp()
          const pending = !sharedEqual(latest.workspace, published)
          latest.status = pending ? 'pending' : 'synced'
          latest.message = pending ? 'Newer changes are saved on this device and waiting for the next sync.' : 'Spaces and planner settings are up to date with Nextcloud.'
          delete latest.conflict
          delete latest.errorCode; delete latest.errorStage
          options.onStage?.('local-cache'); return commitPass(latest)
        })
      }
    } catch (reason) {
      if (reason.code === 'CANCELLED' || !isActive() || epoch !== syncGeneration || options.isCurrent?.() === false) throw reason
      return exclusive(async () => {
        const next = clone(value)
        const blocked = ['LEGACY_CHANGED', 'FOLDER_MISSING', 'FOLDER_CONFLICT', 'CONFLICT'].includes(reason.code)
        next.status = next.conflict || blocked ? 'conflict' : 'error'
        delete next.errorCode; delete next.errorStage
        Object.assign(next, syncDiagnostic(reason, reason.syncStage || stage))
        next.message = plannerFailureMessage(reason, reason.syncStage || stage)
        check(); return commit(next, context)
      })
    }
  }

  return {
    load,
    getState: () => { requireLoaded(); return state() },
    saveWorkspace: (workspace, expectedRevision) => exclusive(async () => {
      requireLoaded(); requireRevision(expectedRevision)
      if (!value.ready) throw problem('Load your existing saved Spaces from Nextcloud before editing.', 'METADATA_NOT_READY')
      const validated = validateWorkspace(clone(workspace))
      // A stale UI object must never remove the connector's identity registry.
      validated.identities = clone(value.workspace.identities)
      validateWorkspace(validated)
      if (jsonEqual(validated, value.workspace)) return state()
      const next = clone(value)
      validated.updatedAt = stamp(); next.workspace = validated; next.revision++
      if (next.conflict) { next.conflict.local = clone(validated); next.status = 'conflict' }
      else next.status = sharedEqual(validated, next.baseline) ? 'synced' : 'pending'
      next.message = next.conflict ? 'Saved on this device. Review the sync conflict before publishing.' : 'Saved on this device. Waiting to sync planner settings.'
      return commit(next)
    }),
    reconcileRecords: (records, options = {}) => exclusive(async () => {
      const context = {check: () => {active(); if (options.isCurrent?.() === false) throw problem('Planner reconciliation was cancelled.', 'CANCELLED')}, wait: promise => options.stopped ? Promise.race([promise, options.stopped]) : promise}
      requireLoaded(); context.check()
      if (!value.ready) return {...state(), records: clone(records), remap: new Map()}
      const resolved = reconcileIdentities(value.workspace, records, makeId)
      if (!jsonEqual(resolved.workspace, value.workspace)) {
        const next = clone(value)
        next.workspace = validateWorkspace(resolved.workspace); next.revision++
        if (next.conflict) next.conflict.local = clone(next.workspace)
        else { next.status = 'pending'; next.message = 'Source identities are saved on this device and waiting to sync.' }
        await commit(next, context)
      }
      context.check()
      return {...state(), records: resolved.records, remap: resolved.remap}
    }),
    saveDeviceState: deviceState => exclusive(async () => {
      requireLoaded()
      const normalized = normalizeDeviceState(deviceState)
      if (jsonEqual(value.deviceState, normalized)) return state()
      const next = clone(value); next.deviceState = normalized
      return commit(next)
    }),
    cancelSync: () => {++syncGeneration},
    sync: (options = {}) => {
      if (syncing) return syncing
      const operation = syncCycle(options)
      syncing = operation
      return operation.finally(() => { if (syncing === operation) syncing = null })
    },
    resolveConflict: (choice, expectedRevision) => exclusive(async () => {
      requireLoaded(); requireRevision(expectedRevision)
      if (!['local', 'remote'].includes(choice)) throw problem('Choose the saved local or cloud organization.', 'CONFLICT_CHOICE')
      const saved = value.conflict
      if (!saved || saved.remote === null) throw problem('Refresh or restore the cloud planner before resolving this conflict.', 'CONFLICT_UNAVAILABLE')
      // The published registry remains canonical regardless of which side's
      // organization wins. Whole-copy organization review must remap curated
      // project IDs too, or it could restore an obsolete local native UUID.
      const canonicalLocal = alignWorkspaceIdentities(value.workspace, saved.remote)
      const canonicalBase = alignWorkspaceIdentities(saved.base, saved.remote)
      const selected = choice === 'local' ? canonicalLocal : saved.remote
      const other = choice === 'local' ? saved.remote : canonicalLocal
      let resolved = mergeWorkspaces(canonicalBase, selected, other).workspace
      // Organization choices are coherent: choosing a source assignment cannot
      // accidentally leave it assigned to two groups after member-array merging.
      if (saved.paths.some(path => organization.some(name => path.startsWith(name)) || path === 'combined-organization-or-settings')) {
        for (const name of organization) resolved[name] = clone(selected[name] || [])
      }
      resolved = withDeviceViewPreferences(validateWorkspace(resolved), value.workspace)
      const next = clone(value)
      next.workspace = resolved; next.workspace.updatedAt = stamp(); next.revision++
      next.baseline = clone(saved.remote); next.remoteExists = true
      delete next.conflict
      next.status = sharedEqual(next.workspace, next.baseline) ? 'synced' : 'pending'
      next.message = next.status === 'pending' ? 'Conflict choice saved on this device. Waiting to sync.' : 'Cloud settings accepted and saved on this device.'
      return commit(next)
    }),
  }
}
