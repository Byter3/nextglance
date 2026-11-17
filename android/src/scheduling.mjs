import {sha256} from '@nextspace/nextcloud-client/runtime.mjs'
import {calendarInterval} from '@nextspace/nextcloud-client'
import {boundedString, inputObject} from './native-edits.mjs'
import {problem} from './foundation.mjs'
import {normalizeEventDetails} from '@nextspace/core/event-details.mjs'
import {normalizeEventAttendees} from '@nextspace/core/event-scheduling.mjs'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const clone = value => structuredClone(value)
const digest = value => sha256(JSON.stringify(value))
export function schedulingRequest(input) {
  inputObject(input)
  if (typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw problem('Choose a valid calendar scheduling request.', 'VALIDATION')
  if (input.allDay !== undefined && typeof input.allDay !== 'boolean') throw problem('Choose a valid event date mode.', 'VALIDATION')
  let details, attendees
  try { details = normalizeEventDetails(input, {requireTitle: true}); if(input.attendees!==undefined)attendees=normalizeEventAttendees(input.attendees) }
  catch (error) { throw problem(error.message, 'VALIDATION') }
  const payload = {
    recordId: boundedString(input.recordId, 'Task or card', 2048), title: details.title,
    collectionId: boundedString(input.collectionId, 'Calendar', 2048), start: boundedString(input.start, 'Event start', 80), end: boundedString(input.end, 'Event end', 80),
    allDay: input.allDay ?? false, description: input.description === undefined ? '' : boundedString(input.description, 'Event description', 500000, true),
    ...(details.location !== undefined ? {location: details.location} : {}),
    ...(details.reminders !== undefined ? {reminders: details.reminders} : {}),
    ...(attendees !== undefined ? {attendees} : {}),
  }
  calendarInterval(payload.start, payload.end, payload.allDay)
  return {requestId: input.requestId.toLowerCase(), payload}
}
export function checkedSchedulingJournal(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.requests) || value.requests.length > 10000 || new TextEncoder().encode(JSON.stringify(value)).length > 16 * 1024 * 1024) throw problem('Invalid scheduling journal.', 'JOURNAL_FORMAT')
  const ids = new Set()
  for (const entry of value.requests) {
    if (!entry || !UUID.test(entry.requestId || '') || ids.has(entry.requestId) || !['pending','created','linked'].includes(entry.status) || !/^[a-f0-9]{64}$/.test(entry.digest || '')) throw problem('Invalid scheduling request.', 'JOURNAL_FORMAT')
    ids.add(entry.requestId)
    if (entry.status === 'linked') {
      boundedString(entry.recordId, 'Task or card', 2048); boundedString(entry.eventId, 'Event', 2048)
    } else {
      const normalized = schedulingRequest({...entry.payload, requestId: entry.requestId})
      if (digest(normalized.payload) !== entry.digest) throw problem('Invalid scheduling fingerprint.', 'JOURNAL_FORMAT')
      if (entry.status === 'created') { boundedString(entry.native?.href, 'Event resource', 4096); boundedString(entry.native?.uid, 'Event identity', 2048) }
    }
  }
  return clone(value)
}

