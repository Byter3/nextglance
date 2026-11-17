const dayPattern = /^\d{4}-\d{2}-\d{2}$/
const pad = value => String(value).padStart(2, '0')
export function creationDay(value) {
  const date = value instanceof Date ? value : new Date(dayPattern.test(value || '') ? `${value}T00:00:00` : value)
  return Number.isFinite(+date) ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : ''
}
export function creationLocalTime(value) {
  const date = value instanceof Date ? value : new Date(dayPattern.test(value || '') ? `${value}T00:00:00` : value)
  return Number.isFinite(+date) ? `${creationDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}` : ''
}
export function shiftCreationDay(value, offset) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  date.setDate(date.getDate() + offset)
  return creationDay(date)
}
function validDate(value, allDay) {
  if (!value || allDay && !dayPattern.test(value)) return null
  const date = new Date(allDay ? `${value}T00:00:00` : value)
  if (!Number.isFinite(+date) || creationDay(date) !== value.slice(0, 10)) return null
  return date
}
const work = kind => kind === 'task' || kind === 'card'

/** Convert editable work bounds back to the canonical selection used by other types. */
export function creationRangeFromInputs(kind, draft) {
  if (kind === 'note' || !draft.start && !draft.end) return undefined
  const first = draft.start ? validDate(draft.start, draft.allDay) : null
  const last = draft.end ? validDate(draft.end, draft.allDay) : null
  if (draft.start && !first || draft.end && !last) return undefined
  if (draft.allDay) {
    const start = draft.start || (work(kind) ? draft.end : shiftCreationDay(draft.end, -1))
    const end = draft.end ? work(kind) ? shiftCreationDay(draft.end, 1) : draft.end : shiftCreationDay(start, 1)
    return {start, end, allDay: true}
  }
  const start = first || new Date(+last - 3600000)
  const end = last || new Date(+first + 3600000)
  return {start: creationLocalTime(start), end: creationLocalTime(end), allDay: false}
}

/** Timeline ranges always have an exclusive end. Work deadlines include their day. */
export function creationDateInputs(range, kind = 'event', now = new Date()) {
  if (!range) {
    if (work(kind)) return {start: '', end: '', allDay: true}
    const day = creationDay(now)
    return {start: `${day}T09:00`, end: `${day}T10:00`, allDay: false}
  }
  if (range.allDay) {
    const start = creationDay(range.start)
    let end = creationDay(range.end)
    if (!end || end <= start) end = shiftCreationDay(start, 1)
    const final = work(kind) ? shiftCreationDay(end, -1) : end
    return {start: kind === 'task' && start === final ? '' : start, end: final, allDay: true}
  }
  return {start: creationLocalTime(range.start), end: creationLocalTime(range.end), allDay: false}
}

/** Preserve multi-day coverage and restore exact times after an unchanged round trip. */
export function convertCreationDateMode(draft, allDay, kind = 'event', previousTimed) {
  if (allDay === draft.allDay) return {...draft}
  if (allDay) {
    const start = draft.start ? creationDay(draft.start) : ''
    let end = draft.end ? creationDay(draft.end) : ''
    if (!work(kind) && end) {
      const final = validDate(draft.end, false)
      const isMidnight = final && final.getHours() === 0 && final.getMinutes() === 0 && final.getSeconds() === 0
      if (!isMidnight || end <= start) end = shiftCreationDay(end, 1)
    }
    return {start: kind === 'task' && start === end ? '' : start, end, allDay: true}
  }
  if (previousTimed) {
    const projected = convertCreationDateMode({...previousTimed, allDay: false}, true, kind)
    if (projected.start === draft.start && projected.end === draft.end) return {...previousTimed, allDay: false}
  }
  const start = draft.start ? `${draft.start.slice(0, 10)}T09:00` : ''
  const lastDay = draft.end ? work(kind) ? draft.end.slice(0, 10) : shiftCreationDay(draft.end, -1) : ''
  const end = lastDay ? `${lastDay}T${work(kind) ? '17:00' : '10:00'}` : ''
  return {start, end, allDay: false}
}

export function creationDatePayload(kind, draft) {
  if (kind === 'note') return {}
  const first = draft.start ? validDate(draft.start, draft.allDay) : null
  const last = draft.end ? validDate(draft.end, draft.allDay) : null
  if (draft.start && !first || draft.end && !last) throw new Error('Choose valid dates and times.')
  if (kind === 'event' && (!first || !last || last <= first)) throw new Error('Choose an end after the start. For all-day events, End is the first day after the event.')
  if (kind === 'task' && first && last && last <= first) throw new Error('A task deadline must be after its start. For a one-day date-only task, leave Start empty and use a deadline.')
  if (kind === 'card' && first && last && last < first) throw new Error('The deadline cannot be before the start.')
  const encode = (value, date) => draft.allDay ? value : date.toISOString()
  const dates = {...(first ? {start: encode(draft.start, first)} : {}), ...(last ? {[work(kind) ? 'due' : 'end']: encode(draft.end, last)} : {})}
  return kind === 'event' ? {...dates, allDay: draft.allDay} : dates
}
