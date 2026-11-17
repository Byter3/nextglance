<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, reactive, watchEffect } from 'vue'
import PlannerTimeline from './PlannerTimeline.vue'
import UnscheduledTray from './UnscheduledTray.vue'
import {unscheduledRecords} from '@nextspace/core/unscheduled.mjs'
import PlannerCalendar from './PlannerCalendar.vue'
import type { Category, Collection, OverviewAxis, PlanSession, Project, RecordTag, Relation, ScopeArrangement, Space, StatusMapping, WorkspaceRecord } from '@nextspace/contracts'
import { dateValue, dayKey } from './planner-ui'
import { zoomTimelineRange } from '@nextspace/core/timeline-edit.mjs'
import type { TimelineDateEdit } from '@nextspace/core/timeline-edit.mjs'
import { horizontalWheelDelta } from '@nextspace/core/date-wheel.mjs'
import {touchTimelineZoom} from '@nextspace/core/touch-gestures.mjs'
import {useDateCanvas} from './useDateCanvas'
import type { CreationRange } from '@nextspace/core/range-selection.mjs'

const props = defineProps<{
  preferenceKey?:string;persistPresentation?:boolean;contextRecordIds?:string[];records:WorkspaceRecord[]; relations:Relation[]; plans:PlanSession[]; anchor:Date
  selectedId?:string|null; colorFor:(record:WorkspaceRecord)=>string; sourceColorFor?:(record:WorkspaceRecord)=>string; tagsFor?:(record:WorkspaceRecord)=>RecordTag[]
  spaces:Space[]; categories:Category[]; projects:Project[]; collections:Collection[]
  arrangement?:ScopeArrangement;canReorder?:boolean;listCollapsed?:boolean;statusMapping?:StatusMapping
  scopeId:string; daysCount:number; canCreate:boolean; canEditRecord?:(record:WorkspaceRecord)=>boolean; canEditPlans?:boolean; canLink?:boolean; canLinkRecords?:(fromId:string,toId:string)=>boolean; saving?:boolean; mobile?:boolean
}>()
const emit = defineEmits<{open:[record:WorkspaceRecord];create:[range:CreationRange];focusDate:[date:string];rangeChange:[range:{anchor:string;days:number}];dateEdit:[edit:TimelineDateEdit];planEdit:[edit:{id:string;start:string;end:string}];link:[edge:{fromId:string;toId:string}];reorder:[intent:{kind:'timelineRows'|'timelineGroups';ids:string[]}];resetOrder:[];'update:listCollapsed':[value:boolean]}>()
const unscheduledTray=ref<InstanceType<typeof UnscheduledTray>>()
const unscheduled=computed(()=>unscheduledRecords(props.records,props.plans,props.relations))
const unscheduledIds=computed(()=>new Set(unscheduled.value.map(record=>record.id)))
const scheduledRecords=computed(()=>props.records.filter(record=>!unscheduledIds.value.has(record.id)))
const container = ref<HTMLElement>(), ratio = ref(50), height = ref(800), dragging = ref(false)
const timeline = ref<InstanceType<typeof PlannerTimeline>>(), calendar = ref<InstanceType<typeof PlannerCalendar>>()
const width = ref(1200), timelineGutter = ref(15), calendarGutter = ref(15)
const hoveredId = ref<string|null>(null)
let observer:ResizeObserver|undefined
let focusGeneration=0
const available = computed(()=>Math.max(1,height.value-4))
const minimum = computed(()=>Math.ceil(Math.min(45,Math.max(25,200/available.value*100))))
const maximum = computed(()=>Math.floor(Math.max(55,Math.min(75,100-300/available.value*100))))
const relatedIds = computed(()=>props.relations.filter(link=>link.type==='scheduled_during'&&(link.fromId===props.selectedId||link.toId===props.selectedId)).map(link=>link.fromId===props.selectedId?link.toId:link.fromId))
const gutter = computed(()=>Math.max(timelineGutter.value,calendarGutter.value))
const labelWidth = computed(()=>props.listCollapsed?40:width.value<600?168:Math.round(Math.min(440,Math.max(300,width.value*.33))))
const calendarDatePinched=ref(false)
const minimumDayWidth = computed(()=>!calendarDatePinched.value&&props.mobile&&width.value<600?80:12)
const dayWidth = computed(()=>Math.max(minimumDayWidth.value,(width.value-gutter.value-labelWidth.value)/props.daysCount))
const canvas=useDateCanvas(()=>({anchor:dayKey(props.anchor),visibleDays:props.daysCount,dayWidth:dayWidth.value,scope:props.scopeId}),anchor=>emit('focusDate',anchor))
const scrollLeft=canvas.scrollLeft
const days = computed(()=>Array.from({length:canvas.renderDays.value},(_,index)=>{const date=dateValue(canvas.anchor.value);date.setDate(date.getDate()+index);return date}))
const axis=reactive<OverviewAxis>({labelWidth:labelWidth.value,dayWidth:dayWidth.value,scrollLeft:scrollLeft.value})
watchEffect(()=>{axis.labelWidth=labelWidth.value;axis.dayWidth=dayWidth.value;axis.scrollLeft=scrollLeft.value;axis.renderAnchor=canvas.anchor.value;axis.renderDays=canvas.renderDays.value})
const highlightedIds = computed(()=>hoveredId.value?[...new Set(props.relations.filter(link=>link.fromId===hoveredId.value||link.toId===hoveredId.value).map(link=>link.fromId===hoveredId.value?link.toId:link.fromId))]:[])
const selected = computed(()=>props.records.find(record=>record.id===props.selectedId))
const linkedEvents = computed(()=>props.records.filter(record=>record.kind==='event'&&relatedIds.value.includes(record.id)&&Number.isFinite(+dateValue(record.start))).sort((a,b)=>+dateValue(a.start)-+dateValue(b.start)))
const selectedPlans = computed(()=>props.plans.filter(plan=>plan.recordId===props.selectedId).sort((a,b)=>+dateValue(a.start)-+dateValue(b.start)))
function offset(value:string){
  const date=dateValue(value),start=days.value[0]!
  return (Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-Date.UTC(start.getFullYear(),start.getMonth(),start.getDate()))/86400000
}
function inPeriod(value:string){const date=dateValue(value),start=new Date(props.anchor),end=new Date(start);end.setDate(end.getDate()+props.daysCount);return date>=start&&date<end}
function overlapsPeriod(start:string,end?:string){return inPeriod(start)||Boolean(end&&dateValue(start)<props.anchor&&dateValue(end)>props.anchor)}
function visibleDate(start:string,end?:string){return !inPeriod(start)&&overlapsPeriod(start,end)?dayKey(props.anchor):start}
const focusTarget = computed(()=>{
  const record=selected.value
  if(!record)return undefined
  if(record.kind==='event'&&record.start&&Number.isFinite(+dateValue(record.start)))return {id:record.id,date:visibleDate(record.start,record.end),end:record.end}
  const event=linkedEvents.value.find(event=>overlapsPeriod(event.start!,event.end))||linkedEvents.value[0]
  if(event)return {id:event.id,date:visibleDate(event.start!,event.end),end:event.end}
  const plan=selectedPlans.value.find(plan=>overlapsPeriod(plan.start,plan.end))||selectedPlans.value[0]
  if(plan)return {id:record.id,date:visibleDate(plan.start,plan.end),end:plan.end}
  const date=record.due||record.start
  return date&&Number.isFinite(+dateValue(date))?{id:record.id,date,end:undefined}:undefined
})
const activeDay = computed(()=>focusTarget.value?dayKey(focusTarget.value.date):'')
const contextTitle = computed(()=>selected.value?.title||'Your calendar')
const contextDetail = computed(()=>{
  if(!selected.value)return 'Select work above to see its calendar time.'
  if(selected.value.kind==='event')return `${relatedIds.value.length} linked work ${relatedIds.value.length===1?'item':'items'}`
  if(linkedEvents.value.length)return `${linkedEvents.value.length} linked ${linkedEvents.value.length===1?'booking':'bookings'} highlighted`
  if(selectedPlans.value.length)return 'Planner work sessions highlighted'
  return selected.value.due?'Deadline shown below · no linked booking':'No linked calendar booking'
})
function setScroll(value:number){if(Math.abs(value-scrollLeft.value)>.75)canvas.setScroll(value)}
function touchRangeChange(range:{anchor:string;days:number;scrollLeft:number}){emit('rangeChange',{anchor:range.anchor,days:range.days});void nextTick(()=>canvas.position(range.scrollLeft))}
let calendarZoom:Parameters<typeof touchTimelineZoom>[0]|undefined
function beginCalendarZoom(pixel:number){const visible=Math.max(1,width.value-gutter.value-labelWidth.value);calendarZoom={anchor:canvas.anchor.value,days:visible/dayWidth.value,scale:1,dayAtCenter:(scrollLeft.value+pixel)/dayWidth.value,centerPixel:pixel,viewportWidth:visible,minimumDayWidth:12,continuous:true}}
function zoomCalendarDates(intent:{scale:number;centerPixel:number}){if(!calendarZoom)return;calendarDatePinched.value=true;touchRangeChange(touchTimelineZoom({...calendarZoom,scale:intent.scale,centerPixel:intent.centerPixel}))}
function scrollDateDelta(delta:number){canvas.pan(delta)}
function surfaceWheel(event:WheelEvent){
  if(event.ctrlKey){zoomAt(event);return}
  const delta=horizontalWheelDelta(event,width.value-labelWidth.value)
  if(!delta)return
  event.preventDefault();event.stopPropagation();scrollDateDelta(delta)
}
let lastZoom=0
function zoomAt(event:WheelEvent){
  if(!event.ctrlKey||!container.value||!event.deltaY||(event.target as HTMLElement).closest('.calendar-view'))return
  event.preventDefault();event.stopPropagation()
  if(Date.now()-lastZoom<70)return
  lastZoom=Date.now()
  const visible=width.value-gutter.value-labelWidth.value
  const pointer=event.clientX-container.value.getBoundingClientRect().left-1-labelWidth.value
  const pixel=pointer>=0?Math.min(visible,pointer):visible/2
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?200:1)
  const nextDays=zoomTimelineRange(dateValue(canvas.anchor.value),props.daysCount,delta).days
  const nextDayWidth=Math.max(minimumDayWidth.value,visible/nextDays)
  const range=zoomTimelineRange(dateValue(canvas.anchor.value),props.daysCount,delta,pixel/(nextDayWidth*nextDays),(scrollLeft.value+pixel)/dayWidth.value)
  emit('rangeChange',range)
}
function revealDay(date:string){
  const index=offset(date)
  if(index<0||index>=canvas.renderDays.value)return
  const start=index*dayWidth.value,end=start+dayWidth.value,visible=width.value-gutter.value-labelWidth.value
  if(start<scrollLeft.value)setScroll(start)
  else if(end>scrollLeft.value+visible)setScroll(end-visible)
}
async function revealSelection(){
  const generation=++focusGeneration,target=focusTarget.value
  if(!selected.value)return
  if(target&&!inPeriod(target.date))emit('focusDate',target.date)
  await nextTick()
  const intendedAnchor=props.anchor.getTime(),intendedDays=props.daysCount,intendedScope=props.scopeId
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
  if(generation!==focusGeneration||props.anchor.getTime()!==intendedAnchor||props.daysCount!==intendedDays||props.scopeId!==intendedScope)return
  if(target){revealDay(target.date);calendar.value?.revealRecord(target.id)}
  if(selected.value?.kind==='event'){
    const work=props.records.find(record=>relatedIds.value.includes(record.id)&&(record.kind==='task'||record.kind==='card'))
    if(work)timeline.value?.revealRecord(work.id)
  }
}
async function revealRecord(id:string){
  ++focusGeneration
  const record=props.records.find(item=>item.id===id)
  if(!record)return false
  if(await unscheduledTray.value?.revealRecord(id))return true
  canvas.position(0);await nextTick()
  if(record.start||record.due)revealDay(record.start||record.due!)
  if(record.kind==='event')await calendar.value?.revealRecord(id)
  else await timeline.value?.revealRecord(id)
  return true
}
defineExpose({revealRecord})
function openRecord(record:WorkspaceRecord){
  const alreadySelected=record.id===props.selectedId
  emit('open',record)
  if(alreadySelected)void revealSelection()
}
// Follow changed work/booking data, but do not undo deliberate period navigation.
const selectionState = computed(()=>JSON.stringify({id:props.selectedId,record:selected.value?{id:selected.value.id,kind:selected.value.kind,start:selected.value.start,end:selected.value.end,due:selected.value.due}:null,links:linkedEvents.value.map(event=>({id:event.id,start:event.start,end:event.end})),plans:selectedPlans.value.map(plan=>({id:plan.id,start:plan.start,end:plan.end})),related:relatedIds.value}))
watch(selectionState,revealSelection,{flush:'post',immediate:true})
watch([()=>props.anchor.getTime(),()=>props.scopeId],()=>{hoveredId.value=null})
watch(()=>props.scopeId,()=>{calendarDatePinched.value=false;calendarZoom=undefined})
function resize(value:number){ratio.value=Math.max(minimum.value,Math.min(maximum.value,Math.round(value)))}
function drag(event:PointerEvent){
  if(!dragging.value||!container.value)return
  const bounds=container.value.getBoundingClientRect()
  resize((event.clientY-bounds.top-2)/Math.max(1,bounds.height-4)*100)
}
function beginDrag(event:PointerEvent){
  if(event.button!==0)return
  event.preventDefault();dragging.value=true
  const target=event.currentTarget as HTMLElement
  target.focus();target.setPointerCapture(event.pointerId)
}
function endDrag(){dragging.value=false}
function keyboard(event:KeyboardEvent){
  const values:Record<string,number>={ArrowUp:ratio.value-5,ArrowDown:ratio.value+5,Home:minimum.value,End:maximum.value,Enter:50}
  const value=values[event.key]
  if(value!==undefined){event.preventDefault();resize(value)}
}
onMounted(()=>{
  observer=new ResizeObserver(entries=>{height.value=entries[0]?.contentRect.height||800;width.value=entries[0]?.contentRect.width||1200;resize(ratio.value)})
  if(container.value)observer.observe(container.value)
})
onBeforeUnmount(()=>{focusGeneration++;observer?.disconnect()})
</script>

