/** Durable, account-local metadata. Cloud files use the same protocol as Windows. */
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {projectNativeIdentities, promoteNativeIdentities} from '@nextspace/core/identity.mjs'
import {sourceGroupNameKey} from '@nextspace/core/source-groups.mjs'
import {alignWorkspaceIdentities, mergeWorkspaces, withDeviceViewPreferences} from '@nextspace/core/workspace-merge.mjs'
import {acknowledgePlannerDocuments, FolderWorkspaceClient, PLANNER_FOLDER, plannerPublicationDocuments, sharedFolderHash} from '@nextspace/nextcloud-client/planner-folder.mjs'
import {jsonEqual} from '@nextspace/nextcloud-client/runtime.mjs'
import {syncDiagnostic, plannerFailureMessage} from '@nextspace/nextcloud-client/sync-diagnostics.mjs'
import {normalizeDeviceState} from './foundation.mjs'

const clone = value => structuredClone(value)
const problem = (message, code) => Object.assign(new Error(message), {code})
const sharedEqual = (a, b) => sharedFolderHash(a) === sharedFolderHash(b)
const organization = ['spaces', 'categories', 'projects']
const blockedFolder = code => ['LEGACY_CHANGED', 'FOLDER_MISSING', 'FOLDER_CONFLICT'].includes(code)
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const retryCode = stage => stage === 'planner-read' ? 'PLANNER_READ_CHANGED' : 'PLANNER_WRITE_CHANGED'
const initial = (key, timestamp) => ({version: 1, accountKey: key, ready: false, revision: 0, workspace: {...createPlannerWorkspace(), updatedAt: timestamp}, baseline: null, remoteExists: false, checkpoint: null, etag: null, deviceState: {}, status: 'local', message: 'Connect to load saved Spaces before editing.'})

function validateEnvelope(input, key) {
  const value = clone(input)
  if (value?.version !== 1 || value.accountKey !== key || typeof value.ready !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.remoteExists !== 'boolean' || !['local', 'synced', 'pending', 'conflict', 'error'].includes(value.status)) throw problem('Saved planner metadata could not be read. Its files were preserved.', 'METADATA_FORMAT')
  value.workspace = validateWorkspace(value.workspace)
  if (value.baseline !== null) value.baseline = validateWorkspace(value.baseline)
  if (value.ready !== Boolean(value.baseline)) throw problem('The saved planner baseline is incomplete. Its files were preserved.', 'METADATA_FORMAT')
  if (value.publication !== undefined) {
    const publication = value.publication
    if (!value.ready || !validDigest(publication?.hash)) throw problem('The saved planner publication receipt is invalid.', 'METADATA_FORMAT')
    if (publication.documents !== undefined) {
      const {documents} = publication
      if (!documents || Object.getPrototypeOf(documents) !== Object.prototype || Object.keys(documents).length > 20000 ||
          Object.entries(documents).some(([path, digest]) => !validDigest(path) || !validDigest(digest))) {
        throw problem('The saved planner document receipt is invalid.', 'METADATA_FORMAT')
      }
    }
    value.publication = {...publication, local: publication.local === undefined ? value.workspace : validateWorkspace(publication.local)}
  }
  if (value.checkpoint !== null && (!/^data-[a-f0-9-]{36}$/.test(value.checkpoint?.generation || '') || !Array.isArray(value.checkpoint.paths) || value.checkpoint.paths.length > 60000 || value.checkpoint.paths.some(path => !/^(?:(?:core|organization|settings|dependencies|identities)\.json|(?:links|plans|properties|workflow|arrangements)\/[a-f0-9]{64}\.json)$/.test(path)))) throw problem('The saved planner checkpoint is invalid.', 'METADATA_FORMAT')
  if (value.conflict) {
    value.conflict.base = validateWorkspace(value.conflict.base || clone(value.baseline))
    value.conflict.local = validateWorkspace(value.conflict.local || clone(value.workspace))
    if (value.conflict.remote !== null) value.conflict.remote = validateWorkspace(value.conflict.remote)
    if (!Array.isArray(value.conflict.paths) || value.conflict.paths.some(path => typeof path !== 'string')) throw problem('The saved planner conflict is invalid.', 'METADATA_FORMAT')
    if (['organizationChoice', 'dependencyChoice'].some(field => value.conflict[field] !== undefined && typeof value.conflict[field] !== 'boolean')) throw problem('The saved planner review is invalid.', 'METADATA_FORMAT')
  }
  value.deviceState = normalizeDeviceState(value.deviceState)
  if (value.status === 'conflict' && !value.conflict && value.errorCode === 'CONFLICT') {
    value.status = 'error'
    value.errorStage = value.errorStage === 'planner-write' ? 'planner-write' : 'planner-read'
    value.errorCode = retryCode(value.errorStage)
    value.message = plannerFailureMessage({code: value.errorCode}, value.errorStage)
  }
  const diagnostic = syncDiagnostic({code: value.errorCode}, value.errorStage)
  delete value.errorCode; delete value.errorStage
  Object.assign(value, diagnostic)
  return value
}
function mergeRegistries(base, local, remote) {
  const sameRegistry = (a, b) => {
    if (a.length !== b.length) return false
    const entries = new Map(b.map(entry => [entry.id, entry]))
    return a.every(entry => jsonEqual(entry, entries.get(entry.id)))
  }
  // Only one registry changed. Keep the item IDs in all other fields and
  // prevent the old key from reinterpreting a copied or moved native item.
  const identities = sameRegistry(base.identities, remote.identities) ? local.identities
    : sameRegistry(base.identities, local.identities) ? remote.identities : null
  return identities ? [base, local, remote].map(workspace => ({...workspace, identities})) : [base, local, remote]
}

