/** Validated read history is useful for rendering/cadence, never authorization. */
export function restoreSourceStatuses(statuses = [], records = []) {
  const counts = new Map()
  for (const record of records) counts.set(record.source, (counts.get(record.source) || 0) + 1)
  return statuses.map(status => {
    const validSuccess = typeof status.lastSyncedAt === 'string' && Number.isFinite(Date.parse(status.lastSyncedAt))
    const legacySaved = status.state === 'unavailable' && validSuccess && !status.errorCode && !status.errorStage &&
      !status.permissionDenied && !status.revokedCollectionIds?.length && status.message === 'Saved on this device · checking for updates.'
    const state = legacySaved ? 'connected' : status.state === 'connected' && !validSuccess ? 'unavailable' : status.state
    return {...status, state, count: status.permissionDenied ? 0 : counts.get(status.source) || 0, cached:true,
      ...(state === 'connected' ? {message:'Saved on this device.'} : {})}
  })
}

export function hasSavedSourceRead(statuses = []) {
  return statuses.some(status => status.cached === true && status.state === 'connected' && !status.permissionDenied &&
    typeof status.lastSyncedAt === 'string' && Number.isFinite(Date.parse(status.lastSyncedAt)))
}

export function sourceReadLabel(status) {
  return status?.cached && status.state === 'connected' ? 'Saved' : status?.state || 'unavailable'
}

/** Shared cloud presentation, separate from source permission and content age. */
export function syncPresentationState({authorized=false, networkOnline=true, connected=true, hasSavedData=false,
  active=false, hasError=false, stale=false, pending=false} = {}) {
  if (!authorized || !networkOnline) return 'offline'
  if (active) return 'syncing'
  if (hasError) return 'error'
  if (!connected) return hasSavedData ? 'saved' : 'pending'
  if (stale) return 'stale'
  return pending ? 'pending' : 'synced'
}
