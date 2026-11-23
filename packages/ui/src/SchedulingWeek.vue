<script setup lang="ts">
import {useIsWeekend} from './useWeekendDays'
import RecordTagMarkers from './RecordTagMarkers.vue'
import CalendarAllDayDivider from './CalendarAllDayDivider.vue'
import {useAllDayResize} from './useAllDayResize'
import {calendarAllDaySize} from '@nextspace/core/calendar-sizing.mjs'
import {calendarTimedLayout,calendarLaneWindow} from '@nextspace/core/calendar-rendering.mjs'
import {useDateLabels} from './useDateLabels'
import './calendar-density.css'
import {sourceColor, normalizeColor, recordTags} from '@nextspace/core/record-presentation.mjs'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, PanelsTopLeft, X } from 'lucide-vue-next'
import type { Collection, PlanSession, RecordTag, WorkspaceRecord } from '@nextspace/contracts'
import { calendarAllDayLayout, calendarItem, calendarTimedItems, type CalendarItem } from '@nextspace/core/calendar-items.mjs'
import { creationSelection } from '@nextspace/core/range-selection.mjs'
import { clockTime, dateValue, dayKey, safeColor } from './planner-ui'
import {schedulePreviewBounds,shiftSchedulePreview} from '@nextspace/core/schedule-preview.mjs'
import {usePlannerTouch} from './usePlannerTouch'
import {panCalendarVertical} from './calendarTouchSurface'

