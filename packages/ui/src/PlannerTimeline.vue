<script setup lang="ts">
import UnscheduledTray from './UnscheduledTray.vue'
import {unscheduledRecords} from '@nextspace/core/unscheduled.mjs'
import {timelineRowRecords} from '@nextspace/core/unscheduled-presentation.mjs'
import RecordTagMarkers from './RecordTagMarkers.vue'
import TimelineLegend from './TimelineLegend.vue'
import TimelineFloatingEvents from './TimelineFloatingEvents.vue'
import {sourceColor, recordTags} from '@nextspace/core/record-presentation.mjs'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ArrowRight, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, Circle, Diamond, Folder, FolderKanban, Link2, Minus, Plus, RotateCcw, PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'
import type { Category, Collection, OverviewAxis, PlanSession, Project, RecordTag, Relation, ScopeArrangement, Space, StatusMapping, WorkspaceRecord } from '@nextspace/contracts'
import {unifiedStatus} from '@nextspace/core/status-mapping.mjs'
import { clockTime, dateValue, dayKey, eventLabel, isOverdue, shortDate, sourceLabels } from './planner-ui'
import { recordGrouping, timelineEvents, timelineGeometry, timelineGroups, timelineInterval, timelineOffset, timelineStatus } from '@nextspace/core/timeline.mjs'
import type { TimelineEvent, TimelineGroup, TimelineInterval } from '@nextspace/core/timeline.mjs'
import { timelineDateEdit, timelinePlanEdit, zoomTimelineRange } from '@nextspace/core/timeline-edit.mjs'
import type { TimelineDateEdit } from '@nextspace/core/timeline-edit.mjs'
import { canAddRelation } from '@nextspace/core/planner.mjs'
import { timelineLinkPath } from '@nextspace/core/timeline-link.mjs'
import { horizontalWheelDelta } from '@nextspace/core/date-wheel.mjs'
import { creationSelection, type CreationRange, type CreationSelection } from '@nextspace/core/range-selection.mjs'
import {touchTimelineZoom} from '@nextspace/core/touch-gestures.mjs'
import {usePlannerTouch} from './usePlannerTouch'
import {useDateCanvas} from './useDateCanvas'
import {orderTimelineRecords,orderTimelineGroups,reorderIds} from '@nextspace/core/planning-order.mjs'
import {useListReorder,type ListReorderIntent} from './useListReorder'
import {collapsedTimelineSpans,type CollapsedTimelineSpan} from '@nextspace/core/timeline-context.mjs'
import {usePinnedItemLabels} from './usePinnedItemLabels'
import {useDateLabels} from './useDateLabels'

