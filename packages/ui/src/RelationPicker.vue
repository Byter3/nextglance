<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, toRaw } from 'vue'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, CheckCircle2, FileText, FolderKanban, GitBranch, Link2, Search } from 'lucide-vue-next'
import type { Relation, WorkspaceRecord } from '@nextspace/contracts'
import { isClosed } from '@nextspace/core/planner.mjs'
import { createRelationPickerIndex, relationPickerIntent } from '@nextspace/core/relation-picker.mjs'
import type { DependencyDirection, RelationPickerIntent, RelationPickerMode } from '@nextspace/core/relation-picker.mjs'
import { excerpt, shortDate, sourceLabels } from './planner-ui'

const props = defineProps<{ record: WorkspaceRecord; records: WorkspaceRecord[]; candidateIds?:string[]; candidateScope?:string; relations: Relation[]; mode: RelationPickerMode; taskOnly?:boolean; busy?: boolean; error?: string; deckAvailable?: boolean }>()
const emit = defineEmits<{ add: [intent: RelationPickerIntent]; cancel: []; dirty: [value: boolean] }>()
const query = ref(''), selectedId = ref(''), direction = ref<DependencyDirection>('incoming')
const relatedType = ref<'related'|'event-work'>('related'), role = ref<'preparation'|'during'|'follow_up'>('preparation')
const effectiveMode = computed(() => props.mode === 'related' ? relatedType.value : props.mode)
const searchInput = ref<HTMLInputElement>()
const icons = { task: CheckCircle2, card: FolderKanban, event: CalendarDays, note: FileText, page: BookOpen }
const title = computed(() => props.taskOnly ? 'Link existing task' : props.mode === 'dependency' ? 'Add dependency' : props.mode === 'note' ? 'Link a note' : 'Link related item')
const actionLabel = computed(() => props.taskOnly ? 'Link task' : props.mode === 'dependency' ? 'Add dependency' : props.mode === 'note' ? 'Link note' : 'Link item')
const allowedIds=computed(()=>props.candidateIds?new Set(props.candidateIds):null)
const relationIndex=computed(()=>createRelationPickerIndex(props.records.map(item=>{void item.id;void item.kind;void item.source;return toRaw(item)}),props.relations.map(edge=>({...edge}))))
const resultList=ref<HTMLElement>(),scrollTop=ref(0),rowHeight=88,windowCount=18
const windowStart=computed(()=>Math.max(0,Math.floor(scrollTop.value/rowHeight)-3))
const visibleResults=computed(()=>results.value.slice(windowStart.value,windowStart.value+windowCount))
const candidates = computed(() => props.records.filter(item => item.id !== props.record.id && (!props.taskOnly||item.kind==='task') && (!allowedIds.value||allowedIds.value.has(item.id)) && (props.mode === 'dependency' ? ['task', 'card'].includes(item.kind) : props.mode === 'note' ? ['note', 'page'].includes(item.kind) : effectiveMode.value === 'event-work' ? item.kind === 'event' : true)))
const results = computed(() => {
  const words = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return candidates.value.filter(item => {
    const text = `${item.title} ${item.collectionTitle || ''} ${sourceLabels[item.source]} ${props.mode === 'note' ? item.body || '' : ''}`.toLocaleLowerCase()
    return words.every(word => text.includes(word))
  }).map(item => ({ item, eligibility: eligibility(item) }))
    .sort((a, b) => Number(b.eligibility.ok) - Number(a.eligibility.ok) || Number(isClosed(a.item)) - Number(isClosed(b.item)) || a.item.title.localeCompare(b.item.title))
})
const chosen = computed(() => relationIndex.value.byId.get(selectedId.value))
const chosenEligibility = computed(() => chosen.value ? eligibility(chosen.value) : undefined)
const nativeChoice = computed(() => chosen.value && props.mode === 'dependency' && props.record.source === 'deck' && chosen.value.source === 'deck')
function eligibility(item: WorkspaceRecord) {
  if(allowedIds.value&&!allowedIds.value.has(item.id))return {ok:false,message:'This item is outside the current Space’s sources.'}
  return relationIndex.value.eligibility(props.record,item,effectiveMode.value,direction.value,{deckAvailable:props.deckAvailable})
}
watch(results,()=>{scrollTop.value=0;if(resultList.value)resultList.value.scrollTop=0})
async function moveSelection(event:KeyboardEvent){
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||props.busy)return
  event.preventDefault()
  const rows=results.value.filter(row=>row.eligibility.ok);if(!rows.length)return
  const current=rows.findIndex(row=>row.item.id===selectedId.value),delta=event.key==='ArrowUp'?-1:1
  const at=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,current+delta))
  selectedId.value=rows[at].item.id
  const index=results.value.findIndex(row=>row.item.id===selectedId.value)
  if(resultList.value){resultList.value.scrollTop=Math.max(0,index*rowHeight-rowHeight);scrollTop.value=resultList.value.scrollTop}
  await nextTick();resultList.value?.querySelector<HTMLInputElement>('input:checked')?.focus({preventScroll:true})
}
const predecessor = computed(() => direction.value === 'incoming' ? chosen.value?.title || 'Selected work' : props.record.title)
const successor = computed(() => direction.value === 'incoming' ? props.record.title : chosen.value?.title || 'Selected work')
watch(selectedId, value => emit('dirty', Boolean(value)), { immediate: true })
watch(direction, () => { selectedId.value = '' })
watch(relatedType, () => { selectedId.value = '' })
watch(() => [props.record.id, props.mode], () => { selectedId.value = ''; query.value = ''; direction.value = 'incoming' })
onMounted(async () => { await nextTick(); searchInput.value?.focus() })
function submit() {
  if (props.busy || !chosen.value || !chosenEligibility.value?.ok) return
  // Revalidate the current graph, including changes made while this picker was open.
  const latest=createRelationPickerIndex(toRaw(props.records),toRaw(props.relations))
  if(!latest.eligibility(props.record,chosen.value,effectiveMode.value,direction.value,{deckAvailable:props.deckAvailable}).ok)return
  emit('add', relationPickerIntent(props.record.id, chosen.value.id, effectiveMode.value, direction.value, role.value))
}
function itemStatus(item: WorkspaceRecord) {
  if (isClosed(item)) return item.status?.toUpperCase() === 'CANCELLED' ? 'Cancelled' : 'Done'
  return item.status?.replace(/[-_]/g, ' ') || ''
}
</script>

