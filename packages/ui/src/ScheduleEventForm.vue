<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarDays, Link2, Search, AlertCircle } from 'lucide-vue-next'
import type { Collection, Relation, ScheduleRequest, Workspace, WorkspaceRecord } from '@nextspace/contracts'
import { defaultCalendarForRecord, eventConflicts } from '@nextspace/core/scheduling.mjs'
import { dateValue, dayKey, eventLabel, inputDateTime, shortDate } from './planner-ui'
import { convertCreationDateMode } from '@nextspace/core/creation-dates.mjs'
import type { CreationDateDraft } from '@nextspace/core/creation-dates.mjs'
import SchedulingWeek from './SchedulingWeek.vue'
import {recordTags} from '@nextspace/core/record-presentation.mjs'
import {newEventDetails,normalizeEventDetails} from '@nextspace/core/event-details.mjs'
import EventReminders from './EventReminders.vue'
import EventAttendees from './EventAttendees.vue'
import {validateEventInvitees} from '@nextspace/core/event-scheduling.mjs'

const props=defineProps<{record:WorkspaceRecord;workspace:Workspace;collections:Collection[];records:WorkspaceRecord[];relations:Relation[];mode:'create'|'link';busy:boolean;submitted:boolean;calendarAvailable:boolean;pending?:ScheduleRequest;scopeId?:string}>()
const emit=defineEmits<{schedule:[input:ScheduleRequest];link:[eventId:string];cancel:[];dirty:[value:boolean]}>()
const defaultStart=new Date();defaultStart.setMinutes(0,0,0);defaultStart.setHours(defaultStart.getHours()+1)
const defaults=newEventDetails(props.record)
const draft=ref({requestId:props.pending?.requestId||crypto.randomUUID(),title:props.pending?.title||defaults.title,collectionId:props.pending?.collectionId||defaultCalendarForRecord(props.record,props.workspace,props.collections,props.scopeId)||'',start:props.pending?.allDay?props.pending.start:inputDateTime(props.pending?.start||defaultStart.toISOString()),end:props.pending?.allDay?props.pending.end:inputDateTime(props.pending?.end||new Date(+defaultStart+3600000).toISOString()),allDay:Boolean(props.pending?.allDay),description:props.pending?props.pending.description||'':defaults.description,location:props.pending?props.pending.location||'':defaults.location,reminders:props.pending?[...(props.pending.reminders||[])]:defaults.reminders,attendees:(props.pending?.attendees||[]).map(item=>({...item}))})
const query=ref(''),eventId=ref(''),validation=ref(''),attendeePending=ref(false)
const eventCalendar=computed(()=>props.collections.find(c=>c.id===draft.value.collectionId&&c.source==='calendar'))
const submittedRequest=ref<ScheduleRequest>()
const calendars=computed(()=>props.collections.filter(c=>c.source==='calendar'&&!c.readonly))
const frozen=computed(()=>props.submitted||Boolean(props.pending))
const initialDraft=JSON.stringify(draft.value)
watch(()=>({draft:JSON.stringify(draft.value),eventId:eventId.value,frozen:frozen.value,pending:attendeePending.value}),value=>emit('dirty',!value.frozen&&(value.draft!==initialDraft||Boolean(value.eventId)||value.pending)),{immediate:true})
let previousTimed:CreationDateDraft|undefined
const linkedIds=computed(()=>new Set(props.relations.filter(r=>r.type==='scheduled_during'&&r.fromId===props.record.id).map(r=>r.toId)))
const events=computed(()=>props.records.filter(r=>r.kind==='event'&&r.status?.toUpperCase()!=='CANCELLED'&&!linkedIds.value.has(r.id)&&(!query.value||`${r.title} ${r.collectionTitle}`.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()))).sort((a,b)=>(a.start||'').localeCompare(b.start||'')).slice(0,100))
const chosen=computed(()=>props.records.find(r=>r.id===eventId.value))
function candidate(){const d=draft.value;const first=d.allDay?dateValue(d.start.slice(0,10)):new Date(d.start),last=d.allDay?dateValue(d.end.slice(0,10)):new Date(d.end);if(!Number.isFinite(+first)||!Number.isFinite(+last)||last<=first)return null;return {start:d.allDay?dayKey(first):first.toISOString(),end:d.allDay?dayKey(last):last.toISOString(),allDay:d.allDay}}
function toggleAllDay(){const d=draft.value,current={start:d.start,end:d.end,allDay:!d.allDay};if(d.allDay)previousTimed=current;Object.assign(d,convertCreationDateMode(current,d.allDay,'event',previousTimed))}
function chooseSlot(slot:{start:string;end:string;allDay:boolean}){if(props.busy||frozen.value)return;Object.assign(draft.value,slot);validation.value=''}
const conflicts=computed(()=>{if(props.mode==='create'&&frozen.value)return [];const slot=props.mode==='link'?chosen.value:candidate();return slot?eventConflicts(slot,props.records):[]})
const draftOutsideRange=computed(()=>{const slot=props.mode==='link'?chosen.value:candidate();if(!slot?.start||!slot.end)return false;const today=new Date();today.setHours(0,0,0,0);return +dateValue(slot.start)<+today-14*86400000||+dateValue(slot.end)>+today+90*86400000})
function submit(){
  if(props.busy)return
  validation.value=''
  if(props.mode==='link'){if(chosen.value)emit('link',chosen.value.id);return}
  // Local date controls are presentation only on resume. In a repeated DST hour,
  // reconstructing a persisted instant from them can select a different UTC offset.
  const saved=props.pending||(props.submitted?submittedRequest.value:undefined)
  if(saved){emit('schedule',{...saved,...(saved.reminders?{reminders:[...saved.reminders]}:{}),...(saved.attendees?{attendees:saved.attendees.map(item=>({...item}))}:{})});return}
  if(attendeePending.value){validation.value='Add or clear the pending attendee before saving.';return}
  const dates=candidate()
  if(!dates){validation.value='Choose an end after the start.';return}
  if(!draft.value.title.trim()||!calendars.value.some(c=>c.id===draft.value.collectionId)){validation.value='Enter a title and choose a writable calendar.';return}
  let details;try{details={...normalizeEventDetails(draft.value,{requireTitle:true}),attendees:validateEventInvitees(draft.value.attendees,eventCalendar.value?.calendarScheduling)}}catch(reason){validation.value=reason instanceof Error?reason.message:'Check event details.';return}
  submittedRequest.value={requestId:draft.value.requestId,recordId:props.record.id,title:details.title!,collectionId:draft.value.collectionId,...dates,...details}
  emit('schedule',{...submittedRequest.value,...(submittedRequest.value.reminders?{reminders:[...submittedRequest.value.reminders]}:{}),...(submittedRequest.value.attendees?{attendees:submittedRequest.value.attendees.map(item=>({...item}))}:{})})
}
</script>

