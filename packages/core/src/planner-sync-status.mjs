/** Pure projection of planner-folder state, kept separate from native Sources. */
export function plannerSyncReady({connection, online = true, restoring = false, syncing = false, busy = false, protectedChanges = false} = {}) {
  return Boolean(connection?.serverUrl && connection?.username && !connection.reconnectRequired && !connection.recoveryOnly && online && !restoring && !syncing && !busy && !protectedChanges)
}

export function plannerSyncStatus({storage = {}, connection = {}, restoring = false, syncing = false, online = true, plannerVerifiedAt} = {}) {
  const common = {
    folder: typeof storage.remotePath === 'string' && storage.remotePath ? storage.remotePath : '/Workspace/Nextspace/',
    lastSyncedAt: typeof storage.lastSyncedAt === 'string' ? storage.lastSyncedAt : null,
    errorCode: typeof storage.errorCode === 'string' ? storage.errorCode : null,
    errorStage: typeof storage.errorStage === 'string' ? storage.errorStage : null,
  }
  const result = (state, label, message) => ({...common, state, label, message})
  if (restoring) return result('restoring', 'Restoring', 'Loading saved planner files on this device.')
  if (storage.syncStatus === 'conflict') return result('conflict', 'Conflict', storage.message || 'Planner changes overlap with another device. Local changes are preserved; review before retrying.')
  if (storage.syncStatus === 'error') return result('error', 'Needs attention', storage.message || 'Planner sync could not finish. Local changes are preserved; retry sync.')
  if (connection.reconnectRequired || connection.recoveryOnly) return result('authorization', 'Reconnect', 'Reconnect to Nextcloud to check planner files. Saved changes remain on this device.')
  if (!online) return result('offline', 'Offline', 'Showing saved planner data. Reconnect to check for changes.')
  if (syncing) return result('syncing', 'Syncing', 'Checking and synchronizing planner files with Nextcloud.')
  if (['pending', 'dirty'].includes(storage.syncStatus)) return result('pending', 'Pending', storage.message || 'Changes are saved on this device and waiting to sync.')
  // An abandoned/persisted syncing flag alone is not live activity.
  const independentlyVerified = typeof plannerVerifiedAt === 'string' && Number.isFinite(Date.parse(plannerVerifiedAt)) && plannerVerifiedAt === storage.lastSyncedAt
  if (storage.syncStatus === 'synced' && (connection.connected || independentlyVerified)) return result('synced', 'Synced', 'Planner files are up to date as of the last successful sync.')
  return result('local', 'Saved locally', storage.message || 'Saved planner data is available; cloud freshness has not been checked.')
}
