import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import {nativePermissionResponse} from './native-permission-fixtures.mjs';
import { NextcloudClient, beginLogin, pollLogin, normalizeServerUrl } from '@nextspace/nextcloud-node/nextcloud.mjs';

const SERVER = 'https://cloud.example.test';
const NOW = new Date('2026-10-23T12:00:00Z');
const credentials = { serverUrl: SERVER, username: 'login-alias', appPassword: 'private-password' };
const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const ocs = data => ({ ocs: { meta: { status: 'ok', statuscode: 200 }, data } });
const wrap = contents => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${contents}</d:multistatus>`;
const resource = (href, properties, failed = '') => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>${failed}</d:response>`;
const ics = lines => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fixture//EN', ...lines, 'END:VCALENDAR', ''].join('\r\n');
const escapeXml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const calendarItem = (href, raw) => resource(href, `<d:getetag>"version-1"</d:getetag><c:calendar-data>${escapeXml(raw)}</c:calendar-data>`);
const workspace = { schemaVersion: 2, id: 'one', name: 'Personal', spaces: [], projects: [], relations: [], plans: [], identities: [], properties: {}, updatedAt: NOW.toISOString() };

function fixture(handler, config = {}) {
  const calls = [];
  const client = new NextcloudClient({ ...credentials, ...config }, { now: () => NOW, fetch: async (url, options) => {
    calls.push({ url, ...options });
    const authority=nativePermissionResponse(url,options);if(authority)return authority;
    if (url.endsWith('/ocs/v2.php/cloud/user?format=json')) return reply(ocs({ id: 'canonical-user' }));
    if (url.endsWith('/ocs/v2.php/cloud/capabilities?format=json')) return reply(ocs({ capabilities: { notes: { api_version: ['1.3'] } } }));
    return handler(url, options);
  } });
  return { client, calls };
}

test('server URLs enforce HTTPS and reject embedded credentials', () => {
  assert.equal(normalizeServerUrl(`${SERVER}/nextcloud/`), `${SERVER}/nextcloud`);
  assert.equal(normalizeServerUrl('http://localhost:8000'), 'http://localhost:8000');
  for (const value of ['http://cloud.example.test', 'https://user:secret@cloud.example.test', 'https://cloud.example.test?token=secret', 'file:///etc/passwd']) assert.throws(() => normalizeServerUrl(value));
});

test('login endpoints must stay on the selected origin and never follow redirects', async () => {
  let calls = 0;
  await assert.rejects(beginLogin(SERVER, { fetch: async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined);
    return reply({ login: `${SERVER}/login`, poll: { token: 'private-flow-token', endpoint: 'https://attacker.test/poll' } });
  } }), { code: 'SECURITY' });
  assert.equal(calls, 1);
  await assert.rejects(beginLogin(SERVER, { fetch: async () => reply('', 302, { Location: 'https://attacker.test' }) }), { code: 'REDIRECT' });
});

test('login polling handles pending, returns credentials, and rejects a changed server origin', async () => {
  const flow = { serverUrl: SERVER, pollEndpoint: `${SERVER}/poll`, token: 'flow-token' };
  assert.deepEqual(await pollLogin(flow, { fetch: async () => reply('', 404) }), { pending: true });
  const result = await pollLogin(flow, { fetch: async (url, options) => {
    assert.equal(options.body, 'token=flow-token');
    return reply({ server: SERVER, loginName: 'canonical', appPassword: 'password' });
  } });
  assert.deepEqual(result, { pending: false, serverUrl: SERVER, username: 'canonical', appPassword: 'password' });
  await assert.rejects(pollLogin(flow, { fetch: async () => reply({ server: 'https://attacker.test', loginName: 'canonical', appPassword: 'password' }) }), { code: 'SECURITY' });
});

test('discovery uses the canonical OCS identity and keeps secrets out of errors and serialization', async () => {
  const { client, calls } = fixture(() => { throw new Error('private-password Authorization secret'); }, { serverUrl: `${SERVER}/nextcloud` });
  const discovered = await client.discover();
  assert.equal(discovered.username, 'canonical-user');
  assert.deepEqual(discovered.capabilities.notes.api_version, ['1.3']);
  assert.equal(calls[0].url, `${SERVER}/nextcloud/ocs/v2.php/cloud/user?format=json`);
  assert.equal(calls[0].redirect, 'manual');
  assert.ok(calls[0].headers.Authorization.startsWith('Basic '));
  await assert.rejects(client.readNotes(), error => error.code === 'NETWORK' && !error.message.includes('private-password'));
  assert.ok(!JSON.stringify(client).includes('private-password'));
});

test('readAll isolates missing apps, denied access, and failing services', async () => {
  const { client } = fixture(url => {
    if (url.includes('/notes/')) return reply('', 404);
    if (url.includes('/deck/')) return reply('private detail', 403);
    if (url.includes('/collectives/')) return reply('private detail', 503);
    return reply('', 404);
  });
  const result = await client.readAll();
  assert.deepEqual(result.records, []);
  const states = Object.fromEntries(result.statuses.map(s => [s.source, s.state]));
  assert.deepEqual(states, { tasks: 'unavailable', calendar: 'unavailable', notes: 'unavailable', deck: 'error', collectives: 'error' });
  assert.ok(result.statuses.every(s => !s.message.includes('private detail')));
  assert.equal(result.statuses.find(s => s.source === 'deck').permissionDenied, true);
  assert.equal(result.statuses.find(s => s.source === 'collectives').permissionDenied, undefined);
});

test('Notes follows chunk cursors, retains ETags, and groups categories', async () => {
  const { client, calls } = fixture(url => {
    if (url.includes('chunkCursor=next%2Bpage')) return reply([{ id: 2, title: 'Second', category: 'Projects', content: 'two', etag: 'two' }]);
    return reply([{ id: 1, title: 'First', category: 'Projects', content: 'one', etag: 'one', favorite: true }], 200, { 'X-Notes-Chunk-Cursor': 'next+page' });
  });
  const result = await client.readNotes();
  assert.equal(calls.length, 2);
  assert.equal(result.records.length, 2);
  assert.equal(result.collections.length, 1);
  assert.equal(result.records[0].etag, 'one');
  assert.equal(result.records[0].readonly, false);
  assert.deepEqual(result.records[0].tags, ['Favorite']);
});

test('DAV discovery respects multistatus property statuses and omits Deck projections', async () => {
  const { client, calls } = fixture((url, options) => {
    if (url.endsWith('/remote.php/dav/')) return reply(wrap(resource('/remote.php/dav/', '<d:current-user-principal><d:href>/remote.php/dav/principals/users/canonical/</d:href></d:current-user-principal>')), 207);
    if (url.includes('/principals/')) return reply(wrap(resource('/remote.php/dav/principals/users/canonical/', '<c:calendar-home-set><d:href>/remote.php/dav/calendars/canonical/</d:href></c:calendar-home-set>')), 207);
    assert.equal(options.headers.Depth, '1');
    assert.match(options.body, /xmlns:a="http:\/\/apple.com\/ns\/ical\/"/);
    assert.match(options.body, /<a:calendar-color\/>/);
    const props = name => `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${name}</d:displayname><a:calendar-color xmlns:a="http://apple.com/ns/ical/">#A1B2C3FF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/><c:comp name="VTODO"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>`;
    const failed = '<d:propstat><d:prop><d:displayname>Wrong name</d:displayname></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>';
    return reply(wrap(resource('/remote.php/dav/calendars/canonical/personal/', props('Personal &amp; shared'), failed) + resource('/remote.php/dav/calendars/canonical/app-generated--deck--12/', props('Deck board'))), 207);
  });
  const result = await client.discoverCalendars();
  assert.equal(calls.length, 3);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Personal & shared');
  assert.equal(result[0].readonly, false);
  assert.equal(result[0].color, '#a1b2c3');
  assert.deepEqual(result[0].components, ['VEVENT', 'VTODO']);
});

test('DAV hrefs cannot send an authenticated request to another origin', async () => {
  const { client, calls } = fixture(() => reply(wrap(resource('/remote.php/dav/', '<d:current-user-principal><d:href>https://attacker.test/collect</d:href></d:current-user-principal>')), 207));
  await assert.rejects(client.discoverCalendars(), { code: 'SECURITY' });
  assert.equal(calls.length, 1);
});

test('empty DAV calendars and task lists remain connected without a warning', async () => {
  for (const source of ['calendar', 'tasks']) {
    const { client } = fixture(() => reply(wrap(''), 207));
    const result = await client.readDav(source, [{ href: `${SERVER}/remote.php/dav/calendars/user/empty/`, title: 'Empty', components: ['VEVENT', 'VTODO'], readonly: false }]);
    assert.deepEqual(result.records, []);
    assert.equal(result.collections.length, 1);
    assert.equal(result.warning, undefined);
  }
});

test('task REPORT parses calendar data and filters Deck UID duplicates', async () => {
  const task = uid => ics(['BEGIN:VTODO', `UID:${uid}`, 'SUMMARY:Plan trip', 'DUE;VALUE=DATE:20261024', 'STATUS:NEEDS-ACTION', 'CATEGORIES:Home,Travel', 'END:VTODO']);
  const { client } = fixture(() => reply(wrap(calendarItem('/remote.php/dav/calendars/user/tasks/one.ics', task('ordinary')) + calendarItem('/remote.php/dav/calendars/user/tasks/deck.ics', task('deck-card-14'))), 207));
  const result = await client.readDav('tasks', [{ href: `${SERVER}/remote.php/dav/calendars/user/tasks/`, title: 'Personal', components: ['VTODO'], readonly: false }]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].due, '2026-10-24');
  assert.equal(result.records[0].etag, '"version-1"');
  assert.equal(result.records[0].readonly, false);
  assert.deepEqual(result.records[0].tags, ['Home', 'Travel']);
});

test('task completion matches Nextcloud timestamp and status semantics independently of progress', () => {
  const { client } = fixture(() => assert.fail('No network required'));
  const cases = [
    { properties: ['STATUS:COMPLETED'], completed: true, status: 'COMPLETED' },
    { properties: ['COMPLETED:20261022T120000Z'], completed: true, completedAt: '2026-10-22T12:00:00.000Z' },
    { properties: ['STATUS:NEEDS-ACTION', 'COMPLETED:20261022T120000Z', 'PERCENT-COMPLETE:0'], completed: true, completedAt: '2026-10-22T12:00:00.000Z', status: 'NEEDS-ACTION', percent: 0 },
    { properties: ['STATUS:COMPLETED', 'PERCENT-COMPLETE:25'], completed: true, status: 'COMPLETED', percent: 25 },
    { properties: ['PERCENT-COMPLETE:100'], completed: false, percent: 100 },
    { properties: ['STATUS:IN-PROCESS', 'PERCENT-COMPLETE:40'], completed: false, status: 'IN-PROCESS', percent: 40 },
    { properties: ['STATUS:NEEDS-ACTION', 'PERCENT-COMPLETE:40'], completed: false, status: 'NEEDS-ACTION', percent: 40 },
    { properties: ['STATUS:NEEDS-ACTION', 'PERCENT-COMPLETE:0'], completed: false, status: 'NEEDS-ACTION', percent: 0 },
    { properties: ['STATUS:CANCELLED'], completed: false, status: 'CANCELLED' },
    { properties: ['STATUS:CANCELLED', 'PERCENT-COMPLETE:100'], completed: false, status: 'CANCELLED', percent: 100 },
    { properties: ['PERCENT-COMPLETE:101'], completed: false },
    { properties: [], completed: false },
  ];
  for (const item of cases) {
    const raw = ics(['BEGIN:VTODO', 'UID:completion-case', 'SUMMARY:Completion fixture', ...item.properties, 'END:VTODO']);
    const [record] = client.calendarRecords(raw, `${SERVER}/task.ics`, 'tag', { source: 'tasks', id: 'tasks', title: 'Work' }, NOW, NOW);
    assert.equal(record.completed, item.completed, item.properties.join(', '));
    assert.equal(record.completedAt, item.completedAt);
    assert.equal(record.status, item.status);
    assert.equal(record.percentComplete, item.percent);
    assert.equal(record.remote.raw, raw, 'Reading completion must not rewrite the source');
  }
});

