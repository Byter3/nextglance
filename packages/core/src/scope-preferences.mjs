/** Device-local view state, separate from the shared Space/source selection. */
import {plannerSettings} from './planner.mjs'
import {normalizeCalendarMode} from './calendar-period.mjs'

const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const textId=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!value.includes('\0')
const safeId=value=>textId(value)&&!['__proto__','prototype','constructor'].includes(value)
const ids=value=>Array.isArray(value)?[...new Set(value.filter(safeId))].slice(0,5000):[]
const attentionValues=new Set(['all','overdue','today','undated','blocked'])
const kinds=new Set(['all','tasks','calendar','deck','notes','collectives'])
const views=['overview','calendar','timeline','board','list']
const emptyStore=()=>({version:2,scopes:Object.create(null)})
const presentation=value=>({calendarMode:normalizeCalendarMode(value?.calendarMode),timelineFloatingEvents:value?.timelineFloatingEvents===true,timelineListCollapsed:value?.timelineListCollapsed===true,boardGroupTasks:value?.boardGroupTasks===true})
const pageFilters=(value={},scopeId='all')=>{
  const normalized=captureScopePreferences({...value,assignment:['me','all'].includes(value.assignment)?value.assignment:scopeId==='all'?'me':'all'},value)
  const {assignment,includeUnassigned,unassignedBoardIds,hiddenCollectionIds,query,attention,listKind,statusIds}=normalized
  return {assignment,includeUnassigned,unassignedBoardIds,hiddenCollectionIds,showCompleted:value.showCompleted===true,query,attention,listKind,statusIds}
}
function normalizeScope(value,scopeId,legacy=false){
  const snapshot=plain(value)?value:{},view=views.includes(snapshot.view)?snapshot.view:'overview',pages={}
  if(legacy){
    pages[view]=pageFilters({...snapshot,showCompleted:typeof snapshot.showCompletedByView?.[view]==='boolean'?snapshot.showCompletedByView[view]:snapshot.showCompleted},scopeId)
    for(const key of views)if(typeof snapshot.showCompletedByView?.[key]==='boolean')pages[key]={...(pages[key]||pageFilters({},scopeId)),showCompleted:snapshot.showCompletedByView[key]}
  }else for(const key of views)if(plain(snapshot.pages?.[key]))pages[key]=pageFilters(snapshot.pages[key],scopeId)
  return {view,pages,...presentation(snapshot)}
}

/** A stable key for the canonical account, including offline cached accounts.
 * Do not pass a display name in place of Nextcloud's canonical username/userId. */
export function scopePreferenceStorageKey(connection) {
  if(!textId(connection?.username)||typeof connection?.serverUrl!=='string'||connection.serverUrl.length>4096)return null
  try{
    const url=new URL(connection.serverUrl)
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)return null
    const server=`${url.origin}${url.pathname.replace(/\/+$/,'')}`
    return `nextspace.scope-preferences.v1:${encodeURIComponent(JSON.stringify([server,connection.username]))}`
  }catch{return null}
}

/** Only known, bounded view fields enter local storage; never source definitions. */
export function captureScopePreferences(planner={},extra={}) {
  const input=plain(planner)?planner:{},ui=plain(extra)?extra:{}
  const normalized=plannerSettings({
    view:input.view,
    assignment:plain(input.scopeAssignments)&&Object.hasOwn(input.scopeAssignments,input.scopeId)?input.scopeAssignments[input.scopeId]:input.assignment,
    includeUnassigned:input.includeUnassigned,
    unassignedBoardIds:ids(input.unassignedBoardIds),hiddenCollectionIds:ids(input.hiddenCollectionIds),
    showCompleted:input.showCompleted,
    showCompletedByView:plain(input.showCompletedByView)?input.showCompletedByView:{},
  })
  return {
    view:normalized.view,assignment:normalized.assignment,includeUnassigned:normalized.includeUnassigned,
    unassignedBoardIds:normalized.unassignedBoardIds,hiddenCollectionIds:normalized.hiddenCollectionIds,
    showCompleted:normalized.showCompleted,showCompletedByView:normalized.showCompletedByView,
    query:typeof ui.query==='string'?ui.query.slice(0,2000):'',
    attention:attentionValues.has(ui.attention)?ui.attention:'all',listKind:kinds.has(ui.listKind)?ui.listKind:'all',
    calendarMode:normalizeCalendarMode(ui.calendarMode),
    timelineFloatingEvents:ui.timelineFloatingEvents===true,
    timelineListCollapsed:ui.timelineListCollapsed===true,
    boardGroupTasks:ui.boardGroupTasks===true,
    statusIds:ids(ui.statusIds),
  }
}

