import {jsonValue} from '@nextspace/core/planner-schema.mjs'

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
const encoder = new TextEncoder()
const failure = (message, code = 'CACHE_UNREADABLE') => Object.assign(new Error(message), {code})
const safeReadCode = code => code === 'CACHE_TOO_LARGE' ? 'CACHE_LIMIT' : ['CACHE_FORMAT', 'CACHE_LIMIT', 'TIMEOUT', 'CANCELLED', 'SECURITY', 'UNAVAILABLE'].includes(code) ? code : undefined
const readFailure = (slots, message) => {
  const codes = [...new Set(slots.map(slot => slot.readCode).filter(Boolean))]
  return failure(message, codes.length === 1 ? codes[0] : 'CACHE_UNREADABLE')
}
const checkedKey = key => {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw failure('Invalid account cache key.', 'CACHE_KEY')
  return key
}
const pathFor = (key, slot) => `cache/${key}.${slot}.json`

/**
 * Two alternating complete snapshots; a failed overwrite affects only the older
 * slot. No rename or destructive replacement of the current snapshot is needed.
 * Missing files must return null from size/read; remove must ignore missing files.
 * @param {{size: (path: string) => Promise<number|null>, read: (path: string) => Promise<string|null>, write: (path: string, text: string) => Promise<void>, remove: (path: string) => Promise<void>}} files
 * @param {{maxBytes?: number}} [options]
 */