test('reopening a timestamp-completed task clears every native completion marker', async () => {
  const raw = ics(['BEGIN:VTODO', 'UID:completed-timestamp', 'COMPLETED:20261022T120000Z', 'PERCENT-COMPLETE:100', 'X-KEEP:preserved', 'END:VTODO']);
  let rewritten;
  const { client } = fixture((url, options) => { rewritten = options.body; return reply('', 200, { ETag: '"next"' }); });
  const [record] = client.calendarRecords(raw, `${SERVER}/task.ics`, '"original"', { source: 'tasks', id: 'tasks', title: 'Work' }, NOW, NOW);
  assert.equal(record.completed, true);
  await client.setTaskCompleted({ completed: false }, record);
  const todo = new ICAL.Component(ICAL.parse(rewritten)).getFirstSubcomponent('vtodo');
  assert.equal(todo.hasProperty('completed'), false);
  assert.equal(todo.getFirstPropertyValue('status'), 'NEEDS-ACTION');
  assert.equal(todo.getFirstPropertyValue('percent-complete'), 99);
  assert.equal(todo.getFirstPropertyValue('x-keep'), 'preserved');
  const [updated] = client.calendarRecords(rewritten, `${SERVER}/task.ics`, '"next"', { source: 'tasks', id: 'tasks', title: 'Work' }, NOW, NOW);
  assert.equal(updated.completed, false);
});

test('agenda expands recurrences across DST, applies EXDATE and moved exceptions', () => {
  const { client } = fixture(() => assert.fail('No network required'));
  const raw = ics([
    'BEGIN:VEVENT', 'UID:weekly', 'SUMMARY:Daily standup', 'DTSTART;TZID=Europe/Budapest:20261023T090000', 'DTEND;TZID=Europe/Budapest:20261023T100000', 'RRULE:FREQ=DAILY;COUNT=5', 'EXDATE;TZID=Europe/Budapest:20261024T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:weekly', 'RECURRENCE-ID;TZID=Europe/Budapest:20261026T090000', 'SUMMARY:Moved standup', 'DTSTART;TZID=Europe/Budapest:20261026T110000', 'DTEND;TZID=Europe/Budapest:20261026T120000', 'END:VEVENT',
  ]);
  const result = client.calendarRecords(raw, `${SERVER}/remote.php/dav/calendars/alex/calendar/event.ics`, 'tag', { source: 'calendar', id: 'calendar', title: 'Work' }, new Date('2026-10-22'), new Date('2026-10-28'));
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(r => r.start), ['2026-10-23T07:00:00.000Z', '2026-10-25T08:00:00.000Z', '2026-10-26T10:00:00.000Z', '2026-10-27T08:00:00.000Z']);
  assert.equal(result[2].title, 'Moved standup');
  assert.equal(result[2].end, '2026-10-26T11:00:00.000Z');
});

test('agenda honors embedded time zones and preserves all-day dates', () => {
  const { client } = fixture(() => assert.fail('No network required'));
  const raw = ics([
    'BEGIN:VTIMEZONE', 'TZID:Custom/Office', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:office', 'SUMMARY:Office', 'DTSTART;TZID=Custom/Office:20261023T090000', 'DTEND;TZID=Custom/Office:20261023T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:holiday', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261024', 'DTEND;VALUE=DATE:20261025', 'END:VEVENT',
  ]);
  const result = client.calendarRecords(raw, `${SERVER}/remote.php/dav/calendars/alex/calendar/event.ics`, 'tag', { source: 'calendar', id: 'calendar', title: 'Work' }, new Date('2026-10-22'), new Date('2026-10-28'));
  assert.equal(result[0].start, '2026-10-23T03:30:00.000Z');
  assert.equal(result[1].start, '2026-10-24');
  assert.equal(result[1].allDay, true);
});

test('task completion preserves custom properties and alarms and uses the original ETag', async () => {
  const raw = ics(['BEGIN:VTODO', 'UID:one', 'SUMMARY:Important', 'DESCRIPTION:Keep this', 'X-NEXTCLOUD-CUSTOM:preserve me', 'SEQUENCE:5', 'STATUS:NEEDS-ACTION', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VTODO']);
  const original = { source: 'tasks', readonly: false, etag: '"original"', remote: { raw, href: `${SERVER}/remote.php/dav/calendars/user/list/task.ics` } };
  const { client, calls } = fixture((url, options) => {
    assert.equal(options.headers['If-Match'], '"original"');
    const todo = new ICAL.Component(ICAL.parse(options.body)).getFirstSubcomponent('vtodo');
    assert.equal(todo.getFirstPropertyValue('x-nextcloud-custom'), 'preserve me');
    assert.equal(todo.getFirstPropertyValue('description'), 'Keep this');
    assert.equal(todo.getFirstSubcomponent('valarm').getFirstPropertyValue('action'), 'DISPLAY');
    assert.equal(todo.getFirstPropertyValue('status'), 'COMPLETED');
    assert.equal(todo.getFirstPropertyValue('sequence'), 6);
    return reply('', 412);
  });
  await assert.rejects(client.setTaskCompleted({ completed: true }, original), { code: 'CONFLICT', status: 412 });
  assert.equal(calls.length, 1);
  assert.equal(original.remote.raw, raw);
  assert.equal(original.etag, '"original"');
});

test('unsupported recurring tasks and missing ETags never trigger writes', async () => {
  const { client, calls } = fixture(() => assert.fail('Must not write'));
  const raw = ics(['BEGIN:VTODO', 'UID:one', 'SUMMARY:Recurring', 'DTSTART:20261023T090000Z', 'RRULE:FREQ=DAILY', 'END:VTODO']);
  await assert.rejects(client.setTaskCompleted({ completed: true }, { source: 'tasks', etag: 'tag', remote: { href: `${SERVER}/task.ics`, raw } }), { code: 'VALIDATION' });
  await assert.rejects(client.updateNote({ title: 'New', content: 'Text' }, { source: 'notes', remote: { nativeId: 1 } }), { code: 'CONFLICT' });
  assert.equal(calls.length, 0);
});

test('Notes writes conditionally and rejects conflicts without retrying or changing the original', async () => {
  const record = { source: 'notes', etag: 'original', body: 'original text', remote: { nativeId: 12 } };
  const { client, calls } = fixture((url, options) => {
    assert.equal(options.headers['If-Match'], '"original"');
    assert.deepEqual(JSON.parse(options.body), { title: 'New title', content: 'Local edit' });
    return reply({ content: 'Other client edit', etag: 'new' }, 412);
  });
  await assert.rejects(client.updateNote({ title: 'New title', content: 'Local edit' }, record), { code: 'CONFLICT' });
  assert.equal(calls.length, 1);
  assert.equal(record.body, 'original text');
});

test('workspace create uses If-None-Match and never overwrites an existing file', async () => {
  const { client, calls } = fixture((url, options) => {
    assert.ok(url.startsWith(`${SERVER}/remote.php/dav/files/canonical-user/Workspace`));
    if (options.method === 'MKCOL') return reply('', 405);
    assert.equal(options.headers['If-None-Match'], '*');
    assert.equal(options.headers['If-Match'], undefined);
    return reply('', 412);
  });
  await assert.rejects(client.writeWorkspace(workspace, null), { code: 'CONFLICT' });
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
});

test('workspace updates use If-Match and retain the newly returned ETag', async () => {
  const { client, calls } = fixture((url, options) => {
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['If-Match'], '"old"');
    assert.equal(options.headers['If-None-Match'], undefined);
    return reply('', 201, { ETag: '"new"' });
  });
  assert.deepEqual(await client.writeWorkspace(workspace, '"old"'), { etag: '"new"' });
  assert.equal(calls.filter(c => c.method === 'MKCOL').length, 0);
});

test('workspace read rejects versionless remote content rather than enabling blind overwrite', async () => {
  const { client } = fixture((url, options) => options.method === 'PROPFIND' ? reply(wrap(resource(new URL(url).pathname, '<d:resourcetype/>')), 207) : reply(workspace));
  await assert.rejects(client.readWorkspace(), { code: 'ETAG_UNAVAILABLE' });
});

test('Collectives uses the versioned OCS API and preserves page hierarchy', async () => {
  const { client, calls } = fixture(url => {
    if (url.endsWith('/collectives?format=json')) return reply(ocs({ collectives: [{ id: 8, name: 'Family & Home' }] }));
    if (url.endsWith('/collectives/8/pages?format=json')) return reply(ocs({ pages: [{ id: 12, title: 'House manual', parentId: 2, linkedPageIds: [13], filePath: 'Guides', fileName: 'House manual.md' }] }));
    assert.fail(`Unexpected route ${url}`);
  });
  const result = await client.readCollectives();
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.includes('/ocs/v2.php/apps/collectives/api/v1.0/'));
  assert.equal(result.records[0].remote.parentId, 2);
  assert.deepEqual(result.records[0].remote.linkedPageIds, [13]);
  assert.ok(result.records[0].url.endsWith('/Family%20%26%20Home/Guides/House%20manual'));
  assert.equal(result.records[0].readonly, true);
});

// Field names and DAV composition mirror Collectives' PageInfo and pageFilePath
// in src/stores/pages.js; custom mount names must never be inferred from titles.
const pageInfo = { id: 12, title: 'House manual', parentId: 2, collectivePath: 'Shared knowledge/🏠 Family & Home', filePath: 'Guides', fileName: 'House manual.md' };
const pageRecord = { id: 'trusted-page', source: 'collectives', kind: 'page', remote: { nativeId: 12, collectiveId: 8, collectivePath: 'Outdated folder', filePath: '', fileName: 'Old name.md' } };
const pageUrl = `${SERVER}/remote.php/dav/files/canonical-user/Shared%20knowledge/%F0%9F%8F%A0%20Family%20%26%20Home/Guides/House%20manual.md`;

test('Collectives reads real Markdown through the fresh PageInfo mount and canonical DAV identity', async () => {
  const markdown = '# House manual\n\n- Water the plants\n- [x] Windows closed\n\n| Room | Notes |\n| --- | --- |\n| Kitchen | **Clean** |';
  const { client, calls } = fixture((url, options) => {
    if (url.endsWith('/collectives/8/pages/12?format=json')) return reply(ocs({ page: pageInfo }));
    assert.equal(url, pageUrl);
    assert.equal(options.method, undefined);
    assert.equal(options.redirect, 'manual');
    return reply(markdown, 200, { 'Content-Type': 'text/markdown; charset=utf-8', ETag: '"page-v2"' });
  });
  const result = await client.readPage(pageRecord);
  assert.deepEqual(result, { body: markdown, etag: '"page-v2"', contentType: 'text/markdown' });
  assert.equal(calls.length, 4);
  assert.ok(!JSON.stringify(result).includes('private-password'));
  assert.ok(!JSON.stringify(result).includes('remote.php'));
});

