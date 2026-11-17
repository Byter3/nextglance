export interface EventAttendeeInput {email:string;name?:string}
export function normalizeEventAttendees(value:unknown):EventAttendeeInput[]
export function normalizeEventParticipation(value:unknown):'ACCEPTED'|'TENTATIVE'|'DECLINED'
export function eventMailbox(uri:unknown):string|null
export function validateEventInvitees(value:unknown,calendarScheduling?:import('@nextspace/contracts').CalendarScheduling):EventAttendeeInput[]
export function eventSchedulingAccess(input?:{scheduling?:import('@nextspace/contracts').WorkspaceRecord['eventScheduling'];structuralReason?:'recurring'|'mixed-resource';readonly?:boolean;etag?:string;authority?:{owned?:boolean;canInvite?:boolean;canRespond?:boolean;reason?:string};invalid?:boolean}):NonNullable<import('@nextspace/contracts').WorkspaceRecord['eventAccess']>
