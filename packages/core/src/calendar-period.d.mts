import type {WorkspaceRecord,PlanSession} from '@nextspace/contracts'
import type {CalendarItem} from './calendar-items.mjs'
export type CalendarMode='day'|'week'|'month'
export interface CalendarPeriod {mode:CalendarMode;start:string;end:string;gridStart:string;gridEnd:string;dayCount:number}
export interface MonthSegment extends CalendarItem {first:number;last:number;lane:number;continuesBefore:boolean;continuesAfter:boolean}
export interface MonthWeek {start:string;days:Date[];lanes:number;items:MonthSegment[]}
export function normalizeCalendarMode(value:unknown):CalendarMode
export function calendarPeriod(anchor:Date|string,mode?:unknown):CalendarPeriod
export function calendarPeriodDays(period:CalendarPeriod):Date[]
export function shiftCalendarAnchor(anchor:Date|string,mode:unknown,amount:number):string
export function calendarMonthWeeks(records:WorkspaceRecord[],plans:PlanSession[],anchor:Date|string):MonthWeek[]
export function monthGridZoom(initialWidth:number,initialHeight:number,scale:number):{dayWidth:number;weekHeight:number}
