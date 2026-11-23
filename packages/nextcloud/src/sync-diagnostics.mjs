/** Safe, portable sync diagnostics. Never persist arbitrary bridge error text. */
const codes = new Set(['AUTH', 'PERMISSION', 'NETWORK', 'TIMEOUT', 'LIMIT', 'FORMAT', 'NEXTCLOUD', 'UNAVAILABLE', 'REDIRECT', 'SECURITY', 'STORAGE', 'CONFLICT', 'PLANNER_OVERLAP', 'PLANNER_READ_CHANGED', 'PLANNER_WRITE_CHANGED', 'ETAG_UNAVAILABLE', 'STORAGE_LAYOUT', 'LEGACY_CHANGED', 'FOLDER_MISSING', 'FOLDER_CONFLICT', 'FOLDER_FORMAT', 'CACHE_UNREADABLE', 'CACHE_KEY', 'CACHE_GENERATION', 'CACHE_FORMAT', 'CACHE_LIMIT', 'CACHE_REMOVE_FAILED', 'METADATA_FORMAT'])
const stages = new Set(['authorization', 'discovery', 'source-read', 'planner-read', 'planner-write', 'local-cache'])
const readChanged = 'Nextcloud could not confirm a consistent version of the planner files during the read. Retry planner sync.'
const writeChanged = 'Nextcloud could not confirm the planner version for saving. Retry planner sync.'

export function syncDiagnostic(error, stage) {
  return {...(codes.has(error?.code) ? {errorCode: error.code} : {}), ...(stages.has(stage) ? {errorStage: stage} : {})}
}

export function plannerFailureMessage(error, stage) {
  const {errorCode} = syncDiagnostic(error, stage)
  const cause = {
    AUTH: 'Nextcloud authorization expired. Reconnect to sync planner changes.',
    PERMISSION: 'Nextcloud denied access to the planner folder. Check its permissions.',
    NETWORK: 'The planner request could not reach Nextcloud. Check the connection and retry.',
    TIMEOUT: 'The planner request timed out. Retry when the connection is available.',
    LIMIT: 'Planner sync exceeded a response or storage limit. Check the planner files before retrying.',
    FORMAT: 'Nextcloud returned an invalid planner response. Retry or inspect the planner files.',
    NEXTCLOUD: 'Nextcloud could not complete the planner request. Retry and check the server if it persists.',
    UNAVAILABLE: 'The Nextcloud planner storage endpoint is unavailable. Check the server before retrying.',
    REDIRECT: 'Nextcloud redirected the planner request. Check the account server address.',
    SECURITY: 'The planner request failed a security check. Check the server address and connection.',
    STORAGE: 'Nextcloud has insufficient storage for planner changes. Free server space and retry.',
    CONFLICT: stage === 'planner-write' ? writeChanged : readChanged,
    PLANNER_OVERLAP: 'Saved changes on this device and in Nextcloud overlap. Review them in Settings before syncing.',
    PLANNER_READ_CHANGED: readChanged,
    PLANNER_WRITE_CHANGED: writeChanged,
    ETAG_UNAVAILABLE: 'Nextcloud did not provide a usable planner revision. No unsafe write was attempted.',
    STORAGE_LAYOUT: 'The planner folder layout is not supported. Check its files before retrying.',
    LEGACY_CHANGED: 'An older planner file changed during sync. Review the planner files before retrying.',
    FOLDER_MISSING: 'Previously synchronized planner files are missing. Restore them before retrying.',
    FOLDER_CONFLICT: 'The planner folder or its files need review in Nextcloud Files before retrying.',
    FOLDER_FORMAT: 'A planner file has an invalid format. Review the planner files before retrying.',
  }[errorCode]
  const message = errorCode?.startsWith('CACHE_') || errorCode === 'METADATA_FORMAT' || stage === 'local-cache'
    ? 'The device could not read or save its planner cache. Check available device storage and retry.'
    : cause || 'Planner sync could not finish. Retry; details are unavailable for this failure.'
  return `${message} Saved changes remain on this device.`
}