<template>
  <UnscheduledTray ref="unscheduledTray" class="overview-split overview-split-host" :records="unscheduled" :preference-key="preferenceKey" :persist-presentation="persistPresentation" :selected-id="selectedId" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" :hovered-id="hoveredId" @hover="hoveredId=$event" @open="openRecord">
  <div ref="container" class="overview-panels unified-overview" :class="{'is-resizing':dragging}" :style="{gridTemplateRows:`minmax(0, ${ratio}fr) 4px minmax(0, ${100-ratio}fr)`}" @wheel.capture="surfaceWheel">
    <section id="overview-work-pane" class="overview-work-pane" aria-label="Overview work timeline">
      <PlannerTimeline :status-mapping="statusMapping" :list-collapsed="listCollapsed" @update:list-collapsed="emit('update:listCollapsed',$event)" :arrangement="arrangement" :can-reorder="canReorder" @reorder="emit('reorder',$event)" @reset-order="emit('resetOrder')" :context-record-ids="contextRecordIds" ref="timeline" :minimum-day-width="minimumDayWidth" @date-pan="scrollDateDelta" @touch-range-change="touchRangeChange" :can-edit-record="canEditRecord" :can-edit-plans="canEditPlans" :can-link="canLink" :can-link-records="canLinkRecords" :saving="saving" @date-edit="emit('dateEdit',$event)" @plan-edit="emit('planEdit',$event)" @link="emit('link',$event)" @range-change="emit('rangeChange',$event)" :axis="axis" :active-day="activeDay" :hovered-id="hoveredId" :highlighted-ids="highlightedIds" :can-create-event="canCreate" :records="scheduledRecords" :relations="relations" :plans="plans" :anchor="anchor" :selected-id="selectedId" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" :spaces="spaces" :categories="categories" :projects="projects" :collections="collections" :scope-id="scopeId" :days-count="daysCount" focused task-only @hover="hoveredId=$event" @open="openRecord" @create-event="emit('create',$event)" @horizontal-scroll="setScroll" @scrollbar-width="timelineGutter=$event"/>
    </section>
    <div class="overview-divider" role="separator" tabindex="0" aria-label="Resize timeline and calendar" aria-orientation="horizontal" aria-controls="overview-work-pane overview-calendar-pane" :aria-valuemin="minimum" :aria-valuemax="maximum" :aria-valuenow="ratio" :aria-valuetext="`${ratio}% timeline, ${100-ratio}% calendar`" title="Drag to resize · double-click or press Enter to reset" @pointerdown="beginDrag" @pointermove="drag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @keydown="keyboard" @dblclick="resize(50)">
    </div>
    <div id="overview-calendar-pane" class="overview-calendar-pane">
      <PlannerCalendar :context-collapsed="listCollapsed" :context-record-ids="contextRecordIds" ref="calendar" :scope-id="scopeId" @date-pan="scrollDateDelta" @date-zoom-start="beginCalendarZoom" @date-zoom="zoomCalendarDates" :can-edit-record="canEditRecord" :can-edit-plans="canEditPlans" @date-edit="emit('dateEdit',$event)" @plan-edit="emit('planEdit',$event)" :axis="axis" :active-day="activeDay" :context-title="contextTitle" :context-detail="contextDetail" :hovered-id="hoveredId" :highlighted-ids="highlightedIds" :relations="relations" :records="records" :plans="plans" :days="days" :selected-id="selectedId" :related-ids="relatedIds" :color-for="colorFor" :source-color-for="sourceColorFor" :tags-for="tagsFor" :can-create="canCreate" embedded @hover="hoveredId=$event" @open="openRecord" @create="emit('create',$event)" @horizontal-scroll="setScroll" @scrollbar-width="calendarGutter=$event"/>
    </div>
  </div>
  </UnscheduledTray>
</template>

<style scoped>
.overview-panels{display:grid;flex:1 1 0;min-height:0;min-width:0;overflow:hidden;border:1px solid var(--border);border-radius:7px;background:var(--surface)}
.overview-work-pane,.overview-calendar-pane{min-width:0;min-height:0;overflow:hidden}
.overview-calendar-pane{display:flex;flex-direction:column;background:var(--surface)}
.overview-divider{position:relative;z-index:12;display:flex;align-items:center;justify-content:center;cursor:row-resize;touch-action:none;color:var(--muted);background:var(--border);outline-offset:1px}
.overview-divider::before{content:'';position:absolute;inset:-8px 0;background:transparent}
.overview-divider::after{content:'';width:28px;height:2px;border-radius:2px;background:currentColor;pointer-events:none}
.overview-divider:hover,.overview-divider:focus-visible,.is-resizing .overview-divider{background:var(--primary-soft);color:var(--primary-soft-text)}
.is-resizing{user-select:none;cursor:row-resize}
</style>

<style scoped>
.overview-split-host{flex:1;min-height:0}
</style>
