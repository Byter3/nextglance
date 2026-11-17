const parse = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
const midnight = value => { const date = parse(value); date.setHours(0, 0, 0, 0); return date }
const pad = value => String(value).padStart(2, '0')

/** Week-local wall-time coordinates, identical for pointer and keyboard edits. */
export function schedulePreviewBounds(anchor, slot) {
  const base = midnight(anchor), first = parse(slot?.start), last = parse(slot?.end)
  if (![base, first, last].every(date => Number.isFinite(+date))) return null
  const offset = date => (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(base.getFullYear(), base.getMonth(), base.getDate())) / 86400000 + (date.getHours() * 60 + date.getMinutes()) / 1440
  const start = offset(first), end = offset(last)
  return end > start ? { first: start, last: end } : null
}

/** Changes only a local draft. It never invokes source, planner or journal ports. */
export function shiftSchedulePreview(anchor, slot, mode, deltaDays) {
  const bounds = schedulePreviewBounds(anchor, slot)
  if (!bounds || !['move', 'start', 'end'].includes(mode) || !Number.isFinite(deltaDays)) return null
  const step = slot.allDay ? 1 : 1 / 96, delta = Math.round(deltaDays / step) * step
  let first = bounds.first, last = bounds.last
  if (mode === 'move') { first += delta; last += delta }
  else if (mode === 'start') first = Math.min(last - step, first + delta)
  else last = Math.max(first + step, last + delta)
  const format = offset => {
    const date = midnight(anchor)
    date.setMinutes(Math.round(offset * 1440))
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    return slot.allDay ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const result = { start: format(first), end: format(last), allDay: Boolean(slot.allDay) }
  // A missing spring-forward time can normalize past the other edge. Retain
  // the previous valid preview rather than displaying an inverted/collapsed
  // range. All-day durations are calendar days, not fixed 24-hour intervals.
  const normalized = schedulePreviewBounds(anchor, result)
  if (!normalized || normalized.last - normalized.first < step - 1e-10 || !slot.allDay && +parse(result.end) - +parse(result.start) < 15 * 60000) return null
  return result
}
