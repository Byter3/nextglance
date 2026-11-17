<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { CalendarDays, Plus, CircleCheck, PanelsTopLeft, RotateCcw } from 'lucide-vue-next'
import OverviewAgenda from './OverviewAgenda.vue'
import UnscheduledTray from './UnscheduledTray.vue'
import {unscheduledRecords} from '@nextspace/core/unscheduled.mjs'
import RecordTagMarkers from './RecordTagMarkers.vue'
import {recordTags} from '@nextspace/core/record-presentation.mjs'
import type { OverviewAxis, PlanSession, RecordTag, Relation, WorkspaceRecord } from '@nextspace/contracts'
import { clockTime, dateValue, dayKey } from './planner-ui'
import { calendarItem, calendarAllDayLayout, calendarTimedItems, calendarDaySummary, type CalendarItem, type CalendarAllDayItem } from '@nextspace/core/calendar-items.mjs'
import { horizontalWheelDelta } from '@nextspace/core/date-wheel.mjs'
import {touchHourZoom,touchCalendarDateZoom} from '@nextspace/core/touch-gestures.mjs'
import {useDateCanvas} from './useDateCanvas'
import {usePlannerTouch} from './usePlannerTouch'
import {usePinnedItemLabels} from './usePinnedItemLabels'
import {calendarTouchEligible,panCalendarVertical} from './calendarTouchSurface'
import {calendarViewportDays,visibleAllDayLayout,calendarAllDaySize} from '@nextspace/core/calendar-sizing.mjs'
import {calendarTimedLayout,calendarDateWindow,calendarLaneWindow} from '@nextspace/core/calendar-rendering.mjs'
import {useDateLabels} from './useDateLabels'
import {useAllDayResize} from './useAllDayResize'
import CalendarAllDayDivider from './CalendarAllDayDivider.vue'
import './calendar-density.css'
import { creationSelection, type CreationRange, type CreationSelection } from '@nextspace/core/range-selection.mjs'
import { calendarMoveEdit, calendarPlanMove } from '@nextspace/core/calendar-edit.mjs'
import type {TimelineDateEdit} from '@nextspace/core/timeline-edit.mjs'
const props=withDefaults(defineProps<{preferenceKey?:string;persistPresentation?:boolean;mode?:'day'|'week'|'month';contextCollapsed?:boolean;contextRecordIds?:string[];scopeId?:string;records:WorkspaceRecord[];plans:PlanSession[];days:Date[];anchor?:Date;selectedId?:string|null;colorFor:(record:WorkspaceRecord)=>string;sourceColorFor?:(record:WorkspaceRecord)=>string;tagsFor?:(record:WorkspaceRecord)=>RecordTag[];canCreate?:boolean;canEditRecord?:(record:WorkspaceRecord)=>boolean;canEditPlans?:boolean;embedded?:boolean;relatedIds?:string[];axis?:OverviewAxis;focusId?:string;contextTitle?:string;contextDetail?:string;activeDay?:string;hoveredId?:string|null;highlightedIds?:string[];relations?:Relation[]}>(),{mode:'week',scopeId:'all',embedded:false,relatedIds:()=>[],highlightedIds:()=>[],relations:()=>[]})
const sourceTint=(record:WorkspaceRecord)=>props.sourceColorFor?.(record)||props.colorFor(record)
const tagsByRecord=computed(()=>new WeakMap(props.records.map(record=>[record,props.tagsFor?.(record)||recordTags(record)] as const)))
const itemTags=(record:WorkspaceRecord)=>tagsByRecord.value.get(record)||props.tagsFor?.(record)||recordTags(record)
const contextIds=computed(()=>new Set(props.contextRecordIds||[]))
const recordTooltip=(record:WorkspaceRecord,label:string)=>`${contextIds.value.has(record.id)?'Linked context · ':''}${label}: ${record.title}\nSource: ${record.collectionTitle||record.source}${itemTags(record).length?'\nTags: '+itemTags(record).map(tag=>tag.title).join(', '):''}`
const emit=defineEmits<{open:[record:WorkspaceRecord];create:[range:CreationRange];horizontalScroll:[left:number];datePan:[delta:number];dateZoomStart:[centerPixel:number];dateZoom:[intent:{scale:number;centerPixel:number}];focusDate:[date:string];scrollbarWidth:[width:number];hover:[id:string|null];dateEdit:[edit:TimelineDateEdit];planEdit:[edit:{id:string;start:string;end:string}]}>()
const root=ref<HTMLElement>()
const hourHeight=ref(48)
const scroller=ref<HTMLElement>()
const headingScroller=ref<HTMLElement>()
const allDayScroller=ref<HTMLElement>()
const allDayScrollTop=ref(0)
const mainScroller=ref<HTMLElement>()
const calendarContent=ref<HTMLElement>()
const availableCalendarHeight=ref(400)
const scrollbarWidth=ref(0)
const calendarViewportHeight=ref(0)
const pointerId=ref<string|null>(null),focusId=ref<string|null>(null)
const hoveredRecordId=computed(()=>props.hoveredId===undefined?pointerId.value||focusId.value:props.hoveredId)
const relatedIdsSet=computed(()=>new Set([...props.relatedIds,...props.relations.filter(link=>link.type==='scheduled_during'&&(link.fromId===props.selectedId||link.toId===props.selectedId)).map(link=>link.fromId===props.selectedId?link.toId:link.fromId)]))
const highlightedIdsSet=computed(()=>new Set([...props.highlightedIds,...props.relations.filter(link=>hoveredRecordId.value&&(link.fromId===hoveredRecordId.value||link.toId===hoveredRecordId.value)).map(link=>link.fromId===hoveredRecordId.value?link.toId:link.fromId)]))
const sharedAxis=computed(()=>props.embedded&&Boolean(props.axis))
const localViewportWidth=ref(800)
const horizontalZoomWidth=ref<number>()
const localDayWidth=computed(()=>horizontalZoomWidth.value===undefined?Math.max(85,(localViewportWidth.value-53)/Math.max(1,props.days.length)):Math.max(12,(localViewportWidth.value-53)/90,Math.min(1440,horizontalZoomWidth.value)))
const localVisibleDays=computed(()=>horizontalZoomWidth.value===undefined?props.days.length:Math.max(1,Math.min(90,Math.ceil((localViewportWidth.value-53)/localDayWidth.value))))
const canvas=useDateCanvas(()=>({anchor:dayKey(props.anchor||props.days[0]||new Date()),visibleDays:localVisibleDays.value,dayWidth:localDayWidth.value,scope:props.scopeId}),anchor=>{if(!sharedAxis.value)emit('focusDate',anchor)})
const days=computed(()=>sharedAxis.value?props.days:Array.from({length:canvas.renderDays.value},(_,index)=>{const day=dateValue(canvas.anchor.value);day.setDate(day.getDate()+index);return day}))
const dateLabels=useDateLabels(()=>days.value)
const timeZoneLabel=Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()?.replaceAll('_',' ')
const embeddedStyle=computed(()=>({'--calendar-hour-height':`${hourHeight.value}px`,
  '--all-day-height':`${allDaySize.value.height}px`,
  '--calendar-days':Math.max(1,days.value.length),
  '--calendar-scrollbar':`${scrollbarWidth.value}px`,
  '--calendar-grid-width':`${(props.axis?.labelWidth||53)+days.value.length*(props.axis?.dayWidth||localDayWidth.value)}px`,
  '--calendar-label-width':`${props.axis?.labelWidth||53}px`,
  '--calendar-day-width':`${props.axis?.dayWidth||localDayWidth.value}px`,
  '--calendar-viewport-height':`${calendarViewportHeight.value}px`,
}))
const hours=Array.from({length:24},(_,i)=>i)
const now=ref(new Date())
const minute=computed(()=>now.value.getHours()*60+now.value.getMinutes())
let clockTimer:ReturnType<typeof setInterval>|undefined
let sizeObserver:ResizeObserver|undefined
let reportedScrollbarWidth:number|undefined
const pinnedLabels=usePinnedItemLabels(()=>[{viewport:allDayScroller.value,selector:'.all-day-event',gutter:props.axis?.labelWidth||53},{viewport:scroller.value,selector:'.calendar-event',gutter:props.axis?.labelWidth||53}])
const pinSourceEdges=pinnedLabels.update
type NewRange={pointerId:number;target:HTMLElement;timed:boolean;from:number;originX:number;originY:number;clientX:number;clientY:number;moved:boolean;selection:CreationSelection}
const newRange=ref<NewRange|null>(null)
function selectedOffset(event:PointerEvent,target:HTMLElement,timed:boolean){
  const first=target.querySelector<HTMLElement>(timed?'.calendar-day-track':'.all-day-cell')
  if(!first)return undefined
  const bounds=first.getBoundingClientRect(),day=(event.clientX-bounds.left)/Math.max(1,bounds.width)
  if(!timed)return Math.max(0,Math.min(days.value.length-.0001,day))
  const index=Math.max(0,Math.min(days.value.length-1,Math.floor(day)))
  return index+Math.max(0,Math.min(1,(event.clientY-bounds.top)/(hourHeight.value*24)))
}
function beginCreation(event:PointerEvent,timed:boolean){
  const target=event.currentTarget as HTMLElement,hit=event.target as HTMLElement
  if(!props.canCreate||event.button!==0||hit.closest('button,input,select,a,.all-day-gutter,.calendar-hour-labels')||newRange.value||drag.value)return
  const from=selectedOffset(event,target,timed)
  if(from===undefined||!days.value.length)return
  if(event.pointerType==='touch'){touch.tap(event,()=>{if(props.canCreate)emit('create',creationSelection(days.value[0]!,from,from,{daysCount:days.value.length,timed,origin:'calendar'}).range)});return}
  event.preventDefault();event.stopPropagation()
  newRange.value={pointerId:event.pointerId,target,timed,from,originX:event.clientX,originY:event.clientY,clientX:event.clientX,clientY:event.clientY,moved:false,selection:creationSelection(days.value[0]!,from,from,{daysCount:days.value.length,timed,origin:'calendar'})}
  target.setPointerCapture(event.pointerId)
}
function moveCreation(event:PointerEvent){
  const current=newRange.value
  if(!current||current.pointerId!==event.pointerId)return
  const to=selectedOffset(event,current.target,current.timed)
  if(to===undefined)return
  const moved=current.moved||Math.hypot(event.clientX-current.originX,event.clientY-current.originY)>=4
  newRange.value={...current,clientX:event.clientX,clientY:event.clientY,moved,selection:creationSelection(days.value[0]!,current.from,to,{daysCount:days.value.length,timed:current.timed,dragged:moved,origin:'calendar'})}
  event.preventDefault()
}
function cancelCreation(){const current=newRange.value;newRange.value=null;if(current?.target.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId)}
function finishCreation(event:PointerEvent){const current=newRange.value;if(!current||current.pointerId!==event.pointerId)return;event.preventDefault();event.stopPropagation();cancelCreation();if(props.canCreate)emit('create',current.selection.range)}
function creationKey(event:KeyboardEvent){if(event.key==='Escape'&&(newRange.value||drag.value)){event.preventDefault();event.stopPropagation();cancelCreation();cancelDrag()}}
function createDay(day:Date){if(props.canCreate)emit('create',creationSelection(day,0,0,{daysCount:1,origin:'calendar'}).range)}
function timedCreationStyle(index:number){
  const current=newRange.value
  if(!current?.timed)return undefined
  const start=Math.max(index,current.selection.startOffset),end=Math.min(index+1,current.selection.endOffset)
  if(end<=start)return undefined
  return {top:`${(start-index)*24*hourHeight.value}px`,height:`${Math.max(12,(end-start)*24*hourHeight.value)}px`}
}
const allDayCreationStyle=computed(()=>newRange.value&&!newRange.value.timed?{gridColumn:`${newRange.value.selection.startOffset+2} / ${newRange.value.selection.endOffset+2}`} : undefined)
const creationTooltipStyle=computed(()=>newRange.value?{left:`${Math.max(8,Math.min(newRange.value.clientX+14,window.innerWidth-330))}px`,top:`${Math.max(8,Math.min(newRange.value.clientY-42,window.innerHeight-70))}px`}:undefined)
const creationText=computed(()=>{
  const range=newRange.value?.selection.range
  if(!range)return ''
  const end=dateValue(range.end);if(range.allDay)end.setDate(end.getDate()-1)
  const label=(value:Date)=>value.toLocaleDateString(undefined,{month:'short',day:'numeric'})+(range.allDay?'':` ${clockTime(value.toISOString())}`)
  return `Create · ${label(dateValue(range.start))} → ${label(end)}`
})
type ItemDrag={pointerId:number;item:CalendarItem;plan?:PlanSession;originX:number;originY:number;clientX:number;clientY:number;dayWidth:number;scrollLeft:number;scrollTop:number;moved:boolean;valid:boolean;dateEdit?:TimelineDateEdit|null;planEdit?:{id:string;start:string;end:string}|null}
const drag=ref<ItemDrag|null>(null)
let suppressClickUntil=0
function canMoveItem(item:CalendarItem){return item.planned?Boolean(props.canEditPlans&&props.plans.some(plan=>plan.id===item.id)):!item.record.readonly&&Boolean(props.canEditRecord?.(item.record))}
function beginMove(event:PointerEvent,item:CalendarItem,armed=false){
  if(event.button!==0||drag.value||newRange.value||!root.value||!canMoveItem(item))return
  if(event.pointerType==='touch'&&!armed){touch.edit(event,{target:event.currentTarget as HTMLElement,eligible:()=>{const latest=props.records.find(record=>record.id===item.record.id);return Boolean(latest&&canMoveItem({...item,record:latest}))},arm:()=>beginMove(event,item,true),move:moveItem,end:finishMove,cancel:cancelDrag});return}
  const first=root.value.querySelector<HTMLElement>(item.allDay?'.all-day-cell':'.calendar-day-track')
  if(!first)return
  const plan=item.planned?props.plans.find(plan=>plan.id===item.id):undefined
  event.preventDefault();event.stopPropagation()
  drag.value={pointerId:event.pointerId,item:{...item,record:{...item.record}},plan:plan?{...plan}:undefined,originX:event.clientX,originY:event.clientY,clientX:event.clientX,clientY:event.clientY,dayWidth:first.getBoundingClientRect().width,scrollLeft:(mainScroller.value?.scrollLeft||0)+(item.allDay?allDayScroller.value?.scrollLeft||0:scroller.value?.scrollLeft||0),scrollTop:scroller.value?.scrollTop||0,moved:false,valid:false}
  root.value.setPointerCapture(event.pointerId)
}
function moveItem(event:PointerEvent){
  const current=drag.value
  if(!current||current.pointerId!==event.pointerId)return
  if(!current.moved&&Math.hypot(event.clientX-current.originX,event.clientY-current.originY)<4)return
  event.preventDefault()
  const viewport=current.item.allDay?allDayScroller.value:scroller.value,bounds=viewport?.getBoundingClientRect(),mainBounds=mainScroller.value?.getBoundingClientRect()
  const first=root.value?.querySelector<HTMLElement>(current.item.allDay?'.all-day-cell':'.calendar-day-track')?.getBoundingClientRect()
  const left=sharedAxis.value?Math.max(bounds?.left||0,mainBounds?.left||0)+(props.axis?.labelWidth||0):Math.max(bounds?.left||0,mainBounds?.left||0,first?.left||0)
  const inside=Boolean(bounds&&mainBounds&&event.clientX>=left&&event.clientX<Math.min(bounds.right,mainBounds.right)&&event.clientY>=bounds.top&&event.clientY<bounds.bottom)
  const scrollLeft=(mainScroller.value?.scrollLeft||0)+(viewport?.scrollLeft||0)
  const days=Math.round((event.clientX-current.originX+scrollLeft-current.scrollLeft)/Math.max(1,current.dayWidth))
  const minutes=current.item.allDay?0:Math.round((event.clientY-current.originY+(scroller.value?.scrollTop||0)-current.scrollTop)/hourHeight.value*4)*15
  const dateEdit=current.plan?undefined:calendarMoveEdit(current.item.record,days,minutes),planEdit=current.plan?calendarPlanMove(current.plan,days,minutes):undefined
  drag.value={...current,moved:true,clientX:event.clientX,clientY:event.clientY,dateEdit,planEdit,valid:inside&&Boolean(dateEdit||planEdit)}
}
function cancelDrag(){const current=drag.value;drag.value=null;if(current?.moved)suppressClickUntil=Date.now()+400;if(current&&root.value?.hasPointerCapture(current.pointerId))root.value.releasePointerCapture(current.pointerId)}
function finishMove(event:PointerEvent){
  const current=drag.value
  if(!current||current.pointerId!==event.pointerId)return
  cancelDrag()
  if(!current.moved){suppressClickUntil=Date.now()+400;emit('open',current.item.record);return}
  event.preventDefault();event.stopPropagation()
  if(!current.valid)return
  const latest=props.records.find(record=>record.id===current.item.record.id)
  const latestPlan=current.plan&&props.plans.find(plan=>plan.id===current.plan!.id)
  if(current.planEdit&&props.canEditPlans&&latestPlan&&latestPlan.start===current.plan?.start&&latestPlan.end===current.plan?.end)emit('planEdit',current.planEdit)
  else if(current.dateEdit&&latest&&!latest.readonly&&props.canEditRecord?.(latest)&&['etag','start','due','end','allDay'].every(field=>latest[field as keyof WorkspaceRecord]===current.item.record[field as keyof WorkspaceRecord]))emit('dateEdit',current.dateEdit)
}
function movePointer(event:PointerEvent){if(drag.value)moveItem(event);else moveCreation(event)}
function finishPointer(event:PointerEvent){if(drag.value)finishMove(event);else finishCreation(event)}
function cancelPointer(){cancelDrag();cancelCreation()}
function openItem(record:WorkspaceRecord){if(Date.now()>=suppressClickUntil)emit('open',record)}
const previewRecords=computed(()=>drag.value?.valid&&drag.value.dateEdit?props.records.map(record=>record.id===drag.value?.dateEdit?.id?{...record,...drag.value.dateEdit}:record):props.records)
const previewPlans=computed(()=>drag.value?.valid&&drag.value.planEdit?props.plans.map(plan=>plan.id===drag.value?.planEdit?.id?{...plan,...drag.value.planEdit}:plan):props.plans)
const dragText=computed(()=>{
  const current=drag.value
  if(!current?.moved)return ''
  if(!current.valid)return 'Drop inside the calendar grid · Esc to cancel'
  const record=current.planEdit||{...current.item.record,...current.dateEdit},start=record.start,end='due' in record?record.due||('end' in record?record.end:undefined):record.end
  const label=(value:string)=>`${dateValue(value).toLocaleDateString(undefined,{month:'short',day:'numeric'})}${value.includes('T')?' '+clockTime(value):''}`
  return `${current.item.record.title} · ${start?label(start):''}${start&&end?' → ':''}${end?label(end):''}`
})
const dragTooltipStyle=computed(()=>drag.value?{left:`${Math.max(8,Math.min(drag.value.clientX+14,window.innerWidth-330))}px`,top:`${Math.max(8,Math.min(drag.value.clientY-42,window.innerHeight-70))}px`}:undefined)
const nativeItems=computed(()=>previewRecords.value.map(calendarItem).filter((item):item is CalendarItem=>Boolean(item)))
const bufferedAllDayLayout=computed(()=>calendarAllDayLayout(nativeItems.value,days.value))
const allDayViewport=computed(()=>calendarDateWindow({...calendarViewportDays({scrollLeft:props.axis?.scrollLeft??canvas.scrollLeft.value,viewportWidth:localViewportWidth.value,gutter:props.axis?.labelWidth||53,dayWidth:props.axis?.dayWidth||localDayWidth.value,days:days.value.length}),days:days.value.length},0))
const firstVisibleDay=computed(()=>allDayViewport.value.first),lastVisibleDay=computed(()=>allDayViewport.value.last)
const allDayLayout=computed(()=>visibleAllDayLayout(bufferedAllDayLayout.value.items,firstVisibleDay.value,lastVisibleDay.value))
const allDaySize=computed<ReturnType<typeof calendarAllDaySize>>(()=>calendarAllDaySize({lanes:allDayLayout.value.lanes,availableHeight:availableCalendarHeight.value,manualHeight:allDayResize.manualHeight.value}))
const allDayResize=useAllDayResize(()=>allDaySize.value,()=>{touch.cancel();cancelPointer()})
const retainedIds=computed(()=>new Set([focusId.value,drag.value?.item.record.id].filter((id):id is string=>Boolean(id))))
const laneWindow=computed(()=>calendarLaneWindow({scrollTop:allDayScrollTop.value,viewportHeight:allDaySize.value.height,lanes:allDayLayout.value.lanes}))
const firstLane=computed(()=>laneWindow.value.first),lastLane=computed(()=>laneWindow.value.last)
const renderedAllDayItems=computed(()=>{
  const visible=allDayLayout.value.items.filter(item=>item.lane>=firstLane.value&&item.lane<lastLane.value||retainedIds.value.has(item.record.id))
  const mounted=new Set(visible.map(item=>item.id))
  // Keep a focused/editing control mounted when horizontal panning hides its
  // date. Its offscreen column remains real, without adding visible lanes.
  for(const item of bufferedAllDayLayout.value.items)if(retainedIds.value.has(item.record.id)&&!mounted.has(item.id))visible.push({...item,lane:0})
  return visible
})
const timedWindow=computed(()=>calendarDateWindow({...allDayViewport.value,days:days.value.length}))
const firstTimedDay=computed(()=>timedWindow.value.first),lastTimedDay=computed(()=>timedWindow.value.last)
const timedItems=computed(()=>calendarTimedItems(previewRecords.value,previewPlans.value,nativeItems.value))
const unscheduledTray=ref<InstanceType<typeof UnscheduledTray>>()
const unscheduled=computed(()=>unscheduledRecords(props.records,props.plans,props.relations))
const summaryDay=computed(()=>days.value.find(day=>dayKey(day)===props.activeDay)||days.value.find(day=>dayKey(day)===dayKey(now.value))||props.anchor||props.days[0]||now.value)
const daySummary=computed(()=>calendarDaySummary(props.records,summaryDay.value))
const summaryLabel=computed(()=>`${dayKey(summaryDay.value)===dayKey(now.value)?'Today · ':''}${summaryDay.value.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}`)
function endDay(date:Date){const end=new Date(date);end.setDate(end.getDate()+1);return end}
function allDayStyle(item:CalendarAllDayItem){return {'--record-color':props.colorFor(item.record),'--source-color':sourceTint(item.record),gridRow:item.lane+1,gridColumn:`${item.first+2} / ${item.last+2}`}}
const visiblePeriod=computed(()=>({start:days.value[0]?+days.value[0]:NaN,end:days.value.length?+endDay(days.value.at(-1)!):NaN}))
function allDayClipped(item:CalendarAllDayItem){return {before:item.start<visiblePeriod.value.start,after:item.end>visiblePeriod.value.end}}
function sourceIcon(record:WorkspaceRecord){return record.kind==='card'?PanelsTopLeft:record.kind==='task'?CircleCheck:CalendarDays}
// Packing overlaps is data/zoom work. Selection and hover only change styling,
// so they must not repack every day or repeatedly format every booking's time.
const blocksByDay=computed(()=>new Map([...calendarTimedLayout(timedItems.value,days.value,{minimumMinutes:22/hourHeight.value*60})].map(([day,blocks])=>[day,blocks.map(block=>({...block,timeLabel:clockTime(new Date(block.start).toISOString())}))])))
const renderedBlocks=computed(()=>new Map(days.value.map((day,index)=>[+day,(blocksByDay.value.get(+day)||[]).filter(block=>index>=firstTimedDay.value&&index<lastTimedDay.value||retainedIds.value.has(block.record.id))])))
function dayBlocks(date:Date){return renderedBlocks.value.get(+date)||[]}
function blockStyle(block:ReturnType<typeof dayBlocks>[number]){return {top:`${block.from/60*hourHeight.value}px`,height:`${Math.max(22,(block.to-block.from)/60*hourHeight.value)}px`,left:`calc(${block.lane/block.lanes*100}% + 3px)`,width:`calc(${100/block.lanes}% - 6px)`,'--record-color':props.colorFor(block.record),'--source-color':sourceTint(block.record)}}
function measureScrollbar(){
  pinnedLabels.invalidate()
  if(!scroller.value)return
  if(allDayScroller.value)allDayScrollTop.value=allDayScroller.value.scrollTop
  localViewportWidth.value=scroller.value.clientWidth
  scrollbarWidth.value=scroller.value.offsetWidth-scroller.value.clientWidth
  calendarViewportHeight.value=scroller.value.clientHeight
  if(calendarContent.value)availableCalendarHeight.value=Math.max(0,calendarContent.value.clientHeight-(headingScroller.value?.clientHeight||0)-6)
  if(reportedScrollbarWidth!==scrollbarWidth.value){reportedScrollbarWidth=scrollbarWidth.value;emit('scrollbarWidth',scrollbarWidth.value)}
}
function setHorizontalScroll(left:number){
  for(const target of [scroller.value,headingScroller.value,allDayScroller.value])if(target&&Math.abs(target.scrollLeft-left)>.5)target.scrollLeft=left
  pinSourceEdges()
}
function syncDayScroll(event:Event){
  cancelCreation()
  pinSourceEdges()
  const source=event.currentTarget as HTMLElement
  if(source===allDayScroller.value)allDayScrollTop.value=source.scrollTop
  setHorizontalScroll(source.scrollLeft)
  if(sharedAxis.value){if(Math.abs(source.scrollLeft-(props.axis?.scrollLeft||0))>.75)emit('horizontalScroll',source.scrollLeft)}else if(Math.abs(source.scrollLeft-canvas.scrollLeft.value)>.75)canvas.setScroll(source.scrollLeft)
}
function hoverRecord(id:string,event:PointerEvent|FocusEvent){if(event.type==='focusin')focusId.value=id;else pointerId.value=id;emit('hover',pointerId.value||focusId.value)}
function leaveRecord(event:PointerEvent|FocusEvent){
  if(event.type==='focusout')focusId.value=null;else pointerId.value=null
  emit('hover',pointerId.value||focusId.value)
}
async function zoomHours(event:WheelEvent){
  if(!event.ctrlKey||!scroller.value)return
  event.preventDefault();event.stopPropagation()
  const viewport=scroller.value,bounds=viewport.getBoundingClientRect()
  const pointer=Math.max(0,Math.min(viewport.clientHeight,event.clientY-bounds.top))
  const hour=(viewport.scrollTop+pointer)/hourHeight.value
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?200:1)
  hourHeight.value=Math.max(24,Math.min(144,hourHeight.value*Math.exp(-delta*.002)))
  await nextTick();viewport.scrollTop=hour*hourHeight.value-pointer
}
async function resetHourZoom(){const viewport=scroller.value,top=(viewport?.scrollTop||0)/hourHeight.value;hourHeight.value=48;await nextTick();if(viewport)viewport.scrollTop=top*48}
function horizontalWheel(event:WheelEvent){
  touch.stopCoast();cancelPointer()
  if(event.ctrlKey){void zoomHours(event);return}
  if(event.defaultPrevented)return
  const delta=horizontalWheelDelta(event,scroller.value?.clientWidth||1)
  if(!delta)return
  event.preventDefault();event.stopPropagation()
  if(sharedAxis.value)emit('datePan',delta);else canvas.pan(delta)
}
let touchVertical:HTMLElement|undefined,touchZoom:Parameters<typeof touchHourZoom>[0]|undefined,touchDateZoom:Parameters<typeof touchCalendarDateZoom>[0]|undefined,touchZoomGeneration=0
function pinchDateViewport(clientX:number){const viewport=scroller.value!,label=props.axis?.labelWidth||53,width=Math.max(1,viewport.clientWidth-label);return {width,pixel:Math.max(0,Math.min(width,clientX-viewport.getBoundingClientRect().left-label))}}
const touch=usePlannerTouch(root,{
  eligible:calendarTouchEligible,
  start:event=>{suppressClickUntil=0;touchVertical=(event.target as HTMLElement).closest('.calendar-all-day-viewport')?allDayScroller.value:scroller.value},
  pan:(dx,dy)=>{panCalendarVertical(touchVertical,allDayScroller.value,scroller.value,dy);if(sharedAxis.value)emit('datePan',-dx);else canvas.pan(-dx)},
  panEnd:()=>{if(!sharedAxis.value)canvas.settle()},
  pinchStart:center=>{
    if(!scroller.value)return
    touchZoomGeneration++
    const viewport=scroller.value,y=Math.max(0,Math.min(viewport.clientHeight,center.y-viewport.getBoundingClientRect().top)),{width,pixel}=pinchDateViewport(center.x)
    touchZoom={height:hourHeight.value,scrollTop:viewport.scrollTop,startY:y,centerY:y,scale:1,viewportHeight:viewport.clientHeight}
    touchDateZoom={anchor:canvas.anchor.value,dayWidth:localDayWidth.value,dayAtCenter:(canvas.scrollLeft.value+pixel)/localDayWidth.value,scale:1,centerPixel:pixel,viewportWidth:width}
    if(sharedAxis.value)emit('dateZoomStart',pixel)
  },
  pinch:(_scale,center,axes)=>{
    if(!touchZoom||!touchDateZoom||!scroller.value||!axes)return
    const generation=++touchZoomGeneration,viewport=scroller.value,{pixel}=pinchDateViewport(center.x)
    if(axes.yActive){
      const y=Math.max(0,Math.min(viewport.clientHeight,center.y-viewport.getBoundingClientRect().top)),result=touchHourZoom({...touchZoom,scale:axes.yScale,centerY:y})
      hourHeight.value=result.height
      void nextTick(()=>{if(generation===touchZoomGeneration)viewport.scrollTop=result.scrollTop})
    }
    if(axes.xActive){
      if(sharedAxis.value)emit('dateZoom',{scale:axes.xScale,centerPixel:pixel})
      else{
        const result=touchCalendarDateZoom({...touchDateZoom,scale:axes.xScale,centerPixel:pixel})
        horizontalZoomWidth.value=result.dayWidth;emit('focusDate',result.anchor)
        void nextTick(()=>{if(generation===touchZoomGeneration)canvas.position(result.scrollLeft)})
      }
    }
  },
  cancel:()=>{touchZoomGeneration++;touchZoom=undefined;touchDateZoom=undefined},
})
watch(()=>[canvas.scrollLeft.value,canvas.anchor.value,localDayWidth.value],()=>{if(!sharedAxis.value)void nextTick(()=>setHorizontalScroll(canvas.scrollLeft.value))},{flush:'post'})
async function revealRecord(id:string){
  touch.stopCoast()
  if(!props.embedded&&await unscheduledTray.value?.revealRecord(id))return
  if(!sharedAxis.value){canvas.position(0);await nextTick();setHorizontalScroll(canvas.scrollLeft.value)}
  await nextTick()

  const lane=allDayLayout.value.items.find(item=>item.record.id===id)?.lane,allDay=allDayScroller.value
  if(lane!==undefined&&allDay){
    const top=lane*31+3,bottom=top+28
    if(top<allDay.scrollTop||bottom>allDay.scrollTop+allDay.clientHeight)allDay.scrollTop=Math.max(0,top-3)
    allDayScrollTop.value=allDay.scrollTop
  }
  await nextTick()
  const viewport=scroller.value
  if(!viewport||!id)return
  const candidates=Array.from(viewport.querySelectorAll<HTMLElement>('.calendar-event')).filter(element=>element.dataset.recordId===id)
  const bounds=viewport.getBoundingClientRect(),labelWidth=props.axis?.labelWidth||64
  const target=candidates.find(element=>{const rect=element.getBoundingClientRect();return rect.right>bounds.left+labelWidth&&rect.left<bounds.left+viewport.clientWidth})||candidates[0]
  if(target){
    const top=Number.parseFloat(target.style.top),bottom=top+target.offsetHeight
    if(top<viewport.scrollTop+12||bottom>viewport.scrollTop+viewport.clientHeight-12)viewport.scrollTop=Math.max(0,top-24)
  }
  for(const chip of allDayScroller.value?.querySelectorAll<HTMLElement>('.all-day-event')||[]){
    if(chip.dataset.recordId!==id)continue
    const cell=allDayScroller.value
    if(!cell)continue
    const chipBounds=chip.getBoundingClientRect(),cellBounds=cell.getBoundingClientRect()
    if(chipBounds.top<cellBounds.top)cell.scrollTop+=chipBounds.top-cellBounds.top-3
    else if(chipBounds.bottom>cellBounds.bottom)cell.scrollTop+=chipBounds.bottom-cellBounds.bottom+3
  }
}
function resetScroll(){nextTick(()=>{
  if(scroller.value)scroller.value.scrollTop=7*hourHeight.value
  if(props.embedded&&!sharedAxis.value)setHorizontalScroll(0)
  else setHorizontalScroll(props.axis?.scrollLeft??canvas.scrollLeft.value)
  measureScrollbar()
  if(props.focusId)void revealRecord(props.focusId)
})}
onMounted(resetScroll)
onMounted(()=>{
  document.addEventListener('keydown',creationKey,true)
  clockTimer=setInterval(()=>now.value=new Date(),60000)
  sizeObserver=new ResizeObserver(measureScrollbar)
  if(scroller.value)sizeObserver.observe(scroller.value)
  if(calendarContent.value)sizeObserver.observe(calendarContent.value)
  if(headingScroller.value)sizeObserver.observe(headingScroller.value)
})
onBeforeUnmount(()=>{cancelPointer();document.removeEventListener('keydown',creationKey,true);clearInterval(clockTimer);sizeObserver?.disconnect()})
// Date browsing keeps the user's chosen hour position. Only the initial mount
// starts at 07:00; explicit selection reveal can still bring a booking into view.
watch(()=>days.value[0]?.toISOString(),()=>nextTick(()=>{measureScrollbar();if(props.axis)setHorizontalScroll(props.axis.scrollLeft)}))
watch(()=>[days.value.length,props.embedded],()=>nextTick(measureScrollbar))
watch(()=>props.axis?.scrollLeft,()=>{if(props.axis)setHorizontalScroll(props.axis.scrollLeft)},{flush:'post'})
watch(()=>[props.axis?.labelWidth,props.axis?.dayWidth,localDayWidth.value,days.value.length,props.contextCollapsed],()=>nextTick(()=>{measureScrollbar();if(props.axis)setHorizontalScroll(props.axis.scrollLeft)}))
watch(()=>props.focusId,id=>{if(id)void revealRecord(id)})
watch(()=>[days.value[0]?.getTime(),days.value.length,props.canCreate],cancelCreation)
watch(()=>[days.value[0]?.getTime(),days.value.length],()=>{cancelDrag();pointerId.value=null;focusId.value=null;emit('hover',null)})
watch(()=>props.scopeId,()=>{touch.cancel();horizontalZoomWidth.value=undefined;allDayResize.reset()})
watch(()=>props.mode,()=>{touch.cancel();horizontalZoomWidth.value=undefined;allDayResize.reset()})
watch(()=>props.anchor?.getTime(),()=>touch.stopCoast())
watch([renderedAllDayItems,renderedBlocks],()=>nextTick(pinnedLabels.invalidate),{flush:'post'})
defineExpose({revealRecord})
</script>
<template>
  <section ref="root" class="calendar-view continuous-calendar" :class="{'context-collapsed':contextCollapsed,'embedded-calendar':embedded,'shared-calendar-axis':sharedAxis,'can-create-range':canCreate,'is-creating-range':Boolean(newRange),'is-moving-item':Boolean(drag?.moved)}" :style="embeddedStyle" :aria-label="embedded?'Overview calendar':mode==='day'?'Day calendar':'Week calendar'" @wheel="horizontalWheel" @pointermove="movePointer" @pointerup="finishPointer" @pointercancel="cancelPointer" @lostpointercapture="cancelPointer">
    <button v-if="!embedded" class="calendar-scale-control icon-button" aria-label="Reset calendar hour height" title="Pinch or Ctrl + mouse wheel to zoom hours; reset hour height" @click="resetHourZoom"><RotateCcw :size="14"/></button>
    <div class="calendar-layout">
      <UnscheduledTray ref="unscheduledTray" :disabled="embedded" :records="unscheduled" :preference-key="preferenceKey" :persist-presentation="persistPresentation" :selected-id="selectedId" :color-for="colorFor" :source-color-for="sourceTint" :tags-for="itemTags" :hovered-id="hoveredRecordId" :related-ids="relatedIdsSet" :highlighted-ids="highlightedIdsSet" @hover="(id,event)=>id?hoverRecord(id,event):leaveRecord(event)" @open="emit('open',$event)">
      <div ref="mainScroller" class="calendar-main" @scroll="pinSourceEdges">
        <div ref="calendarContent" class="calendar-content">
        <div v-if="!sharedAxis" ref="headingScroller" class="calendar-heading-viewport" @scroll="syncDayScroll">
        <div class="calendar-header"><div class="calendar-zone">{{timeZoneLabel}}</div><div v-for="day in days" :key="dayKey(day)" class="calendar-day-heading" :class="{today:dayKey(day)===dayKey(now)}"><span>{{dateLabels.get(+day)?.weekday}}</span><strong>{{day.getDate()}}</strong><button v-if="canCreate" class="icon-button day-add" :aria-label="`New item on ${dateLabels.get(+day)?.local}`" @click="createDay(day)"><Plus :size="12"/></button></div></div>
        </div>
        <div ref="allDayScroller" class="calendar-all-day-viewport" tabindex="0" aria-label="All-day items, scroll for more" :class="{'has-all-day-items':allDayLayout.lanes>0}" @scroll="syncDayScroll">
        <div class="calendar-all-day" :style="{gridTemplateRows:allDayLayout.lanes?`repeat(${allDayLayout.lanes},28px)`:'18px'}" @pointerdown="beginCreation($event,false)">
          <div class="all-day-gutter">
            <div v-if="sharedAxis&&!contextCollapsed" class="calendar-day-summary" :class="{compact:(axis?.labelWidth||0)<260,roomy:allDayLayout.lanes>2,empty:allDayLayout.lanes===0}" :data-day="dayKey(summaryDay)" aria-label="Day summary">
              <strong>{{summaryLabel}}</strong>
              <div class="day-summary-counts"><span><CalendarDays :size="12"/><b>{{daySummary.events}}</b> {{daySummary.events===1?'event':'events'}}</span><span><CircleCheck :size="12"/><b>{{daySummary.due}}</b> due</span></div>
              <button v-if="allDayLayout.lanes>2&&canCreate" class="day-summary-create" @click="createDay(summaryDay)"><Plus :size="12"/>New item</button>
            </div>
            <span class="calendar-all-day-label">All day<br>Multi-day</span>
          </div>
          <div v-for="(day,index) in days" :key="dayKey(day)" class="all-day-cell" :class="{'active-day':sharedAxis&&activeDay===dayKey(day)}" :style="{gridColumn:index+2}" :data-day="dayKey(day)" aria-hidden="true"></div>
          <div v-if="allDayCreationStyle" class="calendar-new-all-day" :style="allDayCreationStyle" aria-hidden="true"></div>
          <button v-for="item in renderedAllDayItems" :key="item.id" class="all-day-event" :class="{deadline:item.point&&item.record.kind!=='event',work:item.record.kind!=='event','continues-before':allDayClipped(item).before,'continues-after':allDayClipped(item).after,selected:item.record.id===selectedId,related:item.record.id!==selectedId&&relatedIdsSet.has(item.record.id),hovered:item.record.id===hoveredRecordId,'hover-linked':item.record.id!==hoveredRecordId&&highlightedIdsSet.has(item.record.id),'can-move':canMoveItem(item),'moving':drag?.moved&&drag.item.id===item.id}" :style="allDayStyle(item)" :data-record-id="item.record.id" :data-record-kind="item.record.kind" :data-first-day="dayKey(days[item.first]!)" :data-last-day="dayKey(days[item.last-1]!)" :title="recordTooltip(item.record,item.label)" :aria-label="`${item.label}: ${item.record.title}${relatedIdsSet.has(item.record.id)?', linked to selected item':''}`" @pointerenter="hoverRecord(item.record.id,$event)" @pointerleave="leaveRecord" @focusin="hoverRecord(item.record.id,$event)" @focusout="leaveRecord" @pointerdown="beginMove($event,item)" @click="openItem(item.record)"><i class="calendar-source-edge" aria-hidden="true"/><span class="all-day-pinned-label"><component :is="sourceIcon(item.record)" :size="12"/><span v-if="item.point" class="deadline-label">{{item.label.toUpperCase()}}</span><span class="all-day-title">{{item.record.title}}</span><small v-if="contextIds.has(item.record.id)" class="calendar-context-badge">Linked context</small><RecordTagMarkers class="calendar-tags" :tags="itemTags(item.record)" :limit="2"/></span></button>
        </div>
        </div>
        <CalendarAllDayDivider :size="allDaySize" :active="allDayResize.active.value" @begin="allDayResize.begin" @keyboard="allDayResize.keyboard" @reset="allDayResize.reset"/>
        <div ref="scroller" class="calendar-times-scroll" :tabindex="embedded?0:undefined" :aria-label="embedded?'Calendar hours, scroll for all 24 hours and more dates':undefined" @scroll="syncDayScroll">
          <div class="calendar-time-grid" @pointerdown="beginCreation($event,true)">
            <div class="calendar-hour-labels">
              <div v-if="sharedAxis&&!contextCollapsed" class="calendar-context">
                <OverviewAgenda :records="records" :plans="plans" :relations="relations" :days="days" :now="now" :selected-id="selectedId" :hovered-id="hoveredRecordId" :color-for="colorFor" :compact="(axis?.labelWidth||0)<260" @open="emit('open',$event)"/>
              </div>
              <span v-for="hour in hours" :key="hour" :style="{top:`${hour*hourHeight}px`}">{{String(hour).padStart(2,'0')}}:00</span>
            </div>
            <div v-for="(day,index) in days" :key="dayKey(day)" class="calendar-day-track" :class="{today:dayKey(day)===dayKey(now),'active-day':sharedAxis&&activeDay===dayKey(day)}" :data-day="dayKey(day)">

              <div v-if="timedCreationStyle(index)" class="calendar-new-time" :style="timedCreationStyle(index)" aria-hidden="true"></div>
              <button v-for="block in dayBlocks(day)" :key="block.id" class="calendar-event" :class="{planned:block.planned,work:block.record.kind!=='event',deadline:block.point,selected:block.record.id===selectedId,related:block.record.id!==selectedId&&relatedIdsSet.has(block.record.id),hovered:block.record.id===hoveredRecordId,'hover-linked':block.record.id!==hoveredRecordId&&highlightedIdsSet.has(block.record.id),'can-move':canMoveItem(block),'moving':drag?.moved&&drag.item.id===block.id}" :style="blockStyle(block)" :data-record-id="block.record.id" :data-record-kind="block.record.kind" :title="recordTooltip(block.record,block.label)" :aria-label="`${block.label}: ${block.record.title}, ${block.timeLabel}${block.planned?', planned work':''}${relatedIdsSet.has(block.record.id)?', linked to selected item':''}`" @pointerenter="hoverRecord(block.record.id,$event)" @pointerleave="leaveRecord" @focusin="hoverRecord(block.record.id,$event)" @focusout="leaveRecord" @pointerdown="beginMove($event,block)" @click="openItem(block.record)"><i class="calendar-source-edge" aria-hidden="true"/><strong><component :is="sourceIcon(block.record)" :size="11"/>{{block.record.title}}</strong><span>{{block.point?`${block.label} `:''}}{{block.timeLabel}}<template v-if="block.to-block.from>25"> · {{block.planned?'Work session':block.record.kind==='event'?block.record.collectionTitle:block.record.kind==='card'?'Deck card':'Task'}}</template></span><small v-if="contextIds.has(block.record.id)" class="calendar-context-badge">Linked context</small><RecordTagMarkers class="calendar-tags" :tags="itemTags(block.record)" :limit="2"/></button>
              <div v-if="dayKey(day)===dayKey(now)" class="calendar-now" :style="{top:`${minute/60*hourHeight}px`}"><span></span></div>
            </div>
          </div>
        </div>
        </div>
      </div>
      </UnscheduledTray>
    </div>
    <div v-if="drag?.moved" class="calendar-creation-tooltip" :style="dragTooltipStyle" role="status">{{dragText}}<small v-if="drag.valid">Release to move · Esc to cancel</small></div>
    <div v-if="newRange" class="calendar-creation-tooltip" :style="creationTooltipStyle" role="status">{{creationText}}<small>Release to create · Esc to cancel</small></div>
  </section>
