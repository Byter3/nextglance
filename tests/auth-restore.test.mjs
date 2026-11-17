import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { restoreSavedAccount } from '../win/electron/auth-restore.cjs'
import { WorkspaceStore, accountScope } from '@nextspace/nextcloud-node/workspace.mjs'
import { createPlannerWorkspace } from '@nextspace/core/planner.mjs'

const sources = ['tasks', 'calendar', 'deck', 'notes', 'collectives']
const credentials = { serverUrl: 'https://cloud.example.com', username: 'email-login', accountUser: 'actual-account', appPassword: 'fixture-secret' }
const scope = accountScope(credentials.serverUrl, credentials.accountUser)
const initialState = {
  workspace: { ...createPlannerWorkspace(), id: 'my-real-workspace', name: 'Real account workspace', relations: [{ id: 'link', type: 'related', fromId: 'missing-task', toId: 'real-note', label: 'Planning' }], identities: [{ id: 'real-note', source: 'notes', key: 'fixture:note', aliases: ['real-note'] }], properties: { 'real-note': { Topic: 'My project' } }, updatedAt: '2026-09-29T12:00:00Z' },
  records: [{ id: 'real-note', source: 'notes', kind: 'note', title: 'My actual note', body: 'Account data, never sample data' }], collections: [], statuses: sources.map(source => ({ source, state: 'connected', count: source === 'notes' ? 1 : 0 })),
}

