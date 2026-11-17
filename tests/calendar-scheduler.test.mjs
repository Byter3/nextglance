import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {nativePermissionResponse} from './native-permission-fixtures.mjs'
import {NextcloudClient, calendarInterval} from '@nextspace/nextcloud-node/nextcloud.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {reconcileIdentities} from '@nextspace/core/identity.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
const {CalendarScheduler} = createRequire(import.meta.url)('../win/electron/scheduling.cjs')
const clone = value => structuredClone(value)
const calendar = {id: 'calendar-1', source: 'calendar', title: 'Freelance', remote: {href: 'https://fixture.test/remote.php/dav/calendars/test/work/'}}

function fixture() {
  const files = new Map(), resources = new Map(), calls = []
  let journalFailure = 0, journalWrites = 0, readFailure = 0, saveFailure = 0, lostPut = false
  const io = {
    readFile: async file => {if (!files.has(file)) throw Object.assign(new Error('Absent'), {code: 'ENOENT'}); return files.get(file)},
    writeJson: async (file, value) => {if (++journalWrites === journalFailure) throw Object.assign(new Error('Full'), {code: 'ENOSPC'}); files.set(file, JSON.stringify(value))},
  }
  const store = {
    directory: '/fixture/account-a',
    value: {revision: 0, workspace: createPlannerWorkspace(), cache: {records: [
      {id: 'card-1', source: 'deck', kind: 'card', title: 'Readonly card', readonly: true},
      {id: 'task-1', source: 'tasks', kind: 'task', title: 'Task'},
      {id: 'note-1', source: 'notes', kind: 'note', title: 'Note'},
    ], collections: [clone(calendar)], statuses: [{source: 'calendar', state: 'connected', count: 0}]}},
    snapshot() {return clone(this.value)},
    async updateCache(cache) {
      if (typeof cache === 'function') cache = cache(clone(this.value.cache))
      const next = reconcileIdentities(this.value.workspace, cache.records)
      this.value = {...this.value, revision: this.value.revision + 1, workspace: validateWorkspace(next.workspace), cache: {...clone(cache), records: next.records}}
    },
    async saveWorkspace(workspace, revision) {
      if (saveFailure-- > 0) throw new Error('Metadata save failed')
      assert.equal(revision, this.value.revision)
      this.value = {...this.value, revision: revision + 1, workspace: validateWorkspace(clone(workspace))}
    },
  }
  store.value.workspace.identities = store.value.cache.records.map(record => ({id: record.id, source: record.source, key: `legacy:${record.id}`}))
  const client = new NextcloudClient({serverUrl: 'https://fixture.test', username: 'test', appPassword: 'fixture-only'}, {fetch: async (url, options) => {
    calls.push({url, method: options.method || 'GET'})
    const authority=nativePermissionResponse(url,options);if(authority)return authority
    if (options.method === 'PUT') {
      assert.equal(options.headers['If-None-Match'], '*')
      if (resources.has(url)) return new Response('', {status: 412})
      resources.set(url, options.body)
      if (lostPut) {lostPut = false; throw new Error('Connection lost after server commit')}
      return new Response('', {status: 201, headers: {ETag: '"native-1"'}})
    }
    if (readFailure-- > 0) return new Response('', {status: 503})
    return new Response(resources.get(url) || '', {status: resources.has(url) ? 200 : 404, headers: {ETag: '"native-1"'}})
  }})
  let scheduler = new CalendarScheduler(io)
  const state = () => ({...store.snapshot(), pendingSchedules: scheduler.pending(store)})
  const invoke = input => scheduler.create(input, {store, client, getCollection: id => store.value.cache.collections.find(item => item.id === id), validateInterval: calendarInterval, state})
  const request = overrides => ({recordId: 'card-1', title: 'Work session', collectionId: calendar.id, start: '2027-05-01T09:00:00Z', end: '2027-05-01T10:00:00Z', requestId: randomUUID(), expectedRevision: store.value.revision, ...overrides})
  return {client, store, resources, files, calls, state, invoke, request, restart: async () => {scheduler = new CalendarScheduler(io); await scheduler.load(store)},
    failRead: () => {readFailure = 1}, failSave: () => {saveFailure = 1}, failJournal: n => {journalFailure = n}, losePut: () => {lostPut = true}}
}

