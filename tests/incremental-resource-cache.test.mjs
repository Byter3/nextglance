import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '../packages/nextcloud/src/nextcloud.mjs';
import {checkedResourceEntry, sourceSelection, validResourceLocator} from '../packages/nextcloud/src/resource-cache-policy.mjs';

const SERVER = 'https://fixture.invalid/nextcloud';
const ROOT = `${SERVER}/remote.php/dav/calendars/tester/work/`;
const calendar = {href: ROOT, title: 'Work', components: ['VTODO', 'VEVENT'], readonly: false};
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const wrap = rows => `<d:multistatus xmlns:d="DAV:">${rows}</d:multistatus>`;
const row = (href, props) => `<d:response><d:href>${xml(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const reply = (body, status = 200, headers = {}) => new Response([204, 304].includes(status) ? null : body, {status, headers});
const ics = (uid, day = null) => ['BEGIN:VCALENDAR', 'VERSION:2.0', `BEGIN:${day ? 'VEVENT' : 'VTODO'}`, `UID:${uid}`, `SUMMARY:${uid}`, ...(day ? [`DTSTART:${day}T090000Z`, `DTEND:${day}T100000Z`] : ['STATUS:NEEDS-ACTION']), `END:${day ? 'VEVENT' : 'VTODO'}`, 'END:VCALENDAR', ''].join('\r\n');
function cachePort() {
  const entries = new Map(), calls = [];
  const key = value => JSON.stringify([value.kind, value.collection, value.href]);
  return {entries, calls,
    async get(value) { calls.push(['get', value]); return structuredClone(entries.get(key(value)) || null); },
    async put(value) { calls.push(['put', value]); entries.set(key(value), structuredClone(value)); },
    async remove(value) { calls.push(['remove', value]); entries.delete(key(value)); },
    async prune(value) { calls.push(['prune', value]); for (const [key, entry] of entries) if (entry.kind === value.kind && entry.collection === value.collection && !value.hrefs.includes(entry.href)) entries.delete(key); },
    async retainCollections(value) { for (const [key, entry] of entries) if (entry.kind === value.kind && !value.collections.includes(entry.collection)) entries.delete(key); },
    async clear() { entries.clear(); },
  };
}
function fixture(resources, cache = cachePort(), options = {}) {
  const calls = [];
  const client = new NextcloudClient({serverUrl: SERVER, username: 'tester'}, {authentication: 'delegated', davReadMode: options.mode || 'propfind-get', resourceCache: cache, now: () => options.now || new Date('2026-11-12T12:00:00Z'), fetch: async (url, input) => {
    calls.push({url, ...input});
    const custom = await options.handle?.(url, input);
    if (custom) return custom;
    if (input.method === 'PROPFIND') return reply(wrap(row(ROOT, '<d:resourcetype><d:collection/></d:resourcetype>') + resources.map(resource => row(`${ROOT}${resource.name}`, `<d:resourcetype/>${resource.etag === null ? '' : `<d:getetag>${xml(resource.etag || '"v1"')}</d:getetag>`}`)).join('')), 207);
    if(input.method==='REPORT'&&input.body.includes('calendar-multiget'))return reply(wrap(resources.filter(resource=>input.body.includes(new URL(ROOT+resource.name).pathname)).map(resource=>row(ROOT+resource.name,`<d:getetag>${xml(resource.etag||'"v1"')}</d:getetag><calendar-data xmlns="urn:ietf:params:xml:ns:caldav">${xml(resource.body)}</calendar-data>`)).join('')),207);
    const resource = resources.find(resource => url === `${ROOT}${resource.name}`);
    return resource ? reply(resource.body, 200, {ETag: resource.etag || '"v1"'}) : reply('', 404);
  }});
  return {client, calls, cache, read: () => client.readDav('tasks', [calendar])};
}

test('bounded batch cache lookups remove per-resource bridge reads and keep invalid/truncated entries safe', async () => {
  const resources=Array.from({length:100},(_,i)=>({name:`${i}.ics`,body:ics(String(i))})), cache=cachePort();let batches=0
  cache.getMany=async locators=>{batches++;assert.ok(locators.length<=32);return locators.map(value=>structuredClone(cache.entries.get(JSON.stringify([value.kind,value.collection,value.href]))||null))}
  const first=fixture(resources,cache);assert.equal((await first.read()).records.length,100)
  assert.equal(cache.calls.filter(([method])=>method==='get').length,0,'confirmed batch misses do not perform a duplicate single lookup')
  cache.calls.length=0;batches=0
  const second=fixture(resources,cache);assert.equal((await second.read()).records.length,100);assert.equal(batches,4)
  assert.equal(cache.calls.filter(([method])=>method==='get').length,0);assert.equal(second.calls.filter(call=>!call.method).length,0)
  cache.getMany=async()=>[]
  const truncated=fixture(resources,cache);assert.equal((await truncated.read()).records.length,100);assert.equal(truncated.calls.filter(call=>!call.method).length,0,'truncated batches use validated individual cache lookup')
})

test('batch lookup errors remain read diagnostics while validated single fallback can recover records',async()=>{
  const cache=cachePort();cache.getMany=async()=>{throw new Error('private cache error')}
  const f=fixture([{name:'one.ics',body:ics('one')}],cache);const context={scan:null,isActive:()=>true,checkActive:()=>{}}
  assert.equal((await f.client.readDav('tasks',[calendar],context)).records.length,1)
  assert.equal(context.cacheWarning.errorCode,'CACHE_READ_FAILED');assert.match(context.cacheWarning.message,/could not be read/);assert.ok(!context.cacheWarning.message.includes('private'))
})

test('Tasks and Calendar reuse one parsed component while retaining exact raw edit bases',async()=>{
  const body=ics('one').replace('END:VCALENDAR',ics('event','20261112').split('\r\n').slice(2).join('\r\n'))
  const f=fixture([{name:'mixed.ics',body}]);const seen=[];const project=f.client.calendarRecordsCooperative.bind(f.client)
  f.client.calendarRecordsCooperative=async(...args)=>{seen.push(args[7]);return project(...args)}
  const result=await f.read();assert.equal(result.records[0].remote.raw,body);assert.equal(seen.length,2);assert.ok(seen[0]);assert.equal(seen[0],seen[1])
})

test('an interrupted scan prioritizes its unfinished tail before replaying a completed prefix',async()=>{
  const f=fixture(Array.from({length:12},(_,i)=>({name:`${i}.ics`,body:ics(String(i))})))
  let count=0,stop=true;const finished=new Set(),seen=[];const original=f.client.calendarRecordsCooperative.bind(f.client)
  f.client.calendarRecordsCooperative=async(...args)=>{
    if(stop&&++count>8)throw Object.assign(new Error('fixture cancellation'),{code:'CANCELLED'})
    seen.push(args[1]);const value=await original(...args);if(stop)finished.add(args[1]);return value
  }
  await assert.rejects(f.read(),{code:'CANCELLED'});assert.ok(finished.size>0)
  stop=false;seen.length=0;assert.equal((await f.read()).records.length,12)
  assert.ok(!finished.has(seen[0]),'unfinished resources are checked first on retry')
})

test('completed native sources publish independently before a slow source settles',async()=>{
  const f=fixture([]);f.client.discovered=true;f.client.refreshCapabilities=async()=>false;let rejectSlow
  f.client.readNotes=async()=>({records:[],collections:[]});f.client.readDeck=()=>new Promise((_,reject)=>{rejectSlow=reject})
  const received=[];const reading=f.client.readAll({sources:['notes','deck'],onSource:value=>received.push(value.statuses[0])})
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(received.map(value=>value.source),['notes'])
  rejectSlow(Object.assign(new Error('fixture private'),{code:'TIMEOUT'}));const result=await reading
  assert.equal(result.statuses.find(value=>value.source==='notes').state,'connected');assert.equal(result.statuses.find(value=>value.source==='deck').errorCode,'TIMEOUT')
})

test('fresh reader restarts reuse durable DAV bodies for either transport, including unprojected events', async () => {
  for (const mode of ['propfind-get', 'report']) {
    const resources = [{name: 'one.ics', body: ics('one')}, {name: 'future.ics', body: ics('future', '20280110')}];
    const first = fixture(resources, undefined, {mode});
    assert.equal((await first.read()).records.length, 1);
    assert.equal(first.cache.entries.size, 2, 'a resource outside the projection window is still persisted');
    const second = fixture(resources, first.cache, {mode, now: new Date('2028-01-10T12:00:00Z')});
    assert.equal((await second.client.readDav('calendar', [calendar])).records[0].title, 'future');
    assert.deepEqual(second.calls.map(call => call.method), ['PROPFIND']);
  }
});

test('fresh inventory downloads only changed/new documents and removes deleted ones', async () => {
  const resources = [{name: 'one.ics', body: ics('one')}, {name: 'old.ics', body: ics('old')}];
  const first = fixture(resources); await first.read();
  resources[0] = {name: 'one.ics', body: ics('changed'), etag: '"v2"'};
  resources[1] = {name: 'new.ics', body: ics('new')};
  const second = fixture(resources, first.cache);
  assert.deepEqual((await second.read()).records.map(record => record.title).sort(), ['changed', 'new']);
  assert.equal(second.calls.filter(call => !call.method).length, 2);
  assert.equal([...first.cache.entries.values()].some(value => value.href.endsWith('old.ics')), false);
});

test('recurrence projection charges the retained raw document once per resource, not once per occurrence', async () => {
  const resources = Array.from({length: 24}, (_, index) => ({name: `series-${index}.ics`, body: ics(`series-${index}`, '20261101').replace('END:VEVENT', `RRULE:FREQ=DAILY;COUNT=100\r\nX-PRESERVED-DATA:${'x'.repeat(16 * 1024)}\r\nEND:VEVENT`)}));
  const reader = fixture(resources);
  const result = await reader.client.readDav('calendar', [calendar]);
  assert.equal(result.warning, undefined);
  assert.equal(result.records.length, 2400);
  assert.ok(result.records.every(record => record.remote.raw === resources.find(resource => record.remote.href.endsWith(resource.name)).body), 'every occurrence keeps its exact original write baseline');
  assert.ok(Buffer.byteLength(JSON.stringify(result.records)) > 32 * 1024 * 1024, 'the old duplicated JSON accounting would exceed the budget');
});

test('distinct projected metadata still enforces the 32 MiB retained-data budget', async () => {
  const resources = Array.from({length: 64}, (_, index) => ({name: `large-${index}.ics`, body: ics(`large-${index}`, '20261101').replace('END:VEVENT', `RRULE:FREQ=DAILY;COUNT=100\r\nDESCRIPTION:${'x'.repeat(6000)}\r\nEND:VEVENT`)}));
  const result = await fixture(resources).client.readDav('calendar', [calendar]);
  assert.match(result.warning, /32 MiB projected data/);
  assert.ok(result.records.length > 0 && result.records.length < 6400);
});

test('weak/missing validators and invalid cached bytes or calendar syntax force actual reads', async () => {
  for (const mode of ['weak', 'missing', 'bytes', 'syntax']) {
    const resources = [{name: 'one.ics', body: ics('one')}];
    const first = fixture(resources); await first.read();
    const entry = [...first.cache.entries.values()][0];
    if (mode === 'weak') resources[0].etag = 'W/"v1"';
    if (mode === 'missing') resources[0].etag = null;
    if (mode === 'bytes') entry.bytes++;
    if (mode === 'syntax') { entry.body = 'broken calendar'; entry.bytes = entry.body.length; }
    const second = fixture(resources, first.cache); await second.read();
    assert.equal(second.calls.filter(call => !call.method).length, 1, mode);
  }
});

test('interrupted partial scans persist individual successes and restart without downloading them again', async () => {
  const resources = Array.from({length: 8}, (_, index) => ({name: `${index}.ics`, body: ics(String(index))}));
  const first = fixture(resources, undefined, {handle: (url, input) => !input.method && url.endsWith('/3.ics') ? reply('', 503) : null});
  const partial = await first.read();
  assert.match(partial.warning, /could not be read/); assert.equal(first.cache.entries.size, 7);
  const second = fixture(resources, first.cache); assert.equal((await second.read()).records.length, 8);
  assert.deepEqual(second.calls.filter(call => !call.method).map(call => call.url), [`${ROOT}3.ics`]);
});

test('permission denial purges durable resources and failed inventories preserve them', async () => {
  for (const status of [403, 503]) {
    const resources = [{name: 'one.ics', body: ics('one')}];
    const first = fixture(resources); await first.read();
    const second = fixture(resources, first.cache, {handle: (_url, input) => input.method ? reply('', status) : null});
    if (status === 403) { assert.equal((await second.read()).records.length, 0); assert.equal(first.cache.entries.size, 0); }
    else { await assert.rejects(second.read()); assert.equal(first.cache.entries.size, 1); }
  }
});

test('selected refresh runs only requested sources and rejects empty/unknown requests', async () => {
  const f = fixture([]), read = [];
  f.client.discovered = true; f.client.refreshCapabilities = async () => false;
  f.client.readDeck = async () => { read.push('deck'); return {records: [], collections: []}; };
  f.client.discoverCalendars = async () => { throw new Error('Unexpected DAV discovery'); };
  const progress = [];
  const result = await f.client.readAll({sources: ['deck'], onProgress: value => progress.push(value)});
  assert.deepEqual(read, ['deck']); assert.deepEqual(result.statuses.map(value => value.source), ['deck']);
  assert.ok(progress.every(value => value.sources.length === 1 && value.sources[0] === 'deck'));
  for (const sources of [[], ['unknown'], 'deck']) await assert.rejects(f.client.readAll({sources}), {code: 'VALIDATION'});
});

test('resource validation binds exact server/base path, locator, size and HTTP validator', () => {
  const locator = {kind: 'dav', collection: ROOT, href: `${ROOT}one.ics`};
  const value = {version: 1, ...locator, etag: '"v1"', body: 'é', bytes: 2};
  assert.deepEqual(checkedResourceEntry(value, locator, SERVER), value);
  for (const patch of [{bytes: 1}, {etag: 'W/"v1"'}, {href: `${ROOT}other.ics`}, {version: 2}]) assert.equal(checkedResourceEntry({...value, ...patch}, locator, SERVER), null);
  assert.equal(validResourceLocator({...locator, href: 'https://evil.invalid/one.ics'}, SERVER), false);
  assert.equal(validResourceLocator({...locator, collection: ROOT.replace('/nextcloud', ''), href: locator.href.replace('/nextcloud', '')}, SERVER), false);
  assert.deepEqual(sourceSelection(['deck', 'deck']), ['deck']);
});

test('Deck conditional stacks reuse verified full response; changed board permissions override old data', async () => {
  const cache = cachePort(), calls = [];
  const stacks = [{id: 3, title: 'Doing', cards: [{id: 7, title: 'Work', stackId: 3}]}];
  let editable = true, revision = '"v1"';
  const make = () => new NextcloudClient({serverUrl: SERVER, username: 'tester', appPassword: 'fixture'}, {resourceCache: cache, fetch: async (url, input) => {
    calls.push({url, ...input});
    if (url.endsWith('?details=true')) return reply(JSON.stringify([{id: 2, title: 'Board', permissions: {PERMISSION_EDIT: editable}}]));
    if (input.headers['If-None-Match'] === revision) return reply(null, 304);
    return reply(JSON.stringify(stacks), 200, {ETag: revision});
  }});
  await make().readDeck(); editable = false; calls.length = 0;
  const second = await make().readDeck();
  assert.equal(calls[1].headers['If-None-Match'], '"v1"'); assert.equal(second.records[0].readonly, true);
  revision = '"v2"'; stacks[0].cards[0].title = 'Changed';
  assert.equal((await make().readDeck()).records[0].title, 'Changed');
  [...cache.entries.values()][0].body = '{}'; calls.length = 0;
  await make().readDeck(); assert.equal(calls[1].headers['If-None-Match'], undefined);
});

test('late successful resource writes cannot repopulate a revoked collection', async () => {
  const resources = ['a', 'b'].map(name => ({name: `${name}.ics`, body: ics(name)}));
  const cache = cachePort(), put = cache.put.bind(cache); let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  cache.put = async value => { entered(); await new Promise(resolve => { release = resolve; }); await put(value); };
  const f = fixture(resources, cache, {handle: async (url, input) => {
    if (!input.method && url.endsWith('/b.ics')) { await waiting; setImmediate(() => release()); return reply('', 403); }
  }});
  assert.deepEqual((await f.read()).records, []); assert.equal(cache.entries.size, 0);
});

test('a native write invalidates its resource and cannot certify an old cached body', async () => {
  const resources = [{name: 'one.ics', body: ics('one')}], f = fixture(resources);
  await f.read(); assert.equal(f.cache.entries.size, 1);
  await f.client.request(`${ROOT}one.ics`, {method: 'PUT', body: ics('changed')});
  assert.equal(f.cache.entries.size, 0);
  f.calls.length = 0; await f.read(); assert.equal(f.calls.filter(call => !call.method).length, 1);
});

test('failed local cache IO remains a separate warning after a successful selected refresh', async () => {
  for (const [operation, code] of [['get', 'CACHE_READ_FAILED'], ['put', 'CACHE_WRITE_FAILED']]) {
    const cache = cachePort(); cache[operation] = async () => { throw new Error('private disk failure'); };
    const f = fixture([{name: 'one.ics', body: ics('one')}], cache);
    f.client.discovered = true; f.client.refreshCapabilities = async () => false;
    f.client.discoverCalendars = async () => [calendar];
    const result = await f.client.readAll({sources: ['tasks']});
    assert.equal(result.statuses[0].state, 'connected'); assert.equal(result.records.length, 1);
    assert.equal(result.cacheWarning.errorStage, 'local-cache'); assert.equal(result.cacheWarning.errorCode, code);
    assert.doesNotMatch(JSON.stringify(result), /private disk failure/);
  }
});

test('elapsed pass deadline reports a retryable timeout without advancing freshness', async t => {
  let clock = 1000;
  t.mock.method(Date, 'now', () => clock);
  const f = fixture([{name: 'one.ics', body: ics('one')}], undefined, {handle: (_url, input) => { if (input.method === 'PROPFIND') clock += 120_001; }});
  f.client.discovered = true; f.client.refreshCapabilities = async () => false;
  f.client.discoverCalendars = async () => [calendar];
  const result = await f.client.readAll({sources: ['tasks', 'calendar']});
  assert.ok(result.statuses.every(status => status.state === 'error' && status.errorCode === 'TIMEOUT' && status.lastSyncedAt === undefined));
  assert.equal(f.calls.filter(call => !call.method).length, 0);
});

test('selected calendar source shares scan without projecting or reporting unrequested tasks', async () => {
  const f = fixture([{name: 'one.ics', body: ics('one')}, {name: 'event.ics', body: ics('event', '20261112')}]);
  f.client.discovered = true; f.client.refreshCapabilities = async () => false;
  f.client.discoverCalendars = async () => [calendar];
  const result = await f.client.readAll({sources: ['calendar']});
  assert.deepEqual(result.statuses.map(status => status.source), ['calendar']);
  assert.deepEqual(result.records.map(record => record.source), ['calendar']);
  assert.equal(f.cache.entries.size, 2);
});

test('a hot-cache DAV pass yields before its resource batch completes without redownloading bodies', async () => {
  const resources = Array.from({length:80}, (_, index) => ({name:`cached-${index}.ics`,body:ics(`Work ${index}`)}));
  const f = fixture(resources); await f.read(); f.calls.length = 0;
  let projected = 0, observedAtYield;
  const original = f.client.calendarRecordsCooperative.bind(f.client);
  f.client.calendarRecordsCooperative = (...args) => {
    if (++projected === 1) setTimeout(() => {observedAtYield = projected;}, 0);
    return original(...args);
  };
  const result = await f.read();
  assert.equal(result.records.length,80); assert.equal(result.warning,undefined);
  assert.ok(observedAtYield > 0 && observedAtYield < projected, 'Presentation/event-loop work can run before the cached projection finishes');
  assert.equal(f.calls.filter(call => !call.method).length,0, 'Only fresh inventory is fetched for unchanged strong ETags');
});
