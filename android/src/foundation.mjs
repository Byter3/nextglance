/** Platform services only. Shared business rules remain in @nextspace/core. */
import {jsonValue} from '@nextspace/core/planner-schema.mjs'
import {parseScopePreferences} from '@nextspace/core/scope-preferences.mjs'
import {normalizeServerUrl} from '@nextspace/nextcloud-client'
import {checkedDavCheckpoint} from '@nextspace/nextcloud-client/dav-checkpoint-policy.mjs'
import {normalizeTheme} from '@nextspace/core/theme-cache.mjs'
import {validEventDetails, validCalendarScheduling} from '@nextspace/core/source-refresh.mjs'
export {validRecord, validCollection, mergeSourceRefresh} from '@nextspace/core/source-refresh.mjs'
import {sha256} from '@nextspace/nextcloud-client/runtime.mjs'

export const SOURCES = Object.freeze(['tasks', 'calendar', 'deck', 'notes', 'collectives'])
export const REFRESH_INTERVAL_MS = 60_000
export const RESUME_REFRESH_MS = 30_000
export const STALE_AFTER_MS = 125_000
export const METADATA_DEBOUNCE_MS = 1_200
export const problem = (message, code) => Object.assign(new Error(message), {code})
const clone = value => structuredClone(value)
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !value.includes('\0')
const safeId = value => id(value) && !['__proto__', 'prototype', 'constructor'].includes(value)

export function checkedAccount(value) {
  if (value === null) return null
  if (!value || !['name', 'serverUrl', 'username'].every(key => typeof value[key] === 'string' && value[key].trim() && value[key].length <= (key === 'username' ? 512 : 4096) && !/[\u0000-\u001f\u007f]/.test(value[key]))) throw problem('Nextcloud returned an invalid account identity.', 'FORMAT')
  return {name: value.name, serverUrl: normalizeServerUrl(value.serverUrl), username: value.username}
}

/** Private adapter/cache data is never returned to presentation consumers. */
export function publicSnapshot(state) {
  const explicit = Array.isArray(state.nativeWriteSources)
  const verified = new Set(explicit ? state.nativeWriteSources : state.statuses.filter(status => status.state === 'connected').map(status => status.source))
  const collectionsById = new Map(state.collections.map(collection => [collection.id, collection]))
  // Source documents can be much larger than the visible records. Project them
  // out BEFORE copying, while still isolating every public snapshot from callers.
  const records = state.records.map(({remote, identity, ...record}) => {
    const category = record.source === 'notes' && typeof remote?.category === 'string' ? remote.category : undefined
    if (category !== undefined) record.remote = {category}
    const collection = collectionsById.get(record.collectionId)
    const permitted = !explicit || collection?.source === record.source && !collection.readonly
    return verified.has(record.source) && permitted ? record : {...record, readonly: true}
  })
  const collections = state.collections.map(({remote, ...collection}) => {
    return verified.has(collection.source) ? collection : {...collection, readonly: true}
  })
  return clone({...state, records, collections})
}

function validateSourceCache(value, accountKey) {
  if (![1, 2].includes(value?.version) || value.accountKey !== accountKey || !['records', 'collections', 'statuses'].every(key => Array.isArray(value[key]))) throw problem('The saved source cache is invalid. Its files are preserved.', 'CACHE_FORMAT')
  if(value.records.some(record=>record?.source==='calendar'&&!validEventDetails(record)))throw problem('The saved event details are invalid. Its files are preserved.','CACHE_FORMAT')
  if(value.collections.some(collection=>!validCalendarScheduling(collection)))throw problem('The saved calendar authority is invalid. Its files are preserved.','CACHE_FORMAT')
  if (value.acknowledgedSequence !== undefined && (!Number.isSafeInteger(value.acknowledgedSequence) || value.acknowledgedSequence < 0)) throw problem('The saved native edit watermark is invalid.', 'CACHE_FORMAT')
  if (value.version === 2) {
    if (!Array.isArray(value.rawDocuments) || value.rawDocuments.length > 50_000) throw problem('The saved native document table is invalid.', 'CACHE_FORMAT')
    for (const document of value.rawDocuments) {
      if (!document || !['tasks', 'calendar'].includes(document.source) || typeof document.href !== 'string' || !document.href || typeof document.raw !== 'string' || !Number.isSafeInteger(document.bytes) || document.bytes < 0 || document.bytes > 2 * 1024 * 1024 || new TextEncoder().encode(document.raw).length !== document.bytes) throw problem('A saved native document is invalid.', 'CACHE_FORMAT')
    }
    for (const record of value.records) {
      if (record.remote?.rawRef === undefined) continue
      const reference = record.remote.rawRef
      if (!Number.isSafeInteger(reference) || reference < 0 || reference >= value.rawDocuments.length || record.remote.raw !== undefined) throw problem('A saved native document reference is invalid.', 'CACHE_FORMAT')
      const document = value.rawDocuments[reference]
      if (document.source !== record.source || document.href !== record.remote.href) throw problem('A saved native document belongs to another source.', 'CACHE_FORMAT')
    }
  }
  return value
}

