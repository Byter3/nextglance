import {calendarItem, calendarTimedItems, calendarAllDayLayout} from './calendar-items.mjs'

const pad=value=>String(value).padStart(2,'0')
const key=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
function localDate(value){
  const date=value instanceof Date?new Date(value):typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(`${value}T00:00:00`):new Date(NaN)
  if(!Number.isFinite(+date)||typeof value==='string'&&key(date)!==value)throw new RangeError('Invalid calendar date')
  date.setHours(0,0,0,0);return date
}
const add=(date,amount)=>{const result=new Date(date);result.setDate(result.getDate()+amount);return result}
const civil=date=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000
export function normalizeCalendarMode(value){return ['day','week','month'].includes(value)?value:'week'}

/** Serialized local-date boundaries; exclusive ends avoid DST duration assumptions. */
export function calendarPeriod(anchor,requestedMode='week'){
  const mode=normalizeCalendarMode(requestedMode),date=localDate(anchor)
  const start=mode==='month'?new Date(date.getFullYear(),date.getMonth(),1):date
  const end=mode==='month'?new Date(date.getFullYear(),date.getMonth()+1,1):add(start,mode==='day'?1:7)
  const gridStart=mode==='month'?add(start,-((start.getDay()+6)%7)):start
  const gridEnd=mode==='month'?add(end,(7-((end.getDay()+6)%7))%7):end
  return {mode,start:key(start),end:key(end),gridStart:key(gridStart),gridEnd:key(gridEnd),dayCount:civil(gridEnd)-civil(gridStart)}
}
export function calendarPeriodDays(period){return Array.from({length:period.dayCount},(_,index)=>add(localDate(period.gridStart),index))}
export function shiftCalendarAnchor(anchor,requestedMode,amount){
  if(!Number.isInteger(amount))throw new RangeError('Calendar navigation needs a whole period')
  const date=localDate(anchor),mode=normalizeCalendarMode(requestedMode)
  if(mode!=='month')return key(add(date,amount*(mode==='day'?1:7)))
  const target=new Date(date.getFullYear(),date.getMonth()+amount,1)
  target.setDate(Math.min(date.getDate(),new Date(target.getFullYear(),target.getMonth()+1,0).getDate()))
  return key(target)
}

/** Segment every real interval at week boundaries; retain native semantic fields. */
export function calendarMonthWeeks(records,plans,anchor){
  const period=calendarPeriod(anchor,'month'),days=calendarPeriodDays(period)
  const native=records.map(calendarItem).filter(Boolean)
  const items=[...native.filter(item=>item.allDay),...calendarTimedItems(records,plans,native)]
  const spans=items.map(item=>{
    const first=localDate(new Date(item.start))
    // Instantaneous due/start markers occupy their one real date; an end at
    // midnight belongs to the preceding day, just like the hourly calendar.
    const final=localDate(new Date(item.end>item.start?item.end-1:item.start))
    return {...item,start:+first,end:+add(final,1),allDay:true,original:item}
  })
  const weeks=[]
  for(let offset=0;offset<days.length;offset+=7){
    const weekDays=days.slice(offset,offset+7),layout=calendarAllDayLayout(spans,weekDays)
    weeks.push({start:key(weekDays[0]),days:weekDays,lanes:layout.lanes,items:layout.items.map(item=>({...item.original,first:item.first,last:item.last,lane:item.lane,continuesBefore:item.start<+weekDays[0],continuesAfter:item.end>+add(weekDays[6],1)}))})
  }
  return weeks
}

/** Pinch is density only; it never changes a record or the chosen month. */
export function monthGridZoom(initialWidth,initialHeight,scale){
  const safeScale=Number.isFinite(scale)&&scale>0?scale:1
  return {dayWidth:Math.max(70,Math.min(220,initialWidth*safeScale)),weekHeight:Math.max(100,Math.min(300,initialHeight*safeScale))}
}
