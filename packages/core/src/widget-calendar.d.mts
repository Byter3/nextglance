import type {WorkspaceRecord,PlanSession,Collection} from '@nextspace/contracts'
import type {CalendarClock} from './calendar-items.mjs'
export interface WidgetCalendarBlock {id:string;recordId:string;title:string;color:string;kind:string}
export interface WidgetCalendarGrid {mode:'day'|'week';label:string;days:{date:string;label:string;today:boolean}[];hourStart:number;hourEnd:number;ticks:{minute:number;label:string}[];timed:(WidgetCalendarBlock&{dayIndex:number;startMinute:number;endMinute:number;lane:number;laneCount:number;point:boolean;planned:boolean})[];allDay:(WidgetCalendarBlock&{startDay:number;endDay:number;lane:number})[];allDayLanes:number}
export function widgetCalendarClock(timeZone?:string):CalendarClock
export function widgetCalendarGrid(records:WorkspaceRecord[],plans:PlanSession[],options:{today:string;timeZone?:string;locale?:string;mode?:'day'|'week';collections?:Collection[]}):WidgetCalendarGrid
