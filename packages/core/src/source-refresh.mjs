/** Source freshness is independent of restored transport authorization.
 * Hosts mark unavailable credentials with reconnectRequired/recoveryOnly. */
export function canRefreshSources(connection, {networkOnline=true, busy=false, refreshing=false, loginWaiting=false}={}) {
  return Boolean(connection && !connection.reconnectRequired && !connection.recoveryOnly
    && (connection.connected || connection.serverUrl && connection.username)
    && networkOnline && !busy && !refreshing && !loginWaiting)
}

/** Do not label an authorized but unverified source snapshot as offline. */
export function sourceConnectionLabel(connection, {networkOnline=true, refreshing=false, itemCount=0, sourceErrors=false}={}) {
  if(!connection)return 'Not connected'
  if(connection.reconnectRequired || connection.recoveryOnly)return 'Sign-in required'
  if(!(connection.connected || connection.serverUrl && connection.username))return 'Not connected'
  if(!networkOnline)return itemCount?'Offline · saved items':'Offline · no items available'
  if(refreshing)return 'Refreshing sources…'
  if(connection.connected)return 'Nextcloud connected'
  return sourceErrors?'Source refresh incomplete':'Source check needed'
}

/** Count the items actually retained in this snapshot, not a stale source count.
 * A partial read can contain both fresh and older items; it is not proof of cache use. */
export function sourceRefreshFeedback({statuses=[], records=[]}={}) {
  const counts=new Map()
  for(const record of records)counts.set(record.source,(counts.get(record.source)||0)+1)
  return statuses.filter(status=>status.state==='error').map(status=>{
    const count=counts.get(status.source)||0
    return {
      source:status.source, count, message:status.message,
      summary:count
        ? `${count} loaded/retained ${count===1?'item may':'items may'} be incomplete or out of date.`
        : 'No items from this source are currently available.',
    }
  })
}


// Shared source-result validation and merge semantics; extracted unchanged from
// the Android host so session hosts cannot diverge on partial/denied reads.
import {normalizeEventReminders} from "./event-details.mjs"
const SOURCES = Object.freeze(["tasks", "calendar", "deck", "notes", "collectives"])
const problem = (message, code) => Object.assign(new Error(message), {code})
const clone = value => structuredClone(value)
const id = value => typeof value === "string" && value.length > 0 && value.length <= 2048 && !value.includes("\0")
const shape = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
const optionalText = value => value === undefined || typeof value === 'string'
const participant = value => shape(value,['uri','name']) && typeof value.uri === 'string' && optionalText(value.name)
function validScheduling(record) {
  const value=record.eventScheduling,access=record.eventAccess
  if(value!==undefined&&(!shape(value,['role','organizer','attendees','ownAttendeeUri']) || !['none','organizer','attendee','unknown'].includes(value.role) || value.organizer!==undefined&&!participant(value.organizer) || !optionalText(value.ownAttendeeUri) || !Array.isArray(value.attendees) || !value.attendees.every(item=>shape(item,['uri','name','participation','role','rsvp','scheduleStatus'])&&typeof item.uri==='string'&&typeof item.participation==='string'&&optionalText(item.name)&&optionalText(item.role)&&optionalText(item.scheduleStatus)&&(item.rsvp===undefined||typeof item.rsvp==='boolean'))))return false
  if(access!==undefined&&(!shape(access,['editDetails','editReminders','editAttendees','respond','delete','reason']) || !['editDetails','editReminders','editAttendees','respond','delete'].every(key=>typeof access[key]==='boolean') || access.reason!==undefined&&!['recurring','mixed-resource','read-only-calendar','missing-validator','unknown-identity','not-organizer','unsupported-scheduling','not-calendar-owner'].includes(access.reason)))return false
  return true
}
export function validCalendarScheduling(collection) {
  if(!collection||typeof collection!=='object'||Array.isArray(collection))return false
  const value=collection.calendarScheduling
  return value===undefined || collection.source==='calendar'&&shape(value,['canInvite','organizer','reason'])&&typeof value.canInvite==='boolean'&&(value.organizer===undefined||participant(value.organizer))&&optionalText(value.reason)
}
export function validEventDetails(record) {
  if(record.source!=='calendar')return true
  if(record.location!==undefined&&typeof record.location!=='string')return false
  if(record.unsupportedReminderCount!==undefined&&(!Number.isSafeInteger(record.unsupportedReminderCount)||record.unsupportedReminderCount<0))return false
  try { if(record.reminders!==undefined)normalizeEventReminders(record.reminders) }
  catch { return false }
  return validScheduling(record)
}
export const validRecord = record => record && SOURCES.includes(record.source) && id(record.id) && ['task', 'event', 'card', 'note', 'page'].includes(record.kind) && typeof record.title === 'string' && validEventDetails(record)
export const validCollection = collection => collection && SOURCES.includes(collection.source) && id(collection.id) && validCalendarScheduling(collection)


export function optionalMetadata(previous, next) {
  const result = {...next}
  if (next.source === 'deck' && next.attachmentFileIds === undefined && previous?.attachmentFileIds !== undefined) result.attachmentFileIds = clone(previous.attachmentFileIds)
  if (next.source === 'notes' && next.fileTags === undefined && previous?.fileTags !== undefined) {
    result.fileTags = clone(previous.fileTags)
    result.tagDetails = clone(previous.fileTags)
    result.tags = [...new Set([...(next.tags || []), ...previous.fileTags.map(tag => tag.title)])]
  }
  return result
}

/** Successful sources replace old rows; partial failures retain cached rows.
 * Revocation always wins, and only explicitly optional metadata is preserved. */
export function mergeSourceRefresh(state, incoming, selected = SOURCES) {
  if (!incoming || !['records', 'collections', 'statuses'].every(key => Array.isArray(incoming[key]))) throw problem('Nextcloud returned an invalid source result.', 'FORMAT')
  const records = [], collections = [], statuses = []
  const nativeKey = record => record.identity ? JSON.stringify([record.identity.source, record.identity.key]) : record.id
  const old = new Map(state.records.map(record => [nativeKey(record), record]))
  for (const source of SOURCES) {
    if (!selected.includes(source)) {
      records.push(...state.records.filter(record => record.source === source))
      collections.push(...state.collections.filter(collection => collection.source === source))
      const retained = state.statuses.find(status => status.source === source)
      if (retained) statuses.push(retained)
      continue
    }
    const status = incoming.statuses.find(value => value?.source === source) || {source, state: 'error', message: 'This source did not return a refresh result.'}
    const denied = Boolean(status.permissionDenied), revoked = new Set(status.revokedCollectionIds || [])
    const preserve = !denied && status.state !== 'connected'
    const beforeRecords = preserve ? state.records.filter(record => record.source === source && !revoked.has(record.collectionId)) : []
    const beforeCollections = preserve ? state.collections.filter(collection => collection.source === source && !revoked.has(collection.id)) : []
    const loaded = denied ? [] : incoming.records.filter(record => validRecord(record) && record.source === source && !revoked.has(record.collectionId)).map(record => optionalMetadata(old.get(nativeKey(record)), record))
    const loadedCollections = denied ? [] : incoming.collections.filter(collection => validCollection(collection) && collection.source === source && !revoked.has(collection.id))
    records.push(...new Map([...beforeRecords, ...loaded].map(record => [nativeKey(record), record])).values())
    collections.push(...new Map([...beforeCollections, ...loadedCollections].map(collection => [collection.id, collection])).values())
    statuses.push({...status, ...(denied ? {state: 'error'} : {}), count: records.filter(record => record.source === source).length})
  }
  return {records, collections, statuses}
}
