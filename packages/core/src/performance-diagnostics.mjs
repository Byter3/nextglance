// Opt-in, bounded operational evidence. Pick fields; never serialize caller objects.
export const DIAGNOSTIC_ENUMS = Object.freeze({
  kind: ['authorization', 'source', 'request', 'cache', 'projection', 'planner', 'restore', 'ui'],
  source: ['tasks', 'calendar', 'deck', 'notes', 'collectives', 'caldav', 'planner'],
  stage: ['start', 'finish', 'error', 'discovery', 'cache-read', 'cache-write', 'download', 'projection', 'local-cache', 'authorization', 'planner-read', 'planner-write', 'page', 'panel', 'frame', 'scroll', 'worker-ready', 'first-checkpoint', 'full-restore', 'publication'],
  page: ['overview', 'calendar', 'timeline', 'board', 'list', 'settings'],
  method: ['GET', 'HEAD', 'PROPFIND', 'REPORT', 'PUT', 'POST', 'DELETE', 'MKCOL'],
  code: ['AUTH', 'PERMISSION', 'CANCELLED', 'TIMEOUT', 'NETWORK', 'OFFLINE', 'LIMIT', 'FORMAT', 'VALIDATION', 'SECURITY', 'CONFLICT', 'PLANNER_OVERLAP', 'PLANNER_READ_CHANGED', 'PLANNER_WRITE_CHANGED', 'UNAVAILABLE', 'NEXTCLOUD', 'REDIRECT', 'CACHE_FORMAT', 'CACHE_READ_FAILED', 'CACHE_WRITE_FAILED', 'CACHE_WRITE', 'CACHE_UNREADABLE', 'METADATA_NOT_READY', 'PREVIEW_HOST', 'PREVIEW_SESSION_EXPIRED', 'RECONNECT_REQUIRED', 'UNKNOWN'],
})
export const DIAGNOSTIC_NUMBERS = Object.freeze(['durationMs', 'count', 'bytes', 'completed', 'total', 'cacheHits', 'cacheMisses', 'downloads', 'frames', 'maxDelayMs', 'status'])
export function sanitizeDiagnosticInput(value) {
  if (!value || typeof value !== 'object' || !DIAGNOSTIC_ENUMS.kind.includes(value.kind)) return null
  const result = {kind: value.kind}
  for (const [field, options] of Object.entries(DIAGNOSTIC_ENUMS)) if (options.includes(value[field])) result[field] = value[field]
  for (const field of DIAGNOSTIC_NUMBERS) if (typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] >= 0 && value[field] <= 1e12) result[field] = Math.round(value[field] * 100) / 100
  if (typeof value.success === 'boolean') result.success = value.success
  return result
}
export function createPerformanceDiagnostics({now = () => performance.now(), platform = 'unknown', appVersion = 'Development', canSaveFile = false} = {}) {
  let recording = false, start = 0, elapsed = 0, lastAt = 0, dropped = 0, stopReason, events = []
  const timestamp = () => lastAt = Math.max(lastAt, Math.min(600_000, Math.max(0, now() - start)))
  const stop = (reason = 'manual') => { if (recording) {elapsed = timestamp(); recording = false; stopReason = ['manual', 'duration', 'background', 'account-change'].includes(reason) ? reason : 'manual'}; return summary() }
  const summary = () => {
    if (recording && now() - start >= 600_000) {elapsed = 600_000; recording = false; stopReason = 'duration'}
    return {recording, elapsedMs: recording ? timestamp() : elapsed, eventCount: events.length, dropped, canSaveFile: Boolean(canSaveFile), ...(stopReason ? {stopReason} : {})}
  }
  const clear = () => {recording = false; start = 0; elapsed = 0; lastAt = 0; dropped = 0; stopReason = undefined; events = []; return summary()}
  const append = (safe, atMs) => {
    if (events.length >= 5000) {events.shift(); dropped++}
    events.push({atMs, ...safe})
  }
  return {
    start: () => {clear(); start = now(); recording = true; return summary()}, stop, clear, summary,
    record: value => {
      if (!summary().recording) return
      const safe = sanitizeDiagnosticInput(value)
      if (!safe) return
      append(safe, timestamp())
    },
    // Trusted transport adapter only. Public event input cannot set timestamps.
    recordAt: (value, relativeMs) => {
      if (!summary().recording || !Number.isFinite(relativeMs)) return
      const safe = sanitizeDiagnosticInput(value)
      if (!safe) return
      append(safe, Math.max(0, Math.min(timestamp(), relativeMs)))
    },
    // Trusted bounded transport accounting, never a public event field.
    recordDropped: count => {
      if (!summary().recording || !Number.isSafeInteger(count) || count < 0 || count > 5000) return
      dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + count)
    },
    read: () => JSON.stringify({format: 'nextglance-diagnostics', version: 1,
      appVersion: typeof appVersion === 'string' && /^(?:\d+\.\d+\.\d+|Development)$/.test(appVersion) ? appVersion : 'Development',
      platform: ['android', 'windows', 'preview', 'unknown'].includes(platform) ? platform : 'unknown',
      summary: summary(), events: events.map(event => ({...event})).sort((a, b) => a.atMs - b.atMs),
    }, null, 2),
  }
}
