import {creationDay, shiftCreationDay} from './creation-dates.mjs'
import {shiftTimelineDate} from './timeline-edit.mjs'

const dayOnly=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')
const parse=value=>new Date(dayOnly(value)?`${value}T00:00:00`:value)

export function recordDateDraft(record) {
  const start=record.start||'',end=(record.kind==='event'?record.end:record.due)||''
  return {start,end,allDay:record.kind==='event'?Boolean(record.allDay):![start,end].some(value=>value.includes('T'))}
}

/** Explicit empty strings remove a bound. Deck dates are always native instants. */
export function recordDatePayload(record,draft) {
  const value=(raw,finish=false)=>{
    if(!raw)return ''
    const parsed=parse(raw)
    if(!Number.isFinite(+parsed)||draft.allDay&&(!dayOnly(raw)||creationDay(parsed)!==raw))throw new Error('Choose valid dates and times.')
    if(record.kind==='card'&&draft.allDay){parsed.setHours(finish?23:0,finish?59:0,0,0);return parsed.toISOString()}
    return draft.allDay?raw:parsed.toISOString()
  }
  const start=value(draft.start),end=value(draft.end,true)
  if(record.kind==='event'&&(!start||!end))throw new Error('Calendar events need both a start and an end.')
  if(start&&end&&+parse(end)<=+parse(start))throw new Error(record.kind==='task'&&draft.allDay?'For a one-day task, use a deadline without a start. Otherwise the deadline must be after the start.':'The end must be after the start.')
  return record.kind==='event'?{start,end,allDay:draft.allDay}:{start,due:end}
}

function atDay(value,day,fallback){
  if(!value)return `${day}T${fallback}`
  if(dayOnly(value))return day
  const previous=parse(value),next=parse(day)
  next.setHours(previous.getHours(),previous.getMinutes(),previous.getSeconds(),previous.getMilliseconds())
  return next.toISOString()
}

/** Dragging empty space selects inclusive calendar days; VEVENT ends stay exclusive. */
export function selectRecordDateRange(record,draft,first,last) {
  const [startDay,lastDay]=[first,last].sort()
  if(draft.allDay){
    return {start:record.kind==='task'&&startDay===lastDay?'':startDay,end:record.kind==='event'?shiftCreationDay(lastDay,1):lastDay,allDay:true}
  }
  let start=atDay(draft.start,startDay,'09:00'),end=atDay(draft.end,lastDay,'17:00')
  if(+parse(end)<=+parse(start))end=new Date(+parse(start)+3600000).toISOString()
  return {start,end,allDay:false}
}

/** Shift bounds by local calendar days so wall-clock times survive DST boundaries. */
export function dragRecordDateDraft(record,draft,mode,offset) {
  const days=Math.round(offset)
  if(!days)return {...draft}
  const next={...draft}
  if(mode==='move'){
    if(draft.start)next.start=shiftTimelineDate(draft.start,days)||draft.start
    if(draft.end)next.end=shiftTimelineDate(draft.end,days)||draft.end
  }else if(mode==='start')next.start=shiftTimelineDate(draft.start||draft.end,days)||''
  else if(mode==='end')next.end=shiftTimelineDate(draft.end||draft.start,days)||''
  else return {...draft}
  try{recordDatePayload(record,next);return next}catch{return {...draft}}
}

export function recordDateDayOffset(day,anchor) {
  const first=parse(day),base=parse(anchor)
  if(!Number.isFinite(+first)||!Number.isFinite(+base))return NaN
  return (Date.UTC(first.getFullYear(),first.getMonth(),first.getDate())-Date.UTC(base.getFullYear(),base.getMonth(),base.getDate()))/86400000
}

/** Shared day geometry for work deadlines and exclusive-ended calendar events. */
export function recordDateGeometry(record,anchor,count=14) {
  const first=record.start,last=record.kind==='event'?record.end:record.due
  if(!first&&!last)return null
  let start=recordDateDayOffset(first||last,anchor),end=recordDateDayOffset(last||first,anchor)+1
  if(record.kind==='event'&&last){
    const date=parse(last)
    if(dayOnly(last)||date.getHours()===0&&date.getMinutes()===0&&date.getSeconds()===0)end-=1
  }
  end=Math.max(start+1,end)
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=0||start>=count)return null
  return {left:Math.max(0,start)/count*100,width:(Math.min(count,end)-Math.max(0,start))/count*100,clippedStart:start<0,clippedEnd:end>count}
}
