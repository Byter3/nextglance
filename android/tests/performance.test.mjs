import test from 'node:test'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {publicSnapshot} from '../src/foundation.mjs'

test('public state projection handles the reported source volume without copying its private archive', t => {
  const sources = [['tasks', 1947], ['calendar', 157], ['deck', 36], ['notes', 53], ['collectives', 81]]
  const records = sources.flatMap(([source, count]) => Array.from({length: count}, (_, i) => ({
    id: `${source}:${i}`, source, kind: source === 'notes' ? 'note' : 'task', title: `Fixture ${i}`,
    body: 'Fixture description '.repeat(20), tags: ['Fixture'],
    remote: {raw: 'X'.repeat(4096), etag: `etag-${i}`, href: `/${i}`}, identity: {source, key: `${i}`},
  })))
  const state = {records, collections: [], statuses: sources.map(([source]) => ({source, state: 'connected'}))}
  const baseline = () => { const copy = structuredClone(state); for (const record of copy.records) { delete record.remote; delete record.identity } return copy }
  const measure = work => { work(); const times = []; for (let i = 0; i < 20; i++) { const start = performance.now(); work(); times.push(performance.now() - start) } return times.sort((a, b) => a - b)[10] }
  const before = measure(baseline), after = measure(() => publicSnapshot(state))
  assert.equal(publicSnapshot(state).records.length, 2274)
  assert.deepEqual(publicSnapshot(state), baseline())
  // Timing is diagnostic, never a flaky pass/fail threshold or a device-FPS claim.
  t.diagnostic(`2274 synthetic records, 4 KiB private raw each: desktop median legacy clone ${before.toFixed(2)} ms; public projection ${after.toFixed(2)} ms`)
})
