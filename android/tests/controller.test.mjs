import test from 'node:test'
import assert from 'node:assert/strict'
import {createMobileController, cacheKey} from '../src/controller.mjs'

const A = {name: 'a@example.test', serverUrl: 'https://example.test/nc', username: 'a'}
const B = {...A, name: 'b@example.test', username: 'b'}
const sources = ['tasks', 'calendar', 'deck', 'notes', 'collectives']
const error = code => Object.assign(new Error('Native private diagnostic'), {code})
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return {promise, resolve, reject} }
const tick = () => new Promise(resolve => setImmediate(resolve))
function result(account = A, source = 'notes') {
  const collectionId = `${account.username}-${source}`
  return {records: [{id: `${account.username}-item`, source, kind: source === 'collectives' ? 'page' : 'note', title: account.username, collectionId}], collections: [{id: collectionId, source, title: source}], statuses: sources.map(name => ({source: name, state: 'connected', count: name === source ? 1 : 0, lastSyncedAt: '2026-11-11T10:00:00Z'}))}
}
function fixture({initial = A, cached = result(A), isNative = true} = {}) {
  let current = initial
  const values = new Map(), calls = {save: [], remove: [], read: [], external: []}
  if (initial && cached) values.set(cacheKey(initial), {version: 1, accountKey: cacheKey(initial), ...structuredClone(cached)})
  const native = {
    getAccount: async () => ({account: current}),
    selectAccount: async () => ({account: current}),
    disconnect: async () => { current = null },
  }
  const cache = {
    load: async key => structuredClone(values.get(key)),
    save: async (key, value) => { calls.save.push({key, value: structuredClone(value)}); values.set(key, structuredClone(value)) },
    remove: async key => { calls.remove.push(key); values.delete(key) },
  }
  const clients = new Map()
  const makeClient = account => {
    if (!clients.has(account.username)) clients.set(account.username, {readAll: async () => { calls.read.push(account.username); return result(account) }, readPage: async () => ({body: 'Page'})})
    return clients.get(account.username)
  }
  const api = createMobileController({native, cache, makeClient, isNative, openExternal: async url => calls.external.push(url)})
  return {api, native, cache, calls, values, clients, makeClient, setAccount: value => { current = value }}
}

test('restored cache is scoped, cloned, read-only and visibly stale until refresh', async () => {
  const f = fixture(), state = await f.api.getState()
  assert.equal(state.connection.connected, false)
  assert.equal(state.records[0].readonly, true)
  assert.equal(state.collections[0].readonly, true)
  assert.ok(state.statuses.every(status => status.state === 'unavailable'))
  state.records[0].title = 'Mutated caller'
  assert.equal((await f.api.getState()).records[0].title, 'a')
  const live = await f.api.refresh()
  assert.equal(live.connection.connected, true)
  assert.ok(live.records.every(record => record.readonly === undefined), 'Phase 1 capability gating must not counterfeit native permissions')
  assert.equal(f.values.get(cacheKey(A)).records[0].title, 'a')
})

test('a stopped native refresh preserves verified source state without a false error or cache rewrite', async t => {
  const f = fixture(); t.after(() => f.api.dispose())
  const before = await f.api.refresh(), saves = f.calls.save.length
  f.clients.get(A.username).readAll = async () => { throw error('CANCELLED') }
  const interrupted = await f.api.refresh()
  assert.deepEqual(interrupted.statuses, before.statuses)
  assert.deepEqual(interrupted.records, before.records)
  assert.equal(interrupted.connection.connected, before.connection.connected)
  assert.equal(Boolean(interrupted.connection.reconnectRequired), false)
  assert.equal(f.calls.save.length, saves)
})

test('browser preview never asks native APIs or accepts a connection or write', async () => {
  const f = fixture({isNative: false})
  f.native.getAccount = async () => assert.fail('Native API must not run in preview')
  assert.equal((await f.api.getState()).records.length, 0)
  assert.equal((await f.api.refresh()).connection.connected, false)
  await assert.rejects(f.api.selectAccount(), /Install the Android app/)
  for (const method of ['saveWorkspace', 'createTask', 'createNote', 'updateNote', 'setTaskCompleted', 'connect', 'syncWorkspace', 'exportWorkspace']) await assert.rejects(f.api[method]({}), /read-only/)
  for (const method of ['beginLogin', 'pollLogin']) await assert.rejects(f.api[method]({}), /sign-in is unavailable/)
  assert.equal(f.calls.save.length, 0)
})

