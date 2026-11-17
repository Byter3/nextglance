const fs = require('node:fs/promises')
const path = require('node:path')
const {createHash, randomUUID} = require('node:crypto')
const eventDetailsModule = import('@nextspace/core/event-details.mjs')
const eventSchedulingModule = import('@nextspace/core/event-scheduling.mjs')

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const clone = value => structuredClone(value)
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function text(value, label, limit, empty = false) {
  if (typeof value !== 'string' || !empty && !value.trim() || value.length > limit || value.includes('\0')) throw new Error(`${label} is missing or too long.`)
  return value
}
function normalize(input, normalizeEventDetails, normalizeEventAttendees) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw new Error('Choose a valid calendar scheduling request.')
  if (input.allDay !== undefined && typeof input.allDay !== 'boolean') throw new Error('Choose a valid event date mode.')
  const details = normalizeEventDetails(input, {requireTitle: true})
  const payload = {
    recordId: text(input.recordId, 'Task or card', 2048), title: details.title,
    collectionId: text(input.collectionId, 'Calendar', 2048), start: text(input.start, 'Event start', 80), end: text(input.end, 'Event end', 80),
    allDay: input.allDay ?? false, description: details.description ?? '',
    ...(details.location !== undefined ? {location: details.location} : {}),
    ...(details.reminders !== undefined ? {reminders: details.reminders} : {}),
    ...(input.attendees !== undefined ? {attendees:normalizeEventAttendees(input.attendees)} : {}),
  }
  return {requestId: input.requestId.toLowerCase(), payload}
}

/** A small account-local write journal makes native-event creation + local links resumable.
 * It is deliberately separate from the cloud-synced planner metadata and contains no credentials.
 * The desktop IPC queue serializes calls; native resources also use conditional deterministic PUTs.
 */