test('Collectives permission failures propagate before any DAV body or image request', async () => {
  const { client, calls } = fixture(() => reply('sensitive server error', 403));
  await assert.rejects(client.readPage(pageRecord), { code: 'PERMISSION' });
  assert.equal(calls.filter(call => call.url.includes('remote.php')).length, 0);
  await assert.rejects(client.readPageAsset(pageRecord, '.attachments.12/image.png'), { code: 'PERMISSION' });
  assert.equal(calls.filter(call => call.url.includes('remote.php')).length, 0);
});

test('Collectives refuses missing mounts, traversal metadata, changed page IDs and non-text responses', async () => {
  for (const page of [
    { ...pageInfo, collectivePath: undefined },
    { ...pageInfo, collectivePath: '../Other' },
    { ...pageInfo, filePath: '../Other' },
    { ...pageInfo, fileName: '../Other.md' },
    { ...pageInfo, collectivePath: 'https://attacker.test' },
    { ...pageInfo, id: 13 },
  ]) {
    const { client, calls } = fixture(() => reply(ocs({ page })));
    await assert.rejects(client.readPage(pageRecord));
    assert.equal(calls.filter(call => call.url.includes('remote.php')).length, 0);
  }
  const { client } = fixture(url => url.includes('/ocs/') ? reply(ocs({ page: pageInfo })) : reply('<html>Sign in</html>', 200, { 'Content-Type': 'text/html' }));
  await assert.rejects(client.readPage(pageRecord), { code: 'FORMAT' });
});

test('Collectives attached images stay within the collective and require raster signatures', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  const { client, calls } = fixture(url => {
    if (url.includes('/ocs/')) return reply(ocs({ page: pageInfo }));
    assert.equal(url, pageUrl.replace('House%20manual.md', '.attachments.12/photo%20one.png'));
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  });
  assert.deepEqual(await client.readPageAsset(pageRecord, '.attachments.12/photo%20one.png'), { dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  const gets = calls.filter(call => call.url.includes('remote.php')).length;
  for (const path of ['https://attacker.test/image.png', '//attacker.test/image.png', '/remote.php/dav/files/other/image.png', '../../outside.png', '%2e%2e/%2e%2e/outside.png', '%252e%252e/outside.png', 'image.png?download=1', 'folder\\image.png']) {
    await assert.rejects(client.readPageAsset(pageRecord, path), { code: 'SECURITY' });
  }
  assert.equal(calls.filter(call => call.url.includes('remote.php')).length, gets);
  const { client: invalid } = fixture(url => url.includes('/ocs/') ? reply(ocs({ page: pageInfo })) : reply('<svg onload="alert(1)"/>', 200, { 'Content-Type': 'image/png' }));
  await assert.rejects(invalid.readPageAsset(pageRecord, 'image.png'), { code: 'FORMAT' });
});

test('Collectives page and image downloads enforce their content limits', async () => {
  const { client } = fixture(url => url.includes('/ocs/') ? reply(ocs({ page: pageInfo })) : reply('x'.repeat(4 * 1024 * 1024 + 1), 200, { 'Content-Type': 'text/plain' }));
  await assert.rejects(client.readPage(pageRecord), { code: 'LIMIT' });
});

test('CalDAV collection colors are inherited as safe RGB values with a missing-color fallback', async () => {
  const { client } = fixture(() => reply(wrap(''), 207));
  const result = await client.readDav('calendar', [
    { href: `${SERVER}/calendars/purple/`, title: 'Purple', components: ['VEVENT'], color: '#c0a0f088' },
    { href: `${SERVER}/calendars/blue/`, title: 'Blue', components: ['VEVENT'], color: '#06f' },
    { href: `${SERVER}/calendars/invalid/`, title: 'Unknown', components: ['VEVENT'], color: 'url(https://attacker.test)' },
  ]);
  assert.deepEqual(result.collections.map(c => c.color), ['#c0a0f0', '#0066ff', undefined]);
});

test('OCS theming capabilities provide safe instance colors and same-origin HTTPS branding', async () => {
  let theming = { name: 'My home', color: '#AA3377', 'color-text': '#FFF', background: '#123456', logo: `${SERVER}/index.php/apps/theming/logo?v=2` };
  let capabilityStatus = 200;
  const client = new NextcloudClient(credentials, { now: () => NOW, fetch: async url => {
    if (url.includes('/cloud/user?')) return reply(ocs({ id: 'canonical-user' }));
    if (url.includes('/cloud/capabilities?')) return reply(ocs({ capabilities: { theming } }), capabilityStatus);
    return reply('', 404);
  } });
  assert.deepEqual((await client.readAll()).theme, { name: 'My home', color: '#aa3377', textColor: '#ffffff', backgroundColor: '#123456', logoUrl: `${SERVER}/index.php/apps/theming/logo?v=2` });
  theming = { color: 'var(--untrusted)', 'color-text': 'red', logo: 'https://attacker.test/logo', background: 'javascript:alert(1)' };
  assert.equal((await client.readAll()).theme, undefined);
  theming = { background: '/index.php/apps/theming/background?v=5' };
  assert.deepEqual((await client.readAll()).theme, { backgroundUrl: `${SERVER}/index.php/apps/theming/background?v=5` });
  capabilityStatus = 503;
  assert.equal(Object.hasOwn(await client.readAll(), 'theme'), false, 'Temporary failure preserves the cached theme');
  capabilityStatus = 200;
  theming = undefined;
  const removed = await client.readAll();
  assert.equal(Object.hasOwn(removed, 'theme'), true, 'Successful removal is explicit so cached branding can clear');
  assert.equal(removed.theme, undefined);
});

function themedClient(theming, handler = () => reply('', 404)) {
  const calls = [];
  const client = new NextcloudClient(credentials, { now: () => NOW, fetch: async (url, options) => {
    calls.push({ url, ...options });
    if (url.includes('/cloud/user?')) return reply(ocs({ id: 'canonical-user' }));
    if (url.includes('/cloud/capabilities?')) return reply(ocs({ capabilities: { theming } }));
    return handler(url, options);
  } });
  return { client, calls };
}

test('personal Nextcloud theme uses authenticated colors, both palettes, mode and a safe wallpaper', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const { client, calls } = themedClient({ color: '#123456', enabledThemes: ['dark'], background: '/index.php/apps/theming/background', cacheBuster: 'abc123' }, url => {
    if (url.includes('/theme/default.css')) return reply(':root { --color-main-background: #fff; --color-main-text: #222; --color-primary-element: #ac3698; }', 200, { 'Content-Type': 'text/css' });
    if (url.includes('/theme/dark.css')) return reply(':root { --color-main-background: #171717; --color-main-text: #eee; --color-text-maxcontrast: #aaa; --color-primary: #ac3698; --color-primary-text: #fff; --color-background-plain: #123; --color-background-plain-text: #fff; --image-background: url("/index.php/apps/theming/background"); }', 200, { 'Content-Type': 'text/css' });
    if (url.includes('/theming/background')) return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    return reply('', 404);
  });
  const { theme } = await client.discover();
  assert.equal(theme.mode, 'dark');
  assert.equal(theme.color, '#ac3698');
  assert.equal(theme.backgroundColor, '#112233');
  assert.equal(theme.backgroundTextColor, '#ffffff');
  assert.equal(theme.light.surfaceColor, '#ffffff');
  assert.equal(theme.darkPalette.surfaceColor, '#171717');
  assert.equal(theme.darkPalette.mutedColor, '#aaaaaa');
  assert.equal(theme.backgroundDataUrl, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(calls.some(call => call.url.includes('/settings/')), false, 'Recent capabilities provide mode without an HTML request');
  assert.equal(calls.find(call => call.url.includes('/theming/background')).url, `${SERVER}/index.php/apps/theming/background?v=abc123`);
  assert.ok(calls.every(call => (!call.method || call.method === 'GET') && call.headers.Authorization.startsWith('Basic ') && call.redirect === 'manual'));
});

test('older Nextcloud mode comes only from a signed-in user body and solid CSS removes wallpaper', async () => {
  let body = '<html><body id="body-settings" data-theme-light data-themes=light></body></html>';
  const { client, calls } = themedClient({ color: '#0082c9', background: '/old-wallpaper.png' }, url => {
    if (url.includes('/settings/user/theming')) return reply(body, 200, { 'Content-Type': 'text/html' });
    if (url.includes('/theme/default.css')) return reply(':root { --color-main-background: #fff; --color-primary: #a3f; --color-background-plain: #183c41; --image-background: none; }');
    return reply('', 404);
  });
  const { theme } = await client.discover();
  assert.equal(theme.mode, 'light');
  assert.equal(theme.color, '#aa33ff');
  assert.equal(theme.backgroundColor, '#183c41');
  assert.equal(theme.backgroundUrl, undefined);
  assert.equal(calls.some(call => call.url.includes('old-wallpaper')), false);
  body = '<body id="body-login" data-themes="dark">';
  assert.equal((await client.readTheme()).theme.mode, undefined, 'A login screen is not the account appearance');
});

test('theme CSS never injects functions, remote image URLs or arbitrary declarations', async () => {
  const { client, calls } = themedClient({ color: '#123456', enabledThemes: ['default'] }, url => {
    if (url.includes('/theme/')) return reply(':root { --color-main-background: #fff; --color-main-text: url(https://attacker.test); --color-primary-element: var(--hostile); --font-family: malicious; --image-background: url("https://attacker.test/private"); } @import "https://attacker.test/css"; body { --color-main-text: #ff0000; }');
    return reply('', 404);
  });
  const { theme } = await client.discover();
  assert.deepEqual(theme.light, { surfaceColor: '#ffffff' });
  assert.equal(theme.mode, 'system');
  assert.equal(theme.backgroundUrl, undefined);
  assert.ok(calls.every(call => new URL(call.url).origin === SERVER));
  assert.equal(JSON.stringify(theme).includes('attacker'), false);
});

test('wallpaper permissions, invalid MIME signatures, redirects and size limits cannot expose image content', async () => {
  let response = () => reply('<svg onload="alert(1)"></svg>', 200, { 'Content-Type': 'image/svg+xml' });
  const { client } = themedClient({ color: '#123456', enabledThemes: ['light'], background: '/index.php/apps/theming/background' }, url => url.includes('/theming/background') ? response() : reply('', 404));
  await client.discover();
  for (const create of [
    () => reply('<html>Not an image</html>', 200, { 'Content-Type': 'image/png' }),
    () => reply('', 403),
    () => reply('', 302, { Location: 'https://attacker.test/image' }),
    () => new Response(Buffer.alloc(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }),
  ]) {
    response = create;
    const { theme } = await client.readTheme();
    assert.equal(theme.color, '#123456');
    assert.equal(theme.backgroundDataUrl, undefined);
  }
});

test('optional theme outages retain cached appearance without blocking readable source apps', async () => {
  const { client } = themedClient({ color: '#0082c9', enabledThemes: ['default'] }, url => {
    if (url.includes('/theme/')) return reply('', 503);
    if (url.includes('/notes/api/')) return reply([]);
    return reply('', 404);
  });
  const result = await client.readAll();
  assert.equal(Object.hasOwn(result, 'theme'), false);
  assert.equal(result.statuses.find(source => source.source === 'notes').state, 'connected');
});

test('high contrast follows the effective appearance and an enforced first theme wins', async () => {
  const capability = { enabledThemes: ['dark-highcontrast'], cacheBuster: 'version-2' };
  const { client, calls } = themedClient(capability, url => url.includes('/theme/') ? reply(':root { --color-main-background: #000; --color-main-text: #fff; --color-border: #fff; }') : reply('', 404));
  let theme = (await client.discover()).theme;
  assert.equal(theme.mode, 'dark');
  assert.equal(theme.darkPalette.borderColor, '#ffffff');
  assert.equal(theme.highContrast, true);
  assert.deepEqual(calls.filter(call => call.url.includes('/theme/')).map(call => new URL(call.url).pathname), ['/index.php/apps/theming/theme/light-highcontrast.css', '/index.php/apps/theming/theme/dark-highcontrast.css']);
  assert.ok(calls.filter(call => call.url.includes('/theme/')).every(call => new URL(call.url).searchParams.get('v') === 'version-2'));
  calls.length = 0;
  capability.enabledThemes = ['light', 'dark-highcontrast'];
  await client.refreshCapabilities();
  theme = (await client.readTheme()).theme;
  assert.equal(theme.mode, 'light');
  assert.deepEqual(calls.filter(call => call.url.includes('/theme/')).map(call => new URL(call.url).pathname), ['/index.php/apps/theming/theme/default.css', '/index.php/apps/theming/theme/dark.css']);
  assert.equal(theme.highContrast, false, 'enforced ordinary theme clears the contrast flag');
  capability.enabledThemes = ['light-highcontrast'];
  await client.refreshCapabilities();
  theme = (await client.readTheme()).theme;
  assert.equal(theme.mode, 'light');
  assert.equal(theme.highContrast, true);
});

test('wallpaper revalidation reuses only the same authorized image and invalidates revoked or changed images', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const capability = { enabledThemes: ['light'], background: '/wallpaper.png?v=personal-1', cacheBuster: 'server-2' };
  let responseStatus = 200;
  const { client, calls } = themedClient(capability, url => {
    if (!url.includes('wallpaper')) return reply('', 404);
    if (responseStatus === 304) return new Response(null, { status: 304 });
    if (responseStatus !== 200) return reply('', responseStatus);
    return new Response(png, { headers: { 'Content-Type': 'image/png', ETag: '"image-1"', 'Last-Modified': 'Sun, 01 Nov 2026 10:00:00 GMT' } });
  });
  const original = (await client.discover()).theme.backgroundDataUrl;
  assert.equal(new URL(calls.find(call => call.url.includes('wallpaper')).url).searchParams.get('v'), 'personal-1', 'Preserve the user image version from its own URL');
  responseStatus = 304;
  assert.equal((await client.readTheme()).theme.backgroundDataUrl, original);
  let imageRequest = calls.filter(call => call.url.includes('wallpaper')).at(-1);
  assert.equal(imageRequest.headers['If-None-Match'], '"image-1"');
  assert.equal(imageRequest.headers['If-Modified-Since'], 'Sun, 01 Nov 2026 10:00:00 GMT');
  responseStatus = 403;
  assert.equal((await client.readTheme()).theme.backgroundDataUrl, undefined);
  responseStatus = 304;
  assert.equal((await client.readTheme()).theme.backgroundDataUrl, undefined, 'Revoked cached bytes cannot be reused');
  imageRequest = calls.filter(call => call.url.includes('wallpaper')).at(-1);
  assert.equal(imageRequest.headers['If-None-Match'], undefined);
  responseStatus = 200;
  await client.readTheme();
  capability.background = '/wallpaper.png?v=personal-2';
  await client.refreshCapabilities();
  responseStatus = 304;
  assert.equal((await client.readTheme()).theme.backgroundDataUrl, undefined, 'A different wallpaper URL cannot reuse old image bytes');
});

