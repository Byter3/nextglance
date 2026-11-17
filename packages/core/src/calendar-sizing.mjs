/** Actual visible dates, excluding the sticky time gutter and render buffer. */
export function calendarViewportDays({scrollLeft, viewportWidth, gutter, dayWidth, days}) {
  const count = Number.isInteger(days) && days > 0 ? days : 0
  if (!count || !Number.isFinite(dayWidth) || dayWidth <= 0) return {first: 0, last: 0}
  const left = Math.max(0, Number.isFinite(scrollLeft) ? scrollLeft : 0)
  const width = Math.max(0, (Number.isFinite(viewportWidth) ? viewportWidth : 0) - (Number.isFinite(gutter) ? gutter : 0))
  const first = Math.min(count, Math.floor(left / dayWidth))
  return {first, last: width ? Math.min(count, Math.ceil((left + width) / dayWidth)) : first}
}

/** Repack visible spans without changing their original buffered coordinates. */
export function visibleAllDayLayout(items, first, last) {
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return {items: [], lanes: 0}
  const visible = items.filter(item => item.first < last && item.last > first).map(item => ({...item}))
    .sort((a, b) => a.first - b.first || b.last - a.last || a.record.title.localeCompare(b.record.title) || a.id.localeCompare(b.id))
  const ends = []
  for (const item of visible) {
    let lane = ends.findIndex(end => end <= item.first)
    if (lane < 0) lane = ends.length
    ends[lane] = item.last; item.lane = lane
  }
  return {items: visible, lanes: ends.length}
}

/** Shared automatic/manual allocation; available height excludes the date header/divider. */
export function calendarAllDaySize({lanes, availableHeight, manualHeight = null}) {
  const available = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0
  const count = Number.isInteger(lanes) && lanes > 0 ? lanes : 0
  const minimum = 24, maximum = Math.max(minimum, Math.min(320, available - 120))
  const autoMaximum = Math.max(minimum, Math.min(180, available * .4, maximum))
  const contentHeight = count ? count * 28 + (count - 1) * 3 + 6 : minimum
  const automaticHeight = Math.max(minimum, Math.min(autoMaximum, contentHeight))
  const automatic = typeof manualHeight !== 'number' || !Number.isFinite(manualHeight)
  return {height: automatic ? automaticHeight : Math.max(minimum, Math.min(maximum, manualHeight)), minimum, maximum, contentHeight, automaticHeight, automatic}
}