test('invalid initialization does not select an invented account and explicit import can recover', async () => {
  const f = fixture({initial: null, cached: null})
  f.native.getAccount = async () => ({account: {username: 'invalid'}})
  assert.equal((await f.api.getState()).connection.connected, false)
  assert.match((await f.api.getState()).connection.restoreError, /unavailable/)
  f.native.getAccount = async () => ({account: B})
  f.native.selectAccount = async () => ({account: B})
  assert.equal((await f.api.selectAccount()).connection.username, 'b')
})

test('a malformed current native account preserves cache instead of silently switching', async () => {
  const f = fixture()
  await f.api.getState()
  f.native.getAccount = async () => ({account: {username: 'invalid'}})
  const state = await f.api.refresh()
  assert.equal(state.connection.username, 'a')
  assert.equal(state.records[0].title, 'a')
  assert.equal(f.calls.remove.length, 0)
  assert.equal(f.values.get(cacheKey(A)).records.length, 1)
})

test('transient and partial source failures retain cached records while removing revoked collections', async () => {
  const cached = result()
  cached.records.push({...cached.records[0], id: 'revoked', collectionId: 'revoked-board'}, {...cached.records[0], id: 'survivor', collectionId: 'other-board'})
  cached.collections.push({id: 'revoked-board', source: 'notes'}, {id: 'other-board', source: 'notes'})
  const f = fixture({cached})
  f.makeClient(A).readAll = async () => ({...result(), records: [{...result().records[0], title: 'Fresh'}], statuses: sources.map(source => ({source, state: source === 'notes' ? 'error' : 'connected', revokedCollectionIds: source === 'notes' ? ['revoked-board'] : []}))})
  const state = await f.api.refresh()
  assert.deepEqual(state.records.map(record => record.id), ['a-item', 'survivor'])
  assert.equal(state.records[0].title, 'Fresh')
  assert.equal(state.statuses.find(status => status.source === 'notes').count, 2)
  assert.equal(state.statuses.find(status => status.source === 'notes').state, 'error')
  assert.ok(!f.values.get(cacheKey(A)).records.some(record => record.id === 'revoked'))
})

test('successful empty sources remove deleted records and denied sources purge cached content', async () => {
  const f = fixture()
  f.makeClient(A).readAll = async () => ({records: [], collections: [], statuses: sources.map(source => ({source, state: 'connected', permissionDenied: source === 'notes'}))})
  const state = await f.api.refresh()
  assert.deepEqual(state.records, [])
  assert.equal(state.statuses.find(status => status.source === 'notes').state, 'error')
  assert.deepEqual(f.values.get(cacheKey(A)).records, [])
})

test('in-flight refresh is deduplicated and a late prior-account result cannot cross accounts', async t => {
  const f = fixture(), late = deferred(), entered = deferred()
  t.after(() => {late.resolve(result(A)); f.api.dispose()})
  let reads = 0
  f.makeClient(A).readAll = async () => { reads++; entered.resolve(); return late.promise }
  const first = f.api.refresh(), second = f.api.refresh()
  await entered.promise; assert.equal(reads, 1)
  f.native.selectAccount = async () => { f.setAccount(B); return {account: B} }
  const selecting = f.api.selectAccount()
  await selecting; assert.equal((await f.api.getState()).connection.username, 'b', 'A cancelled read releases the account barrier without waiting for its obsolete transport')
  late.resolve(result(A)); await Promise.all([first, second, selecting])
  const current = await f.api.getState()
  assert.equal(current.connection.username, 'b')
  assert.deepEqual(current.records.map(record => record.id), ['b-item'])
  assert.ok(f.calls.save.filter(call => call.key === cacheKey(B)).every(call => call.value.records.every(record => record.id === 'b-item')))
})

