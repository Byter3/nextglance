import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileController, cacheKey} from '../android/src/controller.mjs';
import {compactSourceCache} from '../android/src/foundation.mjs';
import {NextcloudClient} from '../packages/nextcloud/src/nextcloud.mjs';
import {createEmptyState} from '../packages/core/src/planner.mjs';

const SERVER = 'https://fixture.invalid/nextcloud';
const ACCOUNT = {name: 'fixture', serverUrl: SERVER, username: 'tester'};
const DAV = `${SERVER}/remote.php/dav/`, PRINCIPAL = `${DAV}principals/users/tester/`, HOME = `${DAV}calendars/tester/`, CALENDAR = `${HOME}work/`;
const NOW = Date.parse('2026-11-22T12:00:00Z');
const SOURCES = ['tasks', 'calendar', 'deck', 'notes', 'collectives'];
const clone = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const row = (href, properties) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const multi = contents => new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${contents}</d:multistatus>`, {status: 207});
const properties = '<d:displayname>Example work</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>';

function fixture({stale = false} = {}) {
  const calls = [], held = deferred(), inventoryStarted = deferred(), notesStarted = deferred(), documents = new Map();
  const raw = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:saved-task\r\nSUMMARY:Saved example task\r\nEND:VTODO\r\nEND:VCALENDAR\r\n';
  const fetch = async (url, input) => {
    const method = input.method || 'GET', headers = new Headers(input.headers);
    calls.push({url, method, depth: headers.get('Depth'), headers, body: input.body});
    if (url.includes('/cloud/user?')) return Response.json({ocs: {meta: {statuscode: 200}, data: {id: 'tester'}}});
    if (url.includes('/cloud/capabilities?')) return Response.json({ocs: {meta: {statuscode: 200}, data: {capabilities: {}}}});
    if (url === DAV) return multi(row(url, `<d:current-user-principal><d:href>${PRINCIPAL}</d:href></d:current-user-principal>`));
    if (url === PRINCIPAL) return multi(row(url, `<c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>`));
    if (url === HOME) return multi(row(CALENDAR, properties));
    if (url === CALENDAR && method === 'PROPFIND') {
      if (headers.get('Depth') === '1') {inventoryStarted.resolve(); await held.promise;}
      return multi(row(CALENDAR, properties));
    }
    if (url.endsWith('/boards?details=true')) return Response.json([]);
    if (url.includes('/apps/notes/api/v1/notes?')) {notesStarted.resolve(); await held.promise; return Response.json([]);}
    if (url.includes('/apps/collectives/')) return Response.json({ocs: {meta: {statuscode: 200}, data: []}});
    if (url.startsWith(CALENDAR) && url.endsWith('.ics')) {
      if (method === 'PUT') {assert.equal(headers.get('If-None-Match'), '*'); documents.set(url, input.body); return new Response(null, {status: 201, headers: {ETag: '"created-1"'}});}
      assert.ok(documents.has(url), 'Only the newly created event may be read; saved source bodies stay local');
      return new Response(documents.get(url), {headers: {ETag: '"created-1"', 'Content-Type': 'text/calendar'}});
    }
    assert.fail(`Unexpected request: ${method} ${url}`);
  };
  const makeClient = () => new NextcloudClient({serverUrl: SERVER, username: ACCOUNT.username, accountUser: ACCOUNT.username}, {authentication: 'delegated', davReadMode: 'propfind-get', fetch, now: () => new Date(NOW)});
  const seed = makeClient();
  const collections = ['tasks', 'calendar'].map(source => ({id: seed.id(source, CALENDAR), source, title: 'Example work', readonly: false, remote: {href: CALENDAR}}));
  const records = seed.calendarRecords(raw, `${CALENDAR}saved-task.ics`, '"saved-1"', collections[0], new Date(NOW - 86_400_000), new Date(NOW + 86_400_000));
  assert.equal(records.length, 1);
  const statuses = SOURCES.map(source => {
    const ageMinutes = source === 'notes' ? 16 : stale && ['tasks', 'calendar'].includes(source) ? 61 : 1;
    return {source, state: 'connected', count: source === 'tasks' ? 1 : 0, lastSyncedAt: new Date(NOW - ageMinutes * 60_000).toISOString()};
  });
  const values = new Map([[cacheKey(ACCOUNT), compactSourceCache({version: 1, accountKey: cacheKey(ACCOUNT), records, collections, statuses, calendarHistoryDays: null})]]);
  const cache = {load: async key => clone(values.get(key) ?? null), save: async (key, value) => values.set(key, clone(value)), remove: async key => values.delete(key)};
  const metadata = {workspace: createEmptyState().workspace, revision: 0, metadata: {ready: true}, storage: {syncStatus: 'synced'}, deviceState: {}};
  const native = {
    getSavedAccount: async () => ({account: ACCOUNT}),
    getAccount: async () => ({account: ACCOUNT, capabilities: {davReadMode: 'propfind-get', nativeEdits: 'notes-dates-scheduling'}}),
    configureSync: async () => ({background: {supported: true, scheduled: true}}),
  };
  const timers = {setTimeout: () => 1, clearTimeout: () => {}};
  const api = createMobileController({native, cache, makeClient, timers, now: () => NOW, deferRestoration: tick, openExternal: async () => {},
    makeMetadataStore: () => ({load: async () => clone(metadata), getState: () => clone(metadata), sync: async () => {}, reconcileRecords: async records => ({...clone(metadata), records, remap: new Map()})}),
  });
  return {api, calls, values, collections, inventoryStarted, notesStarted, held, close: () => {api.dispose(); held.resolve();}};
}

for (const stale of [false, true]) test(`real Android controller and native protocol create an event ${stale ? 'while overdue source inventory is blocked' : 'without reloading recent cached source bodies'}`, {timeout: 10_000}, async t => {
  const f = fixture({stale}); t.after(f.close);
  await f.api.getState();
  await f.api.resumeSync('open');
  await f.notesStarted.promise;
  if (stale) await f.inventoryStarted.promise;
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    state = await f.api.getState();
    if (state.nativeWriteSources.includes('calendar')) break;
    await tick();
  }
  assert.ok(state.nativeWriteSources.includes('calendar'), 'Current permission discovery completes independently');
  assert.ok(state.records.some(record => record.title === 'Saved example task'));
  const lastSyncedAt = state.statuses.find(status => status.source === 'calendar').lastSyncedAt;
  assert.equal(f.calls.filter(call => call.url === CALENDAR && call.depth === '1').length, stale ? 1 : 0);
  assert.equal(f.calls.filter(call => call.url.endsWith('.ics')).length, 0);
  const saved = await f.api.createEvent({collectionId: f.collections[1].id, title: 'Example focus session', start: '2026-11-22T13:00:00Z', end: '2026-11-22T14:00:00Z'});
  assert.ok(saved.records.some(record => record.title === 'Example focus session'));
  assert.ok(saved.records.some(record => record.title === 'Saved example task'));
  assert.equal(saved.statuses.find(status => status.source === 'calendar').lastSyncedAt, lastSyncedAt, 'Targeted creation does not certify an unfinished full refresh');
  assert.equal(f.calls.filter(call => call.url === CALENDAR && call.depth === '0').length, 1, 'The actual native write still freshly verifies its target');
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
  assert.equal(f.calls.filter(call => call.url.endsWith('.ics') && call.method === 'GET').length, 0, 'The acknowledged event revision needs no redundant body download');
  assert.ok(f.values.size > 1, 'Native acknowledgement is durably recorded without waiting for source refresh');
});