test('capability authentication revoked after discovery marks all source caches denied', async () => {
  let revoked = false;
  const client = new NextcloudClient(credentials, { now: () => NOW, fetch: async url => {
    if (url.includes('/cloud/user?')) return reply(ocs({ id: 'canonical-user' }));
    if (url.includes('/cloud/capabilities?')) return revoked ? reply('', 401) : reply(ocs({ capabilities: {} }));
    assert.fail('A revoked credential must not query source endpoints');
  } });
  await client.discover();
  revoked = true;
  const result = await client.readAll();
  assert.equal(result.statuses.length, 5);
  assert.ok(result.statuses.every(status => status.permissionDenied === true));
  assert.equal(Object.hasOwn(result, 'theme'), true, 'Revoked global access explicitly removes cached personal appearance');
  assert.equal(result.theme, undefined);
});

test('Deck keeps native cards and stack status while ignoring archived cards', async () => {
  const { client } = fixture(url => url.endsWith('/boards?details=true')
    ? reply([{ id: 2, title: 'Renovation', archived: false }])
    : reply([{ id: 3, title: 'Doing', cards: [{ id: 7, title: 'Paint', labels: [{ title: 'House' }] }, { id: 8, title: 'Archive', archived: true }] }]));
  const result = await client.readDeck();
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].status, 'Doing');
  assert.equal(result.records[0].remote.boardId, 2);
  assert.equal(result.records[0].readonly, true);
});

test('Deck completion uses its native done flag independently of the stack name', async () => {
  const { client } = fixture(url => url.endsWith('/boards?details=true')
    ? reply([{ id: 2, title: 'Work', permissions: { PERMISSION_EDIT: true } }])
    : reply([
      { id: 3, title: 'In review', cards: [{ id: 7, title: 'Marked complete', done: '2026-10-22T12:00:00Z' }] },
      { id: 4, title: 'Done', cards: [{ id: 8, title: 'Only moved', done: null }] },
    ]));
  const { records } = await client.readDeck();
  assert.equal(records[0].completed, true);
  assert.equal(records[0].completedAt, '2026-10-22T12:00:00.000Z');
  assert.equal(records[0].status, 'In review');
  assert.equal(records[1].completed, false);
  assert.equal(records[1].completedAt, undefined);
  assert.equal(records[1].status, 'Done');
});

test('createTask creates a native VTODO with an all-day due date and conditional PUT', async () => {
  const { client } = fixture((url, options) => {
    assert.equal(options.headers['If-None-Match'], '*');
    const todo = new ICAL.Component(ICAL.parse(options.body)).getFirstSubcomponent('vtodo');
    assert.equal(todo.getFirstPropertyValue('summary'), 'Buy supplies');
    assert.equal(todo.getFirstPropertyValue('due').isDate, true);
    assert.equal(todo.getFirstPropertyValue('due').toString(), '2026-10-24');
    assert.ok(url.startsWith(`${SERVER}/remote.php/dav/calendars/alex/list/`));
    return reply('', 201, { ETag: '"created"' });
  });
  const result = await client.createTask({ title: 'Buy supplies', due: '2026-10-24' }, { source: 'tasks', readonly: false, remote: { href: `${SERVER}/remote.php/dav/calendars/alex/list/` } });
  assert.equal(result.etag, '"created"');
});

test('restored accounts use canonical IDs while preserving the original login credential', async () => {
  const { client, calls } = fixture(() => reply([]), { accountUser: 'canonical-user' });
  assert.equal(client.username, 'canonical-user');
  const idBefore = client.id('notes', 1);
  await client.discover();
  assert.equal(client.id('notes', 1), idBefore);
  assert.equal(calls[0].headers.Authorization, `Basic ${Buffer.from('login-alias:private-password').toString('base64')}`);
});

test('old Notes API versions are read-only because they do not support conflict protection', async () => {
  const { client } = fixture(() => reply([{ id: 1, title: 'Old API note', etag: 'tag' }], 200, { 'X-Notes-API-Versions': '0.2, 1.1' }));
  assert.equal((await client.readNotes()).records[0].readonly, true);
});

test('invalid calendar dates are rejected before creating a task', async () => {
  const { client, calls } = fixture(() => assert.fail('Must not create invalid dates'));
  await assert.rejects(client.createTask({ title: 'Test', due: '2026-02-30' }, { source: 'tasks', remote: { href: `${SERVER}/remote.php/dav/calendars/alex/list/` } }), { code: 'VALIDATION' });
  assert.equal(calls.length, 0);
});

test('nonrecurring event identities survive rescheduling so workspace relations remain intact', () => {
  const { client } = fixture(() => assert.fail('No network required'));
  const make = start => ics(['BEGIN:VEVENT', 'UID:stable', 'SUMMARY:Appointment', `DTSTART:${start}`, 'END:VEVENT']);
  const read = raw => client.calendarRecords(raw, `${SERVER}/remote.php/dav/calendars/alex/calendar/event.ics`, 'tag', { source: 'calendar', id: 'calendar', title: 'Work' }, new Date('2026-10-22'), new Date('2026-10-28'))[0];
  const before = read(make('20261023T090000Z'));
  const after = read(make('20261024T110000Z'));
  assert.equal(before.id, after.id);
  assert.notEqual(before.start, after.start);
});

test('restored credentials must resolve to the same canonical account before reading any data', async () => {
  const { client, calls } = fixture(() => assert.fail('Must not read another account'), { accountUser: 'expected-user' });
  await assert.rejects(client.discover(), { code: 'IDENTITY' });
  assert.equal(client.username, 'expected-user');
  assert.equal(calls.length, 1);
});

test('authentication revoked during discovery marks every source for cache removal', async () => {
  const client = new NextcloudClient(credentials, { fetch: async () => reply('', 401) });
  const result = await client.readAll();
  assert.equal(result.statuses.length, 5);
  assert.ok(result.statuses.every(status => status.permissionDenied === true && status.state === 'error'));
  assert.deepEqual(result.records, []);
  assert.equal(Object.hasOwn(result, 'theme'), true);
  assert.equal(result.theme, undefined);
});

test('partial Deck permission loss identifies the revoked collection without discarding accessible boards', async () => {
  const { client } = fixture(url => {
    if (url.endsWith('/boards?details=true')) return reply([{ id: 1, title: 'Revoked' }, { id: 2, title: 'Accessible' }]);
    if (url.endsWith('/boards/1/stacks')) return reply('', 403);
    if (url.endsWith('/boards/2/stacks')) return reply([{ id: 3, title: 'Doing', cards: [{ id: 10, title: 'Visible' }] }]);
    if (url.includes('/notes/')) return reply([]);
    if (url.includes('/collectives/')) return reply(ocs({ collectives: [] }));
    return reply('', 404);
  });
  const result = await client.readAll();
  const status = result.statuses.find(s => s.source === 'deck');
  assert.equal(status.state, 'error');
  assert.equal(status.permissionDenied, undefined);
  assert.deepEqual(status.revokedCollectionIds, [client.id('deck', 1)]);
  assert.deepEqual(result.collections.filter(c => c.source === 'deck').map(c => c.title), ['Accessible']);
  assert.deepEqual(result.records.filter(r => r.source === 'deck').map(r => r.title), ['Visible']);
});

