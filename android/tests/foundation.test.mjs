import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {cacheKey} from '../src/controller.mjs'
import {checkedAccount, checkedSourceCache, mergeSourceRefresh, normalizeDeviceState, publicSnapshot, refreshDue, SOURCES, syncHealth} from '../src/foundation.mjs'
import {createOperationGate} from '../src/operation-gate.mjs'
import {NATIVE_OPERATIONS} from '../src/native-edits.mjs'

const account = {serverUrl: 'https://example.test/nc', username: 'canonical-user', name: 'Provider account'}
const statuses = () => SOURCES.map(source => ({source, state: 'connected', count: 0}))
const state = () => ({...createEmptyState(), connection: {connected: true, serverUrl: account.serverUrl, username: account.username}, storage: {syncStatus: 'synced'}, statuses: statuses()})
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return {promise, resolve} }
const tick = () => new Promise(done => setImmediate(done))

test('physical cache keys preserve the provider locator and isolate canonical users and servers', () => {
  assert.equal(cacheKey(account), cacheKey({...account}))
  assert.notEqual(cacheKey(account), cacheKey({...account, name: 'Different provider locator'}))
  assert.notEqual(cacheKey(account), cacheKey({...account, username: 'other'}))
  assert.notEqual(cacheKey(account), cacheKey({...account, serverUrl: 'https://other.test/nc'}))
  assert.throws(() => checkedAccount({...account, username: 'x'.repeat(513)}), {code: 'FORMAT'})
  assert.throws(() => checkedAccount({...account, name: 'bad\0name'}), {code: 'FORMAT'})
})

test('public source snapshots preserve native fields and strip private locators and snapshots', () => {
  const saved = state()
  saved.records = [{id:'card', source:'deck', kind:'card', title:'Native card', readonly:false, status:'DONE', completed:false, start:'2026-11-01T08:00:00Z', due:'2026-11-02T08:00:00Z', color:'#abcdef', tags:['Action'], nativeDependencies:['prerequisite'], identity:{source:'deck',key:'native-key'}, remote:{nativeId:1, raw:'secret source details'}}]
  saved.collections = [{id:'board',source:'deck',title:'Board',readonly:false,remote:{boardId:4}}]
  const snapshot = publicSnapshot(saved)
  assert.equal(snapshot.records[0].readonly, false); assert.equal(snapshot.records[0].completed, false)
  assert.equal(snapshot.records[0].remote, undefined); assert.equal(snapshot.records[0].identity, undefined)
  assert.equal(snapshot.collections[0].remote, undefined)
  assert.deepEqual(snapshot.records[0].nativeDependencies, ['prerequisite'])
  snapshot.records[0].title = 'Caller edit'; assert.equal(saved.records[0].title, 'Native card')
  saved.statuses.find(status => status.source === 'deck').state = 'unavailable'
  assert.equal(publicSnapshot(saved).records[0].readonly, true)
  assert.equal(saved.records[0].readonly, false, 'Unverified UI state must not alter private native permissions')
})

test('public snapshots never visit private source bodies and isolate all nested public values', () => {
  const saved = state()
  const remote = {category: 'Work'}
  Object.defineProperty(remote, 'raw', {enumerable: true, get() { assert.fail('Private raw body must not be traversed by a public copy') }})
  saved.records = [{id: 'note', source: 'notes', kind: 'note', title: 'Note', tags: ['Work'], remote, identity: {private: () => {}}}]
  const first = publicSnapshot(saved), second = publicSnapshot(saved)
  assert.deepEqual(first.records[0].remote, {category: 'Work'})
  first.records[0].tags.push('Caller edit'); first.records[0].remote.category = 'Caller edit'
  assert.deepEqual(second.records[0].tags, ['Work'])
  assert.equal(second.records[0].remote.category, 'Work')
  assert.deepEqual(saved.records[0].tags, ['Work'])
})

