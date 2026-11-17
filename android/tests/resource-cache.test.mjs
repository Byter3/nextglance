import test from 'node:test'
import assert from 'node:assert/strict'
import {createPreviewResourceCache} from '../src/resource-cache.mjs'

const account = {name: 'a', username: 'a', serverUrl: 'https://example.test/nc'}
const collection = `${account.serverUrl}/remote.php/dav/calendars/a/personal/`
const entry = (href = 'one.ics') => ({version: 1, kind: 'dav', collection, href: collection + href, etag: '"v1"', body: 'native calendar body', bytes: 20})
function files() {
  const values = new Map()
  return {values, keys: async () => [...values.keys()], read: async key => values.get(key) ?? null, write: async (key, value) => values.set(key, value), remove: async key => values.delete(key), size: async key => Buffer.byteLength(values.get(key))}
}
test('portable private resources survive a controller/process recreation and remain account isolated', async () => {
  const store = files(), first = createPreviewResourceCache(store, account)
  await first.put(entry())
  assert.deepEqual(await createPreviewResourceCache(store, account).get(entry()), entry())
  assert.equal(await createPreviewResourceCache(store, {...account, username: 'b', name: 'b'}).get(entry()), null)
  assert.equal(store.values.size, 1)
})
test('inventory pruning removes only verified absent resources and retained account collections', async () => {
  const store = files(), cache = createPreviewResourceCache(store, account)
  await cache.put(entry()); await cache.put(entry('two.ics'))
  await cache.prune({kind: 'dav', collection, hrefs: [entry().href]})
  assert.equal(await cache.get(entry('two.ics')), null); assert.deepEqual(await cache.get(entry()), entry())
  await cache.retainCollections({kind: 'dav', collections: []}); assert.equal(store.values.size, 0)
})
test('corrupt entries are misses and invalid locator/body/ETag never become cached baselines', async () => {
  const store = files(), cache = createPreviewResourceCache(store, account)
  await assert.rejects(cache.put({...entry(), bytes: 999}), {code: 'CACHE_FORMAT'})
  await assert.rejects(cache.put({...entry(), etag: 'W/"v1"'}), {code: 'CACHE_FORMAT'})
  await assert.rejects(cache.get({...entry(), href: 'https://evil.example/native.ics'}), {code: 'CACHE_FORMAT'})
  await cache.put(entry()); store.values.set([...store.values.keys()][0], 'broken')
  assert.equal(await cache.get(entry()), null)
})
test('account cancellation stops queued resource writes and does not clear another account', async () => {
  const store = files(); let active = true
  const cache = createPreviewResourceCache(store, account, () => active)
  await cache.put(entry()); active = false
  await assert.rejects(cache.put(entry('late.ics')), {code: 'CANCELLED'})
  await assert.rejects(cache.clear(), {code: 'CANCELLED'})
  assert.equal(store.values.size, 1)
})

test('a batch of resource writes loads its lazy size index once rather than rescanning every resource', async () => {
  const store = files(), seed = createPreviewResourceCache(store, account)
  await seed.put(entry()); await seed.put(entry('two.ics')); await seed.put(entry('three.ics'))
  let listings = 0, stats = 0
  const counted = {...store, keys: async () => {listings++; return store.keys()}, size: async key => {stats++; return store.size(key)}}
  const restarted = createPreviewResourceCache(counted, account)
  for (let i = 0; i < 100; i++) await restarted.put(entry(`new-${i}.ics`))
  assert.equal(listings, 1); assert.equal(stats, 3)
  await restarted.prune({kind: 'dav', collection, hrefs: [entry('new-99.ics').href]})
  assert.equal(listings, 1); assert.equal(store.values.size, 1)
})
