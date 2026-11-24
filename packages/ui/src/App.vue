<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, toRaw, watch } from 'vue'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Cloud, Download, ExternalLink, FileText, Folder, FolderKanban, Home, Link2, List, LoaderCircle, Menu, Pencil, Plus, RefreshCw, Search, Settings2, SlidersHorizontal, Trash2, UserRound, X, Clock3, AlertCircle, Unplug, GitBranch, PanelRightClose, Layers } from 'lucide-vue-next'
import { allRelations, boardCollectionsForScope, canAddRelation, countPlannerActions, isClosed, plannerSettings, planningColumnForRecord, relationsFor, selectPlanner, showCompletedForView } from '@nextspace/core/planner.mjs'
import {DEFAULT_COMPLETED_DAYS,normalizeCompletedDays,paddedCalendarWindow} from '@nextspace/core/history.mjs'
import HistoryDaysControl from './HistoryDaysControl.vue'
import type { ScopeArrangement, PlannerConflictChoice, PlannerSettings, PlannerView, Project, Relation, RelationType, ScheduleRequest, Source, Space, State, StatusMapping, WorkflowColumn, Workspace, WorkspaceApi, WorkspaceRecord, RecordTag } from '@nextspace/contracts'
import MarkdownContent from './MarkdownContent.vue'
import NextGlanceIcon from './NextGlanceIcon.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import {deferredComponent} from './deferred-component'
import { useInspectorWidth } from './useInspectorWidth'
import type { TimelineDateEdit } from '@nextspace/core/timeline-edit.mjs'
import { createRecordEdits } from '@nextspace/core/record-edits.mjs'
import {mergeBackgroundState} from '@nextspace/core/background-state.mjs'
import {isDeviceViewPatch} from '@nextspace/core/view-updates.mjs'
import {hasSavedSourceRead,sourceReadLabel,syncPresentationState} from '@nextspace/core/cached-sources.mjs'
import {canRefreshSources,sourceConnectionLabel} from '@nextspace/core/source-refresh.mjs'
import {syncNotice,syncNoticePresentation} from '@nextspace/core/sync-notice.mjs'
import SyncNotice from './SyncNotice.vue'
import SyncPreferences from './SyncPreferences.vue'
import PlannerSyncStatus from './PlannerSyncStatus.vue'
import PlannerConflictReview from './PlannerConflictReview.vue'
import DiagnosticsPanel from './DiagnosticsPanel.vue'
import PageSelector from './PageSelector.vue'
import {useUiDiagnostics} from './useUiDiagnostics'
import {createAfterPaint} from './after-paint.mjs'
import {createLatestPublication} from './latest-publication.mjs'
import {createRecordPresentation} from './record-presentation-cache.mjs'
import {plannerSyncReady} from '@nextspace/core/planner-sync-status.mjs'
import {sourceSyncStale} from '@nextspace/core/sync-policy.mjs'
import type {DeviceSync,DeviceSyncSettings} from '@nextspace/contracts'
import {connectionEntry,isConnectionAuthorized} from '@nextspace/core/auth-entry.mjs'
import {canUseNativeOperation,canWriteNativeSource,completionOperation,eventDeleteOperation,eventEditOperation,eventRespondOperation,eventDeleteFingerprint,taskDeleteOperation,taskDeleteFingerprint,deckAttachmentOperation} from '@nextspace/core/native-operations.mjs'
import {mergeWorkspaces,withDeviceViewPreferences} from '@nextspace/core/workspace-merge.mjs'
import {scopePreferenceStorageKey,parseScopePreferences,captureScopePreferences,scopePreferencesFor,saveScopePreferences,applyScopePreferences,pruneScopePreferences} from '@nextspace/core/scope-preferences.mjs'
import {applyViewPreferences} from '@nextspace/core/view-preferences.mjs'
import {createViewPreferenceSync} from '@nextspace/core/view-preference-sync.mjs'
import type {ScopeEditorDraft} from '@nextspace/core/scope-editor.mjs'
import {organizationMembership,normalizeOrganizationTags,organizationSourcePool} from '@nextspace/core/organization-tags.mjs'
import OrganizationTagPicker from './OrganizationTagPicker.vue'
import {buildScopeDraft} from '@nextspace/core/scope-editor.mjs'
import {removeSpace} from '@nextspace/core/space-organization.mjs'
import {dependencyCandidates} from '@nextspace/core/relation-picker.mjs'
import {eventActionExplanation} from '@nextspace/core/event-editor.mjs'
import type {EventEditorChanges} from '@nextspace/core/event-editor.mjs'
import {calendarPeriod,calendarPeriodDays,shiftCalendarAnchor,normalizeCalendarMode,type CalendarMode} from '@nextspace/core/calendar-period.mjs'
import {CloudAlert,CloudUpload,CloudOff,CalendarSearch,MoreVertical} from 'lucide-vue-next'
import { deckDependencyPair, deckDependencyProblem, pendingDeckDependencies } from '@nextspace/core/deck-dependencies.mjs'
import { normalizeColor, tagColorKey } from '@nextspace/core/record-presentation.mjs'
import {knownWorkspaceTags} from '@nextspace/core/known-tags.mjs'
import {buildNoteContentUpdate} from '@nextspace/core/note-content-edit.mjs'
import { effectiveStatusMapping, statusMappingSpace, setScopeStatusMapping, unifiedStatus, statusSourceKey, nativeStatus, TASK_STATUSES, taskStatusProgress } from '@nextspace/core/status-mapping.mjs'
import PlannerCalendar from './PlannerCalendar.vue'
import CalendarMonth from './CalendarMonth.vue'
import {Minus,RotateCcw} from 'lucide-vue-next'
import PlannerTimeline from './PlannerTimeline.vue'
import TimelineLegend from './TimelineLegend.vue'
import OverviewSplit from './OverviewSplit.vue'
import PlannerBoard from './PlannerBoard.vue'
import CalendarConnections from './CalendarConnections.vue'
const ScheduleEventForm=deferredComponent(()=>import('./ScheduleEventForm.vue'),'Calendar scheduling')
const RecordDatesEditor=deferredComponent(()=>import('./RecordDatesEditor.vue'),'Date editor')
const RelationPicker=deferredComponent(()=>import('./RelationPicker.vue'),'Link selector')
import EventSummary from './EventSummary.vue'
const EventDetailsEditor=deferredComponent(()=>import('./EventDetailsEditor.vue'),'Event editor')
const NoteLinkPicker=deferredComponent(()=>import('./NoteLinkPicker.vue'),'Attachments')
import NoteTagsEditor from './NoteTagsEditor.vue'
const NoteEditorDialog=deferredComponent(()=>import('./NoteEditorDialog.vue'),'Note editor')
const NoteConflictReview=deferredComponent(()=>import('./NoteConflictReview.vue'),'Conflict review')
import StatusSelect from './StatusSelect.vue'
import NativeResourcesPanel from './NativeResourcesPanel.vue'
import './notes-resources.css'
import DependencyPanel from './DependencyPanel.vue'
import LinkedJump from './LinkedJump.vue'
const CardTasksForm=deferredComponent(()=>import('./CardTasksForm.vue'),'Card tasks')
import {createCardTasks} from '@nextspace/core/card-tasks.mjs'
import type {CardTaskEntry} from '@nextspace/core/card-tasks.mjs'
import {linkedNavigation} from '@nextspace/core/linked-navigation.mjs'
import ItemAppearanceEditor from './ItemAppearanceEditor.vue'
const StatusMappingEditor=deferredComponent(()=>import('./StatusMappingEditor.vue'),'Status mapping')
const EventMatchReview=deferredComponent(()=>import('./EventMatchReview.vue'),'Matching events')
const CategoryManager=deferredComponent(()=>import('./CategoryManager.vue'),'Source groups')
const SpaceEditor=deferredComponent(()=>import('./SpaceEditor.vue'),'Space settings')
const CreateItemForm=deferredComponent(()=>import('./CreateItemForm.vue'),'New item')
import type { CreateItemKind, CreateItemRequest } from './create-item'
import type { CreationRange } from '@nextspace/core/range-selection.mjs'
import { recordGrouping } from '@nextspace/core/timeline.mjs'
import { accessibleAccent, clockTime, dateValue, dayKey, eventLabel, excerpt, inputDateTime, isOverdue, safeColor, shortDate, sourceLabels, textOnColor } from './planner-ui'
import type {NextspaceHostOptions} from './index'
import WeekendDaysSettings from './WeekendDaysSettings.vue'
import {provideWeekendDays} from './useWeekendDays'
import {portalTargetKey} from './portal-target'
import {widgetPlannerContext,validateWidgetIntent,widgetNavigation} from '@nextspace/core/widgets.mjs'
import type {WidgetConfig,WidgetIntent} from '@nextspace/core/widgets.mjs'