test('refresh preserves only known optional metadata and honors explicit empty values', () => {
  const saved = state()
  saved.records = [{id:'card',source:'deck',kind:'card',title:'Old',body:'Old body',attachmentFileIds:['7']}, {id:'note',source:'notes',kind:'note',title:'Note',fileTags:[{id:'8',title:'Work',assignable:true}]}]
  const incoming = {records:[{id:'card',source:'deck',kind:'card',title:'Current'}, {id:'note',source:'notes',kind:'note',title:'Note',tags:['Favorite']}],collections:[],statuses:statuses()}
  let merged = mergeSourceRefresh(saved,incoming)
  assert.deepEqual(merged.records[0].attachmentFileIds,['7']); assert.equal(merged.records[0].body,undefined)
  assert.deepEqual(merged.records[1].tags,['Favorite','Work'])
  incoming.records[0].attachmentFileIds = []; incoming.records[1].fileTags = []; incoming.records[1].tags = []
  merged = mergeSourceRefresh(saved,incoming)
  assert.deepEqual(merged.records[0].attachmentFileIds,[]); assert.deepEqual(merged.records[1].fileTags,[])
})

test('partial native refresh merges by native key before canonical ID reconciliation', () => {
  const saved = state(), identity = {source:'deck',key:'account:deck:5'}
  saved.records = [{id:'uuid',source:'deck',kind:'card',title:'Old',collectionId:'board',identity}]
  const incoming = {records:[{id:'native-id',source:'deck',kind:'card',title:'Fresh',collectionId:'board',identity}],collections:[],statuses:statuses()}
  incoming.statuses.find(status => status.source === 'deck').state = 'error'
  assert.equal(mergeSourceRefresh(saved,incoming).records.length,1)
  incoming.statuses.find(status => status.source === 'deck').revokedCollectionIds = ['board']
  assert.equal(mergeSourceRefresh(saved,incoming).records.length,0)
})

test('unusable source cache cannot reset or cross account identity', () => {
  const cached = {version:1,accountKey:cacheKey(account),records:[],collections:[],statuses:[]}
  assert.deepEqual(checkedSourceCache(cached,cacheKey(account)),cached)
  assert.throws(() => checkedSourceCache(cached,'other'), {code:'CACHE_FORMAT'})
  assert.throws(() => checkedSourceCache({...cached, records:'not array'},cacheKey(account)), {code:'CACHE_FORMAT'})
})

test('event detail fields survive private and public cache projection with typed reminder validation',()=>{
  const event={id:'event',source:'calendar',kind:'event',title:'Visit',location:'Studio',reminders:[0,15],unsupportedReminderCount:1}
  const cached={version:1,accountKey:cacheKey(account),records:[event],collections:[],statuses:statuses()}
  assert.deepEqual(checkedSourceCache(cached,cacheKey(account)).records[0],event)
  assert.deepEqual(publicSnapshot({...state(),records:[event]}).records[0],event)
  for(const change of [{location:2},{reminders:[15,15]},{reminders:[-1]},{unsupportedReminderCount:-1},{unsupportedReminderCount:1.5}])assert.throws(()=>checkedSourceCache({...cached,records:[{...event,...change}]},cacheKey(account)),{code:'CACHE_FORMAT'})
})

test('native scheduling projections survive private/public state without granting cached authority',()=>{
  const eventScheduling={role:'attendee',organizer:{uri:'mailto:owner@example.test',name:'Owner'},attendees:[{uri:'mailto:guest@example.test',participation:'ACCEPTED',rsvp:false}],ownAttendeeUri:'mailto:guest@example.test'}
  const eventAccess={editDetails:false,editReminders:true,editAttendees:false,respond:true,delete:false,reason:'not-organizer'}
  const calendarScheduling={canInvite:true,organizer:{uri:'mailto:guest@example.test'}}
  const event={id:'event',source:'calendar',kind:'event',title:'Invitation',eventScheduling,eventAccess,readonly:true}
  const collection={id:'calendar',source:'calendar',title:'Calendar',calendarScheduling}
  const cached={version:1,accountKey:cacheKey(account),records:[event],collections:[collection],statuses:statuses()}
  const restored=checkedSourceCache(cached,cacheKey(account));const view=publicSnapshot({...state(),...restored})
  assert.deepEqual(view.records[0].eventScheduling,eventScheduling);assert.deepEqual(view.records[0].eventAccess,eventAccess);assert.deepEqual(view.collections[0].calendarScheduling,calendarScheduling)
  view.records[0].eventAccess.respond=false;assert.equal(restored.records[0].eventAccess.respond,true,'public objects remain detached')
  for(const change of [{eventAccess:{...eventAccess,respond:'yes'}},{eventScheduling:{...eventScheduling,role:'administrator'}},{eventScheduling:{...eventScheduling,attendees:[{uri:'mailto:guest@example.test',participation:1}]}}])assert.throws(()=>checkedSourceCache({...cached,records:[{...event,...change}]},cacheKey(account)),{code:'CACHE_FORMAT'})
  assert.throws(()=>checkedSourceCache({...cached,collections:[{...collection,calendarScheduling:{canInvite:1}}]},cacheKey(account)),{code:'CACHE_FORMAT'})
})

