import {restoreSourceStatuses,sourceReadLabel,syncPresentationState} from '@nextspace/core/cached-sources.mjs'
import {calendarViewportDays,visibleAllDayLayout,calendarAllDaySize} from '@nextspace/core/calendar-sizing.mjs'
import {normalizeWidgetConfig,projectWidget,validateWidgetIntent,widgetNavigation} from '@nextspace/core/widgets.mjs'
import {normalizeTaskLabel,taskCreationOptions} from '@nextspace/core/card-tasks.mjs'
import {linkedNavigation} from '@nextspace/core/linked-navigation.mjs'
import {dependencyGroups} from '@nextspace/core/dependency-groups.mjs'
import {calendarDateWindow,calendarLaneWindow} from '@nextspace/core/calendar-rendering.mjs'
import {sanitizeDiagnosticInput,createPerformanceDiagnostics} from '@nextspace/core/performance-diagnostics.mjs'
import {effectiveStatusMapping,setScopeStatusMapping,filterUnifiedStatuses} from '@nextspace/core/status-mapping.mjs'
import {organizationMembership,normalizeOrganizationTags} from '@nextspace/core/organization-tags.mjs'
import {visibleSpanLabel,timelinePointLabel,collapsedTimelineSpans} from '@nextspace/core/timeline-context.mjs'
import {plannerSyncStatus,plannerSyncReady} from '@nextspace/core/planner-sync-status.mjs'
import {orderTimelineRecords,reorderIds,boardTaskStacks,orderTimelineGroups,orderBoardRecords,boardHighlightState,buildLinkIndex,boardColumnDropAllowed} from '@nextspace/core/planning-order.mjs'
/** Test-only adapter for the language-neutral specification examples.
 * Dispatches real portable production functions; no UI, clock, network or I/O.
 * Consumers load the one JSON file and register every returned case locally.
 */
import assert from 'node:assert/strict'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {reconcileIdentities,projectNativeIdentities,promoteNativeIdentities} from '@nextspace/core/identity.mjs'
import {taskStatusProgress, nativeStatus} from '@nextspace/core/status-mapping.mjs'
import {isClosed, allRelations, canAddRelation, scopeRecordIds, boardColumns, boardCollectionsForScope, localDay, dayItems, filterCompletedWork} from '@nextspace/core/planner.mjs'
import {dependencyCandidates} from '@nextspace/core/relation-picker.mjs'
import {calendarContentEquivalent} from '@nextspace/nextcloud-client/calendar-representation.mjs'
import {normalizeEventDetails,normalizeEventReminders,linkedEventDescription,newEventDetails} from '@nextspace/core/event-details.mjs'
import {normalizeEventAttendees,normalizeEventParticipation,eventSchedulingAccess} from '@nextspace/core/event-scheduling.mjs'
import {deckDependencyProblem} from '@nextspace/core/deck-dependencies.mjs'
import {eventConflicts} from '@nextspace/core/scheduling.mjs'
import {normalizeColor, sourceColor, itemColor} from '@nextspace/core/record-presentation.mjs'
import {captureScopePreferences,parseScopePreferences,scopePreferencesFor} from '@nextspace/core/scope-preferences.mjs'
import {calendarPeriod,shiftCalendarAnchor} from '@nextspace/core/calendar-period.mjs'
import {timelineFloatingProjection,timelineFloatingPreview} from '@nextspace/core/timeline-presentation.mjs'
import {isDeviceViewPatch} from '@nextspace/core/view-updates.mjs'
import {buildScopeDraft} from '@nextspace/core/scope-editor.mjs'
import {mergeWorkspaces} from '@nextspace/core/workspace-merge.mjs'
import {canRefreshSources,sourceRefreshFeedback} from '@nextspace/core/source-refresh.mjs'
import {checkCalendarQuery} from '@nextspace/nextcloud-client/dav-query-policy.mjs'
import {canUseNativeOperation,canWriteNativeSource,completionOperation,eventDeleteOperation,eventEditOperation,eventRespondOperation,deckAttachmentOperation} from '@nextspace/core/native-operations.mjs'
import {shiftSchedulePreview} from '@nextspace/core/schedule-preview.mjs'
import {connectionEntry, isConnectionAuthorized} from '@nextspace/core/auth-entry.mjs'
import {normalizeTheme} from '@nextspace/core/theme-cache.mjs'
import {buildNoteContentUpdate} from '@nextspace/core/note-content-edit.mjs'
import {davDownloadReservation} from '@nextspace/nextcloud-client/dav-scan-policy.mjs'
import {reduceTouchGesture,touchTimelineZoom,touchHourZoom,touchPinchAxes,touchCalendarDateZoom} from '@nextspace/core/touch-gestures.mjs'
import {createDateCanvas,panDateCanvas,positionDateCanvas,dateCanvasAnchor,touchCoastStep} from '@nextspace/core/date-canvas.mjs'
import {syncDiagnostic} from '@nextspace/nextcloud-client/sync-diagnostics.mjs'
import {syncNotice,syncNoticePresentation} from '@nextspace/core/sync-notice.mjs'
import {normalizeSyncSettings,validateSyncSettings,dueSyncSources,sourceSyncStale} from '@nextspace/core/sync-policy.mjs'
import {sourceSelection,checkedResourceEntry} from '@nextspace/nextcloud-client/resource-cache-policy.mjs'
import {davProjectionWindow,davCheckpointCompatible,davInventoryCompatible} from '@nextspace/nextcloud-client/dav-checkpoint-policy.mjs'
import {boardStackLayout,boardStackWindow,boardAnchorAdjustment} from '@nextspace/core/board-window.mjs'

