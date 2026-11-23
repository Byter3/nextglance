import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '../packages/nextcloud/src/nextcloud.mjs';

const SERVER = 'https://fixture.invalid/nextcloud';
const PRINCIPAL = `${SERVER}/remote.php/dav/principals/users/tester/`;
const HOME = `${SERVER}/remote.php/dav/calendars/tester/`;
const CALENDAR = `${HOME}work/`;
const SOURCES = ['tasks', 'calendar', 'deck'];
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status});
const ocs = data => ({ocs: {meta: {status: 'ok', statuscode: 200}, data}});
const row = (href, properties) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const wrap = contents => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${contents}</d:multistatus>`;

function fixture(options = {}) {
  const calls = [], cacheCalls = [];
  const cache = Object.fromEntries(['get', 'put', 'remove', 'prune', 'retainCollections', 'clear'].map(method => [method, async value => {cacheCalls.push({method, value}); return null;}]));
  const client = new NextcloudClient({serverUrl: SERVER, username: 'tester', accountUser: 'tester'}, {
    authentication: 'delegated', resourceCache: cache,
    fetch: async (url, input) => {
      calls.push({url, ...input});
      const custom = await options.handle?.(url, input);
      if (custom) return custom;
      if (url.endsWith('/ocs/v2.php/cloud/user?format=json')) return reply(ocs({id: 'tester'}));
      if (url.endsWith('/ocs/v2.php/cloud/capabilities?format=json')) return reply(ocs({capabilities: {theming: {background: `${SERVER}/background.png`}}}));
      if (url === `${SERVER}/remote.php/dav/`) return reply(wrap(row(url, `<d:current-user-principal><d:href>${PRINCIPAL}</d:href></d:current-user-principal>`)), 207);
      if (url === PRINCIPAL) return reply(wrap(row(url, `<c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>`)), 207);
      if (url === HOME) return reply(wrap(options.empty ? '' : row(CALENDAR, '<d:displayname>Example work</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set><d:sync-token>token-1</d:sync-token>')), 207);
      if (url.endsWith('/boards?details=true')) return reply(options.empty ? [] : [{id: 1, title: 'Example board', permissions: {PERMISSION_EDIT: true}}, {id: 2, title: 'Archived board', archived: true}, {id: 3, title: 'Deleted board', deletedAt: 1}]);
      assert.fail(`Unexpected source-body/theme request: ${input.method || 'GET'} ${url}`);
    },
  });
  return {client, calls, cacheCalls};
}

test('fresh access checks identity and collections without reading content, theme or granting freshness', async () => {
  const {client, calls, cacheCalls} = fixture(), published = [];
  const result = await client.readSourceAccess({onCollections: value => published.push(value)});
  assert.deepEqual(result.verifiedSources, SOURCES);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.collections.map(value => value.source), SOURCES);
  assert.equal(result.collections.length, 3);
  assert.ok(result.collections.every(value => value.readonly === false));
  assert.equal(result.collections.find(value => value.source === 'deck').stacks, undefined);
  assert.equal(result.records, undefined);
  assert.equal(result.statuses, undefined);
  assert.equal(result.lastSyncedAt, undefined);
  assert.equal(result.theme, undefined);
  assert.equal(published.length, 2);
  assert.deepEqual(new Set(published.flatMap(value => value.sources)), new Set(SOURCES));
  assert.equal(calls.length, 6);
  assert.ok(calls.every(value => ['GET', 'PROPFIND'].includes(value.method || 'GET')));
  assert.ok(calls.every(value => value.signal instanceof AbortSignal));
  assert.deepEqual(cacheCalls, [], 'Access verification is not cache reconciliation');
});

test('empty access inventory is verified but provides no writable targets', async () => {
  const {client} = fixture({empty: true});
  assert.deepEqual(await client.readSourceAccess(), {collections: [], verifiedSources: SOURCES, errors: []});
});

test('read-only targets retain current restrictions and duplicate targets cannot certify authority', async () => {
  const readonly = fixture({handle: url => url.endsWith('/boards?details=true') ? reply([{id: 1, title: 'Shared board', permissions: {PERMISSION_EDIT: false}}]) : null});
  const checked = await readonly.client.readSourceAccess({sources: ['deck']});
  assert.deepEqual(checked.verifiedSources, ['deck']);
  assert.equal(checked.collections[0].readonly, true);
  const duplicate = fixture({handle: url => url.endsWith('/boards?details=true') ? reply([{id: 1}, {id: '1'}]) : null});
  const rejected = await duplicate.client.readSourceAccess({sources: ['deck'], onCollections: () => assert.fail('Malformed authority must not publish')});
  assert.deepEqual(rejected.verifiedSources, []);
  assert.deepEqual(rejected.collections, []);
  assert.equal(rejected.errors[0].code, 'FORMAT');
  assert.deepEqual(duplicate.cacheCalls, []);
});

test('transient DAV failure preserves the cache and does not prevent independently verified Deck access', async () => {
  const {client, cacheCalls} = fixture({handle: url => url === HOME ? reply('private upstream response', 503) : null});
  const result = await client.readSourceAccess();
  assert.deepEqual(result.verifiedSources, ['deck']);
  assert.deepEqual(result.collections.map(value => value.source), ['deck']);
  assert.deepEqual(result.errors.map(({source, code}) => ({source, code})), [{source: 'tasks', code: 'NEXTCLOUD'}, {source: 'calendar', code: 'NEXTCLOUD'}]);
  assert.ok(result.errors.every(value => !value.permissionDenied && !value.message.includes('private')));
  assert.deepEqual(cacheCalls, []);
});

test('explicit Deck denial revokes only Deck acceleration and keeps current DAV access', async () => {
  const {client, cacheCalls} = fixture({handle: url => url.endsWith('/boards?details=true') ? reply('', 403) : null});
  const result = await client.readSourceAccess();
  assert.deepEqual(result.verifiedSources, ['tasks', 'calendar']);
  assert.deepEqual(result.errors.map(({source, code, permissionDenied}) => ({source, code, permissionDenied})), [{source: 'deck', code: 'PERMISSION', permissionDenied: true}]);
  assert.deepEqual(cacheCalls, [{method: 'retainCollections', value: {kind: 'deck', collections: []}}]);
});

test('authentication loss during one source invalidates all access results', async () => {
  let release;
  const davPublished = new Promise(resolve => {release = resolve;}), published = [];
  const {client, cacheCalls} = fixture({handle: async url => {
    if (url.endsWith('/boards?details=true')) {await davPublished; return reply('', 401);}
  }});
  const result = await client.readSourceAccess({onCollections: value => {published.push(value); if (value.sources.includes('calendar')) release();}});
  assert.equal(published.length, 1, 'DAV authority was published before the other source lost authorization');
  assert.deepEqual(published[0].sources, ['tasks', 'calendar']);
  assert.deepEqual(result.verifiedSources, []);
  assert.deepEqual(result.collections, []);
  assert.deepEqual(result.errors.map(value => value.source), SOURCES);
  assert.ok(result.errors.every(value => value.code === 'AUTH' && value.permissionDenied));
  assert.deepEqual(cacheCalls, [{method: 'clear', value: undefined}]);
});

test('every access pass rechecks identity even after this client has already discovered sources', async () => {
  let changed = false;
  const {client, cacheCalls, calls} = fixture({handle: url => changed && url.endsWith('/cloud/user?format=json') ? reply(ocs({id: 'different-user'})) : null});
  await client.readSourceAccess({sources: ['deck']});
  changed = true;
  const result = await client.readSourceAccess({sources: ['deck']});
  assert.deepEqual(result.verifiedSources, []);
  assert.deepEqual(result.collections, []);
  assert.equal(result.errors[0].code, 'IDENTITY');
  assert.equal(calls.filter(value => value.url.endsWith('/boards?details=true')).length, 1);
  assert.deepEqual(cacheCalls, [{method: 'clear', value: undefined}]);
});

test('cancellation fences late discovery and invalid source families fail before network activity', async () => {
  let active = true;
  const {client, calls} = fixture({handle: url => {if (url === HOME) active = false;}});
  await assert.rejects(client.readSourceAccess({sources: ['calendar'], isActive: () => active, onCollections: () => assert.fail('Obsolete access must not publish')}), {code: 'CANCELLED'});
  const count = calls.length;
  for (const sources of [[], ['notes'], ['collectives'], ['calendar', 'unknown']]) await assert.rejects(client.readSourceAccess({sources}), {code: 'VALIDATION'});
  assert.equal(calls.length, count);
});

test('access verification stops at its own thirty-second deadline, not the content refresh budget', async () => {
  const originalNow = Date.now;
  let instant = originalNow();
  Date.now = () => instant;
  try {
    const {client, calls} = fixture({handle: url => {if (url.endsWith('/cloud/capabilities?format=json')) instant += 30_001;}});
    const result = await client.readSourceAccess();
    assert.deepEqual(result.verifiedSources, []);
    assert.equal(calls.length, 2);
    assert.ok(result.errors.every(value => value.code === 'TIMEOUT' && !value.message.includes('two-minute')));
  } finally {Date.now = originalNow;}
});