const props=withDefaults(defineProps<{api:WorkspaceApi}&NextspaceHostOptions>(),{
  nativeConnection:true,
  canMutateNative:true,
  canExportWorkspace:true,
  manualConnection:true,
})
const api=props.api
const {mask:weekendMask,pending:weekendPending,error:weekendError,change:changeWeekendDay,isWeekend}=provideWeekendDays(props.weekendPreferences)
let restoringPreferences=0
let preferenceSync:ReturnType<typeof createViewPreferenceSync>|undefined,preferenceTimer:ReturnType<typeof setTimeout>|undefined
const preferenceSyncError=ref(''),preferenceSyncing=ref(false),preferenceConflict=ref(false)
provide(portalTargetKey,props.portalTarget||'body')
const plannerRoot=ref<HTMLElement>()
const uiDiagnostics=useUiDiagnostics(api)
const pageSelector=ref<{close:(restoreFocus?:boolean)=>void}|null>(null),pageSelectorOpen=ref(false)
const desktop=props.nativeConnection??true
const canMutateNative=props.canMutateNative??true
const canExportWorkspace=props.canExportWorkspace??true
const manualConnection=props.manualConnection??true
const inspectorSize=useInspectorWidth()
const state=ref<State|null>(null)
const widgetCapture=shallowRef<{action:WidgetIntent;config:WidgetConfig;accountKey:string;account:string}|null>(null)
let widgetActionPending=false,widgetActionAgain=false,widgetCreatePending=false
type WidgetLaunch = NonNullable<Awaited<ReturnType<NonNullable<NextspaceHostOptions['takeWidgetAction']>>>>
let deferredWidgetLaunch: {launch:WidgetLaunch;account:string}|undefined
const hostSync=shallowRef<DeviceSync>()
const deviceSync=computed(()=>hostSync.value||state.value?.deviceSync)
const managedSync=Boolean(api.resumeSync)
const sourceRefreshing=computed(()=>refreshing.value||Boolean(deviceSync.value?.activity))
const syncSettingsBusy=ref(false),syncSettingsError=ref('')
let unsubscribeSync:(()=>void)|undefined
const authEntry=computed(()=>connectionEntry({connection:state.value?.connection,mobileHost:props.mobileHost,nativeFilesAvailable:Boolean(props.selectAccount)}))
const busy=ref(false),capturing=ref(false),saving=ref(0),error=ref(''),saveError=ref(''),toast=ref('')
const syncing=ref(false),refreshing=ref(false),appearanceDirty=ref(false)
const networkOnline=ref(navigator.onLine),lastSourcesRefreshedAt=ref<number|null>(null),nativeRefreshFailed=ref(false)
const deferredBackground=ref(false)
let deferredBackgroundBase:State|undefined
const appearanceSaving=ref(false),appearanceError=ref('')
const appearanceEditor=ref<{flush:(retry?:boolean)=>Promise<boolean>;hasDirty:()=>boolean;discard:()=>void}|null>(null)
const matchingSaving=ref(false)
const nativeNotesSyncing=ref(false),nativeNotesSyncError=ref('')
const matchingRecords=ref<WorkspaceRecord[]>([]),matchingRelations=ref<Relation[]>([])
let syncTimer:ReturnType<typeof setTimeout>|undefined,cloudPollTimer:ReturnType<typeof setInterval>|undefined
const sourceSaving=ref(0),sourceFailures=ref<{id:string;title:string;message:string;fields:string[];patch:Partial<WorkspaceRecord>}[]>([])
const nativeDependencyPending=ref<Record<string,boolean>>({})
const relationRemovalErrors=ref<Record<string,string>>({})
const attemptedDependencyMigrations=new Set<string>()
const sourceEdits=createRecordEdits<WorkspaceRecord>({
  read:id=>{const record=state.value?.records.find(item=>item.id===resolveRecordId(id));return record?{...copy(record),id}:undefined},
  write:(id,record)=>{const canonical=resolveRecordId(id),index=state.value?.records.findIndex(item=>item.id===canonical)??-1;if(state.value&&index>=0)state.value.records[index]={...record,id:canonical}},
  changed:pending=>sourceSaving.value=pending,
  failed:(id,reason,patches)=>{sourceFailures.value=[...sourceFailures.value.filter(item=>item.id!==id),{id,title:state.value?.records.find(item=>item.id===resolveRecordId(id))?.title||'Item',message:msg(reason),fields:[...new Set(patches.flatMap(patch=>Object.keys(patch)))],patch:Object.assign({},...patches)}]},
})
const sidebarOpen=ref(false),filterOpen=ref(false),selectedId=ref<string|null>(null)
const inspectorContentReady=ref(false),inspectorOrganizationOpen=ref(false)
let inspectorGeneration=0
const inspectorAfterPaint=createAfterPaint({afterRender:callback=>{void nextTick(callback)},requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:id=>cancelAnimationFrame(id as number),schedule:callback=>setTimeout(callback,0),cancelScheduled:id=>clearTimeout(id as ReturnType<typeof setTimeout>)})
const inspectorAccount=computed(()=>JSON.stringify([state.value?.connection.serverUrl,state.value?.connection.username]))
const pageOptionsOpen=ref(false),globalActionsOpen=ref(false),navActions=ref<{kind:'overview'|'space'|'project';id:string}|null>(null)
let navActionsTrigger:HTMLElement|null=null
const modal=ref<'card-tasks'|'scope'|'capture'|'settings'|'plan'|'delete'|'delete-event'|'delete-task'|'edit-event'|'schedule'|'categories'|'dates'|'relation'|'status-mapping'|'event-matches'|'note-editor'|'note-conflict'|null>(null)
const settingsContentReady=ref(false),calendarColorsOpen=ref(false)
let settingsGeneration=0
const settingsFocus=ref<'planner'|'sources'|null>(null)
const settingsAfterPaint=createAfterPaint({afterRender:callback=>{void nextTick(callback)},requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:id=>cancelAnimationFrame(id as number),schedule:callback=>setTimeout(callback,0),cancelScheduled:id=>clearTimeout(id as ReturnType<typeof setTimeout>)})
const deleteEventDraft=ref<{id:string;title:string;account:string;fingerprint:string}|null>(null)
const deletingEvent=computed(()=>deleteEventDraft.value?.account===inspectorAccount.value?state.value?.records.find(record=>record.id===deleteEventDraft.value?.id):undefined)
const deleteEventChanged=computed(()=>Boolean(deleteEventDraft.value&&eventDeleteFingerprint(deletingEvent.value)!==deleteEventDraft.value.fingerprint))
const deleteTaskDraft=shallowRef<{id:string;title:string;source:string;fingerprint:string;account:string;expectedAccount:{serverUrl:string;username:string}}>()
const deletingTask=computed(()=>deleteTaskDraft.value?.account===inspectorAccount.value?state.value?.records.find(record=>record.id===deleteTaskDraft.value?.id):undefined)
const deleteTaskChanged=computed(()=>Boolean(deleteTaskDraft.value&&taskDeleteFingerprint(deletingTask.value)!==deleteTaskDraft.value.fingerprint))
watch(inspectorAccount,()=>{if(deleteTaskDraft.value)deleteTaskDraft.value={...deleteTaskDraft.value,account:''}},{flush:'sync'})
const inspectorHistory=ref<string[]>([]),noteTagsDirty=ref(false),noteTagsLoading=ref(false),noteTagsError=ref(''),noteLinkBusy=ref(false),resourceBusy=ref(false)
const noteTagOptions=ref<RecordTag[]>([]),createdPickerNote=ref<WorkspaceRecord>()
const noteTagsEditor=ref<{flush:(retry?:boolean)=>Promise<boolean>;discard:()=>void}|null>(null)
// Move the same editor only after the modal's host exists, retaining pending tag drafts.
const expandedNoteTagsHost=ref<HTMLElement|null>(null)
const nativeResources=ref<{reload:()=>Promise<void>}|null>(null)
const cardTaskFormKey=ref(0)
const cardTasksMode=ref<'create'|'checklist'>('create'),cardTaskProgress=ref(''),relationTaskOnly=ref(false)
const panelRecordId=ref(''),relationMode=ref<'dependency'|'note'|'related'>('dependency')
const categorySpaceId=ref(''),categoriesDirty=ref(false)
const spaceEditorDirty=ref(false)
let organizationBaseline:Workspace|undefined
const scheduleRecordId=ref(''),scheduleMode=ref<'create'|'link'>('create'),scheduleSubmitted=ref(false)
const statusIds=ref<string[]>([])
const query=ref(''),searchExpanded=ref(false),listKind=ref('all'),attention=ref('all'),listLimit=ref(120)
const calendarMode=ref<CalendarMode>('week')
const completionHistoryKeys={board:'nextspace-board-completed-days',timeline:'nextspace-timeline-completed-days'}
function readCompletionHistory(view:keyof typeof completionHistoryKeys){
  try{
    const saved=localStorage.getItem(completionHistoryKeys[view])
    return saved===null?DEFAULT_COMPLETED_DAYS:normalizeCompletedDays(JSON.parse(saved))
  }catch{return DEFAULT_COMPLETED_DAYS}
}
const completedDaysByView=ref({board:readCompletionHistory('board'),timeline:readCompletionHistory('timeline')})
function completionHistoryOptions(view?:PlannerView){
  return view==='board'||view==='timeline'?{completedDays:completedDaysByView.value[view]}:{}
}
function changeCompletionHistory(days:number|null){
  const view=settings.value.view
  if(view!=='board'&&view!=='timeline')return
  completedDaysByView.value[view]=normalizeCompletedDays(days)
  try{localStorage.setItem(completionHistoryKeys[view],JSON.stringify(completedDaysByView.value[view]))}catch{/* Private storage may be disabled. */}
}
const standaloneCalendarDays=ref(0),calendarHistoryBusy=ref(false),calendarHistoryError=ref(''),calendarRangeError=ref('')
const timelineFloatingEvents=ref(false),allCalendarBands=ref(true),boardGroupTasks=ref(false),timelineListCollapsed=ref(false)
type RevealView={revealRecord:(id:string)=>Promise<unknown>}
const overviewSplit=ref<RevealView|null>(null),standaloneCalendar=ref<RevealView|null>(null)
const standaloneTimeline=ref<RevealView&{openEvents:()=>void}|null>(null)
const monthCalendar=ref<RevealView&{changeDensity:(scale:number)=>void;resetDensity:()=>void}|null>(null)
const anchor=ref(new Date()),now=ref(new Date()),scopeSearch=ref('')
const scopeDraft=ref<ScopeEditorDraft>({kind:'space' as 'space'|'project',id:'',name:'',color:'#0082c9',spaceId:'',categoryId:'',collectionIds:[] as string[],recordIds:[] as string[],defaultCalendarId:'',defaultTaskListId:'',defaultBoardId:''})
const scopePreferences=ref(parseScopePreferences(null))
let preferenceAccountKey:string|null=null,preferencesInitialized=false
const scopeViewports=new Map<string,{anchor:string;days:number}>()
const deleteDraft=ref<{kind:'overview'|'space'|'project';id:string;name:string}|null>(null)
const captureType=ref<CreateItemKind>('task'),captureRange=ref<CreationRange>(),captureKey=ref(0),captureBoardId=ref<string>()
const componentDraftDirty=ref(false),modalBaseline=ref(''),noteBaseline=ref('')
const planDraft=ref({id:'',recordId:'',start:'',end:''})
const noteDraft=ref({id:'',title:'',content:'',category:'',etag:undefined as string|undefined})
const contentError=ref('')
const noteConflict=ref<{id:string;title:string;content:string;category:string;etag:string;readonly:boolean}>(),noteConflictBusy=ref(false)
let noteConflictReturn:'note-editor'|null=null
const editingNote=ref(false)
const pageBody=ref(''),pageBusy=ref(false),pageError=ref('')
const login=ref({serverUrl:'',username:'',appPassword:''}),loginWaiting=ref(false)
const loginFlow=ref<{flowId:string;loginUrl:string}|null>(null)
const systemDark=ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
const timelineDays=ref(7)
let saveQueue=Promise.resolve(),mutationVersion=0,loginGeneration=0,pageGeneration=0,contentSaveGeneration=0
let acknowledgedWorkspace:Workspace|undefined,draftBaseline:Workspace|undefined,failedWorkspaceBase:Workspace|undefined,acknowledgedRevision=-1
let lastHostState:State|undefined,unsubscribeHost:(()=>void)|undefined,unmounted=false
let hostPublicationVersion=0,publicationRefresh:Promise<void>|undefined,publicationRefreshAgain=false
let modalReturnFocus:HTMLElement|null=null
let pollTimer:ReturnType<typeof setTimeout>|undefined,toastTimer:ReturnType<typeof setTimeout>|undefined,clockTimer:ReturnType<typeof setInterval>|undefined
const sourceIcons={tasks:CheckCheck,calendar:CalendarDays,deck:FolderKanban,notes:FileText,collectives:BookOpen}
const sources:Source[]=['calendar','tasks','deck','notes','collectives']
const viewOptions:{id:PlannerView;label:string;icon:typeof Home}[]=[{id:'overview',label:'Overview',icon:Home},{id:'calendar',label:'Calendar',icon:CalendarDays},{id:'timeline',label:'Timeline',icon:GitBranch},{id:'board',label:'Board',icon:FolderKanban},{id:'list',label:'List',icon:List}]
const widgetContext=computed(()=>state.value&&widgetCapture.value?widgetPlannerContext(toRaw(state.value),widgetCapture.value.config,{accountKey:widgetCapture.value.accountKey,now:+now.value,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,locale:navigator.language}):null)
const settings=computed(()=>plannerSettings(state.value?.workspace.planner))
const effectiveMapping=computed(()=>state.value?effectiveStatusMapping(state.value.workspace,settings.value.scopeId,state.value.collections):{columns:[],assignments:{}})
const mappingSpace=computed(()=>state.value?statusMappingSpace(state.value.workspace,settings.value.scopeId):undefined)
const statusFilterOptions=computed(()=>{const options=[...effectiveMapping.value.columns,{id:'$unmapped',title:'Unmapped',color:'#8b939f'}];return [...options,...statusIds.value.filter(id=>!options.some(option=>option.id===id)).map(id=>({id,title:'Unavailable status',color:'#8b939f'}))]})
const automaticProjects=computed(()=>state.value?organizationMembership({...state.value.workspace,projects:state.value.workspace.projects.map(project=>({...project,recordIds:[]}))},records.value).projects:new Map<string,Set<string>>())
function projectAutomatic(project:Project){return selectedId.value?automaticProjects.value.get(project.id)?.has(selectedId.value):false}
function toggleStatusFilter(id:string){statusIds.value=statusIds.value.includes(id)?statusIds.value.filter(value=>value!==id):[...statusIds.value,id]}
const showDone=computed(()=>showCompletedForView(settings.value))
const completedDays=computed(()=>completionHistoryOptions(settings.value.view).completedDays)
// Sync-only fields (timestamps, spinner/status) do not change the planner data.
// Stable branches prevent a no-change refresh from rebuilding every view.
const plannerState=computed<State|null>(previous=>{
  const current=state.value
  if(!current)return null
  if(previous&&previous.records===current.records&&previous.workspace===current.workspace&&previous.collections===current.collections&&previous.connection.username===current.connection.username)return previous
  // Keep the selector's account input detached from transport progress. The
  // native-source arrays/workspace stay reactive for edits and permission changes.
  return {...current,connection:{...toRaw(current.connection)}}
})
const records=computed(()=>plannerState.value?.records||[])
const scopeArrangement=computed(()=>settings.value.arrangements?.[settings.value.scopeId]||{})
const boardCollections=computed(()=>state.value?boardCollectionsForScope(state.value.workspace,records.value,state.value.collections,settings.value.scopeId):[])
const recordsById=computed(()=>new Map(records.value.map(record=>[record.id,record])))
const model=computed(()=>plannerState.value?selectPlanner(plannerState.value,{query:query.value,now:now.value,statusIds:statusIds.value,...completionHistoryOptions(settings.value.view)}):null)
const overviewPreferences=computed(()=>scopePreferencesFor(scopePreferences.value,'all',state.value?.workspace.planner))
const allCount=computed(()=>{if(!plannerState.value)return 0;const overview=applyScopePreferences(settings.value,'all',overviewPreferences.value);return countPlannerActions(plannerState.value,{...overview,showCompleted:showCompletedForView(overview),query:'',statusIds:overviewPreferences.value.statusIds})})
const selected=computed(()=>selectedId.value?recordsById.value.get(selectedId.value):undefined)
const panelRecord=computed(()=>recordsById.value.get(resolveRecordId(panelRecordId.value)))
const relations=computed(()=>(plannerState.value?allRelations(plannerState.value.workspace,records.value):[]).filter(edge=>!(edge.type==='depends_on'&&nativeDependencyPending.value[dependencyKey(edge)]===true)))
const selectedLinks=computed(()=>relationsFor(selectedId.value||'',relations.value,state.value?.records||[]))
const selectedDependencies=computed(()=>[...selectedLinks.value.outgoing.filter(r=>r.type==='depends_on').map(r=>({...r,direction:'outgoing'})),...selectedLinks.value.incoming.filter(r=>r.type==='depends_on').map(r=>({...r,direction:'incoming'}))])
const selectedNotes=computed(()=>[...selectedLinks.value.outgoing,...selectedLinks.value.incoming].filter(r=>r.type==='reference'&&r.record&&(r.record.kind==='note'||r.record.kind==='page')))
const selectedOtherLinks=computed(()=>[...selectedLinks.value.outgoing.map(r=>({...r,incoming:false})),...selectedLinks.value.incoming.map(r=>({...r,incoming:true}))].filter(r=>(!r.native||r.type==='reference')&&r.type!=='depends_on'&&!calendarLinkShown(r)&&!selectedNotes.value.some(note=>note.id===r.id)))
function calendarLinkShown(link:Relation&{record?:WorkspaceRecord|null}){if(link.type!=='scheduled_during'||!selected.value)return false;return ['task','card'].includes(selected.value.kind)&&link.fromId===selected.value.id&&(!link.record||link.record.kind==='event')||selected.value.kind==='event'&&link.toId===selected.value.id&&Boolean(link.record&&['task','card'].includes(link.record.kind))}
const scheduleRecord=computed(()=>state.value?.records.find(r=>r.id===scheduleRecordId.value))
const schedulePending=computed(()=>state.value?.pendingSchedules?.find(r=>r.recordId===scheduleRecordId.value))
const selectedLocation=computed(()=>selected.value?recordLocation(selected.value):'')
const selectedDeck=computed(()=>state.value?.collections.find(c=>c.source==='deck'&&c.id===selected.value?.collectionId))
const selectedPlans=computed(()=>state.value?.workspace.plans.filter(p=>p.recordId===selectedId.value)||[])
const metadataLocked=computed(()=>Boolean(props.sessionHost&&(props.sessionReadOnly||!networkOnline.value||!sourceAuthorized.value))||Boolean(deviceSync.value?.restoring)||Boolean(state.value?.connection.recoveryOnly)||Boolean(props.mobileHost&&!(state.value as State&{metadata?:{ready:boolean}}|null)?.metadata?.ready)||busy.value||capturing.value||loginWaiting.value)
const connected=computed(()=>Boolean(state.value?.connection.connected))
const plannerRetryReady=computed(()=>Boolean(api.syncWorkspace)&&plannerSyncReady({connection:state.value?.connection,online:networkOnline.value,restoring:deviceSync.value?.restoring,syncing:syncing.value||deviceSync.value?.plannerSyncing,busy:busy.value||capturing.value||loginWaiting.value,protectedChanges:Boolean(saving.value||sourceSaving.value||resourceBusy.value||noteLinkBusy.value||modal.value&&modal.value!=='settings'||editingNote.value||inspectorDirty.value||sourceFailures.value.length||saveError.value)}))
const hasSavedAccount=computed(()=>Boolean(state.value?.connection.serverUrl&&state.value?.connection.username))
const sourceAuthorized=computed(()=>canRefreshSources(state.value?.connection))
const sourceRefreshReady=computed(()=>canRefreshSources(state.value?.connection,{networkOnline:networkOnline.value}))
const dark=computed(()=>{const mode=state.value?.workspace.appearance.mode;const inherited=state.value?.theme?.mode;return mode==='dark'||mode!=='light'&&(inherited==='dark'||inherited!=='light'&&systemDark.value)})
const primary=computed(()=>safeColor(state.value?.theme?.color)||'#0082c9')
const calendarPeriodState=computed(()=>calendarPeriod(anchor.value,calendarMode.value))
const week=computed(()=>calendarPeriodDays(calendarPeriodState.value))
const timelineView=computed(()=>settings.value.view==='overview'||settings.value.view==='timeline')
const timelineAnchor=computed(()=>dateValue(dayKey(anchor.value)))
const displayedPeriod=computed(()=>{const start=timelineView.value?timelineAnchor.value:dateValue(calendarPeriodState.value.start);const end=new Date(start);if(timelineView.value)end.setDate(end.getDate()+timelineDays.value-1);else{end.setTime(+dateValue(calendarPeriodState.value.end));end.setDate(end.getDate()-1)}return {start,end}})
const calendarBrowse=computed(()=>{
  if(!api.readCalendarWindow||!sourceAuthorized.value||!networkOnline.value)return null
  const view=settings.value.view
  if(view==='calendar'&&calendarMode.value==='month')return paddedCalendarWindow(+dateValue(calendarPeriodState.value.gridStart),+dateValue(calendarPeriodState.value.gridEnd))
  if(view!=='calendar'&&!timelineView.value)return null
  const first=dateValue(dayKey(anchor.value)),last=new Date(first)
  last.setDate(last.getDate()+(timelineView.value?timelineDays.value:standaloneCalendarDays.value||calendarPeriodState.value.dayCount))
  return paddedCalendarWindow(+first,+last)
})
const weekLabel=computed(()=>{const {start,end}=displayedPeriod.value;if(!timelineView.value&&calendarMode.value==='month')return start.toLocaleDateString(undefined,{month:'long',year:'numeric'});if(!timelineView.value&&calendarMode.value==='day')return start.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});return `${start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${end.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`})
const compactWeekLabel=computed(()=>{const {start,end}=displayedPeriod.value;return !timelineView.value&&calendarMode.value==='month'?start.toLocaleDateString(undefined,{month:'short',year:'numeric'}):new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).formatRange(start,end)})
const assignment=computed(()=>settings.value.scopeAssignments[settings.value.scopeId]||(settings.value.scopeId==='all'?settings.value.assignment:'all'))
const currentCategory=computed(()=>state.value?.workspace.categories?.find(c=>c.id===settings.value.scopeId)||state.value?.workspace.categories?.find(c=>c.id===state.value?.workspace.projects.find(p=>p.id===settings.value.scopeId)?.categoryId))
const currentSpace=computed(()=>state.value?.workspace.spaces.find(s=>s.id===settings.value.scopeId)||state.value?.workspace.spaces.find(s=>s.id===(currentCategory.value?.spaceId||state.value?.workspace.projects.find(p=>p.id===settings.value.scopeId)?.spaceId)))
const currentProject=computed(()=>state.value?.workspace.projects.find(p=>p.id===settings.value.scopeId))
const relationCandidateIds=computed(()=>state.value&&modal.value==='relation'&&relationMode.value==='dependency'?dependencyCandidates(state.value.workspace,state.value.records,settings.value.scopeId).map(item=>item.id):undefined)
const sourceIssues=computed(()=>state.value?.statuses.filter(s=>s.state==='error')||[])
const connectionNotice=computed(()=>deviceSync.value?.restoring?null:syncNotice({connection:state.value?.connection,storage:state.value?.storage,statuses:state.value?.statuses,networkOnline:networkOnline.value,refreshing:sourceRefreshing.value,syncing:syncing.value||deviceSync.value?.plannerSyncing}))
const connectionNoticePresentation=computed(()=>syncNoticePresentation(connectionNotice.value))
const noticeActionDisabled=computed(()=>busy.value||loginWaiting.value||(connectionNotice.value?.action==='retry-planner'?!plannerRetryReady.value:connectionNotice.value?.action==='retry-sources'?refreshing.value||!sourceRefreshReady.value:false))
const connectionLabel=computed(()=>deviceSync.value?.restoring?'Restoring saved planner…':deviceSync.value?.activity?.message||sourceConnectionLabel(state.value?.connection,{networkOnline:networkOnline.value,refreshing:sourceRefreshing.value,itemCount:state.value?.records.length,sourceErrors:sourceIssues.value.length>0,statuses:state.value?.statuses}))
const connectedSources=computed(()=>state.value?.statuses.filter(s=>s.state==='connected').length||0)
const inspectorDirty=computed(()=>appearanceDirty.value||noteTagsDirty.value||editingNote.value&&JSON.stringify(noteDraft.value)!==noteBaseline.value)
const modalDirty=computed(()=>['note-editor','note-conflict'].includes(modal.value||'')?false:modal.value==='categories'?categoriesDirty.value:modal.value==='scope'?(scopeDraft.value.kind==='space'?spaceEditorDirty.value:JSON.stringify(scopeDraft.value)!==modalBaseline.value):modal.value==='plan'?JSON.stringify(planDraft.value)!==modalBaseline.value:['card-tasks','capture','schedule','dates','edit-event','relation','status-mapping','event-matches'].includes(modal.value||'')&&componentDraftDirty.value)
const syncActive=computed(()=>preferenceSyncing.value||syncing.value||deviceSync.value?.plannerSyncing||sourceRefreshing.value||sourceSaving.value>0||resourceBusy.value||noteLinkBusy.value||nativeNotesSyncing.value)
const sourcesStale=computed(()=>deferredBackground.value||nativeRefreshFailed.value||sourceIssues.value.length>0||(deviceSync.value?sourceSyncStale(state.value?.statuses||[],deviceSync.value.settings,+now.value):lastSourcesRefreshedAt.value===null||+now.value-lastSourcesRefreshedAt.value>125000||state.value?.statuses.some(status=>status.metadataStale||status.state==='unavailable'&&state.value?.records.some(record=>record.source===status.source))))
const syncState=computed(()=>syncPresentationState({authorized:sourceAuthorized.value,networkOnline:networkOnline.value,connected:connected.value,hasSavedData:hasSavedSourceRead(state.value?.statuses),active:Boolean(syncActive.value),hasError:Boolean(deviceSync.value?.foregroundError||preferenceSyncError.value||nativeNotesSyncError.value||saveError.value||sourceFailures.value.length||['error','conflict'].includes(state.value?.storage.syncStatus||'')),stale:Boolean(sourcesStale.value),pending:Boolean(saving.value||state.value?.storage.syncStatus!=='synced')}))
const manualSourceChecks=computed(()=>deviceSync.value&&(deviceSync.value.settings.caldavMinutes===0||deviceSync.value.settings.deckMinutes===0))
const cloudStatus=computed(()=>!hasSavedAccount.value&&!connected.value?'Not connected':syncState.value==='syncing'?'Syncing to Nextcloud…':syncState.value==='offline'?connectionLabel.value:state.value?.storage.syncStatus==='conflict'?'Sync conflict':syncState.value==='error'?'Sync needs attention':syncState.value==='saved'?'Saved data · checking access':syncState.value==='stale'?'Sources need refresh':syncState.value==='synced'?'Synced to Nextcloud':'Waiting to sync')
const syncTooltip=computed(()=>{
  const last=lastSourcesRefreshedAt.value?`Last source refresh: ${new Date(lastSourcesRefreshedAt.value).toLocaleString()}`:'Saved source refresh times are shown in Settings & connection'
  const status=syncState.value==='synced'?(manualSourceChecks.value?'Planner synced · some source checks are manual':'All changes synced · sources up to date'):syncState.value==='syncing'?'Syncing in the background — you can keep working':syncState.value==='error'?'Sync needs attention · open cloud details':syncState.value==='offline'?connectionLabel.value:syncState.value==='saved'?'Saved items are available; checking current access to Nextcloud':syncState.value==='stale'?'Sources may be incomplete or out of date · refresh to check Nextcloud':'Changes waiting to sync'
  const metadata=state.value?.statuses.filter(source=>source.metadataStale).map(source=>source.message||`${sourceLabels[source.source]} attachments or tags need a refresh`).join('\n')
  const activity=deviceSync.value?.activity
  const detail=activity?`${activity.message} · ${activity.completed}${activity.total===undefined?'':` / ${activity.total}`}`:deviceSync.value?.plannerSyncing?'Syncing planner files…':managedSync?'Automatic checks follow your sync settings; planner files check on opening.':last+'\nChecks native sources and planner files every minute'
  return `${preferenceSyncError.value||deviceSync.value?.foregroundError||connectionNotice.value?.message||status}\n${detail}${metadata?`\n${metadata}`:''}${nativeNotesSyncError.value?`\n${nativeNotesSyncError.value}`:''}`
})
const filtersActive=computed(()=>Boolean(query.value||statusIds.value.length||showDone.value||attention.value!=='all'||listKind.value!=='all'||settings.value.hiddenCollectionIds.length||settings.value.unassignedBoardIds.length||settings.value.includeUnassigned||assignment.value!==(settings.value.scopeId==='all'?'me':'all')))
const captureCollections=computed(()=>widgetCapture.value?widgetContext.value?.ok?widgetContext.value.collections:[]:state.value?.collections||[])
const captureKinds=computed<CreateItemKind[]>(()=>{const kinds:CreateItemKind[]=[];if(sourceWritable('tasks','createTask')&&captureCollections.value.some(c=>c.source==='tasks'&&!c.readonly))kinds.push('task');if(sourceWritable('deck','createCard')&&captureCollections.value.some(c=>c.source==='deck'&&!c.readonly&&c.stacks?.length))kinds.push('card');if(sourceWritable('calendar','createEvent')&&captureCollections.value.some(c=>c.source==='calendar'&&!c.readonly))kinds.push('event');if(!widgetCapture.value&&sourceWritable('notes','createNote'))kinds.push('note');return kinds})
const captureSupported=computed(()=>['createTask','createCard','createEvent','createNote'].some(operation=>nativeOperationImplemented(operation as keyof WorkspaceApi)))
const canCapture=computed(()=>!metadataLocked.value&&captureKinds.value.length>0)
const captureContext=computed(()=>{const record=state.value?.records.find(item=>item.id===captureRange.value?.recordId),group=record?recordGroup(record):undefined;return {project:currentProject.value||group?.project,category:currentCategory.value||group?.category,space:currentSpace.value||group?.space}})
const captureContextLabel=computed(()=>[captureContext.value.space?.name,captureContext.value.category?.name,captureContext.value.project?.name].filter(Boolean).join(' / '))
const captureDestinations=computed(()=>Object.fromEntries((['task','card','event','note'] as const).map(kind=>[kind,captureDestination(kind)])))
const listRecords=computed(()=>{if(!model.value)return[];let items=model.value.records;if(attention.value!=='all'){const buckets:{[key:string]:WorkspaceRecord[]}={overdue:model.value.overdue,today:model.value.today,undated:model.value.undated,blocked:model.value.actions.filter(r=>!isClosed(r)&&relations.value.some(edge=>{if(edge.fromId!==r.id||edge.type!=='depends_on')return false;const target=state.value?.records.find(i=>i.id===edge.toId);return target&&(target.kind==='task'||target.kind==='card')&&!target.completed}))};items=buckets[attention.value]||items}return items.filter(r=>listKind.value==='all'||r.source===listKind.value)})
const scopeCollections=computed(()=>state.value?.collections.filter(c=>!scopeSearch.value||`${sourceLabels[c.source]} ${c.title}`.toLocaleLowerCase().includes(scopeSearch.value.toLocaleLowerCase()))||[])
const dateTitle=computed(()=>now.value.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}))
const contextIds=computed(()=>new Set(model.value?.contextRecordIds||[]))
function msg(err:unknown){return err instanceof Error?err.message:'The operation could not finish. Try again.'}
const compactControlsQuery='(max-width:1280px), (pointer:coarse)'
const compactControlsMedia=window.matchMedia(compactControlsQuery)
const compactViewport=ref(compactControlsMedia.matches),mainWorkspaceWidth=ref(Infinity),appMain=ref<HTMLElement>()
const compactPageControls=computed(()=>compactViewport.value||mainWorkspaceWidth.value<=1000)
const narrowDesktopControls=computed(()=>!compactViewport.value&&compactPageControls.value)
const floatTimelineEvents=computed(()=>compactViewport.value||timelineFloatingEvents.value)
let mainWorkspaceObserver:ResizeObserver|undefined
function measurePageControls(){compactViewport.value=compactControlsMedia.matches;mainWorkspaceWidth.value=appMain.value?.clientWidth||Infinity}
onMounted(()=>{measurePageControls();compactControlsMedia.addEventListener('change',measurePageControls);mainWorkspaceObserver=new ResizeObserver(measurePageControls);if(appMain.value)mainWorkspaceObserver.observe(appMain.value)})
onBeforeUnmount(()=>{compactControlsMedia.removeEventListener('change',measurePageControls);mainWorkspaceObserver?.disconnect()})
async function focusSearch(){if(compactPageControls.value&&!narrowDesktopControls.value){sidebarOpen.value=false;closeGlobalActions();pageOptionsOpen.value=true}searchExpanded.value=true;await nextTick();document.getElementById('planner-search')?.focus()}
function closeSearch(){if(!query.value)searchExpanded.value=false}
function closePageOptions(restoreFocus=false){pageOptionsOpen.value=false;filterOpen.value=false;if(restoreFocus)void nextTick(()=>document.getElementById('page-options-toggle')?.focus())}
async function togglePageOptions(){if(pageOptionsOpen.value){closePageOptions();return}closeGlobalActions();navActions.value=null;sidebarOpen.value=false;pageOptionsOpen.value=true;await nextTick();document.querySelector<HTMLElement>('.page-options-heading button')?.focus()}
function closeGlobalActions(restoreFocus=false){globalActionsOpen.value=false;if(restoreFocus)void nextTick(()=>document.getElementById('global-actions-toggle')?.focus())}
async function toggleGlobalActions(){if(globalActionsOpen.value){closeGlobalActions();return}closePageOptions();navActions.value=null;sidebarOpen.value=false;globalActionsOpen.value=true;await nextTick();document.querySelector<HTMLElement>('.global-action-items button:not(:disabled)')?.focus()}
async function toggleNavActions(kind:'overview'|'space'|'project',id:string,event:MouseEvent){if(navActions.value?.kind===kind&&navActions.value.id===id){closeNavActions();return}closePageOptions();closeGlobalActions();navActionsTrigger=event.currentTarget as HTMLElement;navActions.value={kind,id};await nextTick();document.querySelector<HTMLElement>('.nav-actions-panel button:not(:disabled)')?.focus()}
function closeNavActions(restoreFocus=false){navActions.value=null;if(restoreFocus)void nextTick(()=>navActionsTrigger?.isConnected&&navActionsTrigger.focus())}
function navMenuKeyboard(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeNavActions(true);return}if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;const buttons=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));if(!buttons.length)return;event.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus()}
function dismissPageMenus(event:Event){const target=event.target;if(!(target instanceof Element))return;if(navActions.value&&!target.closest('.nav-actions-panel,.nav-actions-toggle'))closeNavActions();if(pageOptionsOpen.value&&!target.closest('.page-controls,.page-options-toggle'))closePageOptions();if(globalActionsOpen.value&&!target.closest('.global-actions-group'))closeGlobalActions()}
watch(sidebarOpen,value=>{if(!value)closeNavActions()})
watch(()=>settings.value.view,()=>{closePageOptions();closeGlobalActions()})
function scrollSettings(){const token=settingsGeneration;void nextTick(()=>{if(token===settingsGeneration&&modal.value==='settings'&&settingsContentReady.value&&settingsFocus.value)document.querySelector(settingsFocus.value==='planner'?'.planner-storage-settings':'.settings-connection-section')?.scrollIntoView({block:'nearest'})})}
async function openSyncDetails(){if(modal.value&&modal.value!=='settings'&&(busy.value||resourceBusy.value||noteLinkBusy.value||!allowDiscard(Boolean(modalDirty.value))))return;if(!await flushAppearance())return;settingsFocus.value=connectionNotice.value?.kind==='planner'?'planner':'sources';modal.value='settings';sidebarOpen.value=false;if(settingsContentReady.value)scrollSettings()}
function noticeAction(){const action=connectionNotice.value?.action;if(action==='reconnect')openReconnect();else if(action==='retry-sources')void refresh();else if(action==='retry-planner')void sync();else void openSyncDetails()}
function syncTime(value?:string){const time=value?new Date(value):null;return time&&Number.isFinite(+time)?time.toLocaleString():'Not yet recorded'}
function syncStage(value?:string){return ({authorization:'Checking authorization',discovery:'Source discovery','source-read':'Reading sources','planner-read':'Reading planner files','planner-write':'Writing planner files','local-cache':'Local storage'} as Record<string,string>)[value||'']||''}
function notify(value:string){toast.value=value;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',4500)}
function copy<T>(value:T):T{
  // Walking Vue proxies through JSON is costly for a library of long notes.
  // IPC state is plain data; a nested form proxy can still use the JSON fallback.
  try{return structuredClone(toRaw(value))}catch{return JSON.parse(JSON.stringify(toRaw(value)))}
}
function resolveRecordId(id:string,aliases=state.value?.recordIdAliases){const seen=new Set<string>();while(aliases?.[id]&&!seen.has(id)){seen.add(id);id=aliases[id]!}return id}
function storeLocalPreferences(){if(!props.sessionHost&&preferenceAccountKey)try{localStorage.setItem(preferenceAccountKey,JSON.stringify(scopePreferences.value))}catch{/* Session preferences still work when local storage is unavailable. */}}
function refreshViewPreferences(){clearTimeout(preferenceTimer);if(sourceAuthorized.value&&networkOnline.value&&!deviceSync.value?.restoring)void preferenceSync?.refresh()}
function initializePreferenceSync(key:string|null){
  preferenceSync?.close();clearTimeout(preferenceTimer);preferenceSyncError.value='';preferenceConflict.value=false;preferenceSyncing.value=false;preferenceSync=undefined
  if(!key||!api.getViewPreferences||!api.saveViewPreferences)return
  let initial:unknown;try{const saved=!props.sessionHost&&localStorage.getItem(key+':sync.v1');if(saved)initial=JSON.parse(saved)}catch{/* Local page preferences remain the fallback. */}
  preferenceSync=createViewPreferenceSync({local:toRaw(scopePreferences.value),initial,retainPending:!props.sessionHost,
    read:()=>api.getViewPreferences!(),save:value=>api.saveViewPreferences!(value),
    publish:value=>{scopePreferences.value=applyViewPreferences(toRaw(scopePreferences.value),value);if(state.value)state.value.workspace.planner=restorePreferenceFields(plannerSettings(state.value.workspace.planner));storeLocalPreferences()},
    persist:value=>{if(!props.sessionHost)try{localStorage.setItem(key+':sync.v1',JSON.stringify(value))}catch{/* Session changes remain available. */}},
    status:value=>{preferenceSyncing.value=value.syncing;preferenceSyncError.value=value.error?msg(value.error):'';preferenceConflict.value=(value.error as {code?:string}|null)?.code==='PREFERENCES_CONFLICT'},
  })
  preferenceTimer=setTimeout(refreshViewPreferences,400)
}
function rememberScopePreferences(syncFilters=false){
  if(!state.value||!preferencesInitialized||restoringPreferences)return
  const snapshot=captureScopePreferences(settings.value,{query:query.value,attention:attention.value,listKind:listKind.value,calendarMode:calendarMode.value,timelineFloatingEvents:timelineFloatingEvents.value,boardGroupTasks:boardGroupTasks.value,timelineListCollapsed:timelineListCollapsed.value,statusIds:statusIds.value}),id=settings.value.scopeId
  const next=saveScopePreferences(scopePreferences.value,id,snapshot)
  if(JSON.stringify(scopePreferences.value)!==JSON.stringify(next)){scopePreferences.value=next;storeLocalPreferences();if(syncFilters&&(!props.sessionHost||sourceAuthorized.value&&networkOnline.value)){preferenceSync?.editPage(id,settings.value.view,toRaw(next.scopes[id]!.pages[settings.value.view]!));clearTimeout(preferenceTimer);preferenceTimer=setTimeout(refreshViewPreferences,600)}}
}
function availableScopes(workspace:Workspace){return ['all',...workspace.spaces.map(item=>item.id),...(workspace.categories||[]).map(item=>item.id),...workspace.projects.filter(item=>!item.archived).map(item=>item.id)]}
function restorePreferenceFields(planner:PlannerSettings,view?:PlannerView){
  restoringPreferences++;void nextTick(()=>{restoringPreferences--})
  const snapshot=scopePreferencesFor(scopePreferences.value,planner.scopeId,planner,view)
  query.value=snapshot.query;attention.value=snapshot.attention;listKind.value=snapshot.listKind;calendarMode.value=snapshot.calendarMode;timelineFloatingEvents.value=snapshot.timelineFloatingEvents;boardGroupTasks.value=snapshot.boardGroupTasks;timelineListCollapsed.value=snapshot.timelineListCollapsed;statusIds.value=snapshot.statusIds
  return applyScopePreferences(planner,planner.scopeId,snapshot)
}
function prepareLocalPreferences(result:State){
  if(widgetCapture.value&&widgetCapture.value.account!==JSON.stringify([result.connection.serverUrl,result.connection.username])){widgetCapture.value=null;widgetCreatePending=false}
  const key=scopePreferenceStorageKey(result.connection)
  if(!preferencesInitialized||key!==preferenceAccountKey){
    rememberScopePreferences();preferenceAccountKey=key;scopeViewports.clear()
    let saved:string|null=null;try{saved=!props.sessionHost&&key?localStorage.getItem(key):null}catch{/* Empty local preferences are safe. */}
    scopePreferences.value=parseScopePreferences(saved);preferencesInitialized=true;initializePreferenceSync(key)
    // Capture the old global completion defaults before a first Space gets clean preferences.
    scopePreferences.value=saveScopePreferences(scopePreferences.value,'all',scopePreferencesFor(scopePreferences.value,'all',result.workspace.planner))
  }else rememberScopePreferences()
  const valid=availableScopes(result.workspace)
  // A partial cold-start snapshot is not evidence that a saved Space was deleted.
  const scopeId=valid.includes(result.workspace.planner.scopeId)?result.workspace.planner.scopeId:'all'
  result.workspace.planner=restorePreferenceFields({...result.workspace.planner,scopeId})
  storeLocalPreferences()
}
function changeScope(id:string){
  if(!state.value)return
  leaveWidgetContext()
  rememberScopePreferences()
  scopeViewports.set(settings.value.scopeId,{anchor:dayKey(anchor.value),days:timelineDays.value})
  const target=availableScopes(state.value.workspace).includes(id)?id:'all'
  state.value.workspace.planner=restorePreferenceFields({...settings.value,scopeId:target})
  const viewport=scopeViewports.get(target);anchor.value=viewport?dateValue(viewport.anchor):new Date();timelineDays.value=viewport?.days||(settings.value.view==='timeline'?14:7)
  filterOpen.value=false;listLimit.value=120;sidebarOpen.value=false
}
function leaveWidgetContext(){widgetCapture.value=null;widgetCreatePending=false}
async function openPendingWidgetCapture(){
  const capture=widgetCapture.value
  if(!widgetCreatePending||!capture||!canCapture.value||modal.value||widgetNavigationBlocked.value)return
  const kind=capture.action.kind||(capture.config.page==='calendar'&&captureKinds.value.includes('event')?'event':undefined)
  if(kind&&!captureKinds.value.includes(kind))return
  widgetCreatePending=false
  if(!await openCapture(kind||captureKinds.value[0]!,undefined,undefined,capture)){
    if(widgetCapture.value===capture)widgetCreatePending=true
  }
}
async function receiveWidgetAction(){
  if(!props.takeWidgetAction||!state.value||widgetNavigationBlocked.value||unmounted)return
  if(widgetActionPending){widgetActionAgain=true;return}
  widgetActionPending=true
  try{
    const account=inspectorAccount.value
    const deferred=deferredWidgetLaunch?.account===account?deferredWidgetLaunch.launch:undefined
    const incoming=deferred||await props.takeWidgetAction()
    if(deferred)widgetActionAgain=true
    deferredWidgetLaunch=undefined
    if(!incoming||unmounted||!state.value||account!==inspectorAccount.value)return
    if(widgetNavigationBlocked.value){deferredWidgetLaunch={launch:incoming,account};return}
    if(incoming.state){
      // Denial data can arrive with the launch. Adopt it through the usual
      // publication path so local edits and navigation survive the merge.
      if(incoming.state.revision<state.value.revision||JSON.stringify([incoming.state.connection.serverUrl,incoming.state.connection.username])!==account)return
      await adoptBackground(incoming.state,lastHostState||state.value,mutationVersion,false)
      if(unmounted||account!==inspectorAccount.value)return
      if(widgetNavigationBlocked.value){deferredWidgetLaunch={launch:incoming,account};return}
    }
    // Revalidate the current account/config/item, then navigate normally. Widget
    // membership is not a second planner model and never replaces saved filters.
    const creating=incoming.action.action==='create'
    // The worker already validated creation against private source state. The UI
    // snapshot may mark all collections read-only until access checks finish.
    const intent=creating?{...incoming.action,action:'open' as const}:incoming.action
    const result=validateWidgetIntent(intent,incoming.config,toRaw(state.value),{accountKey:incoming.accountKey,now:+now.value,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,locale:navigator.language})
    const navigation=widgetNavigation(result)
    if(!navigation){error.value=result.message||'This widget is unavailable. Open its settings.';return}
    leaveWidgetContext()
    if(settings.value.scopeId!==navigation.scopeId)changeScope(navigation.scopeId)
    if(settings.value.view!==navigation.page)setView(navigation.page)
    filterOpen.value=false;sidebarOpen.value=false;modal.value=null
    if(navigation.date)anchor.value=dateValue(navigation.date)
    if(navigation.calendarMode)calendarMode.value=navigation.calendarMode
    if(navigation.recordId){const record=recordsById.value.get(navigation.recordId);if(record)await openRecord(record)}
    if(creating){
      widgetCapture.value={action:incoming.action,config:incoming.config,accountKey:incoming.accountKey,account}
      widgetCreatePending=true;await openPendingWidgetCapture()
      if(widgetCreatePending)notify('Checking access to the widget’s creation sources…')
    }
  }catch(reason){error.value=msg(reason)}finally{
    widgetActionPending=false
    if(widgetActionAgain){widgetActionAgain=false;queueMicrotask(()=>void receiveWidgetAction())}
  }
}
function reconcileRemovedScope(){
  if(!state.value)return
  const valid=availableScopes(state.value.workspace)
  if(!valid.includes(settings.value.scopeId)){changeScope('all');notify('This view was removed. Showing My overview; your item draft is kept.')}
}
function applyState(result:State){
  const panelIdentity=modal.value==='card-tasks'?state.value?.workspace.identities.find(item=>item.id===panelRecordId.value):undefined
  if(panelIdentity)panelRecordId.value=result.workspace.identities.find(item=>item.source===panelIdentity.source&&item.key===panelIdentity.key)?.id||panelRecordId.value
  panelRecordId.value=resolveRecordId(panelRecordId.value,result.recordIdAliases)
  hostSync.value=result.deviceSync
  lastHostState=copy(result)
  const identity=state.value?.workspace.identities.find(item=>item.id===selectedId.value)
  if(identity)selectedId.value=result.workspace.identities.find(item=>item.source===identity.source&&item.key===identity.key)?.id||selectedId.value
  if(selectedId.value)selectedId.value=resolveRecordId(selectedId.value,result.recordIdAliases)
  prepareLocalPreferences(result);state.value=result
  acknowledgedWorkspace=copy(result.workspace);acknowledgedRevision=result.revision;draftBaseline=copy(result.workspace);failedWorkspaceBase=undefined
  refreshAmbiguousPublication()
  void receiveWidgetAction()
}
async function adoptBackground(result:State,before:State,version:number,direct=true){
  if(!state.value)return
  if(!state.value||unmounted)return
  const account=(value:State)=>JSON.stringify([value.connection.serverUrl,value.connection.username])
  if(account(result)!==account(before)||account(state.value)!==account(before)||result.revision<state.value.revision)return
  hostSync.value=result.deviceSync
  const canonicalIds=new Map(result.workspace.identities.map(identity=>[JSON.stringify([identity.source,identity.key]),identity.id]))
  const remaps=[selectedId.value,panelRecordId.value].some(id=>id&&resolveRecordId(id,result.recordIdAliases)!==id)||state.value.workspace.identities.some(identity=>{const canonical=canonicalIds.get(JSON.stringify([identity.source,identity.key]));return canonical&&canonical!==identity.id})
  if(remaps&&(editingNote.value||inspectorDirty.value||modalDirty.value)){
    deferredBackgroundBase=deferredBackgroundBase||before;deferredBackground.value=true
    return // Keep form/component identities stable until their drafts are saved.
  }
  const protectedIds=sourceEdits.protectedIds()
  if(inspectorDirty.value&&selectedId.value)protectedIds.push(selectedId.value)
  const identity=state.value.workspace.identities.find(item=>item.id===selectedId.value)
  const merged=mergeBackgroundState(before,toRaw(state.value),result,protectedIds,{reuseUnchanged:true})
  lastHostState=copy(result)
  if(result.revision>=acknowledgedRevision){acknowledgedWorkspace=copy(result.workspace);acknowledgedRevision=result.revision}
  state.value=merged.state;draftBaseline=copy(merged.state.workspace)
  reconcileRemovedScope()
  deferredBackground.value=false;deferredBackgroundBase=undefined
  if(identity)selectedId.value=merged.state.workspace.identities.find(item=>item.source===identity.source&&item.key===identity.key)?.id||selectedId.value
  if(selectedId.value)selectedId.value=resolveRecordId(selectedId.value,merged.state.recordIdAliases)
  panelRecordId.value=resolveRecordId(panelRecordId.value,merged.state.recordIdAliases)
  if(merged.conflicts.length)saveError.value='Planner changes overlap with another update. Your current draft is preserved. Export a backup before resolving the conflicting fields.'
  if(direct)refreshAmbiguousPublication()
}
function scheduleCloudSync(){clearTimeout(syncTimer);if(!managedSync&&connected.value)syncTimer=setTimeout(()=>void automaticSync(),1200)}
async function automaticSync(manual=false){
  if(!state.value||!plannerSyncReady({connection:state.value.connection,online:networkOnline.value,restoring:deviceSync.value?.restoring,syncing:syncing.value||deviceSync.value?.plannerSyncing})||typeof api.syncWorkspace!=='function')return
  if(!plannerRetryReady.value){if(!manual)scheduleCloudSync();return}
  if(!manual&&state.value.storage.syncStatus==='conflict')return
  const before=copy(state.value),version=mutationVersion
  syncing.value=true
  try{
    const result=await api.syncWorkspace()
    await adoptBackground(result,before,version)
    void syncNativeNoteLinks()
    if(manual&&result.storage.syncStatus==='synced')notify('Planner synced to Nextcloud')
  }catch(reason){if(state.value)state.value.storage={...state.value.storage,syncStatus:'error',message:msg(reason)}}
  finally{syncing.value=false;if(version!==mutationVersion||state.value?.storage.syncStatus==='pending')scheduleCloudSync()}
}
function persist(){
  if(!state.value||state.value.connection.recoveryOnly)return
  state.value.workspace.updatedAt=new Date().toISOString()
  const snapshot=copy(state.value.workspace),base=copy(failedWorkspaceBase||draftBaseline||acknowledgedWorkspace||snapshot),version=++mutationVersion
  draftBaseline=copy(snapshot);saving.value++
  saveQueue=saveQueue.then(async()=>{
    const editBase=copy(failedWorkspaceBase||base)
    try{
      let latest=acknowledgedWorkspace||base,revision=state.value!.revision
      for(let attempt=0;attempt<3;attempt++){
        const merged=mergeWorkspaces(editBase,snapshot,latest)
        if(merged.conflicts.length)throw new Error('This planner edit overlaps another update. Your draft is preserved; export a backup before resolving the conflict.')
        try{
          const result=await api.saveWorkspace(merged.workspace,revision)
          if(!state.value)return
          const stale=result.revision<acknowledgedRevision||result.revision<state.value.revision
          if(result.revision>=acknowledgedRevision){acknowledgedWorkspace=copy(result.workspace);acknowledgedRevision=result.revision}
          const display=stale?mergeWorkspaces(merged.workspace,copy(state.value.workspace),acknowledgedWorkspace||result.workspace):version===mutationVersion?{workspace:result.workspace,conflicts:[]}:mergeWorkspaces(snapshot,copy(state.value.workspace),result.workspace)
          state.value.revision=Math.max(state.value.revision,result.revision)
          if(!display.conflicts.length)state.value.workspace=withDeviceViewPreferences(display.workspace,toRaw(state.value.workspace))
          if(!stale)state.value.storage=result.storage
          draftBaseline=copy(state.value.workspace);failedWorkspaceBase=undefined
          saveError.value=display.conflicts.length?'Another update overlaps your pending draft. Your draft is preserved.':''
          return
        }catch(reason){
          const code=(reason as {code?:string})?.code
          if(attempt===2||!(['REVISION_CONFLICT','STALE_REVISION'].includes(code||'')||/changed since you opened|changed in another operation|[Ss]tale.*revision/.test(msg(reason))))throw reason
          const fresh=await api.getState();latest=fresh.workspace;revision=fresh.revision
          if(fresh.revision>=acknowledgedRevision){acknowledgedWorkspace=copy(fresh.workspace);acknowledgedRevision=fresh.revision}
        }
      }
    }catch(reason){failedWorkspaceBase=copy(editBase);saveError.value=msg(reason)}finally{saving.value--}
  })
}
function updateSettings(patch:Partial<PlannerSettings>){if(!state.value||metadataLocked.value)return;state.value.workspace.planner={...plannerSettings(state.value.workspace.planner),...patch,excludedSpaceIds:[]};rememberScopePreferences(true);if(!isDeviceViewPatch(patch))persist()}
function setShowDone(value:boolean){updateSettings({showCompletedByView:{...settings.value.showCompletedByView,[settings.value.view]:value}})}
function setView(view:PlannerView){const cancelTiming=uiDiagnostics.markIntent('page');if(!state.value||metadataLocked.value||view===settings.value.view){cancelTiming();return}leaveWidgetContext();rememberScopePreferences();if(view==='overview')timelineDays.value=7;else if(view==='timeline')timelineDays.value=14;state.value.workspace.planner=restorePreferenceFields(settings.value,view);rememberScopePreferences();filterOpen.value=false;listLimit.value=120}
function setScope(id:string){if(!state.value||metadataLocked.value)return;changeScope(id);persist()}
function setAssignment(value:'me'|'all'){updateSettings({scopeAssignments:{...settings.value.scopeAssignments,[settings.value.scopeId]:value},...(settings.value.scopeId==='all'?{assignment:value}:{})})}
function toggleSettingList(key:'unassignedBoardIds'|'hiddenCollectionIds',id:string){const list=settings.value[key];updateSettings({[key]:list.includes(id)?list.filter(i=>i!==id):[...list,id]})}
function resetFilters(){statusIds.value=[];query.value='';attention.value='all';listKind.value='all';const mode=settings.value.scopeId==='all'?'me':'all';updateSettings({hiddenCollectionIds:[],excludedSpaceIds:[],unassignedBoardIds:[],includeUnassigned:false,scopeAssignments:{...settings.value.scopeAssignments,[settings.value.scopeId]:mode},...(settings.value.scopeId==='all'?{assignment:mode}:{})})}
function showAttention(value:string){setView('list');attention.value=value;listKind.value='all'}
function changeTimelineRange(range:{anchor:string;days:number}){if(!Number.isFinite(range.days))return;timelineDays.value=Math.max(1,Math.min(90,Math.round(range.days)));anchor.value=dateValue(range.anchor)}
function navigateWeek(amount:number){if(!timelineView.value){anchor.value=dateValue(shiftCalendarAnchor(anchor.value,calendarMode.value,amount));return}const date=new Date(anchor.value);date.setDate(date.getDate()+amount*timelineDays.value);anchor.value=date}
function setCalendarMode(value:unknown){calendarMode.value=normalizeCalendarMode(value);rememberScopePreferences()}
function openCalendarDay(value:string){anchor.value=dateValue(value);setCalendarMode('day')}
function recordGroup(record:WorkspaceRecord){return recordGrouping(record,{spaces:state.value?.workspace.spaces||[],categories:state.value?.workspace.categories||[],projects:state.value?.workspace.projects||[],scopeId:settings.value.scopeId})}
function recordCategory(record:WorkspaceRecord){return recordGroup(record).category}
function recordLocation(record:WorkspaceRecord){const group=recordGroup(record);return [group.space?.name,group.category?.name,group.project?.name].filter(Boolean).join(' / ')}
async function openCategories(spaceId=currentSpace.value?.id||'all'){if(!state.value||metadataLocked.value||!spaceId||!allowDiscard(modalDirty.value)||!await flushAppearance())return;await saveQueue;if(!state.value||metadataLocked.value||spaceId!=='all'&&!state.value.workspace.spaces.some(space=>space.id===spaceId))return;organizationBaseline=copy(state.value.workspace);categoriesDirty.value=false;categorySpaceId.value=spaceId;sidebarOpen.value=false;error.value='';modal.value='categories'}
async function saveCategories(next:Workspace){
  if(!state.value||metadataLocked.value||saving.value)return
  if(categorySpaceId.value!=='all'&&(!next.spaces.some(space=>space.id===categorySpaceId.value)||!state.value.workspace.spaces.some(space=>space.id===categorySpaceId.value))){error.value='This Space is no longer available. Your draft is kept.';return}
  if(!applyOrganizationDraft(next))return
  if(!availableScopes(state.value.workspace).includes(settings.value.scopeId))changeScope(categorySpaceId.value)
  persist();await saveQueue
  if(saveError.value){error.value=saveError.value;return}
  categoriesDirty.value=false;modal.value=null;notify('Source groups saved')
}
function applyOrganizationDraft(next:Workspace){
  if(!state.value||!organizationBaseline)return false
  const merged=mergeWorkspaces(organizationBaseline,next,copy(state.value.workspace))
  if(merged.conflicts.length){error.value='These organization changes overlap a newer update. Your draft is kept; cancel and reopen to review the current version.';return false}
  const updated=withDeviceViewPreferences(merged.workspace,copy(state.value.workspace))
  state.value.workspace.spaces=updated.spaces;state.value.workspace.categories=updated.categories;state.value.workspace.projects=updated.projects
  if(updated.planner.arrangements)state.value.workspace.planner.arrangements=updated.planner.arrangements;else delete state.value.workspace.planner.arrangements
  const valid=new Set(availableScopes(state.value.workspace))
  state.value.workspace.planner.scopeAssignments=Object.fromEntries(Object.entries(settings.value.scopeAssignments).filter(([id])=>valid.has(id)))
  scopePreferences.value=pruneScopePreferences(scopePreferences.value,[...valid]);storeLocalPreferences()
  return true
}
async function saveSpaceDefinition(next:Workspace){
  if(!state.value||metadataLocked.value||saving.value||!organizationBaseline)return
  const id=scopeDraft.value.id||next.spaces.find(space=>!organizationBaseline!.spaces.some(previous=>previous.id===space.id))?.id
  if(!id||!next.spaces.some(space=>space.id===id)){error.value='The Space could not be identified. Your draft is kept.';return}
  if(scopeDraft.value.id&&!state.value.workspace.spaces.some(space=>space.id===id)){error.value='This Space was removed on another device. Your draft is kept.';return}
  if(!applyOrganizationDraft(next))return
  changeScope(id);persist();await saveQueue
  if(saveError.value){error.value=saveError.value;return}
  spaceEditorDirty.value=false;modal.value=null;notify('Space saved')
}
const recordPresentation=createRecordPresentation({collections:()=>state.value?.collections||[],workspace:()=>state.value?.workspace,fallback:()=>primary.value})
function sourceColorFor(record:WorkspaceRecord){return recordPresentation.sourceColorFor(record)}
function colorFor(record:WorkspaceRecord){return normalizeColor(record.color)||safeColor(state.value?.workspace.appearance.calendarColors[record.collectionId||''])||sourceColorFor(record)}
function tagsFor(record:WorkspaceRecord){return recordPresentation.tagsFor(record)}
function sourceAvailable(source:Source){return connected.value&&networkOnline.value&&!busy.value&&!loginWaiting.value&&Boolean(state.value?.statuses.some(s=>s.source===source&&s.state==='connected'))}
function nativeOperationAvailable(operation:keyof WorkspaceApi){return !props.sessionReadOnly&&canUseNativeOperation({operation,implemented:typeof api[operation]==='function',canMutateNative,hostOperations:props.nativeOperations,runtimeOperations:state.value?.nativeOperations})}
function nativeOperationImplemented(operation:keyof WorkspaceApi){return typeof api[operation]==='function'&&(props.nativeOperations?props.nativeOperations.includes(operation):canMutateNative)}
function sourceWriteReady(source:Source){return canWriteNativeSource({source,connected:connected.value,online:networkOnline.value,busy:busy.value,loginWaiting:loginWaiting.value,statuses:state.value?.statuses,nativeWriteSources:state.value?.nativeWriteSources})}
function sourceWritable(source:Source,operation:keyof WorkspaceApi){return nativeOperationAvailable(operation)&&sourceWriteReady(source)}
function canComplete(record:WorkspaceRecord){const operation=completionOperation(record,state.value?.collections);return Boolean(operation&&sourceWritable(record.source,operation))}
function canDeleteEvent(record:WorkspaceRecord){return Boolean(eventDeleteOperation(record,state.value?.collections)&&sourceWritable('calendar','deleteEvent'))}
function canDeleteTask(record:WorkspaceRecord){return Boolean(taskDeleteOperation(record,state.value?.collections)&&sourceWritable('tasks','deleteTask')&&state.value?.connection.serverUrl&&state.value.connection.username)}
function canEditEvent(record:WorkspaceRecord){return Boolean(eventEditOperation(record,state.value?.collections)&&sourceWritable('calendar','updateEvent'))}
function canRespondEvent(record:WorkspaceRecord){return Boolean(eventRespondOperation(record,state.value?.collections)&&sourceWritable('calendar','respondToEvent'))}
function eventActionReason(record:WorkspaceRecord,operation:'updateEvent'|'deleteEvent'|'respondToEvent'){const allowed=operation==='updateEvent'?canEditEvent(record):operation==='deleteEvent'?canDeleteEvent(record):canRespondEvent(record);return eventActionExplanation(record,{allowed,implemented:nativeOperationImplemented(operation),runtimeReady:nativeOperationAvailable(operation),connected:connected.value&&networkOnline.value,sourceReady:sourceWriteReady('calendar')})}
async function respondEvent(participation:'ACCEPTED'|'TENTATIVE'|'DECLINED'){const record=selected.value;if(!record||!canRespondEvent(record)||!record.etag||!api.respondToEvent)return;const input={id:record.id,etag:record.etag,participation};await run(()=>api.respondToEvent!(input),'Response saved in Nextcloud')}
async function openEventEditor(){const record=selected.value;if(!record||!canEditEvent(record)||!await flushAppearance()||!allowDiscard(inspectorDirty.value))return;editingNote.value=false;panelRecordId.value=record.id;componentDraftDirty.value=false;error.value='';modal.value='edit-event'}
async function saveEvent(input:EventEditorChanges){
  const record=state.value?.records.find(item=>item.id===input.id);if(!record||!canEditEvent(record)||!api.updateEvent)return
  const patch:Partial<WorkspaceRecord>={}
  for(const key of ['title','start','end','allDay','location','reminders'] as const)if(key in input)Object.assign(patch,{[key]:input[key]})
  if('description' in input)patch.body=input.description
  error.value='';const okay=await saveSourceEdit(record.id,patch,()=>api.updateEvent!(input))
  if(okay){componentDraftDirty.value=false;modal.value=null;notify('Event saved in Nextcloud')}else error.value=sourceFailures.value.find(item=>item.id===record.id)?.message||'Could not save. Your draft is kept.'
}
function canAttachDeck(record:WorkspaceRecord,operation:'attachDeckFile'|'removeDeckAttachment'|'uploadDeckAttachment'='attachDeckFile'){return Boolean(deckAttachmentOperation(record,state.value?.collections,operation)&&sourceWritable('deck',operation))}
async function requestDeleteEvent(record:WorkspaceRecord){if(!canDeleteEvent(record)||!await flushAppearance()||!allowDiscard(inspectorDirty.value))return;editingNote.value=false;deleteEventDraft.value={id:record.id,title:record.title,account:inspectorAccount.value,fingerprint:eventDeleteFingerprint(record)};error.value='';modal.value='delete-event'}
async function confirmDeleteEvent(){const record=deletingEvent.value;if(!record||deleteEventChanged.value||!canDeleteEvent(record)||!api.deleteEvent)return;const id=record.id;const okay=await run(()=>{if(deleteEventChanged.value||deletingEvent.value?.id!==id)throw new Error('This event changed. Cancel and review its latest details before deleting.');return api.deleteEvent!({id})},'Calendar event deleted');if(okay){modal.value=null;deleteEventDraft.value=null;if(selectedId.value===id)selectedId.value=null}}
async function requestDeleteTask(record:WorkspaceRecord){
  const account=inspectorAccount.value
  if(!canDeleteTask(record)||!await flushAppearance()||!allowDiscard(inspectorDirty.value))return
  const current=state.value,source=current?.collections.find(collection=>collection.source==='tasks'&&collection.id===record.collectionId)
  const serverUrl=current?.connection.serverUrl,username=current?.connection.username
  if(account!==inspectorAccount.value||!source||!serverUrl||!username||selected.value?.id!==record.id||taskDeleteFingerprint(record)!==taskDeleteFingerprint(selected.value))return
  editingNote.value=false
  deleteTaskDraft.value={id:record.id,title:record.title,source:source.title,fingerprint:taskDeleteFingerprint(record),account,expectedAccount:{serverUrl,username}}
  error.value='';modal.value='delete-task'
}
async function confirmDeleteTask(){
  const draft=deleteTaskDraft.value,record=deletingTask.value,remove=api.deleteTask
  if(!draft||!record?.etag||!remove||deleteTaskChanged.value||!canDeleteTask(record))return
  const {id,etag}=record
  const okay=await run(()=>{
    if(deleteTaskDraft.value!==draft||deleteTaskChanged.value||deletingTask.value?.id!==id)throw new Error('This task changed. Cancel and review its latest details before deleting.')
    return remove.call(api,{id,etag,expectedAccount:draft.expectedAccount})
  },'Task deleted')
  if(okay){modal.value=null;deleteTaskDraft.value=undefined;if(selectedId.value===id)selectedId.value=null}
}
function statusLabel(record:WorkspaceRecord){return unifiedStatus(record,effectiveMapping.value)?.title||record.status||sourceLabels[record.source]}
function mappedStatus(record:WorkspaceRecord){return unifiedStatus(record,effectiveMapping.value)||{title:'Unmapped',color:'#8b939f'}}
function statusControlStyle(record:WorkspaceRecord){const color=mappedStatus(record).color;return {'--status-color':color,'--status-text':textOnColor(color)}}
function statusOptions(record:WorkspaceRecord){return record.kind==='card'?(selectedDeck.value?.stacks||[]).map(stack=>({...stack,color:mappedStatus({...record,stackId:stack.id,completed:false}).color})):TASK_STATUSES.map(status=>({...status,color:mappedStatus({...record,status:status.id,completed:status.id==='COMPLETED',percentComplete:taskStatusProgress(status.id,record.percentComplete)}).color}))}
function taskReadOnly(record:WorkspaceRecord){return Boolean(record.readonly||state.value?.collections.find(collection=>collection.id===record.collectionId&&collection.source==='tasks')?.readonly)}
function canChangeTaskStatus(record:WorkspaceRecord){return record.kind==='task'&&record.source==='tasks'&&!taskReadOnly(record)&&sourceWritable('tasks','updateTaskStatus')}
async function changeTaskStatus(record:WorkspaceRecord,status:string){
  if(!canChangeTaskStatus(record)||!TASK_STATUSES.some(option=>option.id===status)||nativeStatus(record)===status)return
  await saveSourceEdit(record.id,{status,completed:status==='COMPLETED',percentComplete:taskStatusProgress(status,record.percentComplete)},current=>api.updateTaskStatus!({id:record.id,status,etag:current.etag}))
}
function isLinked(record:WorkspaceRecord){return relations.value.some(r=>r.fromId===record.id||r.toId===record.id)}
async function run(operation:()=>Promise<State>,success?:string){if(busy.value||!await flushAppearance()||busy.value)return false;busy.value=true;error.value='';try{await sourceEdits.idle();await saveQueue;if(saveError.value)throw new Error('Save your planner changes before continuing. Use Retry save in the banner.');if(sourceFailures.value.length)throw new Error('Retry or discard failed source edits before changing the planner. Your edits are preserved.');applyState(await operation());if(success)notify(success);return true}catch(err){error.value=msg(err);return false}finally{busy.value=false}}
function saveSourceEdit(id:string,patch:Partial<WorkspaceRecord>,operation:(record:WorkspaceRecord)=>Promise<State>,replaceSameDraft=false){
  const failure=sourceFailures.value.find(item=>resolveRecordId(item.id)===resolveRecordId(id))
  if(failure&&!(replaceSameDraft&&failure.fields.length&&failure.fields.every(field=>Object.hasOwn(patch,field)))){error.value='This item has a failed edit. Use Retry edit or explicitly discard that edit before making another change.';return Promise.resolve(false)}
  sourceFailures.value=sourceFailures.value.filter(item=>resolveRecordId(item.id)!==resolveRecordId(id))
  // Keep a pre-remap queue's key until its pending operations have drained.
  const queueId=sourceEdits.protectedIds().find(key=>resolveRecordId(key)===resolveRecordId(id))||id
  return sourceEdits.enqueue(queueId,copy(patch),async record=>{
    const result=await operation(record),canonical=resolveRecordId(queueId,result.recordIdAliases),saved=result.records.find(item=>item.id===canonical)
    if(saved&&lastHostState){
      // This item is now acknowledged, not an unsaved local difference. Advance
      // only its comparison baseline; unrelated local drafts keep their base.
      const index=lastHostState.records.findIndex(item=>resolveRecordId(item.id,result.recordIdAliases)===canonical)
      const records=[...lastHostState.records]
      if(index>=0)records[index]=copy(saved);else records.push(copy(saved))
      lastHostState={...lastHostState,records}
    }
    refreshAmbiguousPublication();return saved?{...saved,id:queueId}:undefined
  })
}
function refreshAmbiguousPublication(force=false){
  // State.revision orders planner writes, not native item writes. A notification
  // queued before an acknowledged item edit cannot be replayed after its guard
  // is released. Only this race needs one authoritative read; normal supplied
  // publications never refetch the full state.
  if(!force&&!hostPublications.hasPending()&&!publicationRefresh)return
  hostPublicationVersion++
  hostPublications.clear()
  if(publicationRefresh){publicationRefreshAgain=true;return}
  const version=hostPublicationVersion,account=inspectorAccount.value
  publicationRefresh=api.getState().then(result=>{if(!unmounted&&version===hostPublicationVersion&&account===inspectorAccount.value)hostPublications.offer(result)}).catch(reason=>{if(!unmounted&&account===inspectorAccount.value)error.value=msg(reason)}).finally(()=>{publicationRefresh=undefined;if(publicationRefreshAgain&&!unmounted&&account===inspectorAccount.value){publicationRefreshAgain=false;refreshAmbiguousPublication(true)}else{publicationRefreshAgain=false;hostPublications.resume()}})
}
async function retrySourceEdit(id:string){
  if(busy.value||loginWaiting.value||!connected.value)return
  const failure=sourceFailures.value.find(item=>item.id===id)
  if(id===selectedId.value&&noteTagsDirty.value&&failure?.fields.every(field=>['tags','tagDetails'].includes(field))){await noteTagsEditor.value?.flush(true);return}
  if(id===selectedId.value&&appearanceEditor.value?.hasDirty()&&failure?.fields.every(field=>['color','tags','tagDetails'].includes(field))){await appearanceEditor.value.flush(true);return}
  const record=state.value?.records.find(item=>item.id===resolveRecordId(id))
  const failedNote=record?.kind==='note'&&editingNote.value&&noteDraft.value.id===record.id&&failure?.fields.includes('body')&&failure.fields.every(field=>['body','title','remote'].includes(field))
    ? {title:failure.patch.title??record.title,content:failure.patch.body??record.body??'',category:String(failure.patch.remote?.category??record.remote?.category??'')} : undefined
  const generation=contentSaveGeneration
  sourceFailures.value=sourceFailures.value.filter(item=>item.id!==id)
  const okay=await sourceEdits.retry(id)
  if(!failedNote||generation!==contentSaveGeneration||!editingNote.value||noteDraft.value.id!==resolveRecordId(id))return
  if(!okay){contentError.value=sourceFailures.value.find(item=>item.id===id)?.message||'Could not save. Your draft is still here.';return}
  const saved=state.value?.records.find(item=>item.id===resolveRecordId(id))
  if(!saved)return
  const acknowledged={id:saved.id,title:saved.title,content:saved.body||'',category:String(saved.remote?.category||''),etag:saved.etag}
  const draft=copy(noteDraft.value)
  // Retire the failed draft, while retaining anything typed before or during
  // retry. Unchanged fields adopt server normalization and independent edits.
  for(const field of ['title','content','category'] as const)if(draft[field]===failedNote[field])draft[field]=acknowledged[field]
  draft.etag=acknowledged.etag;noteDraft.value=draft;noteBaseline.value=JSON.stringify(acknowledged);contentError.value=''
  if((['title','content','category'] as const).every(field=>draft[field]===acknowledged[field])){
    editingNote.value=false
    if(modal.value==='note-editor'||modal.value==='note-conflict')modal.value=null
  }else if(modal.value==='note-conflict')modal.value=noteConflictReturn
}
function clearSourceFailures(){for(const failure of sourceFailures.value)sourceEdits.discard(failure.id);sourceFailures.value=[]}
function discardSourceEdit(id:string){sourceEdits.discard(id);sourceFailures.value=sourceFailures.value.filter(item=>item.id!==id);if(id===selectedId.value&&noteTagsDirty.value)noteTagsEditor.value?.discard()}
function pendingEditsBeforeClose(event:BeforeUnloadEvent){if(resourceBusy.value||noteLinkBusy.value||sourceSaving.value||sourceFailures.value.length||saving.value||saveError.value||busy.value||capturing.value||inspectorDirty.value||modalDirty.value){event.preventDefault();event.returnValue='There are edits or planner changes that have not been saved.'}}
async function refresh(manual:boolean|Event=true){
  if(!state.value||!canRefreshSources(state.value.connection,{networkOnline:networkOnline.value,refreshing:refreshing.value,busy:busy.value,loginWaiting:loginWaiting.value}))return
  const before=copy(state.value),version=mutationVersion;refreshing.value=true
  try{await adoptBackground(await api.refresh(),before,version);const issues=state.value?.statuses.filter(status=>status.state==='error')||[];nativeRefreshFailed.value=issues.length>0;if(!issues.length&&state.value?.statuses.some(status=>status.state==='connected'))lastSourcesRefreshedAt.value=Date.now();if(manual&&issues.length)notify(`Some sources could not refresh. Check ${issues.map(status=>sourceLabels[status.source]).join(', ')}.`);await migrateDeckDependencies();void syncNativeNoteLinks()}
  catch(reason){nativeRefreshFailed.value=true;if(manual)error.value=msg(reason)}finally{refreshing.value=false;scheduleCloudSync()}
}
async function sync(){await automaticSync(true);if(state.value?.storage.syncStatus==='synced')await migrateDeckDependencies();void syncNativeNoteLinks()}
async function resolvePlannerConflict(choice:PlannerConflictChoice,revision:number){
  const connection=state.value?.connection, resolve=api.resolveWorkspaceConflict
  if(!resolve||!plannerRetryReady.value||!connection?.serverUrl||!connection.username||state.value?.plannerConflict?.revision!==revision)return
  const account={serverUrl:connection.serverUrl,username:connection.username},accountKey=inspectorAccount.value
  const okay=await run(()=>{
    if(inspectorAccount.value!==accountKey||state.value?.revision!==revision||state.value.plannerConflict?.revision!==revision)throw new Error('The saved copies changed. Review the latest conflict before choosing.')
    return resolve.call(api,choice,revision,account)
  })
  if(okay&&!state.value?.plannerConflict){reconcileRemovedScope();notify('Planner conflict choice saved')}
}
async function exportPlanner(){try{await saveQueue;if(saveError.value&&state.value){const url=URL.createObjectURL(new Blob([JSON.stringify(state.value.workspace,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='NextGlance-unsaved-planner.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Unsaved planner draft exported');return}const result=await api.exportWorkspace();if(result.exported)notify('Planner metadata exported')}catch(err){error.value=msg(err)}}
async function external(url?:string){if(url)try{await api.openExternal(url)}catch(err){error.value=msg(err)}}
async function complete(record:WorkspaceRecord){if(!canComplete(record))return;const completed=!isClosed(record);await saveSourceEdit(record.id,{completed,...(record.kind==='task'?{status:completed?'COMPLETED':'NEEDS-ACTION',percentComplete:taskStatusProgress(completed?'COMPLETED':'NEEDS-ACTION',record.percentComplete)}:{})},()=>record.kind==='card'?api.setCardCompleted!({id:record.id,completed}):api.setTaskCompleted({id:record.id,completed}))}
function allowDiscard(dirty:boolean){return !dirty||window.confirm('Discard your unsaved draft? Your saved items will stay unchanged.')}
async function flushAppearance(){if(resourceBusy.value||noteLinkBusy.value)return false;return (await appearanceEditor.value?.flush()??true)&&(await noteTagsEditor.value?.flush()??true)}
async function openRecord(record:WorkspaceRecord,remember=false){
  const cancelTiming=uiDiagnostics.markIntent('panel')
  if(record.id===selectedId.value){cancelTiming();return false}
  if(!await flushAppearance()){cancelTiming();return false}
  const confirmation=inspectorDirty.value
  if(!allowDiscard(confirmation)){cancelTiming();return false}
  if(confirmation)uiDiagnostics.markIntent('panel') // Confirmation deliberation is not rendering latency.
  if(remember&&selectedId.value)inspectorHistory.value.push(selectedId.value);else if(!remember)inspectorHistory.value=[]
  ++contentSaveGeneration;appearanceDirty.value=false;appearanceError.value='';noteTagsDirty.value=false;selectedId.value=record.id;contentError.value='';editingNote.value=false;sidebarOpen.value=false;return true
}
async function openLinkedRecord(record:WorkspaceRecord){await openRecord(record,true)}
const cardTaskLists=computed(()=>{
  if(!state.value)return []
  const ids=currentSpace.value?organizationSourcePool(state.value.workspace,currentSpace.value.id,state.value.collections.map(c=>c.id)):null
  return state.value.collections.filter(c=>c.source==='tasks'&&!c.readonly&&(!ids||ids.includes(c.id)))
})
const cardTaskDestination=computed(()=>{const preferred=captureDestination('task');return cardTaskLists.value.some(c=>c.id===preferred)?preferred:cardTaskLists.value.length===1?cardTaskLists.value[0]!.id:''})
async function openCardTasks(mode:'create'|'checklist'){
  if(selected.value?.kind!=='card'||metadataLocked.value||!sourceWritable('tasks','createTask')||!await flushAppearance())return
  if(!allowDiscard(inspectorDirty.value))return
  editingNote.value=false;panelRecordId.value=selected.value.id;cardTaskFormKey.value++;cardTasksMode.value=mode;cardTaskProgress.value='';componentDraftDirty.value=false;error.value='';modal.value='card-tasks'
}
async function submitCardTasks(entries:CardTaskEntry[]){
  if(!panelRecord.value||!sourceWritable('tasks','createTask'))return
  const cardId=panelRecord.value.id,account=inspectorAccount.value
  let linksPending=false
  const okay=await run(async()=>{
    if(inspectorAccount.value!==account)throw new Error('The Nextcloud account changed. Reopen the card before creating tasks.')
    const result=await createCardTasks({api,cardId,entries:copy(entries),deferLinkSync:props.mobileHost&&managedSync,onState:next=>{if(inspectorAccount.value===account)applyState(next)},onProgress:p=>{
      cardTaskProgress.value=p.phase==='reserve'?'Saving task requests in Nextcloud…':p.phase==='publish'?'Syncing task links…':`${p.completed} / ${p.total} tasks · ${p.title}`
    }})
    if(inspectorAccount.value!==account)throw new Error('The Nextcloud account changed. Reopen the card before continuing.')
    linksPending=result.linksPending
    return result.state
  })
  if(okay){componentDraftDirty.value=false;modal.value=null;notify(linksPending?'Tasks created. Links saved and waiting to sync.':'Tasks saved and linked')}
}
async function jumpLinked(intent:{id:string;view?:'calendar'|'timeline'}){
  if(!state.value||!plannerState.value||metadataLocked.value)return
  const destination=['overview','calendar','timeline'].includes(settings.value.view)?settings.value.view:intent.view
  const preference=scopePreferencesFor(scopePreferences.value,settings.value.scopeId,settings.value,destination as PlannerView)
  const projected=destination===settings.value.view?model.value:selectPlanner({...plannerState.value,workspace:{...plannerState.value.workspace,planner:applyScopePreferences(settings.value,settings.value.scopeId,preference)}},{query:preference.query,statusIds:preference.statusIds,now:now.value,...completionHistoryOptions(destination)})
  const target=linkedNavigation({recordId:resolveRecordId(intent.id),records:records.value,visibleIds:projected?.records.map(r=>r.id)||[],currentView:settings.value.view,destination:intent.view})
  if(!target.ok){notify(target.message);return}
  const record=recordsById.value.get(resolveRecordId(intent.id))!
  if(record.id!==selectedId.value){if(!await openRecord(record,true))return}
  else if(!await flushAppearance()||!allowDiscard(inspectorDirty.value))return
  setView(target.view)
  if(target.date)anchor.value=dateValue(target.date)
  await nextTick();await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
  const view=target.view==='overview'?overviewSplit.value:target.view==='timeline'?standaloneTimeline.value:calendarMode.value==='month'?monthCalendar.value:standaloneCalendar.value
  await view?.revealRecord(record.id)
}

async function backToItem(){const history=[...inspectorHistory.value];while(history.length){const id=history.pop(),record=state.value?.records.find(item=>item.id===resolveRecordId(id!));if(record){if(await openRecord(record))inspectorHistory.value=history;return}}inspectorHistory.value=[]}
async function closeInspector(){if(!await flushAppearance()||!allowDiscard(inspectorDirty.value))return;++contentSaveGeneration;appearanceDirty.value=false;appearanceError.value='';noteTagsDirty.value=false;inspectorHistory.value=[];selectedId.value=null;editingNote.value=false}
function cancelContent(){if(allowDiscard(editingNote.value&&JSON.stringify(noteDraft.value)!==noteBaseline.value)){editingNote.value=false;if(modal.value==='note-editor')modal.value=null}}
function openNoteEditor(){if(!selected.value||selected.value.kind!=='note'||!canEditContent.value)return;if(!editingNote.value)editContent();modal.value='note-editor'}
function openConnection(type:RelationType,taskOnly=false){relationTaskOnly.value=taskOnly;if(!selected.value||metadataLocked.value)return;panelRecordId.value=selected.value.id;relationMode.value=type==='depends_on'?'dependency':type==='reference'?'note':'related';createdPickerNote.value=undefined;error.value='';modal.value='relation'}
function openSchedule(mode:'create'|'link'){if(!selected.value)return;scheduleRecordId.value=selected.value.id;scheduleMode.value=mode;scheduleSubmitted.value=false;error.value='';modal.value='schedule'}
async function scheduleLinked(input:ScheduleRequest){if(!sourceWritable('calendar','createLinkedEvent')||!api.createLinkedEvent||!state.value||busy.value)return;scheduleSubmitted.value=true;const okay=await run(()=>api.createLinkedEvent!({...input,expectedRevision:state.value!.revision}),'Calendar event created and linked');if(okay){modal.value=null;anchor.value=dateValue(input.start)}else{try{if(saveError.value)scheduleSubmitted.value=false;else{state.value=await api.getState();scheduleSubmitted.value=Boolean(state.value.pendingSchedules?.some(p=>p.requestId===input.requestId))}}catch{/* The form keeps the same request for a safe retry. */}}}
async function linkScheduled(eventId:string){if(!state.value||!scheduleRecord.value||metadataLocked.value)return;const event=state.value.records.find(r=>r.id===eventId&&r.kind==='event');if(!event)return;const existing=state.value.workspace.relations.some(r=>r.type==='scheduled_during'&&r.fromId===scheduleRecordId.value&&r.toId===eventId);if(!existing){const check=canAddRelation(relations.value,scheduleRecordId.value,eventId,'scheduled_during');if(!check.ok){error.value=check.message||'This link is invalid.';return}state.value.workspace.relations.push({id:crypto.randomUUID(),type:'scheduled_during',fromId:scheduleRecordId.value,toId:eventId})}persist();await saveQueue;if(saveError.value){error.value=saveError.value;return}modal.value=null;anchor.value=dateValue(event.start);notify('Calendar work session linked')}
function openScope(kind:'space'|'project',id?:string,parentSpaceId?:string){if(!state.value||metadataLocked.value)return;const draft=buildScopeDraft(state.value.workspace,{kind,id,parentSpaceId,scopeId:settings.value.scopeId,defaultColor:primary.value});if(!draft)return;organizationBaseline=copy(state.value.workspace);spaceEditorDirty.value=false;sidebarOpen.value=false;scopeDraft.value=draft;scopeSearch.value='';modal.value='scope';nextTick(()=>document.getElementById('scope-name')?.focus())}
function scopeSourceCategory(id:string){return scopeDraft.value.kind==='space'?(state.value?.workspace.categories?.find(c=>c.spaceId===scopeDraft.value.id&&c.collectionIds.includes(id))||state.value?.workspace.projects.find(p=>!p.archived&&p.spaceId===scopeDraft.value.id&&p.collectionIds.includes(id))):undefined}
function toggleScopeCollection(id:string){if(scopeSourceCategory(id))return;const ids=scopeDraft.value.collectionIds;scopeDraft.value.collectionIds=ids.includes(id)?ids.filter(i=>i!==id):[...ids,id]}
async function saveScope(){
  if(!state.value||metadataLocked.value||saving.value)return
  const d=scopeDraft.value
  if(d.kind!=='project'||!d.name.trim())return
  if(!state.value.workspace.spaces.some(space=>space.id===d.spaceId)){error.value='Choose an available Space for this project.';return}
  const id=d.id||crypto.randomUUID(),next=copy(organizationBaseline||state.value.workspace)
  const value:Project={id,spaceId:d.spaceId,name:d.name.trim(),color:d.color,collectionIds:[...d.collectionIds],recordIds:[...d.recordIds],...(d.tagNames?.length?{tagNames:normalizeOrganizationTags(d.tagNames)}:{}),...(d.categoryId&&next.categories?.some(category=>category.id===d.categoryId&&category.spaceId===d.spaceId)?{categoryId:d.categoryId}:{})}
  const index=next.projects.findIndex(project=>project.id===id)
  if(index>=0)next.projects[index]=value;else next.projects.push(value)
  const space=next.spaces.find(space=>space.id===d.spaceId)!
  space.collectionIds=[...new Set([...space.collectionIds,...value.collectionIds])]
  if(!applyOrganizationDraft(next))return
  d.id=id // Keep the same project identity if the durable save needs a retry.
  changeScope(id);persist();await saveQueue
  if(saveError.value){error.value=saveError.value;return}
  modal.value=null;notify('Project saved')
}
async function requestDeleteSpace(id:string){if(metadataLocked.value||busy.value||saving.value||!await flushAppearance()||!allowDiscard(Boolean(modalDirty.value)))return;const item=state.value?.workspace.spaces.find(space=>space.id===id);if(item){closeNavActions();sidebarOpen.value=false;deleteDraft.value={kind:'space',id:item.id,name:item.name};error.value='';modal.value='delete'}}
function requestDeleteScope(){const item=scopeDraft.value.kind==='project'?state.value?.workspace.projects.find(project=>project.id===scopeDraft.value.id):state.value?.workspace.spaces.find(space=>space.id===scopeDraft.value.id);if(item){deleteDraft.value={kind:scopeDraft.value.kind,id:item.id,name:item.name};modal.value='delete'}}
async function deleteScope(){
  if(!state.value||!deleteDraft.value||metadataLocked.value||saving.value)return
  const d=deleteDraft.value,removed=new Set([d.id,...(d.kind==='space'?[...(state.value.workspace.categories||[]).filter(group=>group.spaceId===d.id).map(group=>group.id),...state.value.workspace.projects.filter(project=>project.spaceId===d.id).map(project=>project.id)]:[])])
  if(d.kind==='space'){
    const wasActive=removed.has(settings.value.scopeId)
    if(wasActive)changeScope('all')
    state.value.workspace=removeSpace(copy(state.value.workspace),d.id)
  }else state.value.workspace.projects=state.value.workspace.projects.filter(project=>project.id!==d.id)
  if(removed.has(settings.value.scopeId))changeScope('all')
  for(const id of removed){scopeViewports.delete(id);delete state.value.workspace.planner.scopeAssignments[id];if(state.value.workspace.planner.arrangements)delete state.value.workspace.planner.arrangements[id]}
  scopePreferences.value=pruneScopePreferences(scopePreferences.value,availableScopes(state.value.workspace));storeLocalPreferences()
  persist();await saveQueue
  if(saveError.value){error.value=saveError.value;return}
  modal.value=null;notify(`${d.kind==='space'?'Space':'Project'} removed. Your Nextcloud items are unchanged.`)
}
function toggleProjectRecord(projectId:string){if(!state.value||!selected.value||metadataLocked.value)return;const project=state.value.workspace.projects.find(p=>p.id===projectId);if(!project)return;project.recordIds=project.recordIds.includes(selected.value.id)?project.recordIds.filter(id=>id!==selected.value!.id):[...project.recordIds,selected.value.id];persist()}

function saveArrangement(value:ScopeArrangement){
  if(metadataLocked.value)return
  const arrangements={...settings.value.arrangements},scope=settings.value.scopeId
  if(Object.keys(value).length)arrangements[scope]=value;else delete arrangements[scope]
  updateSettings({arrangements})
}
function orderTimeline(intent:{kind:'timelineRows'|'timelineGroups';ids:string[]}){saveArrangement({...scopeArrangement.value,[intent.kind]:intent.ids})}
function orderBoard(intent:{key:string;ids:string[]}){saveArrangement({...scopeArrangement.value,boardCards:{...scopeArrangement.value.boardCards,[intent.key]:intent.ids}})}
function resetTimelineOrder(){const {timelineRows,timelineGroups,...rest}=scopeArrangement.value;saveArrangement(rest)}
function resetBoardOrder(){const {boardCards,...rest}=scopeArrangement.value;saveArrangement(rest)}

function setWorkflow(id:string,column:WorkflowColumn){const record=state.value?.records.find(r=>r.id===id);if(!record||isClosed(record))return;updateSettings({workflow:{...settings.value.workflow,[id]:column}})}
async function moveCard(id:string,stackId:string){
  const record=state.value?.records.find(item=>item.id===id),collection=state.value?.collections.find(item=>item.id===record?.collectionId&&item.source==='deck'),stack=collection?.stacks?.find(item=>item.id===stackId)
  if(!record||record.kind!=='card'||record.readonly||collection?.readonly||!sourceWritable('deck','moveCard')||!api.moveCard||!stack||record.stackId===stackId)return
  await saveSourceEdit(id,{stackId,status:stack.title},()=>api.moveCard!({id,stackId}))
}
async function moveMappedStatus(input:{id:string;source:'deck'|'tasks';stackId?:string;status?:string;completed:boolean}){
  const record=state.value?.records.find(item=>item.id===input.id)
  if(!record||record.source!==input.source||record.readonly)return
  if(input.source==='tasks'&&api.updateTaskStatus&&input.status){
    await changeTaskStatus(record,input.status)
  }else if(input.source==='deck'&&sourceWritable('deck','setCardCompleted')&&sourceWritable('deck','moveCard')&&api.setCardCompleted&&api.moveCard){
    const stack=state.value?.collections.find(collection=>collection.id===record.collectionId)?.stacks?.find(item=>item.id===input.stackId)
    if(!input.completed&&!stack)return
    await saveSourceEdit(record.id,{completed:input.completed,...(stack?{stackId:stack.id,status:stack.title}:{})},async current=>{
      let result:State|undefined
      if(Boolean(current.completed)!==input.completed)result=await api.setCardCompleted!({id:record.id,completed:input.completed})
      if(stack&&current.stackId!==stack.id)result=await api.moveCard!({id:record.id,stackId:stack.id})
      return result||await api.getState()
    })
  }
}
let statusMappingBaseline:Workspace|undefined,statusMappingScope='all'
function openStatusMapping(){if(!metadataLocked.value&&state.value){error.value='';statusMappingBaseline=copy(state.value.workspace);statusMappingScope=settings.value.scopeId;modal.value='status-mapping'}}
async function saveStatusMapping(mapping:StatusMapping|null){
  if(metadataLocked.value||!state.value||!statusMappingBaseline||saving.value)return
  try{
    const next=setScopeStatusMapping(statusMappingBaseline,statusMappingScope,mapping)
    const merged=mergeWorkspaces(statusMappingBaseline,next,copy(state.value.workspace))
    if(merged.conflicts.length){error.value='The mapping changed on another device. Your draft is kept; reopen it to review the current mapping.';return}
    state.value.workspace.spaces=merged.workspace.spaces
    if(statusMappingScope==='all')state.value.workspace.planner.statusMapping=merged.workspace.planner.statusMapping
    persist();await saveQueue
    if(saveError.value){error.value=saveError.value;return}
    componentDraftDirty.value=false;modal.value=null;notify(mapping?'Unified status mapping saved':'Using the default status mapping')
  }catch(reason){error.value=msg(reason)}
}
async function saveAppearance(patch:{color?:string;tags?:string[];tagIds?:string[]}){
  const record=selected.value
  if(!record||!api.updateRecordAppearance||!sourceWritable(record.source,'updateRecordAppearance')||record.readonly){appearanceError.value='Connect this source before changing its color or tags.';return false}
  const collection=state.value?.collections.find(item=>item.id===record.collectionId)
  const display:Partial<WorkspaceRecord>={...(patch.color!==undefined?{color:patch.color}:{}),...(patch.tags?{tags:[...patch.tags]}:{})}
  if(patch.tagIds){display.tagDetails=(collection?.labels||record.tagDetails||[]).filter(tag=>patch.tagIds!.includes(tag.id));display.tags=display.tagDetails.map(tag=>tag.title)}
  appearanceSaving.value=true;appearanceError.value=''
  try{const okay=await saveSourceEdit(record.id,display,current=>api.updateRecordAppearance!({id:record.id,...copy(patch),etag:current.etag}),true);if(!okay)appearanceError.value=sourceFailures.value.find(item=>item.id===record.id)?.message||'Could not save. Your draft is preserved.';return okay}
  catch(reason){appearanceError.value=msg(reason);return false}
  finally{appearanceSaving.value=false}
}
async function saveTagColors(changes:{title:string;color:string}[]){
  if(!state.value||!selected.value||metadataLocked.value)return false
  appearanceError.value=''
  const previous={...state.value.workspace.properties['tag-colors']},colors={...previous}
  for(const input of changes){const key=tagColorKey(selected.value.collectionId,input.title);if(input.color)colors[key]=input.color;else delete colors[key]}
  state.value.workspace.properties['tag-colors']=colors;persist();await saveQueue
  if(saveError.value){
    const current=state.value.workspace.properties['tag-colors']||{}
    for(const change of changes){const key=tagColorKey(selected.value.collectionId,change.title);if((current[key]||'')===change.color){if(Object.hasOwn(previous,key))current[key]=previous[key];else delete current[key]}}
    appearanceError.value=saveError.value;return false
  }
  return true
}
function discardAppearance(){
  const failure=sourceFailures.value.find(item=>item.id===selectedId.value)
  if(failure&&failure.fields.every(field=>['color','tags','tagDetails'].includes(field)))discardSourceEdit(failure.id)
  appearanceError.value=''
}
function discardNoteTags(){const failure=sourceFailures.value.find(item=>item.id===selectedId.value);if(failure&&failure.fields.every(field=>['tags','tagDetails'].includes(field)))discardSourceEdit(failure.id);noteTagsError.value=''}
async function createBoardTag(title:string){const record=selected.value;if(record?.kind!=='card'||!record.collectionId||!api.createDeckLabel||!sourceWritable('deck','createDeckLabel'))throw new Error('Connect Deck to create a board tag.');const result=await api.createDeckLabel({collectionId:record.collectionId,title,color:sourceColorFor(record)});await adoptNativeResources();return result.label}
async function openEventMatches(){
  if(metadataLocked.value||!await flushAppearance()||metadataLocked.value||!state.value)return
  matchingRecords.value=copy(state.value.records)
  matchingRelations.value=copy(relations.value)
  error.value='';modal.value='event-matches'
}
async function linkEventMatches(pairs:{fromId:string;toId:string}[]){
  if(!state.value||metadataLocked.value||matchingSaving.value)return
  const additions:Relation[]=[],seen=new Set<string>(),existing=relations.value
  for(const pair of pairs){
    const from=state.value.records.find(item=>item.id===pair.fromId),to=state.value.records.find(item=>item.id===pair.toId)
    if(!from||!['task','card'].includes(from.kind)||!to||to.kind!=='event'){error.value='One of these items is no longer available. Review the suggestions again.';return}
    const key=JSON.stringify([from.id,to.id]);if(seen.has(key))continue;seen.add(key)
    if(existing.some(link=>link.type==='scheduled_during'&&link.fromId===from.id&&link.toId===to.id))continue
    const check=canAddRelation([...existing,...additions],from.id,to.id,'scheduled_during',state.value.records)
    if(!check.ok){error.value=check.message||'This pair cannot be linked.';return}
    additions.push({id:crypto.randomUUID(),type:'scheduled_during',fromId:from.id,toId:to.id})
  }
  if(!additions.length&&!saveError.value){componentDraftDirty.value=false;modal.value=null;notify('These items are already linked');return}
  matchingSaving.value=true;error.value=''
  try{
    state.value.workspace.relations.push(...additions);persist();await saveQueue
    if(saveError.value){
      // Failed confirmations stay in the dialog only: a later retry must use its current selection.
      const attemptedIds=new Set(additions.map(link=>link.id))
      state.value.workspace.relations=state.value.workspace.relations.filter(link=>!attemptedIds.has(link.id))
      error.value=saveError.value;return
    }
    componentDraftDirty.value=false;modal.value=null;notify(`${additions.length} calendar ${additions.length===1?'link':'links'} saved`)
  }finally{matchingSaving.value=false}
}
function captureDestination(type:CreateItemKind){
  const source=type==='event'?'calendar':type==='note'?'notes':type==='card'?'deck':'tasks',writable=captureCollections.value.filter(c=>c.source===source&&!c.readonly)
  if(widgetCapture.value){const destination=type==='note'?undefined:widgetCapture.value.config.creationDefaults[type]?.collectionId;return destination&&writable.some(c=>c.id===destination)?destination:writable.length===1?writable[0]!.id:''}
  if(type==='card'&&captureBoardId.value&&boardCollections.value.some(collection=>collection.id===captureBoardId.value&&!collection.readonly&&collection.stacks?.length))return captureBoardId.value
  const {project,category,space}=captureContext.value
  const inIds=(ids:string[]|undefined)=>ids?.find(id=>writable.some(c=>c.id===id))
  if(settings.value.scopeId==='all'){
    const record=recordsById.value.get(captureRange.value?.recordId||''),rowSource=writable.find(collection=>collection.id===record?.collectionId)
    return rowSource?.id||(writable.length===1?writable[0]!.id:'')
  }
  const projectDestination=inIds(project?.collectionIds)
  if(projectDestination)return projectDestination
  if(category)return inIds(category.collectionIds)||''
  const preferred=type==='event'?space?.defaultCalendarId:type==='task'?space?.defaultTaskListId:type==='card'?space?.defaultBoardId:undefined
  return preferred&&space?.collectionIds.includes(preferred)&&writable.some(c=>c.id===preferred)?preferred:inIds(space?.collectionIds)||''
}
async function openCapture(type:CreateItemKind='task',range?:CreationRange,boardId?:string,fromWidget?:NonNullable<typeof widgetCapture.value>){
  if(!fromWidget)leaveWidgetContext()
  if(!canCapture.value||!await flushAppearance()||!canCapture.value)return false
  if(fromWidget&&(widgetCapture.value!==fromWidget||widgetNavigationBlocked.value||modal.value||!captureKinds.value.includes(type)))return false
  captureType.value=captureKinds.value.includes(type)?type:captureKinds.value[0]!
  captureRange.value=range;captureBoardId.value=boardId;captureKey.value++
  componentDraftDirty.value=false;error.value='';modal.value='capture'
  return true
}
async function openBoardCapture(boardId?:string){if(!captureKinds.value.includes('card'))return;await openCapture('card',undefined,boardId)}
function createFromRange(range:CreationRange){openCapture(range.origin==='calendar'?'event':'task',range)}
async function capture(d:CreateItemRequest){
  if(!d.title.trim()||!state.value||capturing.value)return
  capturing.value=true
  try{
  const projectId=captureContext.value.project?.id,beforeIds=new Set(state.value.records.map(record=>record.id))
  let operation:()=>Promise<State>
  if(d.type==='note')operation=()=>api.createNote({title:d.title.trim(),content:d.content,collectionId:d.collectionId||undefined})
  else if(d.type==='event'){if(!api.createEvent)return;operation=()=>api.createEvent!({title:d.title.trim(),collectionId:d.collectionId,start:d.start!,end:d.end!,allDay:d.allDay,description:d.content,location:d.location,reminders:d.reminders,...(d.attendees?{attendees:d.attendees}:{})})}
  else if(d.type==='card'){if(!api.createCard)return;operation=()=>api.createCard!({title:d.title.trim(),collectionId:d.collectionId,stackId:d.stackId!,start:d.start,due:d.due,description:d.content,assignToMe:d.assignToMe})}
  else operation=()=>api.createTask({title:d.title.trim(),collectionId:d.collectionId,start:d.start,due:d.due,description:d.content})
  if(!await run(operation))return
  const created=state.value.records.find(record=>record.id===state.value?.createdRecordId)||state.value.records.find(record=>!beforeIds.has(record.id)&&record.title===d.title.trim())
  const project=state.value.workspace.projects.find(item=>item.id===projectId)
  if(project&&created&&!project.collectionIds.includes(created.collectionId||'')&&!project.recordIds.includes(created.id)){project.recordIds.push(created.id);persist();await saveQueue}
  componentDraftDirty.value=false;modal.value=null
  leaveWidgetContext()
  if(created)await openRecord(created)
  if(d.start||d.due)anchor.value=dateValue(d.start||d.due)
  if(saveError.value)error.value='The item was created in Nextcloud. Its project membership still needs Retry save; do not create it again.'
  else if(project&&!created)error.value='The item was created, but its identity could not be confirmed for project membership. Refresh and add it to the project from item details.'
  if(state.value.creationWarning)error.value=state.value.creationWarning
  notify(`${d.type==='note'?'Note':d.type==='event'?'Event':d.type==='card'?'Deck card':'Task'} created in Nextcloud`)
  }finally{capturing.value=false}
}
const canEditContent=computed(()=>Boolean(selected.value&&(selected.value.kind==='event'||!selected.value.readonly)&&(selected.value.kind==='note'?sourceWritable('notes','updateNote'):selected.value.kind==='event'?canEditEvent(selected.value):(selected.value.kind==='task'||selected.value.kind==='card')&&sourceWritable(selected.value.source,'updateDescription'))))
const selectedNativeEditingSupported=computed(()=>Boolean(selected.value&&(canMutateNative||selected.value.kind==='note'&&(nativeOperationAvailable('updateNote')||nativeOperationAvailable('setNoteTags'))||selected.value.kind==='event'&&(nativeOperationAvailable('updateEvent')||nativeOperationAvailable('respondToEvent'))||['task','card'].includes(selected.value.kind)&&(nativeOperationAvailable('updateRecordDates')||nativeOperationAvailable('updateDescription')))))
function canEditTimelineRecord(record:WorkspaceRecord){return !record.readonly&&sourceWritable(record.source,'updateRecordDates')&&['task','card','event'].includes(record.kind)}
async function editTimelineDates(edit:TimelineDateEdit){
  const record=state.value?.records.find(item=>item.id===edit.id)
  if(!record||!canEditTimelineRecord(record))return
  const patch:Partial<WorkspaceRecord>={}
  for(const key of ['start','due','end'] as const)if(key in edit)patch[key]=edit[key]||undefined
  if('allDay' in edit)patch.allDay=edit.allDay
  if(record.kind==='event'&&edit.start&&!('end' in edit)&&record.end===record.start)patch.end=edit.start
  await saveSourceEdit(record.id,patch,current=>api.updateRecordDates!({...edit,etag:current.etag}))
}
async function editTimelinePlan(edit:{id:string;start:string;end:string}){
  if(!state.value||metadataLocked.value||!Number.isFinite(+new Date(edit.start))||!Number.isFinite(+new Date(edit.end))||+new Date(edit.end)<=+new Date(edit.start))return
  const plan=state.value.workspace.plans.find(item=>item.id===edit.id);if(!plan)return
  Object.assign(plan,edit);persist();await saveQueue
  if(saveError.value)error.value=saveError.value;else notify('Work session moved')
}
function canLinkTimelineRecords(fromId:string,toId:string){const edge={fromId:toId,toId:fromId};return !metadataLocked.value&&(!deckDependencyPair(state.value?.records||[],edge)||!dependencyProblem(edge))}
async function linkTimelineWork(edge:{fromId:string;toId:string}){
  if(!state.value||!canLinkTimelineRecords(edge.fromId,edge.toId))return
  const from=state.value.records.find(item=>item.id===edge.fromId),to=state.value.records.find(item=>item.id===edge.toId)
  if(!from||!to||![from.kind,to.kind].every(kind=>kind==='task'||kind==='card'))return
  const check=canAddRelation(relations.value,to.id,from.id,'depends_on',state.value.records)
  if(!check.ok){error.value=check.message||'This connection is invalid.';return}
  if(deckDependencyPair(state.value.records,{fromId:to.id,toId:from.id})){
    await saveDeckDependency({fromId:to.id,toId:from.id});return
  }
  const id=crypto.randomUUID();state.value.workspace.relations.push({id,type:'depends_on',fromId:to.id,toId:from.id})
  persist();await saveQueue
  if(saveError.value)error.value=saveError.value
  else notify(`${to.title} now depends on ${from.title}`)
}
function canEditBoardChecklist(record:WorkspaceRecord){return record.kind==='card'&&!record.readonly&&sourceWritable(record.source,'updateDescription')&&Boolean(api.updateDescription)&&!(editingNote.value&&selectedId.value===record.id)}
async function editBoardChecklist(edit:{id:string;body:string}){
  const record=state.value?.records.find(item=>item.id===edit.id)
  if(!record||!canEditBoardChecklist(record))return
  await saveSourceEdit(record.id,{body:edit.body},current=>api.updateDescription!({id:record.id,description:edit.body,etag:current.etag}))
}
async function toggleDescriptionTask(body:string){
  const record=selected.value
  if(!record||!canEditContent.value||editingNote.value)return
  contentError.value=''
  const base={title:record.title,content:record.body||'',category:String(record.remote?.category||'')}
  await saveSourceEdit(record.id,{body},current=>record.kind==='note'?api.updateNote(buildNoteContentUpdate({id:record.id,title:base.title,content:body,etag:current.etag},base)):api.updateDescription!({id:record.id,description:body,etag:current.etag}))
}
function editContent(){if(selected.value?.kind==='event'){void openEventEditor();return}if(!selected.value||!canEditContent.value)return;++contentSaveGeneration;contentError.value='';noteDraft.value={id:selected.value.id,title:selected.value.title,content:selected.value.body||'',category:String(selected.value.remote?.category||''),etag:selected.value.etag};editingNote.value=true}
async function saveContent(){
  if(!selected.value||selected.value.id!==noteDraft.value.id)return
  if(!canEditContent.value){contentError.value='This note or description cannot be saved while the source is offline or read only. Your draft is kept here.';return}
  contentError.value=''
  const draft=copy(noteDraft.value),isNote=selected.value.kind==='note',baseline=noteBaseline.value
  const base=isNote?JSON.parse(baseline):undefined
  if(isNote&&!draft.title.trim())return
  if(!isNote&&draft.etag&&draft.etag!==selected.value.etag){contentError.value='This item changed while you were editing. Reopen the latest description before saving.';return}
  const generation=++contentSaveGeneration
  const expanded=modal.value==='note-editor'
  editingNote.value=false
  if(expanded)modal.value=null
  const okay=await saveSourceEdit(draft.id,{body:draft.content,...(isNote?{title:draft.title}:{})},current=>isNote?api.updateNote(buildNoteContentUpdate(draft,base)):api.updateDescription!({id:draft.id,description:draft.content,etag:current.etag}),true)
  if(!okay&&generation===contentSaveGeneration&&selectedId.value===draft.id&&!editingNote.value){noteDraft.value=draft;editingNote.value=true;noteBaseline.value=baseline;if(expanded)modal.value='note-editor';contentError.value=sourceFailures.value.find(item=>item.id===draft.id)?.message||'Could not save. Your draft is still here.'}
}
async function reviewNoteConflict(){if(!selected.value||selected.value.kind!=='note'||!api.readNote||noteConflictBusy.value)return;noteConflictBusy.value=true;noteConflictReturn=modal.value==='note-editor'?'note-editor':null;try{const current=await api.readNote({id:noteDraft.value.id});if(current.id!==noteDraft.value.id)return;noteConflict.value=current;modal.value='note-conflict'}catch(reason){contentError.value=msg(reason)}finally{noteConflictBusy.value=false}}
function backToNoteDraft(){modal.value=noteConflictReturn}
function useCurrentNote(){const current=noteConflict.value;if(!current||!state.value)return;discardSourceEdit(current.id);const record=state.value.records.find(item=>item.id===current.id),categoryTitle=current.category||'Uncategorized (default)',collection=state.value.collections.find(item=>item.source==='notes'&&item.title===categoryTitle);if(record)Object.assign(record,{title:current.title,body:current.content,etag:current.etag,readonly:current.readonly,...(collection?{collectionId:collection.id}:{}),collectionTitle:categoryTitle,remote:{...record.remote,category:current.category}});noteDraft.value={...current};noteBaseline.value=JSON.stringify(noteDraft.value);editingNote.value=false;contentError.value='';modal.value=null;void refresh(false)}
async function saveReviewedNote(){const current=noteConflict.value;if(!current||current.readonly)return;const previous=JSON.parse(noteBaseline.value),draft=copy(noteDraft.value);for(const field of ['title','content','category'] as const)if(draft[field]===previous[field])draft[field]=current[field];draft.etag=current.etag;noteDraft.value=draft;noteBaseline.value=JSON.stringify({...current});modal.value='note-editor';await saveContent()}
function editDates(){if(selected.value?.kind==='event'){void openEventEditor();return}if(!selected.value||!canEditTimelineRecord(selected.value))return;panelRecordId.value=selected.value.id;error.value='';modal.value='dates'}
const noteCategories=computed(()=>[...new Set((state.value?.records||[]).filter(record=>record.kind==='note').map(record=>String(record.remote?.category||'')).filter(Boolean))].sort())
const noteTagChoices=computed(()=>knownWorkspaceTags(state.value?.records||[],state.value?.collections||[],state.value?.workspace,[...noteTagOptions.value,...(selected.value?.tagDetails||[])]))
const noteSuggestions=computed(()=>{
  if(selected.value?.kind!=='note')return[]
  const parents=[...selectedLinks.value.incoming,...selectedLinks.value.outgoing].map(link=>link.record).filter((record):record is WorkspaceRecord=>Boolean(record&&['card','task','event'].includes(record.kind)))
  const tags=new Map<string,RecordTag>()
  for(const parent of parents){for(const tag of tagsFor(parent))tags.set(tag.title.toLocaleLowerCase(),{...tag,id:tag.title});const group=recordGroup(parent);const title=group?.category?.name||group?.project?.name||group?.space?.name;if(title&&!tags.has(title.toLocaleLowerCase()))tags.set(title.toLocaleLowerCase(),{id:title,title})}
  return [...tags.values()].filter(tag=>!tagsFor(selected.value!).some(existing=>existing.title.toLocaleLowerCase()===tag.title.toLocaleLowerCase())).slice(0,8)
})
async function adoptNativeResources(){if(!state.value)return;const before=copy(state.value);await adoptBackground(await api.getState(),before,mutationVersion)}
async function loadNoteTags(){
  const record=selected.value
  if(record?.kind!=='note'||!api.readNoteTags||!sourceAvailable('notes'))return
  const id=record.id,generation=inspectorGeneration,account=inspectorAccount.value
  const currentSelection=()=>!unmounted&&generation===inspectorGeneration&&account===inspectorAccount.value&&selectedId.value===id
  noteTagsLoading.value=true;noteTagsError.value=''
  try{
    const result=await api.readNoteTags({id})
    if(!currentSelection()||!sourceAvailable('notes'))return
    noteTagOptions.value=result.tags
    const current=recordsById.value.get(id)
    if(current&&!noteTagsDirty.value){
      const titles=result.tags.map(tag=>tag.title)
      if(JSON.stringify(current.tagDetails||[])!==JSON.stringify(result.tags))current.tagDetails=result.tags
      if(JSON.stringify(current.tags||[])!==JSON.stringify(titles))current.tags=titles
    }
  }catch(reason){if(currentSelection())noteTagsError.value=msg(reason)}
  finally{if(currentSelection())noteTagsLoading.value=false}
}
async function saveNoteTags(tags:RecordTag[]){const record=selected.value;if(record?.kind!=='note'||record.readonly||!api.setNoteTags||!sourceWritable('notes','setNoteTags'))return false;const known=tags.map(tag=>noteTagOptions.value.find(option=>option.id===tag.id||option.title.toLocaleLowerCase()===tag.title.toLocaleLowerCase()));noteTagsError.value='';const okay=await saveSourceEdit(record.id,{tags:tags.map(tag=>tag.title),tagDetails:tags},async()=>{const result=await api.setNoteTags!({id:record.id,tagIds:known.filter(Boolean).map(tag=>tag!.id),newTags:tags.filter((_,index)=>!known[index]).map(tag=>tag.title)});if(selectedId.value===record.id)noteTagOptions.value=result.tags;return api.getState()},true);if(!okay)noteTagsError.value=sourceFailures.value.find(item=>item.id===record.id)?.message||'Could not save note tags.';return okay}
async function createPickerNote(input:{title:string;content:string;category:string}){
  if(!state.value||noteLinkBusy.value||!sourceWritable('notes','createNote'))return
  noteLinkBusy.value=true;error.value=''
  const before=copy(state.value),version=mutationVersion
  try{const result=await api.createNote(input);await adoptBackground(result,before,version);const id=resolveRecordId(result.createdRecordId||'');const note=state.value?.records.find(item=>item.id===id);if(!note)throw new Error('The note was created in Nextcloud. Refresh the list before creating another.');createdPickerNote.value=note;notify('Note created. Select any other notes, then link them.')}
  catch(reason){error.value=msg(reason)}finally{noteLinkBusy.value=false}
}
async function addNotes(ids:string[],options?:{keepOpen:boolean}){
  const owner=panelRecord.value;if(!state.value||!owner||metadataLocked.value||noteLinkBusy.value)return
  noteLinkBusy.value=true;error.value='';const failures:string[]=[];let linked=0,customChanged=false
  try{
    for(const id of [...new Set(ids)]){const note=state.value.records.find(item=>item.id===id&&['note','page'].includes(item.kind));if(!note)continue
      if(relations.value.some(edge=>edge.type==='reference'&&edge.fromId===owner.id&&edge.toId===note.id))continue
      try{
        if(owner.kind==='card'&&note.kind==='note'){
          if(!canAttachDeck(owner)||!api.attachDeckFile)throw new Error('Connect Deck with write access to attach this note natively.')
          await api.attachDeckFile({id:owner.id,noteId:note.id});await adoptNativeResources()
          // A successful native attachment replaces an older planner-only copy.
          const remaining=state.value.workspace.relations.filter(edge=>!(edge.type==='reference'&&edge.fromId===owner.id&&edge.toId===note.id))
          if(remaining.length!==state.value.workspace.relations.length){state.value.workspace.relations=remaining;customChanged=true}
        }else{const check=canAddRelation(relations.value,owner.id,note.id,'reference',state.value.records);if(!check.ok)throw new Error(check.message);state.value.workspace.relations.push({id:crypto.randomUUID(),type:'reference',fromId:owner.id,toId:note.id});customChanged=true}
        linked++
      }catch(reason){failures.push(`${note.title}: ${msg(reason)}`)}
    }
    if(customChanged){persist();await saveQueue;if(saveError.value)failures.push(saveError.value)}
    if(failures.length)error.value=`${linked?`${linked} linked. `:''}${failures.join(' ')}`
    else{if(!options?.keepOpen){componentDraftDirty.value=false;modal.value=null}notify(`${linked} ${linked===1?'note':'notes'} linked`)}
    await nativeResources.value?.reload()
  }finally{noteLinkBusy.value=false}
}
async function syncNativeNoteLinks(){
  if(!state.value||!api.migrateDeckNoteLinks||nativeNotesSyncing.value||!sourceWritable('deck','migrateDeckNoteLinks')||!sourceWritable('notes','migrateDeckNoteLinks')||state.value.connection.recoveryOnly)return
  const hasPending=state.value.workspace.relations.some(edge=>{
    if(edge.type!=='reference'&&edge.type!=='related')return false
    const from=recordsById.value.get(edge.fromId),to=recordsById.value.get(edge.toId)
    return from?.kind==='card'&&to?.kind==='note'||from?.kind==='note'&&to?.kind==='card'
  })
  if(!hasPending){nativeNotesSyncError.value='';return}
  nativeNotesSyncing.value=true;nativeNotesSyncError.value=''
  try{
    await saveQueue;if(saveError.value)return
    for(let batch=0;batch<1000&&state.value&&sourceWritable('deck','migrateDeckNoteLinks');batch++){
      const before=copy(state.value),result=await api.migrateDeckNoteLinks({limit:1})
      await adoptBackground(result.state,before,mutationVersion)
      if(result.errors.length){nativeNotesSyncError.value=result.errors.map(issue=>issue.message).join(' ');error.value=`Some notes could not be attached in Deck: ${nativeNotesSyncError.value}`;break}
      if(!result.remaining||!result.converted)break
      await new Promise(resolve=>setTimeout(resolve,0))
    }
    if(state.value?.storage.syncStatus==='pending')scheduleCloudSync()
  }catch(reason){nativeNotesSyncError.value=msg(reason);error.value=`Could not sync note attachments: ${msg(reason)}`}
  finally{nativeNotesSyncing.value=false}
}
async function saveDates(dates:Omit<TimelineDateEdit,'id'>){
  const record=panelRecord.value
  if(!record||!canEditTimelineRecord(record))return
  if(sourceFailures.value.some(item=>item.id===record.id)){error.value='This item has a failed edit. Use Retry edit or explicitly discard that edit before saving new dates.';return}
  modal.value=null
  await editTimelineDates({id:record.id,...dates})
}
function openPlan(id?:string){if(!selected.value)return;const existing=state.value?.workspace.plans.find(p=>p.id===id);const start=new Date();start.setMinutes(0,0,0);start.setHours(start.getHours()+1);planDraft.value={id:existing?.id||'',recordId:selected.value.id,start:inputDateTime(existing?.start||start.toISOString()),end:inputDateTime(existing?.end||new Date(+start+3600000).toISOString())};modal.value='plan'}
async function savePlan(){if(!state.value||metadataLocked.value)return;const d=planDraft.value,start=new Date(d.start),end=new Date(d.end);if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start){error.value='Choose a work session that ends after it starts.';return}const value={id:d.id||crypto.randomUUID(),recordId:d.recordId,start:start.toISOString(),end:end.toISOString()};const index=state.value.workspace.plans.findIndex(p=>p.id===d.id);if(index>=0)state.value.workspace.plans[index]=value;else state.value.workspace.plans.push(value);persist();modal.value=null;await saveQueue;if(!saveError.value)notify('Work session saved. The original deadline is unchanged.')}
function removePlan(id:string){if(state.value&&!metadataLocked.value){state.value.workspace.plans=state.value.workspace.plans.filter(p=>p.id!==id);persist()}}
async function addRelation(input:{fromId:string;toId:string;type:RelationType;role?:'preparation'|'during'|'follow_up'}){
  if(!state.value||!panelRecord.value||metadataLocked.value)return
  if(input.fromId!==panelRecord.value.id&&input.toId!==panelRecord.value.id)return
  if(input.type==='depends_on'&&!dependencyCandidates(state.value.workspace,state.value.records,settings.value.scopeId).some(record=>record.id===(input.fromId===panelRecord.value!.id?input.toId:input.fromId))){error.value='Choose work from this Space’s sources.';return}
  const pair=[input.fromId,input.toId].map(id=>state.value!.records.find(record=>record.id===id)),card=pair.find(record=>record?.kind==='card'),note=pair.find(record=>record?.kind==='note')
  if(card&&note&&['reference','related'].includes(input.type)){
    if(!canAttachDeck(card)||!api.attachDeckFile){error.value='Connect Deck with write access to attach the note.';return}
    noteLinkBusy.value=true
    try{await api.attachDeckFile({id:card.id,noteId:note.id});await adoptNativeResources();state.value.workspace.relations=state.value.workspace.relations.filter(edge=>!(edge.id&&['reference','related'].includes(edge.type)&&pair.some(record=>record?.id===edge.fromId)&&pair.some(record=>record?.id===edge.toId)));persist();componentDraftDirty.value=false;modal.value=null;notify('Note attached in Deck')}
    catch(reason){error.value=msg(reason)}finally{noteLinkBusy.value=false}
    return
  }
  const check=canAddRelation(relations.value,input.fromId,input.toId,input.type,state.value.records)
  if(!check.ok){error.value=check.message||'This connection is invalid.';return}
  if(deckDependencyPair(state.value.records,input)){
    if(input.type!=='depends_on'){error.value='Use Add dependency to connect two Deck cards.';return}
    if(dependencyProblem(input)){error.value=dependencyProblem(input);return}
    if(sourceFailures.value.some(item=>item.id===input.fromId)){error.value='This card has a failed edit. Retry or discard it before adding a dependency.';return}
    modal.value=null;await saveDeckDependency(input);return
  }
  state.value.workspace.relations.push({id:crypto.randomUUID(),...input})
  persist();modal.value=null;await saveQueue
  if(!saveError.value)notify(input.type==='depends_on'?'Dependency linked':input.type==='reference'?'Note linked':'Connection saved')
}
function dependencyKey(edge:{fromId:string;toId:string}){return JSON.stringify([edge.fromId,edge.toId])}
function dependencyProblem(edge:{fromId:string;toId:string}){return deckDependencyProblem(state.value?.records||[],edge,sourceWritable('deck','setDeckDependency'))}
function isDeckDependency(edge:Relation){return edge.type==='depends_on'&&Boolean(deckDependencyPair(state.value?.records||[],edge))}
function dependencyFailure(edge:Relation){return relationRemovalErrors.value[edge.id]||(isDeckDependency(edge)?sourceFailures.value.find(item=>item.id===edge.fromId&&item.fields.includes('nativeDependencies'))?.message:'')||''}
function retryDependency(edge:Relation){if(isDeckDependency(edge))void retrySourceEdit(edge.fromId);else void removeRelation(edge)}
function canRemoveDependency(edge:Relation){return !metadataLocked.value&&!Object.hasOwn(nativeDependencyPending.value,dependencyKey(edge))&&(isDeckDependency(edge)?!dependencyProblem(edge)&&!dependencyFailure(edge):!edge.native)}
async function saveDeckDependency(edge:{fromId:string;toId:string},remove=false,quiet=false){
  if(!state.value||metadataLocked.value)return false
  const problem=dependencyProblem(edge),pair=deckDependencyPair(state.value.records,edge)
  if(problem||!pair){error.value=problem;return false}
  if(sourceFailures.value.some(item=>item.id===edge.fromId)){error.value='This card has a failed edit. Use Retry edit or discard that edit before changing dependencies.';return false}
  const key=dependencyKey(edge)
  const ids=pair.from.nativeDependencies??pair.from.nativeDependents??pair.from.nativeRelatedIds??[]
  const patch={nativeDependencies:remove?ids.filter(id=>id!==edge.toId):[...new Set([...ids,edge.toId])],nativeDependents:[],nativeRelatedIds:[]}
  nativeDependencyPending.value={...nativeDependencyPending.value,[key]:remove}
  const okay=await saveSourceEdit(edge.fromId,patch,async()=>{
    nativeDependencyPending.value={...nativeDependencyPending.value,[key]:remove}
    try{
      const result=await api.setDeckDependency!({fromId:edge.fromId,toId:edge.toId,remove})
      const updated=result.records.find(item=>item.id===edge.fromId)
      if(!updated||Boolean(updated.nativeDependencies?.includes(edge.toId))===remove)throw new Error('Deck did not confirm this dependency change. Retry to check the server.')
      // A local legacy edge is discarded only after native readback succeeds.
      // This callback also runs on Retry edit after a lost response.
      if(state.value){
        const retained=state.value.workspace.relations.filter(item=>!(item.type==='depends_on'&&item.fromId===edge.fromId&&item.toId===edge.toId))
        if(retained.length!==state.value.workspace.relations.length){state.value.workspace.relations=retained;persist()}
      }
      return result
    }finally{const next={...nativeDependencyPending.value};delete next[key];nativeDependencyPending.value=next}
  })
  if(okay&&!quiet)notify(remove?'Dependency removed from Deck':'Dependency saved in Deck')
  return okay
}
async function migrateDeckDependencies(){
  if(!state.value||!sourceWritable('deck','setDeckDependency')||!api.setDeckDependency||saveError.value)return
  const candidates=pendingDeckDependencies(state.value.workspace,state.value.records)
  for(const edge of candidates){
    if(!state.value||!sourceWritable('deck','setDeckDependency'))break
    const key=JSON.stringify([state.value.connection.serverUrl,state.value.connection.username,edge.id])
    if(attemptedDependencyMigrations.has(key)||dependencyProblem(edge)||sourceFailures.value.some(item=>item.id===edge.fromId))continue
    // Reject a legacy edge that now conflicts with a native dependency cycle.
    const otherEdges=relations.value.filter(item=>!(item.type==='depends_on'&&item.fromId===edge.fromId&&item.toId===edge.toId))
    const check=canAddRelation(otherEdges,edge.fromId,edge.toId,'depends_on',state.value.records)
    if(!check.ok){error.value=`A saved card dependency needs review: ${check.message}`;continue}
    attemptedDependencyMigrations.add(key)
    await saveDeckDependency(edge,false,true)
  }
}
async function removeRelation(relation:Relation){
  if(!state.value||metadataLocked.value)return
  if(relationRemovalErrors.value[relation.id])error.value=''
  const errors={...relationRemovalErrors.value};delete errors[relation.id];relationRemovalErrors.value=errors
  if(isDeckDependency(relation)){await saveDeckDependency(relation,true);return}
  if(relation.native&&relation.type==='reference'&&api.readDeckAttachments&&api.removeDeckAttachment){
    const card=state.value.records.find(record=>record.id===relation.fromId&&record.kind==='card'),note=state.value.records.find(record=>record.id===relation.toId&&record.kind==='note')
    if(!card||!note?.fileId||!canAttachDeck(card,'removeDeckAttachment')||!nativeOperationAvailable('readDeckAttachments'))return
    resourceBusy.value=true
    try{const {attachments}=await api.readDeckAttachments({id:card.id});for(const attachment of attachments.filter(item=>item.fileId===note.fileId))await api.removeDeckAttachment({id:card.id,attachmentId:attachment.id});await adoptNativeResources();state.value.workspace.relations=state.value.workspace.relations.filter(edge=>!(edge.type==='reference'&&edge.fromId===card.id&&edge.toId===note.id));persist();await nativeResources.value?.reload()}
    catch(reason){error.value=msg(reason)}finally{resourceBusy.value=false}
    return
  }
  if(!relation.native){
    const original=state.value.workspace.relations.find(edge=>edge.id===relation.id),account=inspectorAccount.value
    state.value.workspace.relations=state.value.workspace.relations.filter(r=>r.id!==relation.id);persist();await saveQueue
    if(saveError.value&&original&&state.value&&account===inspectorAccount.value&&!state.value.workspace.relations.some(edge=>edge.id===original.id)){
      // A rejected metadata removal is still a saved link. Restore it in the
      // inspector; other local edits and their recovery baseline stay intact.
      state.value.workspace.relations.push(original)
      relationRemovalErrors.value={...relationRemovalErrors.value,[original.id]:saveError.value}
      error.value='The link could not be removed. '+saveError.value
    }
  }
}
function relationLabel(relation:Relation,incoming=false){return ({depends_on:incoming?'Needed by':'Depends on',for_event:incoming?'Work for this event':'For event',scheduled_during:incoming?'Work scheduled here':'Scheduled during',reference:incoming?'Used by':'Reference',related:'Related'})[relation.type]}
function setAppearance(mode:Workspace['appearance']['mode']){if(state.value&&!metadataLocked.value){state.value.workspace.appearance.mode=mode;persist()}}
function setColor(id:string,value:string){if(!state.value||metadataLocked.value)return;if(value)state.value.workspace.appearance.calendarColors[id]=value;else delete state.value.workspace.appearance.calendarColors[id];persist()}
async function prepareAccountChange(preserveDraft=false){if(busy.value||syncing.value||refreshing.value||capturing.value||loginWaiting.value||!await flushAppearance())return false;busy.value=true;try{await sourceEdits.idle();await saveQueue;if(saveError.value){error.value='Save your planner changes with Retry save before changing accounts. Export JSON can preserve your draft.';return false}if(sourceFailures.value.length){error.value='Resolve failed edits with Retry edit or explicitly discard them before disconnecting or changing accounts.';return false}if(preserveDraft&&inspectorDirty.value){error.value='Save your open edit before changing the connection.';return false}if(!allowDiscard(inspectorDirty.value))return false;editingNote.value=false;return true}finally{busy.value=false}}
async function beginLogin(sameAccount=false){
  const currentAccount=inspectorAccount.value
  const serverUrl=sameAccount?state.value?.connection.serverUrl:login.value.serverUrl
  if(!serverUrl||sameAccount&&!authEntry.value.canSwitchDirect||!await prepareAccountChange(sameAccount))return
  if(sameAccount&&(currentAccount!==inspectorAccount.value||!authEntry.value.canSwitchDirect))return
  busy.value=true;error.value='';const generation=++loginGeneration
  try{
    const flow=await (sameAccount?api.beginLogin(serverUrl,{sameAccount:true}):api.beginLogin(serverUrl))
    if(generation!==loginGeneration){await api.cancelLogin(flow.flowId);return}
    loginFlow.value=flow;loginWaiting.value=true;pollTimer=setTimeout(pollLogin,1800)
  }catch(err){error.value=msg(err)}finally{busy.value=false}
}
async function pollLogin(){if(!loginFlow.value)return;const generation=loginGeneration,flow=loginFlow.value;try{const result=await api.pollLogin(flow.flowId);if(generation!==loginGeneration)return;if(result.pending){pollTimer=setTimeout(pollLogin,2000);return}applyState(result.state);loginWaiting.value=false;loginFlow.value=null;if(!isConnectionAuthorized(result.state.connection)){error.value=result.state.connection.restoreError||'Sign-in was not completed. Choose a sign-in option to reconnect.';return}clearSourceFailures();notify('Connected to Nextcloud');modal.value=null;if(!managedSync)void refresh(false);await migrateDeckDependencies();void syncNativeNoteLinks()}catch(err){if(generation===loginGeneration){error.value=msg(err);loginWaiting.value=false;loginFlow.value=null}}}
async function cancelLogin(){const flow=loginFlow.value;++loginGeneration;clearTimeout(pollTimer);loginWaiting.value=false;loginFlow.value=null;if(flow)try{await sourceEdits.idle();applyState(await api.cancelLogin(flow.flowId))}catch(err){error.value=msg(err)}}
async function connectManual(){if(!await prepareAccountChange())return;const credentials={...login.value};if(await run(()=>api.connect(credentials),'Connected to Nextcloud')){clearSourceFailures();login.value.appPassword='';modal.value=null;await migrateDeckDependencies();void syncNativeNoteLinks()}}
async function selectHostAccount(){if(!props.selectAccount||!await prepareAccountChange())return;if(await run(props.selectAccount)){if(!isConnectionAuthorized(state.value?.connection)){error.value=state.value?.connection.restoreError||'Sign-in was not completed. Choose a sign-in option to reconnect.';return}clearSourceFailures();notify('Connected to Nextcloud');modal.value=null;if(!managedSync)void refresh(false)}}
function openReconnect(){if(modal.value&&modal.value!=='settings')return;if(state.value?.connection.serverUrl)login.value.serverUrl=state.value.connection.serverUrl;modal.value='settings';sidebarOpen.value=false}
async function retryConnection(){if(api.retryConnection&&await run(()=>api.retryConnection!())&&connected.value&&!managedSync)await refresh()}
async function disconnect(){if(!await prepareAccountChange())return;await cancelLogin();if(await run(()=>api.disconnect(),'Disconnected. Your planner metadata is preserved.'))clearSourceFailures()}
function closeModal(){if(!loginWaiting.value&&!busy.value&&!capturing.value&&!matchingSaving.value&&!noteLinkBusy.value&&!resourceBusy.value&&!noteConflictBusy.value&&allowDiscard(Boolean(modalDirty.value))){modal.value=null;leaveWidgetContext()}}
watch(modal,value=>{if(value){closePageOptions();closeGlobalActions();closeNavActions()}componentDraftDirty.value=false;modalBaseline.value=JSON.stringify(value==='scope'?scopeDraft.value:value==='plan'?planDraft.value:null);settingsGeneration++;settingsAfterPaint.cancel();settingsContentReady.value=false;calendarColorsOpen.value=false;if(value==='settings')settingsAfterPaint.run(()=>{if(modal.value==='settings'){settingsContentReady.value=true;scrollSettings()}});else settingsFocus.value=null},{flush:'sync'})
watch(editingNote,value=>{if(value){const record=state.value?.records.find(item=>item.id===noteDraft.value.id);noteBaseline.value=JSON.stringify(record?{id:record.id,title:record.title,content:record.body||'',category:String(record.remote?.category||''),etag:record.etag}:noteDraft.value)}},{flush:'sync'})
watch(inspectorAccount,()=>{relationRemovalErrors.value={}})
watch([selectedId,inspectorAccount,()=>Boolean(selected.value)],()=>{
  const generation=++inspectorGeneration
  ++pageGeneration;inspectorAfterPaint.cancel();inspectorContentReady.value=false;inspectorOrganizationOpen.value=false
  noteTagOptions.value=[];noteTagsLoading.value=false;noteTagsError.value='';pageError.value='';pageBody.value='';pageBusy.value=false
  if(!selected.value)return
  inspectorAfterPaint.run(()=>{
    if(unmounted||generation!==inspectorGeneration||!selected.value)return
    inspectorContentReady.value=true
    void loadNoteTags();void loadPageContent()
  })
},{flush:'sync'})
onBeforeUnmount(()=>{inspectorGeneration++;inspectorAfterPaint.dispose();settingsAfterPaint.dispose()})
function keyboard(event:KeyboardEvent){if(props.sessionHost&&(!event.target||!plannerRoot.value?.contains(event.target as Node)))return;if(event.key==='Escape'){if(pageSelectorOpen.value){event.preventDefault();pageSelector.value?.close(true);return}if(globalActionsOpen.value){event.preventDefault();closeGlobalActions(true);return}if(navActions.value){event.preventDefault();closeNavActions(true);return}if(pageOptionsOpen.value){event.preventDefault();closePageOptions(true);return}if(modal.value)closeModal();else if(filterOpen.value)filterOpen.value=false;else if(selectedId.value)closeInspector();else sidebarOpen.value=false}if(modal.value&&event.key==='Tab'){const dialog=document.querySelector<HTMLElement>('.modal');const focusable=Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]')||[]).filter(el=>el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&(document.activeElement===first||!dialog?.contains(document.activeElement))){event.preventDefault();last?.focus()}else if(!event.shiftKey&&(document.activeElement===last||!dialog?.contains(document.activeElement))){event.preventDefault();first?.focus()}}if(!modal.value&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();void focusSearch()}}
watch(modal,async(value,previous)=>{if(value&&!previous){const active=document.activeElement instanceof HTMLElement?document.activeElement:null;modalReturnFocus=window.matchMedia('(max-width:760px)').matches&&active?.closest('.global-action-items')?document.getElementById('global-actions-toggle'):active?.closest('.app-sidebar')?document.querySelector<HTMLElement>('[aria-label="Open navigation"]'):compactPageControls.value&&active?.closest('.page-controls')?document.getElementById('page-options-toggle'):active;}await nextTick();if(value){const dialog=document.querySelector<HTMLElement>('.modal');if(!dialog?.contains(document.activeElement))dialog?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled),select:not(:disabled)')?.focus()}else if(modalReturnFocus?.isConnected)modalReturnFocus.focus()})
async function loadPageContent(){
  const record=selected.value,generation=pageGeneration,account=inspectorAccount.value
  if(record?.kind!=='page')return
  const currentSelection=()=>!unmounted&&generation===pageGeneration&&account===inspectorAccount.value&&selected.value?.id===record.id
  pageBusy.value=true
  try{const result=await api.readPage({id:record.id});if(currentSelection())pageBody.value=result.body}
  catch(err){if(currentSelection())pageError.value=msg(err)}
  finally{if(currentSelection())pageBusy.value=false}
}
watch(selectedId,async(id,previous)=>{if(id===previous)return;await nextTick();const inspector=document.querySelector<HTMLElement>('.inspector-content');if(inspector)inspector.scrollTop=0})
watch([primary,dark,()=>state.value?.theme],([color,isDark,theme])=>{
  // The host may have applied this account's validated launch appearance before
  // mounting. Do not flash fallback colors while its local snapshot is loading.
  if(props.sessionHost||props.mobileHost&&!state.value)return
  const root=document.documentElement;root.dataset.theme=isDark?'dark':'light'
  root.dataset.highContrast=String(Boolean(theme?.highContrast))
  // Only validated color values and an authenticated raster asset cross the bridge.
  const palette=isDark?theme?.darkPalette:theme?.light
  const tokens:Record<string,string|undefined>={'--surface':palette?.surfaceColor,'--canvas':palette?.surfaceColor,'--sidebar':palette?.surfaceColor,'--text':palette?.textColor,'--heading':palette?.textColor,'--muted':palette?.mutedColor,'--subtle':palette?.mutedColor,'--hover':palette?.hoverColor,'--border':palette?.borderColor,'--border-strong':palette?.borderColor,'--primary-soft':palette?.primaryLightColor,'--primary-soft-text':palette?.primaryLightTextColor}
  for(const [name,value] of Object.entries(tokens)){const safe=safeColor(value);if(safe)root.style.setProperty(name,safe);else root.style.removeProperty(name)}
  const styles=getComputedStyle(root)
  const fallback=accessibleAccent(color,['--surface','--canvas','--sidebar','--hover'].map(name=>styles.getPropertyValue(name).trim()),isDark)
  root.style.setProperty('--primary',safeColor(palette?.primaryColor)||fallback.primary)
  root.style.setProperty('--on-primary',safeColor(palette?.primaryTextColor)||fallback.onPrimary)
  root.style.setProperty('--primary-hover',`color-mix(in srgb, var(--primary) 90%, ${isDark?'white':'black'})`)
  root.style.setProperty('--cloud-background',safeColor(theme?.backgroundColor)||color)
  root.style.setProperty('--cloud-foreground',safeColor(theme?.backgroundTextColor)||'#ffffff')
  const wallpaper=theme?.backgroundDataUrl
  const safeWallpaper=wallpaper&&wallpaper.length<2800000&&/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(wallpaper)
  root.style.setProperty('--cloud-wallpaper',safeWallpaper?`url("${wallpaper}")`:'none')
},{immediate:true})
watch([connected,()=>state.value?.revision],()=>{if(!syncing.value)scheduleCloudSync()})
watch([editingNote,inspectorDirty,modalDirty],async()=>{if(deferredBackgroundBase&&!editingNote.value&&!inspectorDirty.value&&!modalDirty.value&&!busy.value){const base=deferredBackgroundBase;try{await adoptBackground(await api.getState(),base,mutationVersion)}catch(reason){error.value=msg(reason)}}})
watch(()=>settings.value.view,view=>uiDiagnostics.measure('page',view),{flush:'sync'})
watch([selectedId,modal],()=>uiDiagnostics.measure('panel',modal.value==='settings'?'settings':settings.value.view),{flush:'sync'})
watch([sourceAuthorized,()=>deviceSync.value?.restoring,networkOnline],()=>{if(sourceAuthorized.value&&!deviceSync.value?.restoring&&networkOnline.value)refreshViewPreferences()})
watch([()=>calendarBrowse.value?.from,()=>calendarBrowse.value?.to,inspectorAccount],([from,to],_,cleanup)=>{
  calendarRangeError.value=''
  if(from===undefined||to===undefined||!api.readCalendarWindow)return
  let active=true
  const timer=setTimeout(async()=>{
    const before=state.value,version=mutationVersion
    if(!before||!api.readCalendarWindow)return
    try{const result=await api.readCalendarWindow({from,to});if(active)await adoptBackground(result,before,version)}
    catch(reason){if(active)calendarRangeError.value=msg(reason)}
  },200)
  cleanup(()=>{active=false;clearTimeout(timer)})
},{immediate:true})
watch([query,statusIds,listKind,attention,calendarMode,timelineFloatingEvents,boardGroupTasks,timelineListCollapsed],()=>{listLimit.value=120;rememberScopePreferences(true)})
const media=window.matchMedia('(prefers-color-scheme: dark)')
function systemChanged(event:MediaQueryListEvent){systemDark.value=event.matches}
function requestManagedSync(reason:'open'|'resume'|'timer'|'online'){
  if(!api.resumeSync||!state.value||unmounted)return
  void api.resumeSync(reason).catch(reason=>{if(!unmounted)error.value=msg(reason)})
}
function pollSources(){if(managedSync){requestManagedSync('timer');return}if(sourceRefreshReady.value){void automaticSync();void refresh(false)}}
function regainFocus(){const active=document.visibilityState==='visible';void api.setAppActive?.(active);if(!active)return;void receiveWidgetAction();refreshViewPreferences();if(managedSync){requestManagedSync('resume');return}if(lastSourcesRefreshedAt.value===null||Date.now()-lastSourcesRefreshedAt.value>30000)pollSources()}
let hostNetworkOnline:boolean|undefined
function connectivityChanged(){networkOnline.value=hostNetworkOnline??navigator.onLine;if(networkOnline.value){if(managedSync)requestManagedSync('online');else pollSources()}}
async function changeCalendarHistory(days:number|null){
  if(!api.setCalendarHistoryDays||!state.value||calendarHistoryBusy.value)return
  const before=state.value,version=mutationVersion
  calendarHistoryBusy.value=true;calendarHistoryError.value=''
  try{await adoptBackground(await api.setCalendarHistoryDays(days),before,version)}
  catch(reason){calendarHistoryError.value=msg(reason)}
  finally{calendarHistoryBusy.value=false}
}
async function saveSyncSettings(settings:DeviceSyncSettings){
  if(!api.setSyncSettings||!state.value||syncSettingsBusy.value)return
  syncSettingsBusy.value=true;syncSettingsError.value=''
  const before=copy(state.value),version=mutationVersion
  try{await adoptBackground(await api.setSyncSettings(settings),before,version)}
  catch(reason){syncSettingsError.value=msg(reason)}
  finally{syncSettingsBusy.value=false}
}
function hostConnectivityChanged(event:Event){hostNetworkOnline=(event as CustomEvent<{connected:boolean}>).detail.connected;connectivityChanged()}
function hostBack(event:Event){if(pageSelectorOpen.value){event.preventDefault();pageSelector.value?.close(true);return}if(globalActionsOpen.value||navActions.value||pageOptionsOpen.value||modal.value||filterOpen.value||selectedId.value||sidebarOpen.value){event.preventDefault();if(globalActionsOpen.value)closeGlobalActions(true);else if(navActions.value)closeNavActions(true);else if(pageOptionsOpen.value)closePageOptions(true);else if(loginWaiting.value)void cancelLogin();else if(modal.value)closeModal();else if(filterOpen.value)filterOpen.value=false;else if(selectedId.value)void closeInspector();else sidebarOpen.value=false}}
function hostStateChanged(result:State){
  hostPublicationVersion++
  if(!state.value||unmounted)return
  hostPublications.offer(result)
}
const hostPublications=createLatestPublication<State>({
  schedule:callback=>setTimeout(callback,0),cancelScheduled:id=>clearTimeout(id as ReturnType<typeof setTimeout>),
  canAdopt:()=>Boolean(state.value)&&!busy.value&&!loginWaiting.value&&!saving.value&&!sourceSaving.value&&!refreshing.value&&!syncing.value&&!publicationRefresh&&!unmounted,
  adopt:result=>{if(!state.value)return;return adoptBackground(result,lastHostState||copy(state.value),mutationVersion,false)},
  onError:reason=>{error.value=msg(reason)},
})
watch([busy,loginWaiting,saving,sourceSaving,refreshing,syncing],()=>hostPublications.resume())
const widgetNavigationBlocked=computed(()=>metadataLocked.value||modalDirty.value||inspectorDirty.value||resourceBusy.value||noteLinkBusy.value||matchingSaving.value||noteConflictBusy.value)
watch([captureKinds,modal,widgetNavigationBlocked],()=>{void openPendingWidgetCapture()})
watch(widgetNavigationBlocked,blocked=>{if(!blocked)void receiveWidgetAction()})
watch(inspectorAccount,account=>{
  if(widgetCapture.value&&widgetCapture.value.account!==account){leaveWidgetContext();if(modal.value==='capture')modal.value=null}
  if(deferredWidgetLaunch?.account!==account)deferredWidgetLaunch=undefined
})
onMounted(()=>window.addEventListener('nextspace:widget',receiveWidgetAction))
onBeforeUnmount(()=>window.removeEventListener('nextspace:widget',receiveWidgetAction))
onBeforeUnmount(()=>hostPublications.dispose())
onMounted(async()=>{document.addEventListener('pointerdown',dismissPageMenus);document.addEventListener('focusin',dismissPageMenus);window.addEventListener('beforeunload',pendingEditsBeforeClose);window.addEventListener('keydown',keyboard);window.addEventListener('focus',regainFocus);window.addEventListener('online',connectivityChanged);window.addEventListener('offline',connectivityChanged);window.addEventListener('nextspace:resume',regainFocus);window.addEventListener('nextspace:network',hostConnectivityChanged);window.addEventListener('nextspace:back',hostBack);document.addEventListener('visibilitychange',regainFocus);media.addEventListener('change',systemChanged);clockTimer=setInterval(()=>now.value=new Date(),60000);cloudPollTimer=setInterval(pollSources,60000);try{unsubscribeHost=props.subscribe?.(hostStateChanged);unsubscribeSync=api.subscribeSync?.(value=>{hostSync.value=value});applyState(await api.getState());if(state.value?.connection.serverUrl)login.value.serverUrl=state.value.connection.serverUrl;if(!props.sessionHost&&!deviceSync.value?.restoring&&connectionEntry({connection:state.value?.connection,mobileHost:props.mobileHost,initialStartup:true}).promptReconnect)openReconnect();await nextTick();if(managedSync)requestManagedSync('open');else void refresh(false)}catch(err){error.value=msg(err)}})
onBeforeUnmount(()=>{unmounted=true;preferenceSync?.close();clearTimeout(preferenceTimer);document.removeEventListener('pointerdown',dismissPageMenus);document.removeEventListener('focusin',dismissPageMenus);unsubscribeHost?.();unsubscribeSync?.();window.removeEventListener('beforeunload',pendingEditsBeforeClose);window.removeEventListener('keydown',keyboard);window.removeEventListener('focus',regainFocus);window.removeEventListener('online',connectivityChanged);window.removeEventListener('offline',connectivityChanged);window.removeEventListener('nextspace:resume',regainFocus);window.removeEventListener('nextspace:network',hostConnectivityChanged);window.removeEventListener('nextspace:back',hostBack);document.removeEventListener('visibilitychange',regainFocus);media.removeEventListener('change',systemChanged);clearInterval(clockTimer);clearInterval(cloudPollTimer);clearTimeout(syncTimer);clearTimeout(pollTimer);clearTimeout(toastTimer);++pageGeneration;++loginGeneration})
</script>

<template>
  <div ref="plannerRoot" class="planner-app" :data-session-host="props.sessionHost||undefined" :data-mobile-host="props.mobileHost||undefined" :style="{'--inspector-width':inspectorSize.width.value+'px'}" :class="{'compact-page-controls':compactPageControls,'narrow-desktop-controls':narrowDesktopControls,'inspector-open':selectedId,'inspector-resizing':inspectorSize.resizing.value,'sidebar-open':sidebarOpen,'overview-layout':settings.view==='overview'&&(connected||Boolean(state?.records.length))}">
    <div v-if="sidebarOpen" class="sidebar-scrim" @click="sidebarOpen=false"></div>
    <aside class="app-sidebar" :inert="!sidebarOpen" aria-label="Navigation">
      <div class="brand"><span class="brand-symbol"><NextGlanceIcon :size="22"/></span><div><strong>NextGlance</strong></div><button class="icon-button mobile-only" aria-label="Close navigation" @click="sidebarOpen=false"><X :size="18"/></button></div>
      <div class="nav-scope-row" :class="{active:settings.scopeId==='all'}"><button class="sidebar-main" :class="{active:settings.scopeId==='all'}" @click="setScope('all')"><Home :size="18"/><span>My overview</span><span class="nav-count">{{allCount}}</span></button><button class="icon-button nav-actions-toggle" aria-label="My overview actions" aria-haspopup="menu" :aria-expanded="navActions?.kind==='overview'" aria-controls="overview-actions" @click="toggleNavActions('overview','all',$event)"><MoreVertical :size="17"/></button></div>
      <div v-if="navActions?.kind==='overview'" id="overview-actions" class="nav-actions-panel" role="menu" aria-label="My overview actions" @keydown="navMenuKeyboard"><button role="menuitem" :disabled="metadataLocked" @click="openCategories('all')"><Layers :size="15"/>Group sources</button></div>
      <button v-for="category in model?.categories.filter(c=>c.spaceId==='all')" :key="category.id" class="project-nav category-nav" :class="{active:settings.scopeId===category.id}" :title="category.name" @click="setScope(category.id)"><span class="space-swatch" :style="{background:category.color}"></span><span>{{category.name}}</span><small>{{category.openCount}}</small></button>
      <div class="sidebar-section-title"><span>SPACES</span><button class="icon-button" aria-label="Create Space" :disabled="metadataLocked||!state" @click="openScope('space')"><Plus :size="15"/></button></div>
      <nav v-if="state" class="spaces-nav" aria-label="Spaces">
        <div v-for="space in model?.spaces" :key="space.id" class="space-nav-group">
          <div class="nav-scope-row" :class="{active:settings.scopeId===space.id}">
            <button class="space-nav" :class="{active:settings.scopeId===space.id}" :title="space.name" @click="setScope(space.id)"><span class="space-swatch" :style="{background:space.color}"></span><span>{{space.name}}</span><small>{{space.openCount}}</small></button>
            <button class="icon-button nav-actions-toggle" :aria-label="`Space actions for ${space.name}`" :title="`Space actions for ${space.name}`" aria-haspopup="menu" :aria-expanded="navActions?.kind==='space'&&navActions.id===space.id" :aria-controls="`space-actions-${space.id}`" @click="toggleNavActions('space',space.id,$event)"><MoreVertical :size="17"/></button>
          </div>
          <div v-if="navActions?.kind==='space'&&navActions.id===space.id" :id="`space-actions-${space.id}`" class="nav-actions-panel" role="menu" :aria-label="`${space.name} actions`" @keydown="navMenuKeyboard">
            <button role="menuitem" :disabled="metadataLocked" @click="openCategories(space.id)"><Layers :size="15"/>Group sources</button>
            <button role="menuitem" :disabled="metadataLocked" @click="openScope('space',space.id)"><Settings2 :size="15"/><span>Manage Space<small>Source assignments & defaults</small></span></button>
            <button role="menuitem" :disabled="metadataLocked" @click="openScope('project',undefined,space.id)"><Plus :size="15"/>Add project</button>
            <button role="menuitem" :disabled="metadataLocked||Boolean(saving)" @click="requestDeleteSpace(space.id)"><Trash2 :size="15"/>Delete Space</button>
          </div>
          <button v-for="category in model?.categories.filter(c=>c.spaceId===space.id)" :key="category.id" class="project-nav category-nav" :class="{active:settings.scopeId===category.id}" :title="category.name" @click="setScope(category.id)"><span class="space-swatch" :style="{background:category.color}"></span><span>{{category.name}}</span><small>{{category.openCount}}</small></button>
          <template v-for="project in model?.projects.filter(p=>p.spaceId===space.id&&!p.archived)" :key="project.id">
            <div class="nav-scope-row project-scope-row" :class="{active:settings.scopeId===project.id}">
              <button class="project-nav" :class="{active:settings.scopeId===project.id}" :title="project.name" @click="setScope(project.id)"><Folder :size="13"/><span>{{project.name}}</span><small>{{project.openCount}}</small></button>
              <button class="icon-button nav-actions-toggle" :aria-label="`Project actions for ${project.name}`" :title="`Project actions for ${project.name}`" aria-haspopup="menu" :aria-expanded="navActions?.kind==='project'&&navActions.id===project.id" :aria-controls="`project-actions-${project.id}`" @click="toggleNavActions('project',project.id,$event)"><MoreVertical :size="15"/></button>
            </div>
            <div v-if="navActions?.kind==='project'&&navActions.id===project.id" :id="`project-actions-${project.id}`" class="nav-actions-panel" role="menu" :aria-label="`${project.name} actions`" @keydown="navMenuKeyboard"><button role="menuitem" :disabled="metadataLocked" @click="openScope('project',project.id)"><Settings2 :size="15"/>Manage project</button></div>
          </template>
        </div>
        <div v-if="!state.workspace.spaces.length" class="sidebar-empty"><p>Bring your calendars, boards and task lists together.</p><button class="text-button" @click="openScope('space')"><Plus :size="13"/>Create your first Space</button></div>
      </nav>
      <div class="sidebar-bottom"><div class="source-summary"><span class="connection-dot" :class="{online:connected&&networkOnline}"></span><div><strong>{{connectionLabel}}</strong><small>{{connected?`${connectedSources} sources available`:state?.connection.username||'Your data stays on your server'}}</small></div></div><button class="sidebar-settings" @click="modal='settings';sidebarOpen=false"><Settings2 :size="17"/><span>Settings & connection</span><span v-if="sourceIssues.length" class="issue-count">{{sourceIssues.length}}</span></button><div class="sidebar-save"><span :class="{'save-warning':saveError}">{{saving?'Saving…':saveError?'Changes not saved':cloudStatus}}</span><span>{{props.appVersion?`v${props.appVersion}`:'Development'}}</span></div></div>
    </aside>
    <main ref="appMain" class="app-main">
      <header class="app-topbar">
        <button class="icon-button mobile-only" aria-label="Open navigation" @click="sidebarOpen=true"><Menu :size="20"/></button>
        <span v-if="!props.sessionHost" class="topbar-brand" title="NextGlance"><NextGlanceIcon :size="28"/><strong>NextGlance</strong></span>
        <h1 v-if="model" class="topbar-scope" :title="model.scope.name"><span v-if="model.scope.color" class="heading-color" :style="{background:model.scope.color}"></span><span>{{model.scope.name}}</span></h1>
        <div v-if="state&&model" class="header-view-controls">
          <div class="view-tabs" role="tablist" aria-label="Planner views"><button v-for="view in viewOptions" :key="view.id" :class="{active:settings.view===view.id}" role="tab" :aria-selected="settings.view===view.id" @click="setView(view.id)"><component :is="view.icon" :size="16"/><span>{{view.label}}</span></button></div>
          <PageSelector ref="pageSelector" class="view-switcher" :model-value="settings.view" :options="viewOptions" :scope-name="model.scope.name" @update:model-value="setView" @open-change="pageSelectorOpen=$event"/>
        </div>
        <div class="topbar-actions">
          <span v-if="sourceSaving" class="source-save-status visually-hidden" role="status">Saving to Nextcloud…</span>
          <div class="global-actions-group">
            <button id="global-actions-toggle" class="icon-button global-actions-toggle" :aria-label="syncActive?'Global actions · syncing':'Global actions'" title="Global actions" :aria-expanded="globalActionsOpen" aria-controls="global-action-items" @click="toggleGlobalActions"><RefreshCw v-if="syncActive" :size="18" class="spinning"/><MoreVertical v-else :size="18"/></button>
            <div id="global-action-items" class="global-action-items" :class="{open:globalActionsOpen}" role="group" aria-label="Global actions">
              <button class="icon-button find-event-matches" :disabled="metadataLocked||!state?.records.length" aria-label="Find matching events" title="Find matching events across all loaded sources" @click="openEventMatches"><CalendarSearch :size="19"/><span class="global-action-label">Find matching events</span></button>
              <button class="icon-button refresh-sources-button" :disabled="busy||sourceRefreshing||deviceSync?.restoring||!sourceRefreshReady" aria-label="Refresh Nextcloud sources" :title="syncActive?'Syncing in the background':'Refresh Nextcloud sources'" @click="closeGlobalActions(true);refresh()"><RefreshCw :size="17" class="sync-activity-icon" :class="{spinning:syncActive}"/><span class="global-action-label">Refresh sources</span></button>
              <button v-if="canMutateNative||captureSupported" class="button primary capture-button" :disabled="!canCapture" @click="openCapture()"><Plus :size="16"/>New item</button>
            </div>
          </div>
          <button class="icon-button sync-button" :data-sync-state="syncState" :aria-label="'Sync status: '+(connectionNotice?.message||cloudStatus)+'. Open details'" :title="syncTooltip" @click="openSyncDetails"><span class="cloud-sync-mark"><component :is="syncState==='offline'?CloudOff:syncState==='error'?CloudAlert:['pending','syncing'].includes(syncState)?CloudUpload:Cloud" :size="19"/><Check v-if="syncState==='synced'" :size="11" class="cloud-check"/><Clock3 v-if="syncState==='stale'" :size="11" class="cloud-stale"/></span></button>
        </div>
      </header>
      <div v-if="error" class="notice error-notice" role="alert"><AlertCircle :size="17"/><span>{{error}}</span><button class="icon-button" aria-label="Dismiss error" @click="error='' "><X :size="15"/></button></div>
      <div v-for="failure in sourceFailures" :key="failure.id" class="notice error-notice source-edit-error" role="alert"><AlertCircle :size="17"/><span><strong>{{failure.title}}</strong> could not save. {{failure.message}} The last saved version is shown; your edit is available to retry.</span><button class="button small" :disabled="busy" @click="retrySourceEdit(failure.id)">Retry edit</button><button class="icon-button" :aria-label="`Discard failed edit for ${failure.title}`" @click="discardSourceEdit(failure.id)"><X :size="15"/></button></div>
      <div v-if="saveError" class="notice error-notice" role="alert"><AlertCircle :size="17"/><span>Your latest planner changes are not saved. {{saveError}}</span><button class="button small" :disabled="saving>0" @click="persist">Retry save</button></div>
      <SyncNotice v-if="connectionNotice&&connectionNoticePresentation==='banner'" :notice="connectionNotice" :action-disabled="noticeActionDisabled" @action="noticeAction" @details="openSyncDetails"/>
      <template v-if="state&&model">
        <div class="filter-bar" :class="{'dated-toolbar':timelineView||settings.view==='calendar','undated-toolbar':!timelineView&&settings.view!=='calendar'}">
          <div id="inline-page-search" class="inline-page-search"></div>
          <div id="planner-page-options" class="page-controls" :class="{open:pageOptionsOpen}" role="region" aria-label="Page options">
          <div class="page-options-heading"><strong>Page options</strong><button class="icon-button" aria-label="Close page options" @click="closePageOptions(true)"><X :size="18"/></button></div>
          <Teleport to="#inline-page-search" :disabled="!narrowDesktopControls" defer><div class="search-control" :class="{expanded:searchExpanded||query}"><button class="icon-button search-toggle" :class="{active:query}" aria-label="Search this view" title="Search this view" :aria-expanded="searchExpanded||Boolean(query)" aria-controls="planner-search" @click="focusSearch"><Search :size="18"/></button><label class="planner-search"><Search :size="16"/><input id="planner-search" v-model="query" placeholder="Find in this view…" aria-label="Search this view" @blur="closeSearch" @keydown.esc.stop="pageOptionsOpen?closePageOptions(true):(query='',searchExpanded=false)"/><button v-if="query" class="icon-button" aria-label="Clear search" @click="query='';focusSearch()"><X :size="13"/></button><button v-else class="icon-button search-close" aria-label="Close search" @click="searchExpanded=false"><X :size="14"/></button></label></div></Teleport>
          <div class="page-actions">
          <span class="active-filter-caption">{{assignment==='me'?'My Deck cards':'All Deck cards'}}</span>
          <button class="filter-button" :class="{active:filterOpen||filtersActive}" aria-label="Filters" title="Filters" :aria-expanded="filterOpen" @click="filterOpen=!filterOpen"><SlidersHorizontal :size="15"/>Filters<span v-if="filtersActive" class="filter-active-dot" aria-label="Filters active"></span><ChevronDown :size="12"/></button>
          <div v-if="settings.view==='board'" id="board-page-controls" class="board-controls-host"></div>
          <details v-if="settings.view==='timeline'" class="timeline-page-settings" :open="compactPageControls"><summary>Timeline display</summary><div class="timeline-settings-content"><label v-if="!compactViewport" class="check-label"><input v-model="timelineFloatingEvents" type="checkbox"/>Float visible events</label><template v-if="compactPageControls"><label class="check-label"><input v-model="allCalendarBands" type="checkbox"/>All calendar bands</label><button class="text-button" @click="closePageOptions();standaloneTimeline?.openEvents()"><CalendarDays :size="15"/>Calendar events</button><TimelineLegend/></template></div></details>
          <label v-if="settings.view==='calendar'" class="calendar-period-select"><span class="page-control-label">Calendar view</span><select :value="calendarMode" aria-label="Calendar view" @change="setCalendarMode(($event.target as HTMLSelectElement).value)"><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
          <div v-if="settings.view==='calendar'&&calendarMode==='month'" class="calendar-density-controls" role="group" aria-label="Month calendar density"><button class="icon-button" aria-label="Smaller month cells" title="Smaller month cells" @click="monthCalendar?.changeDensity(.85)"><Minus :size="15"/></button><button class="icon-button" aria-label="Reset month density" title="Reset month density" @click="monthCalendar?.resetDensity()"><RotateCcw :size="14"/></button><button class="icon-button" aria-label="Larger month cells" title="Larger month cells" @click="monthCalendar?.changeDensity(1.15)"><Plus :size="15"/></button></div>
          <label v-if="timelineView" class="timeline-zoom"><span class="page-control-label">Timeline range</span><select v-model="timelineDays" aria-label="Timeline range"><option v-if="![1,3,7,14,28,56,90].includes(timelineDays)" :value="timelineDays">{{timelineDays}} days</option><option :value="1">1 day</option><option :value="3">3 days</option><option :value="7">1 week</option><option :value="14">2 weeks</option><option :value="28">4 weeks</option><option :value="56">8 weeks</option><option :value="90">3 months</option></select></label>
          <div v-if="settings.view==='list'" class="list-page-controls"><label><span class="page-control-label">Item sources</span><select v-model="listKind" aria-label="Item sources"><option value="all">All items</option><option v-for="source in sources" :key="source" :value="source">{{sourceLabels[source]}}</option></select></label><button v-if="attention!=='all'" class="filter-chip" @click="attention='all'">{{({overdue:'Overdue',today:'Due today',undated:'No deadline',blocked:'Blocked'} as Record<string,string>)[attention]}}<X :size="12"/></button></div>
          <div v-if="filterOpen" class="filter-popover">
            <div class="popover-heading"><strong>View filters</strong><button class="text-button" @click="resetFilters">Reset</button></div>
            <details class="unified-status-filter" :open="statusIds.length>0"><summary>Unified statuses<span v-if="statusIds.length"> · {{statusIds.length}} selected</span></summary><p class="field-hint">{{mappingSpace?.name||'Default'}} mapping · no selection shows all work statuses.</p><label v-for="status in statusFilterOptions" :key="status.id" class="check-label"><input type="checkbox" :checked="statusIds.includes(status.id)" @change="toggleStatusFilter(status.id)"/><i class="source-color-dot" :style="{background:status.color}"/>{{status.title}}</label><button v-if="statusIds.length" class="text-button" @click="statusIds=[]">All statuses</button><button class="text-button" :disabled="metadataLocked" @click="filterOpen=false;openStatusMapping()">Map statuses</button></details><div class="filter-group"><span class="filter-label">Deck responsibility</span><div class="responsibility-toggle" role="group" aria-label="Deck card responsibility"><button :class="{active:assignment==='me'}" :aria-pressed="assignment==='me'" @click="setAssignment('me')"><UserRound :size="13"/>Assigned to me</button><button :class="{active:assignment==='all'}" :aria-pressed="assignment==='all'" @click="setAssignment('all')">Everyone</button></div></div>
            <label class="check-label"><input type="checkbox" :checked="settings.includeUnassigned" @change="updateSettings({includeUnassigned:($event.target as HTMLInputElement).checked})"/>Include unassigned Deck cards</label>
            <label class="check-label"><input type="checkbox" :checked="showDone" @change="setShowDone(($event.target as HTMLInputElement).checked)"/>{{completedDays!==undefined?'Show cancelled tasks':'Show completed and cancelled'}}</label>
            <HistoryDaysControl v-if="completedDays!==undefined" label="Completed items" all-label="Show all completed" zero-label="Hide completed" :value="completedDays" :default-days="DEFAULT_COMPLETED_DAYS" @change="changeCompletionHistory"/>
            <p v-if="assignment==='me'&&(model.hiddenAssignmentCount||model.unknownAssignmentCount)" class="field-hint">{{model.hiddenAssignmentCount}} cards outside your assignment filter<span v-if="model.unassignedCount"> · {{model.unassignedCount}} unassigned</span><span v-if="model.unknownAssignmentCount"> · {{model.unknownAssignmentCount}} assignment unknown</span>.</p>
            <details><summary>Unassigned exceptions by board</summary><label v-for="board in state.collections.filter(c=>c.source==='deck')" :key="board.id" class="check-label"><input type="checkbox" :checked="settings.unassignedBoardIds.includes(board.id)" @change="toggleSettingList('unassignedBoardIds',board.id)"/>{{board.title}}</label></details>
            <details><summary>Visible sources</summary><label v-for="collection in state.collections" :key="collection.id" class="check-label"><input type="checkbox" :checked="!settings.hiddenCollectionIds.includes(collection.id)" @change="toggleSettingList('hiddenCollectionIds',collection.id)"/><component :is="sourceIcons[collection.source]" :size="13"/>{{collection.title}}</label></details>
            <p class="field-hint">Calendar events and task lists are not filtered by Deck assignment.</p>
          </div>
          </div>
          </div>
          <div v-if="timelineView||settings.view==='calendar'" class="date-navigation"><button class="icon-button" aria-label="Previous period" title="Previous period" @click="navigateWeek(-1)"><ChevronLeft :size="16"/></button><button class="text-button date-today" @click="anchor=new Date()">Today</button><button class="icon-button" aria-label="Next period" title="Next period" @click="navigateWeek(1)"><ChevronRight :size="16"/></button><label class="week-label" :title="weekLabel"><span class="full-date-range">{{weekLabel}}</span><span class="compact-date-range">{{compactWeekLabel}}</span><input type="date" :value="dayKey(anchor)" aria-label="Choose calendar date" @change="anchor=dateValue(($event.target as HTMLInputElement).value)"/></label></div>
          <div id="inline-page-options" class="inline-page-options"></div>
          <Teleport to="#inline-page-options" defer><button id="page-options-toggle" class="icon-button page-options-toggle" :class="{active:pageOptionsOpen||filtersActive}" :aria-label="filtersActive?'Page options · filters active':'Page options'" title="Page options" :aria-expanded="pageOptionsOpen" aria-controls="planner-page-options" @click="togglePageOptions"><Menu :size="19"/><span v-if="filtersActive" class="filter-active-dot"></span></button></Teleport>
        </div>
        <div class="workspace-body">
          <section v-if="!sourceAuthorized&&!connected&&!state.records.length" class="welcome-panel"><div class="welcome-icon"><NextGlanceIcon :size="34"/></div><span class="eyebrow" style="text-transform:none">NextGlance planner</span><h2>Your life has different parts.<br>See how they fit together.</h2><p>Bring your Nextcloud calendars, tasks, Deck boards and notes into one place. Organize them into Spaces, then plan your own work across all of them.</p><button class="button primary large" @click="modal='settings'"><Cloud :size="17"/>{{desktop?'Sign in with Nextcloud':'Open connection settings'}}</button><small>{{desktop?'Sign in securely through your Nextcloud server.':'Browser preview · connect from the Windows app on this PC.'}}</small><div class="welcome-features"><span><Folder :size="19"/><strong>Spaces</strong><small>Work, Home, Shared</small></span><span><GitBranch :size="19"/><strong>Connected work</strong><small>Dependencies and references</small></span><span><UserRound :size="19"/><strong>Your overview</strong><small>The work that belongs to you</small></span></div></section>
          <section v-else-if="!connected&&!state.records.length" class="welcome-panel source-load-panel" aria-live="polite"><div class="welcome-icon"><LoaderCircle v-if="sourceRefreshing||deviceSync?.restoring" :size="34" class="spinning"/><Cloud v-else :size="34"/></div><h2>{{deviceSync?.restoring?'Restoring saved planner…':sourceRefreshing?'Checking your Nextcloud sources…':networkOnline?'No source items are available yet.':'You are offline.'}}</h2><p>{{state.connection.restoreError||(sourceRefreshing||deviceSync?.restoring?'Your account is ready. Source items will appear as they load.':!networkOnline?'Connect to the network to download your source items.':sourceIssues.length?'The last refresh did not load any source items. Check Details above or try again.':'Refresh to download your calendars, tasks, Deck boards and notes.')}}</p><button class="button primary large" :disabled="!sourceRefreshReady||busy||sourceRefreshing||deviceSync?.restoring" @click="refresh()"><RefreshCw :size="17" :class="{spinning:sourceRefreshing||deviceSync?.restoring}"/>{{sourceRefreshing||deviceSync?.restoring?'Checking sources…':'Refresh sources'}}</button></section>
          <template v-else>
          <p v-if="calendarRangeError&&calendarBrowse" class="inline-error" role="status">{{calendarRangeError}}</p>
          <template v-if="timelineView">
            <OverviewSplit :preference-key="preferenceAccountKey+':'+settings.scopeId+':overview'" :persist-presentation="!props.sessionHost" ref="overviewSplit" :status-mapping="effectiveMapping" v-model:list-collapsed="timelineListCollapsed" :arrangement="scopeArrangement" :can-reorder="!metadataLocked" @reorder="orderTimeline" @reset-order="resetTimelineOrder" v-if="settings.view==='overview'" :mobile="props.mobileHost" :can-edit-record="canEditTimelineRecord" :can-edit-plans="!metadataLocked" :can-link="!metadataLocked" :can-link-records="canLinkTimelineRecords" :saving="busy" @date-edit="editTimelineDates" @plan-edit="editTimelinePlan" @link="linkTimelineWork" @range-change="changeTimelineRange" :records="model.records" :relations="relations" :plans="state.workspace.plans" :anchor="timelineAnchor" :selected-id="selectedId" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" :spaces="model.spaces" :categories="model.categories" :projects="model.projects" :collections="state.collections" :scope-id="settings.scopeId" :days-count="timelineDays" :can-create="canCapture" @open="openRecord" @create="createFromRange" @focus-date="date=>anchor=dateValue(date)" :context-record-ids="model.contextRecordIds" />
            <PlannerTimeline :preference-key="preferenceAccountKey+':'+settings.scopeId+':timeline'" :persist-presentation="!props.sessionHost" :status-mapping="effectiveMapping" v-model:list-collapsed="timelineListCollapsed" :arrangement="scopeArrangement" :can-reorder="!metadataLocked" @reorder="orderTimeline" @reset-order="resetTimelineOrder" ref="standaloneTimeline" v-else v-model:all-calendar-bands="allCalendarBands" :floating-events="floatTimelineEvents" :compact-controls="compactPageControls" :can-create-event="canCapture" @create-event="createFromRange" :can-edit-record="canEditTimelineRecord" :can-edit-plans="!metadataLocked" :can-link="!metadataLocked" :can-link-records="canLinkTimelineRecords" :saving="busy" @date-edit="editTimelineDates" @plan-edit="editTimelinePlan" @link="linkTimelineWork" @range-change="changeTimelineRange" :records="model.records" :relations="relations" :plans="state.workspace.plans" :anchor="timelineAnchor" :selected-id="selectedId" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" :spaces="model.spaces" :categories="model.categories" :focused="false" :projects="model.projects" :collections="state.collections" :scope-id="settings.scopeId" :days-count="timelineDays" @open="openRecord" :context-record-ids="model.contextRecordIds" />
          </template>
        <CalendarMonth :preference-key="preferenceAccountKey+':'+settings.scopeId+':calendar'" :persist-presentation="!props.sessionHost" ref="monthCalendar" v-else-if="settings.view==='calendar'&&calendarMode==='month'" :records="model.records" :relations="relations" :plans="state.workspace.plans" :anchor="anchor" :scope-id="settings.scopeId" :selected-id="selectedId" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" :can-create="canCapture" :can-edit-record="canEditTimelineRecord" :can-edit-plans="!metadataLocked" :context-record-ids="model.contextRecordIds" @open="openRecord" @open-day="openCalendarDay" @create="createFromRange" @date-edit="editTimelineDates" @plan-edit="editTimelinePlan"/>
        <PlannerCalendar :preference-key="preferenceAccountKey+':'+settings.scopeId+':calendar'" :persist-presentation="!props.sessionHost" ref="standaloneCalendar" v-else-if="settings.view==='calendar'" @visible-days="standaloneCalendarDays=$event" :mode="calendarMode" :records="model.records" :relations="relations" :plans="state.workspace.plans" :days="week" :anchor="anchor" :scope-id="settings.scopeId" @focus-date="date=>anchor=dateValue(date)" :selected-id="selectedId" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" :can-create="canCapture" :can-edit-record="canEditTimelineRecord" :can-edit-plans="!metadataLocked" @date-edit="editTimelineDates" @plan-edit="editTimelinePlan" @open="openRecord" @create="createFromRange" :context-record-ids="model.contextRecordIds" />
          <PlannerBoard :can-create-card="!metadataLocked&&captureKinds.includes('card')" :create-card-reason="!nativeOperationImplemented('createCard')?'Card creation is unavailable on this client.':'Connect a writable Deck board with a stack to create cards.'" @create-card="openBoardCapture" :has-custom-mapping="Boolean(mappingSpace?.statusMapping||state.workspace.planner.statusMapping)" :arrangement="scopeArrangement" v-model:group-tasks="boardGroupTasks" @reorder="orderBoard" @reset-order="resetBoardOrder" toolbar-target="#board-page-controls" v-else-if="settings.view==='board'" :can-edit-record="canEditBoardChecklist" @checklist-edit="editBoardChecklist" :records="model.records" :collections="boardCollections" :relations="relations" :workflow="settings.workflow" :scope-id="settings.scopeId" :selected-id="selectedId" :username="state.connection.username" :status-mapping="effectiveMapping" :can-move-tasks="sourceWritable('tasks','updateTaskStatus')" @configure-statuses="openStatusMapping" @status-move="moveMappedStatus" :can-move-native="sourceWritable('deck','moveCard')" :can-complete-native="sourceWritable('deck','setCardCompleted')" :locked="metadataLocked" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" @open="openRecord" @workflow="setWorkflow" @move="moveCard"/>
          <section v-else class="list-view" aria-label="Items list"><div class="list-table"><div class="list-head"><span>Item</span><span>Source</span><span>Date</span><span>Status / assignment</span></div><button v-for="record in listRecords.slice(0,listLimit)" :key="record.id" class="list-table-row" :class="{selected:record.id===selectedId,completed:isClosed(record)}" @click="openRecord(record)"><span class="list-title"><component :is="sourceIcons[record.source]" :size="16" :style="{color:colorFor(record)}"/><strong>{{record.title}}<small v-if="tagsFor(record).length" class="record-tags"><span v-for="tag in tagsFor(record)" :key="tag.id"><i :style="{backgroundColor:tag.color||sourceColorFor(record)}"/>{{tag.title}}</span></small></strong><Link2 v-if="isLinked(record)" :size="12"/></span><span><small v-if="contextIds.has(record.id)" class="list-category">Linked context</small><small v-else-if="recordCategory(record)" class="list-category">{{recordCategory(record)?.name}}</small><i class="source-color-dot" :style="{backgroundColor:sourceColorFor(record)}" :title="'Original source color: '+record.collectionTitle"/>{{record.collectionTitle||sourceLabels[record.source]}}</span><span :class="{overdue:isOverdue(record)}"><span v-if="record.start||record.due" :class="{'weekend-date':isWeekend(record.start||record.due)}" :data-date="dayKey(record.start||record.due||'')">{{shortDate(record.start||record.due)}}</span><template v-else>—</template></span><span>{{record.kind==='task'||record.kind==='card'?statusLabel(record):record.kind==='event'?eventLabel(record):sourceLabels[record.source]}}<small v-if="record.kind==='card'">{{!record.assignmentKnown?'Assignment unknown':record.assigneeIds?.includes(state.connection.username||'')?'Assigned to you':!record.assignmentCount&&!record.assigneeIds?.length?'Unassigned':'Assigned to others'}}</small></span></button></div><div v-if="!listRecords.length" class="view-empty"><Search :size="26"/><strong>No matching items</strong><p>Adjust the source, assignment or search filters.</p><button class="button" @click="resetFilters">Clear filters</button></div><button v-if="listRecords.length>listLimit" class="load-more" @click="listLimit+=120">Show 120 more · {{listRecords.length-listLimit}} remaining</button></section>
          </template>
        </div>
      </template>
      <div v-else-if="!error" class="app-loading"><LoaderCircle :size="28" class="spinning"/><p>Opening your planner…</p></div>
    </main>
    <aside v-if="selectedId&&state" id="item-details" class="inspector" aria-label="Item details">
      <div class="inspector-resize-handle" role="separator" tabindex="0" aria-label="Resize item details" aria-controls="item-details" aria-orientation="vertical" :aria-valuemin="inspectorSize.minimum.value" :aria-valuemax="inspectorSize.maximum.value" :aria-valuenow="inspectorSize.width.value" :aria-valuetext="inspectorSize.width.value+' pixels wide'" title="Drag to resize · Arrow keys adjust width · Double-click to reset" @pointerdown="inspectorSize.start" @pointermove="inspectorSize.move" @pointerup="inspectorSize.finish" @pointercancel="inspectorSize.finish" @lostpointercapture="inspectorSize.finish" @keydown="inspectorSize.keyboard" @dblclick="inspectorSize.reset"></div>
      <header class="inspector-header"><button v-if="inspectorHistory.length" class="icon-button inspector-back" aria-label="Back to previous item" title="Back to previous item" :disabled="resourceBusy||noteLinkBusy" @click="backToItem"><ChevronLeft :size="21"/></button><span class="inspector-kind"><component v-if="selected" :is="sourceIcons[selected.source]" :size="19"/>{{selected?.kind==='card'?'Deck card':selected?.kind==='task'?'Task':selected?.kind==='event'?'Calendar event':selected?.kind==='note'?'Note':'Page'}}</span><button v-if="selected?.url" class="icon-button" aria-label="Open source item" @click="external(selected.url)"><ExternalLink :size="17"/></button><button class="icon-button" aria-label="Close item details" @click="closeInspector"><X :size="20"/></button></header>
      <template v-if="selected"><div class="inspector-content">
        <p v-if="selectedLocation" class="inspector-location">{{selectedLocation}}</p><p v-if="contextIds.has(selected.id)" class="field-hint scope-linked-context"><Link2 :size="13"/>Linked context · this source is outside the selected view.</p>
        <ItemAppearanceEditor v-if="['card','task','event'].includes(selected.kind)" ref="appearanceEditor" :key="selected.id" :record="selected" :records="state.records" :collection="state.collections.find(c=>c.id===selected?.collectionId)" :workspace="state.workspace" :source-color="sourceColorFor(selected)" :busy="appearanceSaving" :disabled="!sourceWritable(selected.source,'updateRecordAppearance')" :error="appearanceError" :save-changes="saveAppearance" :save-tag-colors="saveTagColors" :create-native-tag="selected.kind==='card'&&sourceWritable('deck','createDeckLabel')?createBoardTag:undefined" @discard="discardAppearance" @dirty="appearanceDirty=$event"/>
        <template v-else><Teleport v-if="inspectorContentReady&&selected.kind==='note'" :to="expandedNoteTagsHost||'body'" :disabled="modal!=='note-editor'||!expandedNoteTagsHost"><NoteTagsEditor ref="noteTagsEditor" :key="selected.id" :tags="selected.tagDetails||[]" :options="noteTagChoices" :suggestions="noteSuggestions" :disabled="selected.readonly||!sourceWritable('notes','setNoteTags')" :busy="noteTagsLoading" :error="noteTagsError" :save-changes="saveNoteTags" @dirty="noteTagsDirty=$event" @discard="discardNoteTags"/></Teleport><h2>{{selected.title}}</h2><p class="inspector-collection"><i class="source-color-dot" :style="{backgroundColor:sourceColorFor(selected)}" title="Original source color"/>{{selected.kind==='note'?'Folder: ':''}}{{selected.collectionTitle}}</p><button v-if="selected.kind==='note'&&noteTagsError" class="text-button" @click="loadNoteTags">Reload note tags</button></template>
        <LinkedJump v-if="['task','card','event'].includes(selected.kind)" class="selected-item-jump" :record-id="selected.id" :title="selected.title" :view="settings.view" @jump="jumpLinked"/>
        <div v-if="selected.kind==='task'||selected.kind==='card'||selected.kind==='event'" class="detail-properties">
          <div v-if="selected.kind==='card'" class="inspector-status-field"><span>Deck stack</span><StatusSelect v-if="selectedDeck?.stacks?.length" :options="statusOptions(selected)" :model-value="selected.stackId||''" label="Deck stack" :title="'Board column: '+mappedStatus(selected).title" :disabled="selected.readonly||selectedDeck.readonly||!sourceWritable('deck','moveCard')" @update:model-value="moveCard(selected.id,$event)"/><strong v-else class="inspector-status-control" :style="statusControlStyle(selected)" :title="'Board column: '+mappedStatus(selected).title">{{statusLabel(selected)}}</strong></div>
          <div v-if="selected.kind==='task'" class="inspector-status-field"><span>Status</span><StatusSelect :options="statusOptions(selected)" :model-value="nativeStatus(selected)||'NEEDS-ACTION'" label="Task status" :title="'Board column: '+mappedStatus(selected).title" :disabled="!canChangeTaskStatus(selected)" @update:model-value="changeTaskStatus(selected,$event)"/></div>
          <div v-if="selected.kind==='card'"><span>Assigned to</span><strong>{{!selected.assignmentKnown?'Unknown — refresh Deck':selected.assigneeIds?.length?selected.assigneeIds.map(id=>id===state?.connection.username?'You':id).join(', '):selected.assignmentCount?'Group / team':'Unassigned'}}</strong></div>
        </div>
        <p v-if="!selectedNativeEditingSupported" class="field-hint native-readonly-hint">Source editing is not available on this device yet. Open the item in Nextcloud to make changes.</p><p v-else-if="selected.kind==='task'&&taskReadOnly(selected)" class="field-hint">This task is read only here. Open it in Nextcloud to change its status.</p><p v-else-if="selected.kind==='task'&&!nativeOperationImplemented('updateTaskStatus')" class="field-hint">Task status changes are not available on this device yet.</p><p v-else-if="selected.kind==='task'&&!sourceWritable('tasks','updateTaskStatus')" class="field-hint">Connect and refresh Tasks to change its status.</p>
        <section v-if="['task','card','event'].includes(selected.kind)" class="inspector-section dates-section" aria-label="Item dates">
          <header><h3>{{selected.kind==='event'?'Event dates':'Dates'}}</h3><button v-if="selected.kind!=='event'" class="text-button" :disabled="!canEditTimelineRecord(selected)" @click="editDates"><Pencil :size="14"/>{{selected.start||selected.due||selected.end?'Edit dates':'Set dates'}}</button></header>
          <div class="date-summary">
            <div><span>Start</span><strong>{{selected.start?shortDate(selected.start):'Not set'}}</strong><small v-if="selected.start?.includes('T')&&!selected.allDay">{{clockTime(selected.start)}}</small></div>
            <ArrowRight :size="16"/>
            <div><span>{{selected.kind==='event'?'End':'Due'}}</span><strong :class="{overdue:isOverdue(selected)}">{{(selected.kind==='event'?selected.end:selected.due)?shortDate(selected.kind==='event'?selected.end:selected.due):'Not set'}}</strong><small v-if="selected.kind==='event'&&selected.allDay">First day after event</small><small v-else-if="(selected.kind==='event'?selected.end:selected.due)?.includes('T')">{{clockTime(selected.kind==='event'?selected.end:selected.due)}}</small></div>
          </div>
          <p v-if="selected.readonly&&selected.kind!=='event'" class="field-hint">This source is read only.</p><p v-else-if="selected.kind!=='event'&&nativeOperationAvailable('updateRecordDates')&&!canEditTimelineRecord(selected)" class="field-hint">Connect and refresh this source to edit dates.</p>
          <p v-else-if="canEditTimelineRecord(selected)&&selected.kind!=='event'" class="field-hint">Plan the work range here. Reserve focused time in Calendar below.</p>
        </section>
        <EventSummary v-if="selected.kind==='event'" :record="selected" :can-edit="canEditEvent(selected)" :can-respond="canRespondEvent(selected)" :edit-reason="eventActionReason(selected,'updateEvent')" :response-reason="eventActionReason(selected,'respondToEvent')" :busy="Boolean(busy||sourceSaving)" @edit="openEventEditor" @respond="respondEvent"/>
        <CalendarConnections :record="selected" :records="state.records" :relations="relations" :locked="metadataLocked" :calendar-available="sourceAvailable('calendar')" :can-schedule="sourceWritable('calendar','createLinkedEvent')" :pending="Boolean(state.pendingSchedules?.some(p=>p.recordId===selected?.id))" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" @schedule="openSchedule('create')" :view="settings.view" @jump="jumpLinked" @link="openSchedule('link')" @open="openLinkedRecord" @unlink="removeRelation"/>
        <DependencyPanel v-if="selectedDependencies.length||['task','card'].includes(selected.kind)" :record="selected" :records="state.records" :relations="relations" :locked="metadataLocked" :pending="nativeDependencyPending" :can-remove="canRemoveDependency" :failure="dependencyFailure" @retry="retryDependency" :problem="dependencyProblem" :is-deck="isDeckDependency" :status-mapping="effectiveMapping" @add="openConnection('depends_on')" :view="settings.view" @jump="jumpLinked" @open="openLinkedRecord" @remove="removeRelation" @publish="saveDeckDependency($event)">
          <template v-if="selected.kind==='card'" #actions>
            <button class="text-button" :disabled="metadataLocked" @click="openConnection('depends_on',true)"><Link2 :size="14"/>Link task</button>
            <button class="text-button" :disabled="metadataLocked||!sourceWritable('tasks','createTask')" @click="openCardTasks('create')"><Plus :size="14"/>Create task</button>
            <button class="text-button" :disabled="metadataLocked||!sourceWritable('tasks','createTask')" @click="openCardTasks('checklist')"><List :size="14"/>From checklist</button>
          </template>
        </DependencyPanel>
        <section v-if="inspectorContentReady||editingNote" class="inspector-section description-section">
          <header><h3>{{selected.kind==='note'||selected.kind==='page'?'Content':'Description'}}</h3><button v-if="selected.kind==='note'&&canEditContent" class="text-button" aria-label="Expand note editor" @click="openNoteEditor"><ExternalLink :size="14"/>Expand</button><button v-if="canEditContent&&!editingNote" class="text-button" @click="editContent"><Pencil :size="14"/>Edit</button><span v-else-if="!canEditContent" class="content-readonly">Read only</span></header>
          <form v-if="editingNote&&modal!=='note-editor'" class="note-editor" @submit.prevent="saveContent">
            <label v-if="selected.kind==='note'">Title<input v-model="noteDraft.title" required :disabled="busy"/></label>
            <MarkdownEditor v-model="noteDraft.content" :disabled="busy" @link="external"/>
            <p v-if="contentError" role="alert" class="inline-error">{{contentError}}</p><button v-if="contentError&&selected.kind==='note'&&api.readNote" type="button" class="text-button" :disabled="noteConflictBusy" @click="reviewNoteConflict">Review Nextcloud version</button>
            <div class="form-actions"><button type="button" class="button quiet" :disabled="busy" @click="cancelContent">Cancel</button><button class="button primary" :disabled="busy">{{selected.kind==='note'?'Save note':'Save description'}}</button></div>
          </form>
          <div v-else-if="pageBusy" class="loading-inline"><LoaderCircle :size="16" class="spinning"/>Loading page…</div><p v-else-if="pageError" class="inline-error">{{pageError}}</p>
          <MarkdownContent v-else-if="selected.kind==='page'?pageBody:selected.body" :body="selected.kind==='page'?pageBody:selected.body||''" :page-id="selected.kind==='page'?selected.id:undefined" :read-asset="api.readPageAsset" :editable-tasks="selected.kind!=='event'&&canEditContent&&!editingNote" @toggle-task="toggleDescriptionTask" @link="external"/>
          <p v-else class="field-hint">No description yet.</p>
          <p v-if="contentError&&!editingNote" role="alert" class="inline-error">{{contentError}}</p>
          <button v-if="selected.kind==='page'&&selected.url&&!selected.readonly" class="text-button content-source-edit" @click="external(selected.url)"><ExternalLink :size="14"/>Edit page in Nextcloud</button>
        </section>
        <section v-if="selected.kind!=='card'&&(selectedNotes.length||['task','event'].includes(selected.kind))" class="inspector-section linked-notes-section" aria-label="Attachments">
          <header><h3>Attachments <span v-if="selectedNotes.length">{{selectedNotes.length}}</span></h3><button class="text-button" aria-label="Attach" :disabled="metadataLocked" @click="openConnection('reference')"><Plus :size="15"/>Attach</button></header>
          <div v-for="link in selectedNotes" :key="link.id" class="inspector-linked-row"><button :disabled="!link.record" @click="link.record&&openLinkedRecord(link.record)"><component :is="link.record?.kind==='page'?BookOpen:FileText" :size="18"/><span><strong>{{link.record?.title||'Unavailable note'}}</strong><small>{{link.native?'Attached in Deck':link.record?.collectionTitle||'Nextcloud Notes'}}</small><span v-if="link.record&&tagsFor(link.record).length" class="note-row-tags"><span v-for="tag in tagsFor(link.record)" :key="tag.id">{{tag.title}}</span></span></span><ChevronRight :size="16"/></button><button class="icon-button" :disabled="metadataLocked||resourceBusy||link.native&&(!canAttachDeck(selected,'removeDeckAttachment')||!nativeOperationAvailable('readDeckAttachments'))" :aria-label="'Unlink note '+link.record?.title" :title="link.native?'Remove Deck attachment; keep the note file':'Unlink note; keep its content'" @click="removeRelation(link)"><X :size="14"/></button></div>
          <p v-if="!selectedNotes.length" class="field-hint">Attach a note or reference to this work.</p>
        </section>
        <NativeResourcesPanel v-if="inspectorContentReady&&['card','note'].includes(selected.kind)" ref="nativeResources" :key="selected.id" :record="selected" :records="state.records" :api="api" :can-write="canAttachDeck(selected,'removeDeckAttachment')" :can-attach="!metadataLocked&&!resourceBusy&&(canAttachDeck(selected)||canAttachDeck(selected,'uploadDeckAttachment'))" :can-read-attachments="connected&&networkOnline&&nativeOperationAvailable('readDeckAttachments')" :linked-note-count="selectedNotes.length" :connected="connected&&networkOnline" @changed="adoptNativeResources" @busy="resourceBusy=$event" @attach="openConnection('reference')" @open="openLinkedRecord" @external="external">
          <template #notes>
          <div v-for="link in selectedNotes" :key="link.id" class="inspector-linked-row"><button :disabled="!link.record" @click="link.record&&openLinkedRecord(link.record)"><component :is="link.record?.kind==='page'?BookOpen:FileText" :size="18"/><span><strong>{{link.record?.title||'Unavailable note'}}</strong><small>{{link.native?'Attached in Deck':link.record?.collectionTitle||'Nextcloud Notes'}}</small><span v-if="link.record&&tagsFor(link.record).length" class="note-row-tags"><span v-for="tag in tagsFor(link.record)" :key="tag.id">{{tag.title}}</span></span></span><ChevronRight :size="16"/></button><button class="icon-button" :disabled="metadataLocked||resourceBusy||link.native&&(!canAttachDeck(selected,'removeDeckAttachment')||!nativeOperationAvailable('readDeckAttachments'))" :aria-label="'Unlink note '+link.record?.title" :title="link.native?'Remove Deck attachment; keep the note file':'Unlink note; keep its content'" @click="removeRelation(link)"><X :size="14"/></button></div>
          </template>
        </NativeResourcesPanel>
        <section v-if="selectedOtherLinks.length" class="inspector-section" aria-label="Other linked items"><header><h3>Other linked items</h3></header><div v-for="link in selectedOtherLinks" :key="link.id" class="inspector-linked-row"><button :disabled="!link.record" @click="link.record&&openRecord(link.record)"><Link2 :size="17"/><span><strong>{{link.record?.title||'Unavailable item'}}</strong><small>{{relationLabel(link,link.incoming)}}<template v-if="link.role"> · {{link.role.replace('_',' ')}}</template></small></span><ChevronRight :size="15"/></button><button class="icon-button" :disabled="metadataLocked" aria-label="Remove connection" @click="removeRelation(link)"><X :size="14"/></button></div></section>
        <details class="inspector-options" :open="inspectorOrganizationOpen" @toggle="inspectorOrganizationOpen=($event.target as HTMLDetailsElement).open"><summary>Organization & personal planning</summary><template v-if="inspectorOrganizationOpen">
          <button class="text-button other-link-action" :disabled="metadataLocked" @click="openConnection('related')"><Link2 :size="15"/>Link another item</button>
          <section v-if="state.workspace.projects.length" class="inspector-section"><header><h3>Projects</h3></header><label v-for="project in state.workspace.projects.filter(p=>!p.archived)" :key="project.id" class="check-label"><input type="checkbox" :checked="project.recordIds.includes(selected.id)||projectAutomatic(project)" :disabled="metadataLocked||projectAutomatic(project)" @change="toggleProjectRecord(project.id)"/>{{project.name}}<small v-if="projectAutomatic(project)">{{project.tagNames?.length?'via tag rule':'via source'}}</small></label></section>
          <section v-if="selected.kind==='task'||selected.kind==='card'" class="inspector-section"><header><h3>Personal planning column</h3></header><select :value="planningColumnForRecord(selected,settings.workflow)" :disabled="metadataLocked||isClosed(selected)" aria-label="Personal planning column" @change="setWorkflow(selected.id,($event.target as HTMLSelectElement).value as WorkflowColumn)"><option value="inbox">Inbox</option><option value="planned">Planned</option><option value="doing">In progress</option><option value="done">Done</option><option v-if="isClosed(selected)&&!selected.completed" value="cancelled">Cancelled</option></select><p class="field-hint">{{isClosed(selected)?'Reopen this item to plan it as open work.':'Only used in Board → Personal planning. For your unified status board, use Deck stack or Status above. This optional column does not change the Nextcloud status.'}}</p></section>
          <details v-if="selected.kind==='task'||selected.kind==='card'" class="planner-block-options"><summary>Planner-only blocks <span v-if="selectedPlans.length">({{selectedPlans.length}})</span></summary><p class="field-hint">Optional time blocks saved only in NextGlance. Use Schedule in calendar for a Nextcloud booking.</p><div v-for="plan in selectedPlans" :key="plan.id" class="plan-row"><Clock3 :size="14"/><button @click="openPlan(plan.id)"><strong>{{shortDate(plan.start)}}</strong><small>{{clockTime(plan.start)}} – {{clockTime(plan.end)}}</small></button><button class="icon-button" :disabled="metadataLocked" :aria-label="'Remove work session on '+shortDate(plan.start)" @click="removePlan(plan.id)"><X :size="13"/></button></div><button class="text-button" :disabled="metadataLocked" @click="openPlan()"><Plus :size="14"/>Add planner block</button></details>
        </template></details>
        <p v-if="selected.kind==='event'&&!canDeleteEvent(selected)" class="field-hint event-delete-reason">Delete event: {{eventActionReason(selected,'deleteEvent')}}</p>
      </div><footer class="inspector-actions"><button v-if="selected.kind==='event'" class="button danger" :disabled="!canDeleteEvent(selected)" :title="eventActionReason(selected,'deleteEvent')||'Delete event'" @click="requestDeleteEvent(selected)"><Trash2 :size="16"/>Delete event</button><button v-if="selected.kind==='task'||selected.kind==='card'" class="button" :class="{primary:!isClosed(selected)}" :disabled="!canComplete(selected)" @click="complete(selected)"><Check :size="17"/>{{isClosed(selected)?'Reopen':'Mark done'}}</button><button v-if="selected.kind==='task'&&nativeOperationImplemented('deleteTask')" class="button danger" :disabled="!canDeleteTask(selected)" :title="canDeleteTask(selected)?'Delete task':'Connect and refresh a writable task list to delete. For recurring or shared tasks, open Nextcloud.'" @click="requestDeleteTask(selected)"><Trash2 :size="16"/>Delete task</button><button v-if="selected.url" class="button quiet" @click="external(selected.url)"><ExternalLink :size="16"/>{{selected.kind==='card'?'Open in Deck':'Open in Nextcloud'}}</button></footer></template><div v-else class="view-empty"><AlertCircle :size="25"/><strong>This item is unavailable</strong><p>Its connections remain saved. Refresh your sources to check access.</p></div>
    </aside>
    <div v-if="modal&&state" class="modal-backdrop" @click.self="closeModal"><section class="modal" :class="{'wide-modal':modal==='scope'||modal==='settings'||modal==='categories','category-modal':modal==='categories','visual-planner-modal':modal==='dates'||modal==='edit-event'||modal==='schedule'&&scheduleMode==='create','link-picker-modal':modal==='relation'||modal==='card-tasks','note-editor-modal':modal==='note-editor'||modal==='note-conflict','status-mapping-modal':modal==='status-mapping','event-matches-modal':modal==='event-matches'}" role="dialog" aria-modal="true" :aria-label="modal==='card-tasks'?(cardTasksMode==='checklist'?'Tasks from checklist':'Create a linked task'):modal==='note-conflict'?'Review note versions':modal==='note-editor'?'Edit note':modal==='event-matches'?'Find matching events':modal==='status-mapping'?'Map unified statuses':modal==='scope'?(scopeDraft.id?'Edit ':'Create ')+(scopeDraft.kind==='space'?'Space':'project'):modal==='categories'?'Group sources':modal==='settings'?'Settings and connection':modal==='plan'?'Plan a work session':modal==='delete-event'?'Delete calendar event':modal==='delete'?(deleteDraft?.kind==='space'?'Remove Space':'Remove project'):modal==='dates'?'Plan dates':modal==='edit-event'?'Edit event':modal==='relation'?(relationMode==='dependency'?(relationTaskOnly?'Link existing task':'Add dependency'):relationMode==='note'?'Attach notes or files':'Link related item'):modal==='schedule'?(scheduleMode==='create'?'Schedule in calendar':'Link existing event'):'New item'"><button class="modal-close icon-button" aria-label="Close dialog" :disabled="loginWaiting||busy||capturing||matchingSaving||noteLinkBusy||resourceBusy||noteConflictBusy" @click="closeModal"><X :size="19"/></button>
      <div class="modal-content">
      <SpaceEditor v-if="modal==='scope'&&scopeDraft.kind==='space'" :key="scopeDraft.id||'new-space'" :workspace="state.workspace" :collections="state.collections" :records="state.records" :space-id="scopeDraft.id||undefined" :locked="metadataLocked||saving>0" @save="saveSpaceDefinition" @dirty="spaceEditorDirty=$event" @cancel="closeModal" @remove="requestDeleteSpace"/>
      <template v-else-if="modal==='scope'"><span class="eyebrow">ORGANIZE YOUR NEXTCLOUD</span><h2>{{scopeDraft.id?'Edit': 'Create'}} {{scopeDraft.kind==='space'?'Space':'project'}}</h2><p class="modal-description">{{scopeDraft.kind==='space'?'Give related calendars, boards and task lists one home.':'Focus a larger piece of work inside a Space. Its items also appear in the parent Space.'}}</p><form @submit.prevent="saveScope"><div class="form-two"><label>Name<input id="scope-name" v-model="scopeDraft.name" required maxlength="200" :placeholder="scopeDraft.kind==='space'?'e.g. Work, Home, Shared':'e.g. Client A — Film production'"/></label><label class="color-label">Color<input v-model="scopeDraft.color" type="color"/></label></div><label v-if="scopeDraft.kind==='project'">Parent Space<select v-model="scopeDraft.spaceId" required @change="scopeDraft.categoryId=''"><option value="" disabled>Choose a Space</option><option v-for="space in state.workspace.spaces" :key="space.id" :value="space.id">{{space.name}}</option></select></label><label v-if="scopeDraft.kind==='project'&&(state.workspace.categories||[]).some(c=>c.spaceId===scopeDraft.spaceId)">Source group<select v-model="scopeDraft.categoryId"><option value="">Ungrouped</option><option v-for="category in (state.workspace.categories||[]).filter(c=>c.spaceId===scopeDraft.spaceId)" :key="category.id" :value="category.id">{{category.name}}</option></select></label><p v-if="scopeDraft.kind==='space'&&((state.workspace.categories||[]).some(c=>c.spaceId===scopeDraft.id)||state.workspace.projects.some(p=>p.spaceId===scopeDraft.id&&!p.archived))" class="field-hint">Sources used by categories or projects stay connected here. Save or cancel this form, then edit their category or project membership first.</p><div class="source-picker-heading"><strong>Connect existing sources</strong><span>{{scopeDraft.collectionIds.length}} selected</span></div><label class="source-picker-search"><Search :size="14"/><input v-model="scopeSearch" placeholder="Find a calendar, board or task list…" aria-label="Find sources"/></label><div class="source-picker"><div v-for="source in sources" :key="source"><h4><component :is="sourceIcons[source]" :size="14"/>{{sourceLabels[source]}}</h4><label v-for="collection in scopeCollections.filter(c=>c.source===source)" :key="collection.id" class="source-choice"><input type="checkbox" :checked="scopeDraft.collectionIds.includes(collection.id)" :disabled="Boolean(scopeSourceCategory(collection.id))" @change="toggleScopeCollection(collection.id)"/><span>{{collection.title}}</span><small v-if="scopeSourceCategory(collection.id)">In {{scopeSourceCategory(collection.id)?.name}}</small><small v-else-if="collection.readonly">Read-only</small></label><p v-if="!scopeCollections.some(c=>c.source===source)" class="source-picker-empty">{{state.collections.some(c=>c.source===source)?'No matching sources':'No sources loaded'}}</p></div></div><p class="field-hint">{{scopeDraft.kind==='project'?'Select sources and narrow them by project tags below. Tagged items are included automatically; you can also add individual items from their details.':'Existing and future items in these sources will appear in this Space.'}} Grouping does not move or share source data.</p><OrganizationTagPicker v-if="scopeDraft.kind==='project'" v-model="scopeDraft.tagNames" :workspace="state.workspace" :records="state.records" :collections="state.collections" :space-id="scopeDraft.spaceId" :collection-ids="scopeDraft.collectionIds" :record-ids="scopeDraft.recordIds" :disabled="metadataLocked||saving>0"/><details v-if="scopeDraft.kind==='space'&&scopeDraft.collectionIds.length" class="defaults-picker"><summary>Default destinations for new items</summary><label v-for="choice in [{key:'defaultCalendarId' as const,source:'calendar',label:'Calendar'},{key:'defaultTaskListId' as const,source:'tasks',label:'Task list'},{key:'defaultBoardId' as const,source:'deck',label:'Deck board'}]" :key="choice.key">{{choice.label}}<select v-model="scopeDraft[choice.key]"><option value="">Choose when creating</option><option v-for="collection in state.collections.filter(c=>c.source===choice.source&&scopeDraft.collectionIds.includes(c.id))" :key="collection.id" :value="collection.id">{{collection.title}}</option></select></label></details><div class="form-actions"><button v-if="scopeDraft.id" type="button" class="button danger quiet" @click="requestDeleteScope"><Trash2 :size="14"/>Remove project</button><button type="button" class="button quiet" @click="closeModal">Cancel</button><button class="button primary" :disabled="metadataLocked||!scopeDraft.name.trim()||scopeDraft.kind==='project'&&!scopeDraft.spaceId">{{scopeDraft.id?'Save changes':`Create ${scopeDraft.kind==='space'?'Space':'project'}`}}</button></div></form></template>
      <template v-else-if="modal==='categories'"><CategoryManager v-if="categorySpaceId" :key="categorySpaceId" :workspace="state.workspace" :records="state.records" :collections="state.collections" :space-id="categorySpaceId" :locked="metadataLocked||saving>0" @save="saveCategories" @dirty="categoriesDirty=$event" @cancel="closeModal"/></template>
      <template v-else-if="modal==='delete-task'&&deleteTaskDraft">
        <h2>Delete {{deleteTaskDraft.title}}?</h2>
        <p class="modal-description">This removes the task from {{deleteTaskDraft.source}} in Nextcloud Tasks. Linked events, cards, notes and other tasks are kept.</p>
        <p v-if="deleteTaskChanged" class="inline-error" role="alert">This task changed or is unavailable. Cancel and review its latest details before deleting.</p>
        <div class="form-actions">
          <button class="button quiet" :disabled="busy" @click="closeModal">Cancel</button>
          <button class="button danger" :disabled="busy||deleteTaskChanged||!deletingTask||!canDeleteTask(deletingTask)" @click="confirmDeleteTask">{{busy?'Deleting…':'Delete task'}}</button>
        </div>
      </template>
      <CreateItemForm v-else-if="modal==='capture'" :key="captureKey" :collections="captureCollections" :initial-type="captureType" :initial-range="captureRange" :initial-stack-id="widgetCapture?.config.creationDefaults.card?.stackId" :destinations="captureDestinations" :context-label="captureContextLabel" :available-types="captureKinds" :busy="Boolean(busy||capturing)" :error="error" @link="external" @submit="capture" @cancel="closeModal" @dirty="componentDraftDirty=$event"/>
      <CardTasksForm v-else-if="modal==='card-tasks'&&panelRecord" :key="cardTaskFormKey" :card="panelRecord" :workspace="state.workspace" :records="state.records" :relations="relations" :collections="cardTaskLists" :calendar-collections="state.collections" :destination="cardTaskDestination" :mode="cardTasksMode" :busy="busy" :error="error" :progress="cardTaskProgress" @submit="submitCardTasks" @cancel="closeModal" @dirty="componentDraftDirty=$event" @link="external"/>
      <RecordDatesEditor v-else-if="modal==='dates'&&panelRecord" :key="panelRecord.id" :record="panelRecord" :records="state.records" :relations="relations" :busy="busy" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" :error="error" @save="saveDates" @cancel="closeModal" @dirty="componentDraftDirty=$event"/>
      <EventDetailsEditor v-else-if="modal==='edit-event'&&panelRecord" :key="panelRecord.id" :record="panelRecord" :records="state.records" :collections="state.collections" :workspace="state.workspace" :busy="Boolean(busy||sourceSaving)" :error="error" @save="saveEvent" @cancel="closeModal" @dirty="componentDraftDirty=$event"/>
      <NoteConflictReview v-else-if="modal==='note-conflict'&&noteConflict" :draft="noteDraft" :current="noteConflict" :busy="noteConflictBusy" @back="backToNoteDraft" @use-current="useCurrentNote" @save-changes="saveReviewedNote" @link="external"/>
      <NoteEditorDialog v-else-if="modal==='note-editor'" v-model="noteDraft" :busy="busy||noteConflictBusy" :error="contentError" :can-review="Boolean(api.readNote)" @tags-host="expandedNoteTagsHost=$event" @review="reviewNoteConflict" @save="saveContent" @cancel="cancelContent" @collapse="modal=null" @link="external"/>
      <NoteLinkPicker v-else-if="modal==='relation'&&relationMode==='note'&&panelRecord" :key="panelRecord.id" :record="panelRecord" :records="state.records" :relations="relations" :busy="metadataLocked||noteLinkBusy" :error="error" :can-create="sourceWritable('notes','createNote')" :categories="noteCategories" :tags-for="tagsFor" :created-note="createdPickerNote" :api="api" :can-attach-files="canAttachDeck(panelRecord)" :can-attach-notes="panelRecord.kind!=='card'||canAttachDeck(panelRecord)" :can-upload-file="canAttachDeck(panelRecord,'uploadDeckAttachment')" :can-browse-files="sourceAvailable('deck')&&nativeOperationAvailable('listFiles')" @changed="adoptNativeResources();nativeResources?.reload()" @done="componentDraftDirty=false;modal=null;nativeResources?.reload()" @operation-busy="resourceBusy=$event" @add="addNotes" @create="createPickerNote" @cancel="closeModal" @dirty="componentDraftDirty=$event"/>
      <RelationPicker v-else-if="modal==='relation'&&panelRecord" :key="panelRecord.id+relationMode" :record="panelRecord" :records="state.records" :candidate-ids="relationCandidateIds" :candidate-scope="settings.scopeId==='all'?'all loaded sources':'this Space’s sources'" :relations="relations" :mode="relationMode" :task-only="relationTaskOnly" :busy="metadataLocked" :deck-available="sourceWritable('deck','setDeckDependency')" :error="error" @add="addRelation" @cancel="closeModal" @dirty="componentDraftDirty=$event"/>
      <EventMatchReview v-else-if="modal==='event-matches'" :records="matchingRecords" :relations="matchingRelations" :collections="state.collections" scope-label="All loaded sources" :busy="matchingSaving" :error="error" @confirm="linkEventMatches" @cancel="closeModal" @dirty="componentDraftDirty=$event"/>
      <StatusMappingEditor v-else-if="modal==='status-mapping'" :mapping="effectiveMapping" :scope-name="mappingSpace?.name" :inherited="Boolean(mappingSpace&&!mappingSpace.statusMapping)" :allow-default="Boolean(mappingSpace?.statusMapping)" @use-default="saveStatusMapping(null)" :collections="state.collections" :records="state.records" :busy="Boolean(saving)" :error="error||saveError" @save="saveStatusMapping" @cancel="closeModal" @dirty="componentDraftDirty=$event"/>
      <ScheduleEventForm v-else-if="modal==='schedule'&&scheduleRecord" :key="scheduleRecordId+scheduleMode" :record="scheduleRecord" :workspace="state.workspace" :collections="state.collections" :records="state.records" :relations="relations" :mode="scheduleMode" :busy="busy" :submitted="scheduleSubmitted" :scope-id="settings.scopeId" @dirty="componentDraftDirty=$event" :calendar-available="sourceWritable('calendar','createLinkedEvent')" :pending="schedulePending" @schedule="scheduleLinked" @link="linkScheduled" @cancel="closeModal"/>
      <template v-else-if="modal==='plan'"><span class="eyebrow">MAKE TIME FOR YOUR WORK</span><h2>{{planDraft.id?'Edit':'Plan'}} a work session</h2><p class="modal-description">{{state.records.find(r=>r.id===planDraft.recordId)?.title}}</p><form @submit.prevent="savePlan"><label>Start<input v-model="planDraft.start" type="datetime-local" required/></label><label>End<input v-model="planDraft.end" type="datetime-local" required/></label><p class="field-hint">Saved in your planner and shown in Calendar and Timeline. It does not create a calendar event or change the item’s deadline.</p><div class="form-actions"><button type="button" class="button quiet" @click="closeModal">Cancel</button><button class="button primary" :disabled="metadataLocked">Save work session</button></div></form></template>
      <template v-else-if="modal==='delete-event'"><span class="eyebrow">DELETE CALENDAR EVENT</span><h2>Delete {{deleteEventDraft?.title}}?</h2><p class="modal-description">This deletes the event from Nextcloud Calendar. <template v-if="deletingEvent?.eventScheduling?.role==='organizer'&&deletingEvent.eventScheduling.attendees.length">Guests may receive a cancellation from Nextcloud. </template>Linked tasks, cards and notes are kept. Their saved links will refer to an unavailable event.</p><p v-if="deleteEventChanged" class="inline-error" role="alert">This event changed or is no longer available. Cancel and review its latest details before deleting.</p><p v-if="deletingEvent?.start" class="field-hint">{{shortDate(deletingEvent.start)}} · {{deletingEvent.allDay?'All day':clockTime(deletingEvent.start)}}</p><div class="form-actions"><button class="button quiet" :disabled="busy" @click="closeModal">Cancel</button><button class="button danger" :disabled="busy||deleteEventChanged||!deletingEvent||!canDeleteEvent(deletingEvent)" @click="confirmDeleteEvent">{{busy?'Deleting…':'Delete event'}}</button></div></template>
      <template v-else-if="modal==='delete'"><span class="eyebrow">REMOVE {{deleteDraft?.kind==='space'?'SPACE':'PROJECT'}}</span><h2>Remove {{deleteDraft?.name}}?</h2><p class="modal-description">This removes the {{deleteDraft?.kind}}{{deleteDraft?.kind==='space'?' and its source groups and project definitions':''}} from this planner. Calendars, boards, tasks, notes and their contents stay in Nextcloud.</p><div class="form-actions"><button class="button quiet" @click="closeModal">Cancel</button><button class="button danger" :disabled="metadataLocked||saving>0" @click="deleteScope">Remove {{deleteDraft?.kind==='space'?'Space':'project'}}</button></div></template>
      <template v-else-if="modal==='settings'"><span class="eyebrow">YOUR DATA, YOUR SERVER</span><h2>Settings & connection</h2><p v-if="!settingsContentReady" class="field-hint" role="status">Opening settings…</p><template v-else><div class="settings-section settings-connection-section"><div class="settings-account"><span class="account-icon"><Cloud :size="23"/></span><div><strong>{{connectionLabel}}</strong><small>{{state.connection.serverUrl||'Calendars, tasks, Deck, Notes and Collectives'}}</small><small v-if="state.connection.username">{{state.connection.username}}</small><small v-if="authEntry.methodLabel">{{authEntry.methodLabel}}</small></div></div><p v-if="state.connection.restoreError" class="field-hint connection-diagnostic">{{state.connection.restoreError}}</p>
        <div v-if="authEntry.canSwitchDirect&&!loginWaiting" class="settings-connection-actions"><button class="button" :disabled="busy||syncing||refreshing||capturing||deviceSync?.restoring||!networkOnline" @click="beginLogin(true)"><Cloud :size="14"/>Use direct connection</button></div>
        <div v-if="loginWaiting" class="login-waiting"><LoaderCircle :size="18" class="spinning"/><span>Finish signing in in your browser.</span><button class="text-button" @click="external(loginFlow?.loginUrl)">Open sign-in</button><button class="text-button" @click="cancelLogin">Cancel</button></div><template v-else-if="!props.sessionHost&&!sourceAuthorized">
        <p v-if="error" class="notice error-notice" role="alert">{{error}}</p>
        <p v-if="!desktop" class="notice warning-notice">Connect from the Windows app. This browser preview does not accept or store credentials.</p>
        <button v-if="authEntry.primary==='files'" class="button primary files-account-login" :disabled="busy||loginWaiting" @click="selectHostAccount"><Folder :size="16"/>Continue with Nextcloud Files</button>
        <p v-if="authEntry.primary==='files'" class="field-hint">Use an account in the installed Nextcloud Files app, or sign in through your server below.</p>
        <label>Server URL<input v-model="login.serverUrl" type="url" placeholder="https://cloud.example.com" :disabled="!desktop||loginWaiting"/></label>
        <button class="button" :class="authEntry.primary==='browser'?'primary':'quiet'" :disabled="!desktop||busy||!login.serverUrl.trim()" @click="beginLogin()"><Cloud :size="15"/>{{authEntry.browserLabel}}</button>
        <button v-if="hasSavedAccount&&api.retryConnection" class="button quiet" :disabled="busy||loginWaiting" @click="retryConnection">Retry saved connection</button>
        <details v-if="desktop&&manualConnection" class="manual-login"><summary>Use an app password instead</summary><form @submit.prevent="connectManual"><label>Username<input v-model="login.username" autocomplete="username" required/></label><label>App password<input v-model="login.appPassword" type="password" autocomplete="current-password" required/></label><button class="button" :disabled="busy||loginWaiting">Connect</button></form></details>
      </template><div v-else class="settings-connection-actions"><button class="button" :disabled="busy||sourceRefreshing||deviceSync?.restoring||!sourceRefreshReady" @click="refresh"><RefreshCw :size="14"/>Refresh sources</button><button v-if="!props.sessionHost" class="button quiet" :disabled="busy" @click="disconnect"><Unplug :size="14"/>Disconnect</button></div><div v-if="deviceSync?.activity" class="sync-progress" role="status"><strong>{{deviceSync.activity.message}}</strong><small>{{syncStage(deviceSync.activity.stage)}} · {{deviceSync.activity.completed}}<template v-if="deviceSync.activity.total!==undefined"> / {{deviceSync.activity.total}}</template> · Started {{syncTime(deviceSync.activity.startedAt)}}</small></div><div class="source-statuses"><PlannerSyncStatus :planner-verified-at="deviceSync?.plannerVerifiedAt" :storage="state.storage" :connection="state.connection" :restoring="deviceSync?.restoring" :syncing="syncing||deviceSync?.plannerSyncing" :online="networkOnline" :retry-disabled="!plannerRetryReady" @retry="sync"/><div v-for="status in state.statuses" :key="status.source"><component :is="sourceIcons[status.source]" :size="15"/><strong>{{sourceLabels[status.source]}}</strong><span class="status-pill" :class="status.cached&&status.state==='connected'?'unavailable':status.state">{{status.state==='demo'?'Not connected':sourceReadLabel(status)}}</span><small>{{status.count}} items</small><p v-if="status.message">{{status.message}}</p><p class="sync-diagnostic"><span v-if="status.errorStage">{{syncStage(status.errorStage)}}<span v-if="status.errorCode"> · {{status.errorCode}}</span> · </span>Last successful refresh: {{syncTime(status.lastSyncedAt)}}</p></div></div></div><div v-if="api.getViewPreferences" class="settings-section"><h3>Page filters</h3><p class="field-hint">Filters are saved separately for each page and Space, including My overview, and sync between your devices.</p><p v-if="preferenceSyncError" class="inline-error" role="status">{{preferenceSyncError}}</p><div v-if="preferenceConflict" class="form-actions"><button class="button" :disabled="preferenceSyncing" @click="preferenceSync?.resolve('local')">Keep my conflicting filters</button><button class="button quiet" :disabled="preferenceSyncing" @click="preferenceSync?.resolve('remote')">Use server conflicting filters</button></div><button class="button quiet" :disabled="preferenceSyncing||!sourceAuthorized||!networkOnline" @click="refreshViewPreferences">{{preferenceSyncing?'Syncing filters…':'Sync filters'}}</button></div><DiagnosticsPanel :api="api"/><div v-if="api.setCalendarHistoryDays&&hasSavedAccount" class="settings-section"><h3>Calendar sync</h3><HistoryDaysControl label="Calendar history" all-label="All history" zero-label="From today" :value="state.calendarHistoryDays??null" :default-days="90" :disabled="calendarHistoryBusy||deviceSync?.restoring" @change="changeCalendarHistory"/><p v-if="calendarHistoryBusy" class="field-hint" role="status">Updating Calendar history…</p><p v-if="calendarHistoryError" class="inline-error" role="status">{{calendarHistoryError}}</p></div><SyncPreferences v-if="!props.sessionHost&&deviceSync&&api.setSyncSettings" :sync="deviceSync" :busy="syncSettingsBusy" :error="syncSettingsError" @change="saveSyncSettings"/><div class="settings-section"><h3>Appearance</h3><div v-if="!props.sessionHost" class="appearance-options" role="group" aria-label="Color mode"><button v-for="mode in ['system','light','dark'] as const" :key="mode" :class="{active:state.workspace.appearance.mode===mode}" :disabled="metadataLocked" @click="setAppearance(mode)">{{mode==='system'?'Follow Nextcloud':mode[0]!.toUpperCase()+mode.slice(1)}}</button></div><p v-if="props.sessionHost" class="field-hint">Appearance follows your Nextcloud settings. Calendar colors follow their sources unless overridden below.</p><p v-else class="field-hint">Follow Nextcloud uses your personal appearance, colors and background. If Nextcloud follows your system, this app does too. Light and Dark override the mode here only. Calendar colors follow their sources unless overridden below.</p><WeekendDaysSettings :mask="weekendMask" :pending="weekendPending" :error="weekendError" @change="changeWeekendDay"/><details v-if="state.collections.some(c=>c.source==='calendar')" :open="calendarColorsOpen" @toggle="calendarColorsOpen=($event.target as HTMLDetailsElement).open"><summary>Calendar colors</summary><template v-if="calendarColorsOpen"><div v-for="calendar in state.collections.filter(c=>c.source==='calendar')" :key="calendar.id" class="calendar-color-setting"><span>{{calendar.title}}</span><input type="color" :value="state.workspace.appearance.calendarColors[calendar.id]||calendar.color||primary" :disabled="metadataLocked" :aria-label="`Color for ${calendar.title}`" @change="setColor(calendar.id,($event.target as HTMLInputElement).value)"/><button class="text-button" :disabled="metadataLocked||!state.workspace.appearance.calendarColors[calendar.id]" @click="setColor(calendar.id,'')">Reset</button></div></template></details></div><div class="settings-section planner-storage-settings"><h3>Planner storage</h3><a v-if="props.sessionHost&&props.sourceUrl" :href="props.sourceUrl" class="text-button">Download source code · AGPL-3.0-or-later</a><p v-if="props.sessionHost" class="field-hint">Spaces, custom links, work sessions, tag colors and board mappings are saved directly in <strong>Workspace/Nextspace/</strong> in Nextcloud Files. A connection is required to save changes.</p><p v-else class="field-hint">Spaces, custom links, work sessions, tag colors and board mappings are saved locally and synced automatically as smaller files in <strong>Workspace/Nextspace/</strong> in Nextcloud Files. Only changed files are uploaded. The old planner.json is preserved during migration. Changes sync when editing is idle. {{managedSync?'Planner files download when opening or returning to the app.':'Connected devices check every minute.'}}</p><p v-if="state.storage.message" class="storage-message">{{state.storage.message}}</p><PlannerConflictReview v-if="api.resolveWorkspaceConflict&&state.plannerConflict" :key="inspectorAccount" :conflict="state.plannerConflict" :disabled="!plannerRetryReady||Boolean(saveError)||state.plannerConflict.revision!==state.revision" @resolve="resolvePlannerConflict"/><p class="sync-diagnostic"><span v-if="state.storage.errorStage">{{syncStage(state.storage.errorStage)}}<span v-if="state.storage.errorCode"> · {{state.storage.errorCode}}</span> · </span>Last successful sync: {{syncTime(state.storage.lastSyncedAt)}}</p><div class="form-actions"><button class="button" :disabled="!plannerRetryReady" @click="sync"><Cloud :size="14"/>Sync planner</button><button v-if="canExportWorkspace||saveError" class="button quiet" @click="exportPlanner"><Download :size="14"/>Export JSON</button></div></div></template></template>
      <div v-if="error&&!['capture','dates','edit-event','relation','event-matches'].includes(modal)&&!(modal==='settings'&&!sourceAuthorized)" class="notice error-notice modal-error" role="alert"><AlertCircle :size="16"/><span>{{error}}</span><button class="icon-button" aria-label="Dismiss dialog error" @click="error='' "><X :size="13"/></button></div>
      </div>
    </section></div>
    <div v-if="toast" class="toast" role="status"><Check :size="16"/>{{toast}}</div>
  </div>
</template>
