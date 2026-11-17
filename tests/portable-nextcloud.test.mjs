import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {NextcloudClient, beginLogin} from '../packages/nextcloud/src/nextcloud.mjs';
import {NextcloudClient as NodeNextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs';
import {sha256, utf8, utf8Text, base64, byteLength, jsonEqual} from '../packages/nextcloud/src/runtime.mjs';

const credentials = {serverUrl: 'https://cloud.example.test/nextcloud', username: 'árvíz-漢字', appPassword: 'fixture-only-😀'};
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers});
const ocs = data => ({ocs: {meta: {status: 'ok', statuscode: 200}, data}});

test('portable SHA-256 preserves the exact existing account identity hash', () => {
  for (const input of ['', 'abc', 'árvíztűrő tükörfúrógép 😀 漢字', '\ud800', 'a'.repeat(1_000_000), ...Array.from({length: 260}, (_, length) => randomBytes(length))]) {
    assert.equal(sha256(input), createHash('sha256').update(input).digest('hex'));
  }
});

test('portable bytes preserve UTF-8, base64 and byte limits without host shims', () => {
  for (const text of ['', 'árvíz 😀 漢字', '\ufeffJSON', '\ud800', 'x'.repeat(80_000)]) {
    assert.deepEqual([...utf8(text)], [...Buffer.from(text)]);
    assert.equal(base64(utf8(text)), Buffer.from(text).toString('base64'));
    assert.equal(byteLength(text), Buffer.byteLength(text));
    assert.equal(utf8Text(utf8(text)), Buffer.from(text).toString('utf8'));
  }
  for (const input of [new Uint8Array([0xff, 0xfe, 0x80]), new Uint8Array([0xef, 0xbb, 0xbf, 0x61])]) {
    assert.equal(utf8Text(input), Buffer.from(input).toString('utf8'));
  }
});

test('JSON version verification matches Node equality for protocol values', () => {
  const pairs = [
    [{one: 1, two: ['x', null]}, {two: ['x', null], one: 1}],
    [{one: 1}, {one: 2}], [[1, 2], [2, 1]], [{one: undefined}, {}],
    [0, -0], [null, {}], [{one: {two: false}}, {one: {two: false}}],
    [{__proto__: null, a: 1}, {a: 1}],
  ];
  for (const [left, right] of pairs) assert.equal(jsonEqual(left, right), isDeepStrictEqual(left, right));
});

test('Node and portable clients keep identical canonical native identities', async () => {
  const transport = async url => url.includes('/cloud/user') ? reply(ocs({id: 'canonical-ő😀'})) : reply(ocs({capabilities: {}}));
  const portable = new NextcloudClient(credentials, {fetch: transport});
  const node = new NodeNextcloudClient(credentials, {fetch: transport});
  const compare = () => {
    for (const source of ['calendar', 'tasks', 'deck', 'notes', 'collectives']) {
      assert.equal(portable.id(source, '/source/123'), node.id(source, '/source/123'));
      assert.deepEqual(portable.identity(source, 123, 'https://cloud.example.test/item'), node.identity(source, 123, 'https://cloud.example.test/item'));
    }
  };
  compare();
  await portable.discover(); await node.discover();
  compare();
  assert.equal(portable.username, 'canonical-ő😀');
});

test('portable password transport retains UTF-8 authorization and manual redirects', async () => {
  const client = new NextcloudClient(credentials, {fetch: async (_url, options) => {
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from(`${credentials.username}:${credentials.appPassword}`).toString('base64')}`);
    assert.equal(options.redirect, 'manual');
    return reply('hello');
  }});
  assert.equal((await client.request(client.url('read'))).body, 'hello');
  assert.ok(!JSON.stringify(client).includes(credentials.appPassword));
});

test('delegated authentication requires explicit native transport without credentials', async () => {
  const account = {serverUrl: credentials.serverUrl, username: 'canonical', accountUser: 'canonical'};
  assert.throws(() => new NextcloudClient(account), {code: 'VALIDATION'});
  assert.throws(() => new NextcloudClient(account, {authentication: 'delegated'}), {code: 'VALIDATION'});
  assert.throws(() => new NextcloudClient(credentials, {authentication: 'delegated', fetch: async () => reply('')}), {code: 'VALIDATION'});
  const calls = [];
  const client = new NextcloudClient(account, {authentication: 'delegated', fetch: async (url, options) => {
    calls.push({url, options});
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'manual');
    return url.includes('/cloud/user') ? reply(ocs({id: 'canonical'})) : reply(ocs({capabilities: {}}));
  }});
  await client.discover();
  assert.equal(client.username, 'canonical');
  assert.ok(calls.length >= 2);
  await assert.rejects(client.request('https://different.example.test/read'), {code: 'SECURITY'});
});

test('portable transport enforces limits and preserves conditional DAV headers', async () => {
  const client = new NextcloudClient(credentials, {fetch: async (_url, options) => {
    assert.equal(options.method, 'REPORT');
    assert.equal(options.headers['If-Match'], '"exact"');
    return reply('😀😀', 207, {ETag: '"version"'});
  }});
  const options = {method: 'REPORT', headers: {'If-Match': '"exact"'}, maxBytes: 8};
  const response = await client.request(client.url('dav'), options);
  assert.equal(response.body, '😀😀'); assert.equal(response.headers.get('ETag'), '"version"');
  await assert.rejects(client.request(client.url('dav'), {...options, maxBytes: 7}), {code: 'LIMIT'});
});

test('portable sign-in still refuses cross-origin poll endpoints', async () => {
  await assert.rejects(beginLogin(credentials.serverUrl, {fetch: async () => reply({login: `${credentials.serverUrl}/login`, poll: {token: 'fixture', endpoint: 'https://different.example.test/poll'}})}), {code: 'SECURITY'});
});
