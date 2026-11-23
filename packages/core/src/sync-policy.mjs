export const SYNC_INTERVALS = Object.freeze([0, 15, 30, 60, 240])
const defaults = Object.freeze({caldavMinutes:60, deckMinutes:60, wifiOnly:false})
const groups = Object.freeze({caldav:['tasks','calendar'], deck:['deck'], other:['notes','collectives']})
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function normalizeSyncSettings(value) {
  return {
    caldavMinutes:SYNC_INTERVALS.includes(value?.caldavMinutes) ? value.caldavMinutes : defaults.caldavMinutes,
    deckMinutes:SYNC_INTERVALS.includes(value?.deckMinutes) ? value.deckMinutes : defaults.deckMinutes,
    wifiOnly:typeof value?.wifiOnly === 'boolean' ? value.wifiOnly : defaults.wifiOnly,
  }
}

export function validateSyncSettings(value) {
  if (!plain(value) || Object.keys(value).length !== 3 || !SYNC_INTERVALS.includes(value.caldavMinutes) || !SYNC_INTERVALS.includes(value.deckMinutes) || typeof value.wifiOnly !== 'boolean') {
    throw Object.assign(new Error('Choose a supported Calendar/Tasks and Deck sync interval and a Wi-Fi preference.'), {code:'VALIDATION'})
  }
  return {...value}
}

const instant = value => typeof value === 'number' ? value : Date.parse(value || '')
const successfulAt = (statuses, names) => {
  const stamps = names.map(name => instant(statuses?.find(status => status.source === name)?.lastSyncedAt))
  return stamps.every(Number.isFinite) ? Math.min(...stamps) : 0
}

/** Scheduling decisions use injected wall-clock time; no timers or UI imports. */
export function dueSyncSources(settings, statuses, lastAttempts, now, {includeOthers = true, independentAccessSources = []} = {}) {
  if (!Number.isFinite(now)) return []
  const normalized = normalizeSyncSettings(settings), result = []
  const independent = new Set(Array.isArray(independentAccessSources) ? independentAccessSources.filter(source => [...groups.caldav, ...groups.deck].includes(source)) : [])
  for (const [group, names] of Object.entries(groups)) {
    if (group === 'other' && !includeOthers) continue
    const minutes = group === 'other' ? 15 : normalized[`${group}Minutes`]
    if (!minutes) continue
    const attempted = instant(lastAttempts?.[group])
    const last = Math.max(successfulAt(statuses, names), Number.isFinite(attempted) ? attempted : 0)
    // Current permissions are checked separately by opted-in hosts. That check
    // does not make cached content fresh or force another body scan on open.
    const unverified = !Number.isFinite(attempted) && names.some(name => !independent.has(name) && statuses?.find(status => status.source === name)?.state === 'unavailable')
    // A backwards clock must not suppress checks indefinitely.
    if (unverified || !last || last > now || now - last >= minutes * 60_000) result.push(...names)
  }
  return result
}

export function sourceSyncStale(statuses, settings, now) {
  if (!Array.isArray(statuses) || !statuses.length || !Number.isFinite(now)) return true
  const normalized = normalizeSyncSettings(settings)
  return statuses.some(status => {
    if (status.state !== 'connected' || status.metadataStale) return true
    const group = Object.keys(groups).find(key => groups[key].includes(status.source))
    if (!group) return true
    const minutes = group === 'other' ? 15 : normalized[`${group}Minutes`]
    const last = instant(status.lastSyncedAt)
    if (!Number.isFinite(last) || last > now) return true
    return minutes === 0 ? false : now - last > (minutes + 2) * 60_000
  })
}