test('scheduling creates separate native sessions with durable links, including a read-only source card', async () => {
  const f = fixture(), first = f.request()
  const one = await f.invoke(first)
  assert.equal(f.resources.size, 1)
  assert.equal(one.workspace.relations.length, 1)
  const linked = one.cache.records.find(record => record.id === one.workspace.relations[0].toId)
  assert.equal(linked.remote.uid, `nextspace-${first.requestId}`)
  assert.equal(Date.parse(linked.start), Date.parse(first.start), 'Direct GET includes a booking outside the usual agenda window')
  assert.equal(linked.busy, true)
  assert.equal(one.workspace.relations[0].type, 'scheduled_during')
  assert.equal(one.workspace.relations[0].fromId, 'card-1')
  assert.deepEqual(one.pendingSchedules, [])
  const nativeCalls = f.calls.length
  await f.invoke(first)
  assert.equal(f.calls.length, nativeCalls, 'Repeated completed submit is a no-op')
  await f.invoke(f.request({start: '2027-05-01T13:00:00Z', end: '2027-05-01T14:00:00Z'}))
  assert.equal(f.resources.size, 2)
  assert.equal(f.state().workspace.relations.length, 2)
  await f.invoke(f.request({recordId: 'task-1', allDay: true, start: '2027-05-02', end: '2027-05-03'}))
  assert.equal(f.state().workspace.relations.at(-1).fromId, 'task-1')
})

test('Windows invitation booking journals freeze guests across restart and preserve native identity',async()=>{
  const f=fixture(),authority={owned:true,canInvite:true,canRespond:true,addresses:['alex@example.test'],organizer:{uri:'mailto:alex@example.test'}}
  f.client.discoverCalendars=async()=>[{href:calendar.remote.href,title:calendar.title,readonly:false,components:['VEVENT'],scheduling:authority}]
  const request=f.request({attendees:[{email:'bea@example.test',name:'Bea'}]});f.failSave()
  await assert.rejects(f.invoke(request),/retry this same booking/)
  const journal=[...f.files.values()][0]
  assert.deepEqual(f.state().pendingSchedules[0].attendees,request.attendees)
  await f.restart();assert.equal([...f.files.values()][0],journal)
  await assert.rejects(f.invoke({...request,attendees:[{email:'casey@example.test'}]}),/original saved details/)
  const saved=await f.invoke(request),event=saved.cache.records.find(item=>item.source==='calendar')
  assert.equal(event.eventScheduling.role,'organizer');assert.equal(event.eventAccess.editAttendees,true)
  assert.equal(saved.cache.collections[0].calendarScheduling.canInvite,true)
  assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(saved.workspace.relations.length,1)
})

test('Windows linked invitation creation warns after failed verification without offering a duplicate booking',async()=>{
  const f=fixture();f.client.discoverCalendars=async()=>[{href:calendar.remote.href,title:calendar.title,readonly:false,components:['VEVENT'],scheduling:{owned:true,canInvite:true,canRespond:true,addresses:['alex@example.test'],organizer:{uri:'mailto:alex@example.test'}}}]
  const request=f.request({attendees:[{email:'bea@example.test'}]});f.failRead()
  const saved=await f.invoke(request)
  assert.match(saved.creationWarning,/created/);assert.equal(saved.cache.records.find(item=>item.source==='calendar').readonly,true)
  assert.equal(saved.workspace.relations.length,1);assert.deepEqual(saved.pendingSchedules,[])
  await f.invoke(request);assert.equal(f.calls.filter(call=>call.method==='PUT').length,1)
})

test('booking details survive restart and are immutable while absent legacy fields keep their original digest',async()=>{
  for(const extra of [{},{location:'Studio B',description:'Scheduled work: Planning',reminders:[30,15]}]){
    const f=fixture(),request=f.request(extra);f.failRead();
    await assert.rejects(f.invoke(request));
    const before=[...f.files.values()][0],pending=f.state().pendingSchedules[0];
    if(extra.reminders){assert.deepEqual(pending.reminders,[15,30]);assert.equal(pending.location,'Studio B')}
    else{assert.equal(Object.hasOwn(pending,'reminders'),false);assert.equal(Object.hasOwn(pending,'location'),false)}
    await f.restart();assert.equal([...f.files.values()][0],before);
    await assert.rejects(f.invoke({...request,location:'Elsewhere'}),/original saved details/);
    await assert.rejects(f.invoke({...request,reminders:[0]}),/original saved details/);
    const result=await f.invoke(request),saved=result.cache.records.find(item=>item.source==='calendar');
    assert.equal(saved.location,extra.location||'');assert.deepEqual(saved.reminders,extra.reminders?[15,30]:[]);
    assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
    assert.equal(result.workspace.relations.length,1);
  }
})

