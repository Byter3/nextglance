import type {EventParticipantInput} from '@nextspace/contracts'
import type { CreationDateRange } from '@nextspace/core/creation-dates.mjs'

export type CreateItemKind = 'task'|'card'|'event'|'note'
export type CreateItemRange = CreationDateRange
export interface CreateItemRequest {
  type: CreateItemKind
  title: string
  collectionId: string
  content: string
  stackId?: string
  assignToMe?: boolean
  start?: string
  due?: string
  end?: string
  allDay?: boolean
  location?:string
  reminders?:number[]
  attendees?:EventParticipantInput[]
}
