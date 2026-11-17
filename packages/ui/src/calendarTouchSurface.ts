/** DOM adapters shared by the calendar's blank and item touch paths. */
export function calendarTouchEligible(target:HTMLElement){
  return Boolean(target.closest('.calendar-all-day,.calendar-all-day-viewport,.calendar-day-track,.calendar-header'))&&!Boolean(target.closest('.overview-agenda,.all-day-gutter,.calendar-hour-labels'))
}
export function panCalendarVertical(vertical:HTMLElement|undefined,allDay:HTMLElement|undefined,timed:HTMLElement|undefined,dy:number){
  if(!vertical)return
  const before=vertical.scrollTop
  vertical.scrollTop-=dy
  // The all-day section may have few rows or reach its edge. Continue the
  // same gesture through the hours instead of trapping vertical movement.
  if(vertical===allDay&&timed)timed.scrollTop-=dy-(before-vertical.scrollTop)
}
