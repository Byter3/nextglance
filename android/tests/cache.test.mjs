import test from 'node:test'
import assert from 'node:assert/strict'
import {createSlotCache} from '../src/cache.mjs'
import {compactSourceCache, checkedSourceCache, sourceCacheValidator} from '../src/foundation.mjs'

const A = 'a'.repeat(64), B = 'b'.repeat(64)
const path = (key, slot) => `cache/${key}.${slot}.json`
const envelope = (generation, value) => JSON.stringify({version: 1, generation, value})
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return {promise, resolve} }
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(options = {}) {
  const values = new Map(), calls = {read: [], write: [], remove: []}
  const files = {
    size: async file => values.has(file) ? Buffer.byteLength(values.get(file)) : null,
    read: async file => { calls.read.push(file); return values.get(file) ?? null },
    write: async (file, text) => { calls.write.push(file); values.set(file, text) },
    remove: async file => { calls.remove.push(file); values.delete(file) },
  }
  return {files, values, calls, cache: createSlotCache(files, options), restart: () => createSlotCache(files, options)}
}

test('validated revisions avoid rereading archives on save but revalidate external changes', async () => {
  const f = fixture(), versions = new Map()
  f.files.stat = async file => ({size: await f.files.size(file), revision: f.values.has(file) ? String(versions.get(file) || 0) : null})
  const write = f.files.write
  f.files.write = async (file, text) => {await write(file, text); versions.set(file, (versions.get(file) || 0) + 1)}
  const cache = createSlotCache(f.files)
  await cache.save(A, {title:'First'})
  await cache.save(A, {title:'Second'})
  await cache.save(A, {title:'Third'})
  assert.equal(f.calls.read.length, 0)
  // A different process writes a newer valid generation, which must win.
  await f.files.write(path(A,1), envelope(20, {title:'Background'}))
  await cache.save(A, {title:'Foreground'})
  assert.equal(f.calls.read.length, 2)
  assert.equal(JSON.parse(f.values.get(path(A,0))).generation, 21)
  await f.files.write(path(A,1), '{broken')
  const strict = value => value; strict.requireIntact = true
  await assert.rejects(cache.load(A, strict), {code:'CACHE_UNREADABLE'})
  await assert.rejects(cache.save(A, {title:'Must not hide damage'}), {code:'CACHE_UNREADABLE'})
})

test('missing cache starts one slot and subsequent snapshots alternate with increasing generations', async () => {
  const f = fixture()
  assert.equal(await f.cache.load(A), null)
  await f.cache.save(A, {title: 'First'})
  await f.cache.save(A, {title: 'Second'})
  await f.cache.save(A, {title: 'Third'})
  assert.deepEqual(f.calls.write, [path(A, 0), path(A, 1), path(A, 0)])
  assert.equal(JSON.parse(f.values.get(path(A, 0))).generation, 3)
  assert.equal(JSON.parse(f.values.get(path(A, 1))).generation, 2)
  assert.deepEqual(await f.restart().load(A), {title: 'Third'})
})

test('interrupted overwrite recovers the latest intact snapshot after process restart', async () => {
  const f = fixture()
  await f.cache.save(A, {title: 'First'})
  await f.cache.save(A, {title: 'Second'})
  const write = f.files.write
  f.files.write = async (file, text) => { f.values.set(file, text.slice(0, text.length / 2)); throw new Error('Process interrupted while writing') }
  await assert.rejects(f.cache.save(A, {title: 'Third'}))
  assert.deepEqual(await f.restart().load(A), {title: 'Second'})
  f.files.write = write
  await f.restart().save(A, {title: 'Recovered'})
  assert.deepEqual(await f.restart().load(A), {title: 'Recovered'})
  assert.equal(JSON.parse(f.values.get(path(A, 0))).generation, 3)
})

test('a complete write remains recoverable when the process stops before acknowledgment', async () => {
  const f = fixture()
  await f.cache.save(A, {title: 'Previous'})
  f.files.write = async (file, text) => { f.values.set(file, text); throw new Error('Stopped after complete write') }
  await assert.rejects(f.cache.save(A, {title: 'Complete'}))
  assert.deepEqual(await f.restart().load(A), {title: 'Complete'})
})

