import type {CalendarAllDayItem} from './calendar-items.mjs'
export function calendarViewportDays(input:{scrollLeft:number;viewportWidth:number;gutter:number;dayWidth:number;days:number}):{first:number;last:number}
export function visibleAllDayLayout(items:CalendarAllDayItem[],first:number,last:number):{items:CalendarAllDayItem[];lanes:number}
export function calendarAllDaySize(input:{lanes:number;availableHeight:number;manualHeight?:number|null}):{height:number;minimum:number;maximum:number;contentHeight:number;automaticHeight:number;automatic:boolean}