const dependencyCycle = error => error.message === 'Invalid workspace: dependency cycle'

function mergedWorkspace(base, local, remote) {
  // Only align identities when both shared copies changed. An old native key
  // can now belong to a different item after a move and a subsequent copy.
  const baseHash = sharedFolderHash(base), localHash = sharedFolderHash(local), remoteHash = sharedFolderHash(remote)
  if (baseHash === remoteHash || localHash === remoteHash) return {workspace: clone(local), conflicts: []}
  if (baseHash === localHash) {
    const workspace = withDeviceViewPreferences(remote, local)
    if (Date.parse(local.updatedAt) > Date.parse(workspace.updatedAt)) workspace.updatedAt = local.updatedAt
    return {workspace, conflicts: []}
  }
  const result = mergeWorkspaces(...mergeRegistries(base, local, remote))
  result.conflicts.push(...organizationConflicts(base, local, remote, result.workspace))
  if (result.conflicts.length) return result
  try { result.workspace = validateWorkspace(result.workspace) }
  catch (error) { result.conflicts = [dependencyCycle(error) ? 'relations.dependencies' : 'combined-organization-or-settings'] }
  return result
}

function organizationConflicts(base, local, remote, workspace) {
  const conflicts = []
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
  if ([...duplicateNames(workspace)].some(pair => !existingNames.has(pair))) conflicts.push('categories.names')
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
    if ([...before].some(([id, owners]) => !here.has(id) && there.has(id) && !jsonEqual(there.get(id), owners) || !there.has(id) && here.has(id) && !jsonEqual(here.get(id), owners))) conflicts.push(`spaces[${space.id}].collectionIds`)
  }
  return conflicts
}

function organizationChoiceRequired(base, local, cloud, candidate) {
  if (organizationConflicts(base, local, cloud, candidate).length) return true
  const preview = createPlannerWorkspace()
  for (const name of organization) preview[name] = candidate[name] || []
  try { validateWorkspace(preview); return false }
  catch { return true }
}