test('unreadable snapshots without a trustworthy generation are preserved rather than reset', async () => {
  for (const second of [null, '{partial']) {
    const f = fixture()
    f.values.set(path(A, 0), '{partial')
    if (second) f.values.set(path(A, 1), second)
    const before = new Map(f.values)
    await assert.rejects(f.cache.load(A), {code: 'CACHE_UNREADABLE'})
    await assert.rejects(f.cache.save(A, {title: 'Must not overwrite'}), {code: 'CACHE_UNREADABLE'})
    assert.deepEqual(f.values, before); assert.deepEqual(f.calls.write, [])
  }
})

test('a slot read error falls back only when another intact snapshot exists', async () => {
  const f = fixture()
  f.values.set(path(A, 0), envelope(3, {title: 'Intact'}))
  f.values.set(path(A, 1), envelope(4, {title: 'Unreadable'}))
  const read = f.files.read
  f.files.read = async file => file === path(A, 1) ? Promise.reject(new Error('Read failed')) : read(file)
  assert.deepEqual(await f.cache.load(A), {title: 'Intact'})
  f.values.delete(path(A, 0))
  await assert.rejects(f.cache.save(A, {}), {code: 'CACHE_UNREADABLE'})
})

test('bounded cache bridge causes remain distinguishable without exposing private error details', async () => {
  for (const [cause, expected] of [['CACHE_FORMAT','CACHE_FORMAT'],['CACHE_TOO_LARGE','CACHE_LIMIT'],['TIMEOUT','TIMEOUT'],['private/path/in/error','CACHE_UNREADABLE']]) {
    const f=fixture(), raw=envelope(1,{title:'Saved'});f.values.set(path(A,0),raw)
    f.files.read=async()=>{throw Object.assign(new Error('private content and path'),{code:cause})}
    await assert.rejects(f.cache.load(A),error=>error.code===expected&&!error.message.includes('private content'))
    await assert.rejects(f.cache.save(A,{title:'Replacement'}),{code:expected})
    assert.equal(f.values.get(path(A,0)),raw);assert.equal(f.calls.write.length,0)
  }
})

test('intact bytes recover after a temporary bridge conversion failure without reset or writes', async () => {
  const f=fixture();await f.cache.save(A,{title:'Existing planner',pending:true});const before=new Map(f.values), originalRead=f.files.read
  f.files.read=async()=>{throw Object.assign(new Error('Invalid numeric private cache argument.'),{code:'CACHE_FORMAT'})}
  await assert.rejects(f.restart().load(A),{code:'CACHE_FORMAT'})
  f.files.read=originalRead
  assert.deepEqual(await f.restart().load(A),{title:'Existing planner',pending:true})
  assert.deepEqual(f.values,before)
})

test('oversized slots are rejected before read and UTF-8 save size is checked before write', async () => {
  const f = fixture({maxBytes: 128})
  f.values.set(path(A, 0), 'x'.repeat(129))
  await assert.rejects(f.cache.load(A), {code: 'CACHE_UNREADABLE'})
  assert.deepEqual(f.calls.read, [])
  f.values.clear()
  await assert.rejects(f.cache.save(A, '😀'.repeat(30)), {code: 'CACHE_LIMIT'})
  assert.deepEqual(f.calls.write, [])
  await f.cache.save(A, {ok: true})
  assert.deepEqual(await f.cache.load(A), {ok: true})
})

test('changed file size during read is checked again before JSON parsing', async () => {
  const f = fixture({maxBytes: 128})
  f.values.set(path(A, 0), envelope(1, {}))
  f.files.read = async () => envelope(9, {text: 'x'.repeat(200)})
  await assert.rejects(f.cache.load(A), {code: 'CACHE_UNREADABLE'})
  await assert.rejects(f.cache.save(A, {}), {code: 'CACHE_UNREADABLE'})
  assert.equal(f.calls.write.length, 0)
})

test('same-account writes queue so a delayed older save cannot replace a newer save', async () => {
  const f = fixture(), firstWrite = deferred()
  const write = f.files.write
  let writing = 0
  f.files.write = async (file, text) => { if (++writing === 1) await firstWrite.promise; await write(file, text) }
  const first = f.cache.save(A, {title: 'First'}), second = f.cache.save(A, {title: 'Second'})
  await tick(); assert.equal(writing, 1)
  firstWrite.resolve(); await Promise.all([first, second])
  assert.deepEqual(await f.restart().load(A), {title: 'Second'})
  assert.equal(JSON.parse(f.values.get(path(A, 1))).generation, 2)
})

