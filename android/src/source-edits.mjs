import {jsonValue} from '@nextspace/core/planner-schema.mjs'
import {validRecord, validCollection, problem, compactCopy} from './foundation.mjs'
import {nativeKey} from './native-edits.mjs'
import {validResourceLocator} from '@nextspace/nextcloud-client/resource-cache-policy.mjs'

export const SOURCE_EDIT_LIMIT = 128
export const SOURCE_EDIT_BYTES = 16 * 1024 * 1024
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length
const integer = value => Number.isSafeInteger(value) && value >= 0
const nativeId = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value))
const fail = () => {throw problem('Saved native edits could not be recovered. Their files are preserved; native editing is disabled.', 'CACHE_FORMAT')}

export function checkedSourceEdits(input, accountKey, serverUrl) {
  jsonValue(input, 0, 24, 4 * 1024 * 1024)
  if (input?.version !== 1 || input.accountKey !== accountKey || !integer(input.sequence) || !Array.isArray(input.entries) || input.entries.length > SOURCE_EDIT_LIMIT || bytes(input) > SOURCE_EDIT_BYTES || Object.keys(input).some(key => !['version','accountKey','sequence','entries'].includes(key))) fail()
  const keys = new Set(), sequences = new Set()
  for (const entry of input.entries) {
    const {record, collection} = entry || {}
    if (!entry || Object.keys(entry).some(key => !['sequence','record','collection','deleted'].includes(key)) || !integer(entry.sequence) || !entry.sequence || entry.sequence > input.sequence || sequences.has(entry.sequence)) fail()
    if (!validRecord(record) || !validCollection(collection) || record.source !== collection.source || record.collectionId !== collection.id || record.identity?.source !== record.source || typeof record.identity?.key !== 'string' || !record.identity.key || !record.remote || !['tasks','calendar','deck','notes'].includes(record.source)) fail()
    if ({tasks:'task',calendar:'event',deck:'card',notes:'note'}[record.source] !== record.kind) fail()
    if (['tasks','calendar'].includes(record.source)) {
      if (typeof record.remote.raw !== 'string' || !record.remote.raw.startsWith('BEGIN:VCALENDAR') || typeof record.remote.uid !== 'string' || !record.remote.uid || !validResourceLocator({kind:'dav',collection:collection.remote?.href,href:record.remote.href},serverUrl)) fail()
      if (record.identity.locator !== undefined && record.identity.locator !== record.remote.href) fail()
    } else if (record.source === 'notes') {
      if (!nativeId(record.remote.nativeId) || typeof record.body !== 'string' || typeof record.remote.category !== 'string' || record.remote.category !== collection.remote?.category || record.fileId !== undefined && String(record.fileId) !== String(record.remote.nativeId)) fail()
      if (record.identity.locator !== undefined && record.identity.locator !== `${serverUrl}/index.php/apps/notes/api/v1/notes/${record.remote.nativeId}`) fail()
    } else if (record.source === 'deck') {
      const remote=record.remote,snapshot=remote.snapshot
      if (![remote.nativeId,remote.boardId,remote.stackId,collection.remote?.nativeId].every(nativeId) || String(remote.boardId)!==String(collection.remote.nativeId) || String(record.stackId)!==String(remote.stackId) || !collection.stacks?.some(stack=>String(stack.id)===String(remote.stackId)) || !snapshot || String(snapshot.id)!==String(remote.nativeId) || String(snapshot.stackId)!==String(remote.stackId) || typeof snapshot.title!=='string' || typeof snapshot.description!=='string') fail()
      if (record.identity.locator !== undefined && record.identity.locator !== `${serverUrl}/index.php/apps/deck/api/v1.0/boards/${remote.boardId}/stacks/${remote.stackId}/cards/${remote.nativeId}`) fail()
    }
    if (entry.deleted !== undefined && (entry.deleted !== true || !['calendar', 'tasks'].includes(record.source))) fail()
    const key = nativeKey(record)
    if (keys.has(key)) fail()
    keys.add(key); sequences.add(entry.sequence)
  }
  return structuredClone(input)
}

/** Acknowledged native rows are small durable edits, never a cloud metadata store. */
export function createSourceEdits({cache, key, accountKey, serverUrl}) {
  let value = {version:1,accountKey,sequence:0,entries:[]}, invalid = false
  const validate = input => checkedSourceEdits(input, accountKey, serverUrl)
  validate.requireIntact = true
  return {
    get invalid() {return invalid},
    get sequence() {return value.sequence},
    excludes(record){return value.entries.some(entry=>entry.deleted&&(entry.record.id===record.id||record.identity?.key&&nativeKey(entry.record)===nativeKey(record)))},
    async load() {
      try {value = await cache.load(key, validate) || value}
      catch (error) {invalid = true; throw error}
    },
    apply(archive) {
      if (invalid) fail()
      const watermark = archive.acknowledgedSequence || 0
      value.sequence = Math.max(value.sequence, watermark)
      const entries = value.entries.filter(entry => entry.sequence > watermark)
      if (!entries.length) return {...archive,acknowledgedSequence:value.sequence}
      const records = new Map(archive.records.map(record => [nativeKey(record),record]))
      const collections = new Map(archive.collections.map(collection => [collection.id,collection]))
      const affected = new Set()
      for (const {record,collection,deleted} of entries) {if(deleted)records.delete(nativeKey(record));else records.set(nativeKey(record),structuredClone(record));collections.set(collection.id,structuredClone(collection));affected.add(collection.remote?.href)}
      return {...archive, records:[...records.values()],collections:[...collections.values()],acknowledgedSequence:value.sequence,
        ...(archive.davCheckpoint ? {davCheckpoint:{...archive.davCheckpoint,collections:archive.davCheckpoint.collections.filter(collection=>!affected.has(collection.href))}} : {})}
    },
    async save(record, collection, minimumSequence, {isCurrent, fold, deleted = false}) {
      if (invalid) fail()
      const sequence = Math.max(value.sequence,minimumSequence || 0)+1
      if (!integer(sequence)) throw problem('Native edit history reached its sequence limit.', 'CACHE_GENERATION')
      const next = compactCopy({version:1,accountKey,sequence,entries:[...value.entries.filter(entry=>nativeKey(entry.record)!==nativeKey(record)),{sequence,record,collection,...(deleted?{deleted:true}:{})}]})
      if (next.entries.length > SOURCE_EDIT_LIMIT || bytes(next) > SOURCE_EDIT_BYTES) {
        // Both archive generations must cover these edits before the overlay can
        // be cleared. A failed second rotation leaves existing recovery intact.
        await fold(sequence); await fold(sequence)
        const empty = {version:1,accountKey,sequence,entries:[]}
        await cache.save(key,empty,{isCurrent}); value=empty; return sequence
      }
      const checked = validate(next)
      await cache.save(key,checked,{isCurrent}); value=checked; return sequence
    },
    async clear() {await cache.remove(key);value={version:1,accountKey,sequence:0,entries:[]};invalid=false},
  }
}
