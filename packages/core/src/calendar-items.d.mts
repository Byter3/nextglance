import type { PlanSession, WorkspaceRecord } from '@nextspace/contracts'
export interface CalendarItem {id:string;record:WorkspaceRecord;start:number;end:number;allDay:boolean;point:boolean;label:string;planned:boolean}
export interface CalendarAllDayItem extends CalendarItem {first:number;last:number;lane:number}
export interface CalendarClock {parse(value?:string):Date;midnight(value:Date):Date;tomorrow(value:Date):Date;dayNumber(value:Date):number;minute(value:Date):number}
export const localCalendarClock:Readonly<CalendarClock>
export function calendarItem(record:WorkspaceRecord):CalendarItem|null
export function calendarItemWithClock(record:WorkspaceRecord,clock:CalendarClock):CalendarItem|null
export function calendarAllDayLayout(items:CalendarItem[],days:Date[],clock?:CalendarClock):{items:CalendarAllDayItem[];lanes:number}
export function calendarTimedItems(records:WorkspaceRecord[],plans:PlanSession[],native?:CalendarItem[],clock?:CalendarClock):CalendarItem[]
export function calendarDaySummary(records:WorkspaceRecord[],date:Date):{events:number;due:number}