function reviewCandidate({base, local, remote}, choice) {
  // A published native key remains canonical when both copies reference it.
  const [mergeBase, mergeLocal, mergeRemote] = mergeRegistries(base, local, remote)
  const canonicalLocal = alignWorkspaceIdentities(mergeLocal, mergeRemote)
  const canonicalBase = alignWorkspaceIdentities(mergeBase, mergeRemote)
  const selected = choice === 'local' ? canonicalLocal : mergeRemote
  const other = choice === 'local' ? mergeRemote : canonicalLocal
  const workspace = mergeWorkspaces(canonicalBase, selected, other).workspace
  const organizationChoice = organizationChoiceRequired(canonicalBase, selected, other, workspace)
  if (organizationChoice) for (const name of organization) workspace[name] = clone(selected[name] || [])
  let dependencyChoice = false
  // Validate the graph in isolation so another domain cannot mask a cycle.
  const dependencyPreview = {...createPlannerWorkspace(), relations: workspace.relations.filter(edge => edge.type === 'depends_on')}
  try { validateWorkspace(dependencyPreview) }
  catch (error) { dependencyChoice = dependencyCycle(error) }
  if (dependencyChoice) workspace.relations = [...workspace.relations.filter(edge => edge.type !== 'depends_on'), ...clone(selected.relations.filter(edge => edge.type === 'depends_on'))]
  return {workspace, organizationChoice, dependencyChoice}
}

