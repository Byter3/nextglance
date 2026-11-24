const DAY = 86_400_000
export const DEFAULT_COMPLETED_DAYS = 14

export function normalizeCalendarHistoryDays(value) {
  return Number.isInteger(value) && value >= 0 && value <= 36_500 ? value : null
}

export function normalizeCompletedDays(value) {
  return value === null ? null : normalizeCalendarHistoryDays(value) ?? DEFAULT_COMPLETED_DAYS
}

export function normalizeCalendarWindow(value) {
  const {from, to} = value || {}
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= Date.parse('0001-01-01T00:00:00Z') && to <= Date.parse('9999-12-31T00:00:00Z') && to > from && to - from <= 120 * DAY ? {from, to} : null
}

export function paddedCalendarWindow(from, to) {
  return normalizeCalendarWindow({from:from - 7 * DAY,to:to + 7 * DAY}) ?? normalizeCalendarWindow({from,to})
}

export function workCompletionVisible(record, days, now, showCancelled = false) {
  if (record.kind === 'task' && String(record.status || '').toUpperCase() === 'CANCELLED') return showCancelled
  if (!['task', 'card'].includes(record.kind) || !record.completed) return true
  const retention = normalizeCompletedDays(days)
  if (retention === null) return true
  if (retention === 0) return false
  const completed = typeof record.completedAt === 'string' ? Date.parse(record.completedAt) : NaN
  return !Number.isFinite(completed) || completed >= now - retention * DAY
}