test('a DAV permission denial inside a 207 response revokes the affected collection', async () => {
  const { client } = fixture(() => reply(wrap('<d:response><d:href>/calendar/private.ics</d:href><d:status>HTTP/1.1 403 Forbidden</d:status></d:response>'), 207));
  const href = `${SERVER}/remote.php/dav/calendars/alex/calendar/`;
  const result = await client.readDav('tasks', [{ href, title: 'Private', components: ['VTODO'], readonly: false }]);
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.collections, []);
  assert.deepEqual(result.revokedCollectionIds, [client.id('tasks', href)]);
});

test('Deck assignees use canonical user IDs and keep group assignments distinct from unassigned cards', async () => {
  const { client } = fixture(url => url.endsWith('/boards?details=true')
    ? reply([{ id: 2, title: 'Közös', color: 'AABBCC', permissions: { PERMISSION_EDIT: true } }])
    : reply([{ id: 3, title: 'Doing', cards: [
      { id: 7, title: 'Shared responsibility', assignedUsers: [{ participant: { uid: 'canonical-user', displayname: 'Not the ID' }, type: 0 }, { participant: 'partner', type: 0 }], dependentCards: [8, 8], startdate: '2026-10-22T09:00:00Z', duedate: '2026-10-24T12:00:00Z' },
      { id: 8, title: 'For a group', assignedUsers: [{ participant: { uid: 'canonical-user' }, type: 1 }] },
      { id: 9, title: 'Unassigned', assignedUsers: [] },
      { id: 10, title: 'Unknown assignment', assignedUsers: null },
    ] }]));
  const { records, collections } = await client.readDeck();
  assert.deepEqual(records[0].assigneeIds, ['canonical-user', 'partner']);
  assert.equal(records[0].assignmentCount, 2);
  assert.equal(records[0].assignmentKnown, true);
  assert.deepEqual(records[1].assigneeIds, []);
  assert.equal(records[1].assignmentCount, 1);
  assert.equal(records[2].assignmentCount, 0);
  assert.equal(records[2].assignmentKnown, true);
  assert.equal(records[3].assignmentKnown, false);
  assert.equal(records[0].stackId, '3');
  assert.equal(records[0].start, '2026-10-22T09:00:00Z');
  assert.deepEqual(records[0].nativeDependencies, [client.id('deck', 8)]);
  assert.equal(records[0].nativeRelatedIds, undefined, 'Deck dependencies are no longer exposed as generic links');
  assert.equal(records[0].nativeDependents, undefined, 'Deck dependentCards normalize to prerequisites on their owner');
  assert.equal(records[0].readonly, false);
  assert.deepEqual(collections[0].stacks, [{ id: '3', title: 'Doing' }]);
  assert.equal(collections[0].color, '#aabbcc');
});

test('native identities survive title/date/location changes and scope duplicate calendar UIDs', () => {
  const { client } = fixture(() => assert.fail('No network required'));
  const raw = ics(['BEGIN:VEVENT', 'UID:stable', 'SUMMARY:Review', 'DTSTART:20261023T090000Z', 'DTEND:20261023T100000Z', 'END:VEVENT']);
  const parse = (href, collection = 'calendar') => client.calendarRecords(raw, `${SERVER}/${href}.ics`, 'etag', { source: 'calendar', id: collection, title: 'Work' }, new Date('2026-10-22'), new Date('2026-10-28'))[0];
  const before = parse('first');
  const renamed = parse('renamed');
  const copied = parse('copy', 'other-calendar');
  assert.equal(before.identity.key, renamed.identity.key);
  assert.notEqual(before.identity.locator, renamed.identity.locator);
  assert.notEqual(before.identity.key, copied.identity.key);
  assert.ok(before.identity.aliases.includes(before.id));
  assert.ok(before.identity.aliases.some(id => copied.identity.aliases.includes(id)), 'Unscoped UID alias is available only for registry-verified unique moves');
  assert.equal(before.readonly, false);
});

test('calendar recurrence occurrence identity uses the original recurrence slot after rescheduling', () => {
  const { client } = fixture(() => assert.fail('No network required'));
  const make = time => ics([
    'BEGIN:VEVENT', 'UID:daily', 'SUMMARY:Recurring', 'DTSTART:20261023T090000Z', 'DTEND:20261023T100000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:daily', 'RECURRENCE-ID:20261024T090000Z', `DTSTART:20261024T${time}00Z`, 'DTEND:20261024T150000Z', 'END:VEVENT',
  ]);
  const parse = raw => client.calendarRecords(raw, `${SERVER}/daily.ics`, 'etag', { source: 'calendar', id: 'calendar', title: 'Work' }, new Date('2026-10-22'), new Date('2026-10-28'));
  const before = parse(make('1100'));
  const after = parse(make('1200'));
  assert.equal(before[1].identity.key, after[1].identity.key);
  assert.notEqual(before[1].start, after[1].start);
  assert.ok(before.every(item => item.readonly));
});

test('Notes identity follows the server ID when title and category change', async () => {
  let title = 'Before';
  const { client } = fixture(() => reply([{ id: 137, title, category: title, content: 'Note', etag: 'tag' }]));
  const before = (await client.readNotes()).records[0];
  title = 'After';
  const after = (await client.readNotes()).records[0];
  assert.equal(before.identity.key, after.identity.key);
  assert.notEqual(before.collectionId, after.collectionId);
});

test('rescheduling a task preserves alarms and custom fields and guards stale ETags', async () => {
  const raw = ics(['BEGIN:VTODO', 'UID:task', 'SUMMARY:Task', 'DTSTART;VALUE=DATE:20261020', 'DUE;VALUE=DATE:20261023', 'X-CUSTOM:keep', 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'END:VALARM', 'END:VTODO']);
  const record = { source: 'tasks', etag: '"original"', remote: { raw, href: `${SERVER}/task.ics` } };
  const { client, calls } = fixture((url, options) => {
    assert.equal(options.headers['If-Match'], '"original"');
    const todo = new ICAL.Component(ICAL.parse(options.body)).getFirstSubcomponent('vtodo');
    assert.equal(todo.getFirstPropertyValue('due').toString(), '2026-10-24');
    assert.equal(todo.getFirstPropertyValue('x-custom'), 'keep');
    assert.ok(todo.getFirstSubcomponent('valarm'));
    assert.equal(todo.getFirstPropertyValue('sequence'), 1);
    return reply('', 412);
  });
  await assert.rejects(client.setTaskDue({ due: '2026-10-24' }, record), { code: 'CONFLICT' });
  assert.equal(record.remote.raw, raw);
  await assert.rejects(client.setTaskDue({ due: '2026-10-19' }, record), { code: 'VALIDATION' });
  await assert.rejects(client.setTaskDue({ due: '2026-10-24T10:00:00Z' }, record), { code: 'VALIDATION' });
  assert.equal(calls.length, 1);
});

test('createEvent writes a native all-day VEVENT with exclusive end and no overwrite', async () => {
  const { client, calls } = fixture((url, options) => {
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['If-None-Match'], '*');
    const event = new ICAL.Component(ICAL.parse(options.body)).getFirstSubcomponent('vevent');
    assert.equal(event.getFirstPropertyValue('summary'), 'Day off');
    assert.equal(event.getFirstPropertyValue('dtstart').toString(), '2026-10-24');
    assert.equal(event.getFirstPropertyValue('dtend').toString(), '2026-10-25');
    assert.equal(event.getFirstPropertyValue('dtstart').isDate, true);
    return reply('', 201, { ETag: '"created"' });
  });
  const collection = { source: 'calendar', remote: { href: `${SERVER}/remote.php/dav/calendars/alex/calendar/` } };
  const result = await client.createEvent({ title: 'Day off', start: '2026-10-24', end: '2026-10-25', allDay: true }, collection);
  assert.equal(result.etag, '"created"');
  await assert.rejects(client.createEvent({ title: 'Invalid', start: '2026-10-24', end: '2026-10-24', allDay: true }, collection), { code: 'VALIDATION' });
  await assert.rejects(client.createEvent({ title: 'Invalid', start: '2026-02-30', end: '2026-03-03', allDay: true }, collection), { code: 'VALIDATION' });
  assert.equal(calls.length, 2);
});