const props = withDefaults(defineProps<{
  preferenceKey?:string;persistPresentation?:boolean;contextRecordIds?:string[];records:WorkspaceRecord[]; relations:Relation[]; plans:PlanSession[]; anchor:Date
  selectedId?:string|null; hoveredId?:string|null; highlightedIds?:string[]; colorFor:(record:WorkspaceRecord)=>string; sourceColorFor?:(record:WorkspaceRecord)=>string; tagsFor?:(record:WorkspaceRecord)=>RecordTag[]
  spaces?:Space[]; categories?:Category[]; projects?:Project[]; collections?:Collection[]; scopeId?:string; daysCount?:number; focused?:boolean; taskOnly?:boolean
  axis?:OverviewAxis; activeDay?:string; canCreateEvent?:boolean;minimumDayWidth?:number
  allCalendarBands?:boolean;floatingEvents?:boolean;compactControls?:boolean
  arrangement?:ScopeArrangement;canReorder?:boolean;listCollapsed?:boolean;statusMapping?:StatusMapping
  canEditRecord?:(record:WorkspaceRecord)=>boolean;canEditPlans?:boolean;canLink?:boolean;canLinkRecords?:(fromId:string,toId:string)=>boolean;saving?:boolean
}>(), {spaces:()=>[],categories:()=>[],projects:()=>[],collections:()=>[],highlightedIds:()=>[],scopeId:'all',daysCount:14,focused:true,taskOnly:false,canCreateEvent:false,canEditPlans:false,canLink:false,saving:false,minimumDayWidth:12,allCalendarBands:undefined,floatingEvents:false,compactControls:false})
const unscheduledTray=ref<InstanceType<typeof UnscheduledTray>>()
const inlineUnscheduled=ref(true)
const unscheduledItems=computed(()=>unscheduledRecords(props.records,props.plans,props.relations))
const unscheduledIds=computed(()=>new Set(unscheduledItems.value.map(record=>record.id)))
const rowRecords=computed(()=>timelineRowRecords(props.records,unscheduledIds.value,!props.axis&&!inlineUnscheduled.value))
const contextIds=computed(()=>new Set(props.contextRecordIds||[]))
const sourceTint=(record:WorkspaceRecord)=>props.sourceColorFor?.(record)||sourceColor(record,props.collections,props.colorFor(record))
const tagsByRecord=computed(()=>new WeakMap(props.records.filter(record=>['card','task','event'].includes(record.kind)).map(record=>[record,props.tagsFor?.(record)||recordTags(record)] as const)))
const itemTags=(record:WorkspaceRecord)=>tagsByRecord.value.get(record)||props.tagsFor?.(record)||recordTags(record)
const tagDescription=(record:WorkspaceRecord)=>{const tags=itemTags(record);return tags.length?` · Tags: ${tags.map(tag=>tag.title).join(', ')}`:''}
const emit = defineEmits<{open:[record:WorkspaceRecord];hover:[id:string|null];horizontalScroll:[left:number];datePan:[delta:number];touchRangeChange:[range:{anchor:string;days:number;scrollLeft:number}];scrollbarWidth:[width:number];createEvent:[range:CreationRange];dateEdit:[edit:TimelineDateEdit];planEdit:[edit:{id:string;start:string;end:string}];link:[link:{fromId:string;toId:string}];rangeChange:[range:{anchor:string;days:number}];'update:allCalendarBands':[value:boolean];reorder:[intent:{kind:'timelineRows'|'timelineGroups';ids:string[]}];resetOrder:[];'update:listCollapsed':[value:boolean]}>()
const collapsed = ref(new Set<string>()), limit = ref(180)
const localAllBands = ref(!props.focused), agendaDay = ref('')
const allBands=computed({get:()=>props.allCalendarBands??localAllBands.value,set:value=>{localAllBands.value=value;emit('update:allCalendarBands',value)}})
const floatingMode=computed(()=>props.floatingEvents&&!props.taskOnly&&!props.axis)
const floatingIds=ref(new Set<string>())
const plot = ref<HTMLElement>(), plotWidth = ref(840), eventPicker = ref<HTMLDetailsElement>(), scroller = ref<HTMLElement>()
const viewportWidth=ref(1200),ownLabelWidth=ref(470)
const coarsePointer=ref(false)
const denseRows=computed(()=>props.compactControls||coarsePointer.value||viewportWidth.value<=1100)
const rowHeight=computed(()=>denseRows.value?40:44)
const rowCenter=computed(()=>rowHeight.value/2)
const surfaceStyle=computed(()=>({'--row-height':`${rowHeight.value}px`,'--row-center':`${rowCenter.value}px`,'--header-height':`${rowHeight.value+4}px`,...(props.listCollapsed?{'--list-width':'40px'}:props.axis?{'--list-width':`${props.axis.labelWidth}px`}:{})}))
const labelWidth=computed(()=>props.listCollapsed?40:props.axis?.labelWidth||ownLabelWidth.value)
const pinnedLabels=usePinnedItemLabels(()=>[{viewport:scroller.value,selector:'.timeline-bar:has(.timeline-bar-title),.timeline-deadline:has(.timeline-point-title)',points:'.timeline-deadline',gutter:labelWidth.value}])
const visibleDayCount=computed(()=>Math.max(1,Math.min(90,Math.round(props.daysCount||14))))
const ownDayWidth=computed(()=>Math.max(props.minimumDayWidth,(viewportWidth.value-labelWidth.value)/visibleDayCount.value))
const canvas=useDateCanvas(()=>({anchor:dayKey(props.anchor),visibleDays:visibleDayCount.value,dayWidth:ownDayWidth.value,scope:props.scopeId}),anchor=>{if(!props.axis)emit('rangeChange',{anchor,days:visibleDayCount.value})})
const renderAnchor=computed(()=>props.axis?.renderAnchor||canvas.anchor.value)
const eventPickerOpen=ref(false)
const pointerRecordId=ref<string|null>(null),focusRecordId=ref<string|null>(null)
const hoveredRecordId=computed(()=>props.hoveredId===undefined?pointerRecordId.value||focusRecordId.value:props.hoveredId)
function setHover(kind:'pointer'|'focus',id:string|null){
  if(kind==='pointer')pointerRecordId.value=id
  else focusRecordId.value=id
  emit('hover',pointerRecordId.value||focusRecordId.value)
}
function hoverBindings(id:string){return {pointerenter:()=>setHover('pointer',id),pointerleave:()=>setHover('pointer',null),focusin:()=>setHover('focus',id),focusout:()=>setHover('focus',null)}}
function zoomTimeline(event:WheelEvent){
  const container=scroller.value,chart=plot.value
  if(props.axis||!container||!chart)return
  event.preventDefault()
  const delta=(event.deltaY||event.deltaX)*(event.deltaMode===1?16:event.deltaMode===2?container.clientHeight:1)
  if(!delta)return
  const labelWidth=container.querySelector<HTMLElement>('.timeline-head-name')?.offsetWidth||0
  const available=Math.max(1,container.clientWidth-labelWidth),pointerX=Math.max(0,Math.min(available,event.clientX-container.getBoundingClientRect().left-labelWidth))
  const pointerDay=(container.scrollLeft+pointerX)/(chart.getBoundingClientRect().width/dayCount.value)
  const nextDays=zoomTimelineRange(dateValue(renderAnchor.value),visibleDayCount.value,delta).days,nextWidth=Math.max(12,available/nextDays)
  emit('rangeChange',zoomTimelineRange(dateValue(renderAnchor.value),visibleDayCount.value,delta,pointerX/(nextWidth*nextDays),pointerDay))
}
let observer:ResizeObserver|undefined,dayTimer:ReturnType<typeof setInterval>|undefined,pointerQuery:MediaQueryList|undefined
function pointerDensity(){coarsePointer.value=pointerQuery?.matches===true}
function measureListWidth(){
  if(!scroller.value)return
  viewportWidth.value=scroller.value.clientWidth
  if(props.listCollapsed)return
  const configured=Number.parseFloat(getComputedStyle(scroller.value.closest('section')!).getPropertyValue('--list-width'))||470
  ownLabelWidth.value=Math.min(configured,viewportWidth.value<600?Math.min(180,viewportWidth.value*.55):viewportWidth.value*.55)
}
const todayKey=ref(dayKey(new Date()))
let lastScrollbarWidth=-1
function reportScrollbarWidth(){
  if(!props.axis||!scroller.value)return
  const width=scroller.value.offsetWidth-scroller.value.clientWidth
  if(width!==lastScrollbarWidth){lastScrollbarWidth=width;emit('scrollbarWidth',width)}
}
function syncHorizontalScroll(){
  if(!scroller.value)return
  const left=Math.max(0,Math.min(props.axis?.scrollLeft??canvas.scrollLeft.value,scroller.value.scrollWidth-scroller.value.clientWidth))
  if(Math.abs(scroller.value.scrollLeft-left)>.5)scroller.value.scrollLeft=left
}
function horizontalScroll(){pinnedLabels.update();cancelCreation();if(!scroller.value)return;if(props.axis)emit('horizontalScroll',scroller.value.scrollLeft);else if(Math.abs(scroller.value.scrollLeft-canvas.scrollLeft.value)>.75)canvas.setScroll(scroller.value.scrollLeft)}
function horizontalWheel(event:WheelEvent){
  touch.stopCoast();cancelCreation()
  if(event.ctrlKey){if(!props.axis)void zoomTimeline(event);return}
  if(props.axis||!scroller.value)return
  const delta=horizontalWheelDelta(event,scroller.value.clientWidth)
  if(!delta)return
  event.preventDefault();event.stopPropagation()
  canvas.pan(delta)
}
watch(()=>[canvas.scrollLeft.value,canvas.anchor.value,ownDayWidth.value],()=>nextTick(syncHorizontalScroll),{flush:'post'})
onMounted(()=>{
  pointerQuery=window.matchMedia('(pointer:coarse)');pointerDensity();pointerQuery.addEventListener('change',pointerDensity)
  dayTimer=setInterval(()=>{todayKey.value=dayKey(new Date())},60000)
  observer=new ResizeObserver(entries=>{
    for(const entry of entries)if(entry.target===plot.value)plotWidth.value=entry.contentRect.width||840
    measureListWidth()
    reportScrollbarWidth();syncHorizontalScroll();pinnedLabels.invalidate()
  })
  if(plot.value)observer.observe(plot.value)
  if(scroller.value)observer.observe(scroller.value)
  reportScrollbarWidth();syncHorizontalScroll()
})
onBeforeUnmount(()=>{observer?.disconnect();pointerQuery?.removeEventListener('change',pointerDensity);clearInterval(dayTimer);cancelDrag();cancelCreation();document.removeEventListener('keydown',dragKeydown)})
watch(()=>[props.axis?.scrollLeft,props.axis?.labelWidth,props.axis?.dayWidth,props.daysCount],()=>{syncHorizontalScroll();reportScrollbarWidth()},{flush:'post'})
watch(()=>props.scopeId,()=>{limit.value=180;agendaDay.value='';if(eventPicker.value)eventPicker.value.open=false})
watch(()=>props.focused,value=>{if(props.allCalendarBands===undefined)localAllBands.value=!value;limit.value=180})
const dayCount = computed(()=>props.axis?.renderDays||canvas.renderDays.value)
const days = computed(()=>Array.from({length:dayCount.value},(_,i)=>{const d=dateValue(renderAnchor.value);d.setDate(d.getDate()+i);d.setHours(0,0,0,0);return d}))
const dateLabels=useDateLabels(()=>days.value)
const formattedDates=computed(()=>{
  todayKey.value
  const labels=new Map<string,string>()
  const add=(value?:string)=>{if(value&&!labels.has(value))labels.set(value,shortDate(value))}
  for(const record of props.records){add(record.start);add(record.due);add(record.end)}
  for(const plan of props.plans){add(plan.start);add(plan.end)}
  for(const day of days.value)add(dayKey(day))
  return labels
})
function dateLabel(value?:string){return value?formattedDates.value.get(value)||shortDate(value):'No date'}
const overdueIds=computed(()=>{todayKey.value;return new Set(props.records.filter(isOverdue).map(record=>record.id))})
const overdue=(record:WorkspaceRecord)=>overdueIds.value.has(record.id)
const gridStyle = computed(()=>({
  '--day-count':dayCount.value,'--chart-min':`${dayCount.value*(props.axis?.dayWidth||ownDayWidth.value)}px`,'--event-header-height':`${calendarHeaderHeight.value}px`,
  width:`${labelWidth.value+dayCount.value*(props.axis?.dayWidth||ownDayWidth.value)}px`,minWidth:`${labelWidth.value+dayCount.value*(props.axis?.dayWidth||ownDayWidth.value)}px`,gridTemplateColumns:`${labelWidth.value}px ${dayCount.value*(props.axis?.dayWidth||ownDayWidth.value)}px`
}))
// Geometry belongs to data/range changes, not pointer or selection changes.
// A drag preview is a separate object and deliberately bypasses this cache.
const geometryByRecord=computed(()=>new WeakMap(props.records.map(record=>[record,timelineGeometry(record,days.value[0]!,dayCount.value)] as const)))
const geometry = (record:WorkspaceRecord)=>geometryByRecord.value.get(record)||timelineGeometry(record,days.value[0]!,dayCount.value)
const rangesByPlan=computed(()=>new WeakMap(props.plans.map(plan=>[plan,timelineInterval(plan.start,plan.end,days.value[0]!,dayCount.value)] as const)))
const sessionRange = (plan:PlanSession)=>rangesByPlan.value.has(plan)?rangesByPlan.value.get(plan)!:timelineInterval(plan.start,plan.end,days.value[0]!,dayCount.value)
const sessions = computed(()=>{const map=new Map<string,PlanSession[]>();for(const plan of props.plans){const values=map.get(plan.recordId)||[];values.push(plan);map.set(plan.recordId,values)}return map})
const eventLayout = computed(()=>timelineEvents(props.records,days.value[0]!,dayCount.value,plotWidth.value))
const visibleEvents = computed(()=>eventLayout.value.entries)
const headerEvents = computed(()=>visibleEvents.value.filter(event=>!event.overflow))
const floatingEntries=computed(()=>headerEvents.value.map(event=>({id:event.record.id,start:event.range.start,end:event.range.end,left:event.labelLeft,width:event.labelWidth,lane:event.lane,overflow:event.overflow})))
const calendarHeaderHeight = computed(()=>allBands.value?eventLayout.value.lanes*32+10:58)
const outsideEventCount = computed(()=>props.records.filter(record=>record.kind==='event').length-visibleEvents.value.length)
const groupingOptions = computed(()=>({spaces:props.spaces,categories:props.categories,projects:props.projects,collections:props.collections,scopeId:props.scopeId}))
const groups = computed(()=>orderTimelineGroups(timelineGroups(rowRecords.value,groupingOptions.value),props.arrangement?.timelineGroups))
const eventById = computed(()=>new Map(visibleEvents.value.map(event=>[event.record.id,event])))
const linkedSessions = computed(()=>{
  const map=new Map<string,TimelineEvent[]>()
  for(const relation of props.relations){
    if(relation.type!=='scheduled_during')continue
    const event=eventById.value.get(relation.toId)
    if(!event)continue
    const values=map.get(relation.fromId)||[]
    if(!values.some(value=>value.record.id===event.record.id))values.push(event)
    map.set(relation.fromId,values)
  }
  return map
})
const sortedGroupRecords=computed(()=>{
  const ordered=new WeakMap<WorkspaceRecord[],WorkspaceRecord[]>()
  const visit=(group:TimelineGroup)=>{
    ordered.set(group.records,orderTimelineRecords(group.records,props.relations,props.arrangement?.timelineRows))
    group.children.forEach(visit)
  }
  groups.value.forEach(visit)
  return ordered
})
const datedEventIds=computed(()=>new Set(props.records.filter(record=>record.kind==='event'&&record.start).map(record=>record.id)))
const datedLinkedWork = computed(()=>new Set(props.relations.filter(relation=>relation.type==='scheduled_during'&&datedEventIds.value.has(relation.toId)).map(relation=>relation.fromId)))
function unscheduled(record:WorkspaceRecord){return unscheduledIds.value.has(record.id)}
type Row = {id:string;depth:number;group:TimelineGroup;record?:WorkspaceRecord;siblings:string}
const allRows = computed(()=>{
  const result:Row[]=[]
  const add=(group:TimelineGroup,depthOffset=0,parent='root')=>{
    const scopedSpace=group.kind==='space'&&group.spaceId===props.scopeId
    if(scopedSpace)depthOffset--
    else{result.push({id:group.id,depth:group.depth+depthOffset,group,siblings:`groups:${parent}`});if(collapsed.value.has(group.id))return}
    for(const child of group.children)add(child,depthOffset,group.id)
    const records=sortedGroupRecords.value.get(group.records)||group.records
    const depth=Math.max(0,group.depth+1+depthOffset)
    for(const record of records)result.push({id:`item:${record.id}`,depth,group,record,siblings:`rows:${group.id}`})
  }
  for(const group of groups.value)add(group)
  return result
})
const rows = computed(()=>allRows.value.slice(0,limit.value))
const closedGroupSpans=computed(()=>new Map(rows.value.filter(row=>!row.record&&collapsed.value.has(row.id)).map(row=>[row.id,collapsedTimelineSpans(row.group,days.value[0]!,dayCount.value)])))
function groupSpanStyle(span:CollapsedTimelineSpan,groupId:string){
  const lanes=closedGroupSpans.value.get(groupId)?.lanes||1,step=(rowHeight.value-12)/lanes
  return {left:`${span.start/dayCount.value*100}%`,width:span.point?'18px':`max(18px, ${(span.end-span.start)/dayCount.value*100}%)`,top:`${Math.min(rowHeight.value-18,3+span.lane*step)}px`,height:'18px','--span-visible-width':span.point?'4px':`${(span.end-span.start)/dayCount.value*plotWidth.value}px`,'--record-color':props.colorFor(span.record),'--source-color':sourceTint(span.record)}
}
watch(()=>[props.listCollapsed,rows.value,plotWidth.value,props.axis?.dayWidth,ownDayWidth.value,renderAnchor.value],()=>nextTick(pinnedLabels.invalidate),{flush:'post'})
watch(()=>props.listCollapsed,()=>{touch.cancel();cancelDrag();cancelCreation();void nextTick(()=>{measureListWidth();syncHorizontalScroll();pinnedLabels.invalidate()})})
const orderId=(row:Row)=>row.record?.id||row.group.id
const reorder=useListReorder(scroller,{
  canReorder:()=>Boolean(props.canReorder&&!props.saving),
  items:()=>Array.from(scroller.value?.querySelectorAll<HTMLElement>('.timeline-list-entry')||[]).map(element=>({id:element.dataset.orderId!,group:element.dataset.orderGroup!,element})),
  onStart:()=>{touch.cancel();cancelDrag();cancelCreation()},
  pan:(dx,dy)=>{if(!scroller.value)return;scroller.value.scrollTop+=dy;if(props.axis)emit('datePan',dx);else canvas.pan(dx)},
  commit:(intent:ListReorderIntent)=>{
    const kind=intent.group.startsWith('rows:')?'timelineRows':'timelineGroups'
    const visible=allRows.value.filter(row=>row.siblings===intent.group).map(orderId)
    emit('reorder',{kind,ids:reorderIds(props.arrangement?.[kind]||[],visible,intent.id,intent.targetId,intent.placement)})
  },
})
function dropMarker(row:Row){return reorder.marker.value?.targetId===orderId(row)&&reorder.marker.value?.group===row.siblings?`reorder-${reorder.marker.value.placement}`:''}
function beginRowOrder(event:PointerEvent,row:Row){touch.stopCoast();reorder.begin(event,orderId(row),row.siblings)}
watch(()=>[props.scopeId,props.records,props.arrangement],()=>reorder.cancel())
const plotHeight = computed(()=>Math.max(rowHeight.value*4,rows.value.length*rowHeight.value))
const itemCount = computed(()=>groups.value.reduce((count,group)=>count+group.count,0))
const visibleWorkCount = computed(()=>rows.value.filter(row=>row.record).length)
const allGroupIds = computed(()=>{const ids:string[]=[];const visit=(group:TimelineGroup)=>{ids.push(group.id);group.children.forEach(visit)};groups.value.forEach(visit);return ids})
function toggleGroup(id:string){const next=new Set(collapsed.value);next.has(id)?next.delete(id):next.add(id);collapsed.value=next}
function expandAll(){collapsed.value=new Set();limit.value=180}
function collapseAll(){collapsed.value=new Set(allGroupIds.value)}
async function revealRecord(id:string){
  touch.stopCoast()
  if(!props.axis&&!inlineUnscheduled.value&&await unscheduledTray.value?.revealRecord(id))return true
  if(!props.axis){canvas.position(0);await nextTick();syncHorizontalScroll()}
  if(props.records.find(record=>record.id===id)?.kind==='event'){
    if(scroller.value)scroller.value.scrollTop=0
    await nextTick()
    const chip=Array.from(scroller.value?.querySelectorAll<HTMLElement>('[data-event-id]')||[]).find(element=>element.dataset.eventId===id)
    if(chip){chip.focus({preventScroll:true});return true}
    await openEvents();return true
  }

  const findPath=(group:TimelineGroup,path:TimelineGroup[]):TimelineGroup[]|undefined=>{
    const next=[...path,group]
    if(group.records.some(record=>record.id===id))return next
    for(const child of group.children){const found=findPath(child,next);if(found)return found}
  }
  let path:TimelineGroup[]|undefined
  for(const group of groups.value){path=findPath(group,[]);if(path)break}
  if(!path)return false
  const nextCollapsed=new Set(collapsed.value)
  for(const group of path)nextCollapsed.delete(group.id)
  collapsed.value=nextCollapsed
  const index=allRows.value.findIndex(row=>row.record?.id===id)
  if(index<0)return false
  limit.value=Math.max(limit.value,index+1)
  await nextTick()
  const container=scroller.value
  const element=Array.from(container?.querySelectorAll<HTMLElement>('.timeline-row-label')||[]).find(row=>row.dataset.recordId===id)
  if(!container||!element)return false
  const bounds=container.getBoundingClientRect(),rowBounds=element.getBoundingClientRect()
  const headerHeight=floatingMode.value?0:(container.querySelector<HTMLElement>('.timeline-head-name')?.offsetHeight||0)+(container.querySelector<HTMLElement>('.timeline-calendar-context')?.offsetHeight||0)
  const top=bounds.top+container.clientTop+headerHeight,bottom=bounds.top+container.clientTop+container.clientHeight
  if(rowBounds.top<top)container.scrollTop-=top-rowBounds.top
  else if(rowBounds.bottom>bottom)container.scrollTop+=rowBounds.bottom-bottom
  return true
}
async function openEvents(){touch.stopCoast();cancelDrag();agendaDay.value='';if(scroller.value)scroller.value.scrollTop=0;await nextTick();if(eventPicker.value){eventPicker.value.open=true;eventPicker.value.querySelector<HTMLElement>('summary')?.focus()}}
defineExpose({revealRecord,openEvents})
function barStyle(range:TimelineInterval|null){return range?{left:`${range.start/dayCount.value*100}%`,width:`${(range.end-range.start)/dayCount.value*100}%`}:{} }
function pointStyle(record:WorkspaceRecord){return {left:`${(geometry(record).point?.offset||0)/dayCount.value*100}%`,'--record-color':props.colorFor(record),'--source-color':sourceTint(record)}}
function bandStyle(event:TimelineEvent){return {...barStyle(event.range),'--record-color':props.colorFor(event.record),'--source-color':sourceTint(event.record)}}
function eventForeground(record:WorkspaceRecord){const color=props.colorFor(record).replace('#','');const hex=color.length===3?color.split('').map(channel=>channel+channel).join(''):color;const rgb=[0,2,4].map(offset=>parseInt(hex.slice(offset,offset+2),16)/255).map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4);return rgb[0]!* .2126+rgb[1]!* .7152+rgb[2]!* .0722>.179?'#111111':'#ffffff'}
function labelStyle(event:TimelineEvent){return {left:`${event.labelLeft}px`,width:`${event.labelWidth}px`,top:`${6+event.lane*32}px`,'--record-color':props.colorFor(event.record),'--source-color':sourceTint(event.record),'--event-foreground':eventForeground(event.record)}}
const eventPresentation=computed(()=>new WeakMap(props.records.filter(record=>record.kind==='event').map(event=>{
  const location=recordGrouping(event,groupingOptions.value),source=[location.category?.name,event.collectionTitle||'Calendar'].filter(Boolean).join(' · '),time=eventLabel(event)
  return [event,{source,time,title:`${event.title} · ${dateLabel(event.start)} · ${time} · ${source}${tagDescription(event)}`} ] as const
})))
function eventSourceLabel(event:WorkspaceRecord){return (contextIds.value.has(event.id)?'Linked context · ':'')+(eventPresentation.value.get(event)?.source||event.collectionTitle||'Calendar')}
function eventTime(event:WorkspaceRecord){return eventPresentation.value.get(event)?.time||eventLabel(event)}
function eventTitle(event:WorkspaceRecord){return (contextIds.value.has(event.id)?'Linked context · ':'')+(eventPresentation.value.get(event)?.title||event.title)}
function openEvent(event:WorkspaceRecord){if(eventPicker.value)eventPicker.value.open=false;emit('open',event)}
const eventsByDay=computed(()=>new Map(days.value.map((day,index)=>[dayKey(day),visibleEvents.value.filter(event=>event.range.start<index+1&&event.range.end>index)])))
function eventsForDay(day:Date){return eventsByDay.value.get(dayKey(day))||[]}
const agendaEvents = computed(()=>agendaDay.value?eventsByDay.value.get(agendaDay.value)||[]:visibleEvents.value)
function openAgenda(day:Date){agendaDay.value=dayKey(day);if(eventPicker.value)eventPicker.value.open=true}
function firstTime(day:Date){const event=eventsForDay(day)[0]?.record;return event?event.allDay?'All day':eventTime(event).split(' – ')[0]:''}
const selectedEventIds = computed(()=>new Set(props.relations.filter(relation=>relation.type==='scheduled_during'&&relation.fromId===props.selectedId).map(relation=>relation.toId)))
const selectedWorkIds = computed(()=>new Set(props.relations.filter(relation=>relation.type==='scheduled_during'&&relation.toId===props.selectedId).map(relation=>relation.fromId)))
const recordsById=computed(()=>new Map(props.records.map(record=>[record.id,record])))
const dependencyLinks=computed(()=>{
  const result=new Map<string,Map<string,WorkspaceRecord|undefined>>()
  for(const edge of props.relations.filter(edge=>edge.type==='depends_on'))for(const [own,other] of [[edge.fromId,edge.toId],[edge.toId,edge.fromId]]){
    const neighbors=result.get(own!)||new Map<string,WorkspaceRecord|undefined>()
    neighbors.set(other!,recordsById.value.get(other!));result.set(own!,neighbors)
  }
  return result
})
const hoverLinkedIds=computed(()=>{
  const result=new Set(props.highlightedIds)
  const id=hoveredRecordId.value
  if(id){result.add(id);for(const edge of props.relations)if(['scheduled_during','depends_on','related'].includes(edge.type)&&(edge.fromId===id||edge.toId===id)){result.add(edge.fromId);result.add(edge.toId)}}
  return result
})
function hoverLinked(id:string){return hoverLinkedIds.value.has(id)}
const dependencySummaries=computed(()=>{
  const result=new Map<string,string[]>()
  for(const edge of props.relations)if(edge.type==='depends_on')for(const [own,other,label] of [[edge.fromId,edge.toId,'Depends on'],[edge.toId,edge.fromId,'Needed by']]){const values=result.get(own!)||[];values.push(`${label} ${recordsById.value.get(other!)?.title||'unavailable item'}`);result.set(own!,values)}
  return new Map([...result].map(([id,labels])=>[id,labels.join(' · ')]))
})
function dependencySummary(record:WorkspaceRecord){return dependencySummaries.value.get(record.id)||''}
function eventHighlighted(id:string){return id===props.selectedId||selectedEventIds.value.has(id)}
const linkedEventIds=computed(()=>new Set(props.relations.filter(relation=>relation.type==='scheduled_during').map(relation=>relation.toId)))
function eventLinked(id:string){return linkedEventIds.value.has(id)}
function markerVisible(record:WorkspaceRecord,event:TimelineEvent){return record.id===props.selectedId||event.record.id===props.selectedId}
function markerStyle(event:TimelineEvent){return {...barStyle(event.range),'--record-color':props.colorFor(event.record),'--source-color':sourceTint(event.record)}}
function sessionLabel(record:WorkspaceRecord,event:TimelineEvent){const sameDay=(linkedSessions.value.get(record.id)||[]).filter(other=>Math.floor(other.range.start)===Math.floor(event.range.start));if(sameDay[0]?.record.id!==event.record.id)return '';return `${eventTime(event.record)}${sameDay.length>1?` +${sameDay.length-1}`:''}`}
const visibleRelations = computed(()=>props.relations.filter(edge=>edge.type==='depends_on'))
const connectedIds = computed(()=>new Set([...visibleRelations.value.filter(edge=>edge.fromId===props.selectedId||edge.toId===props.selectedId).flatMap(edge=>[edge.fromId,edge.toId]),...selectedWorkIds.value]))
const activeEvents = computed(()=>props.taskOnly?[]:allBands.value?visibleEvents.value:visibleEvents.value.filter(event=>eventHighlighted(event.record.id)))
// Hover is a temporary full-column guide, including events outside the work's Space.
const hoverEvents = computed(()=>hoveredRecordId.value?visibleEvents.value.filter(event=>hoverLinked(event.record.id)):[])
const eventSegments = computed(()=>activeEvents.value.flatMap(event=>{
  const selectedWork=props.records.find(record=>record.id===props.selectedId&&selectedEventIds.value.has(event.record.id))
  const location=recordGrouping(selectedWork||event.record,groupingOptions.value)
  const indices=rows.value.flatMap((row,index)=>{
    const matches=location.category?row.group.categoryId===location.category.id:location.space?row.group.spaceId===location.space.id:true
    return matches?[index]:[]
  })
  const segments:{event:TimelineEvent;start:number;end:number;key:string}[]=[]
  for(const index of indices){const last=segments.at(-1);if(last&&last.end===index)last.end=index+1;else segments.push({event,start:index,end:index+1,key:`${event.record.id}:${index}`})}
  if(!rows.value.length)segments.push({event,start:0,end:4,key:event.record.id})
  return segments
}))
function segmentStyle(segment:{event:TimelineEvent;start:number;end:number}){return {...bandStyle(segment.event),top:`${segment.start*rowHeight.value}px`,height:`${(segment.end-segment.start)*rowHeight.value}px`,bottom:'auto'}}
function point(record:WorkspaceRecord,finish=false){const shape=geometry(record);if(shape.bar)return finish?shape.bar.end:shape.bar.start;if(shape.point)return shape.point.offset;const plan=(sessions.value.get(record.id)||[]).map(sessionRange).find(Boolean);if(plan)return finish?plan.end:plan.start;const event=linkedSessions.value.get(record.id)?.[0];return event?(finish?event.range.end:event.range.start):null}
const rowIndices=computed(()=>new Map(rows.value.flatMap((row,index)=>row.record?[[row.record.id,index] as const]:[])))
const paths = computed(()=>visibleRelations.value.flatMap(edge=>{
  const from=rowIndices.value.get(edge.toId)??-1,to=rowIndices.value.get(edge.fromId)??-1
  if(from<0||to<0)return[]
  const first=point(rows.value[from]!.record!,true),last=point(rows.value[to]!.record!,false)
  const x1=first===null?20:first/dayCount.value*plotWidth.value,x2=last===null?20:last/dayCount.value*plotWidth.value,y1=from*rowHeight.value+rowCenter.value,y2=to*rowHeight.value+rowCenter.value
  return [{id:edge.id,d:timelineLinkPath(x1,y1,x2,y2,rowHeight.value),native:edge.native===true,title:`${rows.value[from]!.record!.title} → ${rows.value[to]!.record!.title}${edge.native?' · Deck dependency':''}`}]
}))
type EditMode='move'|'start'|'end'|'place'
type DragState={kind:'record'|'plan'|'link';record:WorkspaceRecord;plan?:PlanSession;mode:EditMode;rowId?:string;pointerId:number;target:HTMLElement;originX:number;originY:number;originOffset:number;clientX:number;clientY:number;moved:boolean;valid:boolean;delta:number;targetId?:string;dateEdit?:TimelineDateEdit|null;planEdit?:{id:string;start:string;end:string}|null}
const drag=shallowRef<DragState|null>(null)
type NewRange={pointerId:number;target:HTMLElement;area:'plot'|'header'|'days';from:number;row:number;recordId?:string;originX:number;originY:number;clientX:number;clientY:number;moved:boolean;selection:CreationSelection}
const newRange=shallowRef<NewRange|null>(null)
function beginCreation(event:PointerEvent,area:NewRange['area']){
  if(!props.canCreateEvent||props.saving||event.button!==0||drag.value||newRange.value||(event.target as HTMLElement).closest('button,input,select,a,summary'))return
  const target=event.currentTarget as HTMLElement,bounds=target.getBoundingClientRect(),from=(event.clientX-bounds.left)/(bounds.width/dayCount.value)
  const row=area==='plot'?Math.max(0,Math.min(Math.ceil(plotHeight.value/rowHeight.value)-1,Math.floor((event.clientY-bounds.top)/rowHeight.value))):-1,recordId=rows.value[row]?.record?.id
  if(event.pointerType==='touch'){touch.tap(event,()=>{if(props.canCreateEvent&&!props.saving)emit('createEvent',creationSelection(days.value[0]!,from,from,{daysCount:dayCount.value,timed:area!=='days'&&visibleDayCount.value<=3,origin:'timeline',recordId}).range)});return}
  event.preventDefault();event.stopPropagation()
  newRange.value={pointerId:event.pointerId,target,area,from,row,recordId,originX:event.clientX,originY:event.clientY,clientX:event.clientX,clientY:event.clientY,moved:false,selection:creationSelection(days.value[0]!,from,from,{daysCount:dayCount.value,timed:area!=='days'&&visibleDayCount.value<=3,origin:'timeline',recordId})}
  target.setPointerCapture(event.pointerId)
}
function moveCreation(event:PointerEvent){
  const current=newRange.value
  if(!current||current.pointerId!==event.pointerId)return
  const bounds=current.target.getBoundingClientRect(),to=(event.clientX-bounds.left)/(bounds.width/dayCount.value),moved=current.moved||Math.hypot(event.clientX-current.originX,event.clientY-current.originY)>=4
  event.preventDefault()
  newRange.value={...current,moved,clientX:event.clientX,clientY:event.clientY,selection:creationSelection(days.value[0]!,current.from,to,{daysCount:dayCount.value,timed:current.area!=='days'&&visibleDayCount.value<=3,dragged:moved,origin:'timeline',recordId:current.recordId})}
}
function cancelCreation(){const current=newRange.value;newRange.value=null;if(current?.target.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId)}
function finishCreation(event:PointerEvent){const current=newRange.value;if(!current||current.pointerId!==event.pointerId)return;event.preventDefault();event.stopPropagation();cancelCreation();suppressClickUntil=Date.now()+400;if(props.canCreateEvent&&!props.saving)emit('createEvent',current.selection.range)}
function createDay(day:Date){if(props.canCreateEvent&&!props.saving)emit('createEvent',creationSelection(day,0,0,{daysCount:1,origin:'timeline'}).range)}
const creationStyle=computed(()=>newRange.value?{left:`${newRange.value.selection.startOffset/dayCount.value*100}%`,width:`${(newRange.value.selection.endOffset-newRange.value.selection.startOffset)/dayCount.value*100}%`,top:newRange.value.area==='plot'?`${newRange.value.row*rowHeight.value+4}px`:'3px',height:newRange.value.area==='plot'?`${rowHeight.value-8}px`:'calc(100% - 6px)'}:undefined)
const creationTooltipStyle=computed(()=>newRange.value?{left:`${Math.max(8,Math.min(newRange.value.clientX+14,window.innerWidth-330))}px`,top:`${Math.max(8,Math.min(newRange.value.clientY-42,window.innerHeight-70))}px`}:undefined)
const creationText=computed(()=>{
  const range=newRange.value?.selection.range
  if(!range)return ''
  const end=dateValue(range.end);if(range.allDay)end.setDate(end.getDate()-1)
  const label=(value:Date)=>value.toLocaleDateString(undefined,{month:'short',day:'numeric'})+(range.allDay?'':` ${clockTime(value.toISOString())}`)
  return `Create · ${label(dateValue(range.start))} → ${label(end)}`
})
let suppressClickUntil=0
const compactDays=computed(()=>(props.axis?.dayWidth||plotWidth.value/dayCount.value)<40)
function editable(record:WorkspaceRecord){return !props.saving&&!record.readonly&&Boolean(props.canEditRecord?.(record))}
function openRecord(record:WorkspaceRecord){if(Date.now()>=suppressClickUntil)emit('open',record)}
function captureClick(event:MouseEvent){reorder.captureClick(event);if(Date.now()<suppressClickUntil){suppressClickUntil=0;event.preventDefault();event.stopImmediatePropagation()}}
function beginInteraction(event:PointerEvent,record:WorkspaceRecord,kind:DragState['kind'],mode:EditMode='move',plan?:PlanSession,rowId?:string,touchTarget?:HTMLElement){
  if(event.button!==0||props.saving||drag.value||!plot.value)return
  if(kind==='record'&&!editable(record)||kind==='plan'&&!props.canEditPlans||kind==='link'&&!props.canLink)return
  const bounds=plot.value.getBoundingClientRect(),target=touchTarget||event.currentTarget as HTMLElement
  if(event.pointerType==='touch'&&!touchTarget){touch.edit(event,{target,eligible:()=>{const latest=recordsById.value.get(record.id);return Boolean(latest&&!props.saving&&(kind==='record'?editable(latest):kind==='plan'?props.canEditPlans&&props.plans.some(item=>item.id===plan?.id):props.canLink))},arm:()=>beginInteraction(event,record,kind,mode,plan,rowId,target),move:moveInteraction,end:finishInteraction,cancel:cancelDrag});return}
  event.preventDefault();event.stopPropagation()
  drag.value={kind,record:{...record},plan:plan?{...plan}:undefined,mode,rowId:rowId||(record.kind!=='event'?record.id:undefined),pointerId:event.pointerId,target,originX:event.clientX,originY:event.clientY,originOffset:(event.clientX-bounds.left)/(bounds.width/dayCount.value),clientX:event.clientX,clientY:event.clientY,moved:false,valid:false,delta:0}
  target.setPointerCapture(event.pointerId)
}
function recordDrag(event:PointerEvent,record:WorkspaceRecord,mode:EditMode='move',rowId?:string){beginInteraction(event,record,'record',mode,undefined,rowId)}
function planDrag(event:PointerEvent,record:WorkspaceRecord,plan:PlanSession,mode:'move'|'start'|'end'='move'){beginInteraction(event,record,'plan',mode,plan)}
function linkDrag(event:PointerEvent,record:WorkspaceRecord){beginInteraction(event,record,'link')}
function inVisibleChart(x:number,y:number){
  const area=scroller.value?.getBoundingClientRect(),chart=plot.value?.getBoundingClientRect()
  if(!area||!chart)return false
  const left=area.left+(scroller.value?.querySelector<HTMLElement>('.timeline-head-name')?.offsetWidth||0)
  return x>=left&&x<=area.right&&y>=Math.max(area.top,chart.top)&&y<=area.bottom
}
function dropRecord(event:PointerEvent){
  const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-record-id]')
  if(target&&scroller.value?.contains(target))return recordsById.value.get(target.dataset.recordId||'')
  if(!inVisibleChart(event.clientX,event.clientY)||!plot.value)return undefined
  const index=Math.floor((event.clientY-plot.value.getBoundingClientRect().top)/rowHeight.value)
  return rows.value[index]?.record
}
function moveInteraction(event:PointerEvent){
  if(newRange.value){moveCreation(event);return}
  const current=drag.value
  if(!current||event.pointerId!==current.pointerId||!plot.value)return
  const moved=current.moved||Math.hypot(event.clientX-current.originX,event.clientY-current.originY)>=4
  if(!moved)return
  event.preventDefault()
  const bounds=plot.value.getBoundingClientRect(),offset=(event.clientX-bounds.left)/(bounds.width/dayCount.value)
  const timed=Boolean(current.plan||current.record.start?.includes('T')||current.record.due?.includes('T'))&&!current.record.allDay
  const step=timed&&visibleDayCount.value<=3?1/96:1,delta=Math.round((offset-current.originOffset)/step)*step
  const next:DragState={...current,moved,clientX:event.clientX,clientY:event.clientY,delta,valid:false}
  if(current.kind==='link'){
    const target=dropRecord(event)
    if(target&&(target.kind==='task'||target.kind==='card')&&target.id!==current.record.id){next.targetId=target.id;next.valid=props.canLinkRecords?.(current.record.id,target.id)!==false&&canAddRelation(props.relations,target.id,current.record.id,'depends_on').ok}
    else next.targetId=undefined
  }else if(current.kind==='plan'&&current.plan){
    next.planEdit=timelinePlanEdit(current.plan,current.mode as 'move'|'start'|'end',delta);next.valid=Boolean(next.planEdit)
  }else{
    const day=new Date(days.value[0]!);day.setDate(day.getDate()+Math.max(0,Math.min(dayCount.value-1,Math.floor(offset))))
    next.dateEdit=timelineDateEdit(current.record,current.mode,delta,dayKey(day))
    next.valid=Boolean(next.dateEdit)&&(current.mode!=='place'||inVisibleChart(event.clientX,event.clientY))
  }
  drag.value=next
}
function releaseCapture(current:DragState){if(current.target.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId)}
function cancelDrag(){cancelCreation();const current=drag.value;if(!current)return;drag.value=null;if(current.moved)suppressClickUntil=Date.now()+400;releaseCapture(current)}
function finishInteraction(event:PointerEvent){
  if(newRange.value){finishCreation(event);return}
  const current=drag.value
  if(!current||current.pointerId!==event.pointerId)return
  drag.value=null;releaseCapture(current)
  if(!current.moved)return
  event.preventDefault();event.stopPropagation();suppressClickUntil=Date.now()+400
  if(!current.valid||props.saving)return
  const latest=recordsById.value.get(current.record.id)
  if(current.kind==='record'&&latest&&editable(latest)&&current.dateEdit)emit('dateEdit',current.dateEdit)
  else if(current.kind==='plan'&&props.canEditPlans&&current.planEdit&&props.plans.some(plan=>plan.id===current.planEdit!.id))emit('planEdit',current.planEdit)
  else if(current.kind==='link'&&props.canLink&&current.targetId&&props.canLinkRecords?.(current.record.id,current.targetId)!==false&&canAddRelation(props.relations,current.targetId,current.record.id,'depends_on').ok)emit('link',{fromId:current.record.id,toId:current.targetId})
}
let touchZoom:Parameters<typeof touchTimelineZoom>[0]|undefined
function touchViewport(clientX:number){const viewport=scroller.value!;const label=viewport.querySelector<HTMLElement>('.timeline-head-name')?.offsetWidth||0;const width=Math.max(1,viewport.clientWidth-label);return {width,pixel:Math.max(0,Math.min(width,clientX-viewport.getBoundingClientRect().left-label))}}
const touch=usePlannerTouch(scroller,{
  eligible:target=>Boolean(target.closest('.timeline-days,.timeline-plot,.timeline-calendar-header,.timeline-empty-work,.timeline-floating-events'))||Boolean((!props.canReorder||props.saving)&&target.closest('.timeline-row-label,.timeline-group-label')),
  start:()=>{suppressClickUntil=0},
  pan:(dx,dy)=>{
    const viewport=scroller.value;if(!viewport)return;viewport.scrollTop-=dy
    if(props.axis){emit('datePan',-dx);return}
    canvas.pan(-dx)
  },
  panEnd:()=>{if(!props.axis)canvas.settle()},
  pinchStart:center=>{if(!scroller.value)return;const {width,pixel}=touchViewport(center.x);touchZoom={anchor:renderAnchor.value,days:visibleDayCount.value,scale:1,dayAtCenter:(scroller.value.scrollLeft+pixel)/(plotWidth.value/dayCount.value),centerPixel:pixel,viewportWidth:width,minimumDayWidth:props.minimumDayWidth}},
  pinch:(scale,center)=>{if(!touchZoom||!scroller.value)return;const range=touchTimelineZoom({...touchZoom,scale,centerPixel:touchViewport(center.x).pixel});if(props.axis)emit('touchRangeChange',range);else{emit('rangeChange',{anchor:range.anchor,days:range.days});void nextTick(()=>canvas.position(range.scrollLeft))}},
})
watch(()=>props.scopeId,()=>touch.cancel())
watch(floatingMode,()=>{touch.cancel();floatingIds.value=new Set()})
watch(()=>props.anchor.getTime(),()=>touch.stopCoast())
function dragKeydown(event:KeyboardEvent){if(event.key==='Escape'&&(drag.value||newRange.value)){event.preventDefault();event.stopPropagation();cancelDrag()}}
onMounted(()=>document.addEventListener('keydown',dragKeydown))
watch(()=>[props.anchor.getTime(),props.daysCount,props.scopeId],cancelDrag)
watch(()=>props.saving,value=>{if(value)cancelDrag()})
watch(()=>[props.canCreateEvent,props.axis?.scrollLeft],cancelCreation)
const dragRange=computed(()=>{
  const current=drag.value
  if(!current?.moved||!current.valid||current.kind==='link')return null
  if(current.planEdit)return timelineInterval(current.planEdit.start,current.planEdit.end,days.value[0]!,dayCount.value)
  const record={...current.record,...current.dateEdit}
  if(record.kind==='event')return record.start&&record.end?timelineInterval(record.start,record.end,days.value[0]!,dayCount.value):null
  const shape=geometry(record)
  return shape.bar|| (shape.point?{start:shape.point.offset,end:shape.point.offset+.025,clippedStart:false,clippedEnd:false}:null)
})
const floatingDragPreview=computed(()=>floatingMode.value&&drag.value?.moved&&drag.value.valid&&drag.value.kind==='record'&&drag.value.record.kind==='event'&&!drag.value.rowId&&dragRange.value?{id:drag.value.record.id,start:dragRange.value.start,end:dragRange.value.end}:undefined)
const dragGhostStyle=computed(()=>{
  const current=drag.value,range=dragRange.value
  if(!current||!range)return undefined
  const index=rows.value.findIndex(row=>row.record?.id===current.rowId)
  return {...barStyle(range),top:`${index>=0?index*rowHeight.value+rowCenter.value+(current.kind==='plan'?5:-8):6}px`,height:current.kind==='plan'?'11px':'16px','--record-color':props.colorFor(current.record),'--source-color':sourceTint(current.record)}
})
const dragText=computed(()=>{
  const current=drag.value
  if(!current?.moved)return ''
  if(current.kind==='link')return current.targetId?`${current.valid?'Link to':'Cannot link to'} ${recordsById.value.get(current.targetId)?.title||'item'}`:`Link ${current.record.title} → drag to another task or card`
  if(!current.valid)return current.mode==='place'?'Drop on a day in the chart':current.delta?'Keep the end after the start':'Drag to another day'
  const record=current.planEdit||{...current.record,...current.dateEdit}
  const start=record.start,end='due' in record?record.due||('end' in record?record.end:undefined):record.end
  const label=(value:string)=>`${shortDate(value)}${value.includes('T')?` ${clockTime(value)}`:''}`
  return `${current.record.title} · ${start?label(start):''}${start&&end?' → ':''}${end?label(end):''}`
})
const dragConnectorPath=computed(()=>{
  const current=drag.value
  if(!current?.moved||current.kind!=='link'||!plot.value)return ''
  const row=rows.value.findIndex(row=>row.record?.id===current.record.id),bounds=plot.value.getBoundingClientRect()
  const x1=connectorOffset(current.record),y1=row*rowHeight.value+rowCenter.value,x2=current.clientX-bounds.left,y2=current.clientY-bounds.top
  return timelineLinkPath(x1,y1,x2,y2,rowHeight.value)
})
function connectorOffset(record:WorkspaceRecord){const offset=point(record,true);return offset===null?20:Math.max(10,Math.min(plotWidth.value-14,offset/dayCount.value*plotWidth.value+10))}
function connectorStyle(record:WorkspaceRecord){return {left:`${connectorOffset(record)}px`}}
const todayOffset = computed(()=>timelineOffset(todayKey.value,days.value[0]!))
function groupIcon(group:TimelineGroup){return group.kind==='collection'?(group.source==='deck'?FolderKanban:Circle):Folder}
function recordIcon(record:WorkspaceRecord){return record.kind==='card'?FolderKanban:record.completed?CheckCircle2:Circle}
function status(record:WorkspaceRecord){return props.statusMapping?unifiedStatus(record,props.statusMapping)?.title||timelineStatus(record,props.collections):timelineStatus(record,props.collections)}
function statusStyle(record:WorkspaceRecord){const color=props.statusMapping&&unifiedStatus(record,props.statusMapping)?.color;return color?{color,background:`color-mix(in srgb,${color} 16%,var(--surface))`}:undefined}
function statusClass(record:WorkspaceRecord){return record.completed?'done':record.kind==='task'&&record.status==='CANCELLED'?'cancelled':status(record).toLowerCase()==='in progress'?'progress':'neutral'}
function sourceLabel(record:WorkspaceRecord){return `${sourceLabels[record.source]} · ${record.collectionTitle||props.collections.find(collection=>collection.id===record.collectionId)?.title||''}`}
</script>

