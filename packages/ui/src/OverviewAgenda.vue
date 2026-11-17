<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowUpRight, CalendarDays } from 'lucide-vue-next'
import type { PlanSession, Relation, WorkspaceRecord } from '@nextspace/contracts'
import { clockTime, dateValue, dayKey, shortDate } from './planner-ui'
import { isClosed } from '@nextspace/core/planner.mjs'

const props=withDefaults(defineProps<{
  records:WorkspaceRecord[]; plans:PlanSession[]; relations?:Relation[]; days:Date[]; now:Date
  selectedId?:string|null; hoveredId?:string|null; compact?:boolean
  colorFor:(record:WorkspaceRecord)=>string
}>(),{relations:()=>[],compact:false})
const emit=defineEmits<{open:[record:WorkspaceRecord]}>()
const viewport=ref<HTMLElement>()
const recordsById=computed(()=>new Map(props.records.map(record=>[record.id,record])))
const activeId=computed(()=>props.hoveredId||props.selectedId)
const context=computed(()=>activeId.value?recordsById.value.get(activeId.value):undefined)
const period=computed(()=>{
  const start=props.days[0],last=props.days.at(-1)
  if(!start||!last)return undefined
  const end=new Date(last);end.setDate(end.getDate()+1)
  return {start:+start,end:+end}
})
function work(record:WorkspaceRecord){return record.kind==='task'||record.kind==='card'}
function validPlan(plan:PlanSession){return Number.isFinite(+dateValue(plan.start))&&Number.isFinite(+dateValue(plan.end))&&dateValue(plan.end)>=dateValue(plan.start)}
function moment(value?:string){const time=+dateValue(value);return Number.isFinite(time)?time:Infinity}
function when(record:WorkspaceRecord){
  if(record.kind!=='event')return record.due?`Due ${shortDate(record.due)}`:'No deadline'
  if(!Number.isFinite(+dateValue(record.start)))return 'Date unavailable'
  const date=shortDate(record.start)
  if(record.allDay||!record.start?.includes('T'))return `${date} · All day`
  const end=record.end&&Number.isFinite(+dateValue(record.end))?`${dayKey(record.end)===dayKey(record.start)?'':`${shortDate(record.end)} `}${clockTime(record.end)}`:''
  return `${date} · ${clockTime(record.start)}${end?`–${end}`:''}`
}
const bookings=computed(()=>{
  const range=period.value
  if(!range)return []
  return props.records.filter(record=>{
    if(record.kind!=='event'||isClosed(record))return false
    const start=moment(record.start),suppliedEnd=moment(record.end),end=Number.isFinite(suppliedEnd)?suppliedEnd:start
    if(!Number.isFinite(start)||start>=range.end||end<range.start||end===range.start&&start<end)return false
    if(range.end<=+props.now)return true
    if(record.allDay||!record.start?.includes('T'))return Number.isFinite(suppliedEnd)?suppliedEnd>+props.now:dayKey(record.start||'')>=dayKey(props.now)
    return end>=+props.now
  }).sort((a,b)=>moment(a.start)-moment(b.start))
})
const bookedWorkIds=computed(()=>{
  const ids=new Set(props.plans.filter(validPlan).map(plan=>plan.recordId))
  for(const link of props.relations){
    if(link.type!=='scheduled_during')continue
    const from=recordsById.value.get(link.fromId),to=recordsById.value.get(link.toId)
    // An unavailable linked booking is still a known booking; do not call its work unscheduled.
    if(from&&work(from)&&(!to||to.kind==='event'&&!isClosed(to)))ids.add(from.id)
    if(to&&work(to)&&(!from||from.kind==='event'&&!isClosed(from)))ids.add(to.id)
  }
  return ids
})
const needsTime=computed(()=>props.records.filter(record=>work(record)&&!isClosed(record)&&!bookedWorkIds.value.has(record.id)).sort((a,b)=>moment(a.due)-moment(b.due)||a.title.localeCompare(b.title)))
const links=computed(()=>{
  const linked=new Map<string,{record:WorkspaceRecord;type:Relation['type']}>()
  for(const link of props.relations){
    const id=link.fromId===activeId.value?link.toId:link.toId===activeId.value?link.fromId:undefined
    const record=id?recordsById.value.get(id):undefined
    if(record&&(record.kind==='event'||work(record))&&(!linked.has(record.id)||link.type==='scheduled_during'))linked.set(record.id,{record,type:link.type})
  }
  return [...linked.values()].sort((a,b)=>moment(a.record.start||a.record.due)-moment(b.record.start||b.record.due)||a.record.title.localeCompare(b.record.title))
})
type Entry={key:string;record:WorkspaceRecord;detail:string;kind:'booking'|'needs-time'|'linked-work'|'session'}
type AgendaSection={title:string;empty:string;entries:Entry[];count:number}
const sections=computed<AgendaSection[]>(()=>{
  const limit=props.compact?3:4
  if(!context.value)return [
    {title:period.value&&period.value.end<=+props.now?'Bookings in this period':'Next bookings',empty:period.value&&period.value.end<=+props.now?'No bookings in this period.':'No upcoming bookings in this period.',entries:bookings.value.slice(0,3).map(record=>({key:record.id,record,detail:when(record),kind:'booking'})),count:bookings.value.length},
    {title:'Needs time',empty:'No open work needs time booked.',entries:needsTime.value.slice(0,3).map(record=>({key:record.id,record,detail:when(record),kind:'needs-time'})),count:needsTime.value.length},
  ]
  const result:AgendaSection[]=[],events=links.value.filter(link=>link.record.kind==='event'),tasks=links.value.filter(link=>work(link.record))
  const knownEventLink=props.relations.some(link=>link.type==='scheduled_during'&&(link.fromId===activeId.value||link.toId===activeId.value))
  if(work(context.value)||events.length)result.push({title:'Linked events',empty:knownEventLink?'Linked booking unavailable in this view.':'No linked calendar event.',entries:events.slice(0,limit).map(({record,type})=>({key:record.id,record,detail:`${type==='scheduled_during'?'Reserved · ':''}${when(record)}`,kind:'booking'})),count:events.length})
  if(context.value.kind==='event'||tasks.length)result.push({title:'Linked work',empty:'No tasks or Deck cards linked.',entries:tasks.slice(0,3).map(({record})=>({key:record.id,record,detail:when(record),kind:'linked-work'})),count:tasks.length})
  const sessions=props.plans.filter(plan=>plan.recordId===activeId.value&&validPlan(plan)).sort((a,b)=>moment(a.start)-moment(b.start))
  if(sessions.length)result.push({title:'Work sessions',empty:'',entries:sessions.slice(0,3).map(plan=>({key:plan.id,record:context.value!,detail:`${shortDate(plan.start)} · ${clockTime(plan.start)}–${dayKey(plan.end)===dayKey(plan.start)?'':`${shortDate(plan.end)} `}${clockTime(plan.end)}`,kind:'session'})),count:sessions.length})
  return result
})
function scrollAgenda(event:WheelEvent){
  if(event.ctrlKey||event.shiftKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return
  event.preventDefault()
  if(viewport.value)viewport.value.scrollTop+=event.deltaY*(event.deltaMode===1?18:event.deltaMode===2?viewport.value.clientHeight:1)
}
</script>

<template>
  <aside ref="viewport" class="overview-agenda" :class="{compact}" aria-label="Calendar agenda" tabindex="0" @wheel="scrollAgenda">
    <header class="agenda-heading"><CalendarDays :size="14"/><h2>Calendar</h2><small v-if="context">{{hoveredId?'Preview':'Selected'}}</small></header>
    <button v-if="context" class="agenda-context" :data-record-id="context.id" :style="{'--agenda-color':colorFor(context)}" :title="context.title" @click="emit('open',context)"><strong>{{context.title}}</strong><small>{{when(context)}}</small></button>
    <p v-else-if="activeId" class="agenda-empty">This item is unavailable in the current view.</p>
    <section v-for="section in sections" :key="section.title" class="agenda-section">
      <h3>{{section.title}}<small>{{section.count}}</small></h3>
      <button v-for="entry in section.entries" :key="entry.key" class="overview-agenda-item" :class="`agenda-${entry.kind}`" :data-record-id="entry.record.id" :title="`${entry.record.title} · ${entry.detail}`" @click="emit('open',entry.record)">
        <i class="agenda-dot" :style="{background:colorFor(entry.record)}" aria-hidden="true"></i>
        <div class="overview-agenda-item-content"><strong>{{entry.record.title}}</strong><small>{{entry.detail}}</small></div>
        <ArrowUpRight :size="12" aria-hidden="true"/>
      </button>
      <p v-if="!section.entries.length" class="agenda-empty">{{section.empty}}</p>
      <p v-else-if="section.count>section.entries.length" class="agenda-more">{{section.count-section.entries.length}} more {{section.title==='Needs time'?'without time booked':'in this view'}}</p>
    </section>
  </aside>
</template>

<style scoped>
.overview-agenda{height:100%;min-width:0;overflow:auto;overscroll-behavior:contain;padding:2px 7px 12px 1px;scrollbar-width:thin}
.overview-agenda:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.agenda-heading{display:flex;align-items:center;gap:7px;color:var(--muted);min-height:22px}
.agenda-heading h2{margin:0;font-size:12px;font-weight:600;color:var(--text)}
.agenda-heading>small{font-size:9px;margin-left:auto}
.agenda-context{display:block;width:100%;margin:10px 0 0;padding:0 0 0 8px;border-left:2px solid var(--agenda-color);text-align:left}
.agenda-context strong,.overview-agenda-item strong{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:11.5px;font-weight:500;line-height:1.4;overflow-wrap:anywhere}
.overview-agenda-item strong{-webkit-line-clamp:1}
.agenda-context small,.overview-agenda-item small{display:block;margin-top:3px;font-size:10px;font-weight:400;color:var(--muted);line-height:1.4;overflow-wrap:anywhere}
.agenda-section{margin-top:12px}
.agenda-section h3{display:flex;align-items:baseline;gap:5px;margin:0 0 5px;font-size:10px;font-weight:600;color:var(--muted)}
.agenda-section h3 small{margin-left:auto;font-size:9px;font-weight:400}
.overview-agenda-item{display:grid;grid-template-columns:5px minmax(0,1fr) 12px;align-items:start;gap:7px;width:100%;min-height:0;padding:6px 3px;border:0;border-radius:4px;text-align:left}
.overview-agenda-item:hover,.agenda-context:hover{background:var(--hover)}
.overview-agenda-item-content{min-width:0}
.overview-agenda-item>svg{margin-top:3px;color:var(--muted);opacity:.55}
.agenda-dot{display:block;width:5px;height:5px;border-radius:50%;margin-top:5px}
.agenda-empty,.agenda-more{margin:7px 0 0;color:var(--muted);font-size:10px;line-height:1.5;overflow-wrap:anywhere}
.agenda-more{font-size:9px;padding-left:15px}
.compact{padding-right:3px}
.compact .agenda-heading{gap:5px;flex-wrap:wrap}
.compact .agenda-heading>small{margin-left:0;width:100%;padding-left:19px}
.compact .overview-agenda-item{grid-template-columns:4px minmax(0,1fr);gap:5px;padding-inline:1px}
.compact .overview-agenda-item>svg{display:none}
.compact .overview-agenda-item strong,.compact .agenda-context strong{font-size:11px;-webkit-line-clamp:2}
.compact .agenda-section h3{font-size:10px}
</style>