import {emptyViewPreferences,checkedViewPreferences,mergeViewPreferences} from '@nextspace/core/view-preferences.mjs'
import {unscheduledRecords} from '@nextspace/core/unscheduled.mjs'
import {restoreUnscheduledPresentation,changeUnscheduledPresentation,unscheduledTrayVisible,timelineRowRecords} from '@nextspace/core/unscheduled-presentation.mjs'
import {createRelationPickerIndex} from '@nextspace/core/relation-picker.mjs'
import {mergeDavDelta} from '@nextspace/nextcloud-client/dav-delta-policy.mjs'
import {isWeekendDateKey,normalizeWeekendMask,setWeekendDay} from '@nextspace/core/weekend-days.mjs'
import {boardCompletionVisible,normalizeBoardCompletedDays,normalizeCalendarHistoryDays,normalizeCalendarWindow} from '@nextspace/core/history.mjs'
const output = value => ({output: value})
const operations = new Map([
  ['identity.nativeCatalog',{fields:['promote'],run:(state,input)=>{const {records,workspace}=(input.promote?promoteNativeIdentities:projectNativeIdentities)(state.workspace,state.records,()=>{throw Error('Portable identities must not allocate a random ID')});return output({ids:records.map(record=>record.id),registered:workspace.identities.map(identity=>identity.id)})}}],
  ['history.boardDays',{fields:[],run:state=>output(normalizeBoardCompletedDays(state.value))}],
  ['history.boardRows',{fields:[],run:state=>output(state.records.filter(record=>boardCompletionVisible(record,state.days,Date.parse(state.now),state.showCancelled)).map(record=>record.id))}],
  ['history.calendarDays',{fields:[],run:state=>output(normalizeCalendarHistoryDays(state.value))}],
  ['history.window',{fields:[],run:state=>output(normalizeCalendarWindow(state.value))}],
  ['history.davWindow',{fields:[],run:state=>{const {from,to}=davProjectionWindow(Date.parse(state.now),state.options);return output({from:new Date(from).toISOString(),to:new Date(to).toISOString()})}}],
  ['weekend.normalize',{fields:[],run:state=>output(normalizeWeekendMask(state.mask))}],
  ['weekend.dateFlags',{fields:['dates'],run:(state,input)=>output(input.dates.map(date=>isWeekendDateKey(state.mask,date)))}],
  ['weekend.setDay',{fields:['day','enabled'],run:(state,input)=>output(setWeekendDay(state.mask,input.day,input.enabled))}],
  ['widget.rowGroups',{fields:[],run:state=>output(projectWidget(state.state,state.config,state.options).rows.map(row=>Object.fromEntries(['id','title','recordId','depth','parentId','direction','sectionCount'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]))))}],
  ['widget.gridGeometry',{fields:[],run:state=>{const grid=projectWidget(state.state,state.config,state.options).calendarGrid;return output(grid?{mode:grid.mode,days:grid.days.map(day=>day.date),hourStart:grid.hourStart,hourEnd:grid.hourEnd,timed:grid.timed.map(({recordId,dayIndex,startMinute,endMinute,lane,laneCount})=>({recordId,dayIndex,startMinute,endMinute,lane,laneCount})),allDay:grid.allDay.map(({recordId,startDay,endDay,lane})=>({recordId,startDay,endDay,lane})),allDayLanes:grid.allDayLanes}:null)}}],
  ['widget.navigation',{fields:['intent'],run:(state,input)=>output(widgetNavigation(validateWidgetIntent(input.intent,state.config,state.state,state.options)))}],
  ['widget.monthItinerary',{fields:['dates'],run:(state,input)=>{const {month}=projectWidget(state.state,state.config,state.options);return output(input.dates.map(date=>{const cell=month.cells.find(value=>value.date===date);return {date,count:cell.count,records:cell.itinerary.map(index=>month.itineraryRows[index].recordId)}}))}}],
  ['widget.presentation',{fields:['field'],run:(state,input)=>output(projectWidget(state.state,state.config,state.options)[input.field]??null)}],
  ['widget.rowLabels',{fields:[],run:state=>output(projectWidget(state.state,state.config,state.options).rows.map(row=>Object.fromEntries(['id','type','title','leadingLabel','secondaryLabel','trailingLabel','displayDay','sectionCount'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]))))}],
  ['widget.normalize',{fields:[],run:state=>output(normalizeWidgetConfig(state.config,state.options))}],
  ['widget.rows',{fields:[],run:state=>output(projectWidget(state.state,state.config,state.options).rows.filter(row=>row.type==='item').map(row=>row.recordId))}],
  ['widget.state',{fields:[],run:state=>output(projectWidget(state.state,state.config,state.options).state)}],
  ['preferences.sharedMerge',{fields:[],run:state=>output(mergeViewPreferences(state.base,state.local,state.remote))}],
  ['dav-sync-delta',{fields:[],run:state=>output(mergeDavDelta(state))}],
  ['preferences.sharedEmpty',{fields:[],run:()=>output(emptyViewPreferences())}],
  ['preferences.sharedValidate',{fields:[],run:state=>output(checkedViewPreferences(state))}],
  ['planning.unscheduled',{fields:[],run:state=>output(unscheduledRecords(state.records,state.plans,state.relations).map(record=>record.id))}],
  ['planning.unscheduledPresentation',{fields:['events'],run:(state,input)=>{const presentation=input.events.reduce(changeUnscheduledPresentation,restoreUnscheduledPresentation(state.saved,state.options));return output({state:presentation,visible:unscheduledTrayVisible(presentation,state.recordCount,state.disabled)})}}],
  ['planning.unscheduledRows',{fields:['hideUnscheduled'],run:(state,input)=>output(timelineRowRecords(state.records,new Set(unscheduledRecords(state.records,state.plans,state.relations).map(record=>record.id)),input.hideUnscheduled).map(record=>record.id))}],
  ['dependency.indexedEligibility',{fields:[],run:state=>output(createRelationPickerIndex(state.records,state.relations).eligibility(state.record,state.target,state.mode,state.direction))}],
  ['dependency.groups',{fields:[],run:state=>{const groups=dependencyGroups(state.recordId,state.records,state.relations);return output(Object.fromEntries(Object.entries(groups).map(([direction,links])=>[direction,links.map(link=>({id:link.id,recordId:link.record?.id??null}))])))}}],
  ['linked.navigation',{fields:[],run:state=>output(linkedNavigation(state))}],
  ['cardTasks.label',{fields:[],run:state=>output(normalizeTaskLabel(state.value))}],
  ['cardTasks.options',{fields:[],run:state=>output(taskCreationOptions(state))}],
  ['native.sourceWritable',{fields:[],run:state=>output(canWriteNativeSource(state))}],
  ['dav.inventoryCompatible',{fields:[],run:state=>output(davInventoryCompatible(state.checkpoint,state.calendar,state.selected))}],
  ['native.eventEditOperation',{fields:[],run:state=>output(eventEditOperation(state.record,state.collections))}],
  ['native.eventRespondOperation',{fields:[],run:state=>output(eventRespondOperation(state.record,state.collections))}],
  ['event.attendees',{fields:[],run:state=>output(normalizeEventAttendees(state))}],
  ['event.participation',{fields:[],run:state=>output(normalizeEventParticipation(state))}],
  ['event.access',{fields:[],run:state=>output(eventSchedulingAccess(state))}],
  ['board.completedVisibility',{fields:[],run:state=>output(filterCompletedWork(state.records,state.relations,state.view,state.showCompleted).map(record=>record.id))}],
  ['dependency.candidates',{fields:[],run:state=>output(dependencyCandidates(state.workspace,state.records,state.scopeId).map(record=>record.id))}],
  ['calendar.contentEquivalent',{fields:[],run:state=>output(calendarContentEquivalent(state.left,state.right))}],
  ['event.details',{fields:[],run:state=>output(normalizeEventDetails(state.input,state.options))}],
  ['event.reminders',{fields:[],run:state=>output(normalizeEventReminders(state))}],
  ['event.linkedDescription',{fields:[],run:state=>output(linkedEventDescription(state))}],
  ['event.newDetails',{fields:[],run:state=>output(newEventDetails(state))}],
  ['preferences.page',{fields:[],run:state=>output(scopePreferencesFor(parseScopePreferences(JSON.stringify(state.store)),state.scopeId,state.legacyPlanner,state.view))}],
  ['board.renderWindow',{fields:[],run:state=>{const layout=boardStackLayout(state.ids,state.heights,state.estimate,state.gap);return output({ids:boardStackWindow(layout,state.viewport).map(item=>item.id),totalHeight:layout.totalHeight})}}],
  ['board.anchorAdjustment',{fields:[],run:state=>output(boardAnchorAdjustment(boardStackLayout(state.before.ids,state.before.heights,state.before.estimate,state.before.gap),boardStackLayout(state.after.ids,state.after.heights,state.after.estimate,state.after.gap),state.top))}],
  ['dav.projectionWindow',{fields:[],run:state=>{const value=davProjectionWindow(Date.parse(state.instant));return output({from:new Date(value.from).toISOString(),to:new Date(value.to).toISOString()})}}],
  ['dav.checkpointCompatible',{fields:[],run:state=>output(davCheckpointCompatible(state.checkpoint,state.calendar,state.window,state.sources))}],
  ['diagnostics.sanitize',{fields:[],run:state=>output(sanitizeDiagnosticInput(state))}],
  ['diagnostics.session',{fields:['events','elapsed'],run:(state,input)=>{let clock=0;const recorder=createPerformanceDiagnostics({...state,now:()=>clock});recorder.start();for(const entry of input.events){clock=entry.atMs;recorder.record(entry.event)}clock=input.elapsed;recorder.stop();return output(JSON.parse(recorder.read()))}}],
  ['diagnostics.forwarded',{fields:['events','elapsed'],run:(state,input)=>{let clock=0;const recorder=createPerformanceDiagnostics({...state,now:()=>clock});recorder.start();for(const entry of input.events){clock=entry.arrivalMs;recorder.recordAt(entry.event,entry.relativeMs)}clock=input.elapsed;recorder.stop();return output(JSON.parse(recorder.read()))}}],
  ['diagnostics.transportDrops',{fields:['counts','afterStop'],run:(state,input)=>{const recorder=createPerformanceDiagnostics({...state,now:()=>0});recorder.start();for(const count of input.counts)recorder.recordDropped(count);recorder.stop();for(const count of input.afterStop)recorder.recordDropped(count);return output(recorder.summary())}}],
  ['calendar.visibleDays',{fields:[],run:state=>output(calendarViewportDays(state))}],
  ['calendar.dateWindow',{fields:[],run:state=>output(calendarDateWindow(state))}],
  ['calendar.laneWindow',{fields:[],run:state=>output(calendarLaneWindow(state))}],
  ['calendar.allDaySize',{fields:[],run:state=>output(calendarAllDaySize(state))}],
  ['calendar.visibleAllDay',{fields:['first','last'],run:(state,input)=>output(visibleAllDayLayout(state,input.first,input.last))}],
  ['status.effective',{fields:['scopeId','collections'],run:(state,input)=>output(effectiveStatusMapping(state,input.scopeId,input.collections))}],
  ['status.setScope',{fields:['scopeId','mapping'],run:(state,input)=>output(setScopeStatusMapping(state,input.scopeId,input.mapping))}],
  ['status.filter',{fields:['statusIds'],run:(state,input)=>output(filterUnifiedStatuses(state.records,state.mapping,input.statusIds).map(record=>record.id))}],
  ['organization.tags',{fields:[],run:state=>output(normalizeOrganizationTags(state))}],
  ['organization.membership',{fields:[],run:state=>{const result=organizationMembership(state.workspace,state.records);return output({projects:Object.fromEntries([...result.projects].map(([id,ids])=>[id,[...ids]])),categories:Object.fromEntries([...result.categories].map(([id,ids])=>[id,[...ids]]))})}}],
  ['sync.plannerReady',{fields:[],run:state=>output(plannerSyncReady(state))}],
  ['timeline.spanLabel',{fields:[],run:state=>output(visibleSpanLabel(state))}],
  ['timeline.pointLabel',{fields:[],run:state=>output(timelinePointLabel(state))}],
  ['timeline.collapsedSpans',{fields:['anchor','daysCount'],run:(state,input)=>{const value=collapsedTimelineSpans(state,input.anchor,input.daysCount);return output({spans:value.spans.map(({record,...span})=>({id:record.id,...span})),lanes:value.lanes})}}],
  ['sync.plannerStatus',{fields:[],run:state=>output(plannerSyncStatus(state))}],
  ['order.timeline',{fields:[],run:state=>output(orderTimelineRecords(state.records,state.relations,state.order).map(record=>record.id))}],
  ['board.highlights',{fields:['activeIds'],run:(state,input)=>{const value=boardHighlightState(buildLinkIndex(state.relations),input.activeIds);return output({primary:[...value.primary],linked:[...value.linked]})}}],
  ['board.columnDrop',{fields:['mode','currentColumnId','columnId','canMove','statusTargetCount'],run:(_state,input)=>output(boardColumnDropAllowed(input))}],
  ['order.board',{fields:[],run:state=>output(orderBoardRecords(state.records,state.order).map(record=>record.id))}],
  ['order.move',{fields:['id','target','placement'],run:(state,input)=>output(reorderIds(state.saved,state.visible,input.id,input.target,input.placement))}],
  ['order.groups',{fields:[],run:state=>output(orderTimelineGroups(state.groups,state.order).map(group=>({id:group.id,children:(group.children||[]).map(child=>child.id)})))}],
  ['board.taskStacks',{fields:[],run:state=>{const value=boardTaskStacks(state.records,state.relations);return output({parents:value.parentByTask,stacks:Object.fromEntries(Object.entries(value.byCard).map(([id,stack])=>[id,{incoming:stack.incoming.map(record=>record.id),outgoing:stack.outgoing.map(record=>record.id)}]))})}}],
  ['board.columns', {fields: ['options'], run: (state,input) => output(boardColumns(state.records,state.collections,input.options).map(column=>({id:column.id,title:column.title,count:column.records.length})))}],
  ['board.collections', {fields: ['scopeId'], run: (state,input) => output(boardCollectionsForScope(state.workspace,state.records,state.collections,input.scopeId).map(collection=>collection.id))}],
  ['sync.restoreStatuses', {fields:[], run:state=>output(restoreSourceStatuses(state.statuses,state.records))}],
  ['sync.sourceLabel', {fields:[], run:state=>output(sourceReadLabel(state))}],
  ['sync.presentation', {fields:[], run:state=>output(syncPresentationState(state))}],
  ['sync.settings', {fields: [], run: state => output(normalizeSyncSettings(state))}],
  ['sync.validateSettings', {fields: [], run: state => output(validateSyncSettings(state))}],
  ['sync.due', {fields: ['now','includeOthers'], optionalFields: ['independentAccessSources'], run: (state,input) => output(dueSyncSources(state.settings,state.statuses,state.lastAttempts,input.now,{includeOthers:input.includeOthers,independentAccessSources:input.independentAccessSources}))}],
  ['sync.stale', {fields: ['now'], run: (state,input) => output(sourceSyncStale(state.statuses,state.settings,input.now))}],
  ['sources.select', {fields: [], run: state => output(sourceSelection(state))}],
  ['sources.cachedResource', {fields: ['locator','serverUrl'], run: (state,input) => output(checkedResourceEntry(state,input.locator,input.serverUrl))}],
  ['timeline.floatingPreview', {fields: ['viewport'], run: (state,input) => output(timelineFloatingPreview(state,input.viewport))}],
  ['view.localPatch', {fields: ['patch'], run: (_state,input) => output(isDeviceViewPatch(input.patch))}],
  ['timeline.floating', {fields: ['viewport'], run: (state,input) => output(timelineFloatingProjection(state,input.viewport))}],
  ['calendar.period', {fields: ['anchor','mode'], run: (_state,input) => output(calendarPeriod(input.anchor,input.mode))}],
  ['calendar.navigate', {fields: ['anchor','mode','amount'], run: (_state,input) => output(shiftCalendarAnchor(input.anchor,input.mode,input.amount))}],
  ['scope.editorDraft', {fields: ['options'], run: (state,input) => output(buildScopeDraft(state,input.options))}],
  ['touch.transition', {fields: ['event'], run: (state,input) => {const result=reduceTouchGesture(state,input.event);return {nextState:result.state,output:result.effects}}}],
  ['touch.timelineZoom', {fields: [], run: state => output(touchTimelineZoom(state))}],
  ['touch.hourZoom', {fields: [], run: state => output(touchHourZoom(state))}],
  ['touch.calendarDateZoom', {fields: [], run: state => output(touchCalendarDateZoom(state))}],
  ['touch.pinchAxes', {fields: ['current'], run: (state,input) => output(touchPinchAxes(state.start,input.current,state.active))}],
  ['canvas.create', {fields: [], run: state => output(createDateCanvas(state))}],
  ['canvas.position', {fields: ['offset'], run: (state,input) => output(positionDateCanvas(state,input.offset))}],
  ['canvas.pan', {fields: ['delta'], run: (state,input) => {const nextState=panDateCanvas(state,input.delta);return {nextState,output:dateCanvasAnchor(nextState)}}}],
  ['touch.coast', {fields: [], run: state => output(touchCoastStep(state))}],
  ['sync.diagnostic', {fields: ['stage'], run: (state,input) => output(syncDiagnostic(state,input.stage))}],
  ['sync.notice', {fields: [], run: state => output(syncNotice(state))}],
  ['sync.noticePresentation', {fields: [], run: state => output(syncNoticePresentation(syncNotice(state)))}],
  ['dav.reserveDownload', {fields: ['resourceBytes'], run: (state,input) => output(davDownloadReservation(state,input.resourceBytes))}],
  ['note.contentUpdate', {fields: ['draft'], run: (state,input) => output(buildNoteContentUpdate(input.draft,state))}],
  ['theme.normalize', {fields: [], run: state => output(normalizeTheme(state))}],
  ['auth.entry', {fields: [], run: state => output(connectionEntry(state))}],
  ['auth.authorized', {fields: [], run: state => output(isConnectionAuthorized(state))}],
  ['native.operationAllowed', {fields: ['method'], run: (state,input) => output(canUseNativeOperation({...state, operation:input.method}))}],
  ['native.completionOperation', {fields: [], run: state => output(completionOperation(state.record,state.collections))}],
  ['native.eventDeleteOperation', {fields: [], run: state => output(eventDeleteOperation(state.record,state.collections))}],
  ['native.deckAttachmentOperation', {fields: ['method'], run: (state,input) => output(deckAttachmentOperation(state.record,state.collections,input.method))}],
  ['schedule.shiftPreview', {fields: ['mode','deltaDays'], run: (state,input) => {
    // This synchronous adapter supplies the fixture's local time zone to the
    // actual local-calendar implementation; it does not calculate expectations.
    const previous=process.env.TZ
    try {if(state.timeZone)process.env.TZ=state.timeZone;return output(shiftSchedulePreview(state.anchor,state.slot,input.mode,input.deltaDays))}
    finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
  }}],
  ['dav.checkQuery', {fields: ['headers', 'body'], run: (_state,input) => {checkCalendarQuery(input.headers,input.body);return output(true)}}],
  ['sources.refreshAllowed', {fields: ['options'], run: (state,input) => output(canRefreshSources(state,input.options))}],
  ['sources.feedback', {fields: [], run: state => output(sourceRefreshFeedback(state))}],
  ['workspace.validate', {fields: [], run: state => output(validateWorkspace(state))}],
  ['identity.reconcile', {fields: ['records', 'newIds'], run: (state, input) => {
    let cursor = 0
    const result = reconcileIdentities(state, input.records, () => {
      assert.ok(cursor < input.newIds.length, 'Identity vector exhausted its explicit newIds')
      return input.newIds[cursor++]
    })
    assert.equal(cursor, input.newIds.length, 'Identity vector contains unused explicit newIds')
    return {nextState: result.workspace, output: {records: result.records, remap: [...result.remap]}}
  }}],
  ['task.progress', {fields: ['status'], run: (state, input) => output(taskStatusProgress(input.status, state.percentComplete))}],
  ['status.native', {fields: [], run: state => output(nativeStatus(state))}],
  ['record.closed', {fields: [], run: state => output(isClosed(state))}],
  ['relations.native', {fields: [], run: state => output(allRelations(state.workspace, state.records))}],
  ['relation.check', {fields: ['fromId', 'toId', 'type'], run: (state, input) => output(canAddRelation(state.relations, input.fromId, input.toId, input.type, state.records))}],
  ['deck.dependencyProblem', {fields: ['edge', 'available'], run: (state, input) => output(deckDependencyProblem(state, input.edge, input.available))}],
  ['scope.recordIds', {fields: ['scopeId'], run: (state, input) => output([...scopeRecordIds(state.workspace, state.records, input.scopeId)])}],
  ['date.localDay', {fields: ['value'], run: (_state, input) => output(localDay(input.value))}],
  ['date.dayItems', {fields: ['date'], run: (state, input) => output(dayItems(state, input.date))}],
  ['calendar.conflicts', {fields: ['slot'], run: (state, input) => output(eventConflicts(input.slot, state))}],
  ['color.normalize', {fields: ['value'], run: (_state, input) => output(normalizeColor(input.value))}],
  ['presentation.colors', {fields: ['fallback'], run: (state, input) => output({source: sourceColor(state.record, state.collections, input.fallback), item: itemColor(state.record, state.collections, input.fallback)})}],
  ['scope.capturePreferences', {fields: ['extra'], run: (state, input) => output(captureScopePreferences(state, input.extra))}],
  ['workspace.merge', {fields: ['remote'], run: (state, input) => {
    const result = mergeWorkspaces(state.base, state.local, input.remote)
    return {nextState: result.workspace, output: {conflicts: result.conflicts}}
  }}],
])

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const own = (value, key) => Object.hasOwn(value, key)
const nonempty = value => typeof value === 'string' && value.trim().length > 0
function fields(value, allowed, context) {
  assert.ok(plain(value), `${context} must be an object`)
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${context} contains unsupported field ${key}`)
}
function json(value, context) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') { assert.ok(Number.isFinite(value), `${context} must contain finite JSON numbers`); return }
  assert.ok(Array.isArray(value) || plain(value), `${context} must contain only JSON values`)
  for (const child of Object.values(value)) json(child, context)
}

function validateCase(vector) {
  fields(vector, ['id', 'behavior', 'specRef', 'initialState', 'input', 'expected', 'notes'], 'Vector')
  for (const key of ['id', 'behavior', 'specRef']) assert.ok(nonempty(vector[key]), `Vector needs ${key}`)
  assert.ok(own(vector, 'initialState'), `${vector.id} needs initialState`)
  if (own(vector, 'notes')) assert.ok(nonempty(vector.notes), `${vector.id} notes must be text`)
  assert.ok(plain(vector.input) && nonempty(vector.input.operation), `${vector.id} needs input.operation`)
  const operation = operations.get(vector.input.operation)
  assert.ok(operation, `${vector.id} has unknown operation ${vector.input.operation}`)
  fields(vector.input, ['operation', ...operation.fields, ...(operation.optionalFields || [])], `${vector.id} input`)
  for (const key of operation.fields) assert.ok(own(vector.input, key), `${vector.id} input needs ${key}`)
  fields(vector.expected, ['output', 'nextState', 'error'], `${vector.id} expected`)
  const hasError = own(vector.expected, 'error')
  assert.ok(hasError ? !own(vector.expected, 'output') && !own(vector.expected, 'nextState') : own(vector.expected, 'output') || own(vector.expected, 'nextState'), `${vector.id} must expect output/state or an exclusive error`)
  if (hasError) {
    fields(vector.expected.error, ['messageIncludes', 'code'], `${vector.id} error`)
    assert.ok(Object.keys(vector.expected.error).length > 0, `${vector.id} needs a concrete error assertion`)
    for (const value of Object.values(vector.expected.error)) assert.ok(nonempty(value), `${vector.id} error assertions must be nonempty text`)
  }
  json(vector, vector.id)
  if (vector.input.operation === 'identity.reconcile') {
    assert.ok(Array.isArray(vector.input.records), `${vector.id} needs records`)
    assert.ok(Array.isArray(vector.input.newIds) && vector.input.newIds.every(nonempty), `${vector.id} needs explicit newIds`)
  }
}

/** Reject malformed/empty/duplicate/unknown/skippable examples before dispatch. */
export function validateTestVectors(document) {
  fields(document, ['format', 'version', 'cases'], 'Vector document')
  assert.equal(document.format, 'nextspace-test-vectors', 'Unsupported vector format')
  assert.equal(document.version, 1, 'Unsupported vector version')
  assert.ok(Array.isArray(document.cases) && document.cases.length > 0, 'Vector document must contain cases')
  const ids = new Set()
  for (const vector of document.cases) {
    validateCase(vector)
    assert.ok(!ids.has(vector.id), `Duplicate vector ID ${vector.id}`)
    ids.add(vector.id)
  }
  return document.cases
}

/** Execute against cloned input so a production mutation cannot rewrite fixtures. */
export function executeSpecVector(vector) {
  validateCase(vector)
  const state = structuredClone(vector.initialState), input = structuredClone(vector.input)
  return operations.get(input.operation).run(state, input)
}

export function assertSpecVector(vector) {
  validateCase(vector)
  if (own(vector.expected, 'error')) {
    let caught
    try { executeSpecVector(vector) } catch (error) { caught = error }
    assert.ok(caught instanceof Error, `${vector.id} must fail with its specified error`)
    if (own(vector.expected.error, 'messageIncludes')) assert.ok(caught.message.includes(vector.expected.error.messageIncludes), `${vector.id}: unexpected error ${caught.message}`)
    if (own(vector.expected.error, 'code')) assert.equal(caught.code, vector.expected.error.code, `${vector.id}: error code`)
    return
  }
  const actual = executeSpecVector(vector)
  for (const key of Object.keys(vector.expected)) {
    assert.ok(own(actual, key), `${vector.id}: adapter did not return ${key}`)
    assert.deepEqual(actual[key], vector.expected[key], `${vector.id}: ${key}`)
  }
}
