import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs';

const server = 'https://cloud.example.test/nextcloud';
const reply = (body, status = 200, headers = {}) => new Response(status === 204 ? null : typeof body === 'string' ? body : JSON.stringify(body), {status, headers});
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const tagXml = ({id, title, assignable = true}) => `<d:response><d:href>/nextcloud/remote.php/dav/systemtags/${id}</d:href><d:propstat><d:prop><oc:id>${id}</oc:id><oc:display-name>${xml(title)}</oc:display-name><oc:user-visible>true</oc:user-visible><oc:can-assign>${assignable}</oc:can-assign></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const tagsReply = tags => reply(`<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">${tags.map(tagXml).join('')}</d:multistatus>`, 207);
const note = {id: 'note', source: 'notes', remote: {nativeId: 137}};
const board = {id: 'board', source: 'deck', color: '#12abef', remote: {nativeId: 2}};
function fixture(handler) {
  const calls = [];
  const client = new NextcloudClient({serverUrl: server, username: 'alex', appPassword: 'fixture'}, {fetch: async(url, options) => {calls.push({url, ...options}); return handler(new URL(url), options);}});
  return {client, calls};
}

test('Opening a note fetches only its assigned tags, never the global catalog', async() => {
  const {client, calls} = fixture((url, options) => {
    assert.equal(url.pathname, '/nextcloud/remote.php/dav/systemtags-relations/files/137');
    assert.equal(options.method, 'PROPFIND');
    return tagsReply([{id: '4', title: 'Visible here'}]);
  });
  const result = await client.readNoteTags(note);
  assert.equal(calls.length, 1);
  assert.deepEqual(result.availableTags, result.tags);
  assert.deepEqual(result.tags.map(tag => tag.title), ['Visible here']);
});

test('Creating a note tag follows native Content-Location and assigns that ID without reading the catalog', async() => {
  let assigned = false;
  const created = {id: '21', title: 'Project brief'};
  const {client, calls} = fixture((url, options) => {
    if (url.pathname.endsWith('/systemtags-relations/files/137')) return tagsReply(assigned ? [created] : []);
    if (options.method === 'POST') {
      assert.equal(url.pathname, '/nextcloud/remote.php/dav/systemtags/');
      assert.deepEqual(JSON.parse(options.body), {name: 'Project brief', userVisible: true, userAssignable: true});
      return reply('', 201, {'Content-Location': '/nextcloud/remote.php/dav/systemtags/21'});
    }
    if (options.method === 'PROPFIND') {
      assert.equal(url.pathname, '/nextcloud/remote.php/dav/systemtags/21');
      assert.equal(options.headers.Depth, '0');
      return tagsReply([created]);
    }
    assert.equal(url.pathname, '/nextcloud/remote.php/dav/systemtags-relations/files/137/21');
    assert.equal(options.method, 'PUT'); assigned = true; return reply('', 204);
  });
  assert.equal((await client.setNoteTags({tagIds: [], newTags: [' Project brief ']}, note)).tags[0].id, '21');
  assert.ok(!calls.some(call => call.method === 'PROPFIND' && call.url.endsWith('/systemtags/')));
});

test('Names already present on Nextcloud reuse native tags with only one fallback lookup per save', async() => {
  const assigned = new Set();
  const existing = [{id: '21', title: 'Client'}, {id: '22', title: 'Freelance'}, {id: '23', title: 'Unrelated instance tag'}];
  const {client, calls} = fixture((url, options) => {
    if (url.pathname.endsWith('/systemtags-relations/files/137')) return tagsReply(existing.filter(tag => assigned.has(tag.id)));
    if (options.method === 'POST') return reply('', 409);
    if (options.method === 'PROPFIND') return tagsReply(existing);
    assert.equal(options.method, 'PUT'); assigned.add(url.pathname.split('/').at(-1)); return reply('', 204);
  });
  const saved = await client.setNoteTags({tagIds: [], newTags: ['client', 'Freelance']}, note);
  assert.deepEqual(saved.tags.map(tag => tag.id), ['21', '22']);
  assert.deepEqual(saved.availableTags.map(tag => tag.id), ['21', '22'], 'The unrelated catalog stays out of the picker response');
  assert.equal(calls.filter(call => call.method === 'PROPFIND' && call.url.endsWith('/systemtags/')).length, 1);
});

