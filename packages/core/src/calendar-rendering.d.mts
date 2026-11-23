import type {CalendarItem,CalendarClock} from './calendar-items.mjs'
export interface CalendarTimedBlock extends CalendarItem {from:number;to:number;lane:number;lanes:number}
export function calendarTimedLayout(items:CalendarItem[],days:Date[],options?:{minimumMinutes?:number;minimumDuration?:number;clock?:CalendarClock}):Map<number,CalendarTimedBlock[]>
export function calendarDateWindow(input:{first:number;last:number;days:number},overscan?:number):{first:number;last:number}
export function calendarLaneWindow(input:{scrollTop:number;viewportHeight:number;lanes:number},overscan?:number):{first:number;last:number}