test('event rescheduling preserves content and removes stale time-zone parameters on new UTC dates', async () => {
  const raw = ics(['BEGIN:VEVENT', 'UID:event', 'SUMMARY:Review', 'DESCRIPTION:Keep this', 'DTSTART;TZID=Europe/Budapest:20261023T090000', 'DTEND;TZID=Europe/Budapest:20261023T100000', 'X-CUSTOM:keep', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT']);
  const record = { source: 'calendar', kind:'event', etag: '"original"', remote: { raw, uid: 'event', href: `${SERVER}/remote.php/dav/calendars/alex/calendar/event.ics` } };
  const { client } = fixture((url, options) => {
    assert.equal(options.headers['If-Match'], '"original"');
    const event = new ICAL.Component(ICAL.parse(options.body)).getFirstSubcomponent('vevent');
    assert.equal(event.getFirstPropertyValue('uid'), 'event');
    assert.equal(event.getFirstPropertyValue('x-custom'), 'keep');
    assert.equal(event.getFirstPropertyValue('description'), 'Keep this');
    assert.equal(event.getFirstProperty('dtstart').getParameter('tzid'), undefined);
    assert.equal(event.getFirstPropertyValue('dtstart').toString(), '2026-10-24T10:00:00Z');
    assert.ok(event.getFirstSubcomponent('valarm'));
    return new Response(null, { status: 204, headers: { ETag: '"updated"' } });
  });
  assert.equal((await client.updateEvent({ start: '2026-10-24T10:00:00Z', end: '2026-10-24T11:00:00Z' }, record)).etag, '"updated"');
});

test('event retry verifies its deterministic resource and preserves later native edits', async () => {
  const requestId = '8fdd90b9-6485-4912-b275-bd805cab1388';
  const uid = `nextspace-${requestId}`;
  const collection = {id: 'calendar', title: 'Work', source: 'calendar', remote: {href: `${SERVER}/remote.php/dav/calendars/alex/calendar/`}};
  const raw = ics(['BEGIN:VEVENT', `UID:${uid}`, `X-NEXTSPACE-REQUEST:${requestId}`, 'SUMMARY:Edited in Nextcloud', 'DTSTART:20261024T120000Z', 'DTEND:20261024T130000Z', 'END:VEVENT']);
  const {client, calls} = fixture((url, options) => {
    assert.equal(url, `${SERVER}/remote.php/dav/calendars/alex/calendar/${uid}.ics`);
    if (options.method === 'PUT') {
      assert.equal(options.headers['If-None-Match'], '*');
      const sent = new ICAL.Component(ICAL.parse(options.body)).getFirstSubcomponent('vevent');
      assert.equal(sent.getFirstPropertyValue('uid'), uid);
      assert.equal(sent.getFirstPropertyValue('x-nextspace-request'), requestId);
      return reply('', 412);
    }
    return reply(raw, 200, {ETag: '"later-version"'});
  });
  const result = await client.createEvent({title: 'Original title', start: '2026-10-24T09:00:00Z', end: '2026-10-24T10:00:00Z', requestId}, collection);
  assert.equal(result.reused, true);
  assert.equal(result.record.title, 'Edited in Nextcloud');
  assert.equal(result.record.start, '2026-10-24T12:00:00.000Z');
  assert.equal(result.etag, '"later-version"');
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
});

test('retry collisions cannot link a foreign, cancelled, or complex calendar resource', async () => {
  const requestId = '8fdd90b9-6485-4912-b275-bd805cab1388', uid = `nextspace-${requestId}`;
  const collection = {id: 'calendar', source: 'calendar', remote: {href: `${SERVER}/remote.php/dav/calendars/alex/calendar/`}};
  for (const props of [[], [`X-NEXTSPACE-REQUEST:${requestId}`, 'STATUS:CANCELLED'], [`X-NEXTSPACE-REQUEST:${requestId}`, 'RRULE:FREQ=DAILY']]) {
    const raw = ics(['BEGIN:VEVENT', `UID:${uid}`, 'SUMMARY:Coincidental name', 'DTSTART:20261024T090000Z', 'DTEND:20261024T100000Z', ...props, 'END:VEVENT']);
    const {client, calls} = fixture((_url, options) => options.method === 'PUT' ? reply('', 412) : reply(raw, 200, {ETag: '"existing"'}));
    await assert.rejects(client.createEvent({title: 'Coincidental name', start: '2026-10-24T09:00:00Z', end: '2026-10-24T10:00:00Z', requestId}, collection), {code: 'CONFLICT'});
    assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  }
});

test('calendar availability distinguishes transparent events and omits cancelled events', () => {
  const {client} = fixture(() => assert.fail('No network'));
  const collection = {id: 'calendar', source: 'calendar'};
  const rows = extra => client.calendarRecords(ics(['BEGIN:VEVENT', 'UID:availability', 'DTSTART:20261023T090000Z', 'DTEND:20261023T100000Z', ...extra, 'END:VEVENT']), `${SERVER}/availability.ics`, '"etag"', collection, new Date('2026-10-01'), new Date('2026-11-01'));
  assert.equal(rows([])[0].busy, true);
  assert.equal(rows(['TRANSP:OPAQUE'])[0].busy, true);
  assert.equal(rows(['TRANSP:TRANSPARENT'])[0].busy, false);
  assert.deepEqual(rows(['STATUS:CANCELLED']), []);
});

test('recurring and invited events cannot be edited through the basic event action', async () => {
  const { client, calls } = fixture(() => assert.fail('Must not write'));
  for (const extra of ['RRULE:FREQ=DAILY', 'ATTENDEE:mailto:partner@example.test', 'ORGANIZER:mailto:me@example.test']) {
    const raw = ics(['BEGIN:VEVENT', 'UID:event', 'DTSTART:20261023T090000Z', 'DTEND:20261023T100000Z', extra, 'END:VEVENT']);
    await assert.rejects(client.updateEvent({ start: '2026-10-24T10:00:00Z', end: '2026-10-24T11:00:00Z' }, { source: 'calendar', etag: 'tag', remote: { raw, href: `${SERVER}/remote.php/dav/calendars/alex/calendar/event.ics` } }), { code: 'VALIDATION' });
  }
  assert.equal(calls.length, 0);
});

const deckSnapshot = { id: 7, stackId: 3, title: 'Review', type: 'plain', description: 'Preserve', owner: { uid: 'canonical-user' }, order: 4, done: null, duedate: '2026-10-24T12:00:00Z', startdate: '2026-10-23T09:00:00Z', color: '#aabbcc', lastModified: 123, dependentCards: [8] };
const deckRecord = () => ({ id: 'card-7', source: 'deck', collectionId: 'board-2', readonly: false, etag: 'tag', remote: { nativeId: 7, boardId: 2, stackId: 3, snapshot: structuredClone(deckSnapshot) } });

test('Deck completion reads a fresh snapshot and preserves unrelated fields', async () => {
  const { client, calls } = fixture((url, options) => {
    if (!options.method) return reply(deckSnapshot, 200, { ETag: '"fresh"' });
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['If-Match'], '"fresh"');
    const update = JSON.parse(options.body);
    assert.equal(update.owner, 'canonical-user');
    assert.equal(update.description, deckSnapshot.description);
    assert.equal(update.startdate, deckSnapshot.startdate);
    assert.equal(update.duedate, deckSnapshot.duedate);
    assert.equal(update.done, NOW.toISOString());
    return reply({ ...deckSnapshot, ...update });
  });
  assert.equal((await client.setCardCompleted({ completed: true }, deckRecord())).done, NOW.toISOString());
  assert.equal(calls.length, 3);
});

test('Deck detects stale snapshots before mutation and refuses cross-board stack moves', async () => {
  const { client, calls } = fixture(() => reply({ ...deckSnapshot, description: 'Changed elsewhere' }));
  await assert.rejects(client.setCardCompleted({ completed: true }, deckRecord()), { code: 'CONFLICT' });
  await assert.rejects(client.moveCard({ stackId: '99' }, deckRecord(), { id: 'board-2', source: 'deck', stacks: [{ id: '4', title: 'Done' }] }), { code: 'VALIDATION' });
  assert.equal(calls.length, 1);
  assert.ok(calls.every(call => !call.method));
});

test('Deck stack movement uses its granular endpoint without changing card content', async () => {
  let current = {...deckSnapshot};
  const { client, calls } = fixture((url, options) => {
    if (!options.method) return reply(current);
    assert.ok(url.endsWith('/stacks/4/cards/7/reorder'));
    assert.equal(options.method, 'PUT');
    assert.deepEqual(JSON.parse(options.body), { stackId: 4, order: 99999 });
    current = {...current,stackId:4};
    return reply([current]);
  });
  await client.moveCard({ stackId: '4' }, deckRecord(), { id: 'board-2', source: 'deck', stacks: [{ id: '4', title: 'Done' }] });
  assert.equal(calls.length, 5);
});

test('Deck dependencies write dependent-to-prerequisite natively, support read-only prerequisites across boards, and retry idempotently', async () => {
  let native = { ...deckSnapshot, dependentCards: [], description: 'Fresh native text', lastModified: 456 };
  const prerequisite = { ...deckRecord(), id: 'card-8', collectionId: 'other-board', readonly: true, remote: { nativeId: 8, boardId: 9, stackId: 10 } };
  const { client, calls } = fixture((url, options) => {
    if (!options.method) { assert.ok(url.endsWith('/cards/7')); return reply(native, 200, { ETag: '"current"' }); }
    assert.ok(url.endsWith('/boards/2/stacks/3/cards/7/dependentCards/8'));
    assert.equal(options.headers['If-Match'], '"current"');
    assert.equal(options.body, undefined, 'Never rewrite card descriptions/status/dates for a dependency');
    assert.ok(['POST', 'DELETE'].includes(options.method));
    native = { ...native, dependentCards: options.method === 'POST' ? [8] : [], lastModified: native.lastModified + 1 };
    return reply(native);
  });
  assert.deepEqual((await client.setDeckDependency({}, deckRecord(), prerequisite)).dependentCards, [8]);
  assert.equal(calls.length, 3);
  assert.deepEqual((await client.setDeckDependency({}, deckRecord(), prerequisite)).dependentCards, [8]);
  assert.equal(calls.length, 5, 'Retry after a lost response only verifies current permissions and reads the already saved relation');
  assert.deepEqual((await client.setDeckDependency({ remove: true }, deckRecord(), prerequisite)).dependentCards, []);
  assert.equal(calls.length, 8);
  await client.setDeckDependency({ remove: true }, deckRecord(), prerequisite);
  assert.equal(calls.length, 10);
  assert.equal(native.description, 'Fresh native text');
  assert.equal(native.startdate, deckSnapshot.startdate);
});

test('Deck dependency responses must confirm the native change, with one targeted readback when needed', async () => {
  const prerequisite = { ...deckRecord(), id: 'card-8', remote: { nativeId: 8, boardId: 2, stackId: 3 } };
  for (const confirms of [true, false]) {
    let wrote = false;
    const { client, calls } = fixture((url, options) => {
      if (options.method === 'POST') { wrote = true; return reply({ id: 7 }); }
      assert.ok(url.endsWith('/cards/7'));
      return reply({ ...deckSnapshot, dependentCards: confirms && wrote ? [8] : [] });
    });
    if (confirms) assert.deepEqual((await client.setDeckDependency({}, deckRecord(), prerequisite)).dependentCards, [8]);
    else await assert.rejects(client.setDeckDependency({}, deckRecord(), prerequisite), { code: 'UNAVAILABLE' });
    assert.equal(calls.length, 4);
  }
});

test('Deck dependency validation rejects unsupported, inaccessible, moved and read-only dependents without mutation', async () => {
  const prerequisite = { ...deckRecord(), id: 'card-8', remote: { nativeId: 8, boardId: 2, stackId: 3 } };
  for (const [native, code] of [
    [{ ...deckSnapshot, dependentCards: undefined }, 'UNAVAILABLE'],
    [{ ...deckSnapshot, permissions: { PERMISSION_EDIT: false } }, 'PERMISSION'],
    [{ ...deckSnapshot, relatedBoard: { permissions: { PERMISSION_EDIT: false } } }, 'PERMISSION'],
    [{ ...deckSnapshot, stackId: 99 }, 'CONFLICT'],
    [{ ...deckSnapshot, archived: true }, 'CONFLICT'],
  ]) {
    const { client, calls } = fixture(() => reply(native));
    await assert.rejects(client.setDeckDependency({}, deckRecord(), prerequisite), { code });
    assert.equal(calls.length, 1); assert.equal(calls[0].method, undefined);
  }
  const { client, calls } = fixture(() => assert.fail('Invalid input must not reach Deck'));
  await assert.rejects(client.setDeckDependency({}, { ...deckRecord(), readonly: true }, prerequisite), { code: 'PERMISSION' });
  await assert.rejects(client.setDeckDependency({}, deckRecord(), deckRecord()), { code: 'VALIDATION' });
  await assert.rejects(client.setDeckDependency({ remove: 'yes' }, deckRecord(), prerequisite), { code: 'VALIDATION' });
  assert.equal(calls.length, 0);
});

test('description saves round-trip Markdown while preserving native task/event fields, alarms and time zones', async () => {
  const description = '# Plan\n\n- [x] Done\n- **Next:** review; then ship, with \\literal text\n\nKözös 🌿';
  for (const [source, kind, ending] of [['tasks', 'VTODO', 'DUE'], ['calendar', 'VEVENT', 'DTEND']]) {
    const raw = ics(['X-WR-CALNAME:Source calendar', 'BEGIN:VTIMEZONE', 'TZID:Europe/Budapest', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0100', 'END:STANDARD', 'END:VTIMEZONE',
      `BEGIN:${kind}`, 'UID:description-item', 'SUMMARY:Keep title', 'DESCRIPTION;LANGUAGE=en:Old text', 'DTSTART;TZID=Europe/Budapest:20261023T090000', `${ending};TZID=Europe/Budapest:20261023T100000`, 'SEQUENCE:4', 'CATEGORIES:Personal,Shared', 'LOCATION:Keep location', 'X-KEEP;X-OPTION=retained:Original value',
      ...(source === 'tasks' ? ['STATUS:COMPLETED', 'COMPLETED:20261023T080000Z', 'PERCENT-COMPLETE:100'] : ['STATUS:CONFIRMED', 'TRANSP:OPAQUE']),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'DESCRIPTION:Alarm text stays', 'END:VALARM', `END:${kind}`]);
    const original = new ICAL.Component(ICAL.parse(raw));
    const before = original.getFirstSubcomponent(kind.toLowerCase());
    const record = { source, readonly: false, etag: '"v1"', remote: { raw, href: `${SERVER}/${source}/item.ics`, uid: 'description-item' } };
    let saved;
    const { client, calls } = fixture((url, options) => {
      assert.equal(url, record.remote.href);
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers['If-Match'], '"v1"');
      saved = new ICAL.Component(ICAL.parse(options.body));
      return reply('', 200, { ETag: '"v2"' });
    });
    const savedResult = await client.updateDescription({ description, etag: '"v1"' }, record);
    assert.equal(savedResult.etag, '"v2"');
    assert.equal(savedResult.raw, saved.toString());
    const item = saved.getFirstSubcomponent(kind.toLowerCase());
    assert.equal(item.getFirstPropertyValue('description'), description);
    assert.equal(item.getFirstPropertyValue('sequence'), 5);
    assert.equal(item.getFirstPropertyValue('last-modified').toJSDate().toISOString(), NOW.toISOString());
    assert.deepEqual(item.getAllProperties().filter(property => !['description', 'sequence', 'last-modified', 'dtstamp'].includes(property.name)).map(property => property.toJSON()), before.getAllProperties().filter(property => !['description', 'sequence', 'last-modified', 'dtstamp'].includes(property.name)).map(property => property.toJSON()));
    assert.deepEqual(item.getAllSubcomponents().map(component => component.toJSON()), before.getAllSubcomponents().map(component => component.toJSON()));
    assert.deepEqual(saved.getAllSubcomponents('vtimezone').map(component => component.toJSON()), original.getAllSubcomponents('vtimezone').map(component => component.toJSON()));
    assert.equal(saved.getFirstPropertyValue('x-wr-calname'), 'Source calendar');
    assert.equal(record.remote.raw, raw, 'The cached record is not mutated before the successful result is committed');
    assert.equal(calls.length, 1);
    await client.updateDescription({ description: '' }, record);
    assert.equal(saved.getFirstSubcomponent(kind.toLowerCase()).hasProperty('description'), false, 'An empty draft clears the description');
  }
});