async function fixture(t, pointer = { schemaVersion: 1, scope }) {
  const directory = await mkdtemp(join(tmpdir(), 'nextspace-auth-restore-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const credentialDirectory = join(directory, 'credentials')
  const credentialPath = join(directory, 'active-account.json')
  const encryptedPath = join(credentialDirectory, `${scope}.encrypted.json`)
  await mkdir(credentialDirectory)
  await writeFile(credentialPath, JSON.stringify(pointer))
  await writeFile(encryptedPath, JSON.stringify({ schemaVersion: 1, scope, encrypted: Buffer.from('opaque fixture ciphertext').toString('base64') }))
  const actualStore = await WorkspaceStore.open({ dataDir: directory, scope, initialState })
  let calls = 0
  const options = {
    credentialPath, credentialDirectory, accountScope, sources,
    openStore: account => { calls++; return WorkspaceStore.open({ dataDir: directory, scope: account, initialState }) },
    createClient: input => ({ fixture: true, username: input.username }),
    canDecrypt: () => true,
    decrypt: () => JSON.stringify(credentials),
  }
  return { directory, credentialPath, encryptedPath, actualStore, options, openCalls: () => calls }
}

test('decrypt failure preserves the real account workspace offline and leaves encrypted credentials untouched', async t => {
  const setup = await fixture(t)
  const beforeCredentials = await readFile(setup.encryptedPath, 'utf8')
  const beforeWorkspace = await readFile(setup.actualStore.path, 'utf8')
  const result = await restoreSavedAccount({ ...setup.options, decrypt: () => { throw new Error('OS key temporarily unavailable; private details') } })
  assert.equal(result.kind, 'offline')
  assert.equal(result.connection.connected, false)
  assert.equal(result.connection.reconnectRequired, true)
  assert.ok(result.connection.restoreError.includes('preserved'))
  assert.ok(!result.connection.restoreError.includes('private details'))
  assert.equal(result.store.snapshot().workspace.id, 'my-real-workspace')
  assert.equal(result.store.snapshot().cache.records[0].id, 'real-note')
  assert.deepEqual(result.store.snapshot().workspace.relations, initialState.workspace.relations)
  assert.deepEqual(result.store.snapshot().workspace.properties, initialState.workspace.properties)
  assert.equal(await readFile(setup.encryptedPath, 'utf8'), beforeCredentials)
  assert.equal(await readFile(setup.actualStore.path, 'utf8'), beforeWorkspace)
  assert.equal(result.client, null)
})

test('a later retry or reboot restores credentials once the OS key is readable without replacing account data', async t => {
  const setup = await fixture(t)
  const offline = await restoreSavedAccount({ ...setup.options, canDecrypt: () => false })
  const draft = offline.store.snapshot().workspace
  draft.name = 'Local work while reconnecting'
  await offline.store.saveWorkspace(draft, 0)
  const restored = await restoreSavedAccount(setup.options)
  assert.equal(restored.kind, 'restored')
  assert.equal(restored.connection.connected, true)
  assert.equal(restored.connection.username, 'actual-account')
  assert.equal(restored.client.username, 'email-login', 'Authentication retains the original login alias')
  assert.equal(restored.store.snapshot().workspace.name, 'Local work while reconnecting')
  assert.equal(restored.store.snapshot().cache.records[0].id, 'real-note')
  assert.ok(!JSON.stringify(restored.connection).includes('fixture-secret'))
})

test('backward compatible hashed pointers work without guessing a server when decrypt fails', async t => {
  const setup = await fixture(t)
  const offline = await restoreSavedAccount({ ...setup.options, canDecrypt: () => false })
  assert.equal(offline.kind, 'offline')
  assert.equal(offline.connection.serverUrl, undefined)
  assert.equal(offline.connection.username, undefined)
  assert.equal(offline.store.snapshot().cache.records.length, 1)
})

test('optional nonsecret pointer identity is exposed only when it matches the account scope', async t => {
  const setup = await fixture(t, { schemaVersion: 1, scope, serverUrl: credentials.serverUrl, username: credentials.accountUser })
  let offline = await restoreSavedAccount({ ...setup.options, canDecrypt: () => false })
  assert.equal(offline.connection.serverUrl, credentials.serverUrl)
  assert.equal(offline.connection.username, credentials.accountUser)
  await writeFile(setup.credentialPath, JSON.stringify({ schemaVersion: 1, scope, serverUrl: 'https://another.example.com', username: 'not-this-account' }))
  offline = await restoreSavedAccount({ ...setup.options, canDecrypt: () => false })
  assert.equal(offline.connection.serverUrl, undefined)
  assert.equal(offline.connection.username, undefined)
})

test('a missing credential file keeps known account content offline rather than showing samples', async t => {
  const setup = await fixture(t)
  const result = await restoreSavedAccount({ ...setup.options, readFile: async (path, encoding) => {
    if (path === setup.encryptedPath) throw Object.assign(new Error('Missing'), { code: 'ENOENT' })
    return readFile(path, encoding)
  } })
  assert.equal(result.kind, 'offline')
  assert.equal(result.store.snapshot().workspace.name, 'Real account workspace')
  assert.equal(result.store.snapshot().cache.records[0].title, 'My actual note')
})

test('unreadable or invalid account pointers produce an empty non-writing recovery workspace', async t => {
  const setup = await fixture(t)
  for (const contents of ['{broken JSON', JSON.stringify({ schemaVersion: 1, scope: '../escape' })]) {
    await writeFile(setup.credentialPath, contents)
    const result = await restoreSavedAccount(setup.options)
    assert.equal(result.kind, 'recovery')
    assert.equal(result.connection.recoveryOnly, true)
    assert.equal(result.connection.reconnectRequired, true)
    assert.deepEqual(result.store.snapshot().cache.records, [])
    assert.equal(result.store.snapshot().workspace.id, 'connection-recovery')
    await assert.rejects(result.store.saveWorkspace(initialState.workspace, 0), /Reconnect/)
    assert.equal(setup.openCalls(), 0, 'Unknown scope must never open/create an account workspace')
  }
})

test('only the absence of a saved account pointer identifies a first-run or deliberately disconnected state', async t => {
  const setup = await fixture(t)
  const result = await restoreSavedAccount({ ...setup.options, readFile: async () => { throw Object.assign(new Error('Absent'), { code: 'ENOENT' }) } })
  assert.deepEqual(result, { kind: 'none' })
  assert.equal(setup.openCalls(), 0)
})

test('mismatched credential identity never opens another account or discards the actual cache', async t => {
  const setup = await fixture(t)
  const result = await restoreSavedAccount({ ...setup.options, decrypt: () => JSON.stringify({ ...credentials, accountUser: 'different-user' }) })
  assert.equal(result.kind, 'offline')
  assert.equal(result.store.snapshot().cache.records[0].id, 'real-note')
  assert.equal(result.client, null)
  assert.equal(setup.openCalls(), 1)
})