<template>
  <div class="relation-picker">
    <span class="eyebrow">{{ mode === 'dependency' ? 'CONNECTED WORK' : mode === 'note' ? 'REFERENCE' : 'CONNECTION' }}</span>
    <h2>{{ title }}</h2>
    <p class="relation-current"><component :is="icons[record.kind]" :size="18"/><span>{{ record.title }}</span></p>
    <form @submit.prevent="submit">
      <fieldset v-if="mode === 'dependency'" class="direction-picker" :disabled="busy">
        <legend>Which way does the work flow?</legend>
        <label :class="{active:direction==='incoming'}"><input v-model="direction" type="radio" name="dependency-direction" value="incoming"/><ArrowDownLeft :size="19"/><span><strong>Waits for (incoming)</strong><small>This item needs the selected work first.</small></span></label>
        <label :class="{active:direction==='outgoing'}"><input v-model="direction" type="radio" name="dependency-direction" value="outgoing"/><ArrowUpRight :size="19"/><span><strong>Needed by (outgoing)</strong><small>The selected work needs this item first.</small></span></label>
      </fieldset>
      <p v-else class="relation-intro">{{ mode === 'note' ? 'Find a note or Collective page to keep alongside this item.' : 'Choose an item to connect without making a scheduling dependency.' }}</p>
      <div v-if="mode==='related'" class="related-options"><label>Connection type<select v-model="relatedType" aria-label="Connection type" :disabled="busy"><option value="related">Related item</option><option value="event-work">Work for event</option></select></label><label v-if="relatedType==='event-work'">Role<select v-model="role" aria-label="Role" :disabled="busy"><option value="preparation">Preparation</option><option value="during">During the event</option><option value="follow_up">Follow-up</option></select></label></div>
      <label class="relation-search"><Search :size="17"/><input ref="searchInput" v-model="query" :disabled="busy" :placeholder="mode==='note'?'Search notes and pages…':mode==='dependency'?'Search tasks and cards…':effectiveMode==='event-work'?'Search calendar events…':'Search all items…'" :aria-label="mode==='note'?'Find a note or page':'Find related work'"/><button v-if="query" type="button" class="text-button" :disabled="busy" @click="query=''">Clear</button></label>
      <p class="relation-result-count" aria-live="polite">{{ results.length }} {{ results.length === 1 ? 'item' : mode === 'note' ? 'notes and pages' : 'items' }}{{ query ? results.length === 1 ? ' matches your search' : ' match your search' : ' across '+(candidateScope||'your loaded sources') }}</p>
      <div ref="resultList" class="relation-results" role="radiogroup" tabindex="0" :aria-label="mode==='note'?'Choose note':'Choose related item'" @scroll="scrollTop=($event.target as HTMLElement).scrollTop" @keydown="moveSelection">
        <div aria-hidden="true" :style="{height:windowStart*rowHeight+'px'}"/>
        <label v-for="{item,eligibility} in visibleResults" :key="item.id" class="relation-option" :style="{height:rowHeight+'px',boxSizing:'border-box'}" :class="{chosen:selectedId===item.id,unavailable:!eligibility.ok}" :title="[item.title,eligibility.message].filter(Boolean).join(' · ')">
          <input v-model="selectedId" type="radio" name="relation-target" :value="item.id" :disabled="busy||!eligibility.ok" :aria-label="item.title"/>
          <component :is="icons[item.kind]" :size="19" class="relation-kind"/>
          <span class="relation-option-body"><strong>{{ item.title }}</strong><span class="relation-option-meta">{{ sourceLabels[item.source] }}<template v-if="item.collectionTitle"> · {{ item.collectionTitle }}</template><template v-if="item.due"> · Due {{ shortDate(item.due) }}</template></span><span v-if="mode==='note'&&item.body" class="relation-excerpt">{{ excerpt(item.body) }}</span><span v-if="!eligibility.ok" class="relation-unavailable-reason">{{ eligibility.message }}</span></span>
          <span v-if="selectedId===item.id" class="relation-selected-mark"><Check :size="17"/></span><small v-else-if="itemStatus(item)" class="relation-state" :class="{closed:isClosed(item)}">{{ itemStatus(item) }}</small>
        </label>
        <div aria-hidden="true" :style="{height:Math.max(0,results.length-windowStart-visibleResults.length)*rowHeight+'px'}"/>
        <div v-if="!results.length" class="relation-empty"><component :is="mode==='note'?FileText:GitBranch" :size="24"/><strong>{{ query ? 'No matches' : mode==='note'?'No notes or pages loaded':'No other work available' }}</strong><span>{{ query ? 'Try another title or source name.' : mode==='note'?'Refresh your sources to load Notes and Collectives.':'Tasks and Deck cards appear here after your sources are refreshed.' }}</span></div>
      </div>
      <div v-if="chosen" class="relation-preview" aria-live="polite">
        <template v-if="mode==='dependency'"><span class="relation-preview-label">Work order</span><div><strong>{{ predecessor }}</strong><ArrowRight :size="20"/><strong>{{ successor }}</strong></div><p>{{ successor }} waits for {{ predecessor }}. Dates stay unchanged.</p><p>{{nativeChoice?'Saved in Nextcloud Deck. Changes here update the native dependency.':'This task dependency is saved with your NextGlance planner.'}}</p><p v-if="nativeChoice&&record.collectionId!==chosen.collectionId">Deck’s own picker is limited to one board. It may not display this cross-board dependency until both cards are loaded.</p></template>
        <template v-else-if="effectiveMode==='event-work'"><CalendarDays :size="17"/><span>This item is {{ role==='preparation'?'preparation for':role==='follow_up'?'follow-up for':'work during' }} <strong>{{ chosen.title }}</strong>. This does not reserve calendar time.</span></template>
        <template v-else><Link2 :size="17"/><span><strong>{{ chosen.title }}</strong> will be linked to this item.</span></template>
      </div>
      <p v-if="chosenEligibility&&!chosenEligibility.ok" class="inline-error" role="alert">{{ chosenEligibility.message }}</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <div class="form-actions"><button type="button" class="button quiet" :disabled="busy" @click="emit('cancel')">Cancel</button><button type="submit" class="button primary" :disabled="busy||!chosenEligibility?.ok"><Link2 :size="16"/>{{ busy ? 'Saving…' : actionLabel }}</button></div>
    </form>
  </div>
