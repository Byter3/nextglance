<script setup lang="ts">
import RecordTagMarkers from './RecordTagMarkers.vue'
import {normalizeColor,recordTags} from '@nextspace/core/record-presentation.mjs'
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {CalendarDays,ChevronLeft,ChevronRight,Flag,GripVertical,Link2,X} from 'lucide-vue-next'
import type {RecordTag,Relation,WorkspaceRecord} from '@nextspace/contracts'
import {clockTime,dateValue,dayKey,inputDateTime,shortDate,sourceLabels} from './planner-ui'
import {convertCreationDateMode,shiftCreationDay} from '@nextspace/core/creation-dates.mjs'
import {dragRecordDateDraft,recordDateDraft,recordDateGeometry,recordDatePayload,selectRecordDateRange} from '@nextspace/core/record-date-editor.mjs'
import type {RecordDateDraft,RecordDatePayload} from '@nextspace/core/record-date-editor.mjs'

const props=withDefaults(defineProps<{record:WorkspaceRecord;records:WorkspaceRecord[];relations?:Relation[];busy?:boolean;error?:string;colorFor?:(record:WorkspaceRecord)=>string;sourceColorFor?:(record:WorkspaceRecord)=>string;tagsFor?:(record:WorkspaceRecord)=>RecordTag[]}>(),{relations:()=>[],busy:false,error:''})
const emit=defineEmits<{save:[dates:RecordDatePayload];cancel:[];dirty:[value:boolean]}>()
const draft=ref(recordDateDraft(props.record)),validation=ref(''),showAllContext=ref(false)
const baseline=JSON.stringify(draft.value),dayCount=14
const initialDay=dayKey(props.record.start||props.record.due||props.record.end||new Date().toISOString())
const anchor=ref(shiftCreationDay(initialDay,-2))
const lane=ref<HTMLElement>()
const work=computed(()=>props.record.kind!=='event')
const endLabel=computed(()=>work.value?'Deadline':'End')
const days=computed(()=>Array.from({length:dayCount},(_,i)=>{const key=shiftCreationDay(anchor.value,i),date=dateValue(key);return {key,date,weekend:[0,6].includes(date.getDay()),today:key===dayKey(new Date())}}))
const rangeLabel=computed(()=>`${dateValue(anchor.value).toLocaleDateString(undefined,{month:'short',day:'numeric'})} – ${dateValue(shiftCreationDay(anchor.value,dayCount-1)).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`)
const preview=computed(()=>({...props.record,start:draft.value.start||undefined,...(work.value?{due:draft.value.end||undefined}:{end:draft.value.end||undefined,allDay:draft.value.allDay})}))
const geometry=computed(()=>recordDateGeometry(preview.value,anchor.value,dayCount))
const hasDates=computed(()=>Boolean(draft.value.start||draft.value.end))
const relatedIds=computed(()=>new Set(props.relations.filter(edge=>edge.fromId===props.record.id||edge.toId===props.record.id).map(edge=>edge.fromId===props.record.id?edge.toId:edge.fromId)))
const context=computed(()=>props.records.filter(record=>record.id!==props.record.id&&['task','card','event'].includes(record.kind)&&record.status?.toUpperCase()!=='CANCELLED'&&(record.kind==='event'||record.collectionId===props.record.collectionId||relatedIds.value.has(record.id))).map(record=>({record,geometry:recordDateGeometry(record,anchor.value,dayCount),related:relatedIds.value.has(record.id)})).filter(row=>row.geometry).sort((a,b)=>Number(b.related)-Number(a.related)||Number(a.record.kind!=='event')-Number(b.record.kind!=='event')||(a.record.start||a.record.due||'').localeCompare(b.record.start||b.record.due||'')))
const shownContext=computed(()=>showAllContext.value?context.value:context.value.slice(0,8))
const signature=()=>JSON.stringify(draft.value)
watch(signature,value=>{validation.value='';emit('dirty',value!==baseline)},{immediate:true})
const dateInput=(value:string)=>!value?'':draft.value.allDay?dayKey(value):inputDateTime(value)
function setInput(bound:'start'|'end',event:Event){const value=(event.target as HTMLInputElement).value;if(value&&!draft.value.allDay){const date=new Date(value);if(!Number.isFinite(+date))return;draft.value[bound]=date.toISOString()}else draft.value[bound]=value}
const describe=(value:string)=>value?`${shortDate(value)}${value.includes('T')?' · '+clockTime(value):''}`:'Not set'
const geometryStyle=(value:ReturnType<typeof recordDateGeometry>)=>value?{left:`${value.left}%`,width:`${value.width}%`}:{}
const rowColor=(record:WorkspaceRecord)=>props.colorFor?.(record)||normalizeColor(record.color)||'var(--primary)'
const sourceTint=(record:WorkspaceRecord)=>props.sourceColorFor?.(record)||props.colorFor?.(record)||'var(--primary)'
const itemTags=(record:WorkspaceRecord)=>props.tagsFor?.(record)||recordTags(record)
const tagDescription=(record:WorkspaceRecord)=>itemTags(record).length?' · Tags: '+itemTags(record).map(tag=>tag.title).join(', '):''
function jump(offset:number){cancelDrag();anchor.value=shiftCreationDay(anchor.value,offset)}
function showSelection(){anchor.value=shiftCreationDay(dayKey(draft.value.start||draft.value.end||new Date().toISOString()),-2)}
function clear(bound?:'start'|'end'){if(props.busy)return;if(bound)draft.value[bound]='';else draft.value={...draft.value,start:'',end:''}}
let previousTimed:RecordDateDraft|undefined
function toggleDateOnly(event:Event){
  const target=(event.target as HTMLInputElement).checked,current={...draft.value}
  if(target&&!current.allDay)previousTimed=current
  const next=convertCreationDateMode(current,target,props.record.kind==='event'?'event':props.record.kind==='card'?'card':'task',previousTimed)
  draft.value=next
}
type Gesture={pointer:number;mode:'place'|'move'|'start'|'end';x:number;initialIndex:number;initial:RecordDateDraft;captured:HTMLElement}
let gesture:Gesture|undefined
const dragging=ref(false)
function indexAt(x:number){const rect=lane.value!.getBoundingClientRect();return Math.max(0,Math.min(dayCount-1,Math.floor((x-rect.left)/rect.width*dayCount)))}
function begin(event:PointerEvent,mode:Gesture['mode']){
  if(props.busy||event.button!==0||!lane.value)return
  event.preventDefault();event.stopPropagation()
  const captured=event.currentTarget as HTMLElement
  captured.setPointerCapture(event.pointerId)
  gesture={pointer:event.pointerId,mode,x:event.clientX,initialIndex:indexAt(event.clientX),initial:{...draft.value},captured};dragging.value=true
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',cancelDrag);window.addEventListener('keydown',escapeDrag,true);captured.addEventListener('lostpointercapture',cancelDrag)
}
function move(event:PointerEvent){
  if(!gesture||event.pointerId!==gesture.pointer||!lane.value)return
  const delta=Math.round((event.clientX-gesture.x)/lane.value.getBoundingClientRect().width*dayCount)
  if(gesture.mode==='place')draft.value=selectRecordDateRange(props.record,gesture.initial,shiftCreationDay(anchor.value,gesture.initialIndex),shiftCreationDay(anchor.value,indexAt(event.clientX)))
  else draft.value=dragRecordDateDraft(props.record,gesture.initial,gesture.mode,delta)
}
function cleanup(){
  gesture?.captured.removeEventListener('lostpointercapture',cancelDrag)
  if(gesture?.captured.hasPointerCapture(gesture.pointer))gesture.captured.releasePointerCapture(gesture.pointer)
  gesture=undefined;dragging.value=false
  window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',cancelDrag);window.removeEventListener('keydown',escapeDrag,true)
}
function finish(event:PointerEvent){if(!gesture||event.pointerId!==gesture.pointer)return;move(event);cleanup()}
function cancelDrag(){if(gesture)draft.value={...gesture.initial};cleanup()}
function escapeDrag(event:KeyboardEvent){if(event.key==='Escape'&&gesture){event.preventDefault();event.stopPropagation();cancelDrag()}}
function keyDrag(event:KeyboardEvent,mode:'move'|'start'|'end'){
  if(props.busy||!['ArrowLeft','ArrowRight'].includes(event.key))return
  event.preventDefault();event.stopPropagation();draft.value=dragRecordDateDraft(props.record,draft.value,mode,(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?7:1))
}
function submit(){if(props.busy)return;try{emit('save',recordDatePayload(props.record,draft.value))}catch(error){validation.value=error instanceof Error?error.message:'Check the selected dates.'}}
onBeforeUnmount(cleanup)
</script>

