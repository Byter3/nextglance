/** Only a workspace ID crosses IPC; the host resolves private DAV baselines. */
function createCalendarDeleteHandler({getContext, state}) {
  return async input => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'id') || typeof input.id !== 'string' || !input.id || input.id.length > 2048 || /[\u0000-\u001f]/.test(input.id)) throw new Error('Choose an available calendar event.')
    const {client, store, record, collection} = getContext(input.id)
    const result = await client.deleteEvent({id: record.id}, record, collection)
    if (result?.deleted !== true) throw new Error('Nextcloud did not confirm that this event was deleted. Refresh before trying again.')
    await store.updateCache(cache => {
      const id = store.resolveRecordId(record.id)
      const records = cache.records.filter(item => !(item.source === 'calendar' && (item.id === id || record.identity?.key && item.identity?.key === record.identity.key)))
      return {...cache, records, statuses: cache.statuses.map(status => status.source === 'calendar' ? {...status, count: records.filter(item => item.source === 'calendar').length} : status)}
    }, {purgeBackup: true})
    return state()
  }
}
module.exports = {createCalendarDeleteHandler}
