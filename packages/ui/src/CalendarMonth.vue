<script setup lang="ts">
import {useIsWeekend} from './useWeekendDays'
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {CalendarDays,CircleCheck,PanelsTopLeft} from 'lucide-vue-next'
import type {PlanSession,RecordTag,Relation,WorkspaceRecord} from '@nextspace/contracts'
import {calendarMonthWeeks,calendarPeriod,calendarPeriodDays,monthGridZoom,type MonthSegment} from '@nextspace/core/calendar-period.mjs'
import {calendarMoveEdit,calendarPlanMove} from '@nextspace/core/calendar-edit.mjs'
import {creationSelection,type CreationRange,type CreationSelection} from '@nextspace/core/range-selection.mjs'
import {unscheduledRecords} from '@nextspace/core/unscheduled.mjs'
import UnscheduledTray from './UnscheduledTray.vue'
import {recordTags} from '@nextspace/core/record-presentation.mjs'
import type {TimelineDateEdit} from '@nextspace/core/timeline-edit.mjs'
import {usePlannerTouch} from './usePlannerTouch'
import {usePinnedItemLabels} from './usePinnedItemLabels'
import {useDateLabels} from './useDateLabels'
import {clockTime,dayKey} from './planner-ui'
import RecordTagMarkers from './RecordTagMarkers.vue'
import './calendar-density.css'

