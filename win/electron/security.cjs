function safeUrl(raw, server = false) {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Enter a valid Nextcloud HTTPS address.')
  let url
  try { url = new URL(raw) } catch { throw new Error('Enter a valid Nextcloud HTTPS address.') }
  if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTPS address without embedded credentials.')
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('HTTPS is required except for a local test server.')
  if (server && (url.search || url.hash)) throw new Error('The server address must not contain a query or fragment.')
  return url
}

function trustedSender(event, webContents, entryUrl) {
  try {
    if (!webContents || event.sender !== webContents || event.senderFrame !== webContents.mainFrame) return false
    const actual = new URL(event.senderFrame.url), expected = new URL(entryUrl)
    return actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && actual.search === expected.search
  } catch { return false }
}

class LoginFlowRegistry {
  constructor({ now = () => Date.now() } = {}) { this.now = now; this.generation = 0; this.entries = new Map() }
  begin() { this.entries.clear(); return ++this.generation }
  publish(id, flow, generation) {
    if (generation !== this.generation) throw new Error('This sign-in request was cancelled or replaced.')
    const entry = { id, flow, generation, expires: this.now() + 10 * 60 * 1000, committing: false }
    this.entries.set(id, entry)
    return entry
  }
  get(id) {
    const entry = this.entries.get(id)
    this.assertCurrent(entry)
    return entry
  }
  assertCurrent(entry) {
    if (!entry || this.entries.get(entry.id) !== entry || entry.generation !== this.generation || entry.expires < this.now()) throw new Error('This sign-in request expired, was cancelled, or was replaced. Start sign-in again.')
  }
  beginCommit(entry) { this.assertCurrent(entry); entry.committing = true }
  cancel(id) {
    const entry = this.entries.get(id)
    // Once the encrypted credentials are being atomically committed, return the
    // resulting state instead of claiming that an already-finished login stopped.
    if (entry?.committing) return false
    this.entries.delete(id)
    return true
  }
  finish(entry) { if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id) }
}

function reconcileCache(before, incoming, sourceNames) {
  const statuses = sourceNames.map(source => incoming.statuses.find(status => status.source === source) || { source, state: 'error', count: 0, message: 'This source did not return a status.' })
  const successful = new Set(statuses.filter(status => status.state === 'connected' && status.permissionDenied !== true).map(status => status.source))
  const denied = new Set(statuses.filter(status => status.permissionDenied === true).map(status => status.source))
  const revoked = new Set(statuses.flatMap(status => Array.isArray(status.revokedCollectionIds) ? status.revokedCollectionIds : []))
  const retainRecord = record => !denied.has(record.source) && !revoked.has(record.collectionId)
  const retainCollection = collection => !denied.has(collection.source) && !revoked.has(collection.id)
  const recordKey = record => record.identity?.key ? `${record.source}\0${record.identity.key}` : record.id
  const records = new Map(before.records.filter(record => !successful.has(record.source) && retainRecord(record)).map(record => [recordKey(record), record]))
  const collections = new Map(before.collections.filter(collection => !successful.has(collection.source) && retainCollection(collection)).map(collection => [collection.id, collection]))
  for (const record of incoming.records) if (sourceNames.includes(record.source) && retainRecord(record)) records.set(recordKey(record), record)
  for (const collection of incoming.collections) if (sourceNames.includes(collection.source) && retainCollection(collection)) collections.set(collection.id, collection)
  for (const status of statuses) {
    status.count = [...records.values()].filter(record => record.source === status.source).length
    if (denied.has(status.source)) status.message = `${status.message || 'Access to this source was denied.'} Its cached content was removed from this device.`
    else if (!successful.has(status.source) && status.count) status.message = `${status.message || 'This source is unavailable.'} Showing ${status.count} available or cached items; editing waits for a successful refresh.`
  }
  const theme = Object.hasOwn(incoming, 'theme') ? incoming.theme : before.theme
  return { cache: { records: [...records.values()], collections: [...collections.values()], statuses, ...(Object.hasOwn(incoming, 'theme') || Object.hasOwn(before, 'theme') ? { theme } : {}) }, successful, purgeBackup: denied.size > 0 || revoked.size > 0 }
}

/** Do not replace an item edited/created locally while a refresh was in flight.
 * Explicit access revocation still wins over any cached or edited content. */
function reconcileRefreshedCache(before, current, incoming, sourceNames) {
  const result = reconcileCache(current, incoming, sourceNames)
  const key = record => record.identity?.key ? `${record.source}\0${record.identity.key}` : record.id
  const previous = new Map(before.records.map(record => [key(record), record]))
  const retained = new Set(current.records.map(key))
  const records = new Map(result.cache.records.map(record => [key(record), record]))
  // Confirmed deletion while this read was in flight wins over its stale rows,
  // including a changed canonical app UUID for the same native identity.
  for (const identity of previous.keys()) if (!retained.has(identity)) records.delete(identity)
  const denied = new Set(incoming.statuses.filter(status => status.permissionDenied === true).map(status => status.source))
  const revoked = new Set(incoming.statuses.flatMap(status => status.revokedCollectionIds || []))
  const allowed = item => !denied.has(item.source) && !revoked.has(item.collectionId || item.id)
  for (const record of current.records) {
    if (allowed(record) && JSON.stringify(previous.get(key(record))) !== JSON.stringify(record)) records.set(key(record), record)
  }
  const previousCollections = new Map(before.collections.map(item => [item.id, item]))
  const collections = new Map(result.cache.collections.map(item => [item.id, item]))
  for (const collection of current.collections) {
    if (allowed(collection) && JSON.stringify(previousCollections.get(collection.id)) !== JSON.stringify(collection)) collections.set(collection.id, collection)
  }
  result.cache.records = [...records.values()]; result.cache.collections = [...collections.values()]
  result.cache.statuses = result.cache.statuses.map(status => ({...status, count: result.cache.records.filter(record => record.source === status.source).length}))
  return result
}

module.exports = { safeUrl, trustedSender, LoginFlowRegistry, reconcileCache, reconcileRefreshedCache }