/** Parse untrusted/corrupt preferences without changing shared metadata. */
export function parseScopePreferences(serialized) {
  const store=emptyStore()
  if(typeof serialized!=='string'||serialized.length>2_000_000)return store
  try{
    const value=JSON.parse(serialized)
    if(!plain(value)||![1,2].includes(value.version)||!plain(value.scopes))return store
    for(const [id,snapshot] of Object.entries(value.scopes).slice(0,2500)){
      if(safeId(id)&&plain(snapshot))store.scopes[id]=normalizeScope(snapshot,id,value.version===1)
    }
  }catch{/* Malformed local preferences must not prevent account startup. */}
  return store
}

/** Fresh Spaces have clean filters; legacy global completion visibility seeds
 * My overview only. Existing explicit per-scope assignment choices can survive. */
export function scopePreferencesFor(store,scopeId,legacyPlanner={},requestedView) {
  const id=safeId(scopeId)?scopeId:'all'
  if(plain(store?.scopes)&&Object.hasOwn(store.scopes,id)){
    const saved=normalizeScope(store.scopes[id],id,store.version===1),view=views.includes(requestedView)?requestedView:saved.view
    const page=saved.pages[view]||pageFilters({},id),showCompletedByView=Object.fromEntries(Object.entries(saved.pages).map(([key,value])=>[key,value.showCompleted]))
    return captureScopePreferences({...page,view,showCompletedByView},{...page,...saved})
  }
  const legacy=plain(legacyPlanner)?legacyPlanner:{}
  const assignment=plain(legacy.scopeAssignments)&&Object.hasOwn(legacy.scopeAssignments,id)?legacy.scopeAssignments[id]:id==='all'?'me':'all'
  if(id!=='all')return captureScopePreferences({assignment,view:requestedView})
  const seed=legacy.scopeId==='all'?legacy:{showCompleted:legacy.showCompleted,showCompletedByView:legacy.showCompletedByView}
  const snapshot=captureScopePreferences({...seed,scopeId:'all',assignment:legacy.scopeId==='all'?legacy.assignment:assignment})
  if(!views.includes(requestedView)||requestedView===snapshot.view)return snapshot
  return captureScopePreferences({view:requestedView,assignment,showCompleted:typeof snapshot.showCompletedByView[requestedView]==='boolean'?snapshot.showCompletedByView[requestedView]:false,showCompletedByView:snapshot.showCompletedByView})
}

/** Return an independent snapshot map; safe to serialize to account-local storage. */
export function saveScopePreferences(store,scopeId,snapshot) {
  const result=emptyStore()
  for(const [id,value] of Object.entries(plain(store?.scopes)?store.scopes:{}).slice(0,2500))if(safeId(id))result.scopes[id]=normalizeScope(value,id,store.version===1)
  if(safeId(scopeId)&&(Object.keys(result.scopes).length<2500||Object.hasOwn(result.scopes,scopeId))){
    const value=captureScopePreferences(snapshot,snapshot),previous=result.scopes[scopeId],pages={...(previous?.pages||{})}
    // Completion is the one field formerly stored per page. Preserve those
    // explicit choices, never copy the current page's other filters to them.
    for(const [view,showCompleted] of Object.entries(value.showCompletedByView))pages[view]={...(pages[view]||pageFilters({},scopeId)),showCompleted}
    pages[value.view]=pageFilters({...value,showCompleted:typeof value.showCompletedByView[value.view]==='boolean'?value.showCompletedByView[value.view]:value.showCompleted},scopeId)
    result.scopes[scopeId]={view:value.view,pages,...presentation(value)}
  }
  return result
}

/** Apply only current view fields; preserve shared workflow/status mappings.
 * Legacy Space-exclusion filters are deliberately inert and cleared. */
export function applyScopePreferences(planner,scopeId,snapshot) {
  const id=safeId(scopeId)?scopeId:'all',current=plannerSettings(planner),value=captureScopePreferences(snapshot,snapshot)
  return plannerSettings({...current,
    scopeId:id,view:value.view,
    ...(id==='all'?{assignment:value.assignment}:{}),
    scopeAssignments:{...current.scopeAssignments,[id]:value.assignment},
    includeUnassigned:value.includeUnassigned,unassignedBoardIds:value.unassignedBoardIds,
    hiddenCollectionIds:value.hiddenCollectionIds,excludedSpaceIds:[],
    showCompleted:value.showCompleted,showCompletedByView:value.showCompletedByView,
  })
}

/** Forget only removed scopes. The caller retains an active unsaved form itself. */
export function pruneScopePreferences(store,validScopeIds) {
  const valid=new Set(['all',...validScopeIds.filter(safeId)]),result=emptyStore()
  for(const [id,value] of Object.entries(plain(store?.scopes)?store.scopes:{}))if(valid.has(id)&&safeId(id))result.scopes[id]=normalizeScope(value,id,store.version===1)
  return result
}
