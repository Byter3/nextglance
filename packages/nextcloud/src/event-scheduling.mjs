import ICAL from 'ical.js';
import {eventMailbox, eventSchedulingAccess, validateEventInvitees} from '@nextspace/core/event-scheduling.mjs';

export function eventStructureReason(calendar, event, occurrenceId) {
  if (occurrenceId || ['rrule','rdate','exdate','recurrence-id'].some(key=>event?.hasProperty(key))) return 'recurring';
  if (calendar.name !== 'vcalendar' || calendar.hasProperty('method') || calendar.getAllSubcomponents('vevent').length !== 1 || calendar.getAllSubcomponents().some(item=>!['vevent','vtimezone'].includes(item.name)) || event?.getAllProperties('uid').length !== 1) return 'mixed-resource';
}
function participant(property) {
  const uri=String(property.getFirstValue() || ''), name=property.getParameter('cn');
  return {uri, ...(typeof name==='string'&&name ? {name} : {})};
}
export function eventSchedulingDetails(calendar,event,authority,occurrenceId) {
  const organizers=event.getAllProperties('organizer'), native=event.getAllProperties('attendee');
  const organizer=organizers[0] ? participant(organizers[0]) : undefined;
  const attendees=native.map(property=>({...participant(property), participation:String(property.getParameter('partstat')||'NEEDS-ACTION'), ...(property.getParameter('role')?{role:String(property.getParameter('role'))}:{}), ...(property.getParameter('rsvp')!==undefined?{rsvp:String(property.getParameter('rsvp')).toUpperCase()==='TRUE'}:{}), ...(property.getParameter('schedule-status')?{scheduleStatus:String(property.getParameter('schedule-status'))}:{})}));
  const identities=new Set(authority?.addresses||[]), ownAttendee=attendees.filter(item=>identities.has(eventMailbox(item.uri)));
  const role=!organizer&&!attendees.length?'none':organizer&&identities.has(eventMailbox(organizer.uri))?'organizer':ownAttendee.length===1?'attendee':'unknown';
  const mailboxes=attendees.map(item=>eventMailbox(item.uri));
  const unsupportedAgent=property=>{const agent=property.getParameter('schedule-agent');return agent!==undefined&&String(agent).toUpperCase()!=='SERVER';};
  const invalid=organizers.length>1 || mailboxes.filter(value=>value!==eventMailbox(organizer?.uri)).length>100 || Boolean(organizer&&!eventMailbox(organizer.uri)) || attendees.length>0&&!organizer || mailboxes.some(value=>!value) || new Set(mailboxes).size!==mailboxes.length || ownAttendee.length>1 || [...organizers,...native].some(unsupportedAgent) || [organizer,...attendees].filter(Boolean).some(item=>item.name&&(item.name.length>200||/[\u0000-\u001f\u007f]/.test(item.name)));
  const scheduling={role,...(organizer?{organizer}:{}),attendees,...(ownAttendee.length===1?{ownAttendeeUri:ownAttendee[0].uri}:{})};
  return {eventScheduling:scheduling, structuralReason:eventStructureReason(calendar,event,occurrenceId), invalid};
}
export function applyEventAuthority(record,collection) {
  if(record.source!=='calendar')return record;
  const authority=collection.remote?.scheduling, identities=new Set(authority?.addresses||[]), previous=record.eventScheduling;
  if(!previous)return record;
  const own=(previous.attendees||[]).filter(item=>identities.has(eventMailbox(item.uri)));
  const role=!previous.organizer&&!previous.attendees.length?'none':previous.organizer&&identities.has(eventMailbox(previous.organizer.uri))?'organizer':own.length===1?'attendee':'unknown';
  const {ownAttendeeUri:_old,...rest}=previous;
  const scheduling={...rest,role,...(own.length===1?{ownAttendeeUri:own[0].uri}:{})};
  const eventAccess=eventSchedulingAccess({scheduling, structuralReason:record.remote?.eventStructure,invalid:record.remote?.invalidScheduling,readonly:collection.readonly,etag:record.etag,authority});
  return {...record,eventScheduling:scheduling,eventAccess};
}
export function replaceEventAttendees(event,input,authority) {
  const original=event.getAllProperties('attendee'), organizer=event.getFirstProperty('organizer');
  const organizerUri=organizer?String(organizer.getFirstValue()):authority?.organizer?.uri;
  const requested=validateEventInvitees(input,{canInvite:authority?.canInvite===true,organizer:{uri:organizerUri}});
  if(requested.length&&!organizer){
    if(!authority?.canInvite||!eventMailbox(organizerUri))throw new TypeError('This calendar has no verified organizer identity.');
    const property=new ICAL.Property('organizer');property.setValue(organizerUri);
    if(authority.organizer.name)property.setParameter('cn',authority.organizer.name);
    event.addProperty(property);
  }
  const wanted=new Map(requested.map(item=>[item.email.toLowerCase(),item]));
  for(const property of original)if(eventMailbox(String(property.getFirstValue()))!==eventMailbox(organizerUri)&&!wanted.has(eventMailbox(String(property.getFirstValue()))))event.removeProperty(property);
  const existing=new Set(original.map(property=>eventMailbox(String(property.getFirstValue()))));
  for(const item of requested)if(!existing.has(item.email.toLowerCase())){
    const property=new ICAL.Property('attendee');property.setValue(`mailto:${item.email}`);property.setParameter('partstat','NEEDS-ACTION');property.setParameter('rsvp','TRUE');property.setParameter('role','REQ-PARTICIPANT');
    if(item.name)property.setParameter('cn',item.name);
    event.addProperty(property);
  }
}
