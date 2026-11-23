import { isClosed } from './planner.mjs'
const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const parse = value => value ? new Date(isDate(value) ? `${value}T00:00:00` : value) : new Date(NaN)
const midnight = value => new Date(value.getFullYear(), value.getMonth(), value.getDate())
const tomorrow = value => new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1)
const dayNumber = value => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000
/** Clock coordinates are injectable for hosts projecting a different local timezone. */
export const localCalendarClock = Object.freeze({parse, midnight, tomorrow, dayNumber, minute: value => value.getHours() * 60 + value.getMinutes()})

/** Native work dates are displayed, never converted into invented work sessions. */
export function calendarItem(record) { return calendarItemWithClock(record, localCalendarClock) }
export function calendarItemWithClock(record, clock) {
  const {parse, midnight, tomorrow, dayNumber} = clock
  if (!['event', 'task', 'card'].includes(record.kind)) return null
  const work = record.kind !== 'event'
  const first = parse(record.start), last = parse(work ? record.due : record.end)
  const hasStart = Number.isFinite(+first), hasEnd = Number.isFinite(+last)
  if (!hasStart && (!work || !hasEnd)) return null
  let start = hasStart ? first : last, end = hasEnd ? last : start
  if (+end < +start) { if (!work) return null; start = end }
  const point = work && (!hasStart || !hasEnd || +start === +end)
  const label = !work ? 'Event' : point ? hasEnd ? 'Due' : 'Starts' : record.kind === 'card' ? 'Card' : 'Task'
  const allDay = work
    ? isDate(hasStart ? record.start : record.due) || isDate(record.due) || dayNumber(start) !== dayNumber(end)
    : Boolean(record.allDay || isDate(record.start))
  if (allDay) {
    start = midnight(start)
    // Work deadlines include their due day. Calendar DTEND stays exclusive.
    end = work ? tomorrow(end) : hasEnd && +end > +start ? end : tomorrow(start)
  }
  return {id: record.id, record, start: +start, end: +end, allDay, point, label, planned: false}
}

/** Allocate a lane and clipped date-column bounds for one continuous item. */
export function calendarAllDayLayout(items, days, clock = localCalendarClock) {
  const {midnight, tomorrow, dayNumber} = clock
  if (!days.length) return {items: [], lanes: 0}
  const first = midnight(days[0]), last = tomorrow(days.at(-1))
  const entries = items.filter(item => item.allDay && item.start < +last && item.end > +first).map(item => ({
    ...item, first: Math.max(0, dayNumber(new Date(item.start)) - dayNumber(first)),
    last: Math.min(days.length, dayNumber(new Date(item.end - 1)) - dayNumber(first) + 1), lane: 0,
  })).sort((a, b) => a.first - b.first || b.last - a.last || a.record.title.localeCompare(b.record.title))
  const ends = []
  for (const item of entries) {
    let lane = ends.findIndex(end => end <= item.first)
    if (lane < 0) lane = ends.length
    ends[lane] = item.last; item.lane = lane
  }
  return {items: entries, lanes: ends.length}
}

/** Keep genuine plan sessions, but don't paint an exact native interval twice. */
export function calendarTimedItems(records, plans, native, clock = localCalendarClock) {
  native ||= records.map(record => calendarItemWithClock(record, clock)).filter(Boolean)
  const {parse} = clock
  const items = native.filter(item => !item.allDay)
  const byId = new Map(records.map(record => [record.id, record]))
  for (const plan of plans) {
    const record = byId.get(plan.recordId), start = +parse(plan.start), end = +parse(plan.end)
    if (!record || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    if (items.some(item => item.record.id === record.id && item.start === start && item.end === end)) continue
    items.push({id: plan.id, record, start, end, allDay: false, point: false, label: 'Work session', planned: true})
  }
  return items
}

/** Summarize the visible source data for one local calendar day. */
export function calendarDaySummary(records, date) {
  const start = +midnight(date), end = +tomorrow(date)
  if (!Number.isFinite(start)) return {events: 0, due: 0}
  let events = 0, due = 0
  for (const record of records) {
    if (record.kind === 'event') {
      const item = calendarItem(record)
      if (item && item.start < end && (item.end > start || item.end === item.start && item.start >= start)) events++
    } else if ((record.kind === 'task' || record.kind === 'card') && !isClosed(record)) {
      const deadline = +parse(record.due)
      if (deadline >= start && deadline < end) due++
    }
  }
  return {events, due}
}
