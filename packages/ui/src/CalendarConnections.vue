<script setup lang="ts">
import { computed } from 'vue'
import { CalendarDays, Link2, Plus, ChevronRight, X, AlertCircle } from 'lucide-vue-next'
import { linkedWorkSessions, scheduledWorkFor, eventConflicts } from '@nextspace/core/scheduling.mjs'
import {recordTags} from '@nextspace/core/record-presentation.mjs'
import LinkedJump from './LinkedJump.vue'
import RecordTagMarkers from './RecordTagMarkers.vue'
import type { PlannerView, RecordTag, Relation, WorkspaceRecord } from '@nextspace/contracts'
import { shortDate, eventLabel } from './planner-ui'
const props=defineProps<{view?:PlannerView;record:WorkspaceRecord;records:WorkspaceRecord[];relations:Relation[];locked:boolean;canSchedule:boolean;calendarAvailable:boolean;pending:boolean;colorFor:(record:WorkspaceRecord)=>string;sourceColorFor?:(record:WorkspaceRecord)=>string;tagsFor?:(record:WorkspaceRecord)=>RecordTag[]}>()
const sourceTint=(record:WorkspaceRecord)=>props.sourceColorFor?.(record)||props.colorFor(record)
const itemTags=(record:WorkspaceRecord)=>props.tagsFor?.(record)||recordTags(record)
const itemTitle=(record:WorkspaceRecord)=>`${record.title} · ${record.collectionTitle||record.source}${itemTags(record).length?' · Tags: '+itemTags(record).map(tag=>tag.title).join(', '):''}`
const emit=defineEmits<{jump:[intent:{id:string;view?:'calendar'|'timeline'}];schedule:[];link:[];open:[record:WorkspaceRecord];unlink:[relation:Relation]}>()
const work=computed(()=>props.record.kind==='task'||props.record.kind==='card')
const sessions=computed(()=>linkedWorkSessions(props.record.id,props.records,props.relations))
const tasks=computed(()=>scheduledWorkFor(props.record.id,props.records,props.relations))
const conflicts=(event:WorkspaceRecord)=>eventConflicts(event,props.records)
const missing=computed(()=>props.relations.filter(edge=>edge.type==='scheduled_during'&&edge.fromId===props.record.id&&!props.records.some(record=>record.id===edge.toId)))
</script>
<template>
  <section v-if="work||record.kind==='event'" class="inspector-section calendar-connections" aria-label="Calendar connections">
    <header><h3>{{work?'Calendar':'Scheduled work'}}</h3><span class="availability-label" title="Checks cover loaded calendar bookings. A task's date range is not a busy reservation.">{{calendarAvailable?'Loaded calendars':'Cached availability'}}</span></header>
    <div v-if="work" class="calendar-connect-actions"><button class="button small quiet" :disabled="!canSchedule" @click="emit('schedule')"><CalendarDays :size="16"/>{{pending?'Resume scheduling':'Schedule in calendar'}}</button><button class="button small quiet" :disabled="locked" @click="emit('link')"><Link2 :size="16"/>Link existing event</button></div>
    <div v-for="{event,relation} in sessions" :key="relation.id" class="linked-booking" :style="{'--item-color':colorFor(event),'--source-color':sourceTint(event)}">
      <CalendarDays :size="21" :style="{color:sourceTint(event)}"/>
      <div class="linked-booking-main"><button class="linked-booking-open" :title="itemTitle(event)" @click="emit('open',event)"><strong>{{event.title}}</strong><ChevronRight :size="16"/></button><small>{{shortDate(event.start)}} · {{eventLabel(event)}}</small><small class="connection-source"><i class="connection-source-dot" :style="{backgroundColor:sourceTint(event)}"/>{{event.collectionTitle}}</small><RecordTagMarkers class="connection-tags" :tags="itemTags(event)" :compact="false" :limit="2"/><span class="linked-session-label"><Link2 :size="13"/>Linked work session</span><p class="field-hint">{{event.busy===false?'This event is marked free in the calendar.':'Time reserved for this work.'}}</p>
        <LinkedJump :record-id="event.id" :title="event.title" :view="view||'overview'" @jump="emit('jump',$event)"/><div v-if="conflicts(event).length" class="booking-collision"><AlertCircle :size="14"/><span>Overlaps {{conflicts(event).length}} other busy {{conflicts(event).length===1?'booking':'bookings'}}<button v-for="other in conflicts(event).slice(0,3)" :key="other.id" @click="emit('open',other)">{{other.title}}</button></span></div>
      </div>
      <button class="icon-button unlink-session" :disabled="locked" :aria-label="`Unlink work session ${event.title}`" title="Remove this link; keep the calendar event" @click="emit('unlink',relation)"><X :size="13"/></button>
    </div>
    <div v-for="relation in missing" :key="relation.id" class="missing-session"><span>Linked event unavailable in loaded calendars</span><button class="icon-button" :disabled="locked" aria-label="Unlink unavailable work session" @click="emit('unlink',relation)"><X :size="13"/></button></div>
    <p v-if="work&&!sessions.length&&!missing.length" class="field-hint">Reserve time for this work in a Nextcloud calendar, or link an existing booking.</p>
    <div v-for="{record:task,relation} in tasks" :key="relation.id" class="scheduled-task" :style="{'--item-color':colorFor(task),'--source-color':sourceTint(task)}"><Link2 :size="16" :style="{color:sourceTint(task)}"/><button :title="itemTitle(task)" @click="emit('open',task)"><strong>{{task.title}}</strong><small class="connection-source"><i class="connection-source-dot" :style="{backgroundColor:sourceTint(task)}"/>{{task.collectionTitle}}</small><RecordTagMarkers class="connection-tags" :tags="itemTags(task)" :compact="false" :limit="2"/></button><LinkedJump :record-id="task.id" :title="task.title" :view="view||'overview'" @jump="emit('jump',$event)"/><button class="icon-button" :disabled="locked" :aria-label="`Unlink scheduled work ${task.title}`" @click="emit('unlink',relation)"><X :size="13"/></button></div>
    <p v-if="!work&&!tasks.length" class="field-hint">No work linked to this event. Open a task or card and choose Link existing event.</p>
    <div v-if="record.kind==='event'&&conflicts(record).length" class="booking-collision"><AlertCircle :size="15"/><span>Overlapping busy bookings<button v-for="other in conflicts(record)" :key="other.id" @click="emit('open',other)">{{other.title}} · {{eventLabel(other)}}</button></span></div>
  </section>