type Slot={start:string;end:string;allDay:boolean}
const isWeekend=useIsWeekend()
const props=withDefaults(defineProps<{records:WorkspaceRecord[];collections:Collection[];plans?:PlanSession[];start:string;end:string;allDay:boolean;disabled?:boolean;contextKey?:string;draftLabel?:string;calendarColors?:Record<string,string>;colorFor?:(record:WorkspaceRecord)=>string;sourceColorFor?:(record:WorkspaceRecord)=>string;tagsFor?:(record:WorkspaceRecord)=>RecordTag[]}>(),{plans:()=>[],disabled:false,draftLabel:'New booking',calendarColors:()=>({})})
const emit=defineEmits<{change:[slot:Slot]}>()
const HOUR_HEIGHT=44
const root=ref<HTMLElement>(),viewport=ref<HTMLElement>(),allDayViewport=ref<HTMLElement>(),timeGrid=ref<HTMLElement>(),allDayGrid=ref<HTMLElement>(),calendarArea=ref<HTMLElement>(),dateHeading=ref<HTMLElement>()
const availableHeight=ref(350)
const allDayScrollTop=ref(0),focusedItemId=ref<string|null>(null)
const scrollbar=ref(0)
let observer:ResizeObserver|undefined
const detail=ref<CalendarItem|null>(null)
const weekOf=(value:string|Date)=>{const day=typeof value==='string'?dateValue(value):new Date(value);if(!Number.isFinite(+day))day.setTime(Date.now());day.setHours(0,0,0,0);day.setDate(day.getDate()-((day.getDay()+6)%7));return day}
const anchor=ref(weekOf(props.start))
const days=computed(()=>Array.from({length:7},(_,i)=>{const day=new Date(anchor.value);day.setDate(day.getDate()+i);return day}))
const dateLabels=useDateLabels(()=>days.value)
const rangeLabel=computed(()=>`${days.value[0]!.toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${days.value[6]!.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`)
const today=dayKey(new Date())
const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone
const hours=Array.from({length:24},(_,i)=>i)
const contextRecords=computed(()=>props.records.filter(record=>record.status?.toUpperCase()!=='CANCELLED'))
const nativeItems=computed(()=>contextRecords.value.map(calendarItem).filter((item):item is CalendarItem=>Boolean(item)))
const allDayLayout=computed(()=>calendarAllDayLayout(nativeItems.value,days.value))
const allDayRows=computed(()=>allDayLayout.value.lanes+(allDayPreviewStyle.value?1:0))
const allDaySize=computed<ReturnType<typeof calendarAllDaySize>>(()=>calendarAllDaySize({lanes:allDayRows.value,availableHeight:availableHeight.value,manualHeight:allDayResize.manualHeight.value}))
const allDayResize=useAllDayResize(()=>allDaySize.value,()=>{touch.cancel();cancel()})
const laneWindow=computed(()=>calendarLaneWindow({scrollTop:allDayScrollTop.value,viewportHeight:allDaySize.value.height,lanes:allDayLayout.value.lanes}))
const firstLane=computed(()=>laneWindow.value.first),lastLane=computed(()=>laneWindow.value.last)
const renderedAllDayItems=computed(()=>allDayLayout.value.items.filter(item=>item.lane>=firstLane.value&&item.lane<lastLane.value||item.record.id===focusedItemId.value))
const timedItems=computed(()=>calendarTimedItems(contextRecords.value,props.plans,nativeItems.value))
const sourceTint=(record:WorkspaceRecord)=>props.sourceColorFor?.(record)||sourceColor(record,props.collections)
const tagsByRecord=computed(()=>new WeakMap(props.records.map(record=>[record,props.tagsFor?.(record)||recordTags(record)] as const)))
const itemTags=(record:WorkspaceRecord)=>tagsByRecord.value.get(record)||props.tagsFor?.(record)||recordTags(record)
const colorFor=(record:WorkspaceRecord)=>props.colorFor?.(record)||normalizeColor(record.color)||safeColor(props.calendarColors[record.collectionId||''])||safeColor(props.collections.find(collection=>collection.id===record.collectionId)?.color)||'var(--primary)'
const iconFor=(record:WorkspaceRecord)=>record.kind==='card'?PanelsTopLeft:record.kind==='task'?CheckCircle2:CalendarDays
const blocksByDay=computed(()=>calendarTimedLayout(timedItems.value,days.value,{minimumMinutes:20,minimumDuration:20}))
function dayBlocks(day:Date){return blocksByDay.value.get(+day)||[]}
const itemPresentation=computed(()=>new Map([...nativeItems.value,...timedItems.value].map(item=>{
  const time=item.allDay?'':clockTime(new Date(item.start).toISOString()),tags=itemTags(item.record)
  return [item.id,{time,title:`${item.record.title}\n${item.record.collectionTitle||item.label} · ${item.allDay?'All day':`${time}–${clockTime(new Date(item.end).toISOString())}`}${item.record.kind==='event'?(item.record.busy===false?' · Free':' · Calendar booking'):' · Work dates, not a booking'}${tags.length?'\nTags: '+tags.map(tag=>tag.title).join(', '):''}`}]
})))
function contextTitle(item:CalendarItem){return itemPresentation.value.get(item.id)?.title||item.record.title}
function offset(value:string){const date=dateValue(value);return (Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-Date.UTC(anchor.value.getFullYear(),anchor.value.getMonth(),anchor.value.getDate()))/86400000+(date.getHours()*60+date.getMinutes())/1440}
type Gesture={id:number;target:HTMLElement;timed:boolean;mode:'create'|'move'|'start'|'end';from:number;originX:number;originY:number;moved:boolean;base:Slot;slot:Slot}
const gesture=ref<Gesture|null>(null)
let moveFrame:number|undefined,pendingMove:PointerEvent|undefined,touchedViewport:HTMLElement|undefined
const touch=usePlannerTouch(root,{
  eligible:target=>Boolean(target.closest('.week-draft')),
  start:event=>{touchedViewport=(event.target as HTMLElement).closest('.week-all-day-scroll')?allDayViewport.value:viewport.value},
  pan:(_dx,dy)=>panCalendarVertical(touchedViewport,allDayViewport.value,viewport.value,dy),
  pinchStart:()=>{},pinch:()=>{},cancel:()=>cancel(),
})
const preview=computed(()=>gesture.value?.slot||{start:props.start,end:props.end,allDay:props.allDay})
const previewBounds=computed(()=>schedulePreviewBounds(anchor.value,preview.value))
const previewLabel=computed(()=>{
  const slot=preview.value,a=dateValue(slot.start),z=dateValue(slot.end)
  if(!Number.isFinite(+a)||!Number.isFinite(+z))return 'Choose a time'
  const label=(date:Date)=>date.toLocaleDateString(undefined,{month:'short',day:'numeric'})
  if(slot.allDay){z.setDate(z.getDate()-1);return label(a)+(dayKey(a)===dayKey(z)?'':` – ${label(z)}`)}
  return `${a.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} · ${clockTime(slot.start)} – ${dayKey(a)!==dayKey(z)?`${label(z)} `:''}${clockTime(slot.end)}`
})
const allDayPreviewStyle=computed(()=>{const bounds=previewBounds.value;if(!preview.value.allDay||!bounds||bounds.last<=0||bounds.first>=7)return undefined;return {gridColumn:`${Math.max(0,Math.floor(bounds.first))+2} / ${Math.min(7,Math.ceil(bounds.last))+2}`,gridRow:allDayLayout.value.lanes+1}})
function timedPreview(index:number){const bounds=previewBounds.value;if(preview.value.allDay||!bounds)return undefined;const first=Math.max(index,bounds.first),last=Math.min(index+1,bounds.last);return last>first?{top:`${(first-index)*24*HOUR_HEIGHT}px`,height:`${Math.max(18,(last-first)*24*HOUR_HEIGHT)}px`}:undefined}
function pointerOffset(event:PointerEvent,timed:boolean){const grid=timed?timeGrid.value:allDayGrid.value;if(!grid)return 0;const rect=grid.getBoundingClientRect();const x=Math.max(0,Math.min(6.999999,(event.clientX-rect.left-44)/(rect.width-44)*7));return timed?Math.floor(x)+Math.max(0,Math.min(1,(event.clientY-rect.top)/(24*HOUR_HEIGHT))):x}
function begin(event:PointerEvent,timed:boolean,mode:Gesture['mode']='create',armed=false){
  if(props.disabled||event.button!==0||gesture.value||!root.value)return
  if(event.pointerType==='touch'&&!armed){
    if(mode!=='create')touch.edit(event,{target:event.currentTarget as HTMLElement,eligible:()=>!props.disabled&&Boolean(previewBounds.value),arm:()=>begin(event,timed,mode,true),move,end:finish,cancel})
    return
  }
  if(mode==='create'&&(event.target as HTMLElement).closest('button,.week-gutter'))return
  const from=pointerOffset(event,timed),bounds=previewBounds.value
  if(mode!=='create'&&!bounds)return
  event.preventDefault();event.stopPropagation()
  const slot=mode==='create'?creationSelection(anchor.value,from,from,{timed,daysCount:7}).range:{start:props.start,end:props.end,allDay:props.allDay}
  // Capture on the stable surface: a draft moving to another day replaces its
  // old chip, which must not cancel the gesture merely by losing that chip.
  const target=root.value
  gesture.value={id:event.pointerId,target,timed,mode,from,originX:event.clientX,originY:event.clientY,moved:false,base:{start:props.start,end:props.end,allDay:props.allDay},slot}
  target.setPointerCapture(event.pointerId)
  target.addEventListener('lostpointercapture',cancel)
}
function updateMove(event:PointerEvent){
  const g=gesture.value;if(!g||g.id!==event.pointerId)return
  const to=pointerOffset(event,g.timed),moved=g.moved||Math.hypot(event.clientX-g.originX,event.clientY-g.originY)>=4
  if(!moved)return
  let slot:Slot|null
  if(g.mode==='create')slot=creationSelection(anchor.value,g.from,to,{timed:g.timed,dragged:true,daysCount:7}).range
  else slot=shiftSchedulePreview(anchor.value,g.base,g.mode,to-g.from)
  if(!slot)return
  gesture.value={...g,moved,slot};event.preventDefault()
}
function flushMove(){if(moveFrame!==undefined)cancelAnimationFrame(moveFrame);moveFrame=undefined;const event=pendingMove;pendingMove=undefined;if(event)updateMove(event)}
function move(event:PointerEvent){if(!gesture.value||gesture.value.id!==event.pointerId)return;event.preventDefault();pendingMove=event;if(moveFrame===undefined)moveFrame=requestAnimationFrame(flushMove)}
function cancel(){if(moveFrame!==undefined)cancelAnimationFrame(moveFrame);moveFrame=undefined;pendingMove=undefined;const g=gesture.value;gesture.value=null;g?.target.removeEventListener('lostpointercapture',cancel);if(g?.target.hasPointerCapture(g.id))g.target.releasePointerCapture(g.id)}
function finish(event:PointerEvent){if(!gesture.value||gesture.value.id!==event.pointerId)return;move(event);flushMove();const g=gesture.value;if(!g)return;const slot=g.slot;cancel();if(!props.disabled&&(g.mode==='create'||g.moved)&&JSON.stringify(slot)!==JSON.stringify(g.base))emit('change',slot);event.preventDefault();event.stopPropagation()}
function key(event:KeyboardEvent){if(event.key==='Escape'&&(gesture.value||touch.mode.value!=='idle')){event.preventDefault();event.stopPropagation();touch.cancel();cancel()}}
function keyboardShift(event:KeyboardEvent,mode:'move'|'start'|'end'){
  const amounts:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:props.allDay?-1:-1/96,ArrowDown:props.allDay?1:1/96},amount=amounts[event.key],bounds=previewBounds.value
  if(amount===undefined||!bounds||props.disabled)return
  event.preventDefault();event.stopPropagation()
  const slot=shiftSchedulePreview(anchor.value,{start:props.start,end:props.end,allDay:props.allDay},mode,amount)
  if(slot)emit('change',slot)
}
function navigate(amount:number){touch.cancel();cancel();const day=new Date(anchor.value);day.setDate(day.getDate()+amount*7);anchor.value=day;detail.value=null}
function showSelection(){touch.cancel();cancel();anchor.value=weekOf(props.start);scrollToSelection()}
async function scrollToSelection(){await nextTick();if(viewport.value){const start=dateValue(props.start);viewport.value.scrollTop=Math.max(0,(Number.isFinite(+start)&&!props.allDay?start.getHours()-1:8)*HOUR_HEIGHT)}}
watch(()=>props.start,(value,old)=>{if(value===old||gesture.value)return;const day=offset(value);if(Number.isFinite(day)&&(day<0||day>=7))anchor.value=weekOf(value);scrollToSelection()})
watch(()=>props.disabled,value=>{if(value){touch.cancel();cancel()}})
watch(()=>[props.start,props.end,props.allDay,props.contextKey],()=>{if(gesture.value||touch.mode.value!=='idle'){touch.cancel();cancel()}},{flush:'sync'})
watch(()=>props.allDay,()=>allDayResize.reset())
onMounted(()=>{scrollToSelection();if(viewport.value){const measure=()=>{if(viewport.value)scrollbar.value=viewport.value.offsetWidth-viewport.value.clientWidth;if(calendarArea.value)availableHeight.value=Math.max(0,calendarArea.value.clientHeight-(dateHeading.value?.clientHeight||0)-6)};measure();observer=new ResizeObserver(measure);observer.observe(viewport.value);if(calendarArea.value)observer.observe(calendarArea.value);if(dateHeading.value)observer.observe(dateHeading.value)}window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',key,true)})
onBeforeUnmount(()=>{cancel();observer?.disconnect();window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',key,true)})
</script>

<template>
  <section ref="root" class="scheduling-week" :class="{dragging:gesture}" :style="{'--week-scrollbar':`${scrollbar}px`}" aria-label="Choose a calendar time">
    <header class="week-toolbar"><div><strong>{{rangeLabel}}</strong><small>{{timeZone}}</small></div><nav aria-label="Scheduling week"><button type="button" class="icon-button" aria-label="Previous scheduling week" :disabled="Boolean(gesture)" @click="navigate(-1)"><ChevronLeft :size="18"/></button><button type="button" class="week-selection-link" @click="showSelection">Selected week</button><button type="button" class="icon-button" aria-label="Next scheduling week" :disabled="Boolean(gesture)" @click="navigate(1)"><ChevronRight :size="18"/></button></nav></header>
    <div ref="calendarArea" class="week-calendar-area" :style="{'--all-day-height':`${allDaySize.height}px`}">
    <div ref="dateHeading" class="week-heading"><span class="week-gutter"></span><div v-for="day in days" :key="dayKey(day)" :data-date="dayKey(day)" :class="{weekend:isWeekend(day),today:dayKey(day)===today}"><span>{{dateLabels.get(+day)?.weekday}}</span><strong>{{day.getDate()}}</strong></div></div>
    <div ref="allDayViewport" class="week-all-day-scroll" tabindex="0" aria-label="All-day context, scroll for more" @scroll="allDayScrollTop=($event.currentTarget as HTMLElement).scrollTop">
      <div ref="allDayGrid" class="week-all-day" :style="{gridTemplateRows:allDayRows?`repeat(${allDayRows},28px)`:'18px'}" @pointerdown="begin($event,false)">
        <span class="week-gutter all-day-gutter">All day<br/>& work</span>
        <span v-for="(day,index) in days" :key="dayKey(day)" class="week-all-day-cell" :data-date="dayKey(day)" :class="{weekend:isWeekend(day)}" :style="{gridColumn:index+2}" aria-hidden="true"></span>
        <button v-for="item in renderedAllDayItems" :key="item.id" type="button" class="week-context week-all-day-item" :class="{work:item.record.kind!=='event'}" :style="{gridColumn:`${item.first+2} / ${item.last+2}`,gridRow:item.lane+1,'--item-color':colorFor(item.record),'--source-color':sourceTint(item.record)}" :data-record-id="item.record.id" :title="contextTitle(item)" @focus="focusedItemId=item.record.id" @blur="focusedItemId=null" @click="detail=item"><component :is="iconFor(item.record)" :size="12"/><span>{{item.record.title}}</span><RecordTagMarkers class="week-tags" :tags="itemTags(item.record)" :limit="2"/></button>
        <span v-if="!allDayPreviewStyle&&!allDayLayout.lanes" class="week-all-day-invite" :style="{gridColumn:'2 / 9',gridRow:allDayLayout.lanes+1}" aria-hidden="true">{{disabled?'':'Drag here for an all-day booking'}}</span>
        <div v-if="allDayPreviewStyle" class="week-draft all-day-draft" :style="allDayPreviewStyle" @pointerdown="begin($event,false,'move')"><button type="button" class="draft-edge start" :disabled="disabled" aria-label="Adjust booking start day" @pointerdown.stop="begin($event,false,'start')" @keydown="keyboardShift($event,'start')"></button><button type="button" class="draft-body" :disabled="disabled" aria-label="Move selected all-day booking" @keydown="keyboardShift($event,'move')">{{draftLabel}} · {{previewLabel}}</button><button type="button" class="draft-edge end" :disabled="disabled" aria-label="Adjust booking end day" @pointerdown.stop="begin($event,false,'end')" @keydown="keyboardShift($event,'end')"></button></div>
      </div>
    </div>
    <CalendarAllDayDivider :size="allDaySize" :active="allDayResize.active.value" @begin="allDayResize.begin" @keyboard="allDayResize.keyboard" @reset="allDayResize.reset"/>
    <div ref="viewport" class="week-times-scroll" tabindex="0" aria-label="Week hours, scroll to see all 24 hours">
      <div ref="timeGrid" class="week-time-grid" @pointerdown="begin($event,true)">
        <div class="week-gutter week-hours"><span v-for="hour in hours" :key="hour" :style="{top:`${hour*HOUR_HEIGHT}px`}">{{String(hour).padStart(2,'0')}}:00</span></div>
        <div v-for="(day,index) in days" :key="dayKey(day)" class="week-day-track" :data-day="dayKey(day)" :data-date="dayKey(day)" :class="{weekend:isWeekend(day),today:dayKey(day)===today}">
          <button v-for="block in dayBlocks(day)" :key="block.id" type="button" class="week-context week-timed-item" :class="{work:block.record.kind!=='event',free:block.record.busy===false}" :style="{top:`${block.from/60*HOUR_HEIGHT}px`,height:`${(block.to-block.from)/60*HOUR_HEIGHT}px`,left:`calc(${block.lane/block.lanes*100}% + 2px)`,width:`calc(${100/block.lanes}% - 4px)`,'--item-color':colorFor(block.record),'--source-color':sourceTint(block.record)}" :data-record-id="block.record.id" :title="contextTitle(block)" @click="detail=block"><strong><component :is="iconFor(block.record)" :size="11"/>{{block.record.title}}</strong><small>{{itemPresentation.get(block.id)?.time}}</small><RecordTagMarkers class="week-tags" :tags="itemTags(block.record)" :limit="2"/></button>
          <div v-if="timedPreview(index)" class="week-draft timed-draft" :style="timedPreview(index)" @pointerdown="begin($event,true,'move')"><button v-if="previewBounds&&previewBounds.first>=index" type="button" class="draft-edge start" :disabled="disabled" aria-label="Adjust booking start time" @pointerdown.stop="begin($event,true,'start')" @keydown="keyboardShift($event,'start')"></button><button type="button" class="draft-body" :disabled="disabled" aria-label="Move selected booking" :title="previewLabel" @keydown="keyboardShift($event,'move')"><strong>{{draftLabel}}</strong><small>{{clockTime(preview.start)}} – {{clockTime(preview.end)}}</small></button><button v-if="previewBounds&&previewBounds.last<=index+1" type="button" class="draft-edge end" :disabled="disabled" aria-label="Adjust booking end time" @pointerdown.stop="begin($event,true,'end')" @keydown="keyboardShift($event,'end')"></button></div>
        </div>
      </div>
    </div>
    </div>
    <div v-if="detail" class="week-context-detail" role="status"><component :is="iconFor(detail.record)" :size="16" :style="{color:sourceTint(detail.record)}"/><div><strong>{{detail.record.title}}</strong><span>{{detail.record.collectionTitle}} · {{detail.allDay?'All day':`${clockTime(new Date(detail.start).toISOString())} – ${clockTime(new Date(detail.end).toISOString())}`}} · {{detail.record.kind==='event'?(detail.record.busy===false?'Free':'Calendar booking'):'Work dates, not a booking'}}</span><RecordTagMarkers :tags="itemTags(detail.record)" :compact="false"/></div><button type="button" class="icon-button" aria-label="Close calendar item preview" @click="detail=null"><X :size="15"/></button></div>
    <footer><span><Clock3 :size="14"/><strong>{{previewLabel}}</strong></span><small>{{disabled?'Saved booking preview':'Drag empty space to choose time. Move the blue booking or drag its edges.'}}</small></footer>
  </section>
</template>

<style scoped>
.week-draft,.week-draft button{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.scheduling-week{border:1px solid var(--border);border-radius:11px;overflow:hidden;min-width:0;background:var(--surface);--hour-height:44px}.scheduling-week.dragging{user-select:none}.week-calendar-area{display:flex;flex-direction:column;height:400px;max-height:60dvh;min-height:182px}.week-toolbar{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;gap:12px}.week-toolbar>div{display:flex;flex-direction:column;gap:3px}.week-toolbar strong{font-size:14px}.week-toolbar small{font-size:10px;color:var(--muted)}.week-toolbar nav{display:flex;align-items:center;gap:4px}.week-selection-link{font-size:11px;padding:6px;color:var(--primary)}.week-heading,.week-all-day,.week-time-grid{display:grid;grid-template-columns:44px repeat(7,minmax(0,1fr))}.week-heading{height:var(--calendar-date-header);flex:none;box-sizing:border-box;border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding-right:var(--week-scrollbar,0px)}.week-heading>div{display:flex;align-items:center;justify-content:center;gap:4px;border-left:1px solid var(--border);padding:var(--calendar-date-padding);font-size:var(--calendar-date-weekday)}.week-heading strong{font-size:var(--calendar-date-number)}.week-heading .today{color:var(--primary);box-shadow:inset 0 -2px var(--primary)}.week-gutter{color:var(--muted);font-size:9px;pointer-events:none}.week-all-day-scroll{height:var(--all-day-height,24px);flex:none;max-height:none;overflow-y:auto;scrollbar-gutter:stable;border-bottom:0}.week-all-day{position:relative;gap:3px 0;padding:3px 0;box-sizing:border-box;cursor:default;min-height:24px}.all-day-gutter{grid-column:1;grid-row:1/-1;text-align:center;padding-top:0;line-height:10px;font-size:8px}.week-all-day-cell{grid-row:1/-1;border-left:1px solid var(--border);pointer-events:none;margin-block:-3px}.week-context{--item-color:var(--primary);border:1px solid color-mix(in srgb,var(--item-color) 32%,var(--border));border-left:3px solid var(--item-color);background:color-mix(in srgb,var(--item-color) 15%,var(--surface));color:var(--text);border-radius:4px;overflow:hidden;text-align:left;cursor:pointer}.week-context:hover,.week-context:focus-visible{outline:1px solid var(--item-color);outline-offset:-1px}.week-all-day-item{display:flex;align-items:center;gap:4px;z-index:1;padding:3px 5px;margin:0 2px;min-width:0;font-size:10px}.week-all-day-item svg{flex-shrink:0}.week-all-day-item span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.week-context.work{border-left-style:dotted;background:color-mix(in srgb,var(--item-color) 6%,var(--surface))}.week-context.free{border-style:dashed;opacity:.8}.week-times-scroll{flex:1;min-height:0;height:0;overflow-y:scroll;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:auto}.week-time-grid{height:1056px;cursor:default}.week-hours{position:relative}.week-hours>span{position:absolute;right:5px;transform:translateY(-50%)}.week-hours>span:first-child{transform:none}.week-day-track{position:relative;border-left:1px solid var(--border);background:repeating-linear-gradient(to bottom,transparent 0,transparent 21px,color-mix(in srgb,var(--border) 45%,transparent) 21px,color-mix(in srgb,var(--border) 45%,transparent) 22px,transparent 22px,transparent 43px,var(--border) 43px,var(--border) 44px)}.week-day-track.today{background-color:color-mix(in srgb,var(--primary) 3%,var(--surface))}.week-timed-item{position:absolute;min-height:15px;padding:3px 4px;z-index:1;font-size:10px;line-height:1.2}.week-timed-item strong{font-weight:550;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow-wrap:anywhere}.week-timed-item svg{display:inline;vertical-align:-1px;margin-right:3px}.week-timed-item small{display:block;font-size:9px;margin-top:3px;opacity:.8}.week-draft{background:color-mix(in srgb,var(--primary) 26%,var(--surface));border:2px solid var(--primary);border-radius:5px;color:var(--text);z-index:4;box-shadow:0 2px 6px #0002;cursor:grab;position:relative;min-width:0;overflow:visible}.week-draft:active{cursor:grabbing}.all-day-draft{margin:0 2px}.timed-draft{position:absolute;left:2px;right:2px;min-height:18px}.draft-body{width:100%;height:100%;padding:5px 7px;overflow:hidden;text-align:left;font-size:10px;line-height:1.25;cursor:inherit;white-space:nowrap;text-overflow:ellipsis}.draft-body strong,.draft-body small{display:block;overflow:hidden;text-overflow:ellipsis}.draft-body strong{font-size:11px}.draft-body small{font-size:9px;margin-top:3px}.draft-body:focus-visible{outline:2px solid var(--text);outline-offset:2px}.draft-edge{position:absolute;padding:0;z-index:3;border:0;background:transparent}.draft-edge:after{content:'';position:absolute;background:var(--primary);border:1px solid var(--surface);border-radius:3px}.timed-draft .draft-edge{left:0;right:0;height:10px;cursor:ns-resize}.timed-draft .draft-edge.start{top:-5px}.timed-draft .draft-edge.end{bottom:-5px}.timed-draft .draft-edge:after{width:22px;height:4px;left:calc(50% - 11px);top:2px}.all-day-draft .draft-edge{top:0;bottom:0;width:12px;cursor:ew-resize}.all-day-draft .draft-edge.start{left:-6px}.all-day-draft .draft-edge.end{right:-6px}.all-day-draft .draft-edge:after{height:15px;width:4px;top:calc(50% - 8px);left:3px}.draft-edge:focus-visible{outline:2px solid var(--text);outline-offset:1px}.week-context-detail{display:flex;align-items:flex-start;gap:9px;padding:10px 12px;border-top:1px solid var(--border);background:var(--hover)}.week-context-detail>div{flex:1;min-width:0}.week-context-detail strong,.week-context-detail span{display:block;font-size:12px;overflow-wrap:anywhere}.week-context-detail span{font-size:11px;color:var(--muted);margin-top:4px}.scheduling-week footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:7px;padding:10px 12px;border-top:1px solid var(--border)}.scheduling-week footer>span{display:flex;align-items:center;gap:7px;font-size:12px}.scheduling-week footer small{font-size:10px;line-height:1.4;color:var(--muted)}@media(max-width:700px){.week-toolbar{padding-inline:8px}.week-toolbar strong{font-size:12px}.week-selection-link{font-size:10px}.week-context strong{font-size:9px}.draft-body{padding:4px 3px}.draft-body strong{font-size:9px}.draft-body small{font-size:8px}}

.week-context,.week-context.work{border-left-color:var(--source-color,var(--item-color))}.week-all-day-item .week-tags{margin-left:auto;flex-shrink:0}.week-timed-item .week-tags{position:absolute;bottom:3px;right:3px}.week-context-detail :deep(.record-tag-markers){margin-top:6px;display:flex}
</style>

<style scoped>.week-all-day-invite{pointer-events:none;align-self:center;padding-left:8px;color:var(--muted);font-size:10px}

</style>
