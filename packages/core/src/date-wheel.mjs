/** Only horizontal intent owns date navigation; ordinary vertical scrolling and
 * Ctrl+wheel remain with the row/hour/zoom surfaces. */
export function horizontalWheelDelta(event, pageSize = 800) {
  if (event.ctrlKey || event.metaKey) return 0
  const x = Number(event.deltaX) || 0, y = Number(event.deltaY) || 0
  const delta = event.shiftKey ? (Math.abs(x) > Math.abs(y) ? x : y) : Math.abs(x) > Math.abs(y) ? x : 0
  return delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1)
}

// With hidden overflow and reserved scrollbar gutters, scrollWidth-clientWidth
// can exceed Chromium's attainable offset. Probe and restore before any paint.
export function horizontalScrollLimit(element) {
  const previous = element.scrollLeft
  element.scrollLeft = element.scrollWidth
  const limit = element.scrollLeft
  element.scrollLeft = previous
  return limit
}

/** Scroll real overflow first, then accumulate the remaining motion into days.
 * Trackpads send many tiny events, so throttling individual events loses travel. */
export function createDateWheel() {
  let remainder = 0, lastTime = -Infinity, direction = 0
  return {
    reset() { remainder = 0; lastTime = -Infinity; direction = 0 },
    consume(delta, {scrollLeft = 0, maxScroll = 0, dayWidth = 100, now = Date.now()} = {}) {
      if (!Number.isFinite(delta) || !delta) return {scrollLeft, days: 0}
      if (now - lastTime > 250 || Math.sign(delta) !== direction) remainder = 0
      lastTime = now; direction = Math.sign(delta)
      const maximum = maxScroll > 1 ? maxScroll : 0
      const desired = Math.max(0, Math.min(maximum, scrollLeft)) + delta
      const left = Math.max(0, Math.min(maximum, desired))
      remainder += desired - left
      const width = Math.max(1, dayWidth)
      const days = Math.trunc(remainder / width) || 0
      remainder -= days * width
      return {scrollLeft: left, days}
    },
  }
}
