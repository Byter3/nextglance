import {creationDateInputs,creationDatePayload} from './creation-dates.mjs'
import {normalizeEventDetails} from './event-details.mjs'
import {normalizeEventAttendees,eventMailbox} from './event-scheduling.mjs'

export function eventEditorDraft(record){
  const organizer=eventMailbox(record.eventScheduling?.organizer?.uri)
  const attendees=(record.eventScheduling?.attendees||[]).flatMap(item=>{const email=eventMailbox(item.uri);return email&&email!==organizer?[{email,...(item.name?{name:item.name}:{})}]:[]})
  return {...creationDateInputs({start:record.start,end:record.end,allDay:record.allDay===true},'event'),title:record.title,location:record.location||'',description:record.body||'',reminders:[...(record.reminders||[])],attendees}
}
export function eventEditorFingerprint(record){
  return JSON.stringify([record.id,record.collectionId,record.etag,record.title,record.body,record.location,record.reminders,record.unsupportedReminderCount,record.start,record.end,record.allDay,record.readonly,record.eventAccess,record.eventScheduling])
}
/** Omitted properties preserve native values, including all untouched alarms. */
export function eventEditorChanges(record,draft){
  const baseline=eventEditorDraft(record),details=normalizeEventDetails(draft,{requireTitle:true}),result={id:record.id,...(record.etag===undefined?{}:{etag:record.etag})}
  for(const key of ['title','location','description'])if(draft[key]!==baseline[key])result[key]=details[key]
  if(JSON.stringify(draft.reminders)!==JSON.stringify(baseline.reminders))result.reminders=details.reminders
  if(JSON.stringify(draft.attendees||[])!==JSON.stringify(baseline.attendees))result.attendees=normalizeEventAttendees(draft.attendees)
  if(['start','end','allDay'].some(key=>draft[key]!==baseline[key]))Object.assign(result,creationDatePayload('event',draft))
  if(record.eventAccess){
    if(!record.eventAccess.editDetails&&['title','location','description','start','end','allDay'].some(key=>key in result))throw new TypeError('Only the organizer can change these event details.')
    if(!record.eventAccess.editReminders&&'reminders' in result)throw new TypeError('Reminders cannot be changed for this event.')
    if(!record.eventAccess.editAttendees&&'attendees' in result)throw new TypeError('Attendees cannot be changed for this event.')
  }
  if(Object.keys(result).every(key=>['id','etag'].includes(key)))throw new TypeError('Change an event detail before saving.')
  return result
}
export function eventAccessExplanation(reason){
  return {
    recurring:'This recurring event must be managed in Nextcloud.',
    'mixed-resource':'This event shares a calendar resource with other items. Manage it in Nextcloud.',
    'read-only-calendar':'This calendar is read only.',
    'missing-validator':'Refresh Calendar to verify this event before making changes.',
    'unknown-identity':'Calendar could not verify your scheduling identity. Open the event in Nextcloud.',
    'not-organizer':'Only the organizer can change the event or delete it. You can respond to your invitation and adjust your reminders.',
    'unsupported-scheduling':'This event uses scheduling features that must be managed in Nextcloud.',
    'not-calendar-owner':'This shared or delegated calendar must be managed in Nextcloud.',
  }[reason]||'This event is read only here. Open it in Nextcloud to make changes.'
}
/** Human-readable fallback beside a disabled action; eligibility stays in native operations. */
export function eventActionExplanation(record,{allowed=false,implemented=true,connected=true,sourceReady=true,runtimeReady=true}={}){
  if(allowed)return ''
  if(!connected)return 'Connect to Nextcloud to change this event.'
  if(!implemented)return 'This action is not available in this client. Open the event in Nextcloud.'
  if(!sourceReady)return 'Refresh Calendar to verify this event before making changes.'
  if(!runtimeReady)return 'Calendar editing is temporarily unavailable. Check Settings & connection for authorization or local-cache recovery.'
  return eventAccessExplanation(record?.eventAccess?.reason)
}
