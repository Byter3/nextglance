import test from 'node:test'
import assert from 'node:assert/strict'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'
import {nativePermissionResponse} from './native-permission-fixtures.mjs'

const SERVER = 'https://cloud.example.test'
const LIST = SERVER + '/remote.php/dav/calendars/tester/tasks/'
const RESOURCE = LIST + 'work.ics'
const ETAG = '"reviewed"'
const REQUEST = {id: 'task-1', etag: ETAG}
const collection = {id: 'list-1', source: 'tasks', remote: {href: LIST}}
const document = ({properties = [], children = [], siblings = [], method = []} = {}) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...method, 'BEGIN:VTODO', 'UID:work-1', 'SUMMARY:Collect feedback',
    ...properties, ...children, 'END:VTODO', ...siblings, 'END:VCALENDAR'].join('\r\n')
const task = (raw = document()) => ({
  id: REQUEST.id, source: 'tasks', kind: 'task', collectionId: collection.id, etag: ETAG,
  remote: {href: RESOURCE, uid: 'work-1', raw},
})
const response = (body = '', status = 200, etag) => new Response(status === 204 ? null : body, {
  status, ...(etag ? {headers: {ETag: etag}} : {}),
})
const properties = (href, etag) => response(
  `<d:multistatus xmlns:d="DAV:"><d:response><d:href>${new URL(href).pathname}</d:href><d:propstat><d:prop><d:getetag>${etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
  207,
)

function fixture(handler, {resources, writable = true} = {}) {
  const calls = []
  const client = new NextcloudClient({serverUrl: SERVER, username: 'tester', appPassword: 'fictional-only'}, {
    resourceCache: resources,
    fetch: async (url, options) => {
      const method = options.method || 'GET'
      calls.push({url, method, headers: options.headers})
      const authority = nativePermissionResponse(url, options)
      if (authority) return writable ? authority : response('', 403)
      return handler(url, method, options)
    },
  })
  return {client, calls}
}

test('deletes the exact reviewed Task resource and invalidates only its DAV cache entry', async () => {
  const raw = document({
    properties: ['STATUS:COMPLETED'],
    children: ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'DESCRIPTION:Task reminder', 'END:VALARM'],
    siblings: ['BEGIN:VTIMEZONE', 'TZID:Etc/UTC', 'END:VTIMEZONE'],
  })
  const removed = []
  const {client, calls} = fixture((url, method, options) => {
    assert.equal(url, RESOURCE)
    assert.equal(options.headers['If-Match'], ETAG)
    if (method === 'DELETE') return response('', 204)
    assert.equal(options.headers['Accept-Encoding'], 'identity')
    assert.equal(options.headers['Cache-Control'], 'no-cache')
    return response(raw.replaceAll('\r\n', '\n'), 200, ETAG)
  }, {resources: {get: () => null, put: () => {}, remove: locator => removed.push(locator), prune: () => {}, retainCollections: () => {}, clear: () => {}}})
  assert.deepEqual(await client.deleteTask(REQUEST, task(raw), collection), {deleted: true})
  assert.deepEqual(calls.map(call => [call.method, call.url]), [
    ['PROPFIND', LIST], ['GET', RESOURCE], ['DELETE', RESOURCE],
  ])
  assert.deepEqual(removed, [{kind: 'dav', collection: LIST, href: RESOURCE}])
})

test('Task deletion rejects stale reviews and resources that contain recurrence, scheduling or more items', async () => {
  const {client, calls} = fixture(() => assert.fail('Invalid task must not issue network requests'))
  for (const etag of [undefined, '*', 'W/"reviewed"', '"other"']) {
    await assert.rejects(client.deleteTask({...REQUEST, etag}, task(), collection), {code: 'CONFLICT'})
  }
  for (const raw of [
    document({properties: ['RRULE:FREQ=DAILY']}),
    document({properties: ['EXRULE:FREQ=DAILY']}),
    document({properties: ['RECURRENCE-ID:20260101T100000Z']}),
    document({properties: ['ATTENDEE:mailto:test@example.invalid']}),
    document({properties: ['ORGANIZER:mailto:test@example.invalid']}),
    document({method: ['METHOD:REQUEST']}),
    document({properties: ['UID:another']}),
    document({siblings: ['BEGIN:VEVENT', 'UID:another', 'END:VEVENT']}),
    document({siblings: ['BEGIN:VTODO', 'UID:another', 'END:VTODO']}),
    document({children: ['BEGIN:VTODO', 'UID:another', 'END:VTODO']}),
    document({siblings: ['BEGIN:VTIMEZONE', 'TZID:Etc/UTC', 'BEGIN:VTODO', 'UID:another', 'END:VTODO', 'END:VTIMEZONE']}),
    document() + '\r\n' + document(),
  ]) await assert.rejects(client.deleteTask(REQUEST, task(raw), collection), {code: 'VALIDATION'})
  await assert.rejects(client.deleteTask(REQUEST, task(document().replace('UID:work-1', 'UID:another')), collection), {code: 'CONFLICT'})
  await assert.rejects(client.deleteTask(REQUEST, task(), {...collection, readonly: true}), {code: 'PERMISSION'})
  await assert.rejects(client.deleteTask(REQUEST, task(), {...collection, remote: {href: LIST + 'different/'} }), {code: 'SECURITY'})
  assert.equal(calls.length, 0)
})

test('Task deletion needs fresh list authority, an unchanged body and exact DAV evidence on ETag mismatch', async () => {
  const denied = fixture(() => assert.fail('Revoked list cannot read or delete a member'), {writable: false})
  await assert.rejects(denied.client.deleteTask(REQUEST, task(), collection), {code: 'PERMISSION'})
  assert.deepEqual(denied.calls.map(call => call.method), ['PROPFIND'])

  const changed = fixture(() => response(document({properties: ['X-DETAIL:changed']}), 200, ETAG))
  await assert.rejects(changed.client.deleteTask(REQUEST, task(), collection), {code: 'CONFLICT'})
  assert.deepEqual(changed.calls.map(call => call.method), ['PROPFIND', 'GET'])

  for (const [davHref, status, expected] of [
    [RESOURCE, 204, null],
    [RESOURCE, 412, 'CONFLICT'],
    [LIST + 'different.ics', 204, 'CONFLICT'],
  ]) {
    const {client, calls} = fixture((url, method, {headers}) => {
      assert.equal(url, RESOURCE)
      if (method === 'PROPFIND') {
        assert.equal(headers.Depth, '0')
        return properties(davHref, ETAG)
      }
      assert.equal(headers['If-Match'], ETAG)
      return method === 'DELETE' ? response('', status) : response(document(), 200, '"representation"')
    })
    const pending = client.deleteTask(REQUEST, task(), collection)
    if (expected) await assert.rejects(pending, {code: expected})
    else assert.deepEqual(await pending, {deleted: true})
    assert.deepEqual(calls.map(call => call.method), [
      'PROPFIND', 'GET', 'PROPFIND', ...(davHref === RESOURCE ? ['DELETE'] : []),
    ])
  }
})

test('Task deletion requires confirmed absence after an ambiguous response and never replays DELETE', async () => {
  for (const [initial, deleted, verify, error] of [
    [404, null, null, null],
    [200, 404, 404, null],
    [200, 202, 404, null],
    [200, 202, 200, 'UNAVAILABLE'],
    [200, 'disconnected', null, 'NETWORK'],
  ]) {
    let reads = 0
    const {client, calls} = fixture((url, method) => {
      assert.equal(url, RESOURCE)
      if (method === 'DELETE') {
        if (deleted === 'disconnected') throw Error('Disconnected')
        return response('', deleted)
      }
      return response(document(), reads++ === 0 ? initial : verify, ETAG)
    })
    const pending = client.deleteTask(REQUEST, task(), collection)
    if (error) await assert.rejects(pending, {code: error})
    else assert.deepEqual(await pending, {deleted: true})
    assert.deepEqual(calls.map(call => call.method), [
      'PROPFIND', 'GET', ...(deleted === null ? [] : ['DELETE']), ...(verify === null ? [] : ['GET']),
    ])
  }
})
