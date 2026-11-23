export const DEFAULT_WEEKEND_MASK = (1 << 6) | 1

export function normalizeWeekendMask(value) {
  return Number.isInteger(value) && value >= 0 && value <= 127 ? value : DEFAULT_WEEKEND_MASK
}

const validWeekday = weekday => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6

export function isWeekendDay(mask, weekday) {
  return validWeekday(weekday) && Boolean(normalizeWeekendMask(mask) & (1 << weekday))
}

export function setWeekendDay(mask, weekday, enabled) {
  const current = normalizeWeekendMask(mask)
  if (!validWeekday(weekday) || typeof enabled !== 'boolean') return current
  const bit = 1 << weekday
  return enabled ? current | bit : current & ~bit
}

/** Classify an already displayed civil date independently of the host timezone. */
export function isWeekendDateKey(mask, key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const date = new Date(`${key}T12:00:00Z`)
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === key && isWeekendDay(mask, date.getUTCDay())
}
