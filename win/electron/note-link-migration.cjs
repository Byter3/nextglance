/** Move old planner-only card/note references to native Deck file attachments.
 * A native acknowledgement is required before removing any custom intent.
 * Other source relationships and source files are never deleted here. */
function notePair(snapshot, relation, resolveId = id => id) {
  if (!['reference', 'related'].includes(relation?.type)) return null
  const records = snapshot.cache.records
  const from = records.find(record => record.id === resolveId(relation.fromId))
  const to = records.find(record => record.id === resolveId(relation.toId))
  const card = from?.source === 'deck' && from.kind === 'card' ? from : to?.source === 'deck' && to.kind === 'card' ? to : null
  const note = from?.source === 'notes' && from.kind === 'note' ? from : to?.source === 'notes' && to.kind === 'note' ? to : null
  if (!card || !note || card.remote?.nativeId == null || note.remote?.nativeId == null) return null
  return {card, note, key: JSON.stringify([String(card.remote.nativeId), String(note.remote.nativeId)])}
}

async function migrateDeckNoteLinks({store, attach, limit = 1}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5) throw new Error('Migrate between one and five native note links at a time.')
  const resolve = id => store.resolveRecordId(id)
  const snapshot = store.snapshot(), pending = new Map()
  for (const relation of snapshot.workspace.relations) {
    const pair = notePair(snapshot, relation, resolve)
    if (pair && !pending.has(pair.key)) pending.set(pair.key, {relation, ...pair})
  }
  let converted = 0
  const errors = []
  for (const candidate of [...pending.values()].slice(0, limit)) {
    // Resolve current IDs again after previous native/cache operations. A sync
    // can canonicalize application UUIDs while the native identities stay fixed.
    const current = store.snapshot()
    const pair = current.workspace.relations.map(relation => notePair(current, relation, resolve)).find(pair => pair?.key === candidate.key)
    if (!pair) continue
    try {
      const result = await attach(pair.card, pair.note)
      if (!result?.attachments?.some(item => String(item.fileId) === String(pair.note.remote.nativeId))) throw new Error('Deck has not confirmed the native note attachment yet.')
      converted += await store.exclusive(async () => {
        const latest = store.snapshot()
        const retained = latest.workspace.relations.filter(relation => notePair(latest, relation, resolve)?.key !== candidate.key)
        const removed = latest.workspace.relations.length - retained.length
        if (!removed) return 0
        latest.workspace.relations = retained
        latest.workspace.updatedAt = new Date().toISOString()
        latest.revision++
        latest.sync.status = latest.sync.baseHash ? 'pending' : 'local'
        latest.sync.message = 'Native Deck note links are saved. Planner metadata cleanup is waiting to sync.'
        await store.commit(latest)
        return removed
      })
    } catch (error) {
      let message = typeof error?.message === 'string' ? error.message : 'This note could not be attached in Deck. It will be retried after refresh.'
      if (['EACCES','EPERM','ENOSPC','ENOENT','EROFS','EIO'].includes(error?.code)) message = 'The local planner cleanup could not be saved. Existing data is preserved and conversion can be retried.'
      if (/authorization|basic [a-z0-9+/=]+|password[=:]|token[=:]/i.test(message)) message = 'Nextcloud could not complete native note linking. Check the connection before retrying.'
      errors.push({relationId: candidate.relation.id, message: message.slice(0, 1200)})
    }
  }
  const latest = store.snapshot()
  const remaining = latest.workspace.relations.filter(relation => notePair(latest, relation, resolve)).length
  return {converted, remaining, errors}
}

module.exports = {migrateDeckNoteLinks, notePair}
