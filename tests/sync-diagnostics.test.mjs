import test from 'node:test'
import assert from 'node:assert/strict'
import {NextcloudClient} from '../packages/nextcloud/src/nextcloud.mjs'
import {syncDiagnostic, plannerFailureMessage} from '../packages/nextcloud/src/sync-diagnostics.mjs'

const fail = code => Object.assign(new Error('Host-private diagnostic'), {code})
const empty = () => ({records: [], collections: []})
function fixture() {
  const client = new NextcloudClient({serverUrl: 'https://fixture.invalid/nc', username: 'tester'}, {authentication: 'delegated', fetch: async () => { throw fail('CANCELLED') }})
  client.discovered = true
  client.refreshCapabilities = async () => false
  client.discoverCalendars = async () => []
  for (const method of ['readDav', 'readNotes', 'readDeck', 'readCollectives']) client[method] = async () => empty()
  return client
}

test('diagnostics allow only recognized codes and stages and never expose unknown error text', () => {
  assert.deepEqual(syncDiagnostic(fail('LIMIT'), 'source-read'), {errorCode: 'LIMIT', errorStage: 'source-read'})
  assert.deepEqual(syncDiagnostic(fail('UNKNOWN'), 'source-read'), {errorStage: 'source-read'})
  assert.deepEqual(syncDiagnostic(fail('CANCELLED'), 'unknown'), {})
  assert.doesNotMatch(plannerFailureMessage(fail('UNKNOWN'), 'planner-read'), /Host-private|authorize|network/i)
  assert.match(plannerFailureMessage(fail('PERMISSION'), 'planner-write'), /permissions/)
})

test('native lifecycle cancellation crosses request, discovery, optional branding and reader boundaries', async () => {
  const request = fixture()
  await assert.rejects(request.request('https://fixture.invalid/nc/status.php'), {code: 'CANCELLED'})
  const discovery = fixture(); discovery.discovered = false; discovery.discover = async () => { throw fail('CANCELLED') }
  await assert.rejects(discovery.readAll(), {code: 'CANCELLED'})
  const branding = fixture(); branding.refreshCapabilities = async () => { throw fail('CANCELLED') }
  await assert.rejects(branding.readAll(), {code: 'CANCELLED'})
  for (const method of ['readDav', 'readNotes', 'readDeck', 'readCollectives']) {
    const client = fixture(); client[method] = async () => { throw fail('CANCELLED') }
    await assert.rejects(client.readAll(), {code: 'CANCELLED'})
  }
})

test('incomplete budget scans remain errors with exact cause, distinct from discovery/auth failures', async () => {
  const client = fixture()
  client.readDav = async () => ({...empty(), errorCode: 'LIMIT', warning: '256 MiB resource transfer per scan'})
  const partial = await client.readAll()
  for (const source of ['tasks', 'calendar']) {
    const status = partial.statuses.find(item => item.source === source)
    assert.equal(status.state, 'error'); assert.equal(status.errorCode, 'LIMIT'); assert.equal(status.errorStage, 'source-read')
    assert.match(status.message, /256 MiB/); assert.equal(status.permissionDenied, undefined)
  }
  assert.equal(partial.statuses.find(item => item.source === 'notes').state, 'connected')
  client.discovered = false; client.discover = async () => { throw fail('NETWORK') }
  const discovery = await client.readAll()
  assert.ok(discovery.statuses.every(item => item.errorCode === 'NETWORK' && item.errorStage === 'discovery' && !item.permissionDenied))
})