test('blocked deletion erases both backup slots instead of retaining revoked content', async () => {
  for (const failSlot of [0, 1, 'both']) {
    const f = fixture()
    await f.cache.save(A, {records: ['old private content']})
    await f.cache.save(A, {records: ['new private content']})
    f.files.remove = async file => {
      f.calls.remove.push(file)
      if (failSlot === 'both' || file === path(A, failSlot)) throw new Error('Delete failed')
      f.values.delete(file)
    }
    await f.cache.remove(A)
    assert.deepEqual(f.calls.remove.sort(), [path(A, 0), path(A, 1)])
    assert.equal(await f.restart().load(A), null)
    for (const text of f.values.values()) assert.ok(!text.includes('private content'))
  }
})

test('successful removal clears both slots and never touches another account', async () => {
  const f = fixture()
  await f.cache.save(A, {account: 'a'}); await f.cache.save(A, {account: 'a2'})
  await f.cache.save(B, {account: 'b'})
  await f.cache.remove(A); await f.cache.remove(A)
  assert.equal(await f.restart().load(A), null)
  assert.deepEqual(await f.restart().load(B), {account: 'b'})
})

test('invalid keys and invalid JSON values never reach file writes', async () => {
  const f = fixture()
  for (const key of ['../escape', 'A'.repeat(64), 'a'.repeat(63), `${A}/x`]) {
    await assert.rejects(f.cache.load(key), {code: 'CACHE_KEY'})
    await assert.rejects(f.cache.save(key, {}), {code: 'CACHE_KEY'})
    await assert.rejects(f.cache.remove(key), {code: 'CACHE_KEY'})
  }
  const cyclic = {}; cyclic.self = cyclic
  await assert.rejects(f.cache.save(A, cyclic), {code: 'CACHE_FORMAT'})
  await assert.rejects(f.cache.save(A, undefined), {code: 'CACHE_FORMAT'})
  assert.deepEqual(f.calls.write, [])
})

test('conflicting equal generations and exhausted generations preserve both snapshots', async () => {
  const f = fixture()
  f.values.set(path(A, 0), envelope(5, {title: 'One'}))
  f.values.set(path(A, 1), envelope(5, {title: 'Other'}))
  await assert.rejects(f.cache.load(A), {code: 'CACHE_UNREADABLE'})
  await assert.rejects(f.cache.save(A, {}), {code: 'CACHE_UNREADABLE'})
  f.values.set(path(A, 0), envelope(Number.MAX_SAFE_INTEGER, {title: 'Latest'}))
  await assert.rejects(f.cache.save(A, {}), {code: 'CACHE_GENERATION'})
  assert.equal(f.calls.write.length, 0)
})

test('semantic fallback remains recoverable after the next save is interrupted', async () => {
  const f = fixture()
  const validate = value => { if (value?.schema !== 2) throw new Error('Invalid schema'); return value }
  await f.cache.save(A, {schema: 2, title: 'Last good'})
  f.values.set(path(A, 1), envelope(2, {schema: 99, title: 'Malformed newer data'}))
  assert.deepEqual(await f.cache.load(A, validate), {schema: 2, title: 'Last good'})
  const intact = f.values.get(path(A, 0))
  f.files.write = async (file, text) => { f.values.set(file, text.slice(0, 12)); throw new Error('Interrupted write') }
  await assert.rejects(f.cache.save(A, {schema: 2, title: 'New intent'}), /Interrupted write/)
  assert.equal(f.values.get(path(A, 0)), intact)
  assert.deepEqual(await f.restart().load(A, validate), {schema: 2, title: 'Last good'})
})

test('unsafe JSON is rejected without corrupting the previous valid snapshot', async () => {
  const f = fixture()
  await f.cache.save(A, {safe: true})
  for (const value of [JSON.parse('{"constructor":{}}'), {number: Infinity}, {text: 'unsafe\0text'}]) await assert.rejects(f.cache.save(A, value), {code: 'CACHE_FORMAT'})
  assert.deepEqual(await f.cache.load(A), {safe: true})
})


