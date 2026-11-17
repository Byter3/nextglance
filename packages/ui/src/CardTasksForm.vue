<script setup lang="ts">
import {computed,onMounted,ref,toRaw,watch} from 'vue'
import type {Collection,Relation,Workspace,WorkspaceRecord} from '@nextspace/contracts'
import {checklistTaskCandidates,prepareCardTask} from '@nextspace/core/card-tasks.mjs'
import type {CardTaskEntry,ChecklistTaskCandidate} from '@nextspace/core/card-tasks.mjs'
import {creationDateInputs,creationDatePayload,creationRangeFromInputs} from '@nextspace/core/creation-dates.mjs'
import MarkdownEditor from './MarkdownEditor.vue'
import SchedulingWeek from './SchedulingWeek.vue'
const props=defineProps<{card:WorkspaceRecord;workspace:Workspace;records:WorkspaceRecord[];relations:Relation[];collections:Collection[];calendarCollections?:Collection[];destination:string;mode:'create'|'checklist';busy:boolean;error:string;progress?:string}>()
const emit=defineEmits<{submit:[entries:CardTaskEntry[]];cancel:[];dirty:[value:boolean];link:[url:string]}>()
const collectionId=ref(props.destination),title=ref(''),description=ref(''),dates=ref({...creationDateInputs(undefined,'task'),allDay:false})
const candidates=ref<ChecklistTaskCandidate[]>([]),chosen=ref<string[]>([]),loading=ref(props.mode==='checklist'),validation=ref(''),prepared=ref<CardTaskEntry[]>([])
const editing=ref(props.mode==='create'),titles=ref<Record<string,string>>({}),visualDates=ref(false)
const datePreview=computed(()=>creationRangeFromInputs('task',dates.value))
const locked=computed(()=>props.busy||prepared.value.length>0)
const validDestination=computed(()=>props.collections.some(c=>c.id===collectionId.value&&!c.readonly&&c.source==='tasks'))
const selected=computed(()=>candidates.value.filter(row=>chosen.value.includes(row.key)))
watch(()=>JSON.stringify([title.value,titles.value,description.value,dates.value,collectionId.value,chosen.value,prepared.value]),()=>emit('dirty',Boolean(title.value||description.value||dates.value.start||dates.value.end||chosen.value.length||prepared.value.length)))
onMounted(async()=>{if(props.mode!=='checklist')return;try{candidates.value=await checklistTaskCandidates({card:props.card,workspace:props.workspace,records:props.records,relations:props.relations})}catch(reason){validation.value=reason instanceof Error?reason.message:String(reason)}finally{loading.value=false}})
function editSelection(){if(!selected.value.length)return;for(const row of selected.value)titles.value[row.key]??=row.title;editing.value=true;validation.value=''}
function chooseSlot(slot:{start:string;end:string;allDay:boolean}){dates.value=creationDateInputs(slot,'task')}
async function submit(){
  if(props.busy)return
  if(!editing.value){editSelection();return}
  validation.value=''
  try{
    if(!prepared.value.length){
      if(!validDestination.value)throw new Error('Choose a writable task list in this Space.')
      const payload=creationDatePayload('task',dates.value)
      const base={card:props.card,workspace:toRaw(props.workspace),collectionId:collectionId.value,description:description.value,...payload}
      prepared.value=props.mode==='checklist'?await Promise.all(selected.value.map(candidate=>prepareCardTask({...base,candidate,...(titles.value[candidate.key]!==candidate.title?{title:titles.value[candidate.key]}:{})}))):[await prepareCardTask({...base,title:title.value})]
      if(!prepared.value.length)throw new Error('Select checklist rows to create or reuse.')
    }
    emit('dirty',true);emit('submit',prepared.value)
  }catch(reason){validation.value=reason instanceof Error?reason.message:String(reason)}
}
</script>
<template>
  <div class="card-tasks-form">
    <span class="eyebrow">TASKS FOR THIS CARD</span><h2>{{mode==='checklist'?'Tasks from checklist':'Create a linked task'}}</h2>
    <p class="task-context">{{card.title}}</p>
    <form @submit.prevent="submit">
      <fieldset :disabled="locked">
        <label v-if="mode==='create'">Title<input v-model="title" aria-label="Task title" maxlength="500" required/></label>
        <label v-if="editing">Task list<select v-model="collectionId" aria-label="Task list" required><option value="" disabled>Choose a task list</option><option v-for="list in collections" :key="list.id" :value="list.id">{{list.title}}</option></select></label>
        <p v-if="!collections.length" class="field-hint">No writable task lists in this Space. Add a task source to the Space or choose My overview.</p>
        <template v-if="mode==='checklist'&&!editing">
          <p class="field-hint">Choose checklist items. Checked items create completed tasks; existing tasks are reused.</p>
          <div class="checklist-selection-actions"><button type="button" class="text-button" @click="chosen=candidates.filter(row=>row.state==='new').map(row=>row.key)">Select new tasks</button><button type="button" class="text-button" @click="chosen=[]">Clear selection</button></div><p v-if="loading" role="status">Reading checklist…</p>
          <div v-else class="checklist-candidates">
            <label v-for="row in candidates" :key="row.key" class="checklist-candidate"><input v-model="chosen" type="checkbox" :value="row.key" :disabled="!['new','existing'].includes(row.state)" :aria-label="'Use '+row.title"/><span><strong :class="{completed:row.completed}">{{row.title}}</strong><small>{{row.completed?'Completed · ':''}}{{row.message||'New task'}}</small></span></label>
            <p v-if="!candidates.length" class="field-hint">This card has no Markdown checklist items.</p>
          </div>
        </template>
        <template v-if="editing">
          <div v-if="mode==='checklist'" class="selected-task-titles"><div class="task-selection-summary"><strong>{{selected.length}} selected</strong><button type="button" class="text-button" @click="editing=false">Change selection</button></div><label v-for="(row,index) in selected" :key="row.key">Task {{index+1}}<input v-model="titles[row.key]" :aria-label="'Task title '+(index+1)" :readonly="row.state==='existing'" maxlength="500" required/><small v-if="row.completed">Will be completed</small><small v-if="row.state==='existing'">Existing task · kept unchanged</small></label></div>
          <div class="form-two"><label>Start <small>optional</small><input v-model="dates.start" aria-label="Task start" :type="dates.allDay?'date':'datetime-local'"/></label><label>Due <small>optional</small><input v-model="dates.end" aria-label="Task due" :type="dates.allDay?'date':'datetime-local'"/></label></div>
          <div class="task-date-actions"><button type="button" class="text-button" :aria-expanded="visualDates" @click="visualDates=!visualDates">{{visualDates?'Hide date planner':'Choose dates visually'}}</button><button v-if="dates.start||dates.end" type="button" class="text-button" @click="dates={start:'',end:'',allDay:false}">Clear dates</button></div>
          <SchedulingWeek v-if="visualDates" draft-label="Task dates" :context-key="card.id+':tasks'" :records="records" :collections="calendarCollections||[]" :plans="workspace.plans" :calendar-colors="workspace.appearance.calendarColors" :start="datePreview?.start||''" :end="datePreview?.end||''" :all-day="datePreview?.allDay||false" :disabled="locked" @change="chooseSlot"/>
          <p v-if="visualDates" class="field-hint">These are task dates. No calendar event is created.</p>
          <MarkdownEditor v-model="description" label="Description" :disabled="locked" :rows="4" @link="emit('link',$event)"/>
        </template>
      </fieldset>
      <p v-if="editing" class="field-hint">The card waits for these tasks. Completing a task does not complete the card.</p>
      <p v-if="prepared.length&&!busy" class="field-hint">This creation request is saved for retry with the same destination and dates, preventing duplicates.</p>
      <p v-if="progress&&busy" role="status">{{progress}}</p><p v-if="validation||error" role="alert" class="inline-error">{{validation||error}}</p>
      <div class="form-actions"><button type="button" class="button quiet" :disabled="busy" @click="emit('cancel')">Cancel</button><button class="button primary" :disabled="busy||loading||!prepared.length&&(editing&&!validDestination||mode==='create'&&!title.trim()||mode==='checklist'&&!selected.length)">{{busy?'Saving…':prepared.length?'Retry saved request':!editing?'Continue':mode==='checklist'?'Create / link selected tasks':'Create task'}}</button></div>
    </form>
  </div>
