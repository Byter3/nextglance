import {applyReadDenials} from './read-denials.mjs'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {NextcloudClient, normalizeServerUrl} from '@nextspace/nextcloud-client'
import {sha256} from '@nextspace/nextcloud-client/runtime.mjs'
import {syncDiagnostic, plannerFailureMessage} from '@nextspace/nextcloud-client/sync-diagnostics.mjs'
import {createSsoFetch, transportCapabilities} from './transport.mjs'
import {createMetadataStore} from './metadata.mjs'
import {SOURCES, METADATA_DEBOUNCE_MS, checkedAccount, checkedSourceCache, sourceCacheValidator, sourceCacheFingerprint, compactSourceCache, publicSnapshot, problem, validCollection} from './foundation.mjs'
import {createOperationGate} from './operation-gate.mjs'
import {normalizeTheme} from '@nextspace/core/theme-cache.mjs'
import {NATIVE_OPERATIONS, nativeKey, inputObject, boundedString, noteUpdate, dateUpdate, completionUpdate, mergeEditedRefresh} from './native-edits.mjs'
import {taskCreationOptions} from '@nextspace/core/card-tasks.mjs'
import {createSchedulingJournal} from './scheduling.mjs'
import {createSourceEdits} from './source-edits.mjs'
import {normalizeSyncSettings, validateSyncSettings, dueSyncSources} from '@nextspace/core/sync-policy.mjs'
import {calendarPreferences,calendarHistoryEvidence,checkedCalendarHistoryDays} from './calendar-history.mjs'
import {restoreSourceStatuses} from '@nextspace/core/cached-sources.mjs'
import {checkedLaunchCheckpoint, launchCheckpoint} from './launch-cache.mjs'
import {createPerformanceDiagnostics} from '@nextspace/core/performance-diagnostics.mjs'
import {eventEditOperation,eventDeleteOperation,eventRespondOperation,taskDeleteOperation} from '@nextspace/core/native-operations.mjs'
import {plannerExportDocument} from './planner-export.mjs'
import {ViewPreferencesClient} from '@nextspace/nextcloud-client/view-preferences.mjs'
import {createWidgetPublisher,resolveWidgetAction} from './widgets.mjs'

const sources = SOURCES
const clone = value => structuredClone(value)
const empty = () => ({...createEmptyState(), calendarHistoryDays:null, metadata: {ready: false}, deviceState: {}, storage: {syncStatus: 'local', message: 'Connect through Nextcloud to load your sources and saved Spaces.'}})
import {cacheKey,metadataKey,schedulingKey,launchKey,syncSettingsKey,sourceEditsKey} from './account-cache-keys.mjs'
export {cacheKey,metadataKey,schedulingKey,launchKey,syncSettingsKey,sourceEditsKey} from './account-cache-keys.mjs'
const sameAccount = (a, b) => Boolean(a && b && cacheKey(a) === cacheKey(b))
const unavailable = async () => { throw problem('This Android milestone is read-only. Open the source in Nextcloud to edit it.', 'UNAVAILABLE') }