</template>
<style scoped>
/* The week view fills the main area; hours and the unscheduled list scroll inside it. */
:global(.app-main:has(>.workspace-body>.calendar-view:not(.embedded-calendar))){height:calc(100dvh - var(--app-header-height,52px) - var(--workspace-inset,12px));min-height:0}
:global(.workspace-body:has(>.calendar-view:not(.embedded-calendar))){display:flex;flex-direction:column;min-height:0}
.calendar-view:not(.embedded-calendar){display:flex;flex:1;flex-direction:column;min-width:0;min-height:0}
.calendar-view:not(.embedded-calendar) .calendar-layout{flex:1;min-height:0}
.calendar-view:not(.embedded-calendar) .calendar-main{display:flex;min-height:0}
.calendar-view:not(.embedded-calendar) .calendar-content{display:flex;flex-direction:column;min-width:648px;width:100%;min-height:0}
.calendar-view:not(.embedded-calendar) .calendar-heading-viewport{display:block;flex-shrink:0}
.calendar-view:not(.embedded-calendar) .calendar-all-day-viewport{flex-shrink:0}
.calendar-view:not(.embedded-calendar) .calendar-times-scroll{flex:1;height:0;min-height:0;max-height:none}
.calendar-source-edge{position:absolute;left:var(--source-edge-offset,0px);top:0;bottom:0;width:3px;background:var(--source-color,var(--record-color));opacity:var(--source-edge-visible,0);pointer-events:none;z-index:5}
.calendar-event>.calendar-tags{display:inline-flex;position:absolute;right:4px;bottom:3px;margin:0;line-height:10px;max-width:35px}.all-day-event>.calendar-tags{margin-left:auto}