</template>
<style scoped>
.checklist-selection-actions{display:flex;gap:14px;margin:8px 0}h2{margin:8px 0 12px}.task-context{padding:10px;background:var(--primary-soft);border-radius:8px;font-size:14px}fieldset{border:0;padding:0;min-width:0}fieldset>label,.form-two{margin-bottom:12px}.checklist-candidates{max-height:32vh;overflow:auto;border:1px solid var(--border);border-radius:8px;margin:12px 0}.checklist-candidate{display:flex;flex-direction:row;align-items:center;gap:10px;padding:10px;border-bottom:1px solid var(--border);font-weight:400}.checklist-candidate input{width:17px;height:17px;flex:none}.checklist-candidate span{min-width:0}.checklist-candidate strong{display:block;font-size:14px;overflow-wrap:anywhere}.checklist-candidate small{display:block;color:var(--muted);font-size:12px;margin-top:4px}.completed{text-decoration:line-through}.form-actions{margin-top:16px}
</style>
<style scoped>
.selected-task-titles{max-height:24vh;overflow:auto;margin:10px 0}.selected-task-titles>label{margin-bottom:8px}.selected-task-titles small{font-size:11px;font-weight:400;color:var(--muted)}.task-selection-summary,.task-date-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:8px}.task-date-actions{justify-content:flex-start}.task-selection-summary strong{font-size:12px}.card-tasks-form :deep(.md-editor-body){min-height:100px}
</style>