test('semantic hydration validates only newest intact slot, but rechecks disk before every save', async () => {
  const f = fixture(); let validations = 0
  await f.cache.save(A, {value: 'first'}); await f.cache.save(A, {value: 'second'})
  const validator = value => {validations++; return value}
  assert.deepEqual(await f.cache.load(A, validator), {value: 'second'}); assert.equal(validations, 1)
  f.values.set(path(A, 1), '{corrupted after load')
  await f.cache.save(A, {value: 'third'})
  assert.equal(validations, 3, 'Save validates the recovered disk snapshot and the new value')
  assert.equal(JSON.parse(f.values.get(path(A, 1))).generation, 2)
})

test('cancelled queued cache writes never reach disk', async () => {
  const f = fixture(), blocked = deferred(); let current = true
  const write = f.files.write
  f.files.write = async (...args) => {await blocked.promise; return write(...args)}
  const first = f.cache.save(A, {value: 'first'}), cancelled = f.cache.save(A, {value: 'obsolete'}, {isCurrent: () => current})
  await tick(); current = false; blocked.resolve(); await first
  await assert.rejects(cancelled, {code: 'CANCELLED'})
  assert.deepEqual(await f.cache.load(A), {value: 'first'})
})


test('a cancelled write that finishes late cannot become the newest valid restart snapshot', async () => {
  const f = fixture(), entered = deferred(), blocked = deferred(); let current = true
  await f.cache.save(A, {status: 'pending', title: 'Local work'})
  const write = f.files.write
  f.files.write = async (...args) => {entered.resolve(); await blocked.promise; return write(...args)}
  const saving = f.cache.save(A, {status: 'synced', title: 'Late incoming state'}, {isCurrent: () => current})
  await entered.promise; current = false; blocked.resolve()
  await assert.rejects(saving, {code: 'CANCELLED'})
  assert.deepEqual(await f.restart().load(A), {status: 'pending', title: 'Local work'})
})

test('source archive saves check disk semantics without hydrating old raw records, then hydrate once on load', async () => {
  const f = fixture(), validator = sourceCacheValidator(A)
  let checks = 0, hydrations = 0
  const check = validator.check, hydrate = validator.hydrate
  validator.check = value => {checks++; return check(value)}
  validator.hydrate = value => {hydrations++; return hydrate(value)}
  const source = {accountKey:A, records:[{id:'task',source:'tasks',kind:'task',title:'Task',remote:{href:'https://example.test/task.ics',raw:'BEGIN:VCALENDAR\r\nEND:VCALENDAR'}}],collections:[],statuses:[]}
  const compact = compactSourceCache(source)
  await f.cache.load(A, validator)
  await f.cache.save(A, compact); await f.cache.save(A, compact)
  assert.equal(checks, 3); assert.equal(hydrations, 0)
  assert.deepEqual(await f.cache.load(A), checkedSourceCache(compact,A))
  assert.equal(checks, 4); assert.equal(hydrations, 1)
  const broken = structuredClone(compact); broken.records[0].remote.rawRef = 99
  f.values.set(path(A,1), envelope(3,broken))
  await f.cache.save(A,compact)
  assert.equal(hydrations,1,'Semantic fallback never reconstructs discarded or older records just to persist')
  assert.equal(JSON.parse(f.values.get(path(A,1))).generation,2)
  assert.deepEqual(await f.restart().load(A,sourceCacheValidator(A)),checkedSourceCache(compact,A))
  await assert.rejects(f.cache.save(A,{...compact,accountKey:B}),{code:'CACHE_FORMAT'})
  await assert.rejects(f.cache.save(A,broken),{code:'CACHE_FORMAT'})
})

test('compact source snapshots preserve JSON values and isolate pending writes without coercing unsupported objects', () => {
  const value={accountKey:A,records:[{id:'note',source:'notes',kind:'note',title:'Note',body:undefined,remote:{category:'Work',absent:undefined},tags:['one']}],collections:[],statuses:[]}
  const result=compactSourceCache(value)
  assert.deepEqual(result,JSON.parse(JSON.stringify({...value,version:2,rawDocuments:[]})))
  value.records[0].tags.push('later'); value.records[0].remote.category='Changed'
  assert.deepEqual(result.records[0].tags,['one']); assert.equal(result.records[0].remote.category,'Work')
  for(const unsupported of [new Date(),new Map(),()=>{},1n,Symbol('x')]) assert.throws(()=>compactSourceCache({...value,extra:unsupported}),{code:'CACHE_FORMAT'})
})