test('description saves reject stale versions, read-only or complex DAV records and unsupported sources before writing', async () => {
  const { client, calls } = fixture(() => assert.fail('Invalid description edits must not request the server'));
  for (const [source, kind] of [['tasks', 'VTODO'], ['calendar', 'VEVENT']]) {
    const makeRecord = extras => ({ source, etag: '"v1"', remote: { href: `${SERVER}/item.ics`, raw: ics([`BEGIN:${kind}`, 'UID:one', 'DTSTART:20261023T090000Z', ...(extras || []), `END:${kind}`]) } });
    await assert.rejects(client.updateDescription({description: 'Draft', etag: '"old"'}, makeRecord()), {code: 'CONFLICT'});
    await assert.rejects(client.updateDescription({description: 'Draft', etag: '*'}, makeRecord()), {code: 'CONFLICT'});
    await assert.rejects(client.updateDescription({description: 'Draft'}, {...makeRecord(), etag: undefined}), {code: 'CONFLICT'});
    await assert.rejects(client.updateDescription({description: 'Draft'}, {...makeRecord(), readonly: true}), {code: 'VALIDATION'});
    for (const extra of ['RRULE:FREQ=DAILY', 'RDATE:20261024T090000Z', 'EXDATE:20261024T090000Z', 'RECURRENCE-ID:20261023T090000Z', 'ATTENDEE:mailto:partner@example.test', 'ORGANIZER:mailto:me@example.test']) await assert.rejects(client.updateDescription({description: 'Draft'}, makeRecord([extra])), {code: 'VALIDATION'});
    await assert.rejects(client.updateDescription({description: 'Draft'}, {...makeRecord(), remote: {...makeRecord().remote, recurrenceId: '2026-10-23'}}), {code: 'VALIDATION'});
    await assert.rejects(client.updateDescription({description: null}, makeRecord()), {code: 'VALIDATION'});
    await assert.rejects(client.updateDescription({description: 'x'.repeat(500001)}, makeRecord()), {code: 'VALIDATION'});
  }
  for (const source of ['notes', 'collectives']) await assert.rejects(client.updateDescription({description: 'Draft'}, {source}), {code: 'VALIDATION'});
  assert.equal(calls.length, 0);
});

test('description saves retain the DAV conflict response instead of overwriting a newer remote edit', async () => {
  const raw = ics(['BEGIN:VEVENT', 'UID:one', 'DESCRIPTION:Original', 'DTSTART:20261023T090000Z', 'DTEND:20261023T100000Z', 'END:VEVENT']);
  const {client, calls} = fixture((url, options) => {assert.equal(options.headers['If-Match'], '"v1"');return reply('', 412)});
  const record = {source: 'calendar', etag: '"v1"', remote: {raw, href: `${SERVER}/remote.php/dav/calendars/alex/calendar/event.ics`}};
  await assert.rejects(client.updateDescription({description: 'Local draft'}, record), {code: 'CONFLICT', status: 412});
  assert.equal(calls.length, 1);
  assert.equal(record.remote.raw, raw);
});

test('Deck description save uses a fresh snapshot and preserves title, dates, completion, ownership and links', async () => {
  const snapshot = {...deckSnapshot, done: '2026-10-22T10:00:00Z', archived: false, labels: [{id: 3}], assignedUsers: [{participant: {uid: 'canonical-user'}}]};
  const record = deckRecord();record.remote.snapshot = structuredClone(snapshot);
  const description = '# Updated\n\n- [ ] Review **Markdown**';
  const {client, calls} = fixture((url, options) => {
    if (!options.method) return reply(snapshot, 200, {ETag: '"fresh"'});
    assert.equal(options.method, 'PUT');
    assert.equal(options.headers['If-Match'], '"fresh"');
    assert.deepEqual(JSON.parse(options.body), {title: snapshot.title, type: snapshot.type, owner: 'canonical-user', description, order: snapshot.order, duedate: snapshot.duedate, startdate: snapshot.startdate, archived: false, done: snapshot.done, color: snapshot.color});
    return reply({...snapshot, description});
  });
  const saved = await client.updateDescription({description, etag: record.etag}, record);
  assert.equal(saved.description, description);
  assert.deepEqual(saved.dependentCards, snapshot.dependentCards);
  assert.deepEqual(saved.assignedUsers, snapshot.assignedUsers);
  assert.deepEqual(saved.labels, snapshot.labels);
  assert.equal(record.remote.snapshot.description, deckSnapshot.description);
  assert.equal(calls.length, 3);
});

test('Deck description rejects changed snapshots or renderer versions without issuing a mutation', async () => {
  const {client, calls} = fixture(() => reply({...deckSnapshot, description: 'Edited elsewhere'}));
  await assert.rejects(client.updateDescription({description: 'Local draft', etag: 'old'}, deckRecord()), {code: 'CONFLICT'});
  assert.equal(calls.length, 0);
  await assert.rejects(client.updateDescription({description: 'Local draft'}, deckRecord()), {code: 'CONFLICT'});
  assert.equal(calls.length, 1);
  assert.ok(calls.every(call => !call.method));
});

test('native date drags preserve task/event content, status, alarms, custom parameters and named zones across DST', async () => {
  for (const [source, kind, finishName, field] of [['tasks', 'VTODO', 'DUE', 'due'], ['calendar', 'VEVENT', 'DTEND', 'end']]) {
    const raw = ics([`BEGIN:${kind}`, 'UID:date-drag', 'SUMMARY:Keep title', 'DESCRIPTION:Keep Markdown **text**', 'DTSTART;TZID=Europe/Budapest;X-KEEP=first:20261023T090000', `${finishName};TZID=Europe/Budapest;X-KEEP=last:20261023T110000`, 'SEQUENCE:4', 'CATEGORIES:Keep,Labels', 'X-CUSTOM:original', ...(source === 'tasks' ? ['STATUS:COMPLETED', 'COMPLETED:20261023T120000Z', 'PERCENT-COMPLETE:100'] : ['STATUS:CONFIRMED', 'TRANSP:TRANSPARENT']), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'DESCRIPTION:Keep alarm', 'END:VALARM', `END:${kind}`]);
    const record = {source, etag: '"v1"', remote: {raw, href: `${SERVER}/${source}.ics`, uid: 'date-drag'}};
    let saved;
    const {client, calls} = fixture((url, options) => {
      assert.equal(options.headers['If-Match'], '"v1"');assert.equal(options.method, 'PUT');
      saved = new ICAL.Component(ICAL.parse(options.body));
      return reply('', 200, {ETag: '"v2"'});
    });
    await client.updateRecordDates({start: '2026-10-26T08:00:00Z', [field]: '2026-10-26T10:00:00Z', etag: record.etag}, record);
    const item = saved.getFirstSubcomponent(kind.toLowerCase()), original = new ICAL.Component(ICAL.parse(raw)).getFirstSubcomponent(kind.toLowerCase());
    assert.equal(item.getFirstProperty('dtstart').getParameter('tzid'), 'Europe/Budapest');
    assert.equal(item.getFirstProperty('dtstart').getParameter('x-keep'), 'first');
    assert.equal(item.getFirstProperty(finishName.toLowerCase()).getParameter('x-keep'), 'last');
    assert.equal(item.getFirstPropertyValue('dtstart').toString(), '2026-10-26T09:00:00');
    assert.equal(item.getFirstPropertyValue(finishName.toLowerCase()).toString(), '2026-10-26T11:00:00');
    const reread = client.calendarRecords(saved.toString(), record.remote.href, '"v2"', {source, id: source, title: 'Source'}, new Date('2026-10-20'), new Date('2026-10-30'))[0];
    assert.equal(reread.start, '2026-10-26T08:00:00.000Z');assert.equal(reread[field], '2026-10-26T10:00:00.000Z');
    const unrelated = component => component.getAllProperties().filter(property => !['dtstart', finishName.toLowerCase(), 'sequence', 'dtstamp', 'last-modified'].includes(property.name)).map(property => property.toJSON());
    assert.deepEqual(unrelated(item), unrelated(original));
    assert.deepEqual(item.getAllSubcomponents().map(value => value.toJSON()), original.getAllSubcomponents().map(value => value.toJSON()));
    assert.equal(item.getFirstPropertyValue('sequence'), 5);assert.equal(record.remote.raw, raw);assert.equal(calls.length, 1);
  }
});

