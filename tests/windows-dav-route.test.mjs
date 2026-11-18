import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '../packages/nextcloud-node/src/nextcloud.mjs';

const SERVER = 'https://calendar.example.test';
const ROOT = `${SERVER}/remote.php/dav/calendars/fixture/work/`;
const NOW = new Date('2026-11-18T00:00:00Z');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const row = (href, properties) => `<d:response><d:href>${escape(href)}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const response = rows => new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}</d:multistatus>`, {status: 207});
const document = (component, uid, properties) => ['BEGIN:VCALENDAR', 'VERSION:2.0', `BEGIN:${component}`, `UID:${uid}`, `SUMMARY:${uid}`, ...properties, `END:${component}`, 'END:VCALENDAR', ''].join('\n');
const resource = (name, component, properties) => ({href: `${ROOT}${name}.ics`, etag: '"fixture-revision"', body: document(component, name, properties)});
const bodyRow = value => row(value.href, `<d:getetag>${escape(value.etag)}</d:getetag><c:calendar-data>${escape(value.body)}</c:calendar-data>`);

for (const kind of ['sync-token', 'ctag']) test(`Windows REPORT without a durable cache remains horizon-bounded when discovery returns ${kind}`, async t => {
  let elapsed = NOW.getTime();
  t.mock.method(Date, 'now', () => elapsed);
  const history = Array.from({length: 512}, (_, index) => resource(`historic-${index}`, 'VEVENT', ['DTSTART:20000110T090000Z', 'DTEND:20000110T100000Z']));
  const current = resource('current-booking', 'VEVENT', ['DTSTART:20261118T090000Z', 'DTEND:20261118T100000Z']);
  const tasks = [resource('old-completed-task', 'VTODO', ['DUE;VALUE=DATE:20000110', 'STATUS:COMPLETED']), resource('undated-task', 'VTODO', ['STATUS:NEEDS-ACTION'])];
  const resources = [...history, current, ...tasks], requests = [];
  const client = new NextcloudClient({serverUrl: SERVER, username: 'fixture', appPassword: 'fixture-app-password'}, {
    now: () => NOW,
    fetch: async (url, options) => {
      requests.push({url, method: options.method, body: options.body});
      // Model network cost with an injected clock, never an actual long wait.
      // Downloading all 512 historical documents exhausts the existing budget.
      elapsed += 5000;
      if (options.method === 'PROPFIND') return response(row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') + resources.map(value => row(value.href, `<d:resourcetype/><d:getetag>${escape(value.etag)}</d:getetag>`)).join(''));
      if (options.method === 'REPORT' && options.body.includes('calendar-multiget')) return response(resources.filter(value => options.body.includes(new URL(value.href).pathname)).map(bodyRow).join(''));
      if (options.method === 'REPORT' && options.body.includes('calendar-query')) return response((options.body.includes('name="VTODO"') ? tasks : [current]).map(bodyRow).join(''));
      throw new Error('Unexpected fixture request');
    },
  });
  client.discovered = true;
  client.refreshCapabilities = async () => false;
  client.discoverCalendars = async () => [{href: ROOT, title: 'Fixture work', components: ['VTODO', 'VEVENT'], readonly: false, token: {kind, value: 'fixture-token'}}];
  const result = await client.readAll({sources: ['tasks', 'calendar']});

  assert.ok(result.statuses.every(status => status.state === 'connected'), JSON.stringify(result.statuses.map(({source, state, errorCode}) => ({source, state, errorCode}))));
  assert.deepEqual(result.statuses.map(status => [status.source, status.state, status.lastSyncedAt]), [['tasks', 'connected', NOW.toISOString()], ['calendar', 'connected', NOW.toISOString()]]);
  assert.deepEqual(result.records.filter(record => record.source === 'tasks').map(record => record.title).sort(), ['old-completed-task', 'undated-task']);
  assert.equal(result.records.find(record => record.title === 'old-completed-task').completed, true);
  assert.deepEqual(result.records.filter(record => record.source === 'calendar').map(record => record.title), ['current-booking']);
  assert.equal(requests.length, 2, 'one query per component, with no historical inventory, GET or multiget scan');
  assert.ok(requests.every(request => request.method === 'REPORT' && request.url === ROOT && request.body.includes('calendar-query')));
  const taskQuery = requests.find(request => request.body.includes('name="VTODO"')).body;
  const calendarQuery = requests.find(request => request.body.includes('name="VEVENT"')).body;
  assert.doesNotMatch(taskQuery, /time-range/, 'task retrieval remains complete, including old and undated tasks');
  assert.match(calendarQuery, /<c:time-range start="20261104T000000Z" end="20270216T000000Z"\/>/);
  for (const record of result.records) {
    const source = resources.find(value => value.href === record.remote.href);
    assert.equal(record.etag, source.etag);
    assert.equal(record.remote.raw, source.body, 'native conditional-edit baselines remain exact');
  }
});