<template>
  <UnscheduledTray ref="unscheduledTray" class="timeline-view" :disabled="Boolean(axis)" :records="unscheduledItems" :preference-key="preferenceKey" :persist-presentation="persistPresentation" :selected-id="selectedId" :color-for="colorFor" :source-color-for="sourceTint" :tags-for="itemTags" :hovered-id="hoveredRecordId" :highlighted-ids="hoverLinkedIds" @hover="(id,event)=>setHover(event.type.startsWith('focus')?'focus':'pointer',id)" allow-inline default-inline @placement="inlineUnscheduled=$event" @open="emit('open',$event)">
  <section class="timeline-surface grouped-timeline" :class="{'list-collapsed':listCollapsed,'dense-timeline':denseRows,'is-reordering':reorder.active.value,'floating-events-mode':floatingMode,'focused-timeline':focused,'all-calendar-bands':allBands&&!taskOnly,'task-only-timeline':taskOnly,'unified-axis-timeline':Boolean(axis),'compact-axis-list':axis&&axis.labelWidth<300,'compact-date-columns':compactDays,'is-dragging':Boolean(drag?.moved),'can-create-range':canCreateEvent,'is-creating-range':Boolean(newRange)}" :style="surfaceStyle" :data-row-height="rowHeight" :data-timeline-days="visibleDayCount" :data-render-days="dayCount" :data-render-anchor="renderAnchor" aria-label="Timeline" @pointermove="moveInteraction" @pointerup="finishInteraction" @pointercancel="cancelDrag" @lostpointercapture="cancelDrag" @pointerdown.capture="suppressClickUntil=0" @click.capture="captureClick">
    <div ref="scroller" class="timeline-scroll" @scroll="horizontalScroll" @wheel="horizontalWheel">
      <TimelineFloatingEvents v-if="floatingMode" :scroller="scroller" :entries="floatingEntries" :events="eventById" :enabled="allBands" :label-width="labelWidth" :day-width="ownDayWidth" :header-height="rowHeight+4" :preview="floatingDragPreview" @active-ids="floatingIds=new Set($event)">
        <template #default="{items}">
          <button v-for="chip in items" :key="chip.id" class="timeline-event-chip floating-event-chip" :class="{previewing:floatingDragPreview?.id===chip.id,selected:eventHighlighted(chip.id),'hover-linked':hoverLinked(chip.id),'can-drag':editable(chip.event.record)}" :style="{...labelStyle(chip.event),left:`${chip.left}px`,width:`${chip.width}px`,top:`${chip.lane*32}px`}" :data-event-id="chip.id" :title="eventTitle(chip.event.record)" :aria-label="`Calendar event: ${eventTitle(chip.event.record)}`" v-on="hoverBindings(chip.id)" @pointerdown="recordDrag($event,chip.event.record)" @click="openEvent(chip.event.record)"><span class="event-chip-title"><i class="timeline-source-dot" :style="{background:sourceTint(chip.event.record)}"/><Link2 v-if="eventLinked(chip.id)" :size="13"/><CalendarDays v-else :size="13"/><strong>{{chip.event.record.title}}</strong><RecordTagMarkers :tags="itemTags(chip.event.record)" :limit="2"/></span><template v-if="editable(chip.event.record)"><span class="timeline-resize-handle start" :title="`Resize start of ${chip.event.record.title}`" @pointerdown.stop="recordDrag($event,chip.event.record,'start')"></span><span class="timeline-resize-handle end" :title="`Resize end of ${chip.event.record.title}`" @pointerdown.stop="recordDrag($event,chip.event.record,'end')"></span></template></button>
        </template>
        <template #preview="{style}"><div v-if="drag" class="timeline-edit-ghost floating-edit-ghost" :style="{...style,'--record-color':colorFor(drag.record),'--source-color':sourceTint(drag.record)}" aria-hidden="true"></div></template>
      </TimelineFloatingEvents>
      <div class="timeline-grid" :style="gridStyle">
        <div class="timeline-head-name"><span class="timeline-title"><button class="timeline-list-toggle" :aria-label="listCollapsed?'Expand work list':'Collapse work list'" :title="listCollapsed?'Expand work list':'Collapse work list'" :aria-expanded="!listCollapsed" @click="emit('update:listCollapsed',!listCollapsed)"><component :is="listCollapsed?PanelLeftOpen:PanelLeftClose" :size="17"/></button><strong>Tasks & cards</strong><span class="timeline-collapse-controls"><button v-if="canReorder&&(arrangement?.timelineRows?.length||arrangement?.timelineGroups?.length)" title="Reset timeline order" aria-label="Reset timeline order" :disabled="saving" @click="emit('resetOrder')"><RotateCcw :size="14"/></button><button title="Expand all groups" aria-label="Expand all groups" @click="expandAll"><Plus :size="14"/></button><button title="Collapse all groups" aria-label="Collapse all groups" @click="collapseAll"><Minus :size="14"/></button></span></span><span>Status</span><span>Due</span></div>
        <div class="timeline-days" @pointerdown="beginCreation($event,'days')"><div v-for="day in days" :key="dayKey(day)" :title="dateLabels.get(+day)?.full" :class="{weekend:[0,6].includes(day.getDay()),today:dayKey(day)===todayKey,'active-day':axis&&activeDay===dayKey(day)}"><strong v-if="!compactDays">{{dateLabels.get(+day)?.weekday}}</strong><small>{{compactDays?day.getDate():dateLabels.get(+day)?.short}}</small><button v-if="canCreateEvent&&!compactDays" class="timeline-create-event" :aria-label="`New item on ${dateLabels.get(+day)?.local}`" :title="`New item on ${dateLabels.get(+day)?.local}`" @click="createDay(day)"><Plus :size="14"/></button></div><span v-if="newRange?.area==='days'" class="timeline-new-range" :style="creationStyle" aria-hidden="true"></span></div>
        <div v-if="!taskOnly" class="timeline-calendar-context">
          <span class="timeline-count">{{focused?`${visibleWorkCount} of ${itemCount}`:itemCount}} work items</span>
          <details ref="eventPicker" class="timeline-event-picker" @toggle="eventPickerOpen=Boolean(eventPicker?.open)">
            <summary><CalendarDays :size="14"/>{{agendaDay?dateLabel(agendaDay):`${visibleEvents.length} calendar events`}}<ChevronDown :size="13"/><span v-if="allBands&&eventLayout.overflow.length" class="timeline-overflow-count">+{{eventLayout.overflow.length}} in list</span></summary>
            <div v-if="eventPickerOpen" class="timeline-event-list" role="region" aria-label="Calendar events in this period">
              <div v-if="agendaDay" class="day-agenda-heading"><strong>{{dateLabel(agendaDay)}}</strong><button @click="agendaDay=''">Whole period</button></div>
              <p v-if="!agendaEvents.length">No calendar events {{agendaDay?'on this day':'in this period'}}.</p>
              <button v-for="event in agendaEvents" :key="event.record.id" :class="{selected:eventHighlighted(event.record.id),'hover-linked':hoverLinked(event.record.id)}" :title="eventTitle(event.record)" v-on="hoverBindings(event.record.id)" @click="openEvent(event.record)"><CalendarDays :size="16" :style="{color:sourceTint(event.record)}"/><span><strong>{{event.record.title}}</strong><small>{{dateLabel(event.record.start)}} · {{eventTime(event.record)}} · {{eventSourceLabel(event.record)}}</small></span><Link2 v-if="eventLinked(event.record.id)" :size="14"/><ChevronRight :size="13"/></button>
            </div>
          </details>
        </div>
        <div v-if="!taskOnly" class="timeline-calendar-header" @pointerdown="beginCreation($event,'header')"><div v-if="newRange?.area==='header'" class="timeline-new-range" :style="creationStyle" aria-hidden="true"></div>
          <div class="timeline-grid-lines"><div v-for="day in days" :key="dayKey(day)" :class="{weekend:[0,6].includes(day.getDay()),'active-day':axis&&activeDay===dayKey(day)}"></div></div>
          <template v-if="allBands"><div v-for="event in visibleEvents" :key="event.record.id" class="timeline-event-band header-band" :class="{linked:eventHighlighted(event.record.id),selected:event.record.id===selectedId,'hover-band':hoverLinked(event.record.id)}" :style="bandStyle(event)" aria-hidden="true"></div>
          <button v-for="event in headerEvents" :key="event.record.id" class="timeline-event-chip" :class="{'floated-original':floatingMode&&floatingIds.has(event.record.id),selected:eventHighlighted(event.record.id),'hover-linked':hoverLinked(event.record.id),'can-drag':editable(event.record)}" :inert="floatingMode&&floatingIds.has(event.record.id)" :style="labelStyle(event)" :data-event-id="event.record.id" :title="eventTitle(event.record)" :aria-label="`Calendar event: ${eventTitle(event.record)}`" v-on="hoverBindings(event.record.id)" @pointerdown="recordDrag($event,event.record)" @click="openEvent(event.record)"><span class="event-chip-title"><i class="timeline-source-dot" :style="{background:sourceTint(event.record)}" :title="`${event.record.collectionTitle||sourceLabels[event.record.source]} · Source color`"/><Link2 v-if="eventLinked(event.record.id)" :size="13"/><CalendarDays v-else :size="13"/><strong>{{event.record.title}}</strong><RecordTagMarkers :tags="itemTags(event.record)" :limit="2"/></span><template v-if="editable(event.record)"><span class="timeline-resize-handle start" :title="`Resize start of ${event.record.title}`" @pointerdown.stop="recordDrag($event,event.record,'start')"></span><span class="timeline-resize-handle end" :title="`Resize end of ${event.record.title}`" @pointerdown.stop="recordDrag($event,event.record,'end')"></span></template></button></template>
          <div v-if="dragRange&&drag?.record.kind==='event'&&!drag.rowId" class="timeline-edit-ghost" :style="dragGhostStyle" aria-hidden="true"></div>
          <div v-if="!allBands" class="calendar-day-summaries"><button v-for="day in days" :key="dayKey(day)" class="calendar-day-summary" :class="{empty:!eventsForDay(day).length,selected:agendaDay===dayKey(day)}" :aria-label="`Calendar for ${dayKey(day)}: ${eventsForDay(day).length} events`" :title="eventsForDay(day).map(event=>eventTitle(event.record)).join('\n')||'No calendar events'" @click="openAgenda(day)"><span><CalendarDays :size="12"/><strong>{{eventsForDay(day).length?firstTime(day):'No events'}}</strong><small v-if="eventsForDay(day).length>1">+{{eventsForDay(day).length-1}}</small></span><small v-if="eventsForDay(day).length" class="calendar-day-title">{{eventsForDay(day)[0]?.record.title}}</small></button></div>
        </div>
        <div class="timeline-labels" :style="{minHeight:`${plotHeight}px`}">
          <div v-for="row in rows" :key="row.id" class="timeline-list-entry" :class="[dropMarker(row),{reorderable:canReorder}]" :data-order-id="orderId(row)" :data-order-group="row.siblings" :style="{'--depth':row.depth}">
            <button v-if="!row.record" class="timeline-group-label" :data-group-id="row.group.id" :data-group-kind="row.group.kind" :style="{'--depth':row.depth,'--group-color':row.group.color||'var(--primary)'}" :aria-expanded="!collapsed.has(row.id)" :aria-label="`${collapsed.has(row.id)?'Expand':'Collapse'} ${row.group.name}`" :title="canReorder?'Drag to reorder · touch and hold · Alt+↑/↓':undefined" @pointerdown="beginRowOrder($event,row)" @keydown="reorder.keydown($event,orderId(row),row.siblings)" @click="toggleGroup(row.id)"><component :is="collapsed.has(row.id)?ChevronRight:ChevronDown" :size="16"/><span v-if="row.group.kind==='space'||row.group.kind==='category'" class="timeline-group-swatch" aria-hidden="true"></span><component v-else :is="groupIcon(row.group)" :size="16"/><strong>{{row.group.name}}</strong><span>{{row.group.count}}</span></button>
            <button v-else class="timeline-row-label" :class="{selected:row.record.id===selectedId,connected:connectedIds.has(row.record.id),completed:row.record.completed,'hover-linked':hoverLinked(row.record.id),'link-drop-target':drag?.kind==='link'&&drag.valid&&drag.targetId===row.record.id}" :style="{'--depth':row.depth}" :data-record-id="row.record.id" :data-category-id="row.group.categoryId" :aria-pressed="row.record.id===selectedId" :aria-label="row.record.title" :title="sourceLabel(row.record)+tagDescription(row.record)+(dependencyLinks.has(row.record.id)?` · ${dependencySummary(row.record)}`:'')+(canReorder?' · Drag to reorder · Alt+↑/↓':'')" v-on="hoverBindings(row.record.id)" @pointerdown="beginRowOrder($event,row)" @keydown="reorder.keydown($event,orderId(row),row.siblings)" @click="openRecord(row.record)">
              <span class="timeline-item-text"><component :is="recordIcon(row.record)" :size="19" :style="{color:sourceTint(row.record)}"/><span class="timeline-record-copy"><strong>{{row.record.title}}</strong><RecordTagMarkers class="timeline-row-tags" :tags="itemTags(row.record)" :compact="false" :limit="2"/></span><span v-if="dependencyLinks.has(row.record.id)" class="deck-link-badge dependency-badge" role="img" :aria-label="dependencySummary(row.record)" :title="dependencySummary(row.record)"><ArrowRight :size="12"/><span>{{dependencyLinks.get(row.record.id)?.size}}</span></span></span>
              <span class="timeline-status-cell"><span class="timeline-status" :class="statusClass(row.record)" :style="statusStyle(row.record)" :title="status(row.record)">{{status(row.record)}}</span></span>
              <time class="timeline-row-date" :class="{overdue:overdue(row.record)}" :datetime="row.record.due">{{row.record.due?dateLabel(row.record.due):'—'}}</time>
            </button>
          </div>
          <div v-if="!rows.length" class="timeline-empty-work"><FolderKanban :size="24"/><strong>No tasks or cards in this view</strong><span>Calendar events remain available {{taskOnly?'below':'above'}}.</span></div>
        </div>
        <div ref="plot" class="timeline-plot" :style="{height:`${plotHeight}px`}" @pointerdown="beginCreation($event,'plot')"><div v-if="newRange?.area==='plot'" class="timeline-new-range" :style="creationStyle" aria-hidden="true"></div>
          <div class="timeline-grid-lines"><div v-for="day in days" :key="dayKey(day)" :class="{weekend:[0,6].includes(day.getDay()),'active-day':axis&&activeDay===dayKey(day)}"></div></div>
          <div v-for="segment in eventSegments" :key="segment.key" class="timeline-event-band" :class="{linked:eventHighlighted(segment.event.record.id),selected:segment.event.record.id===selectedId}" :style="segmentStyle(segment)" :data-event-id="segment.event.record.id" :title="eventTitle(segment.event.record)" aria-hidden="true"></div>
          <div v-for="event in hoverEvents" :key="`hover:${event.record.id}`" class="timeline-event-band timeline-event-hover-band hover-band" :style="bandStyle(event)" :data-event-id="event.record.id" aria-hidden="true"></div>
          <div v-if="todayOffset>=0&&todayOffset<dayCount" class="today-line" :style="{left:`${(todayOffset+.5)/dayCount*100}%`}" title="Today"></div>
          <div v-for="row in rows" :key="row.id" class="timeline-chart-row" :class="{group:!row.record,selected:row.record?.id===selectedId,connected:row.record&&connectedIds.has(row.record.id),'hover-linked':row.record&&hoverLinked(row.record.id),'link-drop-target':drag?.kind==='link'&&drag.valid&&drag.targetId===row.record?.id}" :data-record-id="row.record?.id">
            <template v-if="!row.record&&collapsed.has(row.id)"><button v-for="span in closedGroupSpans.get(row.id)?.spans||[]" :key="span.record.id" class="timeline-group-span timeline-bar" :class="{point:span.point,selected:span.record.id===selectedId,'hover-linked':hoverLinked(span.record.id)}" :style="groupSpanStyle(span,row.id)" :data-summary-record-id="span.record.id" :title="span.record.title" :aria-label="`Open ${span.record.title}`" v-on="hoverBindings(span.record.id)" @click="openRecord(span.record)"></button></template>
            <template v-if="row.record">
              <button v-if="geometry(row.record).bar" class="timeline-bar" :class="{selected:row.record.id===selectedId,completed:row.record.completed,clippedStart:geometry(row.record).bar?.clippedStart,clippedEnd:geometry(row.record).bar?.clippedEnd,'hover-linked':hoverLinked(row.record.id),'can-drag':editable(row.record)}" :style="{...barStyle(geometry(row.record).bar),'--record-color':colorFor(row.record),'--source-color':sourceTint(row.record)}" :title="`${row.record.title} · Work range · ${dateLabel(row.record.start)} – ${dateLabel(row.record.due)}${tagDescription(row.record)}`" :aria-label="`Work range: ${row.record.title}, ${dateLabel(row.record.start)} to ${dateLabel(row.record.due)}`" v-on="hoverBindings(row.record.id)" @pointerdown="recordDrag($event,row.record)" @click="openRecord(row.record)"><span v-if="listCollapsed" class="timeline-bar-title">{{row.record.title}}</span><template v-if="editable(row.record)"><span v-if="!geometry(row.record).bar?.clippedStart" class="timeline-resize-handle start" :title="`Resize start of ${row.record.title}`" @pointerdown.stop="recordDrag($event,row.record,'start')"></span><span v-if="!geometry(row.record).bar?.clippedEnd" class="timeline-resize-handle end" :title="`Resize end of ${row.record.title}`" @pointerdown.stop="recordDrag($event,row.record,'end')"></span></template></button>
              <template v-for="plan in sessions.get(row.record.id)||[]" :key="plan.id"><button v-if="sessionRange(plan)" class="timeline-bar planned" :class="{'hover-linked':hoverLinked(row.record.id),'can-drag':canEditPlans&&!saving}" :data-plan-id="plan.id" :style="{...barStyle(sessionRange(plan)),'--record-color':colorFor(row.record),'--source-color':sourceTint(row.record)}" :title="`Work session: ${row.record.title}`" :aria-label="`Work session: ${row.record.title}`" v-on="hoverBindings(row.record.id)" @pointerdown="planDrag($event,row.record,plan)" @click="openRecord(row.record)"><template v-if="canEditPlans&&!saving"><span class="timeline-resize-handle start" title="Resize work session start" @pointerdown.stop="planDrag($event,row.record,plan,'start')"></span><span class="timeline-resize-handle end" title="Resize work session end" @pointerdown.stop="planDrag($event,row.record,plan,'end')"></span></template></button></template>
              <button v-if="geometry(row.record).point" class="timeline-deadline" :class="{start:geometry(row.record).point?.kind==='start','hover-linked':hoverLinked(row.record.id),'can-drag':editable(row.record)}" :style="pointStyle(row.record)" :title="`${row.record.title} · ${geometry(row.record).point?.kind==='due'?'Due':'Starts'} ${dateLabel(row.record.due||row.record.start)}`" :aria-label="`${row.record.title} ${geometry(row.record).point?.kind==='due'?'due':'starts'} ${dateLabel(row.record.due||row.record.start)}`" v-on="hoverBindings(row.record.id)" @pointerdown="recordDrag($event,row.record)" @click="openRecord(row.record)"><Diamond :size="16"/><span v-if="listCollapsed&&!geometry(row.record).bar" class="timeline-point-title">{{row.record.title}}</span></button>
              <button v-if="geometry(row.record).point&&editable(row.record)&&row.record.due&&!row.record.start" class="timeline-point-handle start" :style="pointStyle(row.record)" :aria-label="`Add start to ${row.record.title}`" title="Drag left to add a start date" @pointerdown="recordDrag($event,row.record,'start')" @click="openRecord(row.record)"></button>
              <button v-if="geometry(row.record).point&&editable(row.record)&&row.record.start&&!row.record.due" class="timeline-point-handle end" :style="pointStyle(row.record)" :aria-label="`Add due date to ${row.record.title}`" title="Drag right to add a due date" @pointerdown="recordDrag($event,row.record,'end')" @click="openRecord(row.record)"></button>
              <template v-for="event in linkedSessions.get(row.record.id)||[]" :key="event.record.id"><button class="timeline-session-link" :class="{selected:markerVisible(row.record,event),'hover-linked':hoverLinked(row.record.id)||hoverLinked(event.record.id),'can-drag':editable(event.record)}" :data-event-id="event.record.id" :style="markerStyle(event)" :title="`Reserved time: ${eventTitle(event.record)}`" :aria-label="`Open linked work session: ${event.record.title}`" v-on="hoverBindings(event.record.id)" @pointerdown="recordDrag($event,event.record,'move',row.record.id)" @click="openEvent(event.record)"><Link2 :size="12"/><span v-if="focused&&sessionLabel(row.record,event)" class="session-time-label" :class="{before:event.range.end>dayCount-.7}">{{sessionLabel(row.record,event)}}</span><template v-if="editable(event.record)"><span class="timeline-resize-handle start" title="Resize linked event start" @pointerdown.stop="recordDrag($event,event.record,'start',row.record.id)"></span><span class="timeline-resize-handle end" title="Resize linked event end" @pointerdown.stop="recordDrag($event,event.record,'end',row.record.id)"></span></template></button></template>
              <span v-if="!listCollapsed&&unscheduled(row.record)&&dependencySummary(row.record)" class="timeline-unscheduled dependency-context">Unscheduled · {{dependencySummary(row.record)}}</span>
              <span v-else-if="unscheduled(row.record)" class="timeline-unscheduled">{{listCollapsed?row.record.title+' · Unscheduled':'Unscheduled'}}</span>
              <span v-if="(!canLink||saving)&&point(row.record)===null&&dependencyLinks.has(row.record.id)" class="timeline-relation-anchor" aria-hidden="true"></span>
              <button v-if="canLink&&!saving" class="timeline-connector" :style="connectorStyle(row.record)" :aria-label="`Create dependency from ${row.record.title}`" title="Drag to a task or card that follows this one" @pointerdown="linkDrag($event,row.record)" @click.stop.prevent></button>
            </template>
          </div>
          <svg class="dependency-lines" :viewBox="`0 0 ${plotWidth} ${plotHeight}`" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="grouped-dependency-arrow" markerWidth="7" markerHeight="7" refX="7" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="currentColor"/></marker></defs><path v-for="path in paths" :key="path.id" class="dependency-path" :data-relation-id="path.id" :data-native="path.native" :d="path.d" fill="none" stroke="currentColor" stroke-width="1.7" marker-end="url(#grouped-dependency-arrow)"><title>{{path.title}}</title></path><path v-if="dragConnectorPath" class="proposed-dependency-path" :d="dragConnectorPath" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/></svg>
          <div v-if="dragRange&&drag?.rowId" class="timeline-edit-ghost" :style="dragGhostStyle" aria-hidden="true"></div>
        </div>
      </div>
    </div>
    <div v-if="!axis&&!compactControls" class="timeline-footer"><TimelineLegend/><small v-if="taskOnly" class="timeline-work-count">{{focused?`${visibleWorkCount} of ${itemCount}`:itemCount}} work items</small><template v-else><label class="calendar-bands-toggle"><input v-model="allBands" type="checkbox"/>All calendar bands</label><small v-if="outsideEventCount">{{outsideEventCount}} events outside this period</small></template></div>
    <button v-if="allRows.length>limit" class="load-more" @click="limit+=180"><ChevronDown :size="15"/>Show more rows · {{allRows.length-limit}} remaining</button>
    <div v-if="dragText&&drag" class="timeline-drag-tooltip" :class="{invalid:!drag.valid}" :style="{left:`${Math.min(drag.clientX+16,Math.max(8,drag.target.ownerDocument.documentElement.clientWidth-340))}px`,top:`${Math.max(8,drag.clientY-52)}px`}" role="status">{{dragText}}<small>Escape to cancel</small></div>
    <div v-if="newRange" class="timeline-creation-tooltip" :style="creationTooltipStyle" role="status">{{creationText}}<small>Release to create · Esc to cancel</small></div>
  </section>
  </UnscheduledTray>
