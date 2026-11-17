import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '../packages/nextcloud/src/nextcloud.mjs';

const SERVER = 'https://calendar.example.test';
const ROOT = `${SERVER}/remote.php/dav/calendars/fixture/work/`;
const HREF = `${ROOT}work.ics`;
const ETAG = '"original-revision"';
const collection = source => ({id: source, source, title: 'Fixture work', readonly: false});
const ics = lines => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n');
const event = (uid, extra = []) => ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${uid}`, 'DTSTART:20261101T090000Z', 'DTEND:20261101T100000Z', ...extra, 'END:VEVENT'];
const series = count => ics(event('hourly', [`RRULE:FREQ=HOURLY;COUNT=${count}`]));
const range = [new Date('2026-11-01'), new Date('2027-03-01')];
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const row = (href, props) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const wrap = body => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`;
function clientFor(raw, mode = 'propfind-get') {
  return new NextcloudClient({serverUrl: SERVER, username: 'fixture'}, {
    authentication: 'delegated', davReadMode: mode, now: () => new Date('2026-11-12T12:00:00Z'),
    fetch: async (_url, input) => {
      if (input.method === 'PROPFIND') return new Response(wrap(row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') + row(HREF, `<d:resourcetype/><d:getetag>${ETAG}</d:getetag>`)), {status: 207});
      if (input.method === 'REPORT') return new Response(wrap(row(HREF, `<d:getetag>${ETAG}</d:getetag><c:calendar-data>${xml(raw)}</c:calendar-data>`)), {status: 207});
      return new Response(raw, {headers: {ETag: ETAG}});
    },
  });
}

test('cooperative calendar walk preserves exception replacement order, recurrence identity and exact source baseline', async () => {
  const raw = ics([
    ...event('daily', ['RRULE:FREQ=DAILY;COUNT=4', 'EXDATE:20261103T090000Z', 'CATEGORIES:Review', 'COLOR:#0088ff']),
    'BEGIN:VEVENT', 'UID:daily', 'RECURRENCE-ID:20261102T090000Z', 'SUMMARY:Moved first', 'DTSTART:20261102T130000Z', 'DTEND:20261102T140000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:daily', 'RECURRENCE-ID:20261102T090000Z', 'SUMMARY:Moved last', 'DTSTART:20261102T150000Z', 'DTEND:20261102T160000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:daily', 'RECURRENCE-ID:20280101T090000Z', 'SUMMARY:Moved into view', 'DTSTART:20261105T090000Z', 'DTEND:20261105T100000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:detached', 'RECURRENCE-ID:20260101T090000Z', 'SUMMARY:Detached', 'DTSTART;VALUE=DATE:20261106', 'DTEND;VALUE=DATE:20261107', 'END:VEVENT',
    ...event('cancelled', ['STATUS:CANCELLED']),
  ]);
  const client = clientFor(raw), args = [raw, HREF, ETAG, collection('calendar'), ...range];
  const sync = client.calendarRecords(...args), async = await client.calendarRecordsCooperative(...args);
  assert.deepEqual(async, sync);
  assert.deepEqual(async.map(item => item.title), ['daily', 'Moved last', 'daily', 'Moved into view', 'Detached']);
  assert.deepEqual(async.map(item => item.start), ['2026-11-01T09:00:00.000Z', '2026-11-02T15:00:00.000Z', '2026-11-04T09:00:00.000Z', '2026-11-05T09:00:00.000Z', '2026-11-06']);
  assert.equal(async[1].remote.recurrenceId, '2026-11-02T09:00:00Z');
  assert.ok(async.every(item => item.remote.raw === raw && item.etag === ETAG && item.readonly));
});

test('task chunks yield while retaining native completion, tags, read-only flags and Deck projection exclusion', async () => {
  const raw = ics(Array.from({length: 520}, (_, index) => ['BEGIN:VTODO', `UID:${index === 1 ? 'deck-card-17' : `task-${index}`}`, `SUMMARY:Task ${index}`, `STATUS:${index === 0 ? 'COMPLETED' : 'IN-PROCESS'}`, 'PERCENT-COMPLETE:35', 'CATEGORIES:Review,Work', 'COLOR:#0088ff', 'DUE;VALUE=DATE:20261115', 'END:VTODO']).flat());
  const client = clientFor(raw), args = [raw, HREF, ETAG, collection('tasks'), ...range];
  const expected = client.calendarRecords(...args);
  let done = false, heartbeats = 0;
  const timer = setInterval(() => { if (!done) heartbeats++; }, 0);
  try {
    const actual = await client.calendarRecordsCooperative(...args); done = true;
    assert.deepEqual(actual, expected);
    assert.equal(actual.length, 519); assert.equal(actual[0].completed, true);
    assert.deepEqual(actual[0].tags, ['Review', 'Work']);
    assert.ok(actual.every(item => item.readonly && item.remote.raw === raw && item.etag === ETAG));
    assert.ok(heartbeats >= 3, 'a single multi-task resource yields between bounded chunks');
  } finally { clearInterval(timer); }
});

test('both refresh transports yield during one recurrence-heavy resource, before its final records are constructed', async () => {
  for (const mode of ['propfind-get', 'report']) {
    const raw = series(2400), client = clientFor(raw, mode);
    let identities = 0, beforeCompletion;
    const originalIdentity = client.identity.bind(client);
    client.identity = (...args) => { if (args[0] === 'calendar') identities++; return originalIdentity(...args); };
    const originalProjection = client.calendarRecordsCooperative.bind(client);
    client.calendarRecordsCooperative = (...args) => {
      if (args[3].source === 'calendar') setTimeout(() => { beforeCompletion = identities; }, 0);
      return originalProjection(...args);
    };
    const result = await client.readDav('calendar', [{href: ROOT, title: 'Fixture work', components: ['VEVENT'], readonly: false}]);
    assert.equal(result.records.length, 2400, mode); assert.equal(result.warning, undefined, mode);
    assert.ok(beforeCompletion > 0 && beforeCompletion < result.records.length, `${mode}: presentation timer runs during recurrence projection`);
  }
});

test('historical recurrence walking yields even when every occurrence is outside the visible window', async () => {
  const raw = series(4096), client = clientFor(raw);
  let heartbeat = false;
  const timer = setTimeout(() => { heartbeat = true; }, 0);
  try {
    const records = await client.calendarRecordsCooperative(raw, HREF, ETAG, collection('calendar'), new Date('2028-01-01'), new Date('2028-02-01'));
    assert.deepEqual(records, []);
    assert.equal(heartbeat, true, 'yield is based on visited recurrence slots, not only visible projected records');
  } finally { clearTimeout(timer); }
});

test('REPORT yields between tiny resource batches as well as inside a large resource', async () => {
  const body = wrap(Array.from({length: 256}, (_, index) => {
    const raw = ics(['BEGIN:VTODO', `UID:task-${index}`, `SUMMARY:Task ${index}`, 'END:VTODO']);
    return row(`${ROOT}${index}.ics`, `<d:getetag>${ETAG}</d:getetag><c:calendar-data>${xml(raw)}</c:calendar-data>`);
  }).join(''));
  const client = new NextcloudClient({serverUrl: SERVER, username: 'fixture'}, {authentication: 'delegated', fetch: async () => new Response(body, {status: 207})});
  let projected = 0, observedAtYield;
  const original = client.calendarRecordsCooperative.bind(client);
  client.calendarRecordsCooperative = (...args) => {
    if (++projected === 1) setTimeout(() => { observedAtYield = projected; }, 0);
    return original(...args);
  };
  const result = await client.readDav('tasks', [{href: ROOT, title: 'Fixture work', components: ['VTODO'], readonly: false}]);
  assert.equal(result.records.length, 256);
  assert.ok(observedAtYield > 0 && observedAtYield <= 8);
});

test('REPORT deadline during recurrence projection does not continue into another calendar', async () => {
  const client = clientFor(series(2400), 'report');
  let expired = false, requests = 0;
  const context = {checkActive() { if (expired) throw Object.assign(new Error('fixture deadline'), {code: 'TIMEOUT'}); }};
  const originalRequest = client.request.bind(client);
  client.request = (...args) => { requests++; return originalRequest(...args); };
  const originalProjection = client.calendarRecordsCooperative.bind(client);
  client.calendarRecordsCooperative = (...args) => { setTimeout(() => { expired = true; }, 0); return originalProjection(...args); };
  await assert.rejects(client.readDav('calendar', [ROOT, `${ROOT}other/`].map(href => ({href, title: 'Fixture work', components: ['VEVENT'], readonly: false})), context), {code: 'TIMEOUT'});
  assert.equal(requests, 1);
});

test('cancellation during an internal projection checkpoint abandons either refresh transport without partial success', async () => {
  for (const mode of ['propfind-get', 'report']) {
    const raw = series(2400), client = clientFor(raw, mode);
    let active = true, identities = 0, checksAfterCancellation = 0;
    const context = {isActive: () => active, checkActive() { if (!active) { checksAfterCancellation++; throw Object.assign(new Error('cancelled fixture'), {code: 'CANCELLED'}); } }};
    const originalIdentity = client.identity.bind(client);
    client.identity = (...args) => { if (args[0] === 'calendar') identities++; return originalIdentity(...args); };
    const originalProjection = client.calendarRecordsCooperative.bind(client);
    client.calendarRecordsCooperative = (...args) => { setTimeout(() => { active = false; }, 0); return originalProjection(...args); };
    await assert.rejects(client.readDav('calendar', [{href: ROOT, title: 'Fixture work', components: ['VEVENT'], readonly: false}], context), {code: 'CANCELLED'});
    assert.ok(identities > 0 && identities < 128, `${mode}: cancellation stops at the first bounded checkpoint`);
    assert.ok(checksAfterCancellation > 0);
  }
});

test('synchronous and cooperative paths retain the same recurrence expansion limit', async () => {
  const raw = ics(event('unbounded', ['RRULE:FREQ=MINUTELY;COUNT=20001'])), client = clientFor(raw);
  const args = [raw, HREF, ETAG, collection('calendar'), new Date('2028-01-01'), new Date('2028-02-01')];
  assert.throws(() => client.calendarRecords(...args), {code: 'LIMIT'});
  await assert.rejects(client.calendarRecordsCooperative(...args), {code: 'LIMIT'});
});