const isWeekend=useIsWeekend()
const props=withDefaults(defineProps<{records:WorkspaceRecord[];plans:PlanSession[];anchor:Date;scopeId:string;selectedId?:string|null;colorFor:(record:WorkspaceRecord)=>string;sourceColorFor?:(record:WorkspaceRecord)=>string;tagsFor?:(record:WorkspaceRecord)=>RecordTag[];relations?:Relation[];contextRecordIds?:string[];canCreate?:boolean;canEditRecord?:(record:WorkspaceRecord)=>boolean;canEditPlans?:boolean;preferenceKey?:string;persistPresentation?:boolean}>(),{relations:()=>[],contextRecordIds:()=>[]})
const emit=defineEmits<{open:[record:WorkspaceRecord];openDay:[day:string];create:[range:CreationRange];dateEdit:[edit:TimelineDateEdit];planEdit:[edit:{id:string;start:string;end:string}]}>()
const root=ref<HTMLElement>(),viewport=ref<HTMLElement>()
const density=ref({dayWidth:100,weekHeight:126}),hoverId=ref<string|null>(null),focusId=ref<string|null>(null)
const period=computed(()=>calendarPeriod(props.anchor,'month'))
const contextIds=computed(()=>new Set(props.contextRecordIds))
const activeId=computed(()=>hoverId.value||focusId.value)
const linkedIds=computed(()=>new Set(props.relations.filter(link=>activeId.value&&(link.fromId===activeId.value||link.toId===activeId.value)).map(link=>link.fromId===activeId.value?link.toId:link.fromId)))
const selectedLinks=computed(()=>new Set(props.relations.filter(link=>link.type==='scheduled_during'&&(link.fromId===props.selectedId||link.toId===props.selectedId)).map(link=>link.fromId===props.selectedId?link.toId:link.fromId)))
const sourceTint=(record:WorkspaceRecord)=>props.sourceColorFor?.(record)||props.colorFor(record)
const tagsByRecord=computed(()=>new WeakMap(props.records.map(record=>[record,props.tagsFor?.(record)||recordTags(record)] as const)))
const tags=(record:WorkspaceRecord)=>tagsByRecord.value.get(record)||props.tagsFor?.(record)||recordTags(record)
const icon=(record:WorkspaceRecord)=>record.kind==='card'?PanelsTopLeft:record.kind==='task'?CircleCheck:CalendarDays
const today=ref(dayKey(new Date()))
let clockTimer:ReturnType<typeof setInterval>|undefined,suppressClickUntil=0,sizeObserver:ResizeObserver|undefined
const pinnedLabels=usePinnedItemLabels(()=>[{viewport:viewport.value,selector:'.month-item',gutter:0}])
const pinSourceEdges=pinnedLabels.update
type Move={pointerId:number;item:MonthSegment;plan?:PlanSession;from:number;clientX:number;clientY:number;originX:number;originY:number;moved:boolean;valid:boolean;dateEdit?:TimelineDateEdit|null;planEdit?:{id:string;start:string;end:string}|null}
type NewRange={pointerId:number;from:number;originX:number;originY:number;moved:boolean;selection:CreationSelection}
const drag=ref<Move|null>(null),newRange=ref<NewRange|null>(null)
const previewRecords=computed(()=>drag.value?.valid&&drag.value.dateEdit?props.records.map(record=>record.id===drag.value!.dateEdit!.id?{...record,...drag.value!.dateEdit}:record):props.records)
const previewPlans=computed(()=>drag.value?.valid&&drag.value.planEdit?props.plans.map(plan=>plan.id===drag.value!.planEdit!.id?{...plan,...drag.value!.planEdit}:plan):props.plans)
const weeks=computed(()=>calendarMonthWeeks(previewRecords.value,previewPlans.value,props.anchor))
const headingDays=computed(()=>calendarPeriodDays(period.value))
const dateLabels=useDateLabels(()=>headingDays.value)
const itemPresentation=computed(()=>{
  const dateTime=new Intl.DateTimeFormat(undefined,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'})
  return new WeakMap(weeks.value.flatMap(week=>week.items.map(item=>[item,{
    title:`${contextIds.value.has(item.record.id)?'Linked context · ':''}${item.record.title}\n${item.label} · ${dateTime.format(item.start)}${item.end>item.start?' → '+dateTime.format(item.end):''}\nSource: ${item.record.collectionTitle||item.record.source}`,
    time:clockTime(new Date(item.start).toISOString())
  }] as const)))
})
const unscheduledTray=ref<InstanceType<typeof UnscheduledTray>>()
const unscheduled=computed(()=>unscheduledRecords(props.records,props.plans,props.relations))
const style=computed(()=>({'--month-day-min':`${density.value.dayWidth}px`,'--month-week-min':`${density.value.weekHeight}px`}))
function title(item:MonthSegment){return itemPresentation.value.get(item)?.title||item.record.title}
function canMove(item:MonthSegment){return item.planned?Boolean(props.canEditPlans&&props.plans.some(plan=>plan.id===item.id)):!item.record.readonly&&Boolean(props.canEditRecord?.(item.record))}
function offsetAt(event:PointerEvent){
  const bounds=viewport.value?.getBoundingClientRect()
  if(!bounds||event.clientX<bounds.left||event.clientX>=bounds.right||event.clientY<bounds.top||event.clientY>=bounds.bottom)return null
  const rows=Array.from(root.value?.querySelectorAll<HTMLElement>('.month-week')||[])
  for(let index=0;index<rows.length;index++){
    const rect=rows[index]!.getBoundingClientRect()
    if(event.clientY>=rect.top&&event.clientY<rect.bottom&&event.clientX>=rect.left&&event.clientX<rect.right)return index*7+Math.min(6,Math.floor((event.clientX-rect.left)/(rect.width/7)))
  }
  return null
}
function beginCreation(event:PointerEvent){
  if(!props.canCreate||event.button!==0||drag.value||newRange.value||(event.target as HTMLElement).closest('button,input,select,a'))return
  const from=offsetAt(event);if(from===null)return
  if(event.pointerType==='touch'){touch.tap(event,()=>{if(props.canCreate)emit('create',creationSelection(period.value.gridStart,from,from,{daysCount:period.value.dayCount,origin:'calendar'}).range)});return}
  event.preventDefault();newRange.value={pointerId:event.pointerId,from,originX:event.clientX,originY:event.clientY,moved:false,selection:creationSelection(period.value.gridStart,from,from,{daysCount:period.value.dayCount,origin:'calendar'})};root.value?.setPointerCapture(event.pointerId)
}
function beginMove(event:PointerEvent,item:MonthSegment,armed=false){
  if(event.button!==0||drag.value||newRange.value||!canMove(item))return
  if(event.pointerType==='touch'&&!armed){touch.edit(event,{target:event.currentTarget as HTMLElement,eligible:()=>{const latest=props.records.find(record=>record.id===item.record.id);return Boolean(latest&&canMove({...item,record:latest}))},arm:()=>beginMove(event,item,true),move:movePointer,end:finishPointer,cancel:cancelPointer});return}
  const from=offsetAt(event);if(from===null)return
  event.preventDefault();event.stopPropagation();const plan=item.planned?props.plans.find(plan=>plan.id===item.id):undefined
  drag.value={pointerId:event.pointerId,item:{...item,record:{...item.record}},plan:plan?{...plan}:undefined,from,originX:event.clientX,originY:event.clientY,clientX:event.clientX,clientY:event.clientY,moved:false,valid:false};root.value?.setPointerCapture(event.pointerId)
}
function movePointer(event:PointerEvent){
  const current=drag.value||newRange.value;if(!current||current.pointerId!==event.pointerId)return
  const moved=current.moved||Math.hypot(event.clientX-current.originX,event.clientY-current.originY)>=4
  if(!moved)return
  event.preventDefault();const to=offsetAt(event)
  if(drag.value){const current=drag.value,delta=to===null?0:to-current.from,dateEdit=current.plan?undefined:calendarMoveEdit(current.item.record,delta),planEdit=current.plan?calendarPlanMove(current.plan,delta):undefined;drag.value={...current,clientX:event.clientX,clientY:event.clientY,moved,valid:to!==null&&Boolean(dateEdit||planEdit),dateEdit,planEdit}}
  else if(newRange.value&&to!==null)newRange.value={...newRange.value,moved,selection:creationSelection(period.value.gridStart,newRange.value.from,to,{daysCount:period.value.dayCount,dragged:true,origin:'calendar'})}
}
function cancelPointer(){const current=drag.value||newRange.value;if(current?.moved)suppressClickUntil=Date.now()+400;drag.value=null;newRange.value=null;if(current&&root.value?.hasPointerCapture(current.pointerId))root.value.releasePointerCapture(current.pointerId)}
function finishPointer(event:PointerEvent){
  const moving=drag.value,creating=newRange.value,current=moving||creating;if(!current||current.pointerId!==event.pointerId)return
  event.preventDefault();event.stopPropagation();cancelPointer()
  if(creating){if(props.canCreate&&offsetAt(event)!==null)emit('create',creating.selection.range);return}
  if(!moving)return
  suppressClickUntil=Date.now()+400
  if(!moving.moved){emit('open',moving.item.record);return}
  if(!moving.valid)return
  const latest=props.records.find(record=>record.id===moving.item.record.id),latestPlan=moving.plan&&props.plans.find(plan=>plan.id===moving.plan!.id)
  if(moving.planEdit&&props.canEditPlans&&latestPlan&&latestPlan.start===moving.plan?.start&&latestPlan.end===moving.plan?.end)emit('planEdit',moving.planEdit)
  else if(moving.dateEdit&&latest&&!latest.readonly&&props.canEditRecord?.(latest)&&['etag','start','due','end','allDay'].every(field=>latest[field as keyof WorkspaceRecord]===moving.item.record[field as keyof WorkspaceRecord]))emit('dateEdit',moving.dateEdit)
}
function openItem(record:WorkspaceRecord){if(Date.now()>=suppressClickUntil)emit('open',record)}
function keydown(event:KeyboardEvent){if(event.key==='Escape'&&(drag.value||newRange.value)){event.preventDefault();event.stopPropagation();touch.cancel();cancelPointer()}}
function segmentStyle(item:MonthSegment){return {gridColumn:`${item.first+1} / ${item.last+1}`,gridRow:item.lane+2,'--record-color':props.colorFor(item.record),'--source-color':sourceTint(item.record)}}
function selectedCell(index:number){return Boolean(newRange.value&&index>=newRange.value.selection.startOffset&&index<newRange.value.selection.endOffset)}
let zoomBase:{dayWidth:number;weekHeight:number;scrollLeft:number;centerX:number;weekIndex:number;weekFraction:number}|undefined
function startZoom(center:{x:number;y:number}){if(!viewport.value)return;const bounds=viewport.value.getBoundingClientRect(),rows=Array.from(root.value?.querySelectorAll<HTMLElement>('.month-week')||[]),index=Math.max(0,rows.findIndex(row=>{const rect=row.getBoundingClientRect();return center.y>=rect.top&&center.y<rect.bottom})),week=rows[index],rect=week?.getBoundingClientRect();zoomBase={dayWidth:(week?.clientWidth||density.value.dayWidth*7)/7,weekHeight:density.value.weekHeight,scrollLeft:viewport.value.scrollLeft,centerX:center.x-bounds.left,weekIndex:index,weekFraction:rect?Math.max(0,Math.min(1,(center.y-rect.top)/rect.height)):0}}
function zoom(scale:number,center:{x:number;y:number}){if(!zoomBase||!viewport.value)return;const before=zoomBase,next=monthGridZoom(before.dayWidth,before.weekHeight,scale);density.value=next;void nextTick(()=>{if(!viewport.value)return;const bounds=viewport.value.getBoundingClientRect(),week=root.value?.querySelectorAll<HTMLElement>('.month-week')[before.weekIndex],rect=week?.getBoundingClientRect();const width=(week?.clientWidth||next.dayWidth*7)/7;viewport.value.scrollLeft=(before.scrollLeft+before.centerX)*width/before.dayWidth-(center.x-bounds.left);if(rect)viewport.value.scrollTop+=rect.top+before.weekFraction*rect.height-center.y;pinSourceEdges()})}
function changeDensity(scale:number){const bounds=viewport.value?.getBoundingClientRect();if(!bounds)return;const center={x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2};startZoom(center);zoom(scale,center)}
function resetDensity(){density.value={dayWidth:100,weekHeight:126};void nextTick(pinSourceEdges)}
function wheel(event:WheelEvent){touch.stopCoast();cancelPointer();if(!event.ctrlKey)return;event.preventDefault();event.stopPropagation();const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?200:1);changeDensity(Math.exp(-delta*.002))}
const touch=usePlannerTouch(root,{eligible:target=>Boolean(target.closest('.month-week,.month-weekdays')),pan:(dx,dy)=>{if(viewport.value){viewport.value.scrollLeft-=dx;viewport.value.scrollTop-=dy}},pinchStart:startZoom,pinch:zoom,cancel:cancelPointer})
watch(()=>[props.scopeId,period.value.gridStart],()=>{touch.cancel();hoverId.value=null;focusId.value=null;void nextTick(()=>{if(viewport.value){viewport.value.scrollTop=0;viewport.value.scrollLeft=0}})})
watch(()=>props.canCreate,value=>{if(!value&&newRange.value)cancelPointer()})
watch(()=>{if(!drag.value)return true;const latest=props.records.find(record=>record.id===drag.value!.item.record.id);return Boolean(latest&&canMove({...drag.value.item,record:latest}))},allowed=>{if(drag.value&&!allowed)cancelPointer()})
onMounted(()=>{document.addEventListener('keydown',keydown,true);clockTimer=setInterval(()=>today.value=dayKey(new Date()),60000)})
watch([weeks,density],()=>void nextTick(pinnedLabels.invalidate),{flush:'post'})
onMounted(()=>{pinSourceEdges();sizeObserver=new ResizeObserver(pinnedLabels.invalidate);if(viewport.value)sizeObserver.observe(viewport.value)})
onBeforeUnmount(()=>{document.removeEventListener('keydown',keydown,true);clearInterval(clockTimer);sizeObserver?.disconnect();cancelPointer()})
async function revealRecord(id:string){
  if(await unscheduledTray.value?.revealRecord(id))return true
  await nextTick()
  const item=Array.from(root.value?.querySelectorAll<HTMLElement>('[data-record-id]')||[]).find(element=>element.dataset.recordId===id)
  const scroller=item?.closest<HTMLElement>('.month-scroll')
  if(!item||!scroller)return false
  const box=item.getBoundingClientRect(),bounds=scroller.getBoundingClientRect()
  scroller.scrollTop+=box.top-bounds.top-32
  if(box.left<bounds.left||box.right>bounds.right)scroller.scrollLeft+=box.left-bounds.left
  item.focus({preventScroll:true});return true
}
defineExpose({changeDensity,resetDensity,revealRecord})
</script>
<template>
  <section ref="root" class="calendar-view month-calendar" :class="{'is-moving-item':drag?.moved}" :style="style" aria-label="Month calendar" @pointermove="movePointer" @pointerup="finishPointer" @pointercancel="cancelPointer" @lostpointercapture="cancelPointer">
    <UnscheduledTray ref="unscheduledTray" class="month-layout" :records="unscheduled" :selected-id="selectedId" :preference-key="preferenceKey" :persist-presentation="persistPresentation" :color-for="colorFor" :source-color-for="sourceTint" :tags-for="tags" :hovered-id="activeId" :related-ids="selectedLinks" :highlighted-ids="linkedIds" @hover="(id,event)=>event.type.startsWith('focus')?focusId=id:hoverId=id" @open="emit('open',$event)">
      <div ref="viewport" class="month-scroll" tabindex="0" aria-label="Calendar month dates" @wheel="wheel" @scroll="pinSourceEdges">
        <div class="month-grid">
          <div class="month-weekdays"><span v-for="date in weeks[0]?.days" :key="dayKey(date)" :data-date="dayKey(date)" :class="{weekend:isWeekend(date)}">{{dateLabels.get(+date)?.weekday}}</span></div>
          <div v-for="(week,index) in weeks" :key="week.start" class="month-week" :style="{gridTemplateRows:`30px repeat(${week.lanes}, 29px) minmax(8px,1fr)`}" @pointerdown="beginCreation">
            <div v-for="(date,dayIndex) in week.days" :key="dayKey(date)" class="month-cell" :class="{weekend:isWeekend(date),outside:dayKey(date)<period.start||dayKey(date)>=period.end,today:dayKey(date)===today,'range-selected':selectedCell(index*7+dayIndex)}" :style="{gridColumn:dayIndex+1}" :data-date="dayKey(date)"></div>
            <button v-for="(date,dayIndex) in week.days" :key="'date-'+dayKey(date)" class="month-day-number" :class="{outside:dayKey(date)<period.start||dayKey(date)>=period.end,today:dayKey(date)===today}" :style="{gridColumn:dayIndex+1,gridRow:1}" :aria-label="'Open day '+dateLabels.get(+date)?.full" @click="emit('openDay',dayKey(date))">{{date.getDate()}}<span v-if="date.getDate()===1">{{dateLabels.get(+date)?.month}}</span></button>
            <button v-for="item in week.items" :key="item.id" class="month-item all-day-event" :class="{selected:item.record.id===selectedId,related:selectedLinks.has(item.record.id),'hover-linked':linkedIds.has(item.record.id),hovered:item.record.id===activeId,'can-move':canMove(item),moving:drag?.moved&&drag.item.id===item.id,planned:item.planned,'continues-before':item.continuesBefore,'continues-after':item.continuesAfter}" :style="segmentStyle(item)" :title="title(item)" :aria-label="title(item)" :data-record-id="item.record.id" @pointerenter="hoverId=item.record.id" @pointerleave="hoverId=null" @focus="focusId=item.record.id" @blur="focusId=null" @pointerdown.stop="beginMove($event,item)" @click="openItem(item.record)"><span class="month-source-edge" aria-hidden="true"></span><span class="month-pinned-label"><component :is="icon(item.record)" :size="12"/><span v-if="!item.allDay" class="month-item-time">{{itemPresentation.get(item)?.time}}</span><span v-else-if="item.point" class="month-item-kind">{{item.label}}</span><span class="month-item-title">{{item.record.title}}</span><RecordTagMarkers :tags="tags(item.record)" :compact="true" :limit="2"/></span></button>
          </div>
        </div>
      </div>
    </UnscheduledTray>
    <div v-if="drag?.moved" class="month-drag-hint" role="status">{{drag.valid?'Release to move · Esc to cancel':'Drop inside a date cell · Esc to cancel'}}</div>
    <div v-if="newRange" class="month-drag-hint" role="status">{{newRange.selection.range.start}} → {{newRange.selection.range.end}} · Release to create</div>
  </section>