test('preference normalization uses shared enums, bounds and defaults without shared definitions', () => {
  const saved = normalizeDeviceState({scopeId:'space',scopes:{space:{view:'calendar',query:'x'.repeat(2100),listKind:'deck',showCompleted:true,showCompletedByView:{calendar:true},workflow:{evil:'done'}}}})
  assert.equal(saved.scopes.space.pages.calendar.query.length,2000)
  assert.equal(saved.scopes.space.view,'calendar'); assert.equal(saved.scopes.space.pages.calendar.showCompleted,true)
  assert.equal(saved.scopes.space.workflow,undefined); assert.equal(saved.scopePreferencesVersion,2)
  assert.deepEqual(normalizeDeviceState('corrupt'),{scopeId:'all',scopePreferencesVersion:2,scopes:{}})
  assert.equal(Object.keys(normalizeDeviceState(JSON.parse('{"scopeId":"constructor","scopes":{"__proto__":{}}}')).scopes).length,0)
})

test('cloud health follows all six priorities and success timestamps never excuse source errors', () => {
  const saved = state(), options = {now:126000,lastSuccessfulRefresh:1000}
  assert.equal(syncHealth(saved,options),'synced')
  assert.equal(syncHealth(saved,{...options,now:126001}),'stale')
  saved.storage.syncStatus='pending'; assert.equal(syncHealth(saved,options),'pending')
  saved.statuses[0].metadataStale=true; assert.equal(syncHealth(saved,options),'stale')
  saved.storage.syncStatus='conflict'; assert.equal(syncHealth(saved,options),'error')
  assert.equal(syncHealth(saved,{...options,syncing:true}),'syncing')
  assert.equal(syncHealth(saved,{...options,syncing:true,online:false}),'offline')
  assert.equal(syncHealth(state(),{now:1000,lastSuccessfulRefresh:null}),'stale')
  assert.equal(refreshDue(0,30000,'resume'),false); assert.equal(refreshDue(0,30001,'resume'),true)
  assert.equal(refreshDue(0,60000,'periodic'),true)
})

test('account barrier finishes already issued work and defers later work until selection commits', async () => {
  const gate=createOperationGate(), old=deferred(), changing=deferred(), events=[]
  const first=gate.run(async()=>{events.push('old');await old.promise;events.push('old saved')})
  const transition=gate.transition(async()=>{events.push('select');await changing.promise;events.push('selected')})
  const next=gate.run(()=>events.push('new'))
  await tick(); assert.deepEqual(events,['old'])
  old.resolve(); await tick(); assert.deepEqual(events,['old','old saved','select'])
  changing.resolve(); await Promise.all([first,transition,next])
  assert.deepEqual(events,['old','old saved','select','selected','new'])
})

test('authorized reference presentation keeps unsupported native mutations gated', () => {
  const entry=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8')
  assert.match(entry,/mountNextspace\(api/)
  assert.match(entry,/canMutateNative:\s*false/)
  assert.doesNotMatch(entry,/import AndroidApp|import SpaceEditor/)
  assert.match(entry,/nativeOperations:\s*\[\.\.\.NATIVE_OPERATIONS\]/)
  for(const operation of ['createTask','createCard','updateDescription','createEvent','respondToEvent'])assert.ok(NATIVE_OPERATIONS.includes(operation))
  for(const operation of ['setDeckDependency','moveCard','updateTaskStatus','updateRecordAppearance','createDeckLabel'])assert.ok(NATIVE_OPERATIONS.includes(operation))
})