test('invalid scheduling inputs, stale metadata and unavailable calendars cause no native writes', async () => {
  const f = fixture()
  for (const overrides of [{recordId: 'note-1'}, {recordId: 'foreign-account-card'}, {collectionId: 'missing'}, {expectedRevision: 99}, {requestId: 'not-a-uuid'}, {start: '2027-02-30', end: '2027-03-02', allDay: true}, {end: '2027-05-01T08:00:00Z'}]) await assert.rejects(f.invoke(f.request(overrides)))
  f.store.value.cache.collections[0].readonly = true
  await assert.rejects(f.invoke(f.request()), /writable/)
  assert.equal(f.calls.length, 0)
  assert.equal(f.files.size, 0)
})

test('the retry identity must be saved before creating an event', async () => {
  const f = fixture(); f.failJournal(1)
  await assert.rejects(f.invoke(f.request()), /Full/)
  assert.equal(f.calls.length, 0)
  assert.deepEqual(f.state().pendingSchedules, [])
})

test('a partial read failure survives restart and resumes the same resource despite later planner edits', async () => {
  const f = fixture(), request = f.request(); f.failRead()
  await assert.rejects(f.invoke(request), /retry this same booking safely/)
  assert.equal(f.resources.size, 1)
  assert.equal(f.state().pendingSchedules[0].created, true)
  await f.restart()
  f.store.value.revision++
  f.store.value.workspace.name = 'Unrelated later change'
  await assert.rejects(f.invoke({...request, title: 'Changed retry'}), /original saved details/)
  await assert.rejects(f.invoke(f.request()), /unfinished booking/)
  const result = await f.invoke(request)
  assert.equal(result.workspace.name, 'Unrelated later change')
  assert.equal(result.workspace.relations.length, 1)
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1)
  assert.deepEqual(result.pendingSchedules, [])
})

test('a lost create response is recovered through conditional PUT and verified event ownership', async () => {
  const f = fixture(), request = f.request(); f.losePut()
  await assert.rejects(f.invoke(request), /saved; retry/)
  assert.equal(f.state().pendingSchedules[0].created, false)
  await f.restart()
  await f.invoke(request)
  assert.equal(f.resources.size, 1)
  assert.equal(f.state().workspace.relations.length, 1)
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 2, 'The second conditional PUT receives 412 without overwriting')
})

test('metadata and completion-journal failures preserve identity and never duplicate links', async () => {
  for (const phase of ['metadata', 'journal']) {
    const f = fixture(), request = f.request()
    if (phase === 'metadata') f.failSave(); else f.failJournal(3)
    await assert.rejects(f.invoke(request), /saved; retry/)
    const originalId = f.state().cache.records.find(record => record.kind === 'event').id
    await f.restart()
    const result = await f.invoke(request)
    assert.equal(result.workspace.relations.length, 1)
    assert.equal(result.workspace.relations[0].toId, originalId)
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1)
    assert.deepEqual(result.pendingSchedules, [])
  }
})

test('known-created events deleted in Nextcloud are never recreated by a retry', async () => {
  const f = fixture(), request = f.request(); f.failRead()
  await assert.rejects(f.invoke(request))
  f.resources.clear()
  await f.restart()
  await assert.rejects(f.invoke(request), /retry/)
  assert.equal(f.resources.size, 0)
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1)
  assert.equal(f.state().workspace.relations.length, 0)
})

test('journal state stays scoped to its account and corruption disables scheduling without replacing it', async () => {
  const f = fixture(); f.failRead(); await assert.rejects(f.invoke(f.request()))
  const journalPath = [...f.files.keys()][0], original = f.files.get(journalPath)
  f.store.directory = '/fixture/account-b'
  await f.restart()
  assert.deepEqual(f.state().pendingSchedules, [])
  f.store.directory = '/fixture/account-a'; f.files.set(journalPath, '{broken')
  await f.restart()
  const before = f.calls.length
  await assert.rejects(f.invoke(f.request()), /disabled to avoid creating duplicates/)
  assert.equal(f.files.get(journalPath), '{broken')
  assert.equal(f.calls.length, before)
  assert.ok(original.includes('created'))
})
