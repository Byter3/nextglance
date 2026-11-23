<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarDays } from 'lucide-vue-next'
import type { Collection,EventParticipantInput } from '@nextspace/contracts'
import type { CreateItemKind, CreateItemRange, CreateItemRequest } from './create-item'
import { creationDateInputs, creationDatePayload, creationRangeFromInputs, convertCreationDateMode } from '@nextspace/core/creation-dates.mjs'
import type { CreationDateDraft } from '@nextspace/core/creation-dates.mjs'
import {newEventDetails,normalizeEventDetails} from '@nextspace/core/event-details.mjs'
import EventReminders from './EventReminders.vue'
import EventAttendees from './EventAttendees.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import {validateEventInvitees} from '@nextspace/core/event-scheduling.mjs'

const props=withDefaults(defineProps<{
  collections:Collection[]
  initialType?:CreateItemKind
  initialRange?:CreateItemRange
  initialStackId?:string
  destinations?:Partial<Record<CreateItemKind,string>>
  availableTypes?:CreateItemKind[]
  contextLabel?:string
  busy?:boolean
  error?:string
}>(),{initialType:'task',availableTypes:()=>['task','card','event','note'],destinations:()=>({}),busy:false,error:''})
const emit=defineEmits<{submit:[input:CreateItemRequest];cancel:[];dirty:[value:boolean];link:[url:string]}>()
const sourceFor={task:'tasks',card:'deck',event:'calendar',note:'notes'} as const
const labels:Record<CreateItemKind,string>={task:'Task',card:'Deck card',event:'Calendar event',note:'Note'}
const destinationLabels:Record<CreateItemKind,string>={task:'Task list',card:'Deck board',event:'Calendar',note:'Folder'}
const type=ref<CreateItemKind>(props.availableTypes.includes(props.initialType)?props.initialType:props.availableTypes[0]||'task')
const title=ref(''),content=ref(''),validation=ref(''),assignToMe=ref(true)
const eventDetails=ref(newEventDetails()),attendees=ref<EventParticipantInput[]>([]),attendeePending=ref(false)
const eventCalendar=computed(()=>props.collections.find(c=>c.id===destinations.value.event&&c.source==='calendar'))
const destinationFor=(kind:CreateItemKind)=>props.destinations[kind]??''
const destinations=ref<Record<CreateItemKind,string>>({task:destinationFor('task'),card:destinationFor('card'),event:destinationFor('event'),note:destinationFor('note')})
const dateDrafts=ref<Record<CreateItemKind,CreationDateDraft>>({task:creationDateInputs(props.initialRange,'task'),card:creationDateInputs(props.initialRange,'card'),event:creationDateInputs(props.initialRange,'event'),note:creationDateInputs(undefined,'note')})
const rememberedTimed:Partial<Record<CreateItemKind,CreationDateDraft>>={}
const dates=computed(()=>dateDrafts.value[type.value])
const collectionId=computed({get:()=>destinations.value[type.value],set:value=>{destinations.value[type.value]=value}})
const collections=computed(()=>props.collections.filter(c=>c.source===sourceFor[type.value]&&!c.readonly))
const board=computed(()=>props.collections.find(c=>c.id===destinations.value.card&&c.source==='deck'))
const stackId=ref(board.value?.stacks?.some(stack=>stack.id===props.initialStackId)?props.initialStackId!:board.value?.stacks?.[0]?.id||'')
watch(()=>destinations.value.card,()=>{if(!board.value?.stacks?.some(s=>s.id===stackId.value))stackId.value=board.value?.stacks?.[0]?.id||''})
const isWork=computed(()=>type.value==='task'||type.value==='card')
const hasDestination=computed(()=>type.value==='note'&&!collectionId.value||collections.value.some(c=>c.id===collectionId.value))
const signature=()=>JSON.stringify({type:type.value,title:title.value,content:content.value,destinations:destinations.value,dates:dateDrafts.value,stack:stackId.value,assignToMe:assignToMe.value,eventDetails:eventDetails.value,attendees:attendees.value,attendeePending:attendeePending.value})
const baseline=signature()
watch(signature,value=>emit('dirty',value!==baseline),{immediate:true})
let currentRange=props.initialRange
watch(type,(kind,previous)=>{
  validation.value=''
  if(previous!=='note')currentRange=creationRangeFromInputs(previous,dateDrafts.value[previous])
  if(kind!=='note')dateDrafts.value[kind]=creationDateInputs(currentRange,kind)
})
function toggleAllDay(event:Event){
  const target=(event.target as HTMLInputElement).checked,current={...dates.value}
  if(target&&!current.allDay)rememberedTimed[type.value]=current
  dateDrafts.value[type.value]=convertCreationDateMode(current,target,type.value,rememberedTimed[type.value])
}
function submit(){
  if(props.busy)return
  validation.value=''
  if(type.value==='event'&&attendeePending.value){validation.value='Add or clear the pending attendee before saving.';return}
  if(content.value.length>(type.value==='event'?500000:100000)){validation.value='This description is too long.';return}
  if(!title.value.trim()){validation.value='Enter a title.';return}
  if(!hasDestination.value){validation.value=`Choose a writable ${destinationLabels[type.value].toLowerCase()}.`;return}
  if(type.value==='card'&&!board.value?.stacks?.some(s=>s.id===stackId.value)){validation.value='Choose a Deck stack.';return}
  try{
    const details=type.value==='event'?normalizeEventDetails({...eventDetails.value,title:title.value,description:content.value},{requireTitle:true}):{}
    emit('submit',{type:type.value,title:title.value.trim(),collectionId:collectionId.value,content:content.value,...creationDatePayload(type.value,dates.value),...(type.value==='event'?{location:details.location,reminders:details.reminders,attendees:validateEventInvitees(attendees.value,eventCalendar.value?.calendarScheduling)}:{}),...(type.value==='card'?{stackId:stackId.value,assignToMe:assignToMe.value}:{})})
  }catch(error){validation.value=error instanceof Error?error.message:'Check the selected dates.'}
}
</script>

