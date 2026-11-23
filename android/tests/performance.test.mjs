import test from 'node:test'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {publicSnapshot} from '../src/foundation.mjs'

test('public state projection handles thousands of source records without copying their private archive', t => {
  const sources = [['tasks', 2000], ['calendar', 160], ['deck', 40], ['notes', 60], ['collectives', 80]]
  const records = sources.flatMap(([source, count]) => Array.from({length: count}, (_, i) => ({
    id: `${source}:${i}`, source, kind: source === 'notes' ? 'note' : 'task', title: `Fixture ${i}`,
    body: 'Fixture description '.repeat(20), tags: ['Fixture'],
    remote: {raw: 'X'.repeat(4096), etag: `etag-${i}`, href: `/${i}`},
    identity: {source, key: `${i}`, locator: `/${i}`, aliases: [`prior-${i}`]},
  })))
  const state = {records, collections: [], statuses: sources.map(([source]) => ({source, state: 'connected'}))}
  const baseline = () => {
    const copy = structuredClone(state)
    for (const record of copy.records) {
      delete record.remote
      if (record.source === 'tasks' || record.source === 'deck') {
        record.identity = {source: record.source, key: record.identity.key}
      } else {
        delete record.identity
      }
    }
    return copy
  }
  const measure = work => { work(); const times = []; for (let i = 0; i < 20; i++) { const start = performance.now(); work(); times.push(performance.now() - start) } return times.sort((a, b) => a - b)[10] }
  const before = measure(baseline), after = measure(() => publicSnapshot(state))
  assert.equal(publicSnapshot(state).records.length, 2340)
  assert.deepEqual(publicSnapshot(state), baseline())
  // Timing is diagnostic, never a flaky pass/fail threshold or a device-FPS claim.
  t.diagnostic(`2340 synthetic records, 4 KiB private raw each: desktop median full clone ${before.toFixed(2)} ms; public projection ${after.toFixed(2)} ms`)
})
