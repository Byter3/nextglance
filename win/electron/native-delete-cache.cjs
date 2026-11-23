/** Commit a confirmed native deletion without touching planner links or receipts. */
function removeConfirmedRecord(store, record, collection) {
  return store.updateCache(cache => {
    const id = store.resolveRecordId(record.id)
    const belongsToSource = item => item.source === record.source
    const records = cache.records.filter(item => !(belongsToSource(item) && (item.id === id || record.identity?.key && item.identity?.key === record.identity.key)))
    const count = records.filter(belongsToSource).length
    const statuses = cache.statuses.map(status => status.source === record.source ? {...status, count} : status)
    const checkpoint = cache.davCheckpoint
    const href = collection?.remote?.href
    const davCheckpoint = href && Array.isArray(checkpoint?.collections) ? {...checkpoint, collections: checkpoint.collections.filter(entry => entry.href !== href)} : checkpoint
    return {...cache, records, statuses, ...(davCheckpoint ? {davCheckpoint} : {})}
  }, {purgeBackup: true})
}

module.exports = {removeConfirmedRecord}
