import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageHandlers, removeDeniedPage } from '../win/electron/pages.cjs'

function setup(overrides = {}) {
  const record = { id: 'page:1', source: 'collectives', kind: 'page', title: 'Handbook', readonly: true, collectionId: 'knowledge', body: 'Previously cached text', remote: { nativeId: 10, collectiveId: 2 } }
  const context = { mode: 'live', connection: { connected: true }, cache: { records: [record, { id: 'note:1', source: 'notes', kind: 'note' }], collections: [{ id: 'knowledge', source: 'collectives' }], statuses: [{ source: 'collectives', state: 'connected' }] }, client: { readPage: async () => ({ body: '# Fresh Markdown', etag: 'new', contentType: 'text/markdown', appPassword: 'never expose', remote: { path: '/private' } }) }, ...overrides }
  const denied = []
  const handlers = createPageHandlers({ getContext: () => context, onAccessDenied: async (item, error) => { denied.push(item.id); context.cache = removeDeniedPage(context.cache, item, error) } })
  return { handlers, context, record, denied }
}

test('lazy page reads use the trusted cached record and expose only body and ETag', async () => {
  const setupResult = setup()
  let argument
  setupResult.context.client.readPage = async record => { argument = record; return { body: '# Handbook', etag: 'version', remote: record.remote, appPassword: 'private' } }
  assert.deepEqual(await setupResult.handlers.readPage({ id: 'page:1' }), { body: '# Handbook', etag: 'version' })
  assert.equal(argument, setupResult.record)
  assert.equal(setupResult.context.cache.records[0].body, 'Previously cached text', 'Fetched body is not persisted for stale offline reading')
})

test('page bridge rejects arbitrary transport fields, wrong kinds, missing IDs and disconnected reads', async () => {
  const { handlers, context } = setup()
  for (const input of [{ id: 'page:1', remote: { href: 'https://attacker.example' } }, { id: 'note:1' }, { id: 'missing' }, { href: 'https://attacker.example' }, null]) await assert.rejects(handlers.readPage(input))
  context.connection.connected = false
  await assert.rejects(handlers.readPage({ id: 'page:1' }), /Connect Nextcloud/)
})

test('transient source failure allows fresh authorized reads but never returns cached text on network failure', async () => {
  const { handlers, context } = setup()
  context.cache.statuses[0].state = 'error'
  context.client.readPage = async () => { throw Object.assign(new Error('Offline'), { code: 'NETWORK' }) }
  await assert.rejects(handlers.readPage({ id: 'page:1' }), /Offline/)
  assert.equal(context.cache.records.length, 2)
  context.client.readPage = async () => ({ body: 'Fresh authorized content' })
  assert.deepEqual(await handlers.readPage({ id: 'page:1' }), { body: 'Fresh authorized content' })
})

test('confirmed denied or revoked pages cannot be fetched using stale metadata', async () => {
  const { handlers, context } = setup()
  context.client.readPage = async () => assert.fail('Known denied pages must not be requested')
  context.cache.statuses[0].permissionDenied = true
  await assert.rejects(handlers.readPage({ id: 'page:1' }), /Access.*removed/)
  context.cache.statuses[0] = { source: 'collectives', state: 'error', revokedCollectionIds: ['knowledge'] }
  await assert.rejects(handlers.readPage({ id: 'page:1' }), /Access.*removed/)
})

test('fresh permission denial removes the affected cached page and keeps other source records', async () => {
  const { handlers, context, denied } = setup()
  context.client.readPage = async () => { throw Object.assign(new Error('Forbidden'), { code: 'PERMISSION', status: 403 }) }
  await assert.rejects(handlers.readPage({ id: 'page:1' }), /Forbidden/)
  assert.deepEqual(denied, ['page:1'])
  assert.deepEqual(context.cache.records.map(record => record.id), ['note:1'])
  assert.equal(context.cache.statuses[0].state, 'error')
  await assert.rejects(handlers.readPage({ id: 'page:1' }), /no longer available/)
})

test('authentication rejection purges knowledge collections and marks the source denied', async () => {
  const { handlers, context } = setup()
  context.client.readPage = async () => { throw Object.assign(new Error('Reconnect'), { code: 'AUTH', status: 401 }) }
  await assert.rejects(handlers.readPage({ id: 'page:1' }), /Reconnect/)
  assert.deepEqual(context.cache.collections, [])
  assert.equal(context.cache.statuses[0].permissionDenied, true)
})

test('disconnected knowledge pages cannot return cached bodies as a substitute for Nextcloud', async () => {
  for (const mode of ['disconnected', 'demo']) {
    const { handlers } = setup({ mode, connection: { connected: false }, client: null })
    await assert.rejects(handlers.readPage({ id: 'page:1' }), /Connect Nextcloud/)
  }
})

test('page images expose only a raster data URL and cannot expose executable or remote responses', async () => {
  const { handlers, context, record } = setup()
  context.client.readPageAsset = async (item, path) => {
    assert.equal(item, record); assert.equal(path, 'attachments/photo.png')
    return { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', href: '/private', appPassword: 'secret' }
  }
  assert.deepEqual(await handlers.readPageAsset({ id: 'page:1', path: 'attachments/photo.png' }), { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
  for (const dataUrl of ['https://attacker.example/image.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)']) {
    context.client.readPageAsset = async () => ({ dataUrl })
    await assert.rejects(handlers.readPageAsset({ id: 'page:1', path: 'image.png' }), /not a supported image/)
  }
})
