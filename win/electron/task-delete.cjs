const {removeConfirmedRecord} = require('./native-delete-cache.cjs')

const fields = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key))
const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value)
const sameAccount = (active, expected) => active?.connected === true && active.serverUrl === expected.serverUrl && active.username === expected.username

function createTaskDeleteHandler({getContext, getAccount, isCurrent, state}) {
  return async input => {
    if (!fields(input, ['id', 'etag', 'expectedAccount']) || !text(input.id, 2048) || !text(input.etag, 1000)) throw new Error('Choose an available task and review its current version.')
    const {id, etag, expectedAccount} = input
    if (!fields(expectedAccount, ['serverUrl', 'username']) || !text(expectedAccount.serverUrl, 4096) || !text(expectedAccount.username, 512) || !sameAccount(getAccount(), expectedAccount)) throw new Error('The signed-in account changed. Open and review the task again.')
    const context = getContext(id)
    const {client, store, record, collection} = context
    if (etag !== record.etag) throw new Error('This task changed. Refresh and review it before deleting.')
    const result = await client.deleteTask({id: record.id, etag}, record, collection)
    if (!isCurrent(context) || !sameAccount(getAccount(), expectedAccount)) throw new Error('The signed-in account changed. Refresh the task list to see the current items.')
    if (result?.deleted !== true) throw new Error('Nextcloud did not confirm that this task was deleted. Refresh before trying again.')
    await removeConfirmedRecord(store, record, collection)
    return state()
  }
}

module.exports = {createTaskDeleteHandler}
