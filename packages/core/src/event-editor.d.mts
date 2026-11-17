import type {WorkspaceRecord,EventParticipantInput} from '@nextspace/contracts'
import type {CreationDateDraft} from './creation-dates.mjs'
import type {EventDetails} from './event-details.mjs'
export type EventEditorDraft=CreationDateDraft & Required<EventDetails> & {attendees:EventParticipantInput[]}
export interface EventEditorChanges extends EventDetails {id:string;etag?:string;start?:string;end?:string;allDay?:boolean;attendees?:EventParticipantInput[]}
export function eventEditorDraft(record:WorkspaceRecord):EventEditorDraft
export function eventEditorFingerprint(record:WorkspaceRecord):string
export function eventEditorChanges(record:WorkspaceRecord,draft:EventEditorDraft):EventEditorChanges
export function eventAccessExplanation(reason?:string):string
export function eventActionExplanation(record:WorkspaceRecord|undefined,context?:{allowed?:boolean;implemented?:boolean;connected?:boolean;sourceReady?:boolean;runtimeReady?:boolean}):string