</template>
<style scoped>
.calendar-connect-actions{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.calendar-connect-actions .button{border:1px solid var(--border);font-size:12px;min-height:34px;padding:6px 9px;color:var(--primary);border-radius:8px}.linked-booking{display:flex;align-items:flex-start;gap:11px;position:relative;margin:14px 0 4px}.linked-booking>svg{margin-top:3px}.linked-booking-main{min-width:0;flex:1}.linked-booking-open{display:flex;width:100%;align-items:center;gap:8px;padding:0;text-align:left}.linked-booking-open strong{font-size:14px;font-weight:600;flex:1;overflow-wrap:anywhere}.linked-booking-main>small{display:block;color:var(--muted);font-size:12px;margin-top:3px}.linked-session-label{display:inline-flex;gap:6px;align-items:center;background:var(--primary-soft);color:var(--primary-soft-text);padding:4px 7px;border-radius:6px;margin-top:7px;font-size:12px}.linked-booking-main .field-hint{font-size:12px;margin-top:4px}.unlink-session{width:23px;height:25px;opacity:0}.linked-booking:hover .unlink-session,.unlink-session:focus-visible{opacity:1}.booking-collision{display:flex;gap:7px;padding:9px 0;color:var(--red);font-size:12px;line-height:1.5}.booking-collision button{display:block;text-align:left;padding:3px 0;text-decoration:underline;font-size:12px}.booking-coverage{color:var(--muted);font-size:11px;line-height:1.55;margin-top:12px}.scheduled-task{display:flex;gap:10px;align-items:center;padding:10px 0}.scheduled-task>button:first-of-type{flex:1;text-align:left;min-width:0}.scheduled-task strong{font-size:14px;display:block}.scheduled-task small{font-size:12px;color:var(--muted);display:block;margin-top:4px}.missing-session{font-size:12px;display:flex;align-items:center;color:var(--muted)}.missing-session span{flex:1}
@media(hover:none){.unlink-session{opacity:1}}
.linked-booking,.scheduled-task{border-left:3px solid var(--source-color);border-radius:6px;background:color-mix(in srgb,var(--item-color) 5%,var(--surface));padding:9px}.connection-source-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:middle;flex:none}.connection-tags{margin-top:6px;max-width:100%}.linked-booking-main>.linked-session-label{display:flex;width:max-content;max-width:100%}
</style>
