const controls = /[\u0000-\u001f\u007f]/;
export function normalizeEventAttendees(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('Choose up to 100 distinct attendees.');
  const seen = new Set();
  return Array.from(value, item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['email', 'name'].includes(key)) || typeof item.email !== 'string') throw new TypeError('Enter an attendee email address and optional name.');
    if (controls.test(item.email)) throw new TypeError('Email addresses cannot contain control characters.');
    const email = item.email.trim();
    if (!email || email.length > 254 || !/^[\x21-\x7e]+$/.test(email) || !/^[^@\s<>:,;\\"]+@[^@\s<>:,;\\"]+$/.test(email) || email.includes('?') || email.includes('#')) throw new TypeError('Enter a valid attendee email address.');
    const key = email.toLowerCase();
    if (seen.has(key)) throw new TypeError('Each attendee may only be added once.');
    seen.add(key);
    if (item.name !== undefined && (typeof item.name !== 'string' || item.name.trim().length > 200 || controls.test(item.name))) throw new TypeError('Attendee names must be at most 200 characters without control characters.');
    return {email, ...(item.name?.trim() ? {name: item.name.trim()} : {})};
  });
}
export function normalizeEventParticipation(value) {
  if (!['ACCEPTED', 'TENTATIVE', 'DECLINED'].includes(value)) throw new TypeError('Choose Accept, Tentative or Decline.');
  return value;
}
export function eventMailbox(uri) {
  if (typeof uri !== 'string' || !/^mailto:/i.test(uri)) return null;
  try { return normalizeEventAttendees([{email: uri.slice(7)}])[0].email.toLowerCase(); } catch { return null; }
}
export function validateEventInvitees(value,calendarScheduling) {
  const attendees=normalizeEventAttendees(value);
  if(attendees.length&&calendarScheduling?.canInvite!==true)throw new TypeError('This calendar cannot send invitations for your verified identity.');
  const organizer=eventMailbox(calendarScheduling?.organizer?.uri);
  if(attendees.length&&!organizer)throw new TypeError('This calendar has no verified organizer identity.');
  if(attendees.some(item=>item.email.toLowerCase()===organizer))throw new TypeError('The organizer cannot also be added as an attendee.');
  return attendees;
}
/** Authority comes from the current DAV principal/owner/outbox discovery, not a cached UI flag. */
export function eventSchedulingAccess({scheduling, structuralReason, readonly, etag, authority, invalid = false} = {}) {
  const denied = reason => ({editDetails:false, editReminders:false, editAttendees:false, respond:false, delete:false, reason});
  if (structuralReason) return denied(structuralReason);
  if (readonly) return denied('read-only-calendar');
  if (typeof etag !== 'string' || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)) return denied('missing-validator');
  if (invalid) return denied('unsupported-scheduling');
  if (!scheduling?.organizer && !scheduling?.attendees?.length) return {editDetails:true,editReminders:true,editAttendees:authority?.canInvite===true,respond:false,delete:true};
  if (!authority?.owned) return denied(authority?.reason === 'not-calendar-owner' ? 'not-calendar-owner' : 'unknown-identity');
  if (scheduling.role === 'organizer' && authority.canInvite) return {editDetails:true,editReminders:true,editAttendees:true,respond:false,delete:true};
  if (scheduling.role === 'attendee' && authority.canRespond) return {editDetails:false,editReminders:true,editAttendees:false,respond:true,delete:false,reason:'not-organizer'};
  return denied(scheduling.role === 'unknown' ? 'unknown-identity' : 'unsupported-scheduling');
}