</template>
<style scoped>
:global(.app-main:has(>.workspace-body>.month-calendar)){height:calc(100dvh - var(--app-header-height,52px) - var(--workspace-inset,12px));min-height:0}
:global(.workspace-body:has(>.month-calendar)){display:flex;flex-direction:column;min-height:0}
.month-calendar{display:flex;flex:1;min-width:0;min-height:0;position:relative;flex-direction:column}
.month-layout{flex:1;min-height:0}.month-scroll{flex:1;overflow:auto;min-width:0;min-height:0;overscroll-behavior:contain;scrollbar-width:thin}
.month-grid{min-width:calc(7 * var(--month-day-min));width:100%;min-height:100%;background:var(--surface);user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.month-weekdays{position:sticky;top:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));height:var(--calendar-date-header);background:var(--surface);z-index:4;touch-action:none;border-bottom:1px solid var(--border)}
.month-weekdays span{display:grid;place-items:center;font-size:var(--calendar-date-weekday);color:var(--muted);text-align:center;padding:var(--calendar-date-padding) 0}
.month-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-height:var(--month-week-min);position:relative;isolation:isolate;touch-action:none;border-bottom:1px solid var(--border);row-gap:2px;padding-bottom:3px}
.month-cell{grid-row:1 / -1;border-right:1px solid var(--border);z-index:-1;background:var(--surface)}.month-cell.outside{background:var(--canvas)}.month-cell.today{background:color-mix(in srgb,var(--primary) 5%,var(--surface))}.month-cell.range-selected{background:var(--primary-soft);box-shadow:inset 0 0 0 1px var(--primary)}
.month-day-number{justify-self:start;align-self:center;display:flex;align-items:center;gap:5px;min-width:28px;height:28px;margin-left:3px;padding:2px 6px;font-size:12px;border-radius:14px}.month-day-number span{font-size:10px;color:var(--muted)}.month-day-number.outside{color:var(--muted)}.month-day-number.today{background:var(--primary);color:var(--on-primary)}
.month-week .month-item{position:relative;display:flex;align-items:center;gap:4px;width:calc(100% - 6px);min-width:0;height:27px;margin:0 3px;padding:3px 5px;border:0;border-left:3px solid var(--source-color);background:color-mix(in srgb,var(--record-color) 16%,var(--surface));color:var(--text);font-size:11px;line-height:18px;text-align:left;overflow:hidden;touch-action:none}
.month-pinned-label{position:absolute;top:50%;transform:translateY(-50%);left:var(--label-offset,4px);width:var(--label-width,calc(100% - 8px));display:flex;align-items:center;gap:4px;overflow:hidden;pointer-events:none}.month-item-title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0;flex:1}.month-item svg,.month-item-time,.month-item-kind{flex:none}.month-item-time,.month-item-kind{font-size:9px;opacity:.8}.month-item.continues-before{border-top-left-radius:0;border-bottom-left-radius:0}.month-item.continues-after{border-top-right-radius:0;border-bottom-right-radius:0}
.month-source-edge{position:absolute;left:var(--source-edge-offset,0px);top:0;bottom:0;width:3px;background:var(--source-color);opacity:var(--source-edge-visible,0);pointer-events:none;z-index:2}
.month-item.can-move{cursor:grab}.is-moving-item .month-item{cursor:grabbing}.month-item.selected,.month-item.hovered{outline:2px solid var(--primary);outline-offset:-2px}.month-item.hover-linked,.month-item.related{outline:2px dashed var(--primary);outline-offset:-2px}.month-item.moving{opacity:.8;outline:2px solid var(--primary)}.month-item.planned{border-top:1px dashed var(--record-color);border-bottom:1px dashed var(--record-color)}.month-item:focus-visible,.month-day-number:focus-visible{outline:2px solid var(--text);outline-offset:-2px}.touch-edit-armed{outline:2px solid var(--primary)!important;outline-offset:2px}
.month-drag-hint{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);z-index:9;pointer-events:none;background:var(--surface);border:1px solid var(--primary);box-shadow:var(--shadow);border-radius:6px;padding:8px 12px;font-size:12px;max-width:90%;white-space:nowrap}
@media(pointer:coarse){.month-day-number{min-width:32px;height:30px}}
</style>
