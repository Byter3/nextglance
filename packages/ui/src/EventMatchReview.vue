<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {ArrowRight, CalendarDays, CheckCheck, FolderKanban, Link2, Search, Sparkles} from 'lucide-vue-next'
import type {Collection, Relation, WorkspaceRecord} from '@nextspace/contracts'
import {suggestEventMatches} from '@nextspace/core/event-matches.mjs'
import type {EventMatchSelection} from '@nextspace/core/event-matches.mjs'
import {sourceColor} from '@nextspace/core/record-presentation.mjs'
import {clockTime, dateValue, dayKey, sourceLabels} from './planner-ui'

const props=defineProps<{records:WorkspaceRecord[];relations:Relation[];collections?:Collection[];scopeLabel?:string;busy?:boolean;error?:string}>()
const emit=defineEmits<{confirm:[selection:EventMatchSelection[]];cancel:[];dirty:[value:boolean]}>()
const query=ref(''),limit=ref(80)
const suggestions=computed(()=>suggestEventMatches(props.records,props.relations))
const initialSelected=suggestions.value.filter(item=>item.recommended).map(item=>item.id).sort()
const selected=ref([...initialSelected])
const recommendedCount=computed(()=>suggestions.value.filter(item=>item.recommended).length)
const activeSelection=computed(()=>suggestions.value.filter(item=>selected.value.includes(item.id)))
const results=computed(()=>{
  const words=query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return suggestions.value.filter(item=>words.every(word=>`${item.work.title} ${item.work.collectionTitle||''} ${item.event.title} ${item.event.collectionTitle||''}`.toLocaleLowerCase().includes(word)))
})
const workCount=computed(()=>props.records.filter(record=>['task','card'].includes(record.kind)).length)
const eventCount=computed(()=>props.records.filter(record=>record.kind==='event').length)
const dirty=computed(()=>JSON.stringify([...selected.value].sort())!==JSON.stringify(initialSelected))
watch(dirty,value=>emit('dirty',value),{immediate:true})
watch(query,()=>limit.value=80)
function color(record:WorkspaceRecord){return sourceColor(record,props.collections||[])}
function toggle(id:string,checked:boolean){if(props.busy)return;selected.value=checked?[...new Set([...selected.value,id])]:selected.value.filter(value=>value!==id)}
function chooseRecommended(){if(!props.busy)selected.value=suggestions.value.filter(item=>item.recommended).map(item=>item.id)}
function submit(){if(!props.busy&&activeSelection.value.length)emit('confirm',activeSelection.value.map(item=>({fromId:item.fromId,toId:item.toId})))}
function matchDate(value?:string){const date=dateValue(value);return Number.isFinite(+date)?date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'No date'}
function workDates(record:WorkspaceRecord){
  if(record.start&&record.due)return `${matchDate(record.start)} – ${matchDate(record.due)}`
  return record.due?`Due ${matchDate(record.due)}`:record.start?`Starts ${matchDate(record.start)}`:'No dates set'
}
function eventDates(record:WorkspaceRecord){
  const last=record.end?new Date(+dateValue(record.end)-1):dateValue(record.start)
  const multiple=dayKey(record.start||'')!==dayKey(last)
  const days=`${matchDate(record.start)}${multiple?` – ${matchDate(dayKey(last))}`:''}`
  return `${days}${record.allDay||!record.start?.includes('T')?' · All day':` · ${clockTime(record.start)}${record.end?`–${clockTime(record.end)}`:''}`}`
}
</script>

<template>
  <div class="event-match-review">
    <span class="eyebrow">CONNECT EXISTING WORK</span>
    <h2><Sparkles :size="23"/>Find matching events</h2>
    <p class="match-intro">Review calendar events that may reserve time for your tasks or cards. Names and dates suggest a connection; you decide which links to keep.</p>
    <p class="match-scope">{{scopeLabel||'All loaded sources'}} · Checked {{workCount}} work items and {{eventCount}} events. Spaces, views, search and filters do not limit this scan. Refresh sources to include recent bookings; unloaded server data is not searched.</p>
    <template v-if="suggestions.length">
      <label class="match-search"><Search :size="16"/><input v-model="query" aria-label="Search suggested links" placeholder="Find an item, event or source…" :disabled="busy"/></label>
      <div class="match-toolbar"><span aria-live="polite"><strong>{{activeSelection.length}}</strong> selected of {{suggestions.length}} suggestions</span><button type="button" class="text-button" :disabled="busy||!recommendedCount" @click="chooseRecommended">Select recommended ({{recommendedCount}})</button><button type="button" class="text-button" :disabled="busy||!activeSelection.length" @click="selected=[]">Clear selection</button></div>
      <div class="match-results" role="group" aria-label="Suggested event links">
        <label v-for="match in results.slice(0,limit)" :key="match.id" class="match-row" :class="{chosen:selected.includes(match.id)}" :data-work-id="match.fromId" :data-event-id="match.toId">
          <input type="checkbox" :checked="selected.includes(match.id)" :disabled="busy" :aria-label="`Link ${match.work.kind==='card'?'card':'task'} ${match.work.title} from ${match.work.collectionTitle||sourceLabels[match.work.source]} to ${match.event.title}, ${eventDates(match.event)}`" @change="toggle(match.id,($event.target as HTMLInputElement).checked)"/>
          <span class="match-pair">
            <span class="match-item"><span class="match-kind"><component :is="match.work.kind==='card'?FolderKanban:CheckCheck" :size="14"/>{{match.work.kind==='card'?'Deck card':'Task'}}</span><strong>{{match.work.title}}</strong><span class="match-source"><i :style="{backgroundColor:color(match.work)}"/>{{match.work.collectionTitle||sourceLabels[match.work.source]}}</span><small>{{workDates(match.work)}}</small></span>
            <ArrowRight class="match-direction" :size="19"/>
            <span class="match-item"><span class="match-kind"><CalendarDays :size="14"/>Calendar event</span><strong>{{match.event.title}}</strong><span class="match-source"><i :style="{backgroundColor:color(match.event)}"/>{{match.event.collectionTitle||'Calendar'}}</span><small>{{eventDates(match.event)}}</small></span>
            <span class="match-explanation"><span class="match-confidence" :class="{recommended:match.recommended}">{{match.recommended?'Recommended':'Review this match'}}</span><span>{{match.reasons.join(' · ')}}</span><span v-if="match.warnings.length" class="match-warning">{{match.warnings.join(' · ')}}</span></span>
          </span>
        </label>
        <div v-if="!results.length" class="match-no-search">No suggestions match your search.</div>
        <button v-if="results.length>limit" class="match-show-more" type="button" :disabled="busy" @click="limit+=80">Show more · {{results.length-limit}} remaining</button>
      </div>
      <p class="match-footnote">Unchecked suggestions are left alone. Selected pairs become calendar links; item names, dates and source data stay unchanged. One work item can have several linked events.</p>
    </template>
    <div v-else class="match-empty"><Link2 :size="29"/><strong>No unlinked matches found</strong><span>Already linked items are excluded. All loaded sources were checked, regardless of your current view or filters. Refresh sources to load recent bookings, or use an item’s <b>Link existing event</b> action to choose a booking yourself.</span></div>
    <p v-if="error" class="inline-error" role="alert">{{error}}</p>
    <div class="form-actions"><button type="button" class="button quiet" :disabled="busy" @click="emit('cancel')">{{suggestions.length?'Cancel':'Close'}}</button><button v-if="suggestions.length" type="button" class="button primary" :disabled="busy||!activeSelection.length" @click="submit"><Link2 :size="16"/>{{busy?'Linking…':`Link selected (${activeSelection.length})`}}</button></div>
  </div>