<template>
  <div class="create-item-form">
    <span class="eyebrow">NEW IN NEXTCLOUD</span><h2>Create an item</h2>
    <p v-if="contextLabel" class="creation-context">Creating in <strong>{{contextLabel}}</strong></p>
    <p v-if="initialRange" class="selected-range-hint"><CalendarDays :size="16"/><span>{{type==='note'?'Notes have no scheduled dates. The selected range will not be saved.':'Your selected range is filled in below. Adjust it before creating.'}}</span></p>
    <form @submit.prevent="submit">
      <fieldset :disabled="busy">
        <label>Item type<select v-model="type" aria-label="Item type"><option v-for="kind in availableTypes" :key="kind" :value="kind">{{labels[kind]}}</option></select></label>
        <label>Title<input id="capture-title" v-model="title" required :maxlength="type==='card'?255:500" placeholder="What needs your attention?"/></label>
        <label>{{destinationLabels[type]}}<select v-model="collectionId" :aria-label="destinationLabels[type]" :required="type!=='note'"><option value="" :disabled="type!=='note'">{{type==='note'?'Default folder':'Choose a destination'}}</option><option v-for="collection in collections" :key="collection.id" :value="collection.id">{{collection.title}}</option></select></label>
        <template v-if="type==='card'">
          <label>Deck stack<select v-model="stackId" aria-label="Deck stack" required><option value="" disabled>Choose a stack</option><option v-for="stack in board?.stacks||[]" :key="stack.id" :value="stack.id">{{stack.title}}</option></select></label>
          <p v-if="collectionId&&!board?.stacks?.length" class="field-hint">This board has no available stacks. Create a stack in Deck and refresh sources.</p>
          <label class="check-label"><input v-model="assignToMe" type="checkbox"/>Assign to me</label>
        </template>
        <template v-if="type!=='note'">
          <div class="form-two">
            <label>Start <small v-if="isWork">optional</small><input :key="`${type}-${dates.allDay}-start`" v-model="dates.start" aria-label="Start" :type="dates.allDay?'date':'datetime-local'" :required="type==='event'"/></label>
            <label>{{isWork?'Deadline':'End'}} <small v-if="isWork">optional</small><input :key="`${type}-${dates.allDay}-end`" v-model="dates.end" :aria-label="isWork?'Deadline':'End'" :type="dates.allDay?'date':'datetime-local'" :required="type==='event'"/></label>
          </div>
          <label class="check-label"><input :checked="dates.allDay" type="checkbox" @change="toggleAllDay"/>{{isWork?'Date only':'All day'}}</label>
          <p v-if="dates.allDay" class="field-hint">{{isWork?'The deadline includes the selected day. Work dates do not reserve calendar time.':'End is the first day after the event.'}}</p>
          <p v-if="type==='task'&&dates.allDay&&!dates.start&&dates.end" class="field-hint">A one-day task uses a deadline. Add a start for a longer range.</p>
        </template>
        <section v-show="type==='event'" class="creation-event-details"><label>Location<input v-model="eventDetails.location" maxlength="2000"/></label><EventReminders v-model="eventDetails.reminders" :disabled="busy"/><EventAttendees v-model="attendees" @pending="attendeePending=$event" :disabled="busy||!eventCalendar?.calendarScheduling?.canInvite" :organizer="eventCalendar?.calendarScheduling?.organizer?.name||eventCalendar?.calendarScheduling?.organizer?.uri" :reason="eventCalendar?.calendarScheduling?.canInvite?undefined:'Invitation sending is not verified for this calendar. Choose an owned calendar or open Nextcloud.'"/></section>
<label v-if="type==='event'">Description <small>optional</small><textarea v-model="content" rows="3" maxlength="500000" placeholder="Add context"></textarea></label><MarkdownEditor v-else v-model="content" :label="type==='note'?'Note':'Description'" :disabled="busy" :rows="6" @link="emit('link',$event)"/>
      </fieldset>
      <p class="field-hint">This creates a real {{labels[type].toLowerCase()}} in the selected Nextcloud source.</p>
      <p v-if="validation||error" role="alert" class="inline-error">{{validation||error}}</p>
      <div class="form-actions"><button type="button" class="button quiet" :disabled="busy" @click="emit('cancel')">Cancel</button><button class="button primary" :disabled="busy||type==='event'&&attendeePending||!title.trim()||!hasDestination||type==='card'&&!stackId">{{busy?'Creating…':`Create ${type==='card'?'card':type}`}}</button></div>
    </form>
  </div>
</template>

<style scoped>
.create-item-form h2{font-size:23px;line-height:1.3;margin:8px 0 18px}.selected-range-hint{display:flex;gap:8px;align-items:flex-start;padding:10px 12px;margin:0 0 18px;border-radius:8px;background:var(--primary-soft);color:var(--primary-soft-text);font-size:13px;line-height:1.5}.selected-range-hint svg{flex:none;margin-top:2px}fieldset{border:0;padding:0;margin:0;min-width:0}fieldset>label,fieldset>.form-two{margin-bottom:14px}label small{font-weight:400;color:var(--muted)}.field-hint{margin-top:6px;margin-bottom:14px}.form-actions{margin-top:16px}
.creation-context{font-size:12px;color:var(--muted);margin:-7px 0 16px;overflow-wrap:anywhere}.creation-context strong{font-weight:600;color:var(--text)}
</style>