/** Account and request generations keep late results out of a newly selected account. */
export function createMobileController({native, cache, openExternal, widgets, timeZone='UTC', locale='en', isNative = true, hostAvailable = isNative, timers = globalThis, now = Date.now, performanceNow = () => globalThis.performance?.now() ?? Date.now(), appVersion = 'Development', saveDiagnostics, copyDiagnostics, exportPlanner, diagnostics: suppliedDiagnostics, makeMetadataStore = createMetadataStore, makeClient = undefined, makeResourceCache, launchHints = /** @type {any} */ (undefined), deferRestoration = () => new Promise(resolve => globalThis.setTimeout(resolve, 0)), networkStatus = async () => ({connected: true, connectionType: 'unknown'})}) {
  const diagnostics = suppliedDiagnostics || createPerformanceDiagnostics({now: performanceNow, platform: isNative ? 'android' : 'preview', appVersion, canSaveFile: typeof saveDiagnostics === 'function'})
  const measure = async (event, operation, outcome = () => ({success: true})) => {
    if (!diagnostics.summary().recording) return operation()
    const start = performanceNow()
    try {const value = await operation(); diagnostics.record({...event, durationMs: performanceNow() - start, ...outcome(value)}); return value}
    catch (error) {diagnostics.record({...event, stage: 'error', durationMs: performanceNow() - start, success: false, code: error?.code || 'UNKNOWN'}); throw error}
  }
  let state = empty(), account = null, client = null, metadata = null, generation = 0, initialized, refreshPending
  let capabilities = transportCapabilities(), clientTransport = null
  let mutationQueue = Promise.resolve(), sourceEdits = new Map(), noteTagEdits = new Map(), collectionLabelEdits = new Map(), scheduler = null
  let diskQueue = Promise.resolve(), cloudTimer, syncPending, disposed = false
  let loginEpoch = 0, currentFlow = null, sourceReadGeneration = 0
  let restoredDavCheckpoint, completedCalendarHistory, settingsWrite=Promise.resolve()
  const changeSettings = operation => {const result=settingsWrite.then(operation,operation);settingsWrite=result.catch(()=>{});return result}
  let acknowledgedEdits, acknowledgedSequence = 0, sourceArchiveFingerprint
  let launchPending, launchTimer
  let lastReconciliation
  let authorizationPending, plannerPass, hydrationPending, settingsPending, resumePending, pendingEntry = false, appActive = true, authorized = false, lastForegroundEntry = -Infinity
  let deferredEntry = false, pendingOnline = false
  let backgroundReadPending = false
  let sourceAccessGeneration = 0
  let lastAttempts = {}, requestedSources = new Set(), activePass, resumePass
  // Session authority is deliberately separate from source completeness and is
  // never restored from either cache. A fresh inventory can precede a long scan.
  const nativeWriteSources = new Set()
  const independentAccessSources = ['tasks','calendar','deck']
  const stamp = () => new Date(now()).toISOString()
  const syncState = () => state.deviceSync ||= {settings: normalizeSyncSettings(), restoring: false, background: {supported: false, scheduled: false}}
  // Stop read continuation without invalidating an in-flight native mutation.
  // Account changes still pass through the existing operation barrier.
  const cancelPlanner = () => { plannerPass?.cancel(); metadata?.cancelSync?.(); if (syncState().plannerSyncing) syncState().plannerSyncing = false }
  const cancelSourceReads = (code = 'CANCELLED') => { ++sourceReadGeneration; ++sourceAccessGeneration; activePass?.cancel(code); resumePass?.cancel(); delete syncState().activity }
  const authAvailable = () => { if (!hostAvailable || typeof native.beginLogin !== 'function') throw problem('Nextcloud sign-in is unavailable in this host. Start the trusted Android preview or use the Android app.', 'UNAVAILABLE') }
  const methodFor = value => isNative && (value === 'files' || value === 'direct') ? value : undefined
  const withAuthorizationMethod = ({authorizationMethod, ...connection}, value) => {
    const method = methodFor(value)
    return method ? {...connection, authorizationMethod: method} : connection
  }
  const adoptAuthorization = async result => {
    if (!result?.account) return false
    const selected = checkedAccount(result.account)
    cancelSourceReads()
    const epoch = ++generation; refreshPending = null; clearCloudTimer()
    if (sameAccount(selected, account) && !syncState().restoring) {
      if (methodFor(result.authorizationMethod) !== state.connection.authorizationMethod) nativeWriteSources.clear()
      updateTransport(result.capabilities)
      state.connection = withAuthorizationMethod({...state.connection, reconnectRequired: false, recoveryOnly: false, restoreError: undefined}, result.authorizationMethod)
    } else await setAccount(selected, epoch, result.capabilities, {readDenials:result.readDenials, authorizationMethod:result.authorizationMethod})
    authorized = true
    deferredEntry = false; pendingOnline = false
    delete syncState().foregroundError
    lastForegroundEntry = appActive ? now() : -Infinity
    // Native selection cancels the old jobs. Restore the hydrated policy even
    // if no new app entry occurs after completing browser authorization.
    if (isNative && typeof native.configureSync === 'function') {
      const active = account
      syncState().background = {...syncState().background, scheduled: false}
      void Promise.resolve(hydrationPending).then(() => {
        if (!disposed && epoch === generation && active === account) return configureBackground(active, epoch)
      }).catch(() => {})
    }
    void gate.run(() => syncMetadata({automatic: true})).catch(() => {})
    return true
  }
  const gate = createOperationGate(), listeners = new Set(), syncListeners = new Set()
  const disk = work => { const next = diskQueue.then(work); diskQueue = next.catch(() => {}); return next }
  const resolveId = id => {
    const seen = new Set()
    while (state.recordIdAliases?.[id] && !seen.has(id)) { seen.add(id); id = state.recordIdAliases[id] }
    const matches = (state.workspace.identities || []).filter(entry => entry.id === id || entry.aliases?.includes(id))
    if (matches.length === 1) id = matches[0].id
    return id
  }
  const writableSession = () => account && !syncState().restoring && !acknowledgedEdits?.invalid && authorized && !state.connection.reconnectRequired && !state.connection.recoveryOnly
  const snapshot = () => publicSnapshot({...state, ...(acknowledgedEdits?.invalid ? {storage:{...state.storage,syncStatus:'error',errorCode:'CACHE_UNREADABLE',errorStage:'local-cache',message:'Saved native edits could not be recovered. Files are preserved and native editing is disabled.'}} : {}), nativeWriteSources: writableSession() ? [...nativeWriteSources] : [], nativeOperations: writableSession() && capabilities.nativeEdits === 'notes-dates-scheduling' ? [...NATIVE_OPERATIONS] : [], pendingSchedules: (scheduler?.pending() || []).map(pending => ({...pending, recordId: resolveId(pending.recordId)}))})
  const widgetPublisher=widgets?createWidgetPublisher({host:widgets,now,timeZone,locale,timers,current:()=>{
    if(disposed||!account||syncState().restoring||acknowledgedEdits?.invalid||state.storage.errorCode==='CACHE_UNREADABLE')return null
    const active=account,epoch=generation,records=state.records,collections=state.collections,statuses=state.statuses,workspace=state.workspace,revision=state.revision,sequence=acknowledgedSequence,fingerprint=sourceArchiveFingerprint
    return {state,accountKey:cacheKey(active),sourceRevision:fingerprint,acknowledgedEditWatermark:sequence,isCurrent:()=>!disposed&&account===active&&generation===epoch&&state.records===records&&state.collections===collections&&state.statuses===statuses&&state.workspace===workspace&&state.revision===revision&&acknowledgedSequence===sequence&&sourceArchiveFingerprint===fingerprint}
  }}):undefined
  const emit = () => { if (!disposed) for (const listener of listeners) { try { listener(snapshot()) } catch { /* A view listener cannot fail persistence. */ } } }
  const emitSync = () => { if (!disposed) for (const listener of syncListeners) { try { listener(clone(syncState())) } catch { /* A progress listener cannot fail a source read. */ } } }
  const clearCloudTimer = () => { if (cloudTimer !== undefined) timers.clearTimeout(cloudTimer); cloudTimer = undefined }
  const requireReconnection = (context, message = 'Nextcloud authorization is unavailable. Sign in again to reconnect; your saved data is preserved.') => {
    if (context.epoch !== generation || account !== context.active) return false
    cancelSourceReads('RECONNECT_REQUIRED')
    ++generation; refreshPending = null; clearCloudTimer()
    authorized = false; nativeWriteSources.clear(); syncState().plannerSyncing = false; emitSync()
    deferredEntry = false; pendingOnline = false
    state.connection = {...state.connection, connected: false, reconnectRequired: true, restoreError: message}
    state.statuses = state.statuses.map(status => ({...status, state: 'unavailable', message: 'Saved data · authorization is required to refresh.'}))
    emit()
    return true
  }
  const expiredAuthorization = (context, error) => ['PREVIEW_SESSION_EXPIRED', 'RECONNECT_REQUIRED'].includes(error?.code) && requireReconnection(context, error.code === 'PREVIEW_SESSION_EXPIRED' ? 'The preview server restarted. Sign in with Nextcloud again to reconnect; your saved planner remains on this device.' : undefined)
  const createClient = makeClient || ((active, nextCapabilities) => {
    // Observe host expiry before source readers/metadata services turn transport
    // errors into partial results. It is not a Nextcloud permission revocation.
    const transport = {request: async input => {
      if (account !== active) throw problem('The selected Nextcloud account changed.', 'CANCELLED')
      if (state.connection.reconnectRequired || state.connection.recoveryOnly) throw problem('Sign in with Nextcloud to reconnect.', 'UNAVAILABLE')
      const context = {active, epoch: generation}
      const requestedAt=performanceNow()
      try {
        const result = await native.request(input)
        diagnostics.record({kind:'request',method:input.method,durationMs:performanceNow()-requestedAt,status:result?.status,bytes:typeof result?.bodyBase64==='string'?Math.max(0,result.bodyBase64.length*3/4-(result.bodyBase64.endsWith('==')?2:result.bodyBase64.endsWith('=')?1:0)):undefined,success:result?.status>=200&&result?.status<400})
        // readAll turns individual HTTP failures into source statuses. A real
        // 401 still invalidates authorization before that partial-result merge.
        if (result?.status === 401) await deniedAuthentication(context, problem('Nextcloud denied authorization.', 'AUTH'))
        return result
      } catch (error) {diagnostics.record({kind:'request',method:input.method,stage:'error',durationMs:performanceNow()-requestedAt,code:error?.code||'UNKNOWN',success:false}); await deniedAuthentication(context, error); throw error }
    }}
    return new NextcloudClient({serverUrl: active.serverUrl, username: active.username, accountUser: active.username}, {accountKey: cacheKey(active), authentication: 'delegated', davReadMode: nextCapabilities.davReadMode, fileLookupMode: nextCapabilities.davReadMode==='report'?'search':'notes-propfind', onDiagnostic: event => diagnostics.record(event), fetch: createSsoFetch(transport, active, nextCapabilities), ...(makeResourceCache ? {resourceCache: makeResourceCache(active, () => account === active && !disposed)} : {})})
  })
  const scheduleCloudSync = () => {
    clearCloudTimer()
    if (disposed || !appActive || !account || !metadata || state.storage.syncStatus === 'conflict' || state.connection.recoveryOnly || state.connection.reconnectRequired) return
    const active = account, epoch = generation
    const timer = cloudTimer = timers.setTimeout(() => {
      if (cloudTimer !== timer) return
      cloudTimer = undefined
      void gate.run(() => appActive && account === active && generation === epoch ? syncMetadata({automatic: true}) : undefined).catch(() => {})
    }, METADATA_DEBOUNCE_MS)
    cloudTimer?.unref?.()
  }
  const checkExpectedAccount = expected => {
    if (expected && (!account || account.serverUrl !== expected.serverUrl || account.username !== expected.username)) throw Object.assign(new Error('The selected Nextcloud account changed. Reopen this view for the current account.'), {code: 'CANCELLED'})
  }
  const updateTransport = value => {
    const next = transportCapabilities(value)
    if (client && capabilities.davReadMode === next.davReadMode && capabilities.nativeEdits === next.nativeEdits) return
    restoredDavCheckpoint = client?.davCheckpoint?.() || restoredDavCheckpoint
    capabilities = next
    client = createClient(account, capabilities)
    client.primeFileMetadata?.(state.records)
    if (restoredDavCheckpoint) client.primeDavState?.({accountKey: cacheKey(account), records: state.records, collections: state.collections, checkpoint: restoredDavCheckpoint})
    if (clientTransport) clientTransport.current = client
  }
  const setAccount = async (next, epoch = generation, nextCapabilities, {launch = false, readDenials, authorizationMethod} = {}) => {
    if (epoch !== generation) return
    const active = checkedAccount(next)
    clearCloudTimer()
    if (account && !sameAccount(account, active)) {launchHints?.clear?.(cacheKey(account)); diagnostics.clear()}
    cancelPlanner()
    authorizationPending = undefined
    account = active
    client = null
    restoredDavCheckpoint = undefined
    completedCalendarHistory = undefined
    acknowledgedSequence = 0; sourceArchiveFingerprint = undefined
    acknowledgedEdits = active ? createSourceEdits({cache,key:sourceEditsKey(active),accountKey:cacheKey(active),serverUrl:active.serverUrl}) : undefined
    launchPending = undefined; timers.clearTimeout(launchTimer); launchTimer = undefined
    clientTransport = null
    capabilities = transportCapabilities(nextCapabilities)
    metadata = null
    lastReconciliation = undefined
    scheduler = null
    sourceEdits = new Map()
    noteTagEdits = new Map()
    collectionLabelEdits = new Map()
    state = empty()
    nativeWriteSources.clear()
    authorized = false; lastAttempts = {}; requestedSources.clear(); lastForegroundEntry = -Infinity
    deferredEntry = false; pendingOnline = false; pendingEntry = false
    syncState().restoring = Boolean(account)
    if (!account) return
    state.mode = 'live'
    state.connection = withAuthorizationMethod({connected: false, serverUrl: active.serverUrl, username: active.username}, authorizationMethod)
    state.theme = launchHints?.read?.(cacheKey(active))
    if (launch) try {
      const checkpointStarted = performanceNow()
      const saved = await cache.load(launchKey(active), value => checkedLaunchCheckpoint(value, cacheKey(active)))
      if (epoch !== generation) return
      if (saved) {
        const verified = cache.validatedLoads ? saved : checkedLaunchCheckpoint(saved, cacheKey(active))
        state = applyReadDenials({...state, ...verified.state, metadata: {ready: false}},readDenials,active.serverUrl)
        diagnostics.record({kind:'restore',stage:'first-checkpoint',durationMs:performanceNow()-checkpointStarted,count:state.records.length,success:true})
      }
    } catch { /* Disposable first-paint cache; the durable stores remain authoritative. */ }
    if (epoch !== generation) return
    updateTransport(capabilities)
    const requireActive = () => { if (account !== active) throw problem('The selected Nextcloud account changed.', 'CANCELLED') }
    scheduler = createSchedulingJournal({cache, key: schedulingKey(active), context: {
      snapshot, resolve: resolveId,
      state: () => { requireActive(); return state },
      record: id => { requireActive(); return state.records.find(record => record.id === resolveId(id)) },
      collection: id => { requireActive(); return currentCollection(id, 'calendar') },
      client: () => { requireActive(); return client },
      adoptEvent: async (record, verifiedCollection) => { requireActive(); return adoptRecord(record, {active, epoch: generation}, undefined, verifiedCollection) },
      saveWorkspace: async (workspace, revision) => { requireActive(); await saveLocalWorkspace(workspace, revision) },
    }})
    // Keep the metadata store/baseline alive when this account changes transport.
    // Its guarded client resolves each operation to the current private reader.
    const transport = clientTransport = {current: client}
    const metadataClient = new Proxy({}, {get(_target, name) {
      const value = transport.current[name]
      return typeof value === 'function' ? value.bind(transport.current) : value
    }})
    const store = makeMetadataStore({cache, key: metadataKey(active), client: metadataClient, isActive: () => account === active})
    metadata = store
    const journal = scheduler
    const edits = acknowledgedEdits
    const restorationStart = deferRestoration()
    // Read the tiny network policy independently. Foreground authorization can
    // overlap the much larger source archive without bypassing Wi-Fi-only rules.
    settingsPending = Promise.resolve(restorationStart).then(() => epoch === generation && account === active ? cache.load(syncSettingsKey(active)) : undefined).then(value => calendarPreferences(value), () => calendarPreferences())
    hydrationPending = (async () => {
      // Yield past the initial checkpoint publication before parsing private stores.
      await restorationStart
      if (epoch !== generation || account !== active) return
      const restoreStarted = performanceNow()
      let restoredFingerprint
      const sourceValidator = sourceCacheValidator(cacheKey(active), active.serverUrl, value => {restoredFingerprint = sourceCacheFingerprint(value)})
      const [sourceResult, plannerResult, , settingsResult, editsResult] = await measure({kind:'restore',stage:'local-cache'},()=>boundedLocal(Promise.allSettled([
        cache.load(cacheKey(active), sourceValidator),
        store.load(), journal.load(), settingsPending, edits.load(),
      ]), 'Saved data restoration timed out. Files are preserved; reopen to retry.'))
      if (epoch !== generation || account !== active || metadata !== store) return
      {
        const archived = sourceResult.status === 'fulfilled' ? sourceResult.value : undefined
        let saved = archived ? cache.validatedLoads ? archived : checkedSourceCache(archived, cacheKey(active), active.serverUrl) : {version:1,accountKey:cacheKey(active),records:[],collections:[],statuses:[]}
        if (archived) sourceArchiveFingerprint = restoredFingerprint || sourceCacheFingerprint(saved)
        acknowledgedSequence = saved.acknowledgedSequence || 0
        if (editsResult.status === 'fulfilled') {saved = edits.apply(saved); acknowledgedSequence = saved.acknowledgedSequence || 0}
        // The acknowledged overlay is independently durable. Recover it even
        // when neither archive generation can be read, before any fresh read
        // can persist a newer server row with an obsolete edit watermark.
        if (sourceResult.status === 'rejected') {
          const recovered = new Map(saved.records.map(record => [record.id,record]))
          const collections = new Map(saved.collections.map(collection => [collection.id,collection]))
          saved.records = [...state.records.filter(record => !recovered.has(record.id) && !edits.excludes(record)), ...recovered.values()]
          saved.collections = [...state.collections.filter(collection => !collections.has(collection.id)), ...collections.values()]
        }
        saved = applyReadDenials(saved,readDenials,active.serverUrl)
        state.records = saved.records; state.collections = saved.collections
        restoredDavCheckpoint = saved.davCheckpoint
        completedCalendarHistory = calendarHistoryEvidence(saved.calendarHistoryDays)
        if (restoredDavCheckpoint) client.primeDavState?.({accountKey: cacheKey(active), records: state.records, collections: state.collections, checkpoint: restoredDavCheckpoint})
        if (saved.theme) state.theme = saved.theme
        state.statuses = restoreSourceStatuses(sources.map(source => {
          const archivedStatus=saved.statuses.find(status=>status?.source===source),launchStatus=state.statuses.find(status=>status?.source===source)
          const timestamps = [archivedStatus?.lastSyncedAt,launchStatus?.lastSyncedAt].filter(value=>typeof value==='string'&&Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(b)-Date.parse(a))
          return {...(archivedStatus||launchStatus||{source,state:'unavailable'}),lastSyncedAt:timestamps[0]}
        }),state.records)
      }
      if (plannerResult.status === 'fulfilled') state = {...state, ...plannerResult.value}
      else state.storage = {...state.storage, syncStatus: 'error', errorCode: 'CACHE_UNREADABLE', errorStage: 'local-cache', message: 'Saved planner data could not be loaded. Its files are preserved; retry before editing.'}
      syncState().settings = normalizeSyncSettings(settingsResult.status === 'fulfilled' ? settingsResult.value : undefined)
      state.calendarHistoryDays = calendarPreferences(settingsResult.status === 'fulfilled' ? settingsResult.value : undefined).calendarHistoryDays
      if (sourceResult.status === 'rejected') state.storage = {...state.storage, syncStatus: 'error', errorCode: 'CACHE_UNREADABLE', errorStage: 'local-cache', message: 'The local source cache could not be read. Saved files are preserved; refresh to reload sources.'}
      if (editsResult.status === 'rejected') state.storage = {...state.storage, syncStatus: 'error', errorCode: 'CACHE_UNREADABLE', errorStage: 'local-cache', message: 'Saved native edits could not be recovered. Files are preserved and native editing is disabled.'}
      syncState().restoring = false
      diagnostics.record({kind:'restore',stage:'full-restore',durationMs:performanceNow()-restoreStarted,count:state.records.length,success:true})
      launchHints?.save?.(cacheKey(active), state.theme)
      widgetPublisher?.schedule()
      emit()
    })().catch(error => {
      if (epoch === generation && account === active) {
        syncState().restoring = false
        state.storage = {...state.storage, syncStatus: 'error', errorCode: 'CACHE_UNREADABLE', errorStage: 'local-cache', ...syncDiagnostic(error, 'local-cache'), message: error?.code === 'TIMEOUT' ? 'Restoring saved data timed out. The cached view and saved files are preserved; retry planner sync or refresh sources.' : 'Saved data could not be restored completely. Files are preserved; refresh to retry.'}
        emit()
      }
    })
    // A missing disposable checkpoint exposes the themed shell, never an I/O barrier.
    if (!launch) await hydrationPending
  }
  async function reconcileMetadata(store, active, epoch, isCurrent = () => true, stopped) {
    if (!store || epoch !== generation || account !== active || !isCurrent()) return
    const recordsAtStart = state.records
    // Private source arrays are replaced on refresh/edit/revocation. A metadata
    // poll with the same workspace revision has no new identity work to apply.
    // Never reuse caller snapshots or skip the store's own sync/disk validation.
    if (lastReconciliation?.store === store && lastReconciliation.epoch === epoch &&
      lastReconciliation.records === recordsAtStart && lastReconciliation.revision === state.revision &&
      lastReconciliation.ready === state.metadata.ready) return false
    const resolved = await store.reconcileRecords(recordsAtStart, {isCurrent, stopped})
    if (epoch !== generation || metadata !== store || account !== active || !isCurrent()) return
    // A newer source refresh/revocation wins over a queued projection of old rows.
    if (state.records !== recordsAtStart) return reconcileMetadata(store, active, epoch, isCurrent, stopped)
    const {records, remap, ...metadataState} = resolved
    // Reconciliation only changes canonical identity/dependency references. Do
    // not compare or serialize the large raw source documents to detect that.
    const references = record => [record.id, record.identity, record.nativeDependencies, record.nativeDependents, record.nativeRelatedIds]
    const changed = records.length !== recordsAtStart.length || records.some((record, index) => JSON.stringify(references(record)) !== JSON.stringify(references(recordsAtStart[index])))
    state = {...state, ...metadataState, records, recordIdAliases: Object.fromEntries(remap), statuses: state.statuses.map(status => ({...status, count: records.filter(record => record.source === status.source).length}))}
    lastReconciliation = state.storage.syncStatus === 'error' ? undefined : {store, epoch, records, revision: state.revision, ready: state.metadata.ready}
    if (state.storage.syncStatus === 'error') diagnostics.record({kind:'planner',stage:'error',success:false,code:state.storage.errorCode||'UNKNOWN'})
    return changed
  }
  async function syncMetadata({automatic = false} = {}) {
    await initialize()
    if (disposed || automatic && !appActive) return snapshot()
    if (syncPending) return syncPending
    if (!hostAvailable || !account || !metadata) return unavailable()
    if (state.connection.recoveryOnly || state.connection.reconnectRequired || automatic && state.storage.syncStatus === 'conflict') return snapshot()
    clearCloudTimer()
    const active = account, store = metadata, epoch = generation
    let valid = true, stage = 'local-cache', deadline, cancel
    const current = () => valid && !disposed && (!automatic || appActive) && epoch === generation && account === active && metadata === store
    const stopped = new Promise((_, reject) => {
      cancel = () => { valid = false; reject(problem('Planner synchronization was cancelled.', 'CANCELLED')) }
      deadline = timers.setTimeout(() => { valid = false; store.cancelSync?.(); reject(Object.assign(problem('Planner synchronization reached its two-minute time limit. Local changes are preserved; retry planner sync.', 'TIMEOUT'), {syncStage: stage})) }, 120_000)
      deadline?.unref?.()
    })
    const wait = value => Promise.race([value, stopped])
    const pass = plannerPass = {cancel}
    const operation = (async () => {
      try {
        await wait(hydrationPending)
        if (!current()) return snapshot()
        stage = 'authorization'
        if (!authorized && !await wait(verifyAuthorization(current))) return snapshot()
        if (!current()) return snapshot()
        stage = 'planner-read'
        syncState().plannerSyncing = true; emitSync()
        const saved = await wait(measure({kind: 'planner', stage: 'finish'}, async () => {
          await store.sync({isCurrent: current, stopped, onStage: next => {stage = next; diagnostics.record({kind:'planner',stage:next})}})
          return store.getState()
        }, result => {
          const storage = result.storage, success = storage.syncStatus === 'synced'
          return {success, ...(['error', 'conflict'].includes(storage.syncStatus) ? {stage: 'error', code: storage.errorCode || (storage.syncStatus === 'conflict' ? 'CONFLICT' : 'UNKNOWN')} : {})}
        }))
        if (!current()) return snapshot()
        state = {...state, ...saved}
        stage = 'local-cache'
        if (await wait(reconcileMetadata(store, active, epoch, current, stopped))) await wait(saveCache(active, epoch, false, current))
        else await wait(saveLaunch(active, epoch, current))
        if (current() && state.storage.syncStatus === 'synced' && state.storage.lastSyncedAt) syncState().plannerVerifiedAt = state.storage.lastSyncedAt
      } catch (error) {
        expiredAuthorization({active, epoch}, error)
        if (epoch === generation && account === active && error?.code !== 'CANCELLED') state.storage = {...state.storage, syncStatus: 'error', errorCode: undefined, errorStage: undefined, ...syncDiagnostic(error, error.syncStage || stage), message: error.syncStage === 'authorization' ? 'Planner sync could not check Nextcloud authorization in time. Saved changes are preserved; retry when connected.' : plannerFailureMessage(error, error.syncStage || stage)}
      } finally {
        valid = false; timers.clearTimeout(deadline)
        if (plannerPass === pass) plannerPass = undefined
        if (epoch === generation && account === active && metadata === store) {syncState().plannerSyncing = false; emitSync(); emit()}
      }
      if (epoch === generation && state.storage.syncStatus === 'pending') scheduleCloudSync()
      return snapshot()
    })()
    syncPending = operation
    try { return await operation } finally {if (syncPending === operation) syncPending = null}
  }
  const initialize = () => initialized ||= (async () => {
    if (!hostAvailable) return
    try {
      const savedOnly = typeof native.getSavedAccount === 'function'
      const restored = savedOnly ? await native.getSavedAccount() : await native.getAccount()
      await setAccount(restored.account, generation, restored.capabilities, {launch: savedOnly,readDenials:restored.readDenials,authorizationMethod:restored.authorizationMethod})
      if (!account) launchHints?.clear?.()
      authorized = !savedOnly && Boolean(account) && !restored.reconnectRequired && !restored.recoveryOnly
      if (restored.reconnectRequired) state.connection = {...state.connection, connected: false, reconnectRequired: true, restoreError: 'Nextcloud authorization is unavailable. Saved data is preserved; continue with Nextcloud to reconnect.'}
      if (restored.recoveryOnly) { state.connection.recoveryOnly = true; state.storage = {syncStatus: 'recovery', message: 'The saved account identity could not be recovered. Existing files are preserved; reconnect through Nextcloud.'} }
    }
    catch { state.connection = {...state.connection, reconnectRequired: true, recoveryOnly: !account, restoreError: 'Nextcloud account access is unavailable. Continue with Nextcloud to authorize this app.'} }
  })()
  async function verifyAuthorization(isCurrent = () => true) {
    const active = account, epoch = generation
    if (!authorizationPending || authorizationPending.active !== active || authorizationPending.epoch !== epoch) {
      const operation = (async () => {
        let timeout
        try {
          const restored = await measure({kind:'authorization',stage:'finish'}, () => Promise.race([native.getAccount(), new Promise((_, reject) => {timeout = timers.setTimeout(() => reject(problem('Nextcloud authorization check timed out. Saved data is available; retry when the connection recovers.', 'TIMEOUT')), 45_000); timeout?.unref?.()})]))
          if (disposed || epoch !== generation || active !== account) return false
          if (restored.reconnectRequired || restored.recoveryOnly || !restored.account) {
            authorized = false
            if (restored.recoveryOnly) state.connection.recoveryOnly = true
            requireReconnection({active, epoch}); return false
          }
          const selected = checkedAccount(restored.account)
          if (!sameAccount(selected, active)) {
            await setAccount(selected, ++generation, restored.capabilities,{readDenials:restored.readDenials,authorizationMethod:restored.authorizationMethod})
            authorized = true; emit(); return false
          }
          updateTransport(restored.capabilities); authorized = true
          delete syncState().foregroundError
          state.connection = withAuthorizationMethod({...state.connection, reconnectRequired: false, recoveryOnly: false, restoreError: undefined}, restored.authorizationMethod)
          return true
        } finally {timers.clearTimeout(timeout)}
      })()
      const pending = authorizationPending = {active, epoch, operation}
      void operation.finally(() => {if (authorizationPending === pending) authorizationPending = undefined}).catch(() => {})
    }
    return await authorizationPending.operation && isCurrent()
  }
  const saveLaunch = async (active, epoch, isCurrent = () => true) => {
    if (!active || epoch !== generation || syncState().restoring || !isCurrent()) return
    launchHints?.save?.(cacheKey(active), state.theme)
    const value = launchCheckpoint(state, cacheKey(active))
    try {await disk(async () => { if (epoch === generation && account === active && isCurrent()) await cache.save(launchKey(active), value, {isCurrent}) });if(epoch===generation&&account===active&&isCurrent())widgetPublisher?.schedule()}
    catch {
      if (epoch === generation && account === active && isCurrent()) state.storage = {...state.storage, syncStatus: 'error', errorCode: 'CACHE_UNREADABLE', errorStage: 'local-cache', message: 'Changes are saved, but the quick-launch cache could not be updated. Check device storage; the durable planner is preserved.'}
    }
  }
  const queueLaunch = (active, epoch) => {
    launchPending = {active,epoch}
    if (launchTimer !== undefined) return
    launchTimer = timers.setTimeout(() => {
      launchTimer = undefined; const pending = launchPending; launchPending = undefined
      if (!disposed && pending) void saveLaunch(pending.active,pending.epoch).catch(()=>{})
    }, 100)
    launchTimer?.unref?.()
  }
  const archiveValue = (active, sequence = acknowledgedSequence) => compactSourceCache({accountKey:cacheKey(active), acknowledgedSequence:sequence, records:state.records,collections:state.collections,statuses:state.statuses,...(completedCalendarHistory!==undefined?{calendarHistoryDays:completedCalendarHistory}:{}),...(client?.davCheckpoint ? {davCheckpoint:client.davCheckpoint()} : {}),...(state.theme ? {theme:normalizeTheme(state.theme)} : {})})
  const archiveFingerprint = sourceCacheFingerprint
  const saveCache = async (active, epoch, strict = false, isCurrent = () => true) => {
    try {
      await measure({kind:'cache',stage:'cache-write'}, async () => {
        const value = archiveValue(active), fingerprint = archiveFingerprint(value)
        await disk(async () => {
          if (epoch !== generation || !isCurrent()) return
          if (fingerprint !== sourceArchiveFingerprint) {await cache.save(cacheKey(active), value, {isCurrent}); sourceArchiveFingerprint = fingerprint}
        })
        await saveLaunch(active, epoch, isCurrent)
      })
      return epoch === generation && account === active && isCurrent()
    }
    catch (error) {
      if (epoch === generation && account === active && isCurrent() && error?.code !== 'CANCELLED') {
        const warning = {...state.storage, syncStatus: 'error', errorCode: undefined, errorStage: undefined, ...syncDiagnostic(error, 'local-cache'), message: 'Sources loaded, but the offline cache could not be saved on this device. Check available device storage and retry.'}
        state.storage = warning
        // Public first-paint data has no write bases. Preserve a usable readonly
        // launch even if the larger private archive cannot be persisted.
        await saveLaunch(active, epoch, isCurrent)
        if (epoch === generation && account === active && isCurrent()) {state.storage = warning; emit()}
      }
      if (strict) throw error
      return false
    }
  }
  const purgeCache = async active => disk(async () => {
    lastReconciliation = undefined
    sourceArchiveFingerprint = undefined
    try { await cache.remove(launchKey(active)); await cache.remove(cacheKey(active)); await cache.remove(sourceEditsKey(active)) }
    catch {
      // Non-slot storage adapters must also replace both backup generations.
      const cleared = {version: 1, accountKey: cacheKey(active), records: [], collections: [], statuses: []}
      await cache.save(cacheKey(active), cleared)
      await cache.save(cacheKey(active), cleared)
      await cache.save(launchKey(active), null); await cache.save(launchKey(active), null)
      const edits = {version:1,accountKey:cacheKey(active),sequence:acknowledgedSequence,entries:[]}
      await cache.save(sourceEditsKey(active),edits); await cache.save(sourceEditsKey(active),edits)
    }
    if (account === active) {acknowledgedEdits = createSourceEdits({cache,key:sourceEditsKey(active),accountKey:cacheKey(active),serverUrl:active.serverUrl}); await acknowledgedEdits.load()}
  })
  const adoptCollections = (discovery, selected, isCurrent, startTime) => {
    if (!isCurrent() || !Array.isArray(discovery?.sources) || !discovery.sources.length || !Array.isArray(discovery.collections)) return
    const subset = discovery.sources
    if (new Set(subset).size !== subset.length || subset.some(source => !selected.includes(source) || !independentAccessSources.includes(source))) return
    if (discovery.collections.some(collection => !validCollection(collection) || !subset.includes(collection.source)) || new Set(discovery.collections.map(collection => collection.id)).size !== discovery.collections.length) return
    const previousCollections = new Map(state.collections.map(collection => [collection.id, collection]))
    const discovered = clone(discovery.collections).map(collection => {
      const prior = previousCollections.get(collection.id)
      return collection.source === 'deck' && collection.stacks === undefined && prior?.source === 'deck' && prior.stacks ? {...collection, stacks: clone(prior.stacks)} : collection
    })
    state.collections = [...state.collections.filter(collection => !subset.includes(collection.source)), ...discovered]
    state.statuses = state.statuses.map(status => subset.includes(status.source) && (status.permissionDenied || status.revokedCollectionIds?.length || ['AUTH','PERMISSION'].includes(status.errorCode)) ? {...status, state:'unavailable', permissionDenied:undefined, revokedCollectionIds:undefined, errorCode:undefined, errorStage:undefined, message:'Source permissions verified · checking for updates.'} : status)
    for (const source of subset) {
      if (discovery.collections.some(collection => collection.source === source)) nativeWriteSources.add(source)
      else nativeWriteSources.delete(source)
    }
    state.connection = {...state.connection, connected: true, restoreError: undefined}
    diagnostics.record({kind:'source',stage:'discovery',durationMs:Math.max(0,now()-startTime),count:discovery.collections.length,success:true})
    emit()
  }
  async function verifySourceAccess(selected, isCurrent, stopped) {
    if (typeof client?.readSourceAccess !== 'function') return
    const active=account,epoch=generation,readingClient=client,started=now(),accessEpoch=sourceAccessGeneration
    let valid=true, timer
    const current=()=>valid&&accessEpoch===sourceAccessGeneration&&isCurrent()&&account===active&&epoch===generation&&client===readingClient&&!state.connection.reconnectRequired
    try {
      if (!current()) return
      const result=await Promise.race([readingClient.readSourceAccess({sources:selected,isActive:current,onCollections:value=>adoptCollections(value,selected,current,started)}),stopped,new Promise((_,reject)=>{timer=timers.setTimeout(()=>reject(problem('Checking source access timed out. Cached items remain available.','TIMEOUT')),30_000);timer?.unref?.()})])
      if (!current()) return
      for(const error of result?.errors||[]) {
        if(error.code==='AUTH'){await deniedAuthentication({active,epoch},problem('Nextcloud denied authorization.','AUTH'));return}
        if(error.code==='IDENTITY'){requireReconnection({active,epoch},'Nextcloud returned a different account. Reconnect to verify the selected account; saved data is preserved.');return}
        if(!selected.includes(error.source))continue
        if(error.permissionDenied||error.code==='PERMISSION') {
          nativeWriteSources.delete(error.source)
          state=applyReadDenials(state,[{source:error.source,code:'PERMISSION',collection:null}],active.serverUrl)
          await purgeCache(active)
          if(!current())return
          await saveCache(active,epoch,false,current)
        }
        state.statuses=state.statuses.map(status=>status.source===error.source?{...status,state:'error',errorCode:error.code,errorStage:'discovery',message:error.message}:status)
      }
      emit()
    } finally {valid=false;timers.clearTimeout(timer)}
  }
  async function refresh(selected = sources, {verified = false, isCurrent = () => true} = {}) {
    await initialize()
    await hydrationPending
    if (!Array.isArray(selected) || !selected.length || selected.some(source => !sources.includes(source)) || new Set(selected).size !== selected.length) throw problem('Choose valid sources to refresh.', 'VALIDATION')
    if (disposed || !hostAvailable || !account || !isCurrent()) return snapshot()
    if (refreshPending) {
      for (const source of selected) if (!activePass?.sources.includes(source)) requestedSources.add(source)
      return refreshPending
    }
    const active = account, epoch = generation, readGeneration = sourceReadGeneration, calendarHistoryDays=state.calendarHistoryDays
    let valid = true, deadline, cancel, lastProgress = -Infinity, persistAfterTimeout = false, partialRevocation = false
    let revocationCleanup = Promise.resolve()
    const finishedSources = new Set()
    const currentRead = () => valid && !disposed && epoch === generation && account === active && readGeneration === sourceReadGeneration && calendarHistoryDays===state.calendarHistoryDays
    const startTime = now()
    diagnostics.record({kind:'source',stage:'start',count:selected.length})
    let terminalRecorded = false
    const terminal = (code, success = false) => {
      if (terminalRecorded) return
      terminalRecorded = true
      if (!disposed && epoch === generation && account === active) diagnostics.record({kind:'source',stage:code?'error':'finish',durationMs:Math.max(0,now()-startTime),...(code?{code}:{}),completed:finishedSources.size,total:selected.length,success})
    }
    if (selected.some(source => ['tasks', 'calendar'].includes(source))) lastAttempts.caldav = startTime
    if (selected.includes('deck')) lastAttempts.deck = startTime
    if (selected.some(source => ['notes', 'collectives'].includes(source))) lastAttempts.other = startTime
    syncState().activity = {sources: [...selected], stage: verified ? 'discovery' : 'authorization', startedAt: stamp(), lastProgressAt: stamp(), completed: 0, message: verified ? 'Checking selected Nextcloud sources.' : 'Checking Nextcloud authorization.'}
    emitSync()
    const onProgress = progress => {
      if (!currentRead()) return
      const activity = syncState().activity
      if (!activity) return
      if (['authorization', 'discovery', 'source-read', 'local-cache'].includes(progress?.stage)) activity.stage = progress.stage
      if (Array.isArray(progress?.sources) && progress.sources.length && progress.sources.every(source => selected.includes(source))) activity.sources = [...new Set(progress.sources)]
      if (Number.isSafeInteger(progress?.completed) && progress.completed >= 0) activity.completed = progress.completed
      if (Number.isSafeInteger(progress?.total) && progress.total >= activity.completed) activity.total = progress.total
      else delete activity.total
      activity.lastProgressAt = stamp()
      activity.message = typeof progress?.message === 'string' && progress.message.length <= 200 && !/[\x00-\x1f\x7f]/.test(progress.message) ? progress.message : activity.stage === 'discovery' ? 'Checking available sources.' : 'Updating selected Nextcloud sources.'
      if (now() - lastProgress >= 250) { lastProgress = now(); diagnostics.record({kind:'source',stage:activity.stage==='source-read'?'download':activity.stage,completed:activity.completed,total:activity.total});emitSync() }
    }
    const stopped = new Promise((_, reject) => {
      cancel = (code = 'CANCELLED') => { terminal(code); valid = false; reject(problem('The source refresh was cancelled.', 'CANCELLED')) }
      deadline = timers.setTimeout(() => { terminal('TIMEOUT'); valid = false; reject(problem('Source refresh reached its two-minute time limit. Saved items are preserved; retry continues from downloaded resources.', 'TIMEOUT')) }, 120_000)
      deadline?.unref?.()
    })
    activePass = {sources: selected, cancel}
    const operation = (async () => {
      try {
        if (!verified && !await Promise.race([verifyAuthorization(currentRead), stopped])) return snapshot()
        if (!currentRead()) return snapshot()
        const editsAtStart = new Map(sourceEdits)
        const tagsAtStart = new Map(noteTagEdits)
        const labelsAtStart = new Map(collectionLabelEdits)
        const readingClient = client
        const isActive = () => currentRead() && client === readingClient && !state.connection.reconnectRequired && !state.connection.recoveryOnly
        onProgress({stage: 'discovery', completed: 0})
        const certifySources = statuses => {
          for (const status of statuses) {
            if (status.permissionDenied || status.revokedCollectionIds?.length || ['AUTH', 'PERMISSION'].includes(status.errorCode)) nativeWriteSources.delete(status.source)
            else if (status.state === 'connected') nativeWriteSources.add(status.source)
          }
        }
        const onCollections = discovery => adoptCollections(discovery,selected,isActive,startTime)
        const onSource = partial => {
          if (!isActive() || !partial?.statuses?.length) return
          const subset=partial.statuses.map(status=>status.source).filter(source=>selected.includes(source))
          if (!subset.length || subset.length!==partial.statuses.length) return
          partial.statuses=partial.statuses.map(({cached,...status})=>status.state==='connected'?status:{...status,lastSyncedAt:state.statuses.find(old=>old.source===status.source)?.lastSyncedAt})
          const merged=mergeEditedRefresh(state,partial,editsAtStart,sourceEdits,tagsAtStart,noteTagEdits,subset,labelsAtStart,collectionLabelEdits)
          for(const source of subset) finishedSources.add(source)
          certifySources(partial.statuses)
          state={...state,...merged,connection:{...state.connection,connected:nativeWriteSources.size>0||merged.statuses.some(status=>status.state==='connected')}}
          lastReconciliation=undefined
          if (partial.statuses.some(status => status.permissionDenied || status.revokedCollectionIds?.length)) {
            ++sourceAccessGeneration
            partialRevocation = true
            // Revocation is already authoritative even if another source never
            // finishes. Queue both-slot invalidation before any replacement save;
            // cleanup deliberately outlives cancellation of this read pass.
            revocationCleanup = Promise.all([revocationCleanup, purgeCache(active)]).then(() => {})
            void revocationCleanup.catch(error => {
              if (!disposed && epoch === generation && account === active) {
                state.storage = {...state.storage, syncStatus: 'error', ...syncDiagnostic(error, 'local-cache'), message: 'Revoked source content could not be cleared from the offline cache. Check device storage and retry.'}
                emit()
              }
            })
          }
          emit()
        }
        const result = await Promise.race([readingClient.readAll({sources: selected, calendarHistoryDays, isActive, onProgress, onSource, onCollections}), stopped])
        if (!isActive()) return snapshot()
        if(result.statuses.some(status=>status.source==='calendar'&&status.state==='connected'))completedCalendarHistory=calendarHistoryDays
        result.statuses = result.statuses.map(({cached,...status}) => status.state === 'connected' ? status : {...status, lastSyncedAt: state.statuses.find(old => old.source === status.source)?.lastSyncedAt})
        const {records, collections, statuses} = mergeEditedRefresh(state, result, editsAtStart, sourceEdits, tagsAtStart, noteTagEdits, selected, labelsAtStart, collectionLabelEdits)
        certifySources(result.statuses)
        const connected = nativeWriteSources.size>0||statuses.some(status => status.state === 'connected')
        lastReconciliation = undefined
        state = {...state, records, collections, statuses, connection: withAuthorizationMethod({connected, serverUrl: active.serverUrl, username: active.username, ...(!connected ? {restoreError: statuses.some(status => status.errorCode === 'AUTH') ? 'Nextcloud authorization expired. Reconnect to refresh your sources.' : 'Sources could not be refreshed. Open Details to review the cause and retry.'} : {})}, state.connection.authorizationMethod), ...(Object.hasOwn(result, 'theme') ? {theme: normalizeTheme(result.theme)} : {})}
        onProgress({stage: 'local-cache'})
        if (metadata && state.metadata.ready) await Promise.race([reconcileMetadata(metadata, active, epoch, currentRead, stopped), stopped])
        if (!currentRead()) return snapshot()
        if (statuses.every(status => status.permissionDenied)) delete state.theme
        if (result.cacheWarning) state.storage = {...state.storage, syncStatus: 'error', ...result.cacheWarning}
        if (statuses.some(status => status.permissionDenied || status.revokedCollectionIds?.length)) {
          try { await Promise.race([purgeCache(active), stopped]) }
          catch (error) { if (['TIMEOUT', 'CANCELLED'].includes(error?.code)) throw error; if (epoch === generation) state.storage.message = 'Revoked source content could not be cleared from the offline cache.' }
        }
        emit()
        onProgress({stage: 'local-cache'})
        const durable = await Promise.race([saveCache(active, epoch, false, currentRead), stopped])
        if (durable && currentRead() && typeof native.confirmSourceReads === 'function') await native.confirmSourceReads({accountName:active.name,sources:result.statuses.filter(status=>status.state==='connected'&&!status.permissionDenied&&!status.revokedCollectionIds?.length).map(status=>status.source)})
        for (const status of result.statuses) finishedSources.add(status.source)
        terminal(undefined, result.statuses.every(status=>status.state==='connected'))
      } catch (error) {
        terminal(error?.code || 'UNKNOWN')
        if (disposed || epoch !== generation || account !== active || error?.code === 'CANCELLED') return snapshot()
        if (expiredAuthorization({active, epoch}, error)) return snapshot()
        const revoked = ['AUTH', 'PERMISSION'].includes(error?.code)
        if (revoked) { nativeWriteSources.clear(); state.records = []; state.collections = []; delete state.theme; client = null }
        state.connection.connected = false
        if (revoked) state.connection.reconnectRequired = true
        state.connection.restoreError = revoked ? 'Nextcloud access was revoked. Continue with Nextcloud to authorize this app again.' : state.records.length ? 'Could not refresh Nextcloud. Cached items remain available.' : 'Could not refresh Nextcloud. No saved items are available on this device yet.'
        state.statuses = state.statuses.map(status => selected.includes(status.source) && !finishedSources.has(status.source) || revoked ? {...status, state: 'error', errorCode: undefined, errorStage: undefined, ...syncDiagnostic(error, syncState().activity?.stage === 'authorization' ? 'authorization' : syncState().activity?.stage === 'local-cache' ? 'local-cache' : 'source-read'), count: state.records.filter(record => record.source === status.source).length, message: error?.code === 'TIMEOUT' ? error.message : state.connection.restoreError} : status)
        persistAfterTimeout = !revoked && finishedSources.size > 0 && error?.code === 'TIMEOUT'
        state.connection.connected = nativeWriteSources.size>0||state.statuses.some(status => status.state === 'connected')
        if (revoked) {
          try { await Promise.race([purgeCache(active), stopped]) }
          catch { if (epoch === generation) state.storage.message = 'Access was revoked, but the offline cache could not be cleared on this device.' }
        }
      } finally {
        terminal('CANCELLED')
        valid = false; timers.clearTimeout(deadline)
        if (activePass?.cancel === cancel) { activePass = undefined; delete syncState().activity; emitSync() }
        if (epoch === generation && account === active) emit()
        if ((persistAfterTimeout || partialRevocation) && epoch === generation && account === active) void revocationCleanup.then(() => saveCache(active,epoch,false,()=>!disposed&&epoch===generation&&account===active)).catch(()=>{})
      }
      return snapshot()
    })()
    refreshPending = operation
    try { await operation; return snapshot() } finally {
      if (refreshPending === operation) refreshPending = null
      if (requestedSources.size && appActive && epoch === generation && account === active) {
        const queued = [...requestedSources]; requestedSources.clear()
        const isCurrent = () => appActive && epoch === generation && account === active && readGeneration === sourceReadGeneration
        void gate.run(() => refresh(queued, {isCurrent})).catch(() => {})
      }
    }
  }
  function requireLive() {
    if (acknowledgedEdits?.invalid) throw problem('Saved native edits need recovery before another edit can be made. Existing files are preserved.', 'CACHE_UNREADABLE')
    if (syncState().restoring || !authorized || !hostAvailable || !account || !client || !state.connection.connected || state.connection.reconnectRequired || state.connection.recoveryOnly) throw problem('Connect and refresh Nextcloud first. Saved items remain read-only until verified.', 'UNAVAILABLE')
  }
  function requireSource(source) {
    requireLive()
    if (!nativeWriteSources.has(source)) throw problem('Verify this Nextcloud source before editing. Saved items remain read-only until its permissions are checked.', 'UNAVAILABLE')
  }
  function currentRecord(id, source, writable = true) {
    boundedString(id, 'Record id', 2048)
    if (writable) requireSource(source); else requireLive()
    const record = state.records.find(item => item.id === resolveId(id) && (!source || item.source === source))
    if (!record) throw problem('That record is no longer available. Refresh and try again.', 'UNAVAILABLE')
    if (writable && record.readonly) throw problem('This record is read-only in NextGlance.', 'PERMISSION')
    if (writable) currentCollection(record.collectionId, record.source)
    return record
  }
  function currentCollection(id, source) {
    requireSource(source); boundedString(id, 'Source collection', 2048)
    const collection = state.collections.find(item => item.id === id && item.source === source)
    if (!collection || collection.readonly) throw problem('Choose an available writable Nextcloud source.', 'PERMISSION')
    return collection
  }
  function assertContext(context) {
    if (context.epoch !== generation || account !== context.active) throw problem('The selected Nextcloud account changed. This result belongs to its original account.', 'CANCELLED')
  }
  async function deniedAuthentication(context, error) {
    if (expiredAuthorization(context, error)) return
    if (error?.code !== 'AUTH' || context.epoch !== generation || account !== context.active) return
    cancelSourceReads('AUTH')
    const epoch = ++generation; refreshPending = null; clearCloudTimer()
    authorized = false; nativeWriteSources.clear(); syncState().plannerSyncing = false; emitSync()
    deferredEntry = false; pendingOnline = false
    state.records = []; state.collections = []; delete state.theme; client = null
    state.connection = {...state.connection, connected: false, reconnectRequired: true, restoreError: 'Nextcloud access was revoked. Sign in again to reconnect.'}
    state.statuses = state.statuses.map(status => ({...status, state: 'error', permissionDenied: true, count: 0, message: 'Nextcloud denied access.'}))
    try { await purgeCache(context.active); await saveCache(context.active, epoch) }
    catch { if (epoch === generation) state.storage.message = 'Access was revoked, but the offline cache could not be cleared on this device.' }
    finally { emit() }
  }
  function nativeOperation(operation, work) {
    return gate.run(() => {
      const pending = mutationQueue.then(async () => {
        await initialize()
        if (operation && (!hostAvailable || capabilities.nativeEdits !== 'notes-dates-scheduling')) return unavailable()
        requireLive()
        const context = {active: account, epoch: generation, client}
        try { return await work(context) }
        catch (error) {
          const denied = error?.nativePermissionDenied
          if (context.epoch === generation && context.active === account && error?.code === 'PERMISSION' && denied && sources.includes(denied.source) && typeof denied.collectionId === 'string' && state.collections.some(collection => collection.id === denied.collectionId && collection.source === denied.source)) {
            // An older inventory may still be scanning bodies. It must not
            // recertify permissions after the targeted server check disproves it.
            cancelSourceReads('PERMISSION')
            const target = state.collections.find(collection => collection.id === denied.collectionId && collection.source === denied.source)
            const affected = new Set()
            state.collections = state.collections.map(collection => {
              const sameTarget = collection.id === target.id && collection.source === target.source
              const sameDavCollection = ['tasks','calendar'].includes(target.source) && ['tasks','calendar'].includes(collection.source) && target.remote?.href && collection.remote?.href === target.remote.href
              if (!sameTarget && !sameDavCollection) return collection
              affected.add(collection.source); return {...collection, readonly:true}
            })
            for (const source of affected) if (!state.collections.some(collection => collection.source === source && !collection.readonly)) nativeWriteSources.delete(source)
            state.statuses = state.statuses.map(status => affected.has(status.source) ? {...status, state:'error',errorCode:'PERMISSION',errorStage:'source-read',message:'A Nextcloud destination became read-only. Refresh to check its permissions; other writable destinations remain available.'} : status)
            emit()
          }
          await deniedAuthentication(context, error); throw error
        }
      })
      mutationQueue = pending.catch(() => {})
      return pending
    })
  }
  async function saveLocalWorkspace(workspace, revision) {
    if (!metadata || !state.metadata.ready) throw problem('Load your saved Spaces before changing planner links.', 'METADATA_NOT_READY')
    const store = metadata, epoch = generation
    await store.saveWorkspace(workspace, revision, state.records)
    if (epoch !== generation || metadata !== store) throw problem('The selected Nextcloud account changed.', 'CANCELLED')
    state = {...state, ...store.getState()}
    queueLaunch(account, epoch)
    scheduleCloudSync(); emit()
  }
  async function adoptRecord(record, context, previous, verifiedCollection) {
    assertContext(context)
    if (state.statuses.some(status => status.source === record.source && (status.permissionDenied || status.revokedCollectionIds?.includes(record.collectionId)))) throw problem('Nextcloud access to this source changed. Refresh before editing again.', 'PERMISSION')
    const key = nativeKey(record), old = previous ? state.records.find(item => item.id === resolveId(previous.id)) : state.records.find(item => nativeKey(item) === key)
    const updated = {...record, ...(old ? {id: old.id} : {})}
    const collections = [...state.collections]
    if(verifiedCollection){
      const index=collections.findIndex(item=>item.id===updated.collectionId&&item.source===updated.source)
      if(index<0||!validCollection(verifiedCollection)||verifiedCollection.id!==collections[index].id||verifiedCollection.source!==collections[index].source||verifiedCollection.remote?.href!==collections[index].remote?.href)throw problem('The acknowledged calendar belongs to another source. Refresh before editing again.','SECURITY')
      collections[index]=verifiedCollection
    }
    if (updated.source === 'notes' && !collections.some(item => item.id === updated.collectionId)) collections.push({id: updated.collectionId, source: 'notes', title: updated.collectionTitle, remote: {category: updated.remote?.category || ''}})
    lastReconciliation = undefined
    state = {...state, collections, records: [...state.records.filter(item => nativeKey(item) !== key && item.id !== updated.id), updated]}
    sourceEdits.set(key, (sourceEdits.get(key) || 0) + 1)
    if (metadata) await reconcileMetadata(metadata, context.active, context.epoch)
    assertContext(context)
    state.statuses = state.statuses.map(status => ({...status, count: state.records.filter(item => item.source === status.source).length}))
    const stored = state.records.find(item => nativeKey(item) === key) || updated
    const collection = state.collections.find(item => item.id === stored.collectionId && item.source === stored.source)
    await persistAcknowledged(stored, collection, context)
    assertContext(context); emit()
    return state.records.find(item => nativeKey(item) === key) || updated
  }
  async function persistAcknowledged(record, collection, context, deleted = false) {
    const edits = acknowledgedEdits
    const current = () => !disposed && context.epoch === generation && account === context.active && edits === acknowledgedEdits
    await disk(async () => {
      assertContext(context)
      acknowledgedSequence = await edits.save(record,collection,acknowledgedSequence,{isCurrent:current,deleted,fold:async sequence=>{
        const value=archiveValue(context.active,sequence)
        await cache.save(cacheKey(context.active),value,{isCurrent:current});sourceArchiveFingerprint=archiveFingerprint(value)
      }})
    })
    queueLaunch(context.active,context.epoch)
  }
  async function adoptDeletedDav(result, record, collection, context) {
    assertContext(context)
    if (result?.deleted !== true) throw problem(`Nextcloud did not confirm ${record.kind} deletion. Refresh before retrying.`, 'NEXTCLOUD')
    cancelSourceReads()
    state.records = state.records.filter(item => nativeKey(item) !== nativeKey(record))
    lastReconciliation = undefined
    state.statuses = state.statuses.map(status => ({...status, count: state.records.filter(item => item.source === status.source).length}))
    try { await persistAcknowledged(record, collection, context, true) }
    catch {
      assertContext(context)
      const message = `The ${record.kind} was deleted in Nextcloud, but recovery data could not be saved. Refresh before retrying.`
      state.storage = {...state.storage, syncStatus: 'error', errorCode: 'CACHE_WRITE', errorStage: 'local-cache', message}
      emit()
      throw problem(message, 'CACHE_WRITE')
    }
    assertContext(context)
    emit()
    return snapshot()
  }
  async function commitRecord(record, saved, context) {
    const collection = state.collections.find(item => item.id === record.collectionId && item.source === record.source)
    const updated = await context.client.savedRecord(record, collection, saved)
    await adoptRecord(updated, context, record, saved?.verifiedCollection)
    return snapshot()
  }
  async function adoptCreated(source, saved, collection, context) {
    try {
      const {creationWarning, ...record} = await context.client.createdRecord(source, saved, collection)
      const created = await adoptRecord(record, context, undefined, saved?.verifiedCollection)
      return {...snapshot(), createdRecordId: created.id, ...(creationWarning || saved?.warning ? {creationWarning: creationWarning || saved.warning} : {})}
    } catch (error) {
      throw problem('The item was created in Nextcloud, but its local details could not be saved. Refresh this source before creating another item.', error.code === 'CANCELLED' ? 'CANCELLED' : 'CREATED_NOT_ADOPTED')
    }
  }
  function eventRecord(id, operation) {
    const record = currentRecord(id, 'calendar', false)
    const collection = currentCollection(record.collectionId, 'calendar')
    if (record.kind !== 'event') throw problem('Choose an available Nextcloud event.', 'VALIDATION')
    // Generic invitation writes stay locked. Explicit operations use protocol
    // evidence here and independently revalidate native authority before PUT.
    const selector = operation === 'updateEvent' ? eventEditOperation : operation === 'deleteEvent' ? eventDeleteOperation : eventRespondOperation
    if (selector(record,[collection]) !== operation) throw problem('This event action is unavailable. Open the event in Nextcloud for its current permissions.', 'PERMISSION')
    return {record, collection}
  }
  async function rememberTags(record, result, context) {
    assertContext(context)
    const current = state.records.find(item => item.id === resolveId(record.id))
    if (!current) throw problem('This note is no longer available.', 'UNAVAILABLE')
    if (JSON.stringify(current.fileTags) === JSON.stringify(result.tags)) return result
    const updated = {...current, fileTags: result.tags, tagDetails: result.tags, tags: [...new Set([...(current.tags?.includes('Favorite') ? ['Favorite'] : []), ...result.tags.map(tag => tag.title)])]}
    lastReconciliation = undefined
    state.records = state.records.map(item => item.id === current.id ? updated : item)
    const key = nativeKey(current)
    noteTagEdits.set(key, (noteTagEdits.get(key) || 0) + 1)
    await persistAcknowledged(updated,state.collections.find(item=>item.id===updated.collectionId),context)
    assertContext(context); emit()
    return result
  }
  async function rememberAttachments(record,result,context,refreshCard=false){
    assertContext(context)
    let current=state.records.find(item=>nativeKey(item)===nativeKey(record))
    if(!current)throw problem('This card is no longer available.','UNAVAILABLE')
    if(refreshCard){current=await context.client.savedRecord(current,state.collections.find(item=>item.id===current.collectionId),{});assertContext(context)}
    const fileIds=[...new Set(result.attachments.map(item=>item.fileId).filter(Boolean).map(String))]
    if(refreshCard||JSON.stringify(current.attachmentFileIds||[])!==JSON.stringify(fileIds))await adoptRecord({...current,attachmentFileIds:fileIds},context,current)
    return result
  }
  const boundedLocal = async (operation, message) => {
    let timer
    try {return await Promise.race([operation, new Promise((_, reject) => {timer = timers.setTimeout(() => reject(problem(message, 'TIMEOUT')), 10_000); timer?.unref?.()})])}
    finally {timers.clearTimeout(timer)}
  }
  async function configureBackground(active, epoch, settings = syncState().settings) {
    if (!isNative || typeof native.configureSync !== 'function') {
      syncState().background = {supported: false, scheduled: false}; return
    }
    try {
      const result = await boundedLocal(native.configureSync({accountName: active.name, settings: normalizeSyncSettings(settings)}), 'Android background scheduling timed out.')
      if (epoch === generation && account === active) syncState().background = result.background
    } catch {
      if (epoch === generation && account === active) syncState().background = {supported: true, scheduled: false, error: 'Android could not schedule background checks. Retry in Settings.'}
    }
    emitSync()
  }
  function dueSources(scheduling) {
    const settings=syncState().settings,selected=dueSyncSources(settings,state.statuses,lastAttempts,now(),scheduling)
    const last=lastAttempts.caldav
    if(settings.caldavMinutes>0&&completedCalendarHistory!==state.calendarHistoryDays&&(!Number.isFinite(last)||last>now()||now()-last>=settings.caldavMinutes*60_000)&&!selected.includes('calendar'))selected.push('calendar')
    return selected
  }
  async function adoptBackgroundRead(isCurrent) {
    if (!backgroundReadPending || typeof cache.loadChanged !== 'function' || typeof native.getSavedAccount !== 'function') return
    backgroundReadPending = false
    const active=account, epoch=generation, watermark=acknowledgedSequence, history=state.calendarHistoryDays
    let recordsBefore=state.records
    const current=()=>isCurrent()&&account===active&&epoch===generation&&state.calendarHistoryDays===history&&state.records===recordsBefore&&acknowledgedSequence===watermark&&!acknowledgedEdits?.invalid
    const descriptor=await native.getSavedAccount()
    if (!current()) return
    if (!sameAccount(checkedAccount(descriptor.account),active)) {requireReconnection({active,epoch},'The selected Nextcloud account changed. Reconnect to verify it; saved data is preserved.');return}
    // Native background denial evidence is applied even if the projector could
    // not publish a new archive. It must precede both cached display and access.
    let denied
    try {denied=applyReadDenials({...state},descriptor.readDenials,active.serverUrl)}
    catch(error) {
      nativeWriteSources.clear();++sourceAccessGeneration
      state.storage={...state.storage,syncStatus:'error',errorCode:'CACHE_UNREADABLE',errorStage:'local-cache',message:'Saved source access restrictions could not be read. Cached items are preserved; refresh to verify access before editing.'}
      emit();throw error
    }
    if (descriptor.readDenials?.length) {
      ++sourceAccessGeneration
      for(const entry of descriptor.readDenials)nativeWriteSources.delete(entry.source)
      state={...state,records:denied.records,collections:denied.collections,statuses:denied.statuses}
      recordsBefore=state.records
      emit()
    }
    const changed=await cache.loadChanged(cacheKey(active))
    if (!current()) return
    if (!changed.changed || !changed.value || (changed.value.acknowledgedSequence||0)!==watermark) return
    let saved=cache.validatedLoads?changed.value:checkedSourceCache(changed.value,cacheKey(active),active.serverUrl)
    const savedHistory=calendarHistoryEvidence(saved.calendarHistoryDays)
    if(savedHistory!==history&&savedHistory!==completedCalendarHistory)return
    saved=applyReadDenials(acknowledgedEdits.apply(saved),descriptor.readDenials,active.serverUrl)
    // Reconcile against the current authoritative workspace; never replace it,
    // pending requests or local navigation from a background launch checkpoint.
    const resolved=await metadata.reconcileRecords(saved.records,{isCurrent:current})
    if (!current()) return
    const {records,remap,...metadataState}=resolved
    state={...state,...metadataState,records,collections:saved.collections,statuses:restoreSourceStatuses(saved.statuses,records),recordIdAliases:Object.fromEntries(remap)}
    if(saved.theme)state.theme=saved.theme
    restoredDavCheckpoint=saved.davCheckpoint
    completedCalendarHistory=calendarHistoryEvidence(saved.calendarHistoryDays)
    if(restoredDavCheckpoint)client?.primeDavState?.({accountKey:cacheKey(active),records:state.records,collections:state.collections,checkpoint:restoredDavCheckpoint})
    sourceArchiveFingerprint=sourceCacheFingerprint(changed.value)
    lastReconciliation=undefined
    changed.confirm?.()
    diagnostics.record({kind:'restore',stage:'publication',count:records.length,success:true})
    emit()
  }
  async function resumeSync(reason) {
    if (!['open', 'resume', 'timer', 'online'].includes(reason)) throw problem('Invalid refresh trigger.', 'VALIDATION')
    await initialize()
    if (disposed || !appActive || !hostAvailable || !account || state.connection.reconnectRequired || state.connection.recoveryOnly) return snapshot()
    const entering = reason === 'open' || reason === 'resume'
    if (resumePending) {
      if (entering && lastForegroundEntry === -Infinity) pendingEntry = true
      if (reason === 'online' && deferredEntry) pendingOnline = true
      return snapshot()
    }
    if (entering && now() - lastForegroundEntry < 30_000) return snapshot()
    if (entering) {lastForegroundEntry = now(); deferredEntry = true}
    const entryWork = entering || reason === 'online' && deferredEntry
    const active = account, epoch = generation, foregroundGeneration = sourceReadGeneration
    const currentEntry = () => !disposed && appActive && epoch === generation && account === active && sourceReadGeneration === foregroundGeneration
    let cancel
    const stopped = new Promise((_, reject) => {cancel = () => reject(problem('Foreground checking was cancelled.', 'CANCELLED'))})
    const pass = resumePass = {cancel}
    const wait = value => Promise.race([value, stopped])
    let checkStage = 'network'
    const operation = (async () => {
      try {
        const settings = await wait(entryWork ? settingsPending : hydrationPending)
        if (disposed || !currentEntry()) return
        // Restoring the saved job policy is local work. It must not depend on
        // connectivity, a responsive SSO provider or the larger source archive.
        if (entering) void configureBackground(active, epoch, settings)
        if (entering && backgroundReadPending) {
          await wait(hydrationPending)
          let adopting = true
          try {await wait(boundedLocal(adoptBackgroundRead(()=>adopting&&currentEntry()),'Checking saved background updates timed out.'))}
          catch (error) {if(error?.code==='CANCELLED')throw error;diagnostics.record({kind:'restore',stage:'publication',success:false,code:error?.code||'CACHE_UNREADABLE'})}
          finally {adopting = false}
          if (!currentEntry()) return
        }
        const scheduling={independentAccessSources:typeof client?.readSourceAccess==='function'?independentAccessSources:[]}
        if (!entryWork && !dueSources(scheduling).length) return
        const network = await wait(boundedLocal(networkStatus(), 'Network availability could not be checked.'))
        const policy = syncState().restoring && entryWork ? settings : syncState().settings
        if (!currentEntry() || !network.connected || policy.wifiOnly && network.connectionType !== 'wifi') return
        checkStage = 'authorization'
        syncState().activity = {sources: [], stage: 'authorization', startedAt: stamp(), lastProgressAt: stamp(), completed: 0, message: 'Checking Nextcloud authorization.'}
        emitSync()
        const [verified] = await Promise.all([wait(verifyAuthorization(currentEntry)), wait(hydrationPending)])
        if (!verified || !currentEntry()) return
        const selected = dueSources(scheduling)
        delete syncState().activity; delete syncState().foregroundError; emitSync()
        if (entryWork) {deferredEntry = false; pendingOnline = false}
        if (entryWork) void gate.run(() => currentEntry() ? syncMetadata({automatic: true}) : undefined).catch(() => {})
        const accessSources = entryWork ? scheduling.independentAccessSources.filter(source => !selected.includes(source) && !activePass?.sources.includes(source)) : []
        const access = accessSources.length ? gate.run(() => verifySourceAccess(accessSources, currentEntry, stopped)).catch(error => {
          if(currentEntry()&&error?.code!=='CANCELLED')diagnostics.record({kind:'source',stage:'discovery',code:error?.code||'UNKNOWN',success:false})
        }) : undefined
        const reading = selected.length ? gate.run(() => refresh(selected, {verified: true, isCurrent: currentEntry})) : undefined
        await wait(Promise.all([access, reading]))
      } catch (error) {
        if (epoch !== generation || account !== active || !appActive || error?.code === 'CANCELLED') return
        if (expiredAuthorization({active, epoch}, error)) return
        syncState().foregroundError = error?.code === 'TIMEOUT' ? `${checkStage === 'authorization' ? 'Nextcloud authorization' : 'Network availability'} check timed out. Retry when connected; saved data is preserved.` : 'Nextcloud could not be checked. Retry or reconnect in Settings.'
      } finally {
        if (resumePass === pass) resumePass = undefined
        if (epoch === generation && account === active && !activePass) {delete syncState().activity; emitSync()}
      }
    })()
    resumePending = operation
    void operation.finally(() => {
      if (resumePending === operation) resumePending = undefined
      if (pendingEntry && appActive && !disposed) {pendingEntry = false; void resumeSync('resume').catch(() => {})}
      else if (pendingOnline && currentEntry() && !disposed) {
        pendingOnline = false
        if (deferredEntry) void resumeSync('online').catch(() => {})
      }
    }).catch(() => {})
    return snapshot()
  }
  return {
    isNative,
    startDiagnostics: () => diagnostics.start(),
    stopDiagnostics: () => diagnostics.stop(),
    getDiagnostics: () => diagnostics.summary(),
    clearDiagnostics: () => diagnostics.clear(),
    readDiagnostics: () => diagnostics.read(),
    recordDiagnostic: event => diagnostics.record(event),
    saveDiagnostics: async () => {if (typeof saveDiagnostics !== 'function') return {saved:false}; return saveDiagnostics(diagnostics.read())},
    copyDiagnostics: async () => {if (typeof copyDiagnostics !== 'function') return {copied:false}; return copyDiagnostics(diagnostics.read())},
    canAuthenticate: hostAvailable,
    getState: async () => { await initialize(); return snapshot() },
    getViewPreferences: () => gate.run(async () => {
      await initialize(); await hydrationPending
      if (!account || !client || !authorized) throw problem('Connect to load saved filters.', 'UNAVAILABLE')
      const active = account, epoch = generation
      const result = await new ViewPreferencesClient(client).read()
      if (account !== active || epoch !== generation) throw problem('The account changed.', 'CANCELLED')
      return result
    }),
    saveViewPreferences: input => gate.run(async () => {
      await initialize(); await hydrationPending
      if (!account || !client || !authorized) throw problem('Connect to save shared filters.', 'UNAVAILABLE')
      const active = account, epoch = generation
      const guarded = new Proxy(client, {get(target, name) { const value = target[name]; return typeof value === 'function' ? (...args) => { if (account !== active || epoch !== generation) throw problem('The account changed.', 'CANCELLED'); return value.apply(target, args) } : value }})
      const result = await new ViewPreferencesClient(guarded).save(input)
      if (account !== active || epoch !== generation) throw problem('The account changed.', 'CANCELLED')
      return result
    }),
    refresh: () => gate.run(refresh), retryConnection: () => gate.run(refresh),
    takeWidgetAction: async()=>{
      if(!widgets)return null
      await initialize();await hydrationPending
      if(!account||syncState().restoring||acknowledgedEdits?.invalid)return null
      const active=account,epoch=generation,value=await widgets.consumeAction({accountKey:cacheKey(active)})
      if(account!==active||generation!==epoch)throw problem('The selected account changed. Open the widget again.','CANCELLED')
      if(value?.readDenials?.length){
        const denied=applyReadDenials({...state},value.readDenials,active.serverUrl)
        ++sourceAccessGeneration
        for(const entry of value.readDenials)nativeWriteSources.delete(entry.source)
        state={...state,records:denied.records,collections:denied.collections,statuses:denied.statuses}
        emit()
      }
      const resolved=resolveWidgetAction(value,state,{accountKey:cacheKey(active),now:now(),timeZone,locale})
      return resolved&&value?.readDenials?.length?{...resolved,state:snapshot()}:resolved
    },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    subscribeSync: listener => {syncListeners.add(listener); return () => {syncListeners.delete(listener)}},
    resumeSync,
    setAppActive: async active => {
      if (typeof active !== 'boolean') throw problem('Invalid app activity state.', 'VALIDATION')
      appActive = active
      if (!active) {deferredEntry=false;pendingOnline=false;pendingEntry=false;backgroundReadPending=true;clearCloudTimer();cancelSourceReads(); diagnostics.stop('background'); cancelPlanner(); requestedSources.clear(); lastForegroundEntry = -Infinity; emitSync()}
    },
    setSyncSettings: settings => gate.run(()=>changeSettings(async () => {
      const checked = validateSyncSettings(settings)
      await initialize(); await hydrationPending
      if (!account) throw problem('Connect an account before changing sync settings.', 'UNAVAILABLE')
      const active = account, epoch = generation
      await cache.save(syncSettingsKey(active), {...checked,calendarHistoryDays:state.calendarHistoryDays})
      if (epoch !== generation || account !== active) throw problem('The account changed.', 'CANCELLED')
      syncState().settings = checked
      await configureBackground(active, epoch); emit()
      return snapshot()
    })),
    setCalendarHistoryDays: async days => {
      const checked=checkedCalendarHistoryDays(days)
      await initialize();await hydrationPending
      if(!account)throw problem('Connect an account before changing Calendar history.','UNAVAILABLE')
      const active=account,epoch=generation
      cancelSourceReads()
      return gate.run(()=>changeSettings(async()=>{
        if(epoch!==generation||active!==account)throw problem('The account changed.','CANCELLED')
        if(state.calendarHistoryDays===checked)return snapshot()
        cancelSourceReads()
        await cache.save(syncSettingsKey(active),{...syncState().settings,calendarHistoryDays:checked})
        if(epoch!==generation||active!==account)throw problem('The account changed.','CANCELLED')
        state.calendarHistoryDays=checked
        state.statuses=state.statuses.map(status=>status.source==='calendar'?{...status,state:'unavailable',cached:true,message:'Calendar history changed. Refreshing the selected coverage.'}:status)
        emit()
        if(appActive)void gate.run(()=>refresh(['calendar'])).catch(()=>{})
        return snapshot()
      }))
    },
    dispose: () => { widgetPublisher?.close();timers.clearTimeout(launchTimer); launchPending = undefined; cancelSourceReads(); diagnostics.stop('background'); disposed = true; ++generation; cancelPlanner(); refreshPending = null; clearCloudTimer(); listeners.clear(); syncListeners.clear() },
    selectAccount: async () => {
      await initialize()
      if (!isNative) throw new Error('Install the Android app to connect through Nextcloud Files.')
      cancelSourceReads()
      ++loginEpoch; currentFlow = null
      await native.cancelLogin?.({})
      let epoch
      await gate.transition(async () => {
        const result = await native.selectAccount()
        if (!result?.account) throw problem('Nextcloud account selection was cancelled. Your current account is unchanged.', 'CANCELLED')
        if (result.reconnectRequired || result.recoveryOnly) throw problem('Nextcloud did not authorize this account. Choose an account or use browser sign-in.', 'UNAVAILABLE')
        await adoptAuthorization(result)
        epoch = generation
      })
      return epoch === generation ? gate.run(refresh) : snapshot()
    },
    disconnect: async () => {
      await initialize()
      cancelPlanner(); cancelSourceReads()
      ++loginEpoch; currentFlow = null
      await native.cancelLogin?.({})
      await gate.transition(async () => {
        // Clear native selection before reporting a successful disconnect.
        await native.disconnect()
        const epoch = ++generation; refreshPending = null; clearCloudTimer()
        await setAccount(null, epoch)
      })
      return snapshot()
    },
    readPage: ({id}) => gate.run(async () => {
      await initialize()
      const record = state.records.find(record => record.id === id && record.source === 'collectives')
      if (!record || !account || !state.connection.connected) throw new Error('Connect to Nextcloud to read this page.')
      const epoch = generation, active = account
      if (!client) updateTransport(capabilities)
      try {
        const result = await client.readPage(record)
        if (epoch !== generation) throw new Error('The selected Nextcloud account changed.')
        return result
      } catch (error) {
        expiredAuthorization({active, epoch}, error)
        if (epoch === generation && ['AUTH', 'PERMISSION'].includes(error?.code)) {
          cancelSourceReads(error.code)
          const nextEpoch = ++generation
          refreshPending = null; client = null
          const remove = error.code === 'AUTH' ? () => true : item => item.source === 'collectives'
          state.records = state.records.filter(record => !remove(record))
          state.collections = state.collections.filter(collection => !remove(collection))
          state.statuses = state.statuses.map(status => remove(status) ? {...status, state: 'error', permissionDenied: true, count: 0, message: 'Nextcloud denied access to this source.'} : status)
          state.connection.connected = state.statuses.some(status => status.state === 'connected')
          if (error.code === 'AUTH') { state.connection.reconnectRequired = true; delete state.theme }
          // Empty/filtered snapshots supersede any queued pre-revocation write.
          try { await purgeCache(active) }
          catch { if (nextEpoch === generation) state.storage.message = 'Revoked source content could not be cleared from the offline cache.' }
          await saveCache(active, nextEpoch)
        }
        throw error
      }
    }),
    createNote: input => nativeOperation('createNote', async context => {
      requireSource('notes'); inputObject(input)
      if (!metadata || !state.metadata.ready) throw problem('Load your saved planner before creating a note.', 'METADATA_NOT_READY')
      const title = boundedString(input.title, 'Note title', 500), content = boundedString(input.content, 'Note content', 500000, true)
      const collection = input.collectionId ? currentCollection(input.collectionId, 'notes') : undefined
      const category = collection ? collection.remote?.category ?? '' : input.category === undefined ? '' : boundedString(input.category, 'Note category', 200, true)
      const saved = await context.client.createNote({title, content, category})
      try {
        const {creationWarning, ...record} = await context.client.createdRecord('notes', saved, collection)
        const created = await adoptRecord(record, context)
        return {...snapshot(), createdRecordId: created.id, ...(creationWarning || saved?.warning ? {creationWarning: creationWarning || saved.warning} : {})}
      } catch (error) {
        throw problem('The note was created in Nextcloud, but its local details could not be saved. Refresh Notes before creating another note.', error.code === 'CANCELLED' ? 'CANCELLED' : 'CREATED_NOT_ADOPTED')
      }
    }),
    updateNote: input => nativeOperation('updateNote', async context => {
      inputObject(input)
      const record = currentRecord(input.id, 'notes'), change = noteUpdate(input)
      return commitRecord(record, await context.client.updateNote({...change, etag: change.etag ?? record.etag}, record), context)
    }),
    readNote: input => gate.run(async () => {
      await initialize(); inputObject(input)
      const record = currentRecord(input.id, 'notes', false), context = {active: account, epoch: generation, client}
      try {
        const note = await context.client.readNote(record); assertContext(context)
        return {id: record.id, title: note.title, content: note.content, category: note.category, etag: note.etag, readonly: Boolean(note.readonly)}
      } catch (error) { await deniedAuthentication(context, error); throw error }
    }),
    readNoteTags: input => nativeOperation(null, async context => {
      inputObject(input)
      const record = currentRecord(input.id, 'notes', false)
      return rememberTags(record, await context.client.readNoteTags(record), context)
    }),
    setNoteTags: input => nativeOperation('setNoteTags', async context => {
      inputObject(input)
      const record = currentRecord(input.id, 'notes')
      return rememberTags(record, await context.client.setNoteTags(input, record), context)
    }),
    readRelatedResources: input => nativeOperation(null, async context => {
      inputObject(input)
      const record = currentRecord(input.id, undefined, false)
      const result = await context.client.readRelatedResources(record)
      assertContext(context); return result
    }),
    readPageAsset: input => nativeOperation(null, async context => {
      inputObject(input)
      const record = currentRecord(input.id, 'collectives', false)
      const result = await context.client.readPageAsset(record, boundedString(input.path, 'Page image path', 4096))
      assertContext(context); return result
    }),
    createDeckLabel: input => nativeOperation('createDeckLabel', async context => {
      inputObject(input)
      const collection = currentCollection(input.collectionId, 'deck')
      const label = await context.client.createDeckLabel(input, collection)
      assertContext(context)
      state.collections = state.collections.map(item => item.id === collection.id ? {...item, labels: [...(item.labels || []).filter(value => value.id !== label.id), label]} : item)
      collectionLabelEdits.set(collection.id, (collectionLabelEdits.get(collection.id) || 0) + 1)
      await saveCache(context.active, context.epoch, true)
      assertContext(context); emit(); return {label, state: snapshot()}
    }),
    updateRecordAppearance: input => nativeOperation('updateRecordAppearance', async context => {
      inputObject(input)
      const selected = currentRecord(input.id, undefined, false)
      if (!['tasks', 'calendar', 'deck'].includes(selected.source)) throw problem('Choose a task, event or Deck card.', 'VALIDATION')
      const record = currentRecord(input.id, selected.source), collection = currentCollection(record.collectionId, record.source)
      return commitRecord(record, await context.client.updateRecordAppearance(input, record, collection), context)
    }),
    updateTaskStatus: input => nativeOperation('updateTaskStatus', async context => {
      inputObject(input)
      const record = currentRecord(input.id, 'tasks')
      if (record.kind !== 'task') throw problem('Choose an available Nextcloud task.', 'VALIDATION')
      return commitRecord(record, await context.client.updateTaskStatus(input, record), context)
    }),
    moveCard: input => nativeOperation('moveCard', async context => {
      inputObject(input)
      const record = currentRecord(input.id, 'deck'), collection = currentCollection(record.collectionId, 'deck')
      const stackId = boundedString(input.stackId, 'Deck stack', 2048)
      const saved = await context.client.moveCard({stackId}, record, collection)
      return commitRecord(record, saved, context)
    }),
    setDeckDependency: input => nativeOperation('setDeckDependency', async context => {
      inputObject(input)
      const from = currentRecord(input.fromId, 'deck'), to = currentRecord(input.toId, 'deck', false)
      if (input.remove !== undefined && typeof input.remove !== 'boolean') throw problem('Choose a valid card link action.', 'VALIDATION')
      return commitRecord(from, await context.client.setDeckDependency({remove: input.remove === true}, from, to), context)
    }),
    updateRecordDates: input => nativeOperation('updateRecordDates', async context => {
      inputObject(input)
      const candidate = currentRecord(input.id, undefined, false)
      if (!['tasks', 'calendar', 'deck'].includes(candidate.source)) throw problem('Choose a task, card or event to edit its dates.', 'VALIDATION')
      const record = currentRecord(input.id, candidate.source)
      return commitRecord(record, await context.client.updateRecordDates(dateUpdate(input, record), record), context)
    }),
    updateEvent: input => nativeOperation('updateEvent', async context => {
      inputObject(input)
      const {record,collection}=eventRecord(input.id,'updateEvent')
      return commitRecord(record,await context.client.updateEvent(input,record,collection),context)
    }),
    respondToEvent: input => nativeOperation('respondToEvent', async context => {
      inputObject(input)
      const {record,collection}=eventRecord(input.id,'respondToEvent')
      return commitRecord(record,await context.client.respondToEvent(input,record,collection),context)
    }),
    updateDescription: input => nativeOperation('updateDescription', async context => {
      inputObject(input)
      const selected=currentRecord(input.id,undefined,false)
      if(!((selected.source==='tasks'&&selected.kind==='task')||(selected.source==='deck'&&selected.kind==='card')))throw problem('Choose an available Nextcloud task or Deck card.','VALIDATION')
      const record=currentRecord(selected.id,selected.source)
      currentCollection(record.collectionId,record.source)
      const description=boundedString(input.description,'Description',500000,true)
      return commitRecord(record,await context.client.updateDescription({description,...(input.etag!==undefined?{etag:input.etag}:{})},record),context)
    }),
    createCard: input => nativeOperation('createCard', async context => {
      inputObject(input)
      const collection=currentCollection(input.collectionId,'deck')
      if(!metadata||!state.metadata.ready)throw problem('Load your saved planner before creating a card.','METADATA_NOT_READY')
      const change={title:boundedString(input.title,'Card title',255),stackId:boundedString(input.stackId,'Deck stack',2048),description:input.description===undefined?'':boundedString(input.description,'Card description',500000,true)}
      if(input.assignToMe!==undefined){if(typeof input.assignToMe!=='boolean')throw problem('Choose whether to assign the card to you.','VALIDATION');change.assignToMe=input.assignToMe}
      for(const field of ['start','due'])if(input[field]!==undefined)change[field]=boundedString(input[field],'Card date',80,true)
      return adoptCreated('deck',await context.client.createCard(change,collection),collection,context)
    }),
    createTask: input => nativeOperation('createTask', async context => {
      inputObject(input)
      checkExpectedAccount(input.expectedAccount)
      const options=taskCreationOptions(input)
      const collection=currentCollection(input.collectionId,'tasks')
      if(!metadata||!state.metadata.ready)throw problem('Load your saved planner before creating a task.','METADATA_NOT_READY')
      const change={title:boundedString(input.title,'Task title',500),description:input.description===undefined?'':boundedString(input.description,'Task description',500000,true),...options}
      for(const field of ['start','due'])if(input[field]!==undefined)change[field]=boundedString(input[field],'Task date',80,true)
      return adoptCreated('tasks',await context.client.createTask(change,collection),collection,context)
    }),
    createEvent: input => nativeOperation('createEvent', async context => {
      inputObject(input)
      const collection=currentCollection(input.collectionId,'calendar')
      if(!metadata||!state.metadata.ready)throw problem('Load your saved planner before creating an event.','METADATA_NOT_READY')
      const change=Object.fromEntries(['title','start','end','allDay','description','location','reminders','attendees'].filter(key=>input[key]!==undefined).map(key=>[key,input[key]]))
      return adoptCreated('calendar',await context.client.createEvent(change,collection),collection,context)
    }),
    setTaskCompleted: input => nativeOperation('setTaskCompleted', async context => {
      const change = completionUpdate(input), record = currentRecord(input.id, 'tasks')
      if (record.kind !== 'task') throw problem('Choose an available Nextcloud task.', 'VALIDATION')
      currentCollection(record.collectionId, 'tasks')
      return commitRecord(record, await context.client.setTaskCompleted(change, record), context)
    }),
    setCardCompleted: input => nativeOperation('setCardCompleted', async context => {
      const change = completionUpdate(input), record = currentRecord(input.id, 'deck')
      if (record.kind !== 'card') throw problem('Choose an available Deck card.', 'VALIDATION')
      currentCollection(record.collectionId, 'deck')
      return commitRecord(record, await context.client.setCardCompleted(change, record), context)
    }),
    listFiles: input => nativeOperation(null,async context=>{const result=await context.client.listFiles(input||{});assertContext(context);return result}),
    readDeckAttachments: input=>nativeOperation(null,async context=>{
      inputObject(input);const record=currentRecord(input.id,'deck',false)
      return rememberAttachments(record,await context.client.readDeckAttachments(record),context)
    }),
    attachDeckFile: input=>nativeOperation('attachDeckFile',async context=>{
      inputObject(input);const record=currentRecord(input.id,'deck');currentCollection(record.collectionId,'deck')
      if(Boolean(input.path)===Boolean(input.noteId))throw problem('Choose one file or note.','VALIDATION')
      const note=input.noteId?currentRecord(input.noteId,'notes',false):undefined
      return rememberAttachments(record,await context.client.attachDeckFile({path:input.path,note},record),context,true)
    }),
    removeDeckAttachment: input=>nativeOperation('removeDeckAttachment',async context=>{
      inputObject(input);const record=currentRecord(input.id,'deck');currentCollection(record.collectionId,'deck')
      return rememberAttachments(record,await context.client.removeDeckAttachment({attachmentId:input.attachmentId},record),context,true)
    }),
    uploadDeckAttachment: input=>nativeOperation('uploadDeckAttachment',async context=>{
      inputObject(input);const record=currentRecord(input.id,'deck');currentCollection(record.collectionId,'deck')
      await context.client.assertDeckAttachmentWritable(record);assertContext(context)
      const existing=await context.client.readDeckAttachments(record);assertContext(context)
      const picked=await native.chooseAttachment({accountName:context.active.name});assertContext(context)
      if(picked.cancelled)return {...existing,cancelled:true}
      await context.client.assertDeckAttachmentWritable(record);assertContext(context)
      await native.uploadAttachment({accountName:context.active.name,token:picked.token,boardId:record.remote.boardId,stackId:record.remote.stackId,cardId:record.remote.nativeId});assertContext(context)
      return rememberAttachments(record,await context.client.readDeckAttachments(record),context,true)
    }),
    deleteEvent: input=>nativeOperation('deleteEvent',async context=>{
      inputObject(input);const {record,collection}=eventRecord(input.id,'deleteEvent')
      return adoptDeletedDav(await context.client.deleteEvent({id:record.id},record,collection), record, collection, context)
    }),
    deleteTask: input => nativeOperation('deleteTask', async context => {
      inputObject(input)
      checkExpectedAccount(inputObject(input.expectedAccount))
      const record = currentRecord(input.id, 'tasks'), collection = currentCollection(record.collectionId, 'tasks')
      if (record.id !== input.id || record.etag !== input.etag) throw problem('This task changed. Refresh and review it before deleting.', 'CONFLICT')
      if (taskDeleteOperation(record, [collection]) !== 'deleteTask') throw problem('This task cannot be deleted in NextGlance.', 'PERMISSION')
      return adoptDeletedDav(await context.client.deleteTask({id: input.id, etag: input.etag}, record, collection), record, collection, context)
    }),
    createLinkedEvent: input => nativeOperation('createLinkedEvent', async () => {
      requireSource('calendar')
      if (!metadata || !state.metadata.ready) throw problem('Load your saved planner before scheduling work.', 'METADATA_NOT_READY')
      try { return await scheduler.create(input) } finally { emit() }
    }),
    openExternal: async url => {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw problem('Only secure web links can be opened.', 'SECURITY')
      await openExternal(parsed.href)
    },
    saveWorkspace: (workspace, expectedRevision, expectedAccount, options) => gate.run(async () => {
      await initialize()
      if (syncState().restoring) throw problem('Wait for saved planner data to finish restoring before saving changes.', 'METADATA_NOT_READY')
      checkExpectedAccount(expectedAccount)
      if (!hostAvailable || !account || !metadata) return unavailable()
      const store = metadata, epoch = generation
      await store.saveWorkspace(workspace, expectedRevision, state.records)
      if (epoch !== generation || metadata !== store) throw new Error('The selected Nextcloud account changed. Your edit remains saved for its original account.')
      const saved = store.getState()
      state = {...state, ...saved}
      if (options?.coalesceLaunch === true) queueLaunch(account, epoch)
      else await saveLaunch(account, epoch)
      // The durable local commit completes before asynchronous cloud work starts.
      scheduleCloudSync(); emit()
      return {workspace: saved.workspace, revision: saved.revision, storage: saved.storage}
    }),
    syncWorkspace: () => gate.run(() => syncMetadata()),
    resolveWorkspaceConflict: (choice, expectedRevision, expectedAccount) => gate.run(async () => {
      await initialize()
      if (syncState().restoring) throw problem('Wait for saved planner data to finish restoring.', 'METADATA_NOT_READY')
      checkExpectedAccount(inputObject(expectedAccount))
      if (!metadata || !account) return unavailable()
      const store = metadata, active = account, epoch = generation
      // A manual retry can discover a different cloud copy. Let it finish
      // before applying the revision the user reviewed.
      if (syncPending) await syncPending
      checkExpectedAccount(expectedAccount)
      if (epoch !== generation || metadata !== store) throw problem('The selected Nextcloud account changed.', 'CANCELLED')
      await store.resolveConflict(choice, expectedRevision)
      if (epoch !== generation || metadata !== store) return snapshot()
      state = {...state, ...store.getState()}
      await reconcileMetadata(store, active, epoch)
      return syncMetadata()
    }),
    saveDeviceState: (deviceState, expectedAccount) => gate.run(async () => {
      await initialize()
      await hydrationPending
      checkExpectedAccount(expectedAccount)
      if (!metadata || !account) return snapshot()
      const store = metadata, epoch = generation
      await store.saveDeviceState(deviceState)
      if (epoch === generation && metadata === store) state = {...state, ...store.getState()}
      await saveLaunch(account, epoch)
      return snapshot()
    }),
    beginLogin: async (serverUrl, options) => {
      authAvailable(); await initialize()
      serverUrl = normalizeServerUrl(serverUrl)
      const sameAccountOnly = options?.sameAccount === true
      if (sameAccountOnly && (!isNative || !account || serverUrl !== account.serverUrl)) throw problem('Open Settings to switch the current Nextcloud account’s connection.', 'VALIDATION')
      const expectedAccount = sameAccountOnly ? account : null
      const epoch = ++loginEpoch
      currentFlow = null
      const result = await native.beginLogin({serverUrl, ...(expectedAccount ? {expectedAccount} : {})})
      if (epoch !== loginEpoch) { await native.cancelLogin({flowId: result?.flowId}); throw problem('This sign-in was cancelled or replaced.', 'CANCELLED') }
      if (!result || typeof result.flowId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(result.flowId) || typeof result.loginUrl !== 'string') throw problem('Nextcloud returned an invalid sign-in flow.', 'FORMAT')
      let loginUrl, server
      try { loginUrl = new URL(result.loginUrl); server = new URL(serverUrl) }
      catch { await native.cancelLogin({flowId: result.flowId}); throw problem('Nextcloud returned an invalid sign-in URL.', 'FORMAT') }
      if (loginUrl.origin !== server.origin || loginUrl.username || loginUrl.password || loginUrl.hash || !['https:', 'http:'].includes(loginUrl.protocol) || loginUrl.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(loginUrl.hostname)) {
        await native.cancelLogin({flowId: result.flowId}); throw problem('Nextcloud returned an unsafe sign-in URL.', 'SECURITY')
      }
      currentFlow = {id: result.flowId, expectedAccount}
      try { await openExternal(loginUrl.href) }
      catch (error) { currentFlow = null; await native.cancelLogin({flowId: result.flowId}); throw error }
      return {flowId: result.flowId, loginUrl: loginUrl.href}
    },
    pollLogin: async flowId => {
      authAvailable(); await initialize()
      const flow = currentFlow
      if (!flow || flowId !== flow.id) throw problem('This sign-in flow is no longer active.', 'CANCELLED')
      cancelSourceReads()
      let result, adopted = false
      await gate.transition(async () => {
        if (flow !== currentFlow) throw problem('This sign-in flow is no longer active.', 'CANCELLED')
        result = await native.pollLogin({flowId})
        if (result?.pending === true) return
        if (result?.pending !== false || !result.account) throw problem('Nextcloud returned an invalid authorization result.', 'FORMAT')
        if (flow.expectedAccount && !sameAccount(checkedAccount(result.account), flow.expectedAccount)) throw problem('The browser signed in as a different Nextcloud user. Sign in as your current account to switch its connection.', 'AUTH')
        adopted = await adoptAuthorization(result)
        if (currentFlow === flow) currentFlow = null
      })
      if (result.pending) return {pending: true}
      return {pending: false, state: adopted ? await gate.run(refresh) : snapshot()}
    },
    cancelLogin: async flowId => {
      authAvailable(); await initialize()
      const flow = !flowId || currentFlow?.id === flowId ? currentFlow : null
      if (!flowId || flow) { ++loginEpoch; currentFlow = null }
      // Invalidate natively before waiting for a polling barrier. A committed response
      // still returns its selected account, matching the shared cancellation contract.
      const result = await native.cancelLogin(flowId ? {flowId} : {})
      cancelSourceReads()
      let adopted = false
      await gate.transition(async () => {
        const nextCapabilities = transportCapabilities(result?.capabilities)
        if (result?.account && flow?.expectedAccount && !sameAccount(checkedAccount(result.account), flow.expectedAccount)) throw problem('The browser signed in as a different Nextcloud user. Your current account remains selected.', 'AUTH')
        if (result?.account && !result.reconnectRequired && !result.recoveryOnly && (!sameAccount(checkedAccount(result.account), account) || state.connection.reconnectRequired || state.connection.recoveryOnly || methodFor(result.authorizationMethod) !== state.connection.authorizationMethod || nextCapabilities.davReadMode !== capabilities.davReadMode || nextCapabilities.nativeEdits !== capabilities.nativeEdits)) adopted = await adoptAuthorization(result)
      })
      return adopted ? gate.run(refresh) : snapshot()
    },
    connect: unavailable,
    exportWorkspace: () => gate.run(async () => {
      await initialize(); await hydrationPending
      if (!metadata || !state.metadata.ready || typeof exportPlanner !== 'function') throw problem('Load your saved planner before exporting it.', 'METADATA_NOT_READY')
      const result = await exportPlanner(plannerExportDocument(state.workspace))
      if (result?.exported !== true && result?.exported !== false) throw problem('The export destination did not confirm the saved file.', 'UNAVAILABLE')
      return {exported: result.exported}
    }),
  }
}