test('native selection and disconnect execute in order and cannot resurrect a disconnected account', async () => {
  const f = fixture(), selection = deferred(), events = []
  await f.api.getState()
  f.native.selectAccount = async () => { events.push('select'); await selection.promise; f.setAccount(B); return {account: B} }
  f.native.disconnect = async () => { events.push('disconnect'); f.setAccount(null) }
  const select = f.api.selectAccount(); await tick()
  const disconnect = f.api.disconnect(); await tick()
  assert.deepEqual(events, ['select'])
  selection.resolve(); await Promise.all([select, disconnect])
  assert.deepEqual(events, ['select', 'disconnect'])
  const state = await f.api.getState()
  assert.equal(state.mode, 'disconnected'); assert.equal(state.records.length, 0)
})

test('native disconnect failure leaves the previous account and cache intact', async () => {
  const f = fixture()
  await f.api.refresh()
  f.native.disconnect = async () => { throw error('NATIVE') }
  await assert.rejects(f.api.disconnect())
  assert.equal((await f.api.getState()).connection.username, 'a')
  assert.equal(f.values.get(cacheKey(A)).records.length, 1)
})

test('an obsolete failed cache load cannot overwrite the next selected account status', async t => {
  const f = fixture(), loading = deferred(), entered = deferred()
  t.after(() => {loading.resolve(null); f.api.dispose()})
  await f.api.getState()
  const load = f.cache.load
  f.cache.load = async key => {if (key === cacheKey(B)) {entered.resolve(); return loading.promise}; return load(key)}
  f.native.selectAccount = async () => { f.setAccount(B); return {account: B} }
  const first = f.api.selectAccount(); await entered.promise
  f.native.selectAccount = async () => { f.setAccount(A); return {account: A} }
  const second = f.api.selectAccount(); await tick()
  loading.reject(new Error('Obsolete cache failure'))
  await Promise.all([first, second])
  const state = await f.api.getState()
  assert.equal(state.connection.username, 'a')
  assert.ok(!state.storage.message.includes('could not be read'))
})

test('native account drift cannot purge a newer explicit selection back to the prior account', async () => {
  const f = fixture(), loading = deferred()
  await f.api.getState()
  const load = f.cache.load
  f.cache.load = async key => key === cacheKey(B) ? loading.promise : load(key)
  f.setAccount(B)
  const drift = f.api.refresh(); await tick()
  f.native.selectAccount = async () => { f.setAccount(A); return {account: A} }
  const selection = f.api.selectAccount()
  loading.resolve(null); await Promise.all([drift, selection])
  assert.equal((await f.api.getState()).connection.username, 'a')
  assert.ok(f.values.get(cacheKey(A)).records.length)
  assert.ok(!f.calls.remove.includes(cacheKey(A)))
})

test('transient source errors preserve the current cache without exposing native diagnostics', async () => {
  const f = fixture()
  f.makeClient(A).readAll = async () => { throw error('NETWORK') }
  const state = await f.api.refresh()
  assert.equal(state.records[0].title, 'a')
  assert.equal(state.connection.connected, false)
  assert.ok(!JSON.stringify(state).includes('Native private diagnostic'))
  assert.equal(f.calls.remove.length, 0)
})

test('a failed first refresh does not claim that saved items exist', async () => {
  const f = fixture({cached: null})
  f.makeClient(A).readAll = async () => { throw error('NETWORK') }
  const state = await f.api.refresh()
  assert.equal(state.records.length, 0)
  assert.match(state.connection.restoreError, /No saved items are available/)
  assert.ok(!state.connection.restoreError.includes('Cached items remain available'))
})

test('slow old-account revocation cleanup cannot mark the newly selected account offline', async () => {
  const f = fixture(), removing = deferred()
  f.makeClient(A).readAll = async () => { throw error('AUTH') }
  f.cache.remove = async key => { if (key === cacheKey(A)) await removing.promise; f.values.delete(key) }
  const first = f.api.refresh(); await tick()
  f.native.selectAccount = async () => { f.setAccount(B); return {account: B} }
  const selected = f.api.selectAccount(); await tick()
  removing.resolve(); await Promise.all([first, selected])
  const state = await f.api.getState()
  assert.equal(state.connection.username, 'b')
  assert.equal(state.connection.connected, true)
  assert.equal(state.connection.reconnectRequired, undefined)
})

