import {shiftTimelineDate} from './timeline-edit.mjs'

const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const parse = value => new Date(isDate(value) ? `${value}T00:00:00` : value)

/** A calendar drag separates whole local days from snapped elapsed minutes.
 * This keeps the grabbed wall-clock hour across DST while retaining duration. */
export function calendarMoveEdit(record, days, minutes = 0) {
  if (!record || !['event', 'task', 'card'].includes(record.kind) || !Number.isInteger(days) || !Number.isFinite(minutes)) return null
  const minuteDelta = record.allDay ? 0 : Math.round(minutes / 15) * 15
  if (!days && !minuteDelta) return null
  const event = record.kind === 'event', lastKey = event ? 'end' : 'due'
  const first = record.start, last = record[lastKey]
  if (!first && !last || [first, last].some(value => value && !Number.isFinite(+parse(value)))) return null
  const shift = value => {
    const moved = shiftTimelineDate(value, days)
    return moved && !isDate(value) ? new Date(+parse(moved) + minuteDelta * 60000).toISOString() : moved
  }
  const edit = {id:record.id, ...(record.etag ? {etag:record.etag} : {})}
  if (first) edit.start = shift(first)
  if (last) edit[lastKey] = shift(last)
  if (first && last && !isDate(first) && !isDate(last) && !record.allDay) {
    const duration = +parse(last) - +parse(first)
    if (duration < 0) return null
    // An implicit instantaneous event must not acquire a zero-duration DTEND.
    if (event && duration === 0) delete edit.end
    else edit[lastKey] = new Date(+parse(edit.start) + duration).toISOString()
  }
  if (event) edit.allDay = Boolean(record.allDay || isDate(first))
  if (Object.entries(edit).every(([key, value]) => key === 'id' || key === 'etag' || key === 'allDay' || value === record[key])) return null
  return edit
}

export function calendarPlanMove(plan, days, minutes = 0) {
  const edit = calendarMoveEdit({...plan, kind:'event'}, days, minutes)
  return edit?.start && edit.end ? {id:plan.id,start:edit.start,end:edit.end} : null
}
