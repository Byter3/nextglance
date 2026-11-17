const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const parsed = value => new Date(dateOnly(value) ? `${value}T00:00:00` : value)
const key = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
export function shiftTimelineDate(value, days) {
  if (!value) return undefined
  const date = parsed(value)
  if (!Number.isFinite(+date)) return undefined
  const whole = dateOnly(value) ? Math.round(days) : Math.trunc(days)
  date.setDate(date.getDate()+whole)
  if (!dateOnly(value)) date.setTime(+date+Math.round((days-whole)*1440)*60000)
  return dateOnly(value) ? key(date) : date.toISOString()
}

/** UI proposals only. The native connector validates again and conditionally saves. */
export function timelineDateEdit(record, mode, deltaDays, targetDay) {
  const edit = {id:record.id, ...(record.etag ? {etag:record.etag} : {})}
  const timed = !record.allDay && [record.start,record.due,record.end].some(value=>value?.includes('T'))
  const delta = timed ? Math.round(deltaDays*96)/96 : Math.round(deltaDays)
  const event = record.kind === 'event', lastKey = event ? 'end' : 'due'
  const first = record.start, last = record[lastKey]
  if (mode === 'place') {
    if (!dateOnly(targetDay)) return null
    if (record.kind === 'card') {
      const date = parsed(targetDay); date.setHours(23,59,0,0); edit.due = date.toISOString()
    } else edit.due = targetDay
    return edit
  }
  if (!delta) return null
  // DTSTART-only timed events are normalized as an instant. Keep DTEND absent
  // instead of manufacturing an explicit invalid zero-duration interval.
  if (mode === 'move' && event && !record.allDay && first && last && +parsed(first) === +parsed(last)) {
    return {...edit,start:shiftTimelineDate(first,delta),allDay:false}
  }
  if (mode === 'move') {
    if (first) edit.start = shiftTimelineDate(first,delta)
    if (last) edit[lastKey] = shiftTimelineDate(last,delta)
    if (event && first && last && !record.allDay && !dateOnly(first)) {
      edit.end = new Date(+parsed(edit.start)+(+parsed(last)-+parsed(first))).toISOString()
    }
  } else if (mode === 'start') {
    // A due-only marker can acquire a real start only by extending it earlier.
    const value = first || last
    if (!value) return null
    edit.start = shiftTimelineDate(value,delta)
  } else if (mode === 'end') {
    const value = last || first
    if (!value) return null
    edit[lastKey] = shiftTimelineDate(value,delta)
  } else return null
  const start = edit.start ?? first, end = edit[lastKey] ?? last
  if (start && end && +parsed(end) <= +parsed(start)) return null
  if (event) edit.allDay = Boolean(record.allDay)
  return edit
}

export function timelinePlanEdit(plan, mode, deltaDays) {
  const result = timelineDateEdit({...plan,kind:'event'},mode,deltaDays)
  return result ? {id:plan.id,start:result.start ?? plan.start,end:result.end ?? plan.end} : null
}

/** Keep the calendar day beneath the pointer at the same relative screen position. */
export function zoomTimelineRange(anchor, days, delta, pointerFraction=.5, pointerDay=days*pointerFraction) {
  const current = Math.max(1,Math.min(90,Math.round(days)))
  const factor = Math.exp(Math.max(-200,Math.min(200,delta))*.004)
  let next = Math.max(1,Math.min(90,Math.round(current*factor)))
  if (next === current && delta) next = Math.max(1,Math.min(90,current+Math.sign(delta)))
  const fraction = Math.max(0,Math.min(1,pointerFraction))
  const date = parsed(anchor); date.setHours(0,0,0,0)
  date.setDate(date.getDate()+Math.round(pointerDay-fraction*next))
  return {anchor:key(date),days:next}
}