export function createSlotCache(files, {maxBytes = DEFAULT_MAX_BYTES} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > DEFAULT_MAX_BYTES) throw new RangeError('Cache limit must be between 1 byte and 50 MiB.')
  if (!files || !['size', 'read', 'write', 'remove'].every(method => typeof files[method] === 'function')) throw new TypeError('Cache file operations are incomplete.')
  const queues = new Map(), validators = new Map(), validatedRevisions = new Map()
  // Keep only generation metadata, never a second in-memory copy of the archive.
  // A background writer/account restart invalidates this fast path by revision.
  const revisions = async key => typeof files.stat === 'function'
    ? Promise.all([0, 1].map(slot => files.stat(pathFor(key, slot)))) : null
  const sameRevisions = (a, b) => a && b && a.every((entry, index) => entry.size === b[index].size && entry.revision === b[index].revision)
  const queued = (key, work) => {
    checkedKey(key)
    const previous = queues.get(key) || Promise.resolve()
    const operation = previous.then(work)
    const settled = operation.then(() => {}, () => {})
    queues.set(key, settled)
    void settled.then(() => { if (queues.get(key) === settled) queues.delete(key) })
    return operation
  }
  const readSlot = async (key, slot) => {
    const path = pathFor(key, slot)
    try {
      // Stat before reading avoids allocating an oversized/corrupt bridge body.
      const size = await files.size(path)
      if (size === null) return {slot, kind: 'missing'}
      if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes) return {slot, kind: 'invalid'}
      const text = await files.read(path)
      if (typeof text !== 'string' || encoder.encode(text).length > maxBytes) return {slot, kind: 'invalid'}
      const envelope = JSON.parse(text)
      jsonValue(envelope, 0, 24, 4 * 1024 * 1024)
      if (!envelope || Array.isArray(envelope) || envelope.version !== 1 || !Number.isSafeInteger(envelope.generation) || envelope.generation <= 0 || Object.keys(envelope).length !== 3 || !Object.hasOwn(envelope, 'value')) return {slot, kind: 'invalid'}
      return {slot, kind: 'valid', generation: envelope.generation, value: envelope.value}
    } catch (error) { return {slot, kind: 'invalid', readCode: safeReadCode(error?.code)} }
  }
  const current = async (key, validate, hydrate = true) => {
    const before = await revisions(key)
    const known = validatedRevisions.get(key)
    if (!hydrate && known && known.validate === validate && sameRevisions(before, known.revisions)) return known.previous
    validatedRevisions.delete(key)
    const slots = await Promise.all([readSlot(key, 0), readSlot(key, 1)])
    if (validate?.requireIntact && slots.some(slot => slot.kind === 'invalid')) throw readFailure(slots, 'An acknowledged edit snapshot could not be read. Existing files were preserved.')
    const candidates = slots.filter(slot => slot.kind === 'valid').sort((a, b) => b.generation - a.generation)
    // Compare tied raw envelopes before normalization. Validate only the newest
    // candidate; the backup is recovery data, not a second full hydration.
    if (candidates.length === 2 && candidates[0].generation === candidates[1].generation && JSON.stringify(candidates[0].value) !== JSON.stringify(candidates[1].value)) throw failure('Account cache snapshots have conflicting generations. Existing files were preserved.')
    const valid = []
    for (const entry of candidates) {
      try {
        if (validate && entry.value !== null) {
          if (typeof validate.check === 'function') {
            validate.check(entry.value)
            if (hydrate) entry.value = typeof validate.hydrate === 'function' ? validate.hydrate(entry.value) : validate(entry.value)
          } else entry.value = validate(entry.value)
        }
        valid.push(entry); break
      } catch {entry.kind = 'invalid'; if (validate?.requireIntact) throw failure('An acknowledged edit snapshot is invalid. Existing files were preserved.')}
    }
    if (!valid.length) {
      if (slots.every(slot => slot.kind === 'missing')) {
        const after = await revisions(key)
        if (sameRevisions(before, after)) validatedRevisions.set(key, {validate, revisions: after, previous: null})
        return null
      }
      throw readFailure(slots, 'No intact account cache snapshot could be read. Existing files were preserved.')
    }
    const after = await revisions(key)
    if (sameRevisions(before, after)) validatedRevisions.set(key, {validate, revisions: after, previous: {slot: valid[0].slot, generation: valid[0].generation}})
    return valid[0]
  }
  return {
    validatedLoads: true,
    load: async (key, validate) => queued(key, async () => {
      if (validate) validators.set(key, validate)
      return (await current(key, validators.get(key)))?.value ?? null
    }),
    save: async (key, value, {isCurrent = () => true} = {}) => queued(key, async () => {
      const currentWrite = () => {if (!isCurrent()) throw failure('The cache write was cancelled.', 'CANCELLED')}
      currentWrite()
      const validate = validators.get(key)
      const previous = await current(key, validate, false)
      const known = validatedRevisions.get(key)
      const generation = (previous?.generation || 0) + 1
      if (!Number.isSafeInteger(generation)) throw failure('Account cache generation limit reached. Existing files were preserved.', 'CACHE_GENERATION')
      let text
      try {
        jsonValue(value, 0, 24, 4 * 1024 * 1024)
        if (validate && value !== null) (validate.check || validate)(value)
        text = JSON.stringify({version: 1, generation, value})
      }
      catch { throw failure('The account cache cannot be encoded as JSON.', 'CACHE_FORMAT') }
      if (value === undefined) throw failure('The account cache value is missing.', 'CACHE_FORMAT')
      if (encoder.encode(text).length > maxBytes) throw failure('The account cache exceeds the device size limit.', 'CACHE_LIMIT')
      currentWrite()
      const target = pathFor(key, previous ? 1 - previous.slot : 0)
      try {
        await files.write(target, text)
        currentWrite()
        const after = await revisions(key), targetSlot = previous ? 1 - previous.slot : 0
        if (known && after && after[1-targetSlot].size === known.revisions[1-targetSlot].size && after[1-targetSlot].revision === known.revisions[1-targetSlot].revision) {
          validatedRevisions.set(key, {validate, revisions: after, previous: {slot: targetSlot, generation}})
        } else validatedRevisions.delete(key)
      } catch (error) {
        validatedRevisions.delete(key)
        let cancelled = false
        try {currentWrite()} catch {cancelled = true}
        if (cancelled) {
          // This key's queue still owns the target. A native write may finish
          // after its caller deadline; remove that abandoned generation before
          // another save or restart can treat it as a successful sync.
          try {await files.remove(target)}
          catch {
            try {await files.write(target, '{"cancelled":true}')}
            catch {throw failure('A cancelled cache write could not be invalidated. Saved files require recovery.', 'CACHE_REMOVE_FAILED')}
          }
          throw failure('The cache write was cancelled.', 'CANCELLED')
        }
        throw error
      }
    }),
    remove: async key => queued(key, async () => {
      validatedRevisions.delete(key)
      const results = await Promise.allSettled([0, 1].map(slot => Promise.resolve().then(() => files.remove(pathFor(key, slot)))))
      if (results.some(result => result.status === 'rejected')) {
        // A revoked backup must not reappear if the newer snapshot is damaged.
        // Replace BOTH slots when deletion is blocked, not just the latest one.
        const cleared = JSON.stringify({version: 1, generation: 1, value: null})
        const overwritten = await Promise.allSettled([0, 1].map(slot => files.write(pathFor(key, slot), cleared)))
        if (overwritten.some(result => result.status === 'rejected')) throw failure('The account cache could not be fully removed from this device.', 'CACHE_REMOVE_FAILED')
      }
    }),
  }
}