</template>

<style scoped>
.timeline-days,.timeline-plot,.timeline-row-label,.timeline-group-label,.timeline-calendar-header,.timeline-empty-work{touch-action:none}.touch-edit-armed{outline:2px solid var(--primary)!important;outline-offset:2px;box-shadow:0 0 0 4px var(--primary-soft)}
.timeline-record-copy{display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;flex:1}.timeline-source-dot{width:8px;height:8px;border-radius:50%;border:1px solid color-mix(in srgb,var(--event-foreground) 50%,transparent);flex:0 0 8px}.timeline-item-text :deep(.record-tag-markers){max-width:100%}.timeline-item-text .timeline-row-tags{line-height:12px}.timeline-labels{container-name:work-list;container-type:inline-size}@container work-list (max-width:340px){.timeline-row-tags{display:none}}

.can-create-range .timeline-plot,.can-create-range .timeline-days,.can-create-range .timeline-calendar-header{cursor:default}.is-creating-range{user-select:none}
.timeline-new-range{position:absolute;z-index:12;pointer-events:none;border:2px solid var(--primary);border-radius:4px;background:color-mix(in srgb,var(--primary) 20%,transparent);min-width:4px}
.timeline-creation-tooltip{position:fixed;z-index:100;pointer-events:none;max-width:310px;background:var(--surface);border:1px solid var(--primary);box-shadow:0 4px 18px #0002;border-radius:7px;padding:8px 11px;font-size:12px;color:var(--text)}.timeline-creation-tooltip small{display:block;font-size:10px;color:var(--muted);margin-top:3px}

.grouped-timeline{--list-width:var(--timeline-list-width,clamp(420px,34vw,560px));--status-width:108px;--due-width:78px;border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden;min-width:0}
.timeline-scroll{overflow:auto;max-height:max(320px,var(--timeline-viewport-height,calc(100dvh - 260px)));min-height:300px;border:0;border-radius:0;isolation:isolate;scrollbar-gutter:stable}
.timeline-grid{display:grid;grid-template-columns:var(--list-width) minmax(var(--chart-min),1fr);min-width:calc(var(--list-width) + var(--chart-min));width:100%;gap:0;align-items:start}
.timeline-head-name{position:sticky;top:0;left:0;z-index:12;height:var(--header-height);display:grid;grid-template-columns:minmax(0,1fr) var(--status-width) var(--due-width);background:var(--surface);border-bottom:1px solid var(--border);border-right:1px solid var(--border);padding:0;color:var(--text);font-size:13px;font-weight:500}
.timeline-head-name>span{display:flex;align-items:center;padding:0 9px;border-right:1px solid var(--border);font-size:14px;letter-spacing:0;height:100%}.timeline-head-name>span:last-child{border-right:0}.timeline-title{justify-content:space-between;gap:5px}.timeline-title>strong{font-size:15px;font-weight:650;white-space:nowrap}.timeline-collapse-controls{display:flex;align-items:center;gap:0}.timeline-collapse-controls button{display:grid;place-items:center;width:25px;height:28px;padding:0;border:0;border-radius:6px;color:var(--muted);background:transparent}.timeline-collapse-controls button:hover{background:var(--hover);color:var(--text)}
.timeline-days{position:sticky;top:0;z-index:10;display:grid;grid-template-columns:repeat(var(--day-count),minmax(0,1fr));height:var(--header-height);background:var(--surface);border-bottom:1px solid var(--border)}
.timeline-days>div{height:var(--header-height);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1px;border-right:1px solid var(--border);padding:2px 0;color:var(--text)}
.timeline-days strong{font-size:13px;font-weight:600;line-height:20px}.timeline-days small{font-size:12px;color:var(--muted)}.timeline-days .today{box-shadow:inset 0 -3px var(--primary)}.timeline-days .today strong{color:var(--primary)}
.timeline-calendar-context{height:var(--event-header-height);position:sticky;top:var(--header-height);left:0;z-index:11;background:var(--surface);border-bottom:1px solid var(--border);border-right:1px solid var(--border);display:flex;align-items:flex-start;justify-content:space-between;gap:6px;padding:8px;color:var(--muted);font-size:12px}
.timeline-count{white-space:nowrap;line-height:26px}.timeline-event-picker{position:relative;margin-left:auto;min-width:0}.timeline-event-picker>summary{list-style:none;display:flex;align-items:center;gap:5px;font-size:12px;font-weight:400;color:var(--muted);padding:4px 0;margin:0;white-space:nowrap}.timeline-event-picker>summary::-webkit-details-marker{display:none}.timeline-overflow-count{font-size:10px;margin-left:2px;background:var(--hover);padding:1px 4px;border-radius:4px}
.timeline-event-list{position:absolute;right:0;top:32px;width:min(390px,calc(var(--list-width) - 26px));max-height:330px;overflow:auto;padding:6px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);border-radius:12px}.timeline-event-list>p{padding:12px;font-size:13px}.timeline-event-list>button{display:flex;align-items:center;gap:9px;width:100%;padding:10px 8px;border-radius:8px;text-align:left}.timeline-event-list>button:hover,.timeline-event-list>button.selected{background:var(--hover)}.timeline-event-list>button>span{flex:1;min-width:0}.timeline-event-list strong{display:block;font-size:13px;font-weight:500;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.timeline-event-list small{display:block;font-size:11px;color:var(--muted);margin-top:3px}
.timeline-calendar-header{position:sticky;top:var(--header-height);height:var(--event-header-height);z-index:9;background:var(--surface);border-bottom:1px solid var(--border);overflow:hidden}
.floating-events-mode .timeline-head-name,.floating-events-mode .timeline-calendar-context{top:auto}
.floating-events-mode .timeline-days,.floating-events-mode .timeline-calendar-header{position:relative;top:auto}
.timeline-event-chip.floated-original{visibility:hidden}
.floating-event-chip .event-chip-title{box-shadow:0 1px 4px #0004}
.floating-event-chip.previewing .event-chip-title{opacity:.55}
.timeline-event-chip{position:absolute;height:30px;padding:0 5px;z-index:4;text-align:left;border:0;background:transparent;overflow:hidden;border-radius:5px}.event-chip-title{display:flex;align-items:center;gap:4px;background:var(--record-color);border:1px solid var(--record-color);border-radius:5px;padding:2px 5px;max-width:100%;width:max-content;color:var(--event-foreground)}.event-chip-title strong{font-size:13px;line-height:17px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.timeline-event-chip.selected .event-chip-title{outline:2px solid var(--primary);outline-offset:0}.timeline-event-chip:hover .event-chip-title{filter:brightness(.92)}
.timeline-labels{position:sticky;left:0;z-index:5;background:var(--surface);border-right:1px solid var(--border)}
.timeline-list-entry{height:var(--row-height);position:relative}.timeline-list-entry.reorderable>.timeline-row-label,.timeline-list-entry.reorderable>.timeline-group-label{cursor:grab}.is-reordering .timeline-list-entry.reorderable>button{cursor:grabbing}.timeline-row-label,.timeline-group-label{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}.timeline-list-entry.reorder-before:before,.timeline-list-entry.reorder-after:after{content:'';position:absolute;inset-inline:0;height:3px;background:var(--primary);z-index:9;pointer-events:none}.timeline-list-entry.reorder-before:before{top:0}.timeline-list-entry.reorder-after:after{bottom:0}
.timeline-group-label,.timeline-row-label{width:100%;height:var(--row-height);min-height:var(--row-height);max-height:var(--row-height);border:0;border-bottom:1px solid var(--border);border-radius:0;background:var(--surface);color:var(--text);text-align:left;padding:0;cursor:pointer;overflow:hidden}
.timeline-group-label{display:flex;align-items:center;gap:6px;padding:0 9px 0 calc(8px + var(--depth)*14px);background:color-mix(in srgb,var(--hover) 55%,var(--surface));font-size:14px}.timeline-group-swatch{width:13px;height:13px;flex:none;border-radius:50%;background:var(--group-color)}.timeline-group-label svg:nth-child(2){color:var(--group-color)}.timeline-group-label strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;flex:1}.timeline-group-label>span{font-size:12px;color:var(--muted)}
.timeline-row-label{display:grid;gap:0;grid-template-columns:minmax(0,1fr) var(--status-width) var(--due-width);align-items:stretch}.timeline-row-label:hover{background:var(--hover)}.timeline-row-label.selected{background:var(--primary-soft);box-shadow:inset 3px 0 var(--primary)}.timeline-row-label.connected:not(.selected){background:color-mix(in srgb,var(--primary) 4%,var(--surface))}
.timeline-item-text{display:flex;align-items:center;gap:7px;min-width:0;padding:0 8px 0 calc(9px + var(--depth)*14px);border-right:1px solid var(--border)}.timeline-item-text svg{flex:none}.timeline-item-text strong{font-size:14px;font-weight:400;line-height:18px;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;display:block}.timeline-row-label.completed .timeline-item-text strong{color:var(--muted)}
.timeline-status-cell{display:flex;align-items:center;padding:0 7px;min-width:0;border-right:1px solid var(--border)}.timeline-status{font-size:12px;line-height:18px;padding:2px 6px;background:var(--hover);border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;color:var(--muted)}.timeline-status.done{color:var(--green);background:color-mix(in srgb,var(--green) 12%,var(--surface))}.timeline-status.progress{color:var(--primary);background:var(--primary-soft)}.timeline-status.cancelled{color:var(--muted);text-decoration:line-through}
.timeline-row-date{display:flex;align-items:center;padding:0 8px;font-size:12px;color:var(--text);white-space:nowrap}
.timeline-plot{position:relative;min-height:0;overflow:hidden;background:var(--surface)}.timeline-grid-lines{position:absolute;inset:0;display:grid;grid-template-columns:repeat(var(--day-count),minmax(0,1fr));pointer-events:none;z-index:0}.timeline-grid-lines>div{border-right:1px solid var(--border)}.weekend{background:color-mix(in srgb,var(--hover) 70%,transparent)}
.timeline-event-band{position:absolute;top:0;bottom:0;min-width:2px;background:color-mix(in srgb,var(--record-color) 8%,transparent);border-left:1px solid color-mix(in srgb,var(--record-color) 55%,transparent);border-right:1px solid color-mix(in srgb,var(--record-color) 55%,transparent);pointer-events:none;z-index:1}.timeline-event-band.linked,.timeline-event-band.selected{background:color-mix(in srgb,var(--record-color) 14%,transparent);border-color:var(--record-color)}.timeline-event-band.header-band{z-index:1}
.timeline-chart-row{height:var(--row-height);position:relative;border-bottom:1px solid var(--border);z-index:2;pointer-events:none}.timeline-chart-row>button{pointer-events:auto}.timeline-chart-row.group{background:color-mix(in srgb,var(--hover) 35%,transparent)}.timeline-chart-row.selected{background:color-mix(in srgb,var(--primary) 7%,transparent)}.timeline-chart-row.connected:not(.selected){background:color-mix(in srgb,var(--primary) 3%,transparent)}
.today-line{position:absolute;top:0;bottom:0;width:1px;background:var(--primary);z-index:2;pointer-events:none;opacity:.35}
.timeline-bar{overflow:visible;position:absolute;top:calc(var(--row-center) - 8px);height:16px;min-width:4px;padding:0;display:block;border:1px solid var(--record-color);border-left:3px solid var(--source-color,var(--record-color));border-radius:5px;background:color-mix(in srgb,var(--record-color) 70%,var(--surface));cursor:pointer;z-index:3;box-shadow:none}.timeline-bar.selected{outline:2px solid var(--primary);outline-offset:0}.timeline-bar.planned{border-style:dashed;background:color-mix(in srgb,var(--record-color) 20%,var(--surface));top:calc(var(--row-center) + 5px);height:11px;border-radius:4px}.timeline-bar.completed{opacity:.7}.timeline-bar.clippedStart{border-top-left-radius:0;border-bottom-left-radius:0;border-left-style:dashed}.timeline-bar.clippedEnd{border-top-right-radius:0;border-bottom-right-radius:0;border-right-style:dashed}.timeline-bar:hover{filter:brightness(.94);z-index:5;outline:2px solid var(--primary)}
.timeline-deadline{position:absolute;top:calc(var(--row-center) - 11px);transform:translateX(-50%);height:22px;width:22px;display:grid;place-items:center;background:transparent;color:var(--record-color);border:0;border-radius:5px;padding:1px;cursor:pointer;z-index:4}.timeline-deadline svg{fill:var(--record-color);stroke:var(--source-color,var(--record-color));stroke-width:2}.timeline-deadline.start svg{fill:var(--surface)}.timeline-deadline:hover{outline:1px solid var(--record-color)}
.timeline-session-link{position:absolute;top:calc(var(--row-center) - 9px);transform:translateX(-50%);display:grid;place-items:center;width:28px;height:28px;border-radius:50%;border:1px solid var(--record-color);background:var(--surface);color:var(--record-color);z-index:6;padding:0;box-shadow:0 1px 4px #0002}.timeline-session-link:hover{outline:2px solid var(--primary)}
.timeline-unscheduled{font-style:normal;position:absolute;left:28px;top:calc(var(--row-center) - 8px);font-size:12px;color:var(--muted);white-space:nowrap;pointer-events:none}.dependency-lines{position:absolute;inset:0;width:100%;height:100%;color:var(--primary);pointer-events:none;z-index:1;overflow:visible}
.timeline-empty-work{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:calc(var(--row-height)*4);padding:12px;text-align:center;color:var(--muted);font-size:12px}.timeline-empty-work strong{font-size:14px;font-weight:500}
.timeline-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;border-top:1px solid var(--border);padding:7px 10px;color:var(--muted)}.timeline-footer small{font-size:11px}.timeline-key{display:flex;gap:18px!important;flex-wrap:wrap;font-size:11px}.timeline-key>span{display:flex;align-items:center;gap:6px}.key-line{margin-left:0;height:10px;width:28px;border:1px solid var(--primary);border-radius:3px;background:color-mix(in srgb,var(--primary) 65%,var(--surface))}.key-event{height:18px;width:18px;border:1px solid color-mix(in srgb,var(--primary) 55%,transparent);border-radius:3px;background:var(--primary-soft)}
.grouped-timeline button:focus-visible,.timeline-event-picker>summary:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}.load-more{width:100%;border:0;border-top:1px solid var(--border);border-radius:0;padding:12px;background:var(--surface);color:var(--primary);display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;font-size:12px}
@media(max-width:1100px){.grouped-timeline{--list-width:var(--timeline-list-width,430px);--status-width:96px;--due-width:72px}.timeline-title>strong{font-size:14px}.timeline-row-date{padding:0 8px;font-size:11px}.timeline-item-text{gap:8px}.timeline-item-text strong{font-size:13px}.timeline-status-cell{padding:0 8px}}
@media(max-width:600px){.grouped-timeline{--list-width:240px;--status-width:0px;--due-width:0px}.timeline-scroll{max-height:65vh}.timeline-head-name{grid-template-columns:1fr}.timeline-head-name>span:not(:first-child){display:none}.timeline-title>strong{font-size:14px}.timeline-calendar-context{padding:10px;flex-direction:column;justify-content:center;gap:2px}.timeline-count{display:none}.timeline-event-picker{margin-left:0}.timeline-overflow-count{display:none}.timeline-row-label{grid-template-columns:1fr}.timeline-status-cell,.timeline-row-date{display:none}.timeline-item-text{border-right:0}.timeline-item-text strong{font-size:13px}.timeline-item-text svg{width:17px}.timeline-group-label{font-size:14px}.timeline-event-list{left:0;right:auto;width:218px}.timeline-footer{padding:10px}.timeline-key{gap:10px;font-size:10px}}
.calendar-day-summaries{display:grid;grid-template-columns:repeat(var(--day-count),minmax(0,1fr));height:100%;position:relative;z-index:2}.calendar-day-summary{display:flex;flex-direction:column;justify-content:center;gap:4px;text-align:left;padding:7px 9px;min-width:0;border:0;border-right:1px solid var(--border);border-radius:0;color:var(--text);background:var(--surface)}.calendar-day-summary:hover,.calendar-day-summary.selected{background:var(--primary-soft)}.calendar-day-summary>span{display:flex;gap:5px;align-items:center;min-width:0}.calendar-day-summary strong{font-size:11px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.calendar-day-summary>span>small{font-size:10px;color:var(--muted);margin-left:auto}.calendar-day-title{font-size:12px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;font-weight:400}.calendar-day-summary.empty{color:var(--muted)}.calendar-day-summary.empty svg{display:none}.day-agenda-heading{display:flex;align-items:center;justify-content:space-between;padding:8px 9px 10px;border-bottom:1px solid var(--border)}.day-agenda-heading>strong{font-size:13px}.day-agenda-heading>button{font-size:12px;color:var(--primary);padding:4px}
.calendar-bands-toggle{display:flex;flex-direction:row;align-items:center;gap:7px;font-size:12px;font-weight:400;white-space:nowrap;margin-left:auto;color:var(--muted)}.calendar-bands-toggle input{width:14px;height:14px}
.timeline-bar{top:calc(var(--row-center) - 8px);height:16px;background:color-mix(in srgb,var(--record-color) 9%,var(--surface));border-color:color-mix(in srgb,var(--record-color) 40%,var(--surface));border-radius:3px}.timeline-bar.selected{background:color-mix(in srgb,var(--record-color) 18%,var(--surface));outline:1px solid var(--record-color)}.timeline-bar.planned{top:calc(var(--row-center) + 5px);height:11px;background:color-mix(in srgb,var(--record-color) 60%,var(--surface))}.timeline-deadline{top:calc(var(--row-center) - 11px)}.timeline-deadline svg{stroke:var(--surface);stroke-width:1.5}.timeline-deadline.start svg{stroke:var(--record-color)}
.timeline-session-link{top:calc(var(--row-center) - 9px);height:18px;min-width:4px;transform:none;display:flex;align-items:center;justify-content:center;overflow:visible;border-radius:3px;padding:0;background:var(--record-color);color:var(--surface);border:1px solid var(--record-color);box-shadow:none}.timeline-session-link svg{opacity:0}.timeline-session-link:hover,.timeline-session-link.selected{outline:2px solid var(--surface);box-shadow:0 0 0 3px var(--record-color);z-index:7}.timeline-session-link:hover svg,.timeline-session-link.selected svg{opacity:1;min-width:19px;height:19px;padding:3px;background:var(--surface);color:var(--record-color);border-radius:50%;box-shadow:0 0 0 1px var(--record-color)}
.focused-timeline .timeline-event-band{background:color-mix(in srgb,var(--record-color) 5%,transparent);border-color:color-mix(in srgb,var(--record-color) 24%,transparent)}.focused-timeline .timeline-event-band.selected,.focused-timeline .timeline-event-band.linked{background:color-mix(in srgb,var(--record-color) 9%,transparent);border-color:color-mix(in srgb,var(--record-color) 45%,transparent)}.key-line{height:8px;background:color-mix(in srgb,var(--primary) 9%,var(--surface));border-color:color-mix(in srgb,var(--primary) 40%,var(--surface))}
.session-time-label{position:absolute;left:calc(100% + 7px);top:-2px;white-space:nowrap;font-size:11px;line-height:20px;color:var(--text);background:var(--surface);border-radius:4px;padding:0 4px;max-width:150px;overflow:hidden;text-overflow:ellipsis}.session-time-label.before{left:auto;right:calc(100% + 7px)}.timeline-session-link:hover .session-time-label{text-decoration:underline}
.task-only-timeline{display:flex;flex-direction:column;height:100%;min-height:0}
.task-only-timeline .timeline-scroll{flex:1 1 auto;min-height:0;max-height:none}
.task-only-timeline .timeline-footer{flex:none;min-height:30px;padding:6px 12px;gap:6px 12px}
.task-only-timeline .timeline-key{gap:12px!important}
.task-only-timeline .timeline-work-count{white-space:nowrap;margin-left:auto}
.task-only-timeline .load-more{flex:none;padding:6px 12px}
.unified-axis-timeline{border:0;border-radius:0}
.unified-axis-timeline .timeline-scroll{overflow-x:hidden;overflow-y:auto;scrollbar-gutter:stable}
.unified-axis-timeline .timeline-days>div{position:relative}
.unified-axis-timeline .timeline-days>.active-day{background:var(--primary-soft)}
.unified-axis-timeline .timeline-grid-lines>.active-day{background:color-mix(in srgb,var(--primary) 5%,transparent)}
.compact-axis-list .timeline-head-name,.compact-axis-list .timeline-row-label{grid-template-columns:1fr}
.compact-axis-list .timeline-head-name>span:not(:first-child),.compact-axis-list .timeline-status-cell,.compact-axis-list .timeline-row-date{display:none}
.compact-axis-list .timeline-item-text{border-right:0}
.compact-axis-list .timeline-title>strong{font-size:14px}
.timeline-create-event{position:absolute;right:3px;top:3px;display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;color:var(--muted);background:var(--surface);opacity:0}
.timeline-days>div:hover .timeline-create-event,.timeline-create-event:focus-visible{opacity:1}
.timeline-create-event:hover{color:var(--primary);background:var(--primary-soft)}
.timeline-item-text>strong{min-width:0;flex:1}
.deck-link-badge{display:inline-flex;align-items:center;gap:3px;flex:none;margin-left:auto;padding:2px 4px;font-size:10px;line-height:14px;color:var(--muted);background:var(--hover);border-radius:5px}
.timeline-row-label.hover-linked:not(.selected){background:color-mix(in srgb,var(--primary) 9%,var(--surface));box-shadow:inset 2px 0 color-mix(in srgb,var(--primary) 50%,transparent)}
.timeline-chart-row.hover-linked:not(.selected){background:color-mix(in srgb,var(--primary) 7%,transparent)}
.timeline-bar.hover-linked:not(.selected),.timeline-deadline.hover-linked{outline:1px solid var(--primary);outline-offset:2px}
.timeline-session-link.hover-linked{outline:2px solid var(--surface);box-shadow:0 0 0 3px var(--record-color);z-index:7}
.timeline-event-chip.hover-linked .event-chip-title{outline:1px solid var(--primary);outline-offset:1px}
.timeline-event-list>button.hover-linked{background:var(--primary-soft)}
.dependency-path{stroke-linecap:round;stroke-linejoin:round;opacity:.9}
.deck-link-path{stroke:var(--primary);stroke-width:1.7;stroke-dasharray:4 4;stroke-linecap:round;stroke-linejoin:round;opacity:.82}
.timeline-event-band.hover-band,.focused-timeline .timeline-event-band.hover-band{background:color-mix(in srgb,var(--record-color) 23%,transparent);border-color:var(--record-color);box-shadow:inset 1px 0 var(--record-color),inset -1px 0 var(--record-color);z-index:1}
.deck-link-context{position:absolute;left:14px;top:12px;display:flex;align-items:center;gap:6px;height:24px;max-width:min(480px,calc(100% - 28px));padding:3px 7px;border:1px dashed var(--border);border-radius:5px;background:var(--surface);color:var(--muted);font-size:11px;text-align:left;z-index:4}
.deck-link-context>svg{flex:none}.deck-link-context>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.deck-link-context:hover{color:var(--primary);border-color:var(--primary)}
.compact-date-columns .timeline-days>div{padding:4px 0;overflow:hidden}.compact-date-columns .timeline-days small{font-size:10px;white-space:nowrap}
.can-drag{cursor:grab;touch-action:none}.is-dragging,.is-reordering{user-select:none}.is-dragging .can-drag{cursor:grabbing}
.timeline-resize-handle{pointer-events:auto;position:absolute;top:-3px;bottom:-3px;width:6px;z-index:9;cursor:ew-resize;touch-action:none;border-radius:2px;opacity:.55;background:var(--record-color)}
.timeline-resize-handle.start{left:-6px}.timeline-resize-handle.end{right:-6px}.timeline-bar:hover .timeline-resize-handle,.timeline-session-link:hover .timeline-resize-handle{opacity:1}
.timeline-event-chip .timeline-resize-handle{top:0;bottom:0;opacity:0}.timeline-event-chip .timeline-resize-handle.start{left:0}.timeline-event-chip .timeline-resize-handle.end{right:0}.timeline-event-chip:hover .timeline-resize-handle{opacity:.7}
.timeline-point-handle{position:absolute;top:calc(var(--row-center) - 9px);width:8px;height:18px;border:0;border-radius:2px;padding:0;background:transparent;color:var(--record-color);cursor:ew-resize;touch-action:none;z-index:8}
.timeline-point-handle.start{transform:translateX(-21px);border-left:3px solid currentColor}.timeline-point-handle.end{transform:translateX(13px);border-right:3px solid currentColor}.timeline-point-handle:hover{background:var(--primary-soft)}
.timeline-connector{position:absolute;top:calc(var(--row-center) - 6px);width:12px;height:12px;min-width:0;padding:0;border:2px solid var(--primary);border-radius:50%;background:var(--surface);transform:translateX(-50%);cursor:default;touch-action:none;z-index:10}
.timeline-relation-anchor{position:absolute;left:20px;top:calc(var(--row-center) - 5px);width:10px;height:10px;border:1px solid var(--primary);border-radius:50%;background:var(--surface);transform:translateX(-50%);z-index:6}
.timeline-connector:hover,.timeline-connector:focus-visible{box-shadow:0 0 0 3px var(--primary-soft)}.link-drop-target{box-shadow:inset 0 0 0 2px var(--primary)!important;background:var(--primary-soft)!important}
.timeline-edit-ghost{position:absolute;min-width:4px;background:color-mix(in srgb,var(--record-color) 25%,var(--surface));border:2px dashed var(--record-color);border-radius:3px;z-index:12;pointer-events:none}
.timeline-drag-tooltip{position:fixed;z-index:80;max-width:330px;padding:9px 12px;border:1px solid var(--primary);border-radius:8px;background:var(--surface);box-shadow:var(--shadow);color:var(--text);font-size:12px;line-height:18px;pointer-events:none}
.timeline-drag-tooltip small{display:block;font-size:10px;color:var(--muted)}.timeline-drag-tooltip.invalid{border-color:var(--muted)}
.dependency-context,.deck-link-context{left:28px;max-width:calc(100% - 40px)}

.timeline-bar{border-left-color:var(--source-color,var(--record-color))}.timeline-deadline svg,.timeline-deadline.start svg{stroke:var(--source-color,var(--record-color))}
.dense-timeline .timeline-head-name>span{padding-inline:6px}.dense-timeline .timeline-item-text{gap:5px;padding-inline:calc(6px + var(--depth)*12px) 6px}.dense-timeline .timeline-group-label{gap:5px;padding-inline:calc(5px + var(--depth)*12px) 6px}.dense-timeline .timeline-status-cell,.dense-timeline .timeline-row-date{padding-inline:5px}.dense-timeline .timeline-record-copy{gap:0}.dense-timeline .timeline-item-text strong{font-size:13px;line-height:17px}.dense-timeline .timeline-calendar-context{padding:5px 6px}.dense-timeline .timeline-footer{padding:5px 7px}.dense-timeline .timeline-collapse-controls button{height:32px}
.timeline-list-toggle{display:grid;place-items:center;flex:none;width:28px;height:36px;padding:0;border:0;background:transparent;color:var(--muted)}.timeline-list-toggle:hover{color:var(--primary);background:var(--hover)}
.list-collapsed.floating-events-mode .timeline-head-name{top:0}
.list-collapsed .timeline-head-name{display:block}.list-collapsed .timeline-title{padding:0!important;justify-content:center}.list-collapsed .timeline-list-toggle{width:38px;height:100%}.list-collapsed .timeline-title>strong,.list-collapsed .timeline-collapse-controls,.list-collapsed .timeline-head-name>span:not(:first-child){display:none}
.list-collapsed .timeline-row-label{display:block}.list-collapsed .timeline-item-text{justify-content:center;padding:0!important;height:100%;border:0}.list-collapsed .timeline-record-copy,.list-collapsed .timeline-status-cell,.list-collapsed .timeline-row-date,.list-collapsed .deck-link-badge{display:none}.list-collapsed .timeline-group-label{padding:0!important;justify-content:center}.list-collapsed .timeline-group-label>*:not(:first-child){display:none}.list-collapsed .timeline-calendar-context{padding:0}.list-collapsed .timeline-count,.list-collapsed .timeline-event-picker summary>*:not(:first-child){display:none}.list-collapsed .timeline-event-picker summary{font-size:0;padding:4px}.list-collapsed .timeline-empty-work{padding:0}.list-collapsed .timeline-empty-work>strong,.list-collapsed .timeline-empty-work>span{display:none}
.timeline-bar-title{pointer-events:none;position:absolute;left:var(--label-offset,4px);width:var(--label-width,calc(100% - 8px));top:-1px;line-height:16px;font-size:11px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}.timeline-point-title{pointer-events:none;position:absolute;left:calc(50% + var(--label-offset,14px));width:var(--label-width,180px);line-height:18px;font-size:11px;color:var(--text);background:var(--surface);border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left}
.timeline-group-span.timeline-bar{min-width:0;border:0;padding:0;background:transparent;box-shadow:none;cursor:pointer;border-radius:0}.timeline-group-span::before{content:'';position:absolute;top:7px;left:0;width:var(--span-visible-width);height:4px;border-radius:2px;background:var(--record-color);border-left:2px solid var(--source-color);box-sizing:border-box;pointer-events:none}.timeline-group-span.point{transform:translateX(-7px)}.timeline-group-span.point::before{left:5px;height:6px;top:6px;transform:rotate(45deg)}.timeline-group-span:hover,.timeline-group-span:focus-visible{outline:1px solid var(--primary);outline-offset:0;background:var(--primary-soft)}
</style>

<style scoped>
.timeline-days,.timeline-plot,.timeline-row-label,.timeline-group-label,.timeline-calendar-header{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
</style>