class CalendarScheduler {
  constructor({writeJson, readFile = fs.readFile}) { this.writeJson = writeJson; this.readFile = readFile; this.accounts = new WeakMap() }
  async load(store) {
    if (this.accounts.has(store)) return
    const {normalizeEventDetails} = await eventDetailsModule
    const {normalizeEventAttendees} = await eventSchedulingModule
    let journal = {schemaVersion: 1, requests: []}
    try {
      const raw = await this.readFile(path.join(store.directory, 'calendar-requests.json'), 'utf8')
      if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw new Error('Journal too large')
      journal = JSON.parse(raw)
      if (journal?.schemaVersion !== 1 || !Array.isArray(journal.requests) || journal.requests.length > 10000) throw new Error('Invalid journal')
      const ids = new Set()
      for (const entry of journal.requests) {
        if (!entry || !UUID.test(entry.requestId || '') || ids.has(entry.requestId) || !['pending', 'created', 'linked'].includes(entry.status) || !/^[a-f0-9]{64}$/.test(entry.digest || '')) throw new Error('Invalid journal entry')
        ids.add(entry.requestId)
        if (entry.status === 'linked') { text(entry.recordId, 'Task or card', 2048); text(entry.eventId, 'Event', 2048) }
        else {
          const normalized = normalize({...entry.payload, requestId: entry.requestId}, normalizeEventDetails, normalizeEventAttendees)
          if (digest(normalized.payload) !== entry.digest) throw new Error('Invalid pending request')
          if (entry.status === 'created') { text(entry.native?.href, 'Event resource', 4096); text(entry.native?.uid, 'Event identity', 2048) }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') { this.accounts.set(store, {error: true}); return }
    }
    this.accounts.set(store, {journal: clone(journal)})
  }
  pending(store) {
    const journal = this.accounts.get(store)?.journal
    return (journal?.requests || []).filter(entry => entry.status !== 'linked').map(entry => ({requestId: entry.requestId, ...clone(entry.payload), created: entry.status === 'created'}))
  }
  async persist(store, journal) {
    if (Buffer.byteLength(JSON.stringify(journal)) > 16 * 1024 * 1024) throw new Error('Calendar request history exceeds the local storage limit.')
    await this.writeJson(path.join(store.directory, 'calendar-requests.json'), journal, {backup: false})
    this.accounts.set(store, {journal: clone(journal)})
  }
  async create(input, {store, client, getCollection, validateInterval, state}) {
    const {normalizeEventDetails} = await eventDetailsModule
    const {normalizeEventAttendees} = await eventSchedulingModule
    const {requestId, payload} = normalize(input, normalizeEventDetails, normalizeEventAttendees)
    validateInterval(payload.start, payload.end, payload.allDay)
    await this.load(store)
    const account = this.accounts.get(store)
    if (account.error) throw new Error('Saved calendar requests could not be read. Scheduling is disabled to avoid creating duplicates. Existing files and source data were preserved.')
    let journal = clone(account.journal), entry = journal.requests.find(item => item.requestId === requestId)
    const fingerprint = digest(payload)
    if (entry && entry.digest !== fingerprint) throw new Error('This scheduling request has different details. Resume it with its original saved details.')
    if (entry?.status === 'linked') return state()
    const before = store.snapshot()
    const sourceId = store.resolveRecordId?.(payload.recordId) || payload.recordId
    const source = before.cache.records.find(record => record.id === sourceId)
    if (!source || !((source.source === 'tasks' && source.kind === 'task') || (source.source === 'deck' && source.kind === 'card'))) throw new Error('Choose an available task or Deck card from this account to schedule.')
    // Source items need only be readable: this operation edits the chosen calendar and planner links.
    const collection = getCollection(payload.collectionId)
    if (!collection || collection.source !== 'calendar' || collection.readonly || !collection.remote?.href) throw new Error('Choose a writable Nextcloud calendar.')
    if (!entry) {
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== before.revision) throw new Error('The planner changed. Refresh and reopen scheduling before creating the event.')
      if (journal.requests.some(item => item.status !== 'linked' && item.payload.recordId === payload.recordId)) throw new Error('This item already has an unfinished booking. Resume its saved scheduling request first.')
      if (journal.requests.length >= 10000) throw new Error('The local calendar request history is full. No event was created.')
      entry = {requestId, digest: fingerprint, status: 'pending', payload}
      journal.requests.push(entry)
      // Do not attempt a network mutation unless its retry identity is durable first.
      await this.persist(store, journal)
    }
    try {
      let record, verifiedCollection, creationWarning
      if (entry.status === 'pending') {
        const created = await client.createEvent({...payload, requestId}, collection)
        record = created.record
        verifiedCollection=created.verifiedCollection
        creationWarning=created.warning||created.record?.creationWarning
        entry.status = 'created'; entry.native = {href: created.href, uid: created.uid}
        await this.persist(store, journal)
      }
      // A known-created event is only read on retries, never recreated after deletion.
      record ||= await client.readCreatedEvent({...entry.native, requestId}, collection)
      const sameResource = item => item.source === 'calendar' && (item.remote?.href === record.remote.href || item.collectionId === record.collectionId && item.remote?.uid === record.remote.uid && !item.remote?.recurrenceId)
      await store.updateCache(cache => {
        if (cache.statuses.some(status => status.source === 'calendar' && (status.permissionDenied || status.revokedCollectionIds?.includes(record.collectionId)))) return cache
        const records = [...cache.records.filter(item => !sameResource(item)), record]
        const collections=cache.collections.map(item=>verifiedCollection?.id===item.id&&verifiedCollection.source===item.source&&verifiedCollection.remote?.href===item.remote?.href?verifiedCollection:item)
        return {...cache, records, collections, statuses: cache.statuses.map(status => status.source === 'calendar' ? {...status, count: records.filter(item => item.source === 'calendar').length} : status)}
      })
      const current = store.snapshot()
      const event = current.cache.records.find(sameResource)
      if (!event) throw new Error('The created event has no durable identity yet.')
      for (let attempt = 0; ; attempt++) {
        const latest = store.snapshot()
        const recordId = store.resolveRecordId?.(payload.recordId) || payload.recordId
        if (latest.workspace.relations.some(link => link.type === 'scheduled_during' && link.fromId === recordId && link.toId === event.id)) break
        latest.workspace.relations.push({id: randomUUID(), type: 'scheduled_during', fromId: recordId, toId: event.id})
        try { await store.saveWorkspace(latest.workspace, latest.revision); break }
        catch (error) { if (error.code !== 'REVISION_CONFLICT' || attempt === 2) throw error }
      }
      // Keep the completion fingerprint to make a repeated submit a no-op, without retaining draft text forever.
      journal.requests = journal.requests.map(item => item.requestId === requestId ? {requestId, digest: fingerprint, status: 'linked', recordId: payload.recordId, eventId: event.id} : item)
      await this.persist(store, journal)
      return {...state(),...(creationWarning?{creationWarning}:{})}
    } catch (error) {
      const detail = error.code === 'CONFLICT' ? ` ${error.message}` : ''
      throw new Error(`The calendar booking or its link could not be completed. The request is saved; retry this same booking safely without creating a second event.${detail}`)
    }
  }
}

module.exports = {CalendarScheduler}