test('partial native date resize leaves the omitted bound and embedded time zone untouched', async () => {
  for (const [source, kind, finishName, field] of [['tasks', 'VTODO', 'DUE', 'due'], ['calendar', 'VEVENT', 'DTEND', 'end']]) {
    const raw = ics(['BEGIN:VTIMEZONE', 'TZID:Custom/Fixed', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0200', 'END:STANDARD', 'END:VTIMEZONE', `BEGIN:${kind}`, 'UID:resize', 'DTSTART;TZID=Custom/Fixed:20261023T090000', `${finishName};TZID=Custom/Fixed:20261023T100000`, `END:${kind}`]);
    let saved;
    const {client} = fixture((url, options) => {saved = new ICAL.Component(ICAL.parse(options.body));return reply('', 200)});
    await client.updateRecordDates({[field]: '2026-10-23T10:00:00Z'}, {source, etag: 'v1', remote: {raw, href: `${SERVER}/resize.ics`}});
    const original = new ICAL.Component(ICAL.parse(raw)), item = saved.getFirstSubcomponent(kind.toLowerCase());
    assert.deepEqual(item.getFirstProperty('dtstart').toJSON(), original.getFirstSubcomponent(kind.toLowerCase()).getFirstProperty('dtstart').toJSON());
    assert.equal(item.getFirstProperty(finishName.toLowerCase()).getParameter('tzid'), 'Custom/Fixed');
    assert.match(saved.toString(), new RegExp(`${finishName};TZID=Custom/Fixed:20261023T120000`));
    assert.deepEqual(saved.getFirstSubcomponent('vtimezone').toJSON(), original.getFirstSubcomponent('vtimezone').toJSON());
  }
});

test('native date edits retain floating dates and duration unless explicitly replacing the finish', async () => {
  const raw = ics(['BEGIN:VEVENT', 'UID:floating', 'DTSTART:20261023T090000', 'DURATION:PT1H', 'END:VEVENT']);
  let saved;
  const {client} = fixture((url, options) => {saved = new ICAL.Component(ICAL.parse(options.body)).getFirstSubcomponent('vevent');return reply('', 200)});
  const record = {source: 'calendar', etag: 'v1', remote: {raw, href: `${SERVER}/floating.ics`}};
  await client.updateRecordDates({start: new Date(2026, 9, 24, 9).toISOString()}, record);
  assert.equal(saved.getFirstPropertyValue('dtstart').toString(), '2026-10-24T09:00:00');
  assert.equal(saved.getFirstProperty('dtstart').getParameter('tzid'), undefined);
  assert.equal(saved.getFirstPropertyValue('duration').toString(), 'PT1H');assert.equal(saved.hasProperty('dtend'), false);
  await client.updateRecordDates({end: new Date(2026, 9, 23, 11).toISOString()}, record);
  assert.equal(saved.getFirstPropertyValue('dtend').toString(), '2026-10-23T11:00:00');assert.equal(saved.hasProperty('duration'), false);
});

test('moving an instantaneous native event preserves its absent end and duration', async () => {
  const raw = ics(['BEGIN:VEVENT', 'UID:instant', 'SUMMARY:Instant marker', 'DESCRIPTION:Keep description', 'DTSTART:20261023T090000Z', 'END:VEVENT']);
  let saved;
  const {client, calls} = fixture((url, options) => {
    assert.equal(options.method, 'PUT');assert.equal(options.headers['If-Match'], '"v1"');
    saved = new ICAL.Component(ICAL.parse(options.body));return reply('', 200, {ETag: '"v2"'});
  });
  const record = {source: 'calendar', etag: '"v1"', remote: {raw, href: `${SERVER}/instant.ics`, uid: 'instant'}};
  await client.updateRecordDates({start: '2026-10-24T09:00:00Z', allDay: false, etag: record.etag}, record);
  const item = saved.getFirstSubcomponent('vevent');
  assert.equal(item.getFirstPropertyValue('dtstart').toString(), '2026-10-24T09:00:00Z');
  assert.equal(item.hasProperty('dtend'), false);assert.equal(item.hasProperty('duration'), false);
  assert.equal(item.getFirstPropertyValue('summary'), 'Instant marker');assert.equal(item.getFirstPropertyValue('description'), 'Keep description');
  const reread = client.calendarRecords(saved.toString(), record.remote.href, '"v2"', {source: 'calendar', id: 'calendar', title: 'Source'}, new Date('2026-10-20'), new Date('2026-10-30'))[0];
  assert.equal(reread.start, '2026-10-24T09:00:00.000Z');assert.equal(reread.end, reread.start);
  await assert.rejects(client.updateRecordDates({start: '2026-10-24T09:00:00Z', end: '2026-10-24T09:00:00Z'}, record), {code: 'VALIDATION'});
  assert.equal(calls.length, 1);
});

test('native date edits keep due-only tasks as markers and reject equal DATE bounds without inventing a day', async () => {
  const raw = ics(['BEGIN:VTODO', 'UID:due-only', 'DUE;VALUE=DATE:20261023', 'STATUS:COMPLETED', 'END:VTODO']);
  let saved;
  const {client, calls} = fixture((url, options) => {saved = new ICAL.Component(ICAL.parse(options.body)).getFirstSubcomponent('vtodo');return reply('', 200)});
  const record = {source: 'tasks', etag: 'v1', remote: {raw, href: `${SERVER}/task.ics`}};
  await client.updateRecordDates({due: '2026-10-24'}, record);
  assert.equal(saved.getFirstPropertyValue('due').toString(), '2026-10-24');assert.equal(saved.hasProperty('dtstart'), false);assert.equal(saved.getFirstPropertyValue('status'), 'COMPLETED');
  await assert.rejects(client.updateRecordDates({start: '2026-10-24', due: '2026-10-24'}, record), {code: 'VALIDATION'});
  await assert.rejects(client.updateRecordDates({start: '2026-10-24T09:00:00Z', due: '2026-10-24'}, record), {code: 'VALIDATION'});
  assert.equal(calls.length, 1);
  await client.updateRecordDates({start: '2026-10-24T09:00:00Z', due: '2026-10-24T10:00:00Z'}, record);
  assert.equal(saved.getFirstPropertyValue('due').isDate, false);
  await client.updateRecordDates({due: ''}, record);assert.equal(saved.hasProperty('due'), false);
});

test('native event date edits retain exclusive all-day ends and reject malformed, mixed or reversed intervals', async () => {
  const raw = ics(['BEGIN:VEVENT', 'UID:all-day', 'DTSTART;VALUE=DATE:20261023', 'DTEND;VALUE=DATE:20261024', 'END:VEVENT']);
  let saved;
  const {client, calls} = fixture((url, options) => {saved = new ICAL.Component(ICAL.parse(options.body)).getFirstSubcomponent('vevent');return reply('', 200)});
  const record = {source: 'calendar', etag: 'v1', remote: {raw, href: `${SERVER}/remote.php/dav/calendars/alex/calendar/event.ics`}};
  await client.updateRecordDates({start: '2026-10-24', end: '2026-10-25', allDay: true}, record);
  assert.equal(saved.getFirstPropertyValue('dtstart').toString(), '2026-10-24');assert.equal(saved.getFirstPropertyValue('dtend').toString(), '2026-10-25');
  for (const change of [{start: '2026-10-24'}, {end: '2026-10-23'}, {end: ''}, {start: ''}, {start: '2026-02-30T09:00:00Z', end: '2026-03-01T10:00:00Z'}, {start: '2026-10-23T24:00:00Z'}, {start: '2026-10-23T09:00:00Z'}, {allDay: true}, {due: '2026-10-25'}, {end: '2026-10-25', allDay: false}]) await assert.rejects(client.updateRecordDates(change, record), {code: 'VALIDATION'});
  assert.equal(calls.length, 1);
});

test('native date edits reject read-only, recurring, invited and stale DAV records before writes', async () => {
  const {client, calls} = fixture(() => assert.fail('Rejected drag must not request the server'));
  for (const [source, kind, field] of [['tasks', 'VTODO', 'due'], ['calendar', 'VEVENT', 'end']]) {
    const make = extras => ({source, etag: 'v1', remote: {href: `${SERVER}/date.ics`, raw: ics([`BEGIN:${kind}`, 'UID:guarded', 'DTSTART:20261023T090000Z', ...(extras || []), `END:${kind}`])}});
    const change = {[field]: '2026-10-23T10:00:00Z'};
    await assert.rejects(client.updateRecordDates({...change, etag: 'old'}, make()), {code: 'CONFLICT'});
    await assert.rejects(client.updateRecordDates(change, {...make(), etag: undefined}), {code: 'CONFLICT'});
    await assert.rejects(client.updateRecordDates(change, {...make(), readonly: true}), {code: 'VALIDATION'});
    for (const extra of ['RRULE:FREQ=DAILY', 'RDATE:20261024T090000Z', 'RECURRENCE-ID:20261023T090000Z', 'ATTENDEE:mailto:partner@example.test', 'ORGANIZER:mailto:me@example.test']) await assert.rejects(client.updateRecordDates(change, make([extra])), {code: 'VALIDATION'});
  }
  assert.equal(calls.length, 0);
  const stale = fixture(() => reply('', 412));
  await assert.rejects(stale.client.updateRecordDates({due: '2026-10-24'}, {source: 'tasks', etag: 'v1', remote: {href: `${SERVER}/stale.ics`, raw: ics(['BEGIN:VTODO', 'UID:stale', 'END:VTODO'])}}), {code: 'CONFLICT', status: 412});
  assert.equal(stale.calls.length, 1);
});

test('native Deck date moves and partial resizes preserve completion, metadata, links and omitted bounds', async () => {
  for (const change of [{start: '2026-10-25T09:00:00Z', due: '2026-10-26T12:00:00Z'}, {due: '2026-10-25T12:00:00Z'}, {start: '2026-10-23T10:00:00Z'}, {start: ''}]) {
    const snapshot = {...deckSnapshot, done: '2026-10-22T10:00:00Z', labels: [{id: 5}], assignedUsers: [{participant: {uid: 'canonical-user'}}]};
    const record = deckRecord();record.remote.snapshot = structuredClone(snapshot);
    let update;
    const {client, calls} = fixture((url, options) => {
      if (!options.method) return reply(snapshot, 200, {ETag: '"fresh"'});
      assert.equal(options.headers['If-Match'], '"fresh"');update = JSON.parse(options.body);
      return reply({...snapshot, ...update});
    });
    const result = await client.updateRecordDates({...change, etag: record.etag}, record);
    assert.deepEqual(update, {title: snapshot.title, type: snapshot.type, owner: 'canonical-user', description: snapshot.description, order: snapshot.order, startdate: change.start === undefined ? snapshot.startdate : change.start || null, duedate: change.due === undefined ? snapshot.duedate : change.due || null, archived: false, done: snapshot.done, color: snapshot.color});
    assert.deepEqual(result.dependentCards, snapshot.dependentCards);assert.deepEqual(result.labels, snapshot.labels);assert.deepEqual(result.assignedUsers, snapshot.assignedUsers);assert.equal(calls.length, 3);
  }
});

test('native Deck date edits reject ambiguous date-only input, reversed ranges and stale source snapshots', async () => {
  const {client, calls} = fixture(() => reply(deckSnapshot));
  await assert.rejects(client.updateRecordDates({due: '2026-10-25'}, deckRecord()), {code: 'VALIDATION'});
  await assert.rejects(client.updateRecordDates({due: '2026-10-25T12:00:00Z', etag: 'old'}, deckRecord()), {code: 'CONFLICT'});
  assert.equal(calls.length, 0);
  await assert.rejects(client.updateRecordDates({due: deckSnapshot.startdate}, deckRecord()), {code: 'VALIDATION'});
  assert.ok(calls.every(call => !call.method));
  const stale = fixture(() => reply({...deckSnapshot, startdate: '2026-10-22T09:00:00Z'}));
  await assert.rejects(stale.client.updateRecordDates({due: '2026-10-25T12:00:00Z'}, deckRecord()), {code: 'CONFLICT'});
  assert.equal(stale.calls.length, 1);
});

test('planner metadata uses its own v2 cloud file and rejects old dashboard schema', async () => {
  const { client, calls } = fixture(() => reply(workspace, 200, { ETag: '"v2"' }));
  assert.deepEqual((await client.readWorkspace()).workspace, workspace);
  assert.ok(calls.at(-1).url.endsWith('/Workspace/planner.json'));
  await assert.rejects(client.writeWorkspace({ ...workspace, schemaVersion: 1 }, '"v2"'), { code: 'VALIDATION' });
  assert.equal(calls.filter(call => call.method === 'PUT').length, 0);
});