<template>
  <div class="schedule-form">
    <span class="eyebrow">CALENDAR</span><h2>{{mode==='create'?'Schedule in calendar':'Link existing event'}}</h2>
    <p class="schedule-linked"><Link2 :size="16"/><span>{{record.title}}</span></p>
    <form @submit.prevent="submit">
      <template v-if="mode==='create'">
        <p v-if="frozen" class="schedule-resume">This booking is waiting to finish. Retry uses the same event and keeps its link.</p>
        <fieldset :disabled="busy||frozen">
          <div class="schedule-heading-fields"><label>Event title<input v-model="draft.title" required maxlength="500"/></label><label>Calendar<select v-model="draft.collectionId" aria-label="Calendar" required><option value="" disabled>Select calendar</option><option v-for="calendar in calendars" :key="calendar.id" :value="calendar.id">{{calendar.title}}</option></select></label></div>
          <label>Location<input v-model="draft.location" maxlength="2000"/></label>
          <div class="schedule-week-intro"><p>Choose time with your week in view.</p><label class="check-label"><input v-model="draft.allDay" type="checkbox" @change="toggleAllDay"/>All day</label></div>
          <SchedulingWeek :context-key="`${record.id}:${scopeId||'all'}`" :records="records" :collections="collections" :plans="workspace.plans" :calendar-colors="workspace.appearance.calendarColors" :tags-for="record=>recordTags(record,workspace)" :start="draft.start" :end="draft.end" :all-day="draft.allDay" :disabled="busy||frozen" @change="chooseSlot"/>
          <details class="schedule-exact"><summary>Exact dates</summary><div class="form-two"><label>Start<input :key="`${draft.allDay}-start`" v-model="draft.start" :type="draft.allDay?'date':'datetime-local'" required/></label><label>End<input :key="`${draft.allDay}-end`" v-model="draft.end" :type="draft.allDay?'date':'datetime-local'" required/></label></div><p v-if="draft.allDay" class="field-hint">The end is the first day after the event.</p></details>
          <label class="schedule-description">Description <span class="muted">optional</span><textarea v-model="draft.description" rows="3" maxlength="500000"></textarea></label>
          <EventReminders v-model="draft.reminders" :disabled="busy||frozen"/><EventAttendees v-model="draft.attendees" @pending="attendeePending=$event" :disabled="busy||frozen||!eventCalendar?.calendarScheduling?.canInvite" :organizer="eventCalendar?.calendarScheduling?.organizer?.name||eventCalendar?.calendarScheduling?.organizer?.uri" :reason="eventCalendar?.calendarScheduling?.canInvite?undefined:'Invitation sending is not verified for this calendar. Choose an owned calendar or open Nextcloud.'"/>
        </fieldset>
      </template>
      <template v-else>
        <label class="event-search"><Search :size="15"/><input v-model="query" placeholder="Search available calendar events…" aria-label="Find calendar event"/></label>
        <div class="event-picker" role="radiogroup" aria-label="Calendar event"><label v-for="event in events" :key="event.id" :class="{chosen:eventId===event.id}"><input v-model="eventId" type="radio" :value="event.id" :disabled="busy"/><CalendarDays :size="17"/><span><strong>{{event.title}}</strong><small>{{shortDate(event.start)}} · {{eventLabel(event)}} · {{event.collectionTitle}}</small></span></label><p v-if="!events.length" class="field-hint">No matching unlinked events in the loaded calendar range.</p></div>
        <p class="field-hint">Links this event as time reserved for the selected work. The event itself stays unchanged.</p>
      </template>
      <p v-if="mode==='create'&&frozen" class="field-hint">Availability will be shown with the linked booking after this saved request finishes.</p>
      <div v-else-if="conflicts.length" class="booking-warning"><AlertCircle :size="17"/><div><strong>{{conflicts.length}} overlapping busy {{conflicts.length===1?'booking':'bookings'}}</strong><p v-for="event in conflicts.slice(0,4)" :key="event.id">{{event.title}} · {{shortDate(event.start)}} · {{eventLabel(event)}}</p><p>Check these times before continuing. Linking work does not remove other bookings.</p></div></div>
      <p v-else class="field-hint">{{calendarAvailable?'No overlapping busy bookings in the loaded calendar data.':'Calendar data is cached. Refresh to check availability.'}}</p>
      <p v-if="draftOutsideRange" class="field-hint">This date is outside the usual loaded calendar range. Availability may be incomplete.</p>
      <p v-else class="schedule-coverage">Availability uses accessible calendars loaded in this app; it does not include other people's calendars you cannot access.</p>
      <p v-if="validation" class="inline-error" role="alert">{{validation}}</p>
      <div class="form-actions"><button class="button quiet" type="button" :disabled="busy" @click="emit('cancel')">Cancel</button><button class="button primary" :disabled="busy||(mode==='create'?!calendarAvailable||!calendars.length||attendeePending:!chosen)"><Link2 :size="15"/>{{busy?'Saving…':mode==='link'?'Link work session':frozen?'Retry create & link':'Create & link'}}</button></div>
    </form>
  </div>
