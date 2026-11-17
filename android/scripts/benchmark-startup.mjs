import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {createMobileController, cacheKey, launchKey} from '../src/controller.mjs'
import {checkedSourceCache, compactSourceCache, publicSnapshot} from '../src/foundation.mjs'
import {launchCheckpoint, checkedLaunchCheckpoint} from '../src/launch-cache.mjs'

const account = {name: 'benchmark', username: 'benchmark', serverUrl: 'https://benchmark.invalid'}
const state = createEmptyState(), key = cacheKey(account)
state.records = Array.from({length: 2274}, (_, index) => ({
  id: `fixture-${index}`, source: index < 1947 ? 'tasks' : 'calendar', kind: index < 1947 ? 'task' : 'event', title: `Fixture item ${index}`, collectionId: 'fixture',
  remote: {href: `https://benchmark.invalid/remote.php/dav/calendars/benchmark/fixture/${Math.floor(index / 24)}.ics`, raw: `BEGIN:VCALENDAR\n${'x'.repeat(16 * 1024)}\nEND:VCALENDAR`},
}))
state.collections = [{id: 'fixture', source: 'tasks', title: 'Fixture'}]
const source = {version: 1, accountKey: key, records: state.records, collections: state.collections, statuses: state.statuses}
const compact = compactSourceCache(source)
assert.deepEqual(checkedSourceCache(compact, key).records, source.records)
const launch = launchCheckpoint(publicSnapshot({...state, deviceState: {scopeId: 'all'}}), key)
const never = new Promise(() => {}), timings = []
let authCalls = 0, privateReads = 0
for (let i = 0; i < 20; i++) {
  const api = createMobileController({
    native: {getSavedAccount: async () => ({account}), getAccount: async () => {authCalls++; return never}},
    cache: {load: async (locator, validate) => {
      if (locator === launchKey(account)) return validate(structuredClone(launch))
      privateReads++; return never
    }, validatedLoads: true}, makeClient: () => ({}),
    makeMetadataStore: () => ({load: () => never}), openExternal: async () => {},
  })
  const started = performance.now(), snapshot = await api.getState()
  timings.push(performance.now() - started)
  assert.equal(snapshot.records.length, 2274); assert.equal(snapshot.deviceSync.restoring, true)
  api.dispose()
}
timings.sort((a, b) => a - b)
assert.equal(authCalls, 0); assert.equal(privateReads, 0, 'No private restoration task runs before first publication')
console.log(JSON.stringify({fixtureRecords: 2274, repeatedDocumentBytes: 16 * 1024,
  version1Bytes: Buffer.byteLength(JSON.stringify(source)), version2Bytes: Buffer.byteLength(JSON.stringify(compact)),
  rawDocuments: compact.rawDocuments.length, launchBytes: Buffer.byteLength(JSON.stringify(launch)),
  iterations: timings.length, medianFirstSnapshotMs: Number(timings[10].toFixed(2)), p95FirstSnapshotMs: Number(timings[19].toFixed(2)),
  authorizationCallsBeforeFirstSnapshot: authCalls, fullPrivateCache: 'deliberately unresolved', exactRestoredRecords: true,
  evidence: 'Desktop Node synthetic CPU fixture; not physical Android cold-start time or device FPS'}, null, 2))

// Large public bodies formerly travelled in the first-paint cache once per
// recurring occurrence. Notes/pages need only their names until full hydration.
const rich = createEmptyState()
rich.records = [
  ...Array.from({length: 1947}, (_, i) => ({id: `task-${i}`, source: 'tasks', kind: 'task', title: `Task ${i}`, start: '2026-11-12', due: '2026-11-13', body: 'Checklist text '.repeat(600)})),
  ...Array.from({length: 157}, (_, i) => ({id: `event-${i}`, source: 'calendar', kind: 'event', title: `Event ${i}`, start: '2026-11-12T09:00:00Z', end: '2026-11-12T10:00:00Z', body: 'Event details '.repeat(300)})),
  ...Array.from({length: 36}, (_, i) => ({id: `card-${i}`, source: 'deck', kind: 'card', title: `Card ${i}`, body: 'Card description '.repeat(800)})),
  ...Array.from({length: 53}, (_, i) => ({id: `note-${i}`, source: 'notes', kind: 'note', title: `Note ${i}`, body: 'Long note paragraph. '.repeat(5000)})),
  ...Array.from({length: 81}, (_, i) => ({id: `page-${i}`, source: 'collectives', kind: 'page', title: `Page ${i}`, body: 'Collective paragraph. '.repeat(2000)})),
]
rich.theme = {mode: 'dark', backgroundColor: '#17252d', backgroundDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9kAAAAASUVORK5CYII='}
const compactLaunch = launchCheckpoint(rich, key), checked = checkedLaunchCheckpoint(compactLaunch, key)
assert.equal(checked.state.records.length, 2274)
assert.equal(checked.state.theme.backgroundDataUrl, rich.theme.backgroundDataUrl)
assert.deepEqual(checked.state.records.map(item => [item.id, item.title, item.start, item.due, item.end]), rich.records.map(item => [item.id, item.title, item.start, item.due, item.end]))
assert.ok(checked.state.records.every(item => item.body === undefined && item.readonly))
console.log(JSON.stringify({scenario: '2274 records with repeated checklist bodies, 53 long notes, 81 long pages and raster wallpaper', beforeLaunchBytes: Buffer.byteLength(JSON.stringify({version: 1, accountKey: key, state: rich})), afterLaunchBytes: Buffer.byteLength(JSON.stringify(compactLaunch)), restoredTitlesAndDates: 2274, nativeWriteGrants: 0}, null, 2))
