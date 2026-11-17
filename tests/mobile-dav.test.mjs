import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '../packages/nextcloud/src/nextcloud.mjs';

const SERVER = 'https://fixture.invalid/nextcloud';
const ROOT = `${SERVER}/remote.php/dav/calendars/tester/work/`;
const NOW = new Date('2026-11-11T12:00:00Z');
const calendar = {href: ROOT, title: 'Work', components: ['VTODO', 'VEVENT'], readonly: false, color: '#0088ff'};
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const row = (href, properties = '', status = '') => `<d:response><d:href>${xml(href)}</d:href>${status ? `<d:status>HTTP/1.1 ${status}</d:status>` : `<d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`}</d:response>`;
const wrap = rows => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}</d:multistatus>`;
const reply = (body = '', status = 200, headers = {}) => new Response(body, {status, headers});
const ics = lines => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nextspace Fixture//EN', ...lines, 'END:VCALENDAR', ''].join('\r\n');
const task = uid => ics(['BEGIN:VTODO', `UID:${uid}`, `SUMMARY:Task ${uid}`, 'DUE;VALUE=DATE:20261112', 'STATUS:IN-PROCESS', 'PERCENT-COMPLETE:35', 'END:VTODO']);
const event = uid => ics(['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:Event ${uid}`, 'DTSTART:20261111T090000Z', 'DTEND:20261111T100000Z', 'END:VEVENT']);
const entry = (resource, root = ROOT) => row(resource.href || `${root}${resource.name}`, `<d:resourcetype/>${resource.etag === null ? '' : `<d:getetag>${xml(resource.etag || '"v1"')}</d:getetag>`}${resource.length ? `<d:getcontentlength>${resource.length}</d:getcontentlength>` : ''}${resource.modified ? `<d:getlastmodified>${resource.modified}</d:getlastmodified>` : ''}`);
const comparable = value => ({...value, records: value.records.map(record => ({...record, remote: {...record.remote, raw: record.remote.raw.replaceAll('\r\n', '\n')}}))});
function fixture(resources, options = {}) {
  const calls = [];
  const fetch = async (url, input) => {
    calls.push({url, ...input});
    const custom = await options.handle?.(url, input);
    if (custom) return custom;
    if (input.method === 'PROPFIND') return reply(wrap(row(url, '<d:resourcetype><d:collection/></d:resourcetype>') + resources.map(resource => entry(resource, url)).join('')), 207);
    if (input.method === 'REPORT') return reply(wrap(resources.map(resource => row(`${url}${resource.name}`, `<d:getetag>${xml(resource.etag || '"v1"')}</d:getetag><c:calendar-data>${xml(resource.body)}</c:calendar-data>`)).join('')), 207);
    const resource = resources.find(resource => url.endsWith(`/${resource.name}`));
    if (!resource) return reply('', 404);
    return reply(resource.body, 200, {'Content-Type': 'text/calendar', ...(resource.etag === null ? {} : {ETag: resource.etag || '"v1"'})});
  };
  const client = new NextcloudClient({serverUrl: SERVER, username: 'tester'}, {authentication: 'delegated', davReadMode: options.mode || 'propfind-get', now: () => NOW, fetch});
  return {client, calls};
}

test('fallback projects the same task data and ETags as desktop REPORT', async () => {
  const resources = [{name: 'one.ics', body: task('one')}, {name: 'deck.ics', body: task('deck-card-5')}];
  const mobile = fixture(resources), report = fixture(resources, {mode: 'report'});
  const data = await mobile.client.readDav('tasks', [calendar]);
  assert.deepEqual(comparable(data), comparable(await report.client.readDav('tasks', [calendar])));
  assert.equal(data.records[0].remote.raw, resources[0].body, 'GET retains the source document bytes; XML REPORT normalizes CRLF');
  assert.equal(report.calls[0].method, 'REPORT'); assert.equal(report.calls.length, 1);
  assert.ok(mobile.calls.every(call => call.method !== 'REPORT'));
  const get = mobile.calls.find(call => !call.method);
  assert.equal(get.headers['If-Match'], '"v1"'); assert.equal(get.maxResponseBytes, 2 * 1024 * 1024);
});

