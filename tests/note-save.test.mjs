import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), {status});
const original = {id: 12, title: 'Interview', content: 'Original notes', category: 'Work', etag: 'revision-1', favorite: false};
const record = {id: 'note-12', source: 'notes', title: original.title, body: original.content, etag: original.etag, remote: {nativeId: 12, category: original.category}};
const base = {title: original.title, content: original.content, category: original.category};
const edit = {title: original.title, content: 'Local notes', category: original.category, etag: original.etag, base};
function fixture(handler) {
  const calls = [];
  const client = new NextcloudClient({serverUrl: 'https://cloud.example.test', username: 'user', appPassword: 'test-password'}, {fetch: async (url, options) => {
    calls.push({url, ...options});
    return handler(url, options, calls.length);
  }});
  return {client, calls};
}

test('Notes quotes its JSON ETag exactly once for conditional writes', async () => {
  for (const etag of ['revision-1', '"revision-1"']) {
    const {client, calls} = fixture((url, options) => {
      assert.equal(options.headers['If-Match'], '"revision-1"');
      assert.deepEqual(JSON.parse(options.body), {title: 'Interview', content: 'Local notes', category: 'Work'});
      return reply({...original, content: 'Local notes', etag: 'revision-2'});
    });
    const saved = await client.updateNote({...edit, etag}, record);
    assert.equal(saved.etag, 'revision-2');
    assert.equal(calls.length, 1);
  }
});

test('Notes refuses weak, malformed, or missing validators before any write', async () => {
  const {client, calls} = fixture(() => assert.fail('No request should be made'));
  for (const etag of ['', '*', 'W/"revision-1"', 'W/revision-1', 'revision 1', 'revision\r\nunsafe', '"unclosed']) {
    await assert.rejects(client.updateNote({...edit, etag}, record), {code: 'CONFLICT'});
  }
  assert.equal(calls.length, 0);
});

test('Notes retries a metadata-only change with fresh validator without touching favorite', async () => {
  const latest = {...original, favorite: true, etag: 'revision-2'};
  const {client, calls} = fixture((url, options, call) => {
    if (call === 1) return reply(latest, 412);
    assert.equal(options.headers['If-Match'], '"revision-2"');
    assert.deepEqual(JSON.parse(options.body), {content: 'Local notes'});
    return reply({...latest, content: 'Local notes', etag: 'revision-3'});
  });
  const saved = await client.updateNote(edit, record);
  assert.equal(saved.favorite, true);
  assert.equal(saved.content, 'Local notes');
  assert.equal(calls.length, 2);
  assert.equal(record.body, 'Original notes');
});

test('Notes preserves a concurrent category and title while saving local content', async () => {
  const latest = {...original, title: 'Renamed remotely', category: 'New category', etag: 'revision-2'};
  const {client} = fixture((url, options, call) => {
    if (call === 1) return reply(latest, 412);
    const patch = JSON.parse(options.body);
    assert.deepEqual(patch, {content: 'Local notes'});
    return reply({...latest, ...patch, etag: 'revision-3'});
  });
  const saved = await client.updateNote(edit, record);
  assert.equal(saved.title, latest.title);
  assert.equal(saved.category, latest.category);
  assert.equal(saved.content, 'Local notes');
});

test('Notes preserves concurrent content when only the local title changed', async () => {
  const latest = {...original, content: 'Remote notes', etag: 'revision-2'};
  const {client} = fixture((url, options, call) => {
    if (call === 1) return reply(latest, 412);
    const patch = JSON.parse(options.body);
    assert.deepEqual(patch, {title: 'Local title'});
    return reply({...latest, ...patch, etag: 'revision-3'});
  });
  assert.equal((await client.updateNote({...edit, content: original.content, title: 'Local title'}, record)).content, 'Remote notes');
});

