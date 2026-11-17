/** Calendar-clock selection. Day fractions use local wall time, not 24-hour UTC
 * durations, so selecting across a daylight-saving change keeps the chosen days. */
export function creationSelection(anchor, from, to, {daysCount = 7, timed = false, dragged = false, origin = 'calendar', recordId} = {}) {
  const count = Math.max(1, Math.round(daysCount))
  const clamp = value => Math.max(0, Math.min(count, Number.isFinite(value) ? value : 0))
  const first = clamp(from), last = clamp(to)
  let startOffset, endOffset
  if (timed) {
    const step = 1 / 96
    const snap = value => Math.round(value / step) * step
    startOffset = Math.min(count - step, Math.max(0, dragged ? snap(Math.min(first, last)) : Math.floor(first / step) * step))
    endOffset = Math.min(count, dragged ? Math.max(startOffset + step, snap(Math.max(first, last))) : startOffset + 1 / 24)
  } else {
    const finish = dragged ? last : first
    startOffset = Math.min(count - 1, Math.floor(Math.min(first, finish)))
    endOffset = Math.min(count, Math.floor(Math.max(first, finish)) + 1)
  }
  const base = typeof anchor === 'string' ? new Date(`${anchor.slice(0, 10)}T00:00:00`) : new Date(anchor)
  base.setHours(0, 0, 0, 0)
  const format = offset => {
    const totalMinutes = Math.round(offset * 1440)
    const date = new Date(base)
    date.setDate(date.getDate() + Math.floor(totalMinutes / 1440))
    date.setMinutes(totalMinutes % 1440)
    const pad = value => String(value).padStart(2, '0')
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    return timed ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day
  }
  return {startOffset, endOffset, range: {start: format(startOffset), end: format(endOffset), allDay: !timed, origin, ...(recordId ? {recordId} : {})}}
}