<template>
  <form class="record-dates-editor" @submit.prevent="submit">
    <span class="eyebrow">{{work?'WORK DATES':'CALENDAR EVENT'}}</span>
    <h2>{{work?'Plan dates':'Edit event dates'}}</h2>
    <p class="dates-record-title">{{record.title}}</p>
    <p class="dates-intro">{{work?'Drag across your row to set dates. Move the bar or drag its ends to adjust.':'Drag the bar or its ends to change the event’s days.'}}</p>
    <div class="dates-toolbar"><strong>{{rangeLabel}}</strong><div><button type="button" class="icon-button" aria-label="Previous timeline week" :disabled="busy" @click="jump(-7)"><ChevronLeft :size="17"/></button><button type="button" class="text-button" :disabled="busy" @click="anchor=shiftCreationDay(dayKey(new Date()),-2)">Today</button><button type="button" class="icon-button" aria-label="Next timeline week" :disabled="busy" @click="jump(7)"><ChevronRight :size="17"/></button></div></div>
    <div class="dates-timeline-scroll">
      <div class="dates-timeline" :class="{dragging}" :style="{'--days':dayCount}">
        <div class="dates-grid-head"><span>Item</span><div class="dates-day-grid"><div v-for="day in days" :key="day.key" :data-date="day.key" :class="{weekend:day.weekend,today:day.today}"><small>{{day.date.toLocaleDateString(undefined,{weekday:'narrow'})}}</small><b>{{day.date.getDate()}}</b></div></div></div>
        <div class="dates-edit-row"><div class="dates-row-label"><span class="dates-selected-dot" :style="{background:sourceTint(record)}" :title="`${record.collectionTitle||sourceLabels[record.source]} · Source color`"></span><strong>This item</strong></div><div ref="lane" class="dates-edit-lane dates-grid-background" role="group" aria-label="Editable date timeline" @pointerdown="begin($event,'place')"><div class="dates-grid-lines"><span v-for="day in days" :key="day.key" :class="{weekend:day.weekend,today:day.today}"></span></div><span v-if="!geometry" class="dates-empty-lane">{{hasDates?'Dates are outside this view':'Click a day or drag to plan'}}</span><div v-else class="dates-edit-bar" :style="{...geometryStyle(geometry),'--item-color':rowColor(record),'--source-color':sourceTint(record)}" :class="{'deadline-only':!draft.start,'start-only':!draft.end}" role="button" tabindex="0" aria-label="Move date range. Use left and right arrow keys to move one day." @pointerdown="begin($event,'move')" @keydown="keyDrag($event,'move')"><button v-if="!geometry.clippedStart" type="button" class="dates-drag-handle start" aria-label="Drag start date" :disabled="busy" @pointerdown="begin($event,'start')" @keydown="keyDrag($event,'start')"><GripVertical :size="14"/></button><span>{{!draft.start?'Deadline':!draft.end?'Start':record.title}}</span><button v-if="!geometry.clippedEnd" type="button" class="dates-drag-handle end" :aria-label="work?'Drag deadline':'Drag end date'" :disabled="busy" @pointerdown="begin($event,'end')" @keydown="keyDrag($event,'end')"><GripVertical :size="14"/></button></div></div></div>
        <div v-if="context.length" class="dates-context-heading">Around this work <span>Calendars · linked items · same source</span></div>
        <div v-for="row in shownContext" :key="row.record.id" class="dates-context-row"><div class="dates-row-label" :title="`${row.record.title} · ${row.record.collectionTitle||sourceLabels[row.record.source]}${tagDescription(row.record)}`"><component :is="row.related?Link2:row.record.kind==='event'?CalendarDays:Flag" :size="13" :style="{color:sourceTint(row.record)}"/><span>{{row.record.title}}</span></div><div class="dates-context-lane dates-grid-background"><div class="dates-grid-lines"><span v-for="day in days" :key="day.key" :class="{weekend:day.weekend,today:day.today}"></span></div><div class="dates-context-bar" :class="{event:row.record.kind==='event',completed:row.record.completed}" :style="{...geometryStyle(row.geometry),'--item-color':rowColor(row.record),'--source-color':sourceTint(row.record)}" :title="`${row.record.title} · ${describe(row.record.start||row.record.due||'')}${row.record.end?' – '+describe(row.record.end):''}${tagDescription(row.record)}`"><span>{{row.record.title}}</span><RecordTagMarkers class="dates-tag-markers" :tags="itemTags(row.record)" :limit="2"/></div></div></div>
        <p v-if="!context.length" class="dates-context-empty">No calendar events or related work in these dates.</p>
      </div>
    </div>
    <div class="dates-below-chart"><span>14 days · drag snaps to days</span><button v-if="hasDates&&!geometry" type="button" class="text-button" @click="showSelection">Show selected dates</button><button v-if="context.length>8" type="button" class="text-button" @click="showAllContext=!showAllContext">{{showAllContext?'Show less':`Show all ${context.length} items`}}</button></div>
    <div class="dates-summary"><div><span>Start</span><strong>{{describe(draft.start)}}</strong><button v-if="work&&draft.start" type="button" class="icon-button" aria-label="Clear start date" :disabled="busy" @click="clear('start')"><X :size="14"/></button></div><div><span>{{endLabel}}</span><strong>{{describe(draft.end)}}</strong><button v-if="work&&draft.end" type="button" class="icon-button" aria-label="Clear deadline" :disabled="busy" @click="clear('end')"><X :size="14"/></button></div></div>
    <p v-if="work" class="field-hint">These dates track the work. Use Schedule in calendar to reserve time.</p>
    <p v-if="record.kind==='task'&&draft.allDay&&!draft.start&&draft.end" class="field-hint">A one-day task uses its deadline. Drag the left handle earlier to add a start.</p>
    <details class="dates-precise"><summary>Exact dates &amp; times</summary><fieldset :disabled="busy"><label class="check-label"><input type="checkbox" :checked="draft.allDay" @change="toggleDateOnly"/>{{work?'Date only':'All day'}}</label><div class="form-two"><label>Start<input :key="'start-'+draft.allDay" :value="dateInput(draft.start)" :type="draft.allDay?'date':'datetime-local'" aria-label="Start date" @input="setInput('start',$event)"/></label><label>{{endLabel}}<input :key="'end-'+draft.allDay" :value="dateInput(draft.end)" :type="draft.allDay?'date':'datetime-local'" :aria-label="work?'Deadline date':'End date'" @input="setInput('end',$event)"/></label></div><p v-if="!work&&draft.allDay" class="field-hint">End is the first day after the event.</p><button v-if="work&&hasDates" type="button" class="text-button" @click="clear()">Remove all dates</button></fieldset></details>
    <p class="dates-coverage">Context shows loaded calendar events and work dates; it is not a full availability check.</p>
    <p v-if="validation||error" class="inline-error" role="alert">{{validation||error}}</p>
    <div class="form-actions"><button type="button" class="button quiet" :disabled="busy" @click="emit('cancel')">Cancel</button><button class="button primary" :disabled="busy||signature()===baseline">{{busy?'Saving…':'Save dates'}}</button></div>
  </form>
