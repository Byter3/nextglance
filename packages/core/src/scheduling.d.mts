import type {Collection, Relation, Workspace, WorkspaceRecord} from '@nextspace/contracts'

export interface CalendarSlot {
  id?: string
  kind?: 'event'
  start?: string
  end?: string
  allDay?: boolean
  busy?: boolean
  status?: string
  transparency?: string
}

export function linkedWorkSessions(recordId: string, records: WorkspaceRecord[], relations: Relation[]): {event: WorkspaceRecord; relation: Relation}[]
export function scheduledWorkFor(eventId: string, records: WorkspaceRecord[], relations: Relation[]): {record: WorkspaceRecord; relation: Relation}[]
export function eventConflicts(slot: CalendarSlot | WorkspaceRecord, events: WorkspaceRecord[]): WorkspaceRecord[]
export function defaultCalendarForRecord(record: WorkspaceRecord | undefined, workspace: Pick<Workspace, 'spaces'|'projects'> & Partial<Pick<Workspace,'categories'>> | undefined, collections: Collection[], scopeId?: string): string | undefined