.can-create-range .calendar-day-track,.can-create-range .calendar-all-day{cursor:default}.is-creating-range{user-select:none}
.calendar-new-time,.calendar-new-all-day{pointer-events:none;border:2px solid var(--primary);border-radius:4px;background:color-mix(in srgb,var(--primary) 20%,transparent);z-index:8}
.calendar-new-time{position:absolute;left:2px;right:2px;min-height:12px}.calendar-new-all-day{grid-row:1 / -1;align-self:stretch;margin:-4px 2px}
.calendar-creation-tooltip{position:fixed;z-index:100;pointer-events:none;max-width:310px;background:var(--surface);border:1px solid var(--primary);box-shadow:0 4px 18px #0002;border-radius:7px;padding:8px 11px;font-size:12px;color:var(--text)}.calendar-creation-tooltip small{display:block;font-size:10px;color:var(--muted);margin-top:3px}
.calendar-content,.calendar-heading-viewport{display:contents}
.calendar-all-day-viewport{display:block;height:var(--all-day-height,24px);max-height:none;overflow:auto;overscroll-behavior:contain}
.calendar-view:not(.embedded-calendar) .calendar-all-day-viewport{min-width:648px;overflow-x:hidden}
.calendar-all-day{border-bottom:0;min-height:24px;max-height:none;row-gap:3px;padding-block:3px;position:relative;isolation:isolate;align-content:start;box-sizing:border-box}
.calendar-all-day-label{white-space:nowrap;padding:7px 3px;font-size:9px}.calendar-zone{font-size:9px;padding:10px 3px;word-break:normal;overflow:hidden;text-overflow:ellipsis}
.all-day-gutter{grid-column:1;grid-row:1 / -1;position:relative;min-width:0;background:var(--surface);z-index:6}
.all-day-gutter>.calendar-all-day-label{position:absolute;top:0;right:3px;padding-block:0}
.all-day-cell{display:block;grid-row:1 / -1;max-height:none;min-height:0;overflow:visible;padding:0;margin-block:-3px;pointer-events:none;z-index:0}
.all-day-event{display:flex;align-items:center;gap:4px;min-width:0;width:calc(100% - 6px);height:28px;margin:0 3px;padding:3px 5px;font-size:11px;line-height:1.35;position:relative;z-index:1}
.all-day-pinned-label{position:absolute;top:50%;transform:translateY(-50%);left:var(--label-offset,4px);width:var(--label-width,calc(100% - 8px));display:flex;align-items:center;gap:5px;overflow:hidden;pointer-events:none}.all-day-pinned-label .all-day-title{flex:1}.all-day-pinned-label>.calendar-tags{margin-left:auto}.all-day-event svg{flex-shrink:0}.all-day-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.all-day-event.continues-before{border-top-left-radius:0;border-bottom-left-radius:0}
.all-day-event.continues-after{border-top-right-radius:0;border-bottom-right-radius:0}
.calendar-day-summary{display:flex;flex-direction:column;gap:1px;min-width:0;padding:0 68px 0 12px;color:var(--muted);font-size:10px;line-height:13px}
.calendar-day-summary>strong{font-size:11px;font-weight:550;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.day-summary-counts{display:flex;align-items:center;gap:14px;white-space:nowrap}.day-summary-counts>span{display:inline-flex;align-items:center;gap:4px}.day-summary-counts b{font-weight:600;color:var(--text)}
.calendar-day-summary.empty{flex-direction:row;align-items:center;gap:8px;overflow:hidden}.calendar-day-summary.empty>strong{flex:none;max-width:50%}.calendar-day-summary.empty .day-summary-counts{gap:8px;font-size:9px}
.calendar-all-day-viewport:not(.has-all-day-items) .calendar-all-day-label{font-size:8px;line-height:9px;padding-block:0!important}
.calendar-day-summary.roomy{padding-top:3px;gap:9px}.calendar-day-summary.roomy>strong{font-size:14px;line-height:19px}.calendar-day-summary.roomy .day-summary-counts{font-size:12px}
.day-summary-create{display:flex;align-items:center;align-self:flex-start;gap:5px;color:var(--primary);font-size:11px;padding:3px 0}
.calendar-day-summary.compact{padding-left:8px;padding-right:58px;font-size:9px}.calendar-day-summary.compact>strong{font-size:10px}.calendar-day-summary.compact .day-summary-counts{gap:7px;font-size:9px}.calendar-day-summary.compact .day-summary-counts svg{display:none}
.all-day-event.deadline{border-left-style:solid;background:color-mix(in srgb,var(--record-color) 9%,var(--surface))}
.deadline-label{font-size:8px;letter-spacing:.2px;flex-shrink:0}
.calendar-event strong svg{display:inline-block;vertical-align:-1px;margin-right:4px;flex-shrink:0}
.calendar-event.deadline{border-left-style:dotted}.calendar-event.work:not(.planned){background:color-mix(in srgb,var(--record-color) 12%,var(--surface))}
.calendar-view.embedded-calendar{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;overflow:hidden}
.embedded-calendar .calendar-layout{display:flex;flex:1;min-width:0;min-height:0;border:0;border-radius:0}
.embedded-calendar .calendar-main{display:flex;flex:1;min-height:0;overflow:hidden}
.embedded-calendar .calendar-content{display:flex;flex-direction:column;width:100%;min-width:0;min-height:0}
.embedded-calendar .calendar-heading-viewport,.embedded-calendar .calendar-all-day-viewport{display:block;overflow-x:hidden;width:calc(100% - var(--calendar-scrollbar));flex-shrink:0}
.embedded-calendar .calendar-heading-viewport{overflow-y:hidden}
.embedded-calendar .calendar-all-day-viewport{max-height:none;overflow-y:auto;scrollbar-width:thin}
.embedded-calendar .calendar-header,.embedded-calendar .calendar-all-day,.embedded-calendar .calendar-time-grid{grid-template-columns:64px repeat(var(--calendar-days),minmax(0,1fr));min-width:var(--calendar-grid-width);width:var(--calendar-grid-width)}
.embedded-calendar .calendar-zone{font-size:9px;overflow-wrap:anywhere}
.embedded-calendar .calendar-day-heading{padding:7px 0}
.embedded-calendar .calendar-day-heading .day-add{opacity:.65;right:5px;top:7px}
.embedded-calendar .calendar-day-heading .day-add:hover,.embedded-calendar .calendar-day-heading .day-add:focus-visible{opacity:1}
.embedded-calendar .calendar-all-day{min-height:24px;max-height:none}
.embedded-calendar .all-day-cell{max-height:none;min-height:0;overflow:visible;padding:0}
.embedded-calendar .calendar-all-day-label{padding:5px 7px}
.embedded-calendar .calendar-times-scroll{height:0;flex:1;min-width:0;min-height:0;max-height:none;overflow:auto;overscroll-behavior:contain}
.calendar-event.related,.all-day-event.related{outline:2px dashed var(--primary);outline-offset:-2px;z-index:3}
.calendar-event.hovered:not(.selected),.all-day-event.hovered:not(.selected){outline:2px solid var(--primary);outline-offset:-2px;z-index:5}
.calendar-event.hover-linked:not(.selected),.all-day-event.hover-linked:not(.selected){outline:2px dashed var(--primary);outline-offset:-2px;box-shadow:inset 0 0 0 3px color-mix(in srgb,var(--primary) 12%,transparent);z-index:4}
.context-collapsed .calendar-all-day-label{font-size:8px!important;padding-inline:1px!important;right:2px}.context-collapsed .calendar-hour-labels>span{font-size:9px;right:3px}
.calendar-event.selected,.all-day-event.selected{outline:2px solid var(--primary);outline-offset:-2px;z-index:4}
.calendar-event:focus-visible,.all-day-event:focus-visible{outline:2px solid var(--text);outline-offset:-2px}
.embedded-calendar .calendar-times-scroll:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.shared-calendar-axis .calendar-all-day,.shared-calendar-axis .calendar-time-grid{grid-template-columns:var(--calendar-label-width) repeat(var(--calendar-days),var(--calendar-day-width))}
.shared-calendar-axis .calendar-times-scroll{scrollbar-gutter:stable;overflow-x:hidden}
.shared-calendar-axis .all-day-gutter,.shared-calendar-axis .calendar-hour-labels{position:sticky;left:0;z-index:6;background:var(--surface)}
.shared-calendar-axis .calendar-all-day-label{text-align:right;padding-right:9px}
.calendar-time-grid,.calendar-hour-labels,.calendar-day-track{height:calc(24 * var(--calendar-hour-height,48px))}
.calendar-content .calendar-day-track{background-image:linear-gradient(to bottom,var(--border) 0 1px,transparent 1px),radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--border) 65%,transparent) .6px,transparent .8px);background-size:100% var(--calendar-hour-height,48px),3px var(--calendar-hour-height,48px);background-position:0 0,0 calc(var(--calendar-hour-height,48px) / 2);background-repeat:repeat}
.calendar-day-track.today{background-color:color-mix(in srgb,var(--primary) 2%,var(--surface))}
.calendar-scale-control{font-size:12px;color:var(--muted)}
.shared-calendar-axis .calendar-context{position:sticky;top:8px;margin:8px 48px 0 9px;height:max(0px,calc(var(--calendar-viewport-height) - 16px));overflow:hidden}
.shared-calendar-axis .calendar-day-track.active-day,.shared-calendar-axis .all-day-cell.active-day{background-color:color-mix(in srgb,var(--primary) 5%,var(--surface))}