/** The journal is private to one account. Ports own persistence and short state commits. */
export function createSchedulingJournal({cache, key, context, newId = () => globalThis.crypto.randomUUID()}) {
  let journal, invalid = false, loading
  const load = () => loading ||= (async () => {
    try { journal = checkedSchedulingJournal(await cache.load(key, checkedSchedulingJournal) ?? {schemaVersion: 1, requests: []}) }
    catch { invalid = true }
  })()
  const persist = async next => {
    const checked = checkedSchedulingJournal(next)
    await cache.save(key, checked)
    journal = checked
  }
  return {
    load,
    pending: () => (journal?.requests || []).filter(entry => entry.status !== 'linked').map(entry => ({requestId: entry.requestId, ...clone(entry.payload), created: entry.status === 'created'})),
    async create(input) {
      const normalized = schedulingRequest(input), requestId = normalized.requestId
      let payload = normalized.payload
      await load()
      if (invalid) throw problem('Saved calendar requests could not be read. Scheduling is disabled to avoid creating duplicates. Existing files are preserved.', 'JOURNAL_UNREADABLE')
      const next = clone(journal)
      let entry = next.requests.find(item => item.requestId === requestId)
      const originalId = entry?.status === 'linked' ? entry.recordId : entry?.payload.recordId
      // UI may resolve an old work identity after a registry merge. Preserve the
      // durable original payload, permitting only an alias of that same work.
      if (entry && payload.recordId !== originalId && context.resolve(payload.recordId) === context.resolve(originalId)) payload = {...payload, recordId: originalId}
      const fingerprint = digest(payload)
      if (entry && entry.digest !== fingerprint) throw problem('This scheduling request has different details. Resume its original saved details.', 'CONFLICT')
      if (entry?.status === 'linked') return context.snapshot()
      const before = context.state()
      const source = context.record(payload.recordId)
      if (!source || !(source.source === 'tasks' && source.kind === 'task' || source.source === 'deck' && source.kind === 'card')) throw problem('Choose an available task or Deck card from this account to schedule.', 'VALIDATION')
      const collection = context.collection(payload.collectionId)
      if (!collection || collection.source !== 'calendar' || collection.readonly || !collection.remote?.href) throw problem('Choose a writable Nextcloud calendar.', 'VALIDATION')
      if (!entry) {
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== before.revision) throw problem('The planner changed. Refresh and reopen scheduling before creating the event.', 'REVISION_CONFLICT')
        if (next.requests.some(item => item.status !== 'linked' && context.resolve(item.payload.recordId) === source.id)) throw problem('This item already has an unfinished booking. Resume its saved scheduling request first.', 'CONFLICT')
        if (next.requests.length >= 10000) throw problem('The local calendar request history is full. No event was created.', 'JOURNAL_LIMIT')
        entry = {requestId, digest: fingerprint, status: 'pending', payload}
        next.requests.push(entry)
        await persist(next)
      }
      try {
        let record, verifiedCollection, warning
        if (entry.status === 'pending') {
          const created = await context.client().createEvent({...payload, requestId}, collection)
          record = created.record
          verifiedCollection = created.verifiedCollection
          warning = created.warning
          entry.status = 'created'; entry.native = {href: created.href, uid: created.uid}
          await persist(next)
        }
        record ||= await context.client().readCreatedEvent({...entry.native, requestId}, collection)
        const {creationWarning,...nativeRecord}=record
        warning ||= creationWarning
        const event = await context.adoptEvent(nativeRecord, verifiedCollection)
        for (let attempt = 0; ; attempt++) {
          const latest = context.state(), recordId = context.resolve(payload.recordId)
          if (latest.workspace.relations.some(link => link.type === 'scheduled_during' && link.fromId === recordId && link.toId === event.id)) break
          const workspace = clone(latest.workspace)
          workspace.relations.push({id: newId(), type: 'scheduled_during', fromId: recordId, toId: event.id})
          try { await context.saveWorkspace(workspace, latest.revision); break }
          catch (error) { if (error.code !== 'REVISION_CONFLICT' || attempt === 2) throw error }
        }
        next.requests = next.requests.map(item => item.requestId === requestId ? {requestId, digest: fingerprint, status: 'linked', recordId: payload.recordId, eventId: event.id} : item)
        await persist(next)
        return {...context.snapshot(),...(warning?{creationWarning:warning}:{})}
      } catch (error) {
        throw problem(`The calendar booking or its link could not be completed. The request is saved; retry this same booking safely without creating a second event.${error.code === 'CONFLICT' ? ` ${error.message}` : ''}`, error.code || 'SCHEDULING')
      }
    },
  }
}
