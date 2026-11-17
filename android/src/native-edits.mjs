import {problem, mergeSourceRefresh} from './foundation.mjs'

/** @type {readonly (keyof import('@nextspace/contracts').WorkspaceApi)[]} */
export const NATIVE_OPERATIONS = Object.freeze(['createNote', 'updateNote', 'setNoteTags', 'updateRecordDates', 'createLinkedEvent', 'setTaskCompleted', 'setCardCompleted', 'listFiles', 'readDeckAttachments', 'attachDeckFile', 'removeDeckAttachment', 'uploadDeckAttachment', 'deleteEvent', 'updateEvent', 'createTask', 'createCard', 'updateDescription', 'createEvent', 'respondToEvent', 'setDeckDependency', 'moveCard', 'updateTaskStatus', 'updateRecordAppearance', 'createDeckLabel'])
export const nativeKey = record => record.identity?.key ? `${record.source}\0${record.identity.key}` : record.id
export function inputObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw problem('Invalid action input.', 'VALIDATION')
  return input
}
export function boundedString(value, label, maximum, empty = false) {
  if (typeof value !== 'string' || !empty && !value.trim() || value.length > maximum || value.includes('\0')) throw problem(`${label} is missing or too long.`, 'VALIDATION')
  return value
}
export function noteUpdate(input) {
  inputObject(input)
  const result = {title: boundedString(input.title, 'Note title', 500), content: boundedString(input.content, 'Note content', 500000, true)}
  if (input.etag !== undefined) result.etag = boundedString(input.etag, 'Note version', 1000)
  if (input.category !== undefined) result.category = boundedString(input.category, 'Note category', 200, true)
  if (input.base !== undefined) {
    inputObject(input.base)
    result.base = {title: boundedString(input.base.title, 'Original note title', 500, true), content: boundedString(input.base.content, 'Original note content', 500000, true)}
    if (input.base.category !== undefined) result.base.category = boundedString(input.base.category, 'Original note category', 200, true)
  }
  return result
}
export function dateUpdate(input, record) {
  inputObject(input)
  const result = {}
  for (const field of ['start', 'due', 'end']) if (input[field] !== undefined) result[field] = boundedString(input[field], 'Date', 80, true)
  if (input.allDay !== undefined) {
    if (typeof input.allDay !== 'boolean') throw problem('Choose a valid event date mode.', 'VALIDATION')
    result.allDay = input.allDay
  }
  if (input.etag !== undefined) {
    result.etag = boundedString(input.etag, 'Item version', 1000)
    if (result.etag !== record.etag) throw problem('This item changed. Refresh and try the date change again.', 'CONFLICT')
  }
  return result
}

export function completionUpdate(input) {
  inputObject(input)
  boundedString(input.id, 'Record id', 2048)
  if (typeof input.completed !== 'boolean') throw problem('Choose a valid completion state.', 'VALIDATION')
  return {completed: input.completed}
}

/** Keep acknowledged edits/new items over reads that began before those edits.
 * Per-native-identity clocks avoid serializing network reads behind source writes. */
export function mergeEditedRefresh(state, incoming, before, current, tagsBefore = new Map(), tagsCurrent = new Map(), selected, labelsBefore = new Map(), labelsCurrent = new Map()) {
  const merged = mergeSourceRefresh(state, incoming, selected)
  const allowed = item => !incoming.statuses.some(status => status.source === item.source && (status.permissionDenied || status.revokedCollectionIds?.includes(item.collectionId)))
  const records = new Map(merged.records.map(record => [nativeKey(record), record]))
  const collections = new Map(merged.collections.map(collection => [collection.id, collection]))
  for (const record of state.records) if (allowed(record) && (before.get(nativeKey(record)) || 0) !== (current.get(nativeKey(record)) || 0)) {
    records.set(nativeKey(record), record)
    const collection = state.collections.find(item => item.id === record.collectionId)
    if (collection) collections.set(collection.id, collection)
  }
  // Tag reads/assignments must not pin an old body, category or ETag. Overlay
  // only Files-tag metadata on whichever representation won the source merge.
  for (const record of state.records) if (record.source === 'notes' && allowed(record) && (tagsBefore.get(nativeKey(record)) || 0) !== (tagsCurrent.get(nativeKey(record)) || 0)) {
    const latest = records.get(nativeKey(record))
    if (latest) records.set(nativeKey(record), {...latest, fileTags: record.fileTags, tagDetails: record.tagDetails, tags: [...new Set([...(latest.tags?.includes('Favorite') ? ['Favorite'] : []), ...(record.fileTags || []).map(tag => tag.title)])]})
  }
  // Label definitions belong to the board. Retain only this acknowledged field
  // across an older read; do not pin old cards, permissions or stack membership.
  for (const collection of state.collections) if (collection.source === 'deck' && allowed(collection) && (labelsBefore.get(collection.id) || 0) !== (labelsCurrent.get(collection.id) || 0)) {
    const latest = collections.get(collection.id)
    if (latest && !incoming.statuses.some(status => status.source === 'deck' && status.revokedCollectionIds?.includes(collection.id))) collections.set(collection.id, {...latest, labels: collection.labels})
  }
  merged.records = [...records.values()]
  merged.collections = [...collections.values()]
  merged.statuses = merged.statuses.map(status => ({...status, count: merged.records.filter(record => record.source === status.source).length}))
  return merged
}