test('failed revoked-cache removal replaces its content with an empty snapshot', async () => {
  const f = fixture()
  f.makeClient(A).readAll = async () => { throw error('AUTH') }
  f.cache.remove = async () => { throw new Error('Device deletion failed') }
  const state = await f.api.refresh()
  assert.equal(state.connection.reconnectRequired, true)
  assert.deepEqual(state.records, [])
  assert.deepEqual(f.values.get(cacheKey(A)).records, [])
})

test('permission-denied page read purges its source and ignores an older refresh', async () => {
  const f = fixture({cached: result(A, 'collectives')}), late = deferred()
  const client = f.makeClient(A)
  client.readAll = async () => result(A, 'collectives')
  await f.api.refresh()
  client.readAll = async () => late.promise
  client.readPage = async () => { throw error('PERMISSION') }
  const refresh = f.api.refresh(); await tick()
  await assert.rejects(f.api.readPage({id: 'a-item'}), {code: 'PERMISSION'})
  late.resolve(result(A, 'collectives')); await refresh
  assert.deepEqual((await f.api.getState()).records, [])
  assert.deepEqual(f.values.get(cacheKey(A)).records, [])
})

test('external navigation blocks executable links and embedded credentials', async () => {
  const f = fixture()
  for (const url of ['javascript:alert(1)', 'file:///private', 'https://user:secret@example.test', 'http://example.test/private']) await assert.rejects(f.api.openExternal(url))
  await f.api.openExternal('https://example.test/nc/')
  assert.deepEqual(f.calls.external, ['https://example.test/nc/'])
})

test('recoverable SSO authorization loss restores real cache and never reads or writes without permission', async () => {
  const f = fixture()
  f.native.getAccount = async () => ({account:A,reconnectRequired:true,restoreError:'Private provider diagnostic'})
  let reads=0; f.makeClient(A).readAll=async()=>{reads++;return result()}
  const initial=await f.api.getState()
  assert.equal(initial.connection.username,'a');assert.equal(initial.connection.reconnectRequired,true)
  assert.equal(initial.records[0].title,'a');assert.equal(initial.records[0].readonly,true)
  await f.api.refresh();await f.api.syncWorkspace()
  assert.equal(reads,0);assert.equal(f.calls.remove.length,0);assert.equal(f.calls.save.length,0)
  assert.doesNotMatch(JSON.stringify(await f.api.getState()),/Private provider diagnostic/)
})

test('invalid saved account identity enters memory-only recovery without file changes', async () => {
  const f=fixture({initial:null,cached:null})
  f.native.getAccount=async()=>({account:null,recoveryOnly:true,reconnectRequired:true})
  const state=await f.api.getState()
  assert.equal(state.connection.recoveryOnly,true);assert.equal(state.storage.syncStatus,'recovery')
  assert.deepEqual(state.records,[]);assert.equal(f.calls.save.length,0)
  await assert.rejects(f.api.saveWorkspace(state.workspace,state.revision),{code:'UNAVAILABLE'})
})

test('theme is validated, cached account-locally, retained on transient reads and cleared explicitly', async () => {
  const f=fixture({cached:{...result(),theme:{color:'#abcdef',backgroundDataUrl:'data:image/svg+xml;base64,PHN2Zz4='}}})
  assert.deepEqual((await f.api.getState()).theme,{color:'#abcdef'})
  f.makeClient(A).readAll=async()=>({...result(),theme:{color:'#112233',dark:true,untrustedStyle:'url(https://tracker.test)'}})
  assert.deepEqual((await f.api.refresh()).theme,{color:'#112233',dark:true})
  assert.deepEqual(f.values.get(cacheKey(A)).theme,{color:'#112233',dark:true})
  f.makeClient(A).readAll=async()=>result()
  assert.deepEqual((await f.api.refresh()).theme,{color:'#112233',dark:true})
  f.makeClient(A).readAll=async()=>({...result(),theme:undefined})
  assert.equal((await f.api.refresh()).theme,undefined)
  assert.equal(f.values.get(cacheKey(A)).theme,undefined)
})