</template>

<style scoped>
.event-match-review h2{display:flex;align-items:center;gap:10px;margin:8px 0 12px;font-size:24px}.event-match-review h2>svg{color:var(--primary);flex:none}.match-intro,.match-scope,.match-footnote{font-size:13px;color:var(--muted);line-height:1.6}.match-intro{margin:0 0 8px}.match-scope{font-size:11px;margin:0 0 18px}.match-search{display:flex!important;flex-direction:row!important;align-items:center;gap:8px;border:1px solid var(--border);border-radius:8px;padding:0 10px;background:var(--hover);margin:0!important}.match-search>svg{flex:none;color:var(--muted)}.match-search input{flex:1;min-width:0;border:0;background:transparent;box-shadow:none;padding:11px 0}.match-search:focus-within{outline:2px solid var(--primary);outline-offset:1px}.match-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 0 10px;font-size:12px;color:var(--muted)}.match-toolbar>span{margin-right:auto}.match-toolbar .text-button{font-size:12px}.match-results{max-height:min(48vh,560px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--border);border-radius:10px}.match-row{display:flex!important;flex-direction:row!important;align-items:flex-start;gap:14px;padding:16px;margin:0!important;border-bottom:1px solid var(--border);cursor:pointer;font-weight:400!important;background:var(--surface)}.match-row:last-of-type{border-bottom:0}.match-row:hover{background:var(--hover)}.match-row.chosen{background:color-mix(in srgb,var(--primary-soft) 45%,var(--surface))}.match-row:focus-within{outline:2px solid var(--primary);outline-offset:-2px}.match-row>input{width:17px;height:17px;flex:none;accent-color:var(--primary);margin-top:4px}.match-pair{display:grid;grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr);gap:10px 13px;min-width:0;flex:1}.match-item{min-width:0;display:flex;flex-direction:column;gap:5px}.match-kind{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted)}.match-item>strong{font-size:13px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}.match-item>small,.match-source{font-size:11px;color:var(--muted);line-height:1.5}.match-source{display:flex;align-items:center;gap:5px;overflow-wrap:anywhere}.match-source i{width:7px;height:7px;border-radius:50%;flex:none}.match-direction{align-self:center;color:var(--primary)}.match-explanation{grid-column:1/-1;display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:11px;color:var(--muted);line-height:1.5}.match-confidence{padding:2px 6px;border:1px solid var(--border);border-radius:5px;font-size:10px;color:var(--text)}.match-confidence.recommended{background:var(--primary-soft);color:var(--primary-soft-text);border-color:transparent}.match-warning{flex-basis:100%;color:var(--muted)}.match-show-more{display:block;width:100%;padding:13px;background:var(--hover);color:var(--primary);font-size:12px}.match-no-search{padding:30px;text-align:center;color:var(--muted);font-size:13px}.match-empty{display:flex;align-items:center;flex-direction:column;gap:12px;padding:36px 20px;text-align:center;border:1px solid var(--border);border-radius:10px;line-height:1.6;color:var(--muted)}.match-empty>strong{color:var(--text);font-size:15px}.match-empty>span{font-size:13px;max-width:480px}.match-footnote{font-size:11px;margin:12px 0 0}.event-match-review .form-actions{margin-top:20px}@media(max-width:620px){.match-pair{grid-template-columns:minmax(0,1fr);gap:8px}.match-direction{display:none}.match-item+.match-direction+.match-item{border-top:1px dashed var(--border);padding-top:9px}.match-row{padding:12px;gap:10px}.match-results{max-height:47vh}.match-toolbar{gap:10px}.match-toolbar>span{width:100%}}
</style>
