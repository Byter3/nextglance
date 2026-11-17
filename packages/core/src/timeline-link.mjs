/** Finish-to-start connectors use row gutters when dates overlap or run backwards. */
export function timelineLinkPoints(x1, y1, x2, y2, rowHeight = 48) {
  if (![x1, y1, x2, y2, rowHeight].every(Number.isFinite) || rowHeight <= 0) return []
  const clearance = 18
  if (x2 - x1 >= clearance * 2) {
    const middle = (x1 + x2) / 2
    return [[x1, y1], [middle, y1], [middle, y2], [x2, y2]]
  }
  // Leave the predecessor on its right and approach the successor from its left.
  // The long horizontal return runs between rows, never through their centers.
  const gutter = y2 - (Math.sign(y2 - y1) || 1) * rowHeight / 2
  return [[x1, y1], [x1 + clearance, y1], [x1 + clearance, gutter], [x2 - clearance, gutter], [x2 - clearance, y2], [x2, y2]]
}

/** SVG rounded orthogonal route; coordinates remain exact at both item edges. */
export function timelineLinkPath(x1, y1, x2, y2, rowHeight = 48) {
  const points = timelineLinkPoints(x1, y1, x2, y2, rowHeight)
    .filter((point, index, all) => !index || point[0] !== all[index - 1][0] || point[1] !== all[index - 1][1])
  if (!points.length) return ''
  const value = number => Number(number.toFixed(3))
  const pair = point => `${value(point[0])} ${value(point[1])}`
  let path = `M ${pair(points[0])}`
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1], corner = points[index], next = points[index + 1]
    const before = Math.hypot(corner[0] - previous[0], corner[1] - previous[1])
    const after = Math.hypot(next[0] - corner[0], next[1] - corner[1])
    const radius = Math.min(7, before / 2, after / 2)
    const entry = corner.map((number, axis) => number + (previous[axis] - number) / before * radius)
    const exit = corner.map((number, axis) => number + (next[axis] - number) / after * radius)
    path += ` L ${pair(entry)} Q ${pair(corner)} ${pair(exit)}`
  }
  return `${path} L ${pair(points.at(-1))}`
}
