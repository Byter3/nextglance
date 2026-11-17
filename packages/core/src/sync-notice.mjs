const sourceNames = {tasks:'Tasks', calendar:'Calendar', deck:'Deck', notes:'Notes', collectives:'Collectives'}
const notice = (kind, message, action, actionLabel, tone='warning') => ({kind, tone, message, action, actionLabel})

/** Recovery requiring a user decision stays prominent. Routine retries and
 * freshness belong to the always-accessible cloud indicator. */
export function syncNoticePresentation(value) {
  if (!value) return 'none'
  return value.action === 'reconnect' || value.action === 'details' ? 'banner' : 'indicator'
}

/** A concise summary of observed state, never a diagnosis inferred from prose.
 * Detailed safe connector messages remain available in the connection panel. */
export function syncNotice({connection, storage={}, statuses=[], networkOnline=true, refreshing=false, syncing=false}={}) {
  if (!connection || !(connection.connected || connection.serverUrl && connection.username)) return null
  const failures = statuses.filter(status => status.state === 'error' && status.errorCode !== 'CANCELLED')
  const plannerFailed = ['error','conflict'].includes(storage.syncStatus) && storage.errorCode !== 'CANCELLED'
  if (connection.reconnectRequired || connection.recoveryOnly || failures.some(status=>status.errorCode==='AUTH') || plannerFailed && storage.errorCode==='AUTH')
    return notice('connection', 'Nextcloud authorization needs to be renewed.', 'reconnect', 'Reconnect')
  if (plannerFailed) {
    if (storage.syncStatus==='conflict' || ['CONFLICT','FOLDER_CONFLICT'].includes(storage.errorCode))
      return notice('planner', 'Planner sync has a conflict. Local changes are preserved.', 'details', 'Review')
    if (storage.errorCode==='PERMISSION')
      return notice('planner', 'Planner files could not be accessed. Review permissions.', 'details', 'Review')
    if (storage.errorStage==='local-cache' || storage.errorCode?.startsWith('CACHE_'))
      return notice('planner', 'Local planner storage needs attention.', 'details', 'Review')
  }
  if (failures.some(status=>status.errorCode==='PERMISSION'))
    return notice('source', 'Source access needs review. Review permissions.', 'details', 'Review')
  if (failures.some(status=>status.errorStage==='local-cache'||status.errorCode?.startsWith('CACHE_')))
    return notice('source', 'Local source storage needs attention.', 'details', 'Review')
  if (plannerFailed) {
    const cause=storage.errorCode==='TIMEOUT'?'Planner sync timed out.':storage.errorCode==='NETWORK'?'Planner sync could not connect.':'Planner sync needs attention.'
    return notice('planner', `${cause} Local changes are preserved.${syncing?' Retrying…':''}`, syncing||!networkOnline?null:'retry-planner', syncing||!networkOnline?null:'Retry sync')
  }
  if (failures.length) {
    const names=failures.length<=2?failures.map(status=>sourceNames[status.source]||'Source').join(' and '):`${failures.length} sources`
    const code=failures.every(status=>status.errorCode===failures[0].errorCode)?failures[0].errorCode:undefined
    const cause=code==='LIMIT'?'are incomplete: scan limit reached.':code==='TIMEOUT'?'refresh timed out.':code==='NETWORK'?'could not connect.':code==='PERMISSION'?'access needs review.':'could not fully refresh.'
    const text=failures.length===1&&code==='LIMIT'?`${names} is incomplete: scan limit reached.`:`${names} ${cause}`
    const review=code==='PERMISSION'
    return notice('source', `${text}${refreshing?' Retrying…':''}`, review?'details':refreshing||!networkOnline?null:'retry-sources', review?'Review':refreshing||!networkOnline?null:'Retry')
  }
  if (!networkOnline) return notice('connection', 'Offline. Loaded items remain available.', null, null)
  if (refreshing) return null
  if (!connection.connected) return notice('source', 'Source data has not been checked yet.', 'retry-sources', 'Refresh', 'info')
  return null
}
