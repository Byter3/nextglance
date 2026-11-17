/** Online-only Nextcloud host. Domain rules and source protocols live in shared packages. */
import {NextcloudClient} from '@nextspace/nextcloud-client'
import {portableRuntime} from '@nextspace/nextcloud-client/runtime.mjs'
import {FolderWorkspaceClient, sharedFolderHash, PLANNER_FOLDER} from '@nextspace/nextcloud-client/planner-folder.mjs'
import {ViewPreferencesClient} from '@nextspace/nextcloud-client/view-preferences.mjs'
import {createEmptyState, createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {mergeWorkspaces, withDeviceViewPreferences} from '@nextspace/core/workspace-merge.mjs'
import {reconcileIdentities} from '@nextspace/core/identity.mjs'
import {mergeSourceRefresh} from '@nextspace/core/source-refresh.mjs'
import {eventEditOperation,eventDeleteOperation,eventRespondOperation} from '@nextspace/core/native-operations.mjs'
import {taskCreationOptions} from '@nextspace/core/card-tasks.mjs'
import {createSessionTransport, webProblem} from './session-transport.mjs'

const SOURCES = ['tasks','calendar','deck','notes','collectives']
export const WEB_NATIVE_OPERATIONS = Object.freeze(['createNote','updateNote','setNoteTags','createTask','setTaskCompleted','setTaskDue','updateTaskStatus','createCard','setCardCompleted','moveCard','setDeckDependency','updateDescription','updateRecordDates','updateRecordAppearance','createDeckLabel','createEvent','updateEvent','respondToEvent','deleteEvent','listFiles','readDeckAttachments','attachDeckFile','removeDeckAttachment','uploadDeckAttachment'])
const key = record => record.identity ? JSON.stringify([record.identity.source,record.identity.key]) : record.id
const copy = value => structuredClone(value)
const serial = () => { let tail = Promise.resolve(); return fn => { const task = tail.then(fn); tail = task.catch(() => {}); return task } }

export function createWebController(options) {
  const now = options.now || (() => new Date()), makeId = options.randomUUID || (() => crypto.randomUUID())
  let state = createEmptyState(), host = {phase:'opening'}, session, client, folder, viewPreferences, base, etag, initialized, refreshing, disposed = false, epoch = 0, editSequence = 0
  let online = options.online ? options.online() : true, lastPlannerRead=0, lastSourceRefresh=0, readGeneration=0
  const listeners = new Set(), hostListeners = new Set(), syncListeners = new Set(), edits = new Map(), itemQueues = new Map(), metadata = serial(), preferenceWrites = serial()
  const operations = WEB_NATIVE_OPERATIONS.filter(name => name !== 'uploadDeckAttachment' || options.selectUpload)
  const hostEmit = () => { for (const listener of hostListeners) listener({...host}) }
  function setHost(phase,message) { host = {phase,...(message ? {message} : {}),...(session ? {userId:session.userId,loginUrl:session.loginUrl,sourceUrl:session.sourceUrl,appVersion:session.appVersion} : {})}; hostEmit() }
  function snapshot() {
    const write = new Set(online && host.phase === 'ready' ? state.nativeWriteSources || [] : [])
    const collectionsById=new Map(state.collections.map(collection=>[collection.id,collection]))
    const records = state.records.map(({remote,...record}) => ({...record,...(remote?.category !== undefined ? {remote:{category:remote.category}} : {}),...(write.has(record.source)&&!collectionsById.get(record.collectionId)?.readonly ? {} : {readonly:true})}))
    const collections = state.collections.map(({remote,...collection}) => ({...collection,...(write.has(collection.source) ? {} : {readonly:true})}))
    return copy({...state,records,collections,nativeOperations:online && host.phase === 'ready' ? operations : [],nativeWriteSources:[...write]})
  }
  function emit() { if (disposed) return; const value = snapshot(); for (const listener of listeners) listener(value); for (const listener of syncListeners) listener(copy(value.deviceSync)) }
  function expire(message) {
    epoch++; client = null; folder = null; viewPreferences = null; base = null; etag = null; edits.clear()
    state = {...createEmptyState(),nativeOperations:[],nativeWriteSources:[],connection:{connected:false,reconnectRequired:true},storage:{remotePath:PLANNER_FOLDER,syncStatus:'error',message,errorCode:'AUTH'}}
    setHost('expired',message); emit()
  }
  const transport = createSessionTransport({...options,online:()=>online,onExpired:expire})
  function active(captured = epoch) { if (disposed || captured !== epoch || host.phase === 'expired') throw webProblem('The Nextcloud session changed. Reload this page.', 'CANCELLED') }
  async function verify() {
    if (!online) throw webProblem('You are offline. Reconnect before saving.', 'OFFLINE')
    if (host.phase === 'expired') throw webProblem('Reload after signing in to Nextcloud.', 'AUTH')
    const captured = epoch;let value
    try{value=await transport.verify();active(captured)}catch(error){
      if(captured===epoch&&host.phase!=='expired'&&['NETWORK','TIMEOUT','OFFLINE'].includes(error.code)){setHost('offline',error.message);emit()}
      throw error
    }
    session = value
    if (!client) {
      client = (options.createClient || ((account, opts) => new NextcloudClient(account,opts)))({serverUrl:value.serverUrl,username:value.userId,accountUser:value.userId},{fetch:transport.fetch,authentication:'delegated',now,runtime:{...portableRuntime,randomUUID:makeId}})
      folder = (options.createFolder || (native => new FolderWorkspaceClient(native)))(client)
      viewPreferences = (options.createViewPreferences || (native => new ViewPreferencesClient(native)))(client)
    }
    state.connection = {connected:true,serverUrl:value.serverUrl,username:value.userId}
    if(host.phase==='offline'&&base){setHost('ready');emit()}
    return captured
  }
  function plannerError(error) {
    state.storage = {...state.storage,syncStatus:'error',message:error.message,errorCode:error.code || 'NETWORK',errorStage:'planner-sync'}
  }
  async function loadPlanner() {
    const captured = await verify(), remote = await folder.readWorkspace(); active(captured)
    // A successful missing-file response alone may initialize an empty planner.
    const workspace = remote.workspace ? validateWorkspace(remote.workspace) : createPlannerWorkspace()
    let visible=workspace
    if(base&&sharedFolderHash(state.workspace)!==sharedFolderHash(base)){
      if(!remote.workspace)throw webProblem('The remote planner is missing while this page has unsaved metadata. Reload and review before continuing.', 'CONFLICT')
      const merged=mergeWorkspaces(base,state.workspace,workspace)
      if(merged.conflicts.length)throw webProblem('Planner metadata conflicts with another session. Review before retrying.', 'CONFLICT')
      visible=merged.workspace
    }
    base = copy(workspace); etag = remote.etag
    lastPlannerRead=now().getTime()
    state.workspace = withDeviceViewPreferences(visible,state.workspace); state.revision++
    state.storage = {remotePath:PLANNER_FOLDER,syncStatus:'synced',lastSyncedAt:now().toISOString()}
  }
  async function initialize() {
    if (!initialized) initialized = (async () => {
      try { await loadPlanner(); active(); state.mode = 'live'; setHost('ready'); emit() }
      catch (error) { if (host.phase !== 'expired') { plannerError(error); setHost(online ? 'error' : 'offline',error.message); emit() }; throw error }
    })().catch(error => { initialized = null; throw error })
    return initialized
  }
  async function savePlanner(desired, expectedRevision) {
    await initialize(); const captured = await verify(); active(captured)
    if (expectedRevision !== undefined && expectedRevision !== state.revision) throw webProblem('Planner data changed. Review the latest view and retry.', 'CONFLICT')
    let next = validateWorkspace(desired), reference = copy(base)
    if (sharedFolderHash(next) === sharedFolderHash(base)) { state.workspace = copy(next); state.revision++; emit(); return snapshot() }
    state.storage = {...state.storage,syncStatus:'syncing'}; emit()
    try {
      for (let attempt=0; attempt<3; attempt++) {
        try {
          const saved = await folder.writeWorkspace(next,etag); active(captured)
          base = copy(saved.workspace || next); etag = saved.etag
          state.workspace = withDeviceViewPreferences(base,next); state.revision++
          state.storage = {remotePath:PLANNER_FOLDER,syncStatus:'synced',lastSyncedAt:now().toISOString()}; emit(); return snapshot()
        } catch (error) {
          active(captured)
          if (error.code !== 'CONFLICT') throw error
          const remote = await folder.readWorkspace(); active(captured)
          if (!remote.workspace) throw webProblem('The remote planner was removed while editing. Reload before saving.', 'CONFLICT')
          const merged = mergeWorkspaces(reference,next,validateWorkspace(remote.workspace))
          if (merged.conflicts.length) throw webProblem('Planner changes conflict with another session. Reload and review before saving.', 'CONFLICT')
          next = merged.workspace; reference = copy(remote.workspace); etag = remote.etag
        }
      }
      throw webProblem('Planner data kept changing. Retry after the other session finishes saving.', 'CONFLICT')
    } catch (error) { active(captured); plannerError(error); emit(); throw error }
  }
  function remember(record,deleted=false) {
    editSequence++; edits.set(key(record),{sequence:editSequence,record,deleted})
    state.records = deleted ? state.records.filter(value=>key(value)!==key(record)) : [...state.records.filter(value=>key(value)!==key(record)),record]
    state.statuses = state.statuses.map(status=>({...status,count:state.records.filter(value=>value.source===status.source).length}))
    if(!deleted&&record.source==='notes'&&!state.collections.some(collection=>collection.id===record.collectionId))state.collections.push({id:record.collectionId,source:'notes',title:record.collectionTitle||'Uncategorized (default)',readonly:Boolean(record.readonly),remote:{category:record.remote?.category||''}})
  }
  function currentProjection(record,creating=false) {
    const status=state.statuses.find(value=>value.source===record.source)
    if(status?.permissionDenied||status?.revokedCollectionIds?.includes(record.collectionId))throw webProblem('Access to this source changed. Refresh before continuing.', 'PERMISSION')
    const current=state.records.find(value=>key(value)===key(record))
    if(!current&&!creating)throw webProblem('This item is no longer available. Refresh its source.', 'UNAVAILABLE')
    return current
  }
  async function identify(persist=true) {
    const reconcile=()=>{
      active();const resolved=reconcileIdentities(state.workspace,state.records,makeId)
      if(sharedFolderHash(resolved.workspace)!==sharedFolderHash(state.workspace))state.revision++
      state.records=resolved.records;state.workspace=resolved.workspace
    }
    if(!persist){reconcile();return}
    // Compute identities inside the same queue as remote organization writes.
    // A preceding save must not erase an identity discovered while it was pending.
    await metadata(async()=>{
      try {
        for(;;){
          reconcile()
          if(sharedFolderHash(state.workspace)===sharedFolderHash(base))break
          await savePlanner(state.workspace)
          // Other acknowledged native creates may have arrived during I/O.
          // Persist those identities before returning their new record IDs.
        }
      }catch(error){if(host.phase!=='expired')plannerError(error);else throw error}
    })
  }
  async function refresh() {
    await initialize()
    if (refreshing) return refreshing
    refreshing = (async()=>{
      const captured = await verify(), native = client, startedSequence = editSequence, scan=++readGeneration
      setHost('ready'); state.deviceSync = {settings:{caldavMinutes:0,deckMinutes:0,wifiOnly:false},restoring:false,background:{supported:false,scheduled:false},activity:{sources:SOURCES,stage:'source-read',startedAt:now().toISOString(),lastProgressAt:now().toISOString(),completed:0}}
      emit()
      try {
        const result = await native.readAll({isActive:()=>!disposed&&captured===epoch&&scan===readGeneration&&online,onCollections:part=>{
          if(captured!==epoch||scan!==readGeneration||!online)return
          const ids = new Set(part.collections.map(value=>value.id))
          state.collections = [...state.collections.filter(value=>!ids.has(value.id)),...part.collections]
          state.nativeWriteSources = [...new Set([...(state.nativeWriteSources||[]),...part.collections.filter(value=>!value.readonly).map(value=>value.source)])]; emit()
        }})
        active(captured)
        if(scan!==readGeneration)return snapshot()
        const merged = mergeSourceRefresh(state,result)
        // An old scan cannot undo an acknowledged edit or resurrect a deletion.
        for (const [nativeKey,change] of edits) if(change.sequence>startedSequence) {
          merged.records = merged.records.filter(value=>key(value)!==nativeKey)
          const denied = merged.statuses.some(status=>status.source===change.record.source&&(status.permissionDenied||status.revokedCollectionIds?.includes(change.record.collectionId)))
          if(!change.deleted&&!denied)merged.records.push(change.record)
        }
        Object.assign(state,merged)
        state.nativeWriteSources = SOURCES.filter(source=>!result.statuses.some(status=>status.source===source&&status.permissionDenied)&&(state.collections.some(collection=>collection.source===source&&!collection.readonly)||source==='notes'&&result.statuses.some(status=>status.source==='notes'&&status.state==='connected')))
        await identify(); active(captured)
        lastSourceRefresh=now().getTime()
        for(const [nativeKey,change] of edits)if(change.sequence<=startedSequence)edits.delete(nativeKey)
      } catch(error) {
        active(captured)
        if(scan!==readGeneration)return snapshot()
        state.statuses = state.statuses.map(status=>({...status,state:'error',message:error.message,errorCode:error.code||'NETWORK'}))
        if(error.code==='AUTH')transport.expire(error.message)
        else if(error.code==='NETWORK'||error.code==='OFFLINE')setHost('offline',error.message)
      } finally { if(captured===epoch&&state.deviceSync) { delete state.deviceSync.activity; emit() } }
      return snapshot()
    })().finally(()=>{refreshing=null})
    return refreshing
  }
  function recordFor(id,source,write=true) {
    const value = state.records.find(record=>record.id===id)
    if(!value||source&&value.source!==source)throw webProblem('This item is not loaded. Refresh its source.', 'UNAVAILABLE')
    if(write&&(value.readonly||!state.nativeWriteSources?.includes(value.source)))throw webProblem('This source is read only or has not been verified.', 'PERMISSION')
    return value
  }
  function collectionFor(id,source,write=true) {
    const value = state.collections.find(collection=>collection.id===id&&(!source||collection.source===source))
    if(!value||write&&(value.readonly||!state.nativeWriteSources?.includes(value.source)))throw webProblem('Choose an available writable destination.', 'PERMISSION')
    return value
  }
  function nativeDenied(error) {
    const denied=error?.nativePermissionDenied
    if(error?.code!=='PERMISSION'||!denied||!SOURCES.includes(denied.source)||typeof denied.collectionId!=='string')return
    const target=state.collections.find(value=>value.id===denied.collectionId&&value.source===denied.source)
    if(!target)return
    readGeneration++
    const affected=new Set(),collectionIds=new Set()
    state.collections=state.collections.map(collection=>{
      const same=collection.id===target.id&&collection.source===target.source
      const sameDav=['tasks','calendar'].includes(target.source)&&['tasks','calendar'].includes(collection.source)&&target.remote?.href&&target.remote.href===collection.remote?.href
      if(!same&&!sameDav)return collection
      affected.add(collection.source);collectionIds.add(collection.id);return {...collection,readonly:true}
    })
    state.records=state.records.map(record=>collectionIds.has(record.collectionId)?{...record,readonly:true}:record)
    state.nativeWriteSources=(state.nativeWriteSources||[]).filter(source=>!affected.has(source)||state.collections.some(collection=>collection.source===source&&!collection.readonly))
    state.statuses=state.statuses.map(status=>affected.has(status.source)?{...status,state:'error',errorCode:'PERMISSION',errorStage:'source-read',message:'A Nextcloud destination became read-only. Refresh to check its permissions; other writable destinations remain available.'}:status)
    emit()
  }
  async function invoke(action) { await initialize(); const captured = await verify(), native = client;try{const result = await action(native); active(captured); return result}catch(error){if(captured===epoch&&host.phase!=='expired')nativeDenied(error);throw error} }
  function preferencesOperation(action) {
    const issued = epoch
    return preferenceWrites(async()=>{
      active(issued); await initialize()
      const captured = await verify(); active(issued)
      // Only the session and shared conditional protocol own these values.
      // No browser persistence/outbox or source/organization error state.
      const result = await action(viewPreferences); active(captured)
      return copy(result)
    })
  }
  function mutation(id,action) { let queue=itemQueues.get(id); if(!queue){queue=serial();itemQueues.set(id,queue)}return queue(()=>invoke(action)) }
  async function commit(record,saved,native) {
    const collection=collectionFor(record.collectionId,record.source,false)
    const current = await native.savedRecord(record,collection,saved); active()
    currentProjection(record)
    if(saved?.verifiedCollection?.id===collection.id&&saved.verifiedCollection.source===collection.source&&saved.verifiedCollection.remote?.href===collection.remote?.href)state.collections=state.collections.map(value=>value.id===collection.id?saved.verifiedCollection:value)
    remember(current); await identify(); emit(); return snapshot()
  }
  function eventFor(id,method) {
    const record=recordFor(id,'calendar',false),collection=collectionFor(record.collectionId,'calendar')
    const eligible=method==='updateEvent'?eventEditOperation:method==='deleteEvent'?eventDeleteOperation:eventRespondOperation
    if(!eligible(record,state.collections))throw webProblem('This calendar action is not permitted for this event.', 'PERMISSION')
    return {record,collection}
  }
  function edit(method,source) { return input=>mutation(input?.id,async native=>{const selected=['updateEvent','respondToEvent'].includes(method)?eventFor(input?.id,method):null,record=selected?.record||recordFor(input?.id,source),collection=selected?.collection||collectionFor(record.collectionId,record.source);return commit(record,await native[method](input,record,collection),native)}) }
  async function create(source,method,input) {
    return mutation(`create:${source}`,async native=>{
      const collection = input.collectionId ? collectionFor(input.collectionId,source) : source==='notes' ? undefined : collectionFor(undefined,source)
      if(source==='notes'&&!state.nativeWriteSources?.includes('notes'))throw webProblem('Notes have not been verified.', 'PERMISSION')
      // Shared task validation preserves the retry identity/completion intent;
      // the portable protocol owns conditional creation and native reuse.
      const change=source==='tasks'?{
        title:input.title,collectionId:input.collectionId,
        ...(input.start!==undefined?{start:input.start}:{}),...(input.due!==undefined?{due:input.due}:{}),
        ...(input.description!==undefined?{description:input.description}:{}),...taskCreationOptions(input),
      }:source==='notes'&&collection?{...input,category:collection.remote?.category||''}:input
      const saved = await native[method](change,collection); active()
      const record = await native.createdRecord(source,saved,collection); active()
      currentProjection(record,true)
      remember(record); await identify(); emit()
      const adopted=state.records.find(value=>key(value)===key(record))
      const warning=saved.warning||record.creationWarning||(state.storage.syncStatus==='error'?'Created in Nextcloud, but its planner identity could not be synchronized. Retry planner sync; do not create the item again.':undefined)
      return {...snapshot(),createdRecordId:adopted?.id,...(warning?{creationWarning:warning}:{})}
    })
  }
  async function attachments(input,method) {
    return mutation(input?.id,async native=>{
      const record=recordFor(input?.id,'deck',method!=='readDeckAttachments');let result
      if(method==='attachDeckFile'){
        if(Boolean(input.path)===Boolean(input.noteId))throw webProblem('Choose one file or note.', 'VALIDATION')
        result=await native.attachDeckFile({path:input.path,note:input.noteId?recordFor(input.noteId,'notes',false):undefined},record)
      }else if(method==='uploadDeckAttachment'){
        if(!options.selectUpload)throw webProblem('File upload is unavailable.', 'UNAVAILABLE')
        const picked=await options.selectUpload();active()
        if(!picked)return {...await native.readDeckAttachments(record),cancelled:true}
        result=await native.uploadDeckAttachment(picked,record)
      }else result=await native[method](method==='readDeckAttachments'?record:input,method==='readDeckAttachments'?undefined:record)
      active()
      const saved=method==='readDeckAttachments'?undefined:await native.savedRecord(record,collectionFor(record.collectionId,'deck',false),{})
      active();const latest=currentProjection(record),current=saved&&latest===record?saved:latest
      remember({...current,attachmentFileIds:[...new Set(result.attachments.map(item=>item.fileId).filter(Boolean).map(String))]});emit();return result
    })
  }
  const unavailable = async()=>{throw webProblem('This app uses your existing Nextcloud session. Sign in or out through Nextcloud.', 'UNAVAILABLE')}
  const api = {
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
    subscribeHost(listener){hostListeners.add(listener);return()=>hostListeners.delete(listener)},
    subscribeSync(listener){syncListeners.add(listener);return()=>syncListeners.delete(listener)},
    getHostState:()=>({...host}),
    async getState(){await initialize();if(!refreshing&&!state.records.length)void refresh().catch(()=>{});return snapshot()},
    refresh,
    async resumeSync(reason){await initialize();if(!online||host.phase==='expired')return snapshot();const elapsed=now().getTime();if(elapsed-lastPlannerRead>=(reason==='resume'?30000:60000))await api.syncWorkspace();if(refreshing||elapsed-lastSourceRefresh>=(reason==='resume'?30000:60000))return refresh();return snapshot()},
    async retryConnection(){if(host.phase==='expired')return unavailable();await initialize();await verify();setHost('ready');return refresh()},
    async setOnline(value){online=Boolean(value);if(!online&&host.phase!=='expired'){state.nativeWriteSources=[];setHost('offline','You are offline. Reconnect to edit.');emit()}else if(online&&host.phase!=='expired'){try{await initialize();await verify();setHost('ready');await refresh()}catch(error){if(host.phase!=='expired')setHost('offline',error.message)}}},
    dispose(){disposed=true;epoch++;transport.dispose();listeners.clear();hostListeners.clear();syncListeners.clear();state=createEmptyState();client=null;folder=null;viewPreferences=null;base=null;edits.clear()},
    beginLogin:unavailable,pollLogin:unavailable,cancelLogin:unavailable,connect:unavailable,disconnect:unavailable,
    saveWorkspace:(workspace,expectedRevision)=>metadata(async()=>{const result=await savePlanner(workspace,expectedRevision);return {workspace:result.workspace,revision:result.revision,storage:result.storage}}),
    syncWorkspace:()=>metadata(async()=>{await initialize();await loadPlanner();await identify(false);if(sharedFolderHash(state.workspace)!==sharedFolderHash(base))await savePlanner(state.workspace);emit();return snapshot()}),
    getViewPreferences:()=>preferencesOperation(store=>store.read()),
    saveViewPreferences:input=>{const draft=copy(input);return preferencesOperation(store=>store.save(draft))},
    async exportWorkspace(){await initialize();if(!options.exportPlanner)return {exported:false};await options.exportPlanner(copy(state.workspace));return {exported:true}},
    async openExternal(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw webProblem('Choose a web link.', 'SECURITY');await options.openExternal?.(url.href)},
    createNote:input=>create('notes','createNote',input),createTask:input=>create('tasks','createTask',input),createCard:input=>create('deck','createCard',input),createEvent:input=>create('calendar','createEvent',input),
    updateNote:edit('updateNote','notes'),updateDescription:edit('updateDescription'),updateRecordDates:edit('updateRecordDates'),updateRecordAppearance:edit('updateRecordAppearance'),updateTaskStatus:edit('updateTaskStatus','tasks'),setTaskCompleted:edit('setTaskCompleted','tasks'),setTaskDue:edit('setTaskDue','tasks'),setCardCompleted:edit('setCardCompleted','deck'),moveCard:edit('moveCard','deck'),updateEvent:edit('updateEvent','calendar'),respondToEvent:edit('respondToEvent','calendar'),
    readNote:input=>invoke(async native=>{const record=recordFor(input?.id,'notes',false),note=await native.readNote(record);active();return {...note,id:record.id,readonly:Boolean(note.readonly)}}),
    readPage:input=>invoke(native=>native.readPage(recordFor(input?.id,'collectives',false))),readPageAsset:input=>invoke(native=>native.readPageAsset(recordFor(input?.id,'collectives',false),input.path)),
    listFiles:input=>invoke(native=>native.listFiles(input||{})),readRelatedResources:input=>invoke(native=>native.readRelatedResources(recordFor(input?.id,undefined,false))),
    readDeckAttachments:input=>attachments(input,'readDeckAttachments'),attachDeckFile:input=>attachments(input,'attachDeckFile'),removeDeckAttachment:input=>attachments(input,'removeDeckAttachment'),uploadDeckAttachment:input=>attachments(input,'uploadDeckAttachment'),
    createDeckLabel:input=>mutation(`labels:${input?.collectionId}`,async native=>{const collection=collectionFor(input?.collectionId,'deck'),result=await native.createDeckLabel(input,collection);active();const label=result.label||result;state.collections=state.collections.map(value=>value.id===collection.id?{...value,labels:[...(value.labels||[]).filter(item=>item.id!==label.id),label]}:value);emit();return {label,state:snapshot()}}),
    setDeckDependency:input=>mutation(input?.fromId,async native=>{const from=recordFor(input?.fromId,'deck'),to=recordFor(input?.toId,'deck',false);return commit(from,await native.setDeckDependency(input,from,to),native)}),
    deleteEvent:input=>mutation(input?.id,async native=>{const {record,collection}=eventFor(input?.id,'deleteEvent'),result=await native.deleteEvent(input,record,collection);active();if(result?.deleted!==true)throw webProblem('Nextcloud did not confirm deletion. Refresh before retrying.');remember(record,true);emit();return snapshot()}),
  }
  for(const method of ['readNoteTags','setNoteTags'])api[method]=input=>mutation(input?.id,async native=>{const record=recordFor(input?.id,'notes',method==='setNoteTags'),result=await native[method](method==='readNoteTags'?record:input,method==='readNoteTags'?undefined:record);active();const current=currentProjection(record);remember({...current,fileTags:result.tags,tagDetails:result.tags,tags:[...(current.tags||[]).filter(tag=>tag==='Favorite'),...result.tags.map(tag=>tag.title)]});emit();return result})
  return api
}
