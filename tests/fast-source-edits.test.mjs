import test from 'node:test'
import assert from 'node:assert/strict'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'

const server = 'https://cloud.example.test'
const now = new Date('2026-11-02T12:00:00Z')
const reply = (body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status: 200, headers})
const ics = lines => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n')
function fixture(handler) {
  const calls = []
  const client = new NextcloudClient({serverUrl: server, username: 'fixture', appPassword: 'fixture'}, {now: () => now, fetch: async (url, options) => {calls.push({url, ...options});return handler(url, options)}})
  return {client, calls}
}

test('rapid DAV description and date edits use their successful response and next ETag, without refreshing any source', async () => {
  for (const source of ['tasks', 'calendar']) {
    let revision = 1
    const {client, calls} = fixture((url, options) => {
      assert.equal(url, `${server}/item.ics`)
      assert.equal(options.method, 'PUT', 'A successful write with ETag needs no read request')
      assert.equal(options.headers['If-Match'], `"v${revision}"`)
      return reply('', {ETag: `"v${++revision}"`})
    })
    const kind = source === 'tasks' ? 'VTODO' : 'VEVENT'
    const finish = source === 'tasks' ? 'DUE' : 'DTEND'
    const collection = {id: 'collection', source, title: 'Personal'}
    const raw = ics([`BEGIN:${kind}`, 'UID:item', 'SUMMARY:Keep title', 'DESCRIPTION:- [ ] Check', 'DTSTART:20261102T090000Z', `${finish}:20261102T100000Z`, 'X-KEEP:kept', `END:${kind}`])
    let record = {...client.calendarRecords(raw, `${server}/item.ics`, '"v1"', collection, new Date(0), new Date('2100-01-01'))[0], id: 'durable-id'}
    const before = structuredClone(record)
    record = await client.savedRecord(record, collection, await client.updateDescription({description: '- [x] Check', etag: record.etag}, record))
    assert.equal(record.id, 'durable-id');assert.equal(record.body, '- [x] Check');assert.equal(record.etag, '"v2"')
    record = await client.savedRecord(record, collection, await client.updateRecordDates({[source === 'tasks' ? 'due' : 'end']: '2026-11-02T11:00:00Z', etag: record.etag}, record))
    assert.equal(record.id, 'durable-id');assert.equal(record.body, '- [x] Check');assert.equal(record.etag, '"v3"')
    assert.equal(record[source === 'tasks' ? 'due' : 'end'], '2026-11-02T11:00:00.000Z')
    assert.match(record.remote.raw, /X-KEEP:kept/)
    assert.equal(before.remote.raw, raw, 'Native cached inputs remain immutable')
    assert.equal(calls.length, 2)
  }
})

test('DAV servers omitting a write ETag only reread the edited resource and preserve authoritative server normalization', async () => {
  const raw = ics(['BEGIN:VTODO', 'UID:item', 'SUMMARY:Server title', 'DESCRIPTION:Saved text', 'DUE;VALUE=DATE:20261104', 'END:VTODO'])
  const {client, calls} = fixture((url, options) => {assert.equal(url, `${server}/item.ics`);assert.equal(options.method, undefined);return reply(raw, {ETag: '"server-new"'})})
  const old = {id: 'durable-id', source: 'tasks', etag: '"old"', remote: {href: `${server}/item.ics`, uid: 'item'}}
  const record = await client.savedRecord(old, {id: 'list', title: 'Personal', source: 'tasks'}, {raw: 'Do not trust the submitted body without an ETag', etag: null})
  assert.equal(record.id, old.id);assert.equal(record.title, 'Server title');assert.equal(record.etag, '"server-new"');assert.equal(record.readonly, false)
  assert.equal(calls.length, 1)
})

test('Notes and Deck write responses reconcile only the saved record, with no network listing', async () => {
  const {client, calls} = fixture(() => assert.fail('Successful native response must not fetch sources'))
  const note = {id: 'note-id', source: 'notes', body: 'Old', readonly: false, remote: {nativeId: 137, category: 'Personal'}}
  const savedNote = await client.savedRecord(note, {source: 'notes'}, {id: 137, title: 'Saved title', content: '- [x] Done', etag: 'new', category: 'Personal', modified: 1793620800, favorite: true})
  assert.equal(savedNote.id, note.id);assert.equal(savedNote.body, '- [x] Done');assert.equal(savedNote.etag, 'new');assert.deepEqual(savedNote.tags, ['Favorite'])
  const card = {id: 'card-id', source: 'deck', nativeRelatedIds: [], remote: {nativeId: 7, boardId: 2, stackId: 3}}
  const native = {id: 7, stackId: 4, title: 'Work', description: '- [x] Done', type: 'plain', order: 1, lastModified: 1793620800, done: null, ETag: 'new-card', dependentCards: [8], labels: [{title: 'Focus'}], assignedUsers: [{participant: {uid: 'fixture'}, type: 0}], startdate: '2026-11-02T09:00:00Z', duedate: '2026-11-02T10:00:00Z'}
  const savedCard = await client.savedRecord(card, {source: 'deck', stacks: [{id: '3', title: 'To do'}, {id: '4', title: 'Doing'}]}, native)
  assert.equal(savedCard.id, card.id);assert.equal(savedCard.status, 'Doing');assert.equal(savedCard.stackId, '4');assert.equal(savedCard.etag, 'new-card')
  assert.deepEqual(savedCard.nativeDependencies, [client.id('deck', 8)]);assert.equal(savedCard.nativeRelatedIds, undefined);assert.deepEqual(savedCard.assigneeIds, ['fixture']);assert.equal(savedCard.remote.snapshot, native)
  assert.match(savedCard.identity.locator, /\/stacks\/4\/cards\/7$/)
  assert.equal(calls.length, 0)
})