test('PROPFIND/GET uses existing recurrence, timezone, cancellation and date-window projection', async () => {
  const recurring = ics(['BEGIN:VEVENT', 'UID:daily', 'SUMMARY:Daily', 'DTSTART;TZID=Europe/Budapest:20261029T090000', 'DTEND;TZID=Europe/Budapest:20261029T100000', 'RRULE:FREQ=DAILY;COUNT=20', 'EXDATE;TZID=Europe/Budapest:20261103T090000', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:daily', 'RECURRENCE-ID;TZID=Europe/Budapest:20261105T090000', 'SUMMARY:Moved', 'DTSTART;TZID=Europe/Budapest:20261105T130000', 'DTEND;TZID=Europe/Budapest:20261105T140000', 'END:VEVENT']);
  const resources = [{name: 'series.ics', body: recurring}, {name: 'old.ics', body: event('old').replaceAll('20261111', '20250101')}, {name: 'cancelled.ics', body: event('cancelled').replace('END:VEVENT', 'STATUS:CANCELLED\r\nEND:VEVENT')}];
  const mobile = fixture(resources), report = fixture(resources, {mode: 'report'});
  const actual = await mobile.client.readDav('calendar', [calendar]);
  const expected = await report.client.readDav('calendar', [calendar]);
  assert.deepEqual(comparable(actual).records.sort((a, b) => a.id.localeCompare(b.id)), comparable(expected).records.sort((a, b) => a.id.localeCompare(b.id)));
  assert.ok(actual.records.some(record => record.title === 'Moved'));
  assert.ok(actual.records.every(record => !['Event old', 'Event cancelled'].includes(record.title)));
});

test('fallback rejects unsafe, duplicate, and incomplete DAV listings before any GET', async () => {
  const invalid = [
    wrap(row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') + entry({href: 'https://evil.invalid/item.ics'})),
    wrap(row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') + entry({href: `${ROOT}nested/item.ics`})),
    wrap(row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') + entry({href: `${ROOT}one%2ftwo.ics`})),
    wrap(row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') + entry({name: 'one.ics'}) + entry({name: 'one.ics'})),
    wrap(entry({name: 'one.ics'})),
    wrap(row(ROOT, '', '500 Internal Server Error')),
    wrap(row(ROOT, '')),
    wrap(row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') + row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>')),
  ];
  for (const body of invalid) {
    const {client, calls} = fixture([], {handle: async () => reply(body, 207)});
    await assert.rejects(client.readDav('tasks', [calendar]));
    assert.equal(calls.length, 1);
  }
});

test('partial GET failures remain explicitly incomplete and never overwrite a listed version', async () => {
  const resources = [{name: 'good.ics', body: task('good')}, {name: 'missing.ics', body: task('missing')}, {name: 'changed.ics', body: task('changed')}];
  const {client, calls} = fixture(resources, {handle: async (url, input) => {
    if (!input.method && url.endsWith('/missing.ics')) return reply('', 404);
    if (!input.method && url.endsWith('/changed.ics')) return reply(task('changed'), 200, {ETag: '"newer"'});
  }});
  const data = await client.readDav('tasks', [calendar]);
  assert.deepEqual(data.records.map(record => record.title), ['Task good']);
  assert.match(data.warning, /could not be read/);
  assert.ok(calls.every(call => !['PUT', 'POST', 'DELETE'].includes(call.method)));
});

test('permission denial in listing or GET purges the affected collection; authentication failure propagates', async () => {
  for (const listing of [true, false]) {
    const {client} = fixture([{name: 'one.ics', body: task('one')}], {handle: async (url, input) => {
      if (listing && input.method === 'PROPFIND') return reply(wrap(row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') + row(`${ROOT}one.ics`, '', '403 Forbidden')), 207);
      if (!listing && !input.method) return reply('', 403);
    }});
    const data = await client.readDav('tasks', [calendar]);
    assert.deepEqual(data.records, []); assert.deepEqual(data.collections, []);
    assert.deepEqual(data.revokedCollectionIds, [client.id('tasks', ROOT)]);
  }
  const {client} = fixture([{name: 'one.ics', body: task('one')}], {handle: async (_url, input) => !input.method ? reply('', 401) : undefined});
  await assert.rejects(client.readDav('tasks', [calendar]), {code: 'AUTH'});
});

test('mobile refresh continues beyond 250 files in bounded batches with four concurrent downloads', async () => {
  let active = 0, maximum = 0;
  const resources = Array.from({length: 270}, (_, index) => ({name: `${String(index).padStart(3, '0')}.ics`, body: task(String(index))}));
  const {client, calls} = fixture(resources, {handle: async (_url, input) => {
    if (!input.method) { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setImmediate(resolve)); active--; }
  }});
  const data = await client.readDav('tasks', [calendar]);
  assert.equal(data.records.length, 270); assert.equal(calls.filter(call => !call.method).length, 270);
  assert.equal(maximum, 4); assert.equal(data.warning, undefined);
  assert.ok(calls.every(call => call.maxResponseBytes <= 2 * 1024 * 1024));
});

test('aggregate download reservations and oversized file metadata stop bounded work honestly', async () => {
  const resources = Array.from({length: 130}, (_, index) => ({name: `${index}.ics`, body: task(String(index))}));
  const {client, calls} = fixture(resources, {handle: async (_url, input) => { if (!input.method) throw new Error('Network interrupted after unknown partial body'); }});
  const data = await client.readDav('tasks', [calendar]);
  assert.equal(calls.filter(call => !call.method).length, 128, 'Unknown failed transfers consume 2 MiB each across sequential 16 MiB batches');
  assert.match(data.warning, /256 MiB/);
  assert.match(data.warning, /Shared Tasks\/Calendar scan:/);
  assert.match(data.warning, /0.00 MiB received in bounded responses; 256.00 MiB reserved for transfers with unknown sizes; 128 failed resource requests/);
  assert.match(data.warning, /NETWORK: 128/);
  const oversized = fixture([{name: 'huge.ics', body: task('huge'), length: 2 * 1024 * 1024 + 1}]);
  assert.match((await oversized.client.readDav('tasks', [calendar])).warning, /2 MiB per file/);
  assert.equal(oversized.calls.filter(call => !call.method).length, 0);
});

test('known small HTTP, empty and changed responses refund their unused download reservations', async () => {
  for (const mode of ['http-error', 'empty', 'changed']) {
    const resources = Array.from({length: 300}, (_, index) => ({name: `${index}.ics`, body: task(String(index))}));
    const {client, calls} = fixture(resources, {handle: (_url, input) => {
      if (input.method) return undefined;
      if (mode === 'http-error') return reply('Retry later', 503);
      if (mode === 'empty') return reply('', 200);
      return reply('Changed resource', 200, {ETag: '"v2"'});
    }});
    const data = await client.readDav('tasks', [calendar]);
    assert.equal(calls.filter(call => !call.method).length, 300, `${mode}: tiny known failures must not stop at 128 reserved transfers`);
    assert.deepEqual(data.records, []); assert.equal(data.errorCode, {'http-error': 'NEXTCLOUD', empty: 'FORMAT', changed: 'CONFLICT'}[mode]);
    assert.match(data.warning, /300 calendar collection\(s\) or item\(s\) could not be read/);
    assert.match(data.warning, /0.00 MiB reserved for transfers with unknown sizes; 300 failed resource requests/);
    assert.match(data.warning, new RegExp(`${data.errorCode}: 300`));
    assert.doesNotMatch(data.warning, /256 MiB resource transfer/);
  }
});

test('mixed and unknown DAV failure details stay neutral and contain no private exception text', async () => {
  const resources = [{name: 'a.ics', body: task('a')}, {name: 'b.ics', body: task('b')}];
  const mixed = fixture(resources, {handle: (url, input) => !input.method ? (url.endsWith('/a.ics') ? reply('', 200) : reply('Unavailable', 503)) : undefined});
  const result = await mixed.client.readDav('tasks', [calendar]);
  assert.equal(result.errorCode, undefined);
  assert.match(result.warning, /FORMAT: 1, NEXTCLOUD: 1/);
  const unknown = fixture(resources), request = unknown.client.request.bind(unknown.client);
  unknown.client.request = (url, input) => input?.method ? request(url, input) : Promise.reject(Object.assign(new Error('Private account token and URL'), {code: 'PRIVATE_CODE'}));
  const neutral = await unknown.client.readDav('tasks', [calendar]);
  assert.equal(neutral.errorCode, undefined); assert.match(neutral.warning, /Unknown: 2/);
  assert.doesNotMatch(neutral.warning, /PRIVATE_CODE|Private account|token|fixture.invalid/);
});

test('readAll shares mixed calendar downloads and uses one global concurrency budget', async () => {
  const body = ics(['BEGIN:VTODO', 'UID:todo', 'SUMMARY:Task', 'END:VTODO', 'BEGIN:VEVENT', 'UID:event', 'SUMMARY:Event', 'DTSTART:20261111T090000Z', 'DTEND:20261111T100000Z', 'END:VEVENT']);
  const {client, calls} = fixture([{name: 'mixed.ics', body}]);
  client.discovered = true; client.refreshCapabilities = async () => false;
  client.discoverCalendars = async () => [calendar];
  client.readNotes = client.readDeck = client.readCollectives = async () => ({records: [], collections: []});
  const data = await client.readAll();
  assert.equal(calls.filter(call => call.method === 'PROPFIND').length, 1);
  assert.equal(calls.filter(call => !call.method).length, 1);
  assert.deepEqual(data.records.map(record => record.source).sort(), ['calendar', 'tasks']);
  assert.ok(data.statuses.every(status => status.state === 'connected'));
});

test('a complete scan continues after 16 MiB while retaining the per-file bound', async () => {
  const limit = 2 * 1024 * 1024, base = event('old').replaceAll('20261111', '20250101');
  const body = base.replace('END:VEVENT', `DESCRIPTION:${'x'.repeat(limit - Buffer.byteLength(base) - 14)}\r\nEND:VEVENT`);
  assert.equal(Buffer.byteLength(body), limit);
  const resources = Array.from({length: 12}, (_, index) => ({name: `${index}.ics`, body, length: limit}));
  const {client, calls} = fixture(resources);
  const data = await client.readDav('calendar', [calendar]);
  assert.equal(calls.filter(call => !call.method).length, 12);
  assert.equal(data.records.length, 0, 'Historical resources are parsed but do not enter the current agenda');
  assert.equal(data.warning, undefined);
});

test('separate task/event calendars share four concurrent GET slots', async () => {
  let active = 0, maximum = 0;
  const resources = Array.from({length: 8}, (_, index) => ({name: `${index}.ics`, body: index % 2 ? task(String(index)) : event(String(index))}));
  const {client} = fixture(resources, {handle: async (_url, input) => {
    if (!input.method) { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setImmediate(resolve)); active--; }
  }});
  client.discovered = true; client.refreshCapabilities = async () => false;
  client.discoverCalendars = async () => [{...calendar, components: ['VTODO']}, {...calendar, href: ROOT.replace('/work/', '/events/'), components: ['VEVENT']}];
  client.readNotes = client.readDeck = client.readCollectives = async () => ({records: [], collections: []});
  const data = await client.readAll();
  assert.equal(maximum, 4); assert.equal(data.records.length, 8);
  assert.ok(data.statuses.every(status => status.state === 'connected'));
});

test('calendar collection enumeration is capped and is never reported as complete', async () => {
  const {client, calls} = fixture([]);
  const calendars = Array.from({length: 70}, (_, index) => ({...calendar, href: ROOT.replace('/work/', `/list-${index}/`)}));
  const data = await client.readDav('tasks', calendars);
  assert.equal(calls.length, 64);
  assert.match(data.warning, /64 collections/);
});

test('fresh inventories reuse exact strong revisions, fetch changed resources, and remove deleted resources', async () => {
  const resources = [{name: 'one.ics', body: task('one'), etag: '"v1"'}, {name: 'two.ics', body: task('two'), etag: '"v1"'}];
  const {client, calls} = fixture(resources);
  const read = () => client.readDav('tasks', [calendar]);
  assert.equal((await read()).records.length, 2);
  calls.length = 0;
  assert.equal((await read()).records.length, 2);
  assert.deepEqual(calls.map(call => call.method), ['PROPFIND'], 'fresh inventory is still required on a cache-only refresh');
  resources[0].etag = '"v2"'; resources[0].body = task('new-version'); resources.pop(); calls.length = 0;
  assert.deepEqual((await read()).records.map(record => record.title), ['Task new-version']);
  assert.equal(calls.filter(call => !call.method).length, 1);
  // Reintroducing a deleted href with the same ETag must not find its evicted body.
  resources.push({name: 'two.ics', body: task('returned'), etag: '"v1"'}); calls.length = 0;
  assert.deepEqual((await read()).records.map(record => record.title).sort(), ['Task new-version', 'Task returned']);
  assert.equal(calls.filter(call => !call.method).length, 1);
});

test('missing or weak fresh validators are never guessed into a cacheable version', async () => {
  for (const validator of [null, 'W/"v1"']) {
    const resources = [{name: 'one.ics', body: task('old'), etag: '"v1"'}];
    const {client, calls} = fixture(resources);
    await client.readDav('tasks', [calendar]);
    resources[0].etag = validator; resources[0].body = task('changed');
    for (let attempt = 0; attempt < 2; attempt++) {
      calls.length = 0;
      assert.equal((await client.readDav('tasks', [calendar])).records[0].title, 'Task changed');
      const downloads = calls.filter(call => !call.method);
      assert.equal(downloads.length, 1); assert.equal(downloads[0].headers['If-Match'], undefined);
    }
  }
});

test('a failed changed-resource GET never replays the previous cached document', async () => {
  let failRead = false;
  const resources = [{name: 'one.ics', body: task('old'), etag: '"v1"'}];
  const {client} = fixture(resources, {handle: (_url, input) => failRead && !input.method ? reply('', 503) : undefined});
  await client.readDav('tasks', [calendar]);
  resources[0].etag = '"v2"'; failRead = true;
  const data = await client.readDav('tasks', [calendar]);
  assert.deepEqual(data.records, []); assert.match(data.warning, /could not be read/);
});

test('permission and authentication failures purge cached documents before reauthorization', async () => {
  for (const status of [403, 401]) {
    let deny = false;
    const resources = [{name: 'one.ics', body: task('old')}];
    const {client, calls} = fixture(resources, {handle: (url, input) => deny && input.method === 'PROPFIND' ? reply(wrap(row(url, '', `${status} Denied`)), 207) : undefined});
    await client.readDav('tasks', [calendar]); deny = true;
    if (status === 401) await assert.rejects(client.readDav('tasks', [calendar]), {code: 'AUTH'});
    else assert.deepEqual((await client.readDav('tasks', [calendar])).revokedCollectionIds, [client.id('tasks', ROOT)]);
    deny = false; resources[0].body = task('fresh'); calls.length = 0;
    assert.equal((await client.readDav('tasks', [calendar])).records[0].title, 'Task fresh');
    assert.equal(calls.filter(call => !call.method).length, 1);
  }
});

test('parallel success cannot repopulate a collection after another GET revoked its permission', async () => {
  let deny = false;
  const resources = ['a', 'b', 'c', 'd'].map(name => ({name: `${name}.ics`, body: task(name)}));
  const {client, calls} = fixture(resources, {handle: async (url, input) => {
    if (deny && !input.method) {
      if (url.endsWith('/a.ics')) return reply('', 403);
      await new Promise(resolve => setImmediate(resolve));
    }
  }});
  deny = true;
  assert.equal((await client.readDav('tasks', [calendar])).records.length, 0);
  deny = false; calls.length = 0;
  assert.equal((await client.readDav('tasks', [calendar])).records.length, 4);
  assert.equal(calls.filter(call => !call.method).length, 4);
});

test('failed root inventories cannot become empty authoritative snapshots or prune good cache', async () => {
  let broken = false;
  const {client, calls} = fixture([{name: 'one.ics', body: task('one')}], {handle: (url, input) => broken && input.method === 'PROPFIND' ? reply(wrap(row(url, '', '500 Failed')), 207) : undefined});
  await client.readDav('tasks', [calendar]); broken = true;
  await assert.rejects(client.readDav('tasks', [calendar]), {code: 'FORMAT'});
  broken = false; calls.length = 0;
  assert.equal((await client.readDav('tasks', [calendar])).records.length, 1);
  assert.equal(calls.filter(call => !call.method).length, 0);
});

test('cancelled account reads schedule no new requests and never return an adoptable snapshot', async () => {
  let active = false, gets = 0;
  const resources = Array.from({length: 300}, (_, index) => ({name: `${index}.ics`, body: task(String(index))}));
  const {client, calls} = fixture(resources, {handle: async (_url, input) => { if (!input.method && ++gets === 1) active = false; }});
  client.discovered = true; client.refreshCapabilities = async () => false;
  client.discoverCalendars = async () => [calendar];
  client.readNotes = client.readDeck = client.readCollectives = async () => ({records: [], collections: []});
  await assert.rejects(client.readAll({isActive: () => active}), {code: 'CANCELLED'});
  assert.equal(calls.length, 0);
  active = true;
  await assert.rejects(client.readAll({isActive: () => active}), {code: 'CANCELLED'});
  assert.ok(gets > 0 && gets <= 4);
});

test('native foreground cancellation stops the scan even before JavaScript receives lifecycle state', async () => {
  const resources = Array.from({length: 300}, (_, index) => ({name: `${index}.ics`, body: task(String(index))}));
  const {client, calls} = fixture(resources, {handle: async (_url, input) => {
    if (!input.method) throw Object.assign(new Error('The native host stopped'), {code: 'CANCELLED'});
  }});
  await assert.rejects(client.readDav('tasks', [calendar]), {code: 'CANCELLED'});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.filter(call => !call.method).length <= 4, 'No follow-up work after native cancellation, despite a still-active JS generation');
});

test('round-robin GET dispatch reaches later task lists before a large event archive', async () => {
  const tasksRoot = ROOT.replace('/work/', '/tasks/');
  const archived = Array.from({length: 300}, (_, index) => ({name: `${index}.ics`, body: event(String(index)).replaceAll('20261111', '20250101')}));
  const later = {name: 'later.ics', body: task('later')};
  const {client, calls} = fixture(archived, {handle: (url, input) => {
    if (input.method === 'PROPFIND' && url === tasksRoot) return reply(wrap(row(url, '<d:resourcetype><d:collection/></d:resourcetype>') + entry(later, url)), 207);
    if (!input.method && url === `${tasksRoot}later.ics`) return reply(later.body, 200, {ETag: '"v1"'});
  }});
  client.discovered = true; client.refreshCapabilities = async () => false;
  client.discoverCalendars = async () => [{...calendar, components: ['VEVENT']}, {...calendar, href: tasksRoot, components: ['VTODO']}];
  client.readNotes = client.readDeck = client.readCollectives = async () => ({records: [], collections: []});
  const data = await client.readAll();
  assert.equal(calls.filter(call => !call.method)[1].url, `${tasksRoot}later.ics`);
  assert.equal(calls.filter(call => !call.method).length, 301);
  assert.deepEqual(data.records.map(record => record.title), ['Task later']);
  assert.ok(data.statuses.every(status => status.state === 'connected'));
});

test('inventory resource bounds reject a whole oversized collection without silently choosing a prefix', async () => {
  const {client, calls} = fixture([]);
  // Inventory parsing/validation is covered above; inject bounded inventory
  // summaries here to isolate admission from generating megabytes of XML.
  client.readDavInventory = async current => ({resources: [], resourceCount: current.title === 'Oversized' ? 10_001 : 10_000, failures: 0, denied: false});
  const tooLarge = await client.readDav('tasks', [{...calendar, title: 'Oversized'}]);
  assert.match(tooLarge.warning, /10,000 resources per collection/);
  const calendars = Array.from({length: 6}, (_, index) => ({...calendar, href: ROOT.replace('/work/', `/list-${index}/`)}));
  const tooMany = await client.readDav('tasks', calendars);
  assert.match(tooMany.warning, /50,000 resources per scan/);
  assert.equal(calls.length, 0, 'no unadmitted inventory prefix is downloaded');
});

test('projection record and byte safety bounds stay explicit even when the transfer completes', async () => {
  const {client} = fixture([{name: 'one.ics', body: task('one')}]);
  // Use the real scanner with a small deterministic projector to isolate the
  // separate limits on projected records from the per-resource download bound.
  client.calendarRecordsCooperative = async () => Array.from({length: 10_001}, (_, index) => ({id: String(index), title: 'Task'}));
  const byCount = await client.readDav('tasks', [{...calendar, components: ['VTODO']}]);
  assert.equal(byCount.records.length, 10_000); assert.match(byCount.warning, /10,000 projected items/);
  client.calendarRecordsCooperative = async () => Array.from({length: 33}, (_, index) => ({id: String(index), title: 'x'.repeat(1024 * 1024)}));
  const byBytes = await client.readDav('tasks', [{...calendar, components: ['VTODO']}]);
  assert.equal(byBytes.records.length, 31); assert.match(byBytes.warning, /32 MiB projected data/);
});