</template>

<style scoped>
.relation-option{overflow:hidden}.relation-option-body>strong,.relation-option-meta,.relation-unavailable-reason{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.related-options{display:flex;gap:14px;margin-bottom:16px}.related-options>label{flex:1;font-size:12px;min-width:0}.related-options select{margin-top:5px}
.relation-picker h2{font-size:24px;line-height:1.3;margin:8px 0 16px}.relation-current{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:8px;background:var(--primary-soft);color:var(--primary-soft-text);font-size:14px;margin:0 0 20px}.relation-current>svg{flex:none}.relation-current span{overflow-wrap:anywhere}.direction-picker{border:0;padding:0;margin:0 0 20px;display:grid;grid-template-columns:1fr 1fr;gap:10px;min-width:0}.direction-picker legend{font-size:13px;font-weight:600;margin-bottom:10px}.direction-picker label{display:flex;flex-direction:row;align-items:center;gap:9px;border:1px solid var(--border);border-radius:9px;padding:12px;cursor:pointer;min-width:0}.direction-picker label.active{border-color:var(--primary);background:var(--primary-soft)}.direction-picker input{width:16px;height:16px;flex:none;accent-color:var(--primary)}.direction-picker svg{flex:none;color:var(--primary)}.direction-picker strong{display:block;font-size:13px;line-height:1.4}.direction-picker small{display:block;color:var(--muted);font-size:12px;font-weight:400;line-height:1.5;margin-top:4px}.relation-intro{font-size:13px;color:var(--muted);line-height:1.5;margin:0 0 16px}.relation-search{display:flex;flex-direction:row;align-items:center;gap:9px;border:1px solid var(--border);border-radius:8px;padding:0 11px;background:var(--hover)}.relation-search input{flex:1;min-width:0;border:0;background:transparent;padding:11px 0;box-shadow:none}.relation-search:focus-within{outline:2px solid var(--primary);outline-offset:1px}.relation-search>svg{color:var(--muted);flex:none}.relation-search .text-button{font-size:12px}.relation-result-count{font-size:12px;color:var(--muted);margin:12px 0 8px}.relation-results{max-height:min(40vh,360px);min-height:120px;overflow:auto;border:1px solid var(--border);border-radius:9px;overscroll-behavior:contain}.relation-option{display:flex;flex-direction:row;align-items:center;gap:11px;padding:14px 12px;border-bottom:1px solid var(--border);cursor:pointer;margin:0;font-weight:400}.relation-option:last-child{border-bottom:0}.relation-option:hover{background:var(--hover)}.relation-option.chosen{background:var(--primary-soft)}.relation-option:focus-within{outline:2px solid var(--primary);outline-offset:-2px}.relation-option.unavailable{cursor:default;background:color-mix(in srgb,var(--hover) 40%,transparent)}.relation-option input{width:16px;height:16px;flex:none;accent-color:var(--primary)}.relation-kind{flex:none;color:var(--muted)}.relation-option-body{display:block;min-width:0;flex:1}.relation-option-body>strong{display:block;font-size:14px;font-weight:600;line-height:1.4;overflow-wrap:anywhere}.relation-option-meta,.relation-excerpt,.relation-unavailable-reason{display:block;font-size:12px;color:var(--muted);line-height:1.5;margin-top:3px}.relation-excerpt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.relation-unavailable-reason{font-style:italic}.relation-state{font-size:11px;max-width:95px;text-align:right;overflow-wrap:anywhere;color:var(--muted);flex:none}.relation-state.closed{color:var(--green)}.relation-selected-mark{color:var(--primary);flex:none}.relation-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:9px;padding:30px 20px;color:var(--muted);font-size:13px;line-height:1.5}.relation-empty strong{color:var(--text);font-size:14px}.relation-preview{padding:12px 14px;background:var(--hover);border-radius:9px;margin-top:15px;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.relation-preview:has(>svg){display:flex;align-items:center;gap:10px}.relation-preview>svg{color:var(--primary);flex:none}.relation-preview-label{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px}.relation-preview>div{display:flex;align-items:center;gap:14px}.relation-preview>div strong{flex:1;min-width:0;font-weight:600}.relation-preview>div svg{flex:none;color:var(--primary)}.relation-preview p{font-size:12px;color:var(--muted);margin:8px 0 0}.relation-picker .form-actions{margin-top:22px}.relation-picker input:disabled{cursor:not-allowed}@media(max-width:600px){.direction-picker{grid-template-columns:1fr}.relation-state{display:none}.relation-results{max-height:35vh}.relation-preview>div{gap:7px}}
</style>
