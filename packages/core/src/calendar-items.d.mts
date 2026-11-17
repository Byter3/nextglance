import type { PlanSession, WorkspaceRecord } from '@nextspace/contracts'
export interface CalendarItem {id:string;record:WorkspaceRecord;start:number;end:number;allDay:boolean;point:boolean;label:string;planned:boolean}
export interface CalendarAllDayItem extends CalendarItem {first:number;last:number;lane:number}
export function calendarItem(record:WorkspaceRecord):CalendarItem|null
export function calendarAllDayLayout(items:CalendarItem[],days:Date[]):{items:CalendarAllDayItem[];lanes:number}
export function calendarTimedItems(records:WorkspaceRecord[],plans:PlanSession[],native?:CalendarItem[]):CalendarItem[]
export function calendarDaySummary(records:WorkspaceRecord[],date:Date):{events:number;due:number}