export function createMetadataStore({cache, key, client, isActive = () => true, now = Date.now, makeId = () => globalThis.crypto.randomUUID()}) {
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw problem('Invalid metadata account key.', 'METADATA_ACCOUNT')
  const stamp = () => new Date(now()).toISOString()
  let value = initial(key, stamp()), loaded = false, loading, queue = Promise.resolve(), syncing, syncGeneration = 0, observedRecords = []
  const active = () => { if (!isActive()) throw problem('The selected Nextcloud account changed.', 'CANCELLED') }
  // A multi-document save checks account selection before every cloud mutation.
  const guardedClient = new Proxy(client, {get(target, name) {
    const method = target[name]
    if (typeof method !== 'function') return method
    return (...args) => { active(); return method.apply(target, args) }
  }})
  const folder = new FolderWorkspaceClient(guardedClient)
  const exclusive = operation => { const next = queue.then(operation); queue = next.catch(() => {}); return next }
  const state = () => {
    const review = value.conflict?.remote && !blockedFolder(value.errorCode) ? value.conflict : null
    const plannerConflict = review ? {revision: value.revision, paths: [...review.paths], ...(review.organizationChoice ? {organizationChoice: true} : {}), ...(review.dependencyChoice ? {dependencyChoice: true} : {})} : undefined
    return {workspace: clone(value.workspace), revision: value.revision, storage: {localPath: 'Android app storage', remotePath: PLANNER_FOLDER, syncStatus: value.status, message: value.message, ...syncDiagnostic({code: value.errorCode}, value.errorStage), ...(value.lastSyncedAt ? {lastSyncedAt: value.lastSyncedAt} : {})}, metadata: {ready: value.ready, ...(value.conflict ? {conflict: clone(value.conflict)} : {})}, plannerConflict, deviceState: clone(value.deviceState)}
  }
  const commit = async (next, context, publish = true) => {
    active(); context?.check()
    const persisted = clone(next)
    if (persisted.conflict) {
      // A partial acknowledgement may advance the merge basis after review.
      // Keep the reviewed baseline only when it differs from the live one.
      if (jsonEqual(next.conflict.base, next.baseline)) delete persisted.conflict.base
      if (jsonEqual(next.conflict.local, next.workspace)) delete persisted.conflict.local
    }
    // When the durable local snapshot is also the upload basis, store it once.
    if (persisted.publication && jsonEqual(next.publication.local, next.workspace)) delete persisted.publication.local
    try { await (context ? context.wait(cache.save(key, persisted, {isCurrent: () => {context.check(); return true}})) : cache.save(key, persisted)) }
    catch (error) { error.syncStage = 'local-cache'; throw error }
    active(); context?.check(); value = next
    if (publish) return state()
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
  function retainConflict(next, base, remote, paths, stage) {
    const before = next.conflict
    const review = {base: clone(base), local: clone(next.workspace), remote: clone(remote), paths: [...new Set(paths)]}
    if (remote) {
      const local = reviewCandidate(review, 'local'), cloud = reviewCandidate(review, 'remote')
      if (local.organizationChoice || cloud.organizationChoice) review.organizationChoice = true
      if (local.dependencyChoice || cloud.dependencyChoice) review.dependencyChoice = true
    }
    if (!before || !jsonEqual(before, review)) next.revision++
    next.baseline = review.base
    next.conflict = review
    next.status = 'conflict'
    next.message = remote ? 'Saved device and Nextcloud changes overlap. Review the affected planner settings in Settings.' : 'The cloud planner was removed. Your saved changes are preserved; restore it in Nextcloud Files before syncing.'
    Object.assign(next, syncDiagnostic({code: remote ? 'PLANNER_OVERLAP' : 'FOLDER_MISSING'}, stage))
  }

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
    let publication = started.publication
    let mergeBaseline = started.baseline
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        check()
        stage = 'planner-read'; options.onStage?.(stage)
        const read = await context.wait(passFolder.readWorkspace())
        check()
        const remote = read.workspace === null ? null : validateWorkspace(read.workspace)
        if (started.ready && started.remoteExists && remote === null) return exclusive(() => {
          check()
          const next = clone(value)
          retainConflict(next, started.baseline, null, ['remote-removed'], stage)
          return commit(next, context)
        })
        const remoteHash = remote && sharedFolderHash(remote)
        const acknowledged = publication && remoteHash === publication.hash
        const verifiedFolder = remote !== null && read.format === 'folder' && !read.migrate
        let base = mergeBaseline
        if (acknowledged) base = publication.local
        else if (verifiedFolder && publication?.documents) {
          base = acknowledgePlannerDocuments(mergeBaseline, publication.local, remote, publication.documents)
        }
        let candidate
        if (!started.ready) candidate = remote || started.workspace
        else {
          const merged = mergedWorkspace(base, started.workspace, remote || base)
          if (merged.conflicts.length) return exclusive(() => {
            check()
            const paths = value.revision === started.revision ? merged.conflicts : mergedWorkspace(base, value.workspace, remote || base).conflicts
            if (!paths.length) return state()
            const next = clone(value)
            retainConflict(next, base, remote, paths, stage)
            if (acknowledged) delete next.publication
            return commit(next, context)
          })
          candidate = merged.workspace
        }
        // A first read establishes the durable baseline. It never initializes an
        // empty account or migrates a populated legacy account just by opening it.
        const localChanged = started.ready && !sharedEqual(started.workspace, base)
        let published = remote || candidate, etag = read.etag, wrote = false
        const candidateHash = localChanged && sharedFolderHash(candidate)
        if (localChanged && (remote === null || candidateHash !== remoteHash || read.migrate)) {
          check()
          try {
            const documents = verifiedFolder ? plannerPublicationDocuments(base, started.workspace, candidate, remote) : {}
            publication = {hash: candidateHash, local: started.workspace, ...(Object.keys(documents).length ? {documents} : {})}
            await context.wait(exclusive(() => {
              check()
              // The prior receipt will be replaced. Keep its exact matched
              // pieces in the baseline even if the next upload is interrupted.
              return commit({...value, baseline: base, publication}, context, false)
            }))
            mergeBaseline = base
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
            retainConflict(latest, started.workspace, published, merged.conflicts, stage)
            if (wrote) delete latest.publication
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
          delete latest.conflict; delete latest.publication
          delete latest.errorCode; delete latest.errorStage
          options.onStage?.('local-cache'); return commitPass(latest)
        })
      }
    } catch (reason) {
      if (reason.code === 'CANCELLED' || !isActive() || epoch !== syncGeneration || options.isCurrent?.() === false) throw reason
      return exclusive(async () => {
        const next = clone(value)
        const at = reason.syncStage || stage
        const raced = reason.code === 'CONFLICT' || reason.status === 412 || reason.statusCode === 412
        const diagnostic = raced ? {code: retryCode(at)} : reason
        next.status = next.conflict || blockedFolder(reason.code) ? 'conflict' : 'error'
        delete next.errorCode; delete next.errorStage
        Object.assign(next, syncDiagnostic(diagnostic, at))
        next.message = plannerFailureMessage(diagnostic, at)
        check(); return commit(next, context)
      })
    }
  }

  return {
    load,
    getState: () => { requireLoaded(); return state() },
    saveWorkspace: (workspace, expectedRevision, records = observedRecords) => exclusive(async () => {
      requireLoaded(); requireRevision(expectedRevision)
      if (!value.ready) throw problem('Load your existing saved Spaces from Nextcloud before editing.', 'METADATA_NOT_READY')
      let validated = validateWorkspace(clone(workspace))
      // A stale UI object must never remove the connector's identity registry.
      validated.identities = clone(value.workspace.identities)
      validated = validateWorkspace(promoteNativeIdentities(validated, records, makeId).workspace)
      if (jsonEqual(validated, value.workspace)) return state()
      const next = clone(value)
      validated.updatedAt = stamp(); next.workspace = validated; next.revision++
      if (next.conflict) { next.conflict.local = clone(validated); next.status = 'conflict' }
      else next.status = !next.publication && sharedEqual(validated, next.baseline) ? 'synced' : 'pending'
      next.message = next.conflict ? 'Saved on this device. Review the sync conflict before publishing.' : 'Saved on this device. Waiting to sync planner settings.'
      return commit(next)
    }),
    reconcileRecords: (records, options = {}) => exclusive(async () => {
      const context = {check: () => {active(); if (options.isCurrent?.() === false) throw problem('Planner reconciliation was cancelled.', 'CANCELLED')}, wait: promise => options.stopped ? Promise.race([promise, options.stopped]) : promise}
      requireLoaded(); context.check()
      const resolved = projectNativeIdentities(value.workspace, records, makeId)
      observedRecords = resolved.records
      if (value.ready && !jsonEqual(resolved.workspace, value.workspace)) {
        const next = clone(value)
        try {
          next.workspace = validateWorkspace(resolved.workspace); next.revision++
          if (next.conflict) next.conflict.local = clone(next.workspace)
          else { next.status = 'pending'; next.message = 'Referenced source identities are saved on this device and waiting to sync.' }
          await commit(next, context)
        } catch (error) {
          context.check()
          if (['CANCELLED','TIMEOUT'].includes(error?.code)) throw error
          // The source projection is valid independently of planner publication.
          // Preserve the last validated workspace, including its revision, while
          // retaining the native rows and reporting the planner failure separately.
          const failed = {...value, status: value.conflict ? 'conflict' : 'error', message: plannerFailureMessage(error, 'local-cache')}
          delete failed.errorCode; delete failed.errorStage
          Object.assign(failed, syncDiagnostic(error, 'local-cache'))
          try { await commit(failed, context) }
          catch (failure) {context.check(); if (['CANCELLED','TIMEOUT'].includes(failure?.code)) throw failure; value = failed}
        }
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
      if (!saved?.remote || blockedFolder(value.errorCode)) throw problem('Refresh or restore the cloud planner before resolving this conflict.', 'CONFLICT_UNAVAILABLE')
      const {workspace} = reviewCandidate(saved, choice)
      const resolved = validateWorkspace(withDeviceViewPreferences(workspace, value.workspace))
      const next = clone(value)
      next.workspace = resolved; next.workspace.updatedAt = stamp(); next.revision++
      next.baseline = clone(saved.remote); next.remoteExists = true
      delete next.conflict; delete next.publication; delete next.errorCode; delete next.errorStage
      next.status = sharedEqual(next.workspace, next.baseline) ? 'synced' : 'pending'
      next.message = next.status === 'pending' ? 'Conflict choice saved on this device. Waiting to sync.' : 'Cloud settings accepted and saved on this device.'
      return commit(next)
    }),
  }
}