function hydrateSourceCache(value, accountKey, serverUrl) {
  const result = clone(value)
  if (result.version === 2) {
    result.records = result.records.map(record => {
      if (record.remote?.rawRef === undefined) return record
      const document = result.rawDocuments[record.remote.rawRef]
      const {rawRef, ...remote} = record.remote
      return {...record, remote: {...remote, raw: document.raw}}
    })
    delete result.rawDocuments
    result.version = 1
  }
  const checkpoint = serverUrl ? checkedDavCheckpoint(result.davCheckpoint, {accountKey, serverUrl, records: result.records, collections: result.collections}) : null
  if (checkpoint) result.davCheckpoint = checkpoint
  else delete result.davCheckpoint
  const theme = normalizeTheme(result.theme)
  if (theme) result.theme = theme
  else delete result.theme
  return result
}

export function checkedSourceCache(value, accountKey, serverUrl) {
  jsonValue(value, 0, 24, 4 * 1024 * 1024)
  if (new TextEncoder().encode(JSON.stringify(value)).length > 50 * 1024 * 1024) throw problem('The saved source cache exceeds 50 MiB.', 'CACHE_LIMIT')
  return hydrateSourceCache(validateSourceCache(value, accountKey), accountKey, serverUrl)
}

/** Slot cache already bounds and validates JSON. Check semantic integrity on
 * every save without hydrating the previous native documents again. */
export function sourceCacheValidator(accountKey, serverUrl, onHydrated) {
  const observe = (input, hydrated) => {onHydrated?.(input); return hydrated}
  const validate = value => observe(value, checkedSourceCache(value, accountKey, serverUrl))
  validate.check = value => validateSourceCache(value, accountKey)
  validate.hydrate = value => observe(value, hydrateSourceCache(value, accountKey, serverUrl))
  return validate
}

/** Same disk-change identity without expanding and re-compacting native bodies.
 * Only call after validation; an invalid/discarded slot grants no cache authority. */
export function sourceCacheFingerprint(value) {
  const prepared = {...value, acknowledgedSequence:value.acknowledgedSequence || 0}
  const compact = value.version === 2 ? prepared : compactSourceCache(prepared)
  return sha256(JSON.stringify({...compact,statuses:compact.statuses.map(({lastSyncedAt,...status})=>status)}))
}

export const compactCopy = (value, depth = 0) => {
  if (depth > 24) throw problem('The source cache is nested too deeply.', 'CACHE_FORMAT')
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : compactCopy(item, depth + 1))
  if (value && typeof value === 'object') {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw problem('The source cache contains a non-JSON object.', 'CACHE_FORMAT')
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, compactCopy(item, depth + 1)]))
  }
  if (['function', 'symbol', 'bigint'].includes(typeof value)) throw problem('The source cache contains a non-JSON value.', 'CACHE_FORMAT')
  return value
}

/** Disk-only deduplication; reconstruct the exact native edit bases on restore. */
export function compactSourceCache(value) {
  const rawDocuments = [], known = new Map()
  const records = value.records.map(record => {
    if (!['tasks', 'calendar'].includes(record.source) || typeof record.remote?.raw !== 'string' || typeof record.remote?.href !== 'string') return record
    const key = `${record.source}\0${record.remote.href}`
    let references = known.get(key)
    if (!references) {references = []; known.set(key, references)}
    let reference = references.find(index => rawDocuments[index].raw === record.remote.raw)
    if (reference === undefined) {
      reference = rawDocuments.length
      rawDocuments.push({source: record.source, href: record.remote.href, raw: record.remote.raw, bytes: new TextEncoder().encode(record.remote.raw).length})
      references.push(reference)
    }
    const {raw, ...remote} = record.remote
    return {...record, remote: {...remote, rawRef: reference}}
  })
  return compactCopy({...value, version: 2, records, rawDocuments})
}

/** Corrupt view preferences must never make valid shared metadata unreadable. */
export function normalizeDeviceState(value) {
  let parsed
  try { parsed = parseScopePreferences(JSON.stringify({version: value?.scopePreferencesVersion === 2 ? 2 : 1, scopes: value?.scopes})) }
  catch { parsed = parseScopePreferences('') }
  return {scopeId: safeId(value?.scopeId) ? value.scopeId : 'all', scopePreferencesVersion: 2, scopes: {...parsed.scopes}}
}


export function syncHealth(state, {online = true, refreshing = false, syncing = false, authorizing = false, lastSuccessfulRefresh = null, now = Date.now()} = {}) {
  if (!online || !state?.connection.connected) return 'offline'
  if (refreshing || syncing || authorizing) return 'syncing'
  if (['error', 'conflict', 'recovery'].includes(state.storage.syncStatus)) return 'error'
  if (lastSuccessfulRefresh === null || now - lastSuccessfulRefresh > STALE_AFTER_MS || state.statuses.some(status => status.state === 'error' || status.metadataStale || status.state === 'unavailable' && status.count > 0)) return 'stale'
  if (state.storage.syncStatus !== 'synced') return 'pending'
  return 'synced'
}

export function refreshDue(lastSuccessfulRefresh, now, trigger) {
  return trigger === 'online' || trigger === 'manual' || lastSuccessfulRefresh === null || now - lastSuccessfulRefresh > (trigger === 'resume' ? RESUME_REFRESH_MS : REFRESH_INTERVAL_MS - 1)
}
