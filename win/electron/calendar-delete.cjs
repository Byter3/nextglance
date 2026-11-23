const {removeConfirmedRecord} = require('./native-delete-cache.cjs')

/** Only a workspace ID crosses IPC; the host resolves private DAV baselines. */
function createCalendarDeleteHandler({getContext, state}) {
  return async input => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'id') || typeof input.id !== 'string' || !input.id || input.id.length > 2048 || /[\u0000-\u001f]/.test(input.id)) throw new Error('Choose an available calendar event.')
    const {client, store, record, collection} = getContext(input.id)
    const result = await client.deleteEvent({id: record.id}, record, collection)
    if (result?.deleted !== true) throw new Error('Nextcloud did not confirm that this event was deleted. Refresh before trying again.')
    await removeConfirmedRecord(store, record, collection)
    return state()
  }
}
module.exports = {createCalendarDeleteHandler}