test('Notes does not overwrite two different content edits', async () => {
  const {client, calls} = fixture(() => reply({...original, content: 'Remote notes', etag: 'revision-2'}, 412));
  await assert.rejects(client.updateNote(edit, record), error => error.code === 'CONFLICT' && /content.*both places/.test(error.message));
  assert.equal(calls.length, 1);
  assert.equal(record.body, 'Original notes');
});

test('Notes recognizes a desired edit already saved without another PUT', async () => {
  const latest = {...original, content: 'Local notes', favorite: true, etag: 'revision-2'};
  const {client, calls} = fixture(() => reply(latest, 412));
  assert.deepEqual(await client.updateNote(edit, record), latest);
  assert.equal(calls.length, 1);
});

test('Notes uses the frozen editor baseline even after the cache refreshes', async () => {
  const cached = {...record, body: 'Remote notes', etag: 'revision-2'};
  const {client, calls} = fixture((url, options) => {
    assert.equal(options.headers['If-Match'], '"revision-1"');
    return reply({...original, content: cached.body, etag: cached.etag}, 412);
  });
  await assert.rejects(client.updateNote(edit, cached), {code: 'CONFLICT'});
  assert.equal(calls.length, 1);
});

test('Notes refuses an old validator without its matching baseline', async () => {
  const {client, calls} = fixture(() => assert.fail('No request should be made'));
  await assert.rejects(client.updateNote({...edit, base: undefined}, {...record, etag: 'revision-2'}), {code: 'CONFLICT'});
  assert.equal(calls.length, 0);
});

test('Notes can rebase against the unchanged cached record when no explicit baseline is needed', async () => {
  const {client} = fixture((url, options, call) => call === 1
    ? reply({...original, favorite: true, etag: 'revision-2'}, 412)
    : reply({...original, ...JSON.parse(options.body), favorite: true, etag: 'revision-3'}));
  assert.equal((await client.updateNote({...edit, base: undefined}, record)).content, 'Local notes');
});

test('Notes rechecks later conflicts and never overwrites a newer concurrent edit', async () => {
  const {client, calls} = fixture((url, options, call) => reply({...original, content: call === 1 ? original.content : 'New competing edit', etag: `revision-${call + 1}`}, 412));
  await assert.rejects(client.updateNote(edit, record), {code: 'CONFLICT'});
  assert.equal(calls.length, 2);
});

test('Notes bounds retries if the server keeps changing unrelated metadata', async () => {
  const {client, calls} = fixture((url, options, call) => reply({...original, etag: `revision-${call + 1}`}, 412));
  await assert.rejects(client.updateNote(edit, record), error => error.code === 'CONFLICT' && /kept changing/.test(error.message));
  assert.equal(calls.length, 3);
});

test('Notes rejects incomplete or unrelated 412 representations without a retry', async () => {
  for (const latest of [{content: 'Remote notes', etag: 'new'}, {...original, id: 99}, {...original, error: true}, {...original, etag: '*'}]) {
    const {client, calls} = fixture(() => reply(latest, 412));
    await assert.rejects(client.updateNote(edit, record), {code: 'CONFLICT'});
    assert.equal(calls.length, 1);
  }
});

test('Notes stops if a newer representation is read-only', async () => {
  const {client, calls} = fixture(() => reply({...original, readonly: true, etag: 'new'}, 412));
  await assert.rejects(client.updateNote(edit, record), {code: 'PERMISSION'});
  assert.equal(calls.length, 1);
});

test('Notes reads a current snapshot for conflict review without changing cached content', async () => {
  const {client, calls} = fixture((url, options) => {
    assert.ok(url.endsWith('/notes/api/v1/notes/12'));
    assert.equal(options.headers['Cache-Control'], 'no-cache');
    return reply({...original, content: 'Server notes', etag: 'revision-2'});
  });
  assert.equal((await client.readNote(record)).content, 'Server notes');
  assert.equal(record.body, 'Original notes');
  assert.equal(calls.length, 1);
});
