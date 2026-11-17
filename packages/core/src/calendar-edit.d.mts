import type {PlanSession,WorkspaceRecord} from '@nextspace/contracts'
import type {TimelineDateEdit} from './timeline-edit.mjs'
export function calendarMoveEdit(record:WorkspaceRecord,days:number,minutes?:number):TimelineDateEdit|null
export function calendarPlanMove(plan:PlanSession,days:number,minutes?:number):{id:string;start:string;end:string}|null
