import test from 'node:test';
import assert from 'node:assert/strict';
import {DAV_SCAN_LIMITS, davDownloadReservation, roundRobinDavJobs, DavResourceCache} from '../packages/nextcloud/src/dav-scan-policy.mjs';

test('download reservations bound unknown transfers without modifying caller state', () => {
  const initial = {files: 250, bytes: 16 * 1024 * 1024};
  assert.deepEqual(davDownloadReservation(initial, undefined), {kind: 'reserve', budget: {files: 249, bytes: 14 * 1024 * 1024}, allowance: 2 * 1024 * 1024});
  assert.deepEqual(initial, {files: 250, bytes: 16 * 1024 * 1024});
  for (const exhausted of [{files: 0, bytes: initial.bytes}, {files: 1, bytes: 2 * 1024 * 1024 - 1}]) {
    assert.deepEqual(davDownloadReservation(exhausted, 1), {kind: 'next-batch', budget: exhausted});
  }
  assert.deepEqual(davDownloadReservation(initial, DAV_SCAN_LIMITS.fileBytes + 1), {kind: 'file-too-large', budget: initial});
});

test('round robin collection scheduling never lets an archive starve later task lists', () => {
  const inventories = [{id: 'archive', resources: ['a', 'b', 'c']}, {id: 'tasks', resources: ['x']}, {id: 'empty', resources: []}, {id: 'calendar', resources: ['y', 'z']}];
  assert.deepEqual(roundRobinDavJobs(inventories).map(job => [job.inventory.id, job.resource]), [['archive', 'a'], ['tasks', 'x'], ['calendar', 'y'], ['archive', 'b'], ['calendar', 'z'], ['archive', 'c']]);
  assert.deepEqual(roundRobinDavJobs([]), []);
});

test('raw resource cache requires exact fresh strong ETags and is bounded by LRU bytes and entries', () => {
  const cache = new DavResourceCache({maxBytes: 6, maxEntries: 2});
  const put = (href, etag = '"v1"') => cache.set('collection', href, {etag, raw: 'abc', bytes: 3});
  put('one'); put('two');
  assert.equal(cache.get('collection', 'one', '"v1"').raw, 'abc');
  put('three');
  assert.equal(cache.get('collection', 'two', '"v1"'), undefined, 'least recently used entry is evicted');
  assert.equal(cache.size, 2); assert.equal(cache.bytes, 6);
  assert.equal(cache.get('collection', 'one', '"v2"'), undefined, 'changed validator invalidates the old body');
  assert.equal(cache.bytes, 3);
  put('weak', 'W/"v1"'); assert.equal(cache.size, 1);
  assert.equal(cache.get('collection', 'three', undefined), undefined, 'missing fresh validator cannot reuse a cached body');
  assert.equal(cache.bytes, 0);
});

test('fresh full inventories, revoked collections and authorization purge raw resources', () => {
  const cache = new DavResourceCache();
  const put = (collection, href) => cache.set(collection, href, {etag: '"v1"', raw: 'body', bytes: 4});
  put('one', 'kept'); put('one', 'removed'); put('two', 'other');
  cache.pruneCollection('one', new Set(['kept']));
  assert.equal(cache.get('one', 'removed', '"v1"'), undefined); assert.equal(cache.size, 2);
  cache.retainCollections(new Set(['one'])); assert.equal(cache.size, 1);
  cache.deleteCollection('one'); assert.equal(cache.bytes, 0);
  put('two', 'again'); cache.clear(); assert.equal(cache.size, 0); assert.equal(cache.bytes, 0);
});
