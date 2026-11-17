/** Presentation geometry only: complete linked stacks remain the indivisible unit. */
export function boardStackLayout(ids, heights = {}, estimate = 180, gap = 8) {
  estimate = Number.isFinite(estimate) && estimate > 0 ? estimate : 180
  gap = Number.isFinite(gap) && gap >= 0 ? gap : 8
  let top = 0
  const items = ids.map((id, index) => {
    const measured = heights[id]
    const height = Number.isFinite(measured) && measured > 0 ? measured : estimate
    const item = { id, index, top, height, bottom: top + height }
    top = item.bottom + gap
    return item
  })
  return { items, totalHeight: Math.max(0, top - (items.length ? gap : 0)) }
}

export function boardStackWindow(layout, { top = 0, height = 640, overscan = 360, retainIds = [] } = {}) {
  top = Number.isFinite(top) ? top : 0
  height = Number.isFinite(height) && height > 0 ? height : 640
  overscan = Number.isFinite(overscan) && overscan >= 0 ? overscan : 360
  const from = Math.max(0, top - overscan), to = top + height + overscan
  const retained = new Set(retainIds), result = []
  // Sorted geometry permits bounded selection; retention does not reorder rows.
  let low = 0, high = layout.items.length
  while (low < high) { const mid = (low + high) >>> 1; if (layout.items[mid].bottom <= from) low = mid + 1; else high = mid }
  const visible = new Set()
  for (let i = low; i < layout.items.length && layout.items[i].top < to; i++) visible.add(i)
  if (retained.size) for (const item of layout.items) if (retained.has(item.id)) visible.add(item.index)
  for (const index of [...visible].sort((a, b) => a - b)) result.push(layout.items[index])
  return result
}

export function boardAnchorAdjustment(before, after, top) {
  const anchor = before.items.find(item => item.bottom > top)
  const next = anchor && after.items.find(item => item.id === anchor.id)
  return next ? next.top - anchor.top : 0
}

export function boardEdgeScroll(position, start, end, edge = 48, speed = 16) {
  if (![position, start, end].every(Number.isFinite) || end <= start || position < start || position > end) return 0
  edge = Math.min(edge, (end - start) / 2)
  if (position < start + edge) return -speed * (1 - (position - start) / edge)
  if (position > end - edge) return speed * (1 - (end - position) / edge)
  return 0
}
