/** Stable, portable presentation order. Native dates, statuses and links are never mutated. */
const own = (value, key) => Object.hasOwn(value, key)
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
export const safeArrangementId = value => typeof value === 'string' && Boolean(value.trim()) && value.length <= 2048 && !value.includes('\0') && !['__proto__', 'prototype', 'constructor'].includes(value)
const uniqueIds = ids => [...new Set((Array.isArray(ids) ? ids : []).filter(safeArrangementId))].slice(0, 5000)
const modes = new Set(['source', 'deck', 'mapped', 'planning'])
export function boardOrderKey(mode, boardId, columnId) {
  if (!modes.has(mode) || !safeArrangementId(columnId) || (mode === 'deck' ? !safeArrangementId(boardId) : boardId !== '')) throw new Error('Invalid board order key')
  const key = JSON.stringify([mode, boardId, columnId])
  if (!safeArrangementId(key)) throw new Error('Invalid board order key')
  return key
}
export function validBoardOrderKey(key) {
  if (!safeArrangementId(key)) return false
  try { const values = JSON.parse(key); return Array.isArray(values) && values.length === 3 && boardOrderKey(...values) === key } catch { return false }
}
/** Only known bounded fields survive local normalization. Strict cloud validation is separate. */
export function normalizeArrangements(input) {
  if (!plain(input)) return undefined
  return Object.fromEntries(Object.entries(input).filter(([id, value]) => safeArrangementId(id) && plain(value)).slice(0, 2500).map(([id, value]) => [id, {
    ...(Array.isArray(value.timelineRows) ? {timelineRows: uniqueIds(value.timelineRows)} : {}),
    ...(Array.isArray(value.timelineGroups) ? {timelineGroups: uniqueIds(value.timelineGroups)} : {}),
    ...(plain(value.boardCards) ? {boardCards: Object.fromEntries(Object.entries(value.boardCards).filter(([key, ids]) => validBoardOrderKey(key) && Array.isArray(ids)).slice(0, 2500).map(([key, ids]) => [key, uniqueIds(ids)]))} : {}),
  }]))
}
export function remapArrangements(input, target) {
  if (!plain(input)) return input
  return Object.fromEntries(Object.entries(input).map(([scope, value]) => [scope, {...value,
    ...(Array.isArray(value.timelineRows) ? {timelineRows: [...new Set(value.timelineRows.map(target))]} : {}),
    ...(plain(value.boardCards) ? {boardCards: Object.fromEntries(Object.entries(value.boardCards).map(([key, ids]) => [key, [...new Set(ids.map(target))]]))} : {}),
  }]))
}
function date(value) {
  if (typeof value !== 'string' || !value) return Infinity
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return Infinity
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value)
  if (match) {
    const year = +match[1], month = +match[2], day = +match[3], check = new Date(0)
    check.setUTCFullYear(year, month - 1, day); check.setUTCHours(0, 0, 0, 0)
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return Infinity
  }
  return parsed
}
const compareText = (a, b) => String(a ?? '') < String(b ?? '') ? -1 : String(a ?? '') > String(b ?? '') ? 1 : 0
function comparator(records) {
  const values = new Map(records.map(record => {
    const start = date(record.start), due = date(record.due), end = due === Infinity ? date(record.end) : due
    return [record, [start === Infinity ? end : start, end === Infinity ? start : end]]
  }))
  return (a, b) => {
    const left = values.get(a), right = values.get(b)
    return (left[0] === right[0] ? 0 : left[0] < right[0] ? -1 : 1) || (left[1] === right[1] ? 0 : left[1] < right[1] ? -1 : 1) || compareText(a.title ?? a.name, b.title ?? b.name) || compareText(a.id, b.id)
  }
}
function manualOrder(values, manualIds) {
  const rank = new Map(uniqueIds(manualIds).map((id, index) => [id, index]))
  return values.map((value, index) => ({value, index})).sort((a, b) => (rank.get(a.value.id) ?? Infinity) - (rank.get(b.value.id) ?? Infinity) || a.index - b.index).map(({value}) => value)
}
export function orderBoardRecords(records, manualIds = []) { return manualOrder([...records].sort(comparator(records)), manualIds) }
const work = record => record.kind === 'task' || record.kind === 'card'
export function buildLinkIndex(relations = []) {
  const result = new Map()
  for (const {fromId, toId} of relations) {
    if (!safeArrangementId(fromId) || !safeArrangementId(toId) || fromId === toId) continue
    for (const [a, b] of [[fromId, toId], [toId, fromId]]) { if (!result.has(a)) result.set(a, new Set()); result.get(a).add(b) }
  }
  return result
}
/** Primary interaction always wins over being somebody else's linked peer. */
export function boardHighlightState(index, activeIds = []) {
  const primary = new Set(activeIds.filter(safeArrangementId)), linked = new Set()
  for (const id of primary) for (const peer of index.get(id) || []) if (!primary.has(peer)) linked.add(peer)
  return {primary, linked}
}
/** Native move permission is supplied by the existing source capability projection. */
export function boardColumnDropAllowed({mode, currentColumnId, columnId, canMove, statusTargetCount = 0}) {
  if (!canMove || !safeArrangementId(columnId) || currentColumnId === columnId) return false
  if (mode === 'deck') return true
  if (mode === 'planning') return ['inbox','planned','doing','done'].includes(columnId)
  return mode === 'mapped' && Number.isInteger(statusTargetCount) && statusTargetCount > 0
}
export function orderTimelineRecords(records, relations = [], manualIds = []) {
  const compare = comparator(records), sorted = [...records].sort(compare), byId = new Map(sorted.map(record => [record.id, record]))
  const relevant = relations.filter(edge => ['depends_on', 'reference', 'related'].includes(edge.type) && work(byId.get(edge.fromId) || {}) && work(byId.get(edge.toId) || {}))
  const links = buildLinkIndex(relevant), seen = new Set(), result = []
  const rank = new Map(sorted.map((record, index) => [record.id, index])), prerequisites = new Map(), dependents = new Map()
  for (const edge of relevant) if (edge.type === 'depends_on' && edge.fromId !== edge.toId) {
    if (!prerequisites.has(edge.fromId)) prerequisites.set(edge.fromId, new Set())
    if (!dependents.has(edge.toId)) dependents.set(edge.toId, new Set())
    prerequisites.get(edge.fromId).add(edge.toId); dependents.get(edge.toId).add(edge.fromId)
  }
  for (const record of sorted) {
    if (seen.has(record.id)) continue
    const members = [], pending = [record.id]
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const id = pending[cursor]
      if (seen.has(id)) continue
      seen.add(id); members.push(byId.get(id))
      for (const neighbor of links.get(id) || []) if (!seen.has(neighbor)) pending.push(neighbor)
    }
    const chronological = members.sort(compare), emitted = new Set(), waiting = new Map(), ready = []
    for (const member of members) {
      const count = prerequisites.get(member.id)?.size || 0; waiting.set(member.id, count)
      if (!count) heapPush(ready, rank.get(member.id))
    }
    let fallback = 0
    while (emitted.size < members.length) {
      while (fallback < chronological.length && emitted.has(chronological[fallback].id)) fallback++
      // Heap priority keeps chronological ties without rescanning every remaining row.
      const next = ready.length ? sorted[heapPop(ready)] : chronological[fallback]
      if (emitted.has(next.id)) continue
      result.push(next); emitted.add(next.id)
      for (const id of dependents.get(next.id) || []) {
        waiting.set(id, waiting.get(id) - 1)
        if (!waiting.get(id) && !emitted.has(id)) heapPush(ready, rank.get(id))
      }
    }
  }
  return manualOrder(result, manualIds)
}
function heapPush(heap, value) {
  let index = heap.length; heap.push(value)
  while (index) { const parent = (index - 1) >> 1; if (heap[parent] <= value) break; heap[index] = heap[parent]; index = parent }
  heap[index] = value
}
function heapPop(heap) {
  const first = heap[0], value = heap.pop()
  if (!heap.length) return first
  let index = 0
  while (index * 2 + 1 < heap.length) {
    const left = index * 2 + 1, right = left + 1, next = right < heap.length && heap[right] < heap[left] ? right : left
    if (heap[next] >= value) break
    heap[index] = heap[next]; index = next
  }
  heap[index] = value; return first
}
export function orderTimelineGroups(groups, manualIds = []) {
  const copied = groups.map(group => ({...group, ...(Array.isArray(group.children) ? {children: orderTimelineGroups(group.children, manualIds)} : {})}))
  const earliest = group => {
    const members = [...(group.records || []), ...(group.children || []).map(earliest).filter(Boolean)]
    return members.length ? orderBoardRecords(members)[0] : undefined
  }
  const proxies = copied.map(group => ({...(earliest(group) || {}), id: group.id, title: group.name ?? group.title}))
  const compare = comparator(proxies), lookup = new Map(copied.map((group, index) => [group, proxies[index]]))
  return manualOrder(copied.sort((a, b) => compare(lookup.get(a), lookup.get(b))), manualIds)
}
export function reorderIds(savedIds, visibleIds, draggedId, targetId, placement = 'before') {
  const saved = uniqueIds(savedIds), visible = uniqueIds(visibleIds)
  if (!['before', 'after'].includes(placement) || draggedId === targetId || !visible.includes(draggedId) || !visible.includes(targetId)) return saved
  const combined = [...new Set([...saved, ...visible])]
  if (combined.length > 5000) return saved // Never evict filtered/unavailable saved positions to fit a new row.
  const result = combined.filter(id => id !== draggedId)
  result.splice(result.indexOf(targetId) + (placement === 'after' ? 1 : 0), 0, draggedId)
  return result
}
export function boardTaskStacks(records, relations = []) {
  const byId = new Map(records.map(record => [record.id, record])), cards = orderBoardRecords(records.filter(record => record.kind === 'card' && record.source === 'deck'))
  const links = new Map(), parentByTask = {}, byCard = {}
  for (const edge of relations) {
    if (edge.type !== 'depends_on') continue
    const from = byId.get(edge.fromId), to = byId.get(edge.toId)
    const card = from?.kind === 'card' && from.source === 'deck' && to?.kind === 'task' ? from : to?.kind === 'card' && to.source === 'deck' && from?.kind === 'task' ? to : null
    if (!card) continue
    const task = card === from ? to : from, direction = card === from ? 'incoming' : 'outgoing'
    if (!safeArrangementId(task.id) || !safeArrangementId(card.id)) continue
    if (!links.has(card.id)) links.set(card.id, new Map())
    const existing = links.get(card.id).get(task.id)
    if (!existing || direction === 'incoming') links.get(card.id).set(task.id, {task, direction})
  }
  for (const card of cards) for (const {task, direction} of links.get(card.id)?.values() || []) {
    if (own(parentByTask, task.id)) continue
    parentByTask[task.id] = card.id
    byCard[card.id] ||= {incoming: [], outgoing: []}; byCard[card.id][direction].push(task)
  }
  for (const stack of Object.values(byCard)) { stack.incoming = orderBoardRecords(stack.incoming); stack.outgoing = orderBoardRecords(stack.outgoing) }
  return {parentByTask, byCard}
}
/** Input geometry only: adapters own pointer capture and cancellation, never order rules. */
export function listReorderTarget(rects, group, id, y, x) {
  const siblings = rects.filter(rect => rect.group === group && Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && rect.bottom >= rect.top)
  if (!Number.isFinite(y) || !siblings.some(rect => rect.id === id) || y < Math.min(...siblings.map(rect => rect.top)) || y > Math.max(...siblings.map(rect => rect.bottom))) return null
  const horizontal = siblings.filter(rect => Number.isFinite(rect.left) && Number.isFinite(rect.right) && rect.right >= rect.left)
  if (Number.isFinite(x) && horizontal.length && (x < Math.min(...horizontal.map(rect => rect.left)) || x > Math.max(...horizontal.map(rect => rect.right)))) return null
  const targets = siblings.filter(rect => rect.id !== id).sort((a, b) => a.top - b.top || compareText(a.id, b.id))
  const target = targets.find(rect => y < (rect.top + rect.bottom) / 2) || targets.at(-1)
  return target ? {targetId: target.id, placement: y < (target.top + target.bottom) / 2 ? 'before' : 'after'} : null
}
export function listReorderPhase({pointerType, elapsed, distance}) {
  return pointerType === 'touch' ? distance > 8 && elapsed < 500 ? 'pan' : elapsed >= 500 ? 'active' : 'pending' : distance > 3 ? 'active' : 'pending'
}