test('An account forbidden to create tags can still assign an existing allowed native tag by name', async() => {
  let assigned = false;
  const existing = {id: '31', title: 'Personal'};
  const {client} = fixture((url, options) => {
    if (url.pathname.endsWith('/systemtags-relations/files/137')) return tagsReply(assigned ? [existing] : []);
    if (options.method === 'POST') return reply('', 403);
    if (options.method === 'PROPFIND') return tagsReply([existing]);
    assigned = true; return reply('', 204);
  });
  assert.equal((await client.setNoteTags({tagIds: [], newTags: ['Personal']}, note)).tags[0].id, '31');
});

test('Note tags cached from other loaded notes are resolved by ID without a catalog or duplicate creation', async() => {
  let assigned = false;
  const known = {id: '41', title: 'Team', assignable: true};
  const {client, calls} = fixture((url, options) => {
    if (url.pathname.endsWith('/systemtags-relations/files/137')) return tagsReply(assigned ? [known] : []);
    if (options.method === 'PROPFIND') {assert.ok(url.pathname.endsWith('/systemtags/41')); return tagsReply([known]);}
    assert.equal(options.method, 'PUT'); assigned = true; return reply('', 204);
  });
  client.primeFileMetadata([{source: 'notes', remote: {nativeId: 138}, fileTags: [known]}]);
  assert.equal((await client.setNoteTags({tagIds: [], newTags: ['Team']}, note)).tags[0].id, '41');
  assert.ok(!calls.some(call => call.method === 'POST'));
});

test('Untrusted tag creation locations never receive credentials and overlong native names fail before writes', async() => {
  const {client, calls} = fixture((url, options) => {
    assert.equal(url.origin, 'https://cloud.example.test');
    if (options.method === 'POST') return reply('', 201, {'Content-Location': 'https://attacker.test/systemtags/8'});
    return tagsReply([]);
  });
  await assert.rejects(client.setNoteTags({tagIds: [], newTags: ['x'.repeat(65)]}, note), /64 bytes/);
  await assert.rejects(client.setNoteTags({tagIds: [], newTags: ['ő'.repeat(33)]}, note), /64 bytes/);
  assert.equal(calls.length, 0);
  await assert.rejects(client.setNoteTags({tagIds: [], newTags: ['Allowed']}, note), {code: 'PERMISSION'});
  assert.ok(calls.every(call => call.url.startsWith(`${server}/`)));
});

test('Creating a Deck tag writes a native colored board label and returns its stable ID', async() => {
  const {client, calls} = fixture((url, options) => {
    if (options.method !== 'POST') return reply({id: 2, labels: [], permissions: {PERMISSION_EDIT: true}});
    assert.equal(url.pathname, '/nextcloud/index.php/apps/deck/api/v1.0/boards/2/labels');
    assert.deepEqual(JSON.parse(options.body), {title: 'New project', color: 'ff9988'});
    return reply({id: 17, boardId: 2, title: 'New project', color: 'ff9988'});
  });
  assert.deepEqual(await client.createDeckLabel({title: ' New project ', color: '#ff9988'}, board), {id: '17', title: 'New project', color: '#ff9988'});
  assert.equal(calls.length, 2);
});

test('Deck tag creation reuses fresh board labels and enforces native board permissions', async() => {
  const existing = fixture(() => reply({id: 2, permissions:{PERMISSION_EDIT:true}, labels: [{id: 7, title: 'Client', color: 'aabbcc'}]}));
  assert.equal((await existing.client.createDeckLabel({title: 'client'}, board)).id, '7');
  assert.ok(!existing.calls.some(call => call.method === 'POST'));
  const denied = fixture(() => reply({id: 2, labels: [], permissions: {PERMISSION_EDIT: false}}));
  await assert.rejects(denied.client.createDeckLabel({title: 'No permission'}, board), {code: 'PERMISSION'});
  assert.ok(!denied.calls.some(call => call.method === 'POST'));
  await assert.rejects(denied.client.createDeckLabel({title: 'Bad color', color: 'red'}, board), {code: 'VALIDATION'});
  await assert.rejects(denied.client.createDeckLabel({title: 'x'.repeat(101)}, board), {code: 'VALIDATION'});
});
