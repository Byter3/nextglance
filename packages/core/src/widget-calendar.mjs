import {calendarItemWithClock,calendarTimedItems,calendarAllDayLayout} from './calendar-items.mjs'
import {calendarTimedLayout} from './calendar-rendering.mjs'
import {sourceColor} from './record-presentation.mjs'

const dateOnly=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
const addDay=(value,count)=>new Date(Date.parse(`${value}T12:00:00Z`)+count*86400000).toISOString().slice(0,10)

/** Real epochs with injected civil-day coordinates; never changes the process timezone. */
export function widgetCalendarClock(timeZone='UTC') {
  const format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  const parts=value=>Object.fromEntries(format.formatToParts(value).map(part=>[part.type,part.value]))
  const key=value=>{const p=parts(value);return `${p.year}-${p.month}-${p.day}`}
  const boundaries=new Map()
  const boundary=value=>{
    if(boundaries.has(value))return new Date(boundaries.get(value))
    const nominal=Date.parse(`${value}T00:00:00Z`)
    if(!Number.isFinite(nominal)||new Date(nominal).toISOString().slice(0,10)!==value)return new Date(NaN)
    // The first instant of the civil date also handles skipped/repeated midnight.
    let low=nominal-36*3600000,high=nominal+36*3600000
    while(high-low>1){const middle=Math.floor((low+high)/2);if(key(new Date(middle))<value)low=middle;else high=middle}
    boundaries.set(value,high);return new Date(high)
  }
  return {parse:value=>dateOnly(value)?boundary(value):value?new Date(value):new Date(NaN),
    midnight:value=>boundary(key(value)),tomorrow:value=>boundary(addDay(key(value),1)),
    dayNumber:value=>Date.parse(`${key(value)}T00:00:00Z`)/86400000,
    minute:value=>{const p=parts(value);return Number(p.hour)*60+Number(p.minute)}}
}

/** Reuse the ordinary calendar's native work/plan semantics and overlap packer. */
export function widgetCalendarGrid(records,plans,{today,timeZone='UTC',locale='en-GB',mode='week',collections=[]}) {
  mode=mode==='day'?'day':'week'
  const clock=widgetCalendarClock(timeZone),keys=Array.from({length:mode==='day'?1:7},(_,i)=>addDay(today,i)),days=keys.map(clock.parse)
  const labelFormat=new Intl.DateTimeFormat(locale,{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'})
  const dateLabel=key=>labelFormat.format(new Date(`${key}T12:00:00Z`))
  const native=records.map(record=>calendarItemWithClock(record,clock)).filter(Boolean)
  const allDay=calendarAllDayLayout(native,days,clock)
  const layout=calendarTimedLayout(calendarTimedItems(records,plans,native,clock),days,{clock})
  const common=item=>({id:item.id,recordId:item.record.id,title:String(item.record.title||'').slice(0,500),color:sourceColor(item.record,collections),kind:item.record.kind})
  // A repeated-hour interval can end earlier on the wall clock while its real
  // epoch duration stays positive. Show the shared clamped start as a marker.
  const timed=days.flatMap((day,dayIndex)=>(layout.get(+day)||[]).map(item=>({...common(item),dayIndex,startMinute:item.from,endMinute:item.to,lane:item.lane,laneCount:item.lanes,point:item.point||item.to===item.from,planned:item.planned})))
  const hourStart=Math.max(0,timed.reduce((hour,item)=>Math.min(hour,Math.floor(item.startMinute/60)),8))
  const hourEnd=Math.min(24,timed.reduce((hour,item)=>Math.max(hour,Math.ceil(item.endMinute/60)),18))
  const hourFormat=new Intl.DateTimeFormat(locale,{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})
  return {mode,label:dateLabel(today)+(mode==='week'?` – ${dateLabel(keys.at(-1))}`:''),
    days:keys.map(date=>({date,label:dateLabel(date),today:date===today})),hourStart,hourEnd,
    ticks:Array.from({length:hourEnd-hourStart+1},(_,i)=>({minute:(hourStart+i)*60,label:hourFormat.format(new Date(Date.UTC(2000,0,1,hourStart+i)))})),timed,
    allDay:allDay.items.map(item=>({...common(item),startDay:item.first,endDay:item.last,lane:item.lane})),allDayLanes:allDay.lanes}
}
