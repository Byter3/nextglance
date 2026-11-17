export interface CreationDateDraft {start: string; end: string; allDay: boolean}
export interface CreationDateRange extends CreationDateDraft {origin?: 'timeline'|'calendar'; recordId?: string}
export type CreationDateKind = 'task'|'card'|'event'|'note'
export function creationDay(value: Date|string): string
export function creationLocalTime(value: Date|string): string
export function shiftCreationDay(value: string, offset: number): string
export function creationRangeFromInputs(kind: CreationDateKind, draft: CreationDateDraft): CreationDateRange|undefined
export function creationDateInputs(range?: CreationDateRange, kind?: CreationDateKind, now?: Date): CreationDateDraft
export function convertCreationDateMode(draft: CreationDateDraft, allDay: boolean, kind?: CreationDateKind, previousTimed?: CreationDateDraft): CreationDateDraft
export function creationDatePayload(kind: CreationDateKind, draft: CreationDateDraft): {start?: string; due?: string; end?: string; allDay?: boolean}