</template>

<style scoped>
.record-dates-editor{min-width:0}.record-dates-editor h2{font-size:24px;margin:7px 0 8px;line-height:1.3}.dates-record-title{font-weight:600;font-size:15px;overflow-wrap:anywhere;margin:0 0 6px}.dates-intro{color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 20px}.dates-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px}.dates-toolbar strong{font-size:14px}.dates-toolbar>div{display:flex;align-items:center;gap:6px}.dates-timeline-scroll{overflow:auto;border:1px solid var(--border);border-radius:10px;max-height:410px}.dates-timeline{min-width:600px;--label-width:156px}.dates-grid-head,.dates-edit-row,.dates-context-row{display:grid;grid-template-columns:var(--label-width) minmax(0,1fr)}.dates-grid-head{height:48px;background:var(--surface);position:sticky;top:0;z-index:3;border-bottom:1px solid var(--border)}.dates-grid-head>span{padding:15px 12px;font-size:12px;color:var(--muted);border-right:1px solid var(--border)}.dates-day-grid{display:grid;grid-template-columns:repeat(var(--days),minmax(0,1fr))}.dates-day-grid>div{display:flex;flex-direction:column;align-items:center;justify-content:center;border-right:1px solid var(--border);font-size:12px;gap:1px}.dates-day-grid small{font-size:10px;color:var(--muted)}.dates-day-grid b{font-weight:600}.dates-day-grid .today b{background:var(--primary);color:var(--on-primary,#fff);border-radius:50%;min-width:22px;text-align:center;line-height:22px}.dates-row-label{display:flex;align-items:center;gap:7px;min-width:0;padding:0 11px;border-right:1px solid var(--border);font-size:11px}.dates-row-label svg{flex:none}.dates-row-label span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dates-row-label strong{font-size:12px}.dates-selected-dot{width:8px;height:8px;background:var(--primary);border-radius:50%;flex:none}.dates-edit-row{min-height:66px;background:var(--primary-soft);border-bottom:1px solid var(--border)}.dates-edit-lane{cursor:default;touch-action:none;position:relative;min-width:0}.dates-grid-background{position:relative}.dates-grid-lines{display:grid;grid-template-columns:repeat(var(--days),minmax(0,1fr));position:absolute;inset:0;pointer-events:none}.dates-grid-lines>span{border-right:1px solid var(--border)}.weekend{background:color-mix(in srgb,var(--muted) 5%,transparent)}.dates-grid-lines .today{background:color-mix(in srgb,var(--primary) 7%,transparent);box-shadow:inset 1px 0 color-mix(in srgb,var(--primary) 40%,transparent)}.dates-empty-lane{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted);pointer-events:none}.dates-edit-bar{position:absolute;top:18px;height:30px;display:flex;align-items:center;background:var(--primary);color:var(--on-primary,#fff);border-radius:6px;min-width:12px;cursor:grab;box-shadow:0 1px 4px #0002;touch-action:none;z-index:1}.dates-edit-bar:focus-visible,.dates-drag-handle:focus-visible{outline:2px solid var(--text);outline-offset:2px}.dates-edit-bar>span{padding:0 20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:11px;pointer-events:none}.dates-drag-handle{position:absolute;top:0;height:30px;width:17px;display:flex;align-items:center;justify-content:center;padding:0;cursor:ew-resize;border:0;background:transparent;color:inherit;touch-action:none}.dates-drag-handle.start{left:0}.dates-drag-handle.end{right:0}.dragging,.dragging *{user-select:none}.dragging .dates-edit-bar{cursor:grabbing}.dates-context-heading{font-size:11px;color:var(--muted);padding:10px 11px;display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid var(--border)}.dates-context-heading>span{font-size:10px}.dates-context-row{height:34px;border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent)}.dates-context-lane{min-width:0}.dates-context-bar{position:absolute;top:7px;height:19px;background:color-mix(in srgb,var(--item-color) 16%,var(--surface));border:1px solid color-mix(in srgb,var(--item-color) 55%,var(--border));border-radius:4px;padding:1px 6px;box-sizing:border-box;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--text);font-size:10px}.dates-context-bar.event{border-left:3px solid var(--item-color)}.dates-context-bar.completed{opacity:.55}.dates-context-empty{padding:14px;font-size:12px;color:var(--muted);margin:0}.dates-below-chart{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:8px 0 18px;font-size:11px;color:var(--muted)}.dates-below-chart .text-button{font-size:11px}.dates-summary{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dates-summary>div{display:grid;grid-template-columns:1fr auto;gap:5px;align-items:center;padding:12px 14px;background:var(--hover);border:1px solid var(--border);border-radius:9px;min-width:0}.dates-summary>div>span{font-size:11px;color:var(--muted);grid-column:1}.dates-summary strong{font-size:13px;font-weight:600;grid-column:1;overflow-wrap:anywhere}.dates-summary .icon-button{grid-column:2;grid-row:1/3;width:25px;height:25px}.dates-precise{margin-top:15px;border-top:1px solid var(--border);padding-top:12px}.dates-precise summary{cursor:pointer;font-size:13px;color:var(--primary);font-weight:600}.dates-precise fieldset{margin:12px 0 0;padding:0;border:0;min-width:0}.dates-precise .check-label{margin-bottom:12px}.dates-precise .text-button{margin-top:10px}.dates-coverage{font-size:11px;color:var(--muted);line-height:1.5;margin-top:14px}.record-dates-editor .form-actions{margin-top:20px}.record-dates-editor .field-hint{margin-top:10px}@media(max-width:620px){.dates-summary{grid-template-columns:1fr}.dates-toolbar{flex-wrap:wrap}.dates-timeline{--label-width:120px}}

.dates-context-bar,.dates-context-bar.event{border-left:3px solid var(--source-color,var(--item-color));display:flex;align-items:center;gap:5px}.dates-context-bar>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.dates-context-bar .dates-tag-markers{flex-shrink:0;margin-left:auto}

.dates-edit-bar{background:color-mix(in srgb,var(--item-color) 25%,var(--surface));color:var(--text);border:2px solid var(--primary);border-left:4px solid var(--source-color)}
</style>