</template>

<style scoped>
.schedule-form h2{font-size:23px;line-height:1.3;margin:8px 0 16px}.schedule-linked{display:flex;gap:8px;align-items:center;background:var(--primary-soft);color:var(--primary-soft-text);padding:10px 12px;border-radius:8px;font-size:14px;margin-bottom:20px}.schedule-linked span{overflow-wrap:anywhere}fieldset{padding:0;margin:0;border:0;min-width:0}fieldset>label,fieldset>.form-two{margin-bottom:15px}.schedule-description{margin-top:16px}.schedule-description>.muted{font-size:11px;font-weight:400;display:inline}.event-search{display:flex;flex-direction:row;align-items:center;background:var(--hover);border-radius:8px;padding:0 10px}.event-search input{border:0;background:transparent}.event-picker{max-height:280px;overflow:auto;margin:12px 0;border:1px solid var(--border);border-radius:8px}.event-picker label{display:flex;flex-direction:row;gap:10px;align-items:center;padding:12px;border-bottom:1px solid var(--border);cursor:pointer;font-weight:400}.event-picker label.chosen{background:var(--primary-soft)}.event-picker input{width:auto}.event-picker strong{display:block;font-size:14px}.event-picker small{display:block;font-size:12px;color:var(--muted);margin-top:4px}.booking-warning{display:flex;gap:10px;padding:12px;background:color-mix(in srgb,#db9b21 12%,var(--surface));border-radius:8px;font-size:13px;margin-top:16px}.booking-warning strong{font-weight:600}.booking-warning p{margin-top:7px;font-size:12px}.schedule-coverage{color:var(--muted);font-size:11px;margin-top:8px;line-height:1.5}.schedule-resume{padding:12px;background:var(--hover);border-radius:8px;font-size:13px;margin-bottom:16px}
</style>

<style scoped>
.schedule-heading-fields{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(160px,1fr);gap:14px;margin-bottom:12px}.schedule-week-intro{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0 10px}.schedule-week-intro p{font-size:13px;color:var(--muted);margin:0}.schedule-week-intro .check-label{font-size:12px}.schedule-exact{margin-top:12px;border:1px solid var(--border);border-radius:8px;padding:9px 12px}.schedule-exact summary{cursor:pointer;font-size:12px;color:var(--muted)}.schedule-exact[open] summary{margin-bottom:12px}.schedule-form .schedule-linked{margin-bottom:14px}.schedule-form .booking-warning{margin-top:12px}.schedule-form .booking-warning p{margin-top:5px}.schedule-form .form-actions{position:sticky;bottom:-24px;background:var(--surface);padding-top:14px;padding-bottom:4px;z-index:6}.schedule-form fieldset>.schedule-heading-fields{margin-bottom:12px}@media(max-width:650px){.schedule-heading-fields{grid-template-columns:1fr;gap:10px}}
</style>
