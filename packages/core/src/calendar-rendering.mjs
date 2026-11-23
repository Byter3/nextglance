import {localCalendarClock} from './calendar-items.mjs'
/** Index each timed item into its intersecting local days once, then pack overlaps.
 * Points and exclusive midnight ends retain the calendar's existing semantics. */
export function calendarTimedLayout(items, days, {minimumMinutes = 27.5, minimumDuration = 0, clock = localCalendarClock} = {}) {
  const starts = days.map(Number), ends = days.map(day => +clock.tomorrow(day))
  const result = new Map(starts.map(start => [start, []]))
  for (const item of items) {
    let low = 0, high = ends.length
    while (low < high) {const middle = (low + high) >>> 1; if (ends[middle] <= item.start) low = middle + 1; else high = middle}
    for (let index = low; index < starts.length && (starts[index] < item.end || item.end === item.start && starts[index] <= item.start); index++) {
      const first = starts[index], last = ends[index]
      if (!(item.start < last && (item.end > first || item.end === item.start && item.start >= first))) continue
      const a = new Date(Math.max(first, item.start)), z = new Date(Math.min(last, item.end))
      const from = clock.minute(a), to = +z === last ? 1440 : clock.minute(z)
      result.get(first).push({...item, from, to: Math.max(from + minimumDuration, to), lane: 0, lanes: 1})
    }
  }
  for (const blocks of result.values()) {
    blocks.sort((a, b) => a.from - b.from || b.to - a.to)
    let cluster = [], maximum = -1
    const arrange = () => {
      const ends = []
      for (const block of cluster) {let lane = ends.findIndex(end => end <= block.from); if (lane < 0) lane = ends.length; ends[lane] = Math.max(block.to, block.from + minimumMinutes); block.lane = lane}
      for (const block of cluster) block.lanes = Math.max(1, ends.length)
    }
    for (const block of blocks) {if (block.from >= maximum && cluster.length) {arrange(); cluster = []} cluster.push(block); maximum = Math.max(maximum, block.to, block.from + minimumMinutes)}
    arrange()
  }
  return result
}

/** Render controls near the viewport without changing buffered date geometry. */
export function calendarDateWindow({first, last, days}, overscan = 1) {
  const count = Number.isInteger(days) && days > 0 ? days : 0
  const start = Math.max(0, Math.min(count, Number.isFinite(first) ? Math.floor(first) : 0))
  const end = Number.isFinite(last) && last > start ? Math.min(count, Math.ceil(last)) : Math.min(count, start + 7)
  return {first: Math.max(0, start - overscan), last: Math.min(count, end + overscan)}
}

/** 28px information rows, 3px gaps and 3px top/bottom padding. */
export function calendarLaneWindow({scrollTop, viewportHeight, lanes}, overscan = 2) {
  const count = Number.isInteger(lanes) && lanes > 0 ? lanes : 0
  const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0)
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 160
  return {first: Math.min(count, Math.max(0, Math.floor((top - 3) / 31) - overscan)), last: Math.min(count, Math.max(0, Math.ceil((top + height - 3) / 31) + overscan))}
}