.calendar-event,.calendar-event.planned,.calendar-event.work,.all-day-event,.all-day-event.deadline{border-left-color:var(--source-color,var(--record-color))}
.calendar-event.can-move,.all-day-event.can-move{cursor:grab;touch-action:none}.is-moving-item,.is-moving-item .can-move{cursor:grabbing;user-select:none}.calendar-event.moving,.all-day-event.moving{outline:2px solid var(--primary);outline-offset:-2px;opacity:.8;z-index:9}
</style>

<style scoped>
.calendar-all-day,.calendar-all-day-viewport,.all-day-cell,.all-day-event,.calendar-day-track,.calendar-header{touch-action:none}.touch-edit-armed{outline:2px solid var(--primary)!important;outline-offset:2px;box-shadow:0 0 0 4px var(--primary-soft)}
.calendar-context-badge{font-size:10px;flex:none;border:1px solid currentColor;border-radius:4px;padding:1px 3px;opacity:.85}
</style>

<style scoped>
.continuous-calendar{position:relative}
.continuous-calendar .calendar-main{overflow:hidden}
.continuous-calendar .calendar-content{min-width:0;width:100%}
.continuous-calendar .calendar-heading-viewport,.continuous-calendar .calendar-all-day-viewport{display:block;overflow-x:hidden;min-width:0;width:calc(100% - var(--calendar-scrollbar));flex-shrink:0}
.continuous-calendar .calendar-times-scroll{min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.continuous-calendar.shared-calendar-axis .calendar-times-scroll{overflow-x:hidden;overflow-y:auto}
.continuous-calendar .calendar-header,.continuous-calendar .calendar-all-day,.continuous-calendar .calendar-time-grid{grid-template-columns:var(--calendar-label-width) repeat(var(--calendar-days),var(--calendar-day-width));width:var(--calendar-grid-width);min-width:var(--calendar-grid-width)}
.continuous-calendar .calendar-zone,.continuous-calendar .all-day-gutter,.continuous-calendar .calendar-hour-labels{position:sticky;left:0;z-index:6;background:var(--surface)}
.continuous-calendar .calendar-header,.continuous-calendar .calendar-all-day,.continuous-calendar .calendar-time-grid{user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.calendar-scale-control{position:absolute;left:6px;bottom:6px;z-index:10;width:40px;height:40px;background:var(--surface);border-radius:6px;opacity:.75}
.calendar-scale-control:hover,.calendar-scale-control:focus-visible{opacity:1}
.calendar-content .calendar-header{min-height:var(--calendar-date-header);height:var(--calendar-date-header)}
.calendar-content .calendar-day-heading{padding:var(--calendar-date-padding) 0;justify-content:center;flex-direction:row;gap:4px}
.calendar-day-heading>span{font-size:var(--calendar-date-weekday)}.calendar-day-heading>strong{font-size:var(--calendar-date-number);line-height:24px;width:24px;height:24px}
.calendar-content .calendar-zone{padding:3px;font-size:8px}
.calendar-content .day-add{top:0;right:0;width:28px;height:100%;min-height:0;background:var(--surface)}
</style>

<style scoped>
.calendar-layout{display:flex;min-height:0}.calendar-main{width:100%}
</style>
