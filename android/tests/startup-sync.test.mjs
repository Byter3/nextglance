import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {createMobileController, cacheKey, launchKey, syncSettingsKey} from '../src/controller.mjs'
import {launchCheckpoint, checkedLaunchCheckpoint} from '../src/launch-cache.mjs'
import {publicSnapshot, SOURCES, compactSourceCache, checkedSourceCache} from '../src/foundation.mjs'
import {createSlotCache} from '../src/cache.mjs'
import {createMetadataStore} from '../src/metadata.mjs'
import {metadataKey} from '../src/account-cache-keys.mjs'

const A = {name: 'fixture', serverUrl: 'https://cloud.example.test', username: 'fixture'}
const clone = value => structuredClone(value)
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes}); return {promise, resolve}}
const tick = () => new Promise(resolve => setImmediate(resolve))
const flush = async () => {for (let i = 0; i < 8; i++) await tick()}
const start = Date.parse('2026-11-12T12:00:00Z')
test('widget launch carries newly denied source state before its temporary UI selection without a source sync',async t=>{
  const accountKey=cacheKey(A),config={version:1,widgetId:4,accountKey,generation:1,page:'list',scopeId:'all'}
  const f=fixture({widgets:{consumeAction:async()=>({config,action:{widgetId:4,accountKey,generation:1,action:'open'},readDenials:[{source:'tasks',code:'PERMISSION',collection:null}]})}})
  t.after(()=>f.api.dispose());await f.api.getState();await flush()
  const result=await f.api.takeWidgetAction()
  assert.equal(result.action.action,'open');assert.ok(result.state);assert.equal(result.state.records.some(row=>row.source==='tasks'),false)
  assert.equal((await f.api.getState()).records.some(row=>row.source==='tasks'),false)
  assert.equal(result.state.records.some(row=>row.source==='deck'),true)
  assert.equal(f.counts().authReads,0);assert.deepEqual(f.counts().nativeReads,[])
})
function fixture({sourceBlocked, authBlocked, saveBlocked, reconcileBlocked, reconcileRecords, makeMetadataStore, savedLaunch = true, settings, sourceRead, plannerBlocked, configureBlocked, deferRestore = tick, launchHints, cacheFactory, nativeClient = {}, networkStatus, widgets} = {}) {
  let time = start, selected = A, plannerReads = 0, authReads = 0, configured = 0, nativeReads = []
  let data = {
    records: SOURCES.map(source => ({id: source, source, kind: {tasks: 'task', calendar: 'event', deck: 'card', notes: 'note', collectives: 'page'}[source], title: `${source} saved`, collectionId: source, ...(source === 'tasks' ? {remote: {href: 'task.ics', raw: 'BEGIN:VCALENDAR\nEND:VCALENDAR'}} : {})})),
    collections: SOURCES.map(source => ({id: source, source, title: source})),
    statuses: SOURCES.map(source => ({source, state: 'connected', count: 1, lastSyncedAt: new Date(start).toISOString()})),
  }
  const base = {...createEmptyState(), ...data, revision: 0, deviceState: {scopeId: 'all'}, storage: {syncStatus: 'synced'}}
  const values = new Map([[cacheKey(A), {version: 1, accountKey: cacheKey(A), calendarHistoryDays:null, ...clone(data)}]])
  if (savedLaunch) values.set(launchKey(A), launchCheckpoint(publicSnapshot(base), cacheKey(A)))
  if (settings) values.set(syncSettingsKey(A), settings)
  const callbacks = new Map(); let timerId = 0
  const timers = {setTimeout: (callback, delay) => {callbacks.set(++timerId, {callback, delay}); return timerId}, clearTimeout: id => callbacks.delete(id)}
  const cache = cacheFactory?.(values) || {load: async key => {if (sourceBlocked && key === cacheKey(A)) await sourceBlocked.promise; return clone(values.get(key) ?? null)}, save: async (key, value) => {if (saveBlocked && key === cacheKey(A)) await saveBlocked.promise; values.set(key, clone(value))}, remove: async key => values.delete(key)}
  const native = {
    getSavedAccount: async () => ({account: selected}),
    getAccount: async () => {authReads++; if (authBlocked) await authBlocked.promise; return {account: selected, capabilities: {davReadMode: 'report', nativeEdits: 'notes-dates-scheduling'}}},
    configureSync: async () => {configured++; if (configureBlocked) await configureBlocked.promise; return {background: {supported: true, scheduled: true}}},
    selectAccount: async () => ({account: selected}), disconnect: async () => {selected = null},
  }
  const metadata = {workspace: base.workspace, revision: 0, metadata: {ready: true}, deviceState: {}, storage: {syncStatus: 'synced'}}
  const api = createMobileController({native, cache, timers, launchHints, networkStatus, widgets, deferRestoration: deferRestore, now: () => time,
    makeMetadataStore: makeMetadataStore || (() => ({load: async () => clone(metadata), getState: () => clone(metadata), sync: async () => {plannerReads++; if (plannerBlocked) await plannerBlocked.promise}, reconcileRecords: async records => {if (reconcileBlocked) await reconcileBlocked.promise; await reconcileRecords?.(records); return {...clone(metadata), records: clone(records), remap: new Map()}}, saveWorkspace: async () => assert.fail('No planner write expected')})),
    makeClient: () => ({...nativeClient, readAll: async input => {
      nativeReads.push(input.sources)
      if (sourceRead) return sourceRead(input)
      return {records: clone(data.records.filter(record => input.sources.includes(record.source))), collections: clone(data.collections.filter(collection => input.sources.includes(collection.source))), statuses: clone(data.statuses.filter(status => input.sources.includes(status.source)))}
    }}),
    openExternal: async () => {},
  })
  return {api, native, cache, values, callbacks, data, counts: () => ({plannerReads, authReads, configured, nativeReads}), advance: ms => {time += ms}, fire: delay => {const pair = [...callbacks].find(([, value]) => value.delay === delay); assert.ok(pair, `Missing timer ${delay}`); callbacks.delete(pair[0]); pair[1].callback()}}
}

test('launch checkpoint renders before full source hydration or authorization and cannot authorize writes', async t => {
  const sourceBlocked = deferred(), authBlocked = deferred(), f = fixture({sourceBlocked, authBlocked}); t.after(() => f.api.dispose())
  const state = await f.api.getState()
  assert.equal(state.records.length, 5); assert.equal(state.deviceSync.restoring, true)
  assert.deepEqual(state.nativeOperations, []); assert.ok(state.records.every(record => record.readonly))
  assert.equal(state.records[0].remote, undefined); assert.equal(state.connection.reconnectRequired, undefined)
  assert.equal(f.counts().authReads, 0)
  await assert.rejects(f.api.saveWorkspace(state.workspace, state.revision), {code: 'METADATA_NOT_READY'})
  await f.api.resumeSync('open'); await flush(); assert.equal(f.counts().authReads, 1, 'Authorization overlaps the pending source archive')
  assert.equal((await f.api.getState()).deviceSync.restoring, true)
  assert.deepEqual((await f.api.getState()).nativeWriteSources, [])
  sourceBlocked.resolve(); await flush(); assert.equal(f.counts().authReads, 1)
  assert.equal((await f.api.getState()).deviceSync.restoring, false)
  authBlocked.resolve(); await flush(); assert.equal(f.counts().plannerReads, 1)
})

test('cold saved launch and durable restore preserve historical status and counts without granting authority',async t=>{
  const sourceBlocked=deferred(),f=fixture({sourceBlocked});t.after(()=>{sourceBlocked.resolve();f.api.dispose()})
  f.values.get(launchKey(A)).state.statuses.forEach(status=>{status.count=999})
  f.values.get(cacheKey(A)).statuses.forEach(status=>{status.count=888})
  const launched=await f.api.getState()
  assert.ok(launched.statuses.every(status=>status.state==='connected'&&status.cached===true&&status.count===1&&status.lastSyncedAt===new Date(start).toISOString()))
  assert.equal(launched.connection.connected,false);assert.deepEqual(launched.nativeWriteSources,[]);assert.deepEqual(launched.nativeOperations,[])
  sourceBlocked.resolve();await flush();const restored=await f.api.getState()
  assert.deepEqual(restored.statuses,launched.statuses)
  assert.ok(restored.records.every(record=>record.readonly));assert.equal(restored.connection.connected,false)
  assert.deepEqual(restored.nativeWriteSources,[]);assert.deepEqual(restored.nativeOperations,[])
  await f.api.resumeSync('open');await flush()
  assert.deepEqual(f.counts().nativeReads,[],'Recent saved Notes and Collectives also avoid redundant content scans')
  assert.equal(f.counts().authReads,1);assert.equal(f.counts().plannerReads,1)
})

test('offline startup schedules saved job preferences before stalled archive restoration or authorization',async t=>{
  const sourceBlocked=deferred(),settings={caldavMinutes:0,deckMinutes:30,wifiOnly:true},f=fixture({sourceBlocked,settings,networkStatus:async()=>({connected:false,connectionType:'none'})})
  t.after(()=>{sourceBlocked.resolve();f.api.dispose()});const scheduled=[]
  f.native.configureSync=async input=>{scheduled.push(input);return {background:{supported:true,scheduled:true}}}
  await f.api.getState();await f.api.resumeSync('open');await flush()
  assert.deepEqual(scheduled,[{accountName:A.name,settings}])
  const current=await f.api.getState();assert.equal(current.deviceSync.restoring,true);assert.equal(current.deviceSync.background.scheduled,true)
  assert.equal(f.counts().authReads,0);assert.deepEqual(f.counts().nativeReads,[]);assert.equal(f.counts().plannerReads,0)
  assert.deepEqual(current.nativeWriteSources,[])
})

for (const policy of ['offline','wifi']) for (const minutes of [0,60]) test(`${policy} entry resumes access and planner checks without scanning ${minutes}-minute fresh sources`,async t=>{
  let network=policy==='offline'?{connected:false,connectionType:'none'}:{connected:true,connectionType:'cellular'},accesses=0
  const auth=deferred(),f=fixture({authBlocked:auth,settings:{caldavMinutes:minutes,deckMinutes:minutes,wifiOnly:policy==='wifi'},networkStatus:async()=>network,nativeClient:{
    readSourceAccess:async({onCollections})=>{accesses++;onCollections({sources:['tasks','calendar','deck'],collections:f.data.collections.filter(value=>['tasks','calendar','deck'].includes(value.source))});return {errors:[]}},
  }})
  t.after(()=>{auth.resolve();f.api.dispose()})
  await f.api.getState();await f.api.resumeSync('open');await flush()
  const saved=await f.api.getState()
  assert.equal(f.counts().authReads,0);assert.equal(f.counts().plannerReads,0);assert.equal(accesses,0)
  assert.deepEqual(saved.nativeWriteSources,[]);assert.deepEqual(saved.nativeOperations,[])
  assert.equal(saved.deviceSync.foregroundError,undefined);assert.equal(saved.deviceSync.background.error,undefined)
  network={connected:true,connectionType:'wifi'}
  await Promise.all([f.api.resumeSync('online'),f.api.resumeSync('online')]);await flush()
  assert.equal(f.counts().authReads,1);assert.deepEqual((await f.api.getState()).nativeWriteSources,[])
  auth.resolve();await flush()
  assert.equal(f.counts().plannerReads,1);assert.equal(accesses,1);assert.deepEqual(f.counts().nativeReads,[])
  assert.deepEqual((await f.api.getState()).nativeWriteSources,['tasks','calendar','deck'])
  await f.api.resumeSync('online');await f.api.resumeSync('timer');await flush()
  assert.equal(f.counts().authReads,1);assert.equal(f.counts().plannerReads,1);assert.equal(accesses,1)
})

test('online callbacks queued during a stale disconnected response trigger one foreground recovery',async t=>{
  const first=deferred();let checks=0,accesses=0
  const f=fixture({settings:{caldavMinutes:0,deckMinutes:0,wifiOnly:false},networkStatus:async()=>++checks===1?first.promise:{connected:true,connectionType:'wifi'},nativeClient:{readSourceAccess:async()=>{accesses++;return {errors:[]}}}})
  t.after(()=>{first.resolve({connected:false});f.api.dispose()})
  await f.api.getState();await f.api.resumeSync('open');await flush()
  await Promise.all([f.api.resumeSync('online'),f.api.resumeSync('online'),f.api.resumeSync('online')])
  assert.equal(checks,1);first.resolve({connected:false});await flush()
  assert.equal(checks,2);assert.equal(f.counts().authReads,1);assert.equal(f.counts().plannerReads,1);assert.equal(accesses,1)
  assert.deepEqual(f.counts().nativeReads,[])
})

for (const wifiOnly of [false,true]) test(`deferred entry honors the latest ${wifiOnly?'Wi-Fi-only':'unrestricted'} policy`,async t=>{
  let network={connected:false,connectionType:'none'},accesses=0
  const f=fixture({settings:{caldavMinutes:0,deckMinutes:0,wifiOnly:!wifiOnly},networkStatus:async()=>network,nativeClient:{readSourceAccess:async()=>{accesses++;return {errors:[]}}}})
  t.after(()=>f.api.dispose());await f.api.getState();await f.api.resumeSync('open');await flush()
  await f.api.setSyncSettings({caldavMinutes:0,deckMinutes:0,wifiOnly})
  network={connected:true,connectionType:'cellular'};await f.api.resumeSync('online');await flush()
  assert.equal(f.counts().authReads,wifiOnly?0:1);assert.equal(accesses,wifiOnly?0:1)
  if(wifiOnly){network={connected:true,connectionType:'wifi'};await f.api.resumeSync('online');await flush()}
  assert.equal(f.counts().authReads,1);assert.equal(f.counts().plannerReads,1);assert.equal(accesses,1);assert.deepEqual(f.counts().nativeReads,[])
})

test('foreground check error survives background status publication and clears after recovery',async t=>{
  const config=deferred();let fail=true
  const f=fixture({configureBlocked:config,settings:{caldavMinutes:0,deckMinutes:0,wifiOnly:false},networkStatus:async()=>{if(fail)throw Object.assign(new Error('Fixture check timeout'),{code:'TIMEOUT'});return {connected:true,connectionType:'wifi'}},nativeClient:{readSourceAccess:async()=>({errors:[]})}})
  t.after(()=>{config.resolve();f.api.dispose()})
  await f.api.getState();await f.api.resumeSync('open');await flush()
  assert.match((await f.api.getState()).deviceSync.foregroundError,/timed out/)
  config.resolve();await flush()
  const failed=await f.api.getState()
  assert.equal(failed.deviceSync.background.scheduled,true);assert.equal(failed.deviceSync.background.error,undefined)
  assert.match(failed.deviceSync.foregroundError,/timed out/)
  fail=false;await f.api.resumeSync('online');await flush()
  assert.equal((await f.api.getState()).deviceSync.foregroundError,undefined)
  assert.equal(f.counts().plannerReads,1);assert.deepEqual(f.counts().nativeReads,[])
})

test('successful manual authorization clears an earlier foreground check error',async t=>{
  const f=fixture({settings:{caldavMinutes:0,deckMinutes:0,wifiOnly:false},nativeClient:{readSourceAccess:async()=>({errors:[]})}})
  const getAccount=f.native.getAccount;let fail=true
  f.native.getAccount=async()=>{if(fail)throw Object.assign(new Error('Fixture provider timeout'),{code:'TIMEOUT'});return getAccount()}
  t.after(()=>f.api.dispose());await f.api.getState();await f.api.resumeSync('open');await flush()
  assert.match((await f.api.getState()).deviceSync.foregroundError,/authorization check timed out/)
  fail=false;await f.api.refresh()
  assert.equal((await f.api.getState()).deviceSync.foregroundError,undefined)
})

test('foreground exit clears a queued connectivity recovery until the next actual entry',async t=>{
  const first=deferred();let checks=0
  const f=fixture({settings:{caldavMinutes:0,deckMinutes:0,wifiOnly:false},networkStatus:async()=>++checks===1?first.promise:{connected:true,connectionType:'wifi'},nativeClient:{readSourceAccess:async()=>({errors:[]})}})
  t.after(()=>{first.resolve({connected:false});f.api.dispose()})
  await f.api.getState();await f.api.resumeSync('open');await flush();await f.api.resumeSync('online')
  await f.api.setAppActive(false);first.resolve({connected:false});await flush()
  await f.api.setAppActive(true);await f.api.resumeSync('online');await flush()
  assert.equal(f.counts().authReads,0);assert.equal(checks,1)
  await f.api.resumeSync('resume');await flush()
  assert.equal(checks,2);assert.equal(f.counts().authReads,1);assert.equal(f.counts().plannerReads,1)
})

for (const invalid of ['result','exception']) test(`invalid authorization ${invalid} clears queued entry recovery and requires reconnection`,async t=>{
  const auth=deferred();let connected=false,authReads=0
  const f=fixture({settings:{caldavMinutes:0,deckMinutes:0,wifiOnly:false},networkStatus:async()=>({connected,connectionType:'wifi'}),nativeClient:{readSourceAccess:async()=>assert.fail('Invalid authorization cannot verify source access')}})
  f.native.getAccount=async()=>{authReads++;await auth.promise;if(invalid==='exception')throw Object.assign(new Error('Fixture authorization expired'),{code:'RECONNECT_REQUIRED'});return {account:A,reconnectRequired:true}}
  t.after(()=>{auth.resolve();f.api.dispose()})
  await f.api.getState();await f.api.resumeSync('open');await flush();connected=true
  await f.api.resumeSync('online');await flush();await f.api.resumeSync('online');auth.resolve();await flush()
  const state=await f.api.getState();assert.equal(state.connection.reconnectRequired,true);assert.deepEqual(state.nativeWriteSources,[])
  await f.api.resumeSync('online');await flush()
  assert.equal(authReads,1);assert.equal(f.counts().plannerReads,0);assert.deepEqual(f.counts().nativeReads,[])
})

test('disconnect discards a deferred entry and its late network callback',async t=>{
  const first=deferred();const f=fixture({networkStatus:()=>first.promise,nativeClient:{readSourceAccess:async()=>({errors:[]})}})
  t.after(()=>{first.resolve({connected:false});f.api.dispose()})
  await f.api.getState();await f.api.resumeSync('open');await flush();await f.api.resumeSync('online')
  await f.api.disconnect();first.resolve({connected:false});await flush();await f.api.resumeSync('online');await flush()
  assert.equal(f.counts().authReads,0);assert.equal(f.counts().plannerReads,0);assert.equal((await f.api.getState()).connection.serverUrl,undefined)
})

test('fresh source reads replace cached provenance without advancing untouched sources',async t=>{
  const f=fixture();t.after(()=>f.api.dispose());await f.api.getState();await flush()
  const saved=await f.api.getState();assert.ok(saved.statuses.every(status=>status.cached===true))
  f.data.statuses=f.data.statuses.map(status=>({...status,cached:true}))
  const refreshed=await f.api.refresh()
  assert.ok(refreshed.statuses.every(status=>status.cached===undefined&&status.state==='connected'))
  assert.deepEqual(refreshed.statuses.map(status=>status.lastSyncedAt),saved.statuses.map(status=>status.lastSyncedAt))
})

for (const minutes of [0,15]) test(`independent access enables preflighted creation with fresh cached content and ${minutes}-minute automatic reads`,async t=>{
  const pendingOther=deferred();let accesses=0,attempts=0
  const f=fixture({settings:{caldavMinutes:minutes,deckMinutes:minutes,wifiOnly:false},sourceRead:async()=>pendingOther.promise,nativeClient:{
    readSourceAccess:async({onCollections})=>{accesses++;const collections=f.data.collections.filter(value=>['tasks','calendar','deck'].includes(value.source));onCollections({sources:['tasks','calendar','deck'],collections});return {collections,verifiedSources:['tasks','calendar','deck'],errors:[]}},
    createEvent:async()=>{attempts++;throw Object.assign(new Error('Fixture target preflight'),{code:'FIXTURE_PREFLIGHT'})},
  }})
  t.after(()=>{pendingOther.resolve({records:[],collections:[],statuses:[]});f.api.dispose()})
  await f.api.getState();await f.api.resumeSync('open');await flush()
  assert.equal(accesses,1)
  assert.deepEqual(f.counts().nativeReads,[],'Recent saved sources do not need a full scan solely to verify access')
  const state=await f.api.getState();assert.deepEqual(state.nativeWriteSources,['tasks','calendar','deck'])
  assert.equal(state.statuses.find(value=>value.source==='calendar').lastSyncedAt,new Date(start).toISOString())
  assert.equal(state.statuses.find(value=>value.source==='calendar').state,'connected')
  assert.equal(state.statuses.find(value=>value.source==='calendar').cached,true,'Permission discovery does not certify content freshness')
  await assert.rejects(f.api.createEvent({collectionId:'calendar',title:'Fixture block',start:'2026-11-12T13:00:00Z',end:'2026-11-12T14:00:00Z'}),{code:'FIXTURE_PREFLIGHT'})
  assert.equal(attempts,1)
})

test('warm offline resume adopts a guarded background generation without replacing workspace or navigation',async t=>{
  let changed,loads=0
  const f=fixture({networkStatus:async()=>({connected:false}),cacheFactory:values=>({
    load:async key=>clone(values.get(key)??null),save:async(key,value)=>values.set(key,clone(value)),remove:async key=>values.delete(key),
    loadChanged:async key=>{loads++;return changed?{changed:true,value:clone(changed)}:{changed:false}},
  })})
  t.after(()=>f.api.dispose());await f.api.getState();await flush()
  const previous=await f.api.getState()
  changed=clone(f.values.get(cacheKey(A)));changed.records.find(value=>value.source==='tasks').title='Background task update'
  changed.workspace={spaces:[{name:'Must never replace current workspace'}]};changed.deviceState={scopeId:'wrong'}
  await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  const current=await f.api.getState()
  assert.equal(current.records.find(value=>value.source==='tasks').title,'Background task update')
  assert.deepEqual(current.workspace,previous.workspace);assert.deepEqual(current.deviceState,previous.deviceState)
  assert.equal(loads,1);assert.equal(f.counts().authReads,0);assert.equal(f.counts().nativeReads.length,0)
  assert.deepEqual(current.nativeWriteSources,[],'Background cache grants no write authority')
  assert.ok(current.statuses.every(status=>status.state==='connected'&&status.cached===true))
  assert.equal(current.connection.connected,false,'Saved historical success does not certify an online session')
})

test('warm reconciliation failure leaves a background generation available until successful adoption confirms it',async t=>{
  let archive,confirmed=false,fail=false,offers=0,confirms=0
  const f=fixture({networkStatus:async()=>({connected:false}),reconcileRecords:async()=>{if(fail)throw new Error('Fixture reconciliation failure')},cacheFactory:values=>({
    load:async key=>clone(values.get(key)??null),save:async(key,value)=>values.set(key,clone(value)),remove:async key=>values.delete(key),
    loadChanged:async()=>{offers++;return confirmed?{changed:false}:{changed:true,value:clone(archive),confirm:()=>{confirmed=true;confirms++}}},
  })})
  t.after(()=>f.api.dispose());await f.api.getState();await flush()
  archive=clone(f.values.get(cacheKey(A)));archive.records[0].title='Published background update';fail=true
  await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  assert.equal((await f.api.getState()).records[0].title,'tasks saved');assert.equal(confirms,0)
  fail=false
  await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  assert.equal((await f.api.getState()).records[0].title,'Published background update');assert.equal(confirms,1)
  await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  assert.equal(offers,3);assert.equal(confirms,1);assert.deepEqual((await f.api.getState()).nativeWriteSources,[])
})

test('warm adoption timeout fences late reconciliation without consuming the available generation',async t=>{
  const pending=deferred();let archive,block=false,confirmed=false,confirms=0
  const f=fixture({networkStatus:async()=>({connected:false}),reconcileRecords:async()=>{if(block)await pending.promise},cacheFactory:values=>({
    load:async key=>clone(values.get(key)??null),save:async(key,value)=>values.set(key,clone(value)),remove:async key=>values.delete(key),
    loadChanged:async()=>confirmed?{changed:false}:{changed:true,value:clone(archive),confirm:()=>{confirmed=true;confirms++}},
  })})
  t.after(()=>{pending.resolve();f.api.dispose()});await f.api.getState();await flush()
  archive=clone(f.values.get(cacheKey(A)));archive.records[0].title='Available background update';block=true
  await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  f.fire(10_000);await flush();pending.resolve();await flush()
  assert.equal((await f.api.getState()).records[0].title,'tasks saved');assert.equal(confirms,0)
  block=false;await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  assert.equal((await f.api.getState()).records[0].title,'Available background update');assert.equal(confirms,1)
})

for(const reason of ['watermark','account','cancelled','corrupt']) test(`warm resume preserves current records when background generation is ${reason}`,async t=>{
  const blocked=deferred();let archive
  const f=fixture({networkStatus:async()=>({connected:false}),cacheFactory:values=>({
    load:async key=>clone(values.get(key)??null),save:async(key,value)=>values.set(key,clone(value)),remove:async key=>values.delete(key),
    loadChanged:async()=>{if(reason==='cancelled')await blocked.promise;return {changed:true,value:clone(archive)}},
  })})
  t.after(()=>{blocked.resolve();f.api.dispose()});await f.api.getState();await flush()
  archive=clone(f.values.get(cacheKey(A)));archive.records[0].title='Should not be adopted'
  if(reason==='watermark')archive.acknowledgedSequence=1
  if(reason==='corrupt')archive.version=99
  if(reason==='account')f.native.getSavedAccount=async()=>({account:{...A,username:'other'}})
  await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  if(reason==='cancelled'){await f.api.setAppActive(false);blocked.resolve();await flush()}
  assert.equal((await f.api.getState()).records[0].title,'tasks saved')
})

test('late account denial withdraws early access and fences simultaneous bulk discovery',async t=>{
  const access=deferred(),bulk=deferred();let discovery,read
  const f=fixture({settings:{caldavMinutes:0,deckMinutes:60,wifiOnly:false},sourceRead:async input=>{read=input;return bulk.promise},nativeClient:{readSourceAccess:async input=>{discovery=input;input.onCollections({sources:['calendar'],collections:[{id:'calendar',source:'calendar',title:'Calendar'}]});return access.promise}}})
  t.after(()=>{access.resolve({errors:[]});bulk.resolve({records:[],collections:[],statuses:[]});f.api.dispose()})
  f.advance(61*60_000)
  await f.api.getState();await f.api.resumeSync('open');await flush()
  assert.deepEqual((await f.api.getState()).nativeWriteSources,['calendar'])
  access.resolve({collections:[],verifiedSources:[],errors:[{source:'calendar',code:'AUTH',message:'Authorization denied'}]});await flush()
  const late={sources:['calendar'],collections:[{id:'calendar',source:'calendar',title:'Late calendar'}]}
  discovery.onCollections(late);read.onCollections(late);await flush()
  const current=await f.api.getState();assert.deepEqual(current.nativeWriteSources,[]);assert.deepEqual(current.nativeOperations,[])
  assert.equal(current.connection.reconnectRequired,true)
})

test('bulk denial prevents an older independent-access callback recertifying that scope',async t=>{
  const access=deferred(),bulk=deferred();let discovery,read
  const f=fixture({settings:{caldavMinutes:0,deckMinutes:60,wifiOnly:false},sourceRead:async input=>{read=input;return bulk.promise},nativeClient:{readSourceAccess:async input=>{discovery=input;return access.promise}}})
  t.after(()=>{access.resolve({errors:[]});bulk.resolve({records:[],collections:[],statuses:[]});f.api.dispose()})
  f.advance(61*60_000)
  await f.api.getState();await f.api.resumeSync('open');await flush()
  read.onSource({records:[],collections:[],statuses:[{source:'notes',state:'error',permissionDenied:true,errorCode:'PERMISSION',count:0}]})
  discovery.onCollections({sources:['calendar'],collections:[{id:'calendar',source:'calendar',title:'Obsolete calendar discovery'}]})
  assert.deepEqual((await f.api.getState()).nativeWriteSources,[])
})

test('warm denial is visible even when changed background archive cannot be read',async t=>{
  const f=fixture({networkStatus:async()=>({connected:false}),cacheFactory:values=>({load:async key=>clone(values.get(key)??null),save:async(key,value)=>values.set(key,clone(value)),remove:async key=>values.delete(key),loadChanged:async()=>{throw new Error('Unreadable archive')}})})
  t.after(()=>f.api.dispose());await f.api.getState();await flush()
  f.native.getSavedAccount=async()=>({account:A,readDenials:[{source:'deck',code:'PERMISSION',collection:null}]})
  await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  const current=await f.api.getState();assert.equal(current.records.some(record=>record.source==='deck'),false)
  assert.equal(current.statuses.find(status=>status.source==='deck').permissionDenied,true)
})

test('unreadable warm denial evidence withdraws previous access while preserving cached data',async t=>{
  const f=fixture({networkStatus:async()=>({connected:false}),cacheFactory:values=>({load:async key=>clone(values.get(key)??null),save:async(key,value)=>values.set(key,clone(value)),remove:async key=>values.delete(key),loadChanged:async()=>({changed:false})})})
  t.after(()=>f.api.dispose());await f.api.refresh()
  assert.ok((await f.api.getState()).nativeWriteSources.length)
  f.native.getSavedAccount=async()=>({account:A,readDenials:[{source:'unknown',code:'PERMISSION',collection:null}]})
  await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  const current=await f.api.getState();assert.deepEqual(current.nativeWriteSources,[]);assert.equal(current.records.length,5)
  assert.equal(current.storage.errorCode,'CACHE_UNREADABLE')
})

test('a foreground refresh wins over a slow background generation adoption',async t=>{
  const block=deferred();let archive
  const f=fixture({networkStatus:async()=>({connected:false}),cacheFactory:values=>({load:async key=>clone(values.get(key)??null),save:async(key,value)=>values.set(key,clone(value)),remove:async key=>values.delete(key),loadChanged:async()=>{await block.promise;return {changed:true,value:archive}}})})
  t.after(()=>{block.resolve();f.api.dispose()});await f.api.getState();await flush()
  archive=clone(f.values.get(cacheKey(A)));archive.records[0].title='Older background copy'
  await f.api.setAppActive(false);await f.api.setAppActive(true);await f.api.resumeSync('resume');await flush()
  f.data.records[0].title='New foreground copy';await f.api.refresh()
  block.resolve();await flush()
  assert.equal((await f.api.getState()).records[0].title,'New foreground copy')
})

test('foreground authorization still respects restored Wi-Fi-only policy while the large archive loads', async t => {
  const sourceBlocked = deferred(), f = fixture({sourceBlocked, settings:{wifiOnly:true},networkStatus:async()=>({connected:true,connectionType:'cellular'})})
  t.after(() => {sourceBlocked.resolve();f.api.dispose()})
  await f.api.getState();await f.api.resumeSync('open');await flush()
  assert.equal(f.counts().authReads,0)
  assert.equal((await f.api.getState()).deviceSync.restoring,true)
})

test('persisted background denial fences launch and archive until a fresh source read verifies access', async t => {
  const blocked=deferred(),f=fixture({sourceBlocked:blocked});t.after(()=>{blocked.resolve();f.api.dispose()})
  f.native.getSavedAccount=async()=>({account:A,readDenials:[{source:'deck',code:'PERMISSION',collection:null}]})
  const confirmed=[];f.native.confirmSourceReads=async value=>confirmed.push(value)
  assert.equal((await f.api.getState()).records.some(record=>record.source==='deck'),false)
  blocked.resolve();await flush()
  const restored=await f.api.getState()
  assert.equal(restored.records.some(record=>record.source==='deck'),false)
  assert.equal(restored.statuses.find(status=>status.source==='deck').permissionDenied,true)
  assert.equal(f.values.get(cacheKey(A)).records.some(record=>record.source==='deck'),true,'private archive is retained until fresh read')
  await f.api.refresh()
  assert.equal((await f.api.getState()).records.some(record=>record.source==='deck'),true)
  assert.ok(confirmed.some(value=>value.sources.includes('deck')))
})

test('a fresh read cannot clear a durable denial when archive persistence fails',async t=>{
  let confirmed=0
  const f=fixture({cacheFactory:values=>({load:async key=>clone(values.get(key)??null),save:async(key,value)=>{if(key===cacheKey(A))throw Object.assign(new Error('Disk unavailable'),{code:'CACHE_WRITE'});values.set(key,clone(value))},remove:async key=>values.delete(key)})})
  t.after(()=>f.api.dispose());f.native.getSavedAccount=async()=>({account:A,readDenials:[{source:'deck',code:'PERMISSION',collection:null}]})
  f.native.confirmSourceReads=async()=>{confirmed++}
  await f.api.getState();await flush();f.data.records.find(record=>record.source==='deck').title='Fresh confirmed value'
  await f.api.refresh();assert.equal(confirmed,0,'Denial must remain until a fresh archive is durable')
  assert.match((await f.api.getState()).storage.message,/offline cache could not be saved/)
})

test('fresh collection discovery permits an independently preflighted edit before bulk source projection completes', async t => {
  const bulk = deferred(), mutation = Object.assign(new Error('Reached the native target preflight'),{code:'FIXTURE_PREFLIGHT'})
  let read, attempted=0
  const f=fixture({sourceRead:async input=>{read=input;return bulk.promise},nativeClient:{createEvent:async()=>{attempted++;throw mutation}}})
  t.after(()=>{bulk.resolve({records:[],collections:[],statuses:[]});f.api.dispose()})
  await f.api.getState();await flush();const refreshing=f.api.refresh();await flush()
  const input={collectionId:'calendar',title:'Fixture block',start:'2026-11-12T13:00:00Z',end:'2026-11-12T14:00:00Z'}
  await assert.rejects(f.api.createEvent(input),{code:'UNAVAILABLE'})
  read.onCollections({sources:['tasks','calendar'],collections:[{id:'tasks',source:'tasks',title:'Tasks'},{id:'calendar',source:'calendar',title:'Calendar'}]})
  const ready=await f.api.getState()
  assert.equal(ready.connection.connected,true)
  assert.deepEqual(ready.nativeWriteSources,['tasks','calendar'])
  assert.equal(ready.statuses.find(status=>status.source==='calendar').cached,true)
  assert.equal(ready.statuses.find(status=>status.source==='calendar').lastSyncedAt,new Date(start).toISOString())
  assert.equal(Boolean(ready.records.find(record=>record.id==='calendar').readonly),false)
  await assert.rejects(f.api.createEvent(input),{code:'FIXTURE_PREFLIGHT'});assert.equal(attempted,1)
  f.fire(120_000);await refreshing
  const stale=await f.api.getState()
  assert.equal(stale.statuses.find(status=>status.source==='calendar').errorCode,'TIMEOUT')
  assert.equal(stale.connection.connected,true)
  await assert.rejects(f.api.createEvent(input),{code:'FIXTURE_PREFLIGHT'});assert.equal(attempted,2)
  const launch=launchCheckpoint(stale,cacheKey(A));assert.equal(launch.state.nativeWriteSources,undefined)
})

test('discovery cannot broaden structural readonly, grant missing collections or survive revocation/cancellation',async t=>{
  const bulk=deferred();let read
  const f=fixture({sourceRead:async input=>{read=input;return bulk.promise}})
  t.after(()=>{bulk.resolve({records:[],collections:[],statuses:[]});f.api.dispose()})
  f.values.get(cacheKey(A)).records.find(record=>record.source==='tasks').readonly=true
  await f.api.getState();await flush();const refreshing=f.api.refresh();await flush()
  read.onCollections({sources:['tasks','calendar'],collections:[{id:'tasks',source:'tasks',title:'Tasks'},{id:'calendar',source:'calendar',title:'Calendar',readonly:true}]})
  let state=await f.api.getState();assert.ok(state.records.find(record=>record.id==='tasks').readonly);assert.ok(state.records.find(record=>record.id==='calendar').readonly)
  await assert.rejects(f.api.createEvent({collectionId:'calendar',title:'Denied'}),{code:'PERMISSION'})
  read.onCollections({sources:['calendar'],collections:[]})
  state=await f.api.getState();assert.deepEqual(state.nativeWriteSources,['tasks']);assert.ok(!state.collections.some(collection=>collection.source==='calendar'))
  read.onSource({records:[],collections:[],statuses:[{source:'tasks',state:'error',count:0,permissionDenied:true}]})
  assert.deepEqual((await f.api.getState()).nativeWriteSources,[])
  await f.api.setAppActive(false);await refreshing
  read.onCollections({sources:['calendar'],collections:[{id:'calendar',source:'calendar',title:'Late calendar'}]})
  assert.deepEqual((await f.api.getState()).nativeWriteSources,[])
})

test('renewed board discovery enables the verified board before card scanning and drops stale revocation flags',async t=>{
  const bulk=deferred();let read
  const f=fixture({sourceRead:async input=>{read=input;return bulk.promise}})
  t.after(()=>{bulk.resolve({records:[],collections:[],statuses:[]});f.api.dispose()})
  const saved=f.values.get(cacheKey(A));saved.collections.find(collection=>collection.source==='deck').stacks=[{id:3,title:'Doing'}]
  await f.api.getState();await flush();const refreshing=f.api.refresh();await flush()
  read.onSource({records:[],collections:[],statuses:[{source:'deck',state:'error',permissionDenied:true,errorCode:'PERMISSION',count:0}]})
  assert.deepEqual((await f.api.getState()).nativeWriteSources,[])
  read.onCollections({sources:['deck'],collections:[{id:'deck',source:'deck',title:'Fresh board',readonly:false}]})
  let state=await f.api.getState()
  assert.deepEqual(state.nativeWriteSources,['deck']);assert.equal(state.connection.connected,true)
  assert.equal(state.statuses.find(status=>status.source==='deck').permissionDenied,undefined)
  assert.equal(state.statuses.find(status=>status.source==='deck').state,'unavailable')
  assert.equal(state.collections.find(collection=>collection.id==='deck').stacks,undefined,'A revoked board cannot retain its old stack choices')
  await f.api.setAppActive(false);await refreshing
})

test('fresh board metadata preserves known stack choices only for the same still-present board',async t=>{
  const bulk=deferred();let read
  const f=fixture({sourceRead:async input=>{read=input;return bulk.promise}})
  t.after(()=>{bulk.resolve({records:[],collections:[],statuses:[]});f.api.dispose()})
  f.values.get(cacheKey(A)).collections.find(collection=>collection.source==='deck').stacks=[{id:3,title:'Doing'}]
  await f.api.getState();await flush();const refreshing=f.api.refresh();await flush()
  read.onCollections({sources:['deck'],collections:[{id:'deck',source:'deck',title:'Fresh board',readonly:false},{id:'new-board',source:'deck',title:'New board',readonly:false}]})
  const state=await f.api.getState()
  assert.deepEqual(state.collections.find(collection=>collection.id==='deck').stacks,[{id:3,title:'Doing'}])
  assert.equal(state.collections.find(collection=>collection.id==='new-board').stacks,undefined)
  await f.api.setAppActive(false);await refreshing
})

test('server-confirmed target permission loss protects its DAV representations without blocking unrelated calendars',async t=>{
  const bulk=deferred();let read, evidence
  const f=fixture({sourceRead:async input=>{read=input;return bulk.promise},nativeClient:{createEvent:async()=>{throw Object.assign(new Error('Cannot edit this destination'),{code:'PERMISSION',...(evidence?{nativePermissionDenied:evidence}:{})})}}})
  t.after(()=>{bulk.resolve({records:[],collections:[],statuses:[]});f.api.dispose()})
  await f.api.getState();await flush();const refreshing=f.api.refresh();await flush()
  const collections=[{id:'tasks',source:'tasks',title:'Tasks',remote:{href:'https://cloud.example.test/remote.php/dav/calendars/user/shared/'}},{id:'calendar',source:'calendar',title:'Calendar',remote:{href:'https://cloud.example.test/remote.php/dav/calendars/user/shared/'}},{id:'other',source:'calendar',title:'Other calendar',remote:{href:'https://cloud.example.test/remote.php/dav/calendars/user/other/'}}]
  read.onCollections({sources:['tasks','calendar'],collections})
  const input={collectionId:'calendar',title:'Fixture block',start:'2026-11-12T13:00:00Z',end:'2026-11-12T14:00:00Z'}
  await assert.rejects(f.api.createEvent(input),{code:'PERMISSION'})
  let state=await f.api.getState()
  assert.deepEqual(state.nativeWriteSources,['tasks','calendar'],'Structural/untagged PERMISSION does not revoke the source')
  evidence={source:'calendar',collectionId:'calendar'}
  await assert.rejects(f.api.createEvent(input),{code:'PERMISSION'})
  state=await f.api.getState()
  assert.deepEqual(state.nativeWriteSources,['calendar'])
  assert.ok(state.collections.find(collection=>collection.id==='calendar').readonly)
  assert.ok(state.collections.find(collection=>collection.id==='tasks').readonly)
  assert.equal(Boolean(state.collections.find(collection=>collection.id==='other').readonly),false)
  assert.equal(state.statuses.find(status=>status.source==='calendar').permissionDenied,undefined)
  assert.equal(state.records.length,5,'Loss of write access does not purge readable cached work')
  evidence={source:'calendar',collectionId:'other'}
  await assert.rejects(f.api.createEvent({...input,collectionId:'other'}),{code:'PERMISSION'})
  assert.deepEqual((await f.api.getState()).nativeWriteSources,[])
  read.onCollections({sources:['tasks','calendar'],collections})
  read.onSource({records:[],collections,statuses:[{source:'tasks',state:'connected',count:0},{source:'calendar',state:'connected',count:0}]})
  assert.deepEqual((await f.api.getState()).nativeWriteSources,[],'A superseded inventory cannot recertify denied permissions')
  assert.ok((await f.api.getState()).collections.find(collection=>collection.id==='calendar').readonly)
  await refreshing
  const retrying=f.api.refresh();await flush()
  read.onCollections({sources:['tasks','calendar'],collections})
  state=await f.api.getState();assert.deepEqual(state.nativeWriteSources,['tasks','calendar']);assert.equal(Boolean(state.collections.find(collection=>collection.id==='calendar').readonly),false)
  await f.api.setAppActive(false);await retrying
})

test('corrupt or wrong-account launch cache falls back to durable source data without resetting it', async t => {
  const f = fixture(); t.after(() => f.api.dispose())
  f.values.set(launchKey(A), {version: 1, accountKey: 'wrong', state: {records: [{title: 'not real'}]}})
  const shell = await f.api.getState(); assert.equal(shell.deviceSync.restoring, true)
  await flush(); const state = await f.api.getState()
  assert.equal(state.deviceSync.restoring, false); assert.equal(state.records[0].title, 'tasks saved')
  assert.equal(f.counts().authReads, 0); assert.ok(f.values.has(cacheKey(A)))
  assert.throws(() => checkedLaunchCheckpoint({...launchCheckpoint(state, cacheKey(A)), accountKey: 'wrong'}, cacheKey(A)), {code: 'CACHE_FORMAT'})
  const forged = launchCheckpoint(state, cacheKey(A)); forged.state.connection = {connected: true, serverUrl: 'https://other.example'}
  assert.throws(() => checkedLaunchCheckpoint(forged, cacheKey(A)), {code: 'CACHE_FORMAT'})
})

test('launch checkpoint retains page preferences and marker without granting source permissions',()=>{
  const original={...createEmptyState(),deviceState:{scopeId:'all',scopePreferencesVersion:2,scopes:{all:{view:'board',pages:{board:{query:'board-filter',showCompleted:true},calendar:{query:'calendar-filter',showCompleted:false}}}}}}
  const restored=checkedLaunchCheckpoint(launchCheckpoint(original,cacheKey(A)),cacheKey(A))
  assert.equal(restored.state.deviceState.scopePreferencesVersion,2)
  assert.equal(restored.state.deviceState.scopes.all.pages.board.query,'board-filter')
  assert.equal(restored.state.deviceState.scopes.all.pages.calendar.query,'calendar-filter')
  assert.equal(restored.state.deviceState.scopes.all.pages.calendar.showCompleted,false)
  assert.equal(restored.state.connection,undefined)
})

test('native source refresh never pulls planner metadata as an implicit trailing step', async t => {
  const f = fixture({savedLaunch: false}); t.after(() => f.api.dispose())
  await f.api.refresh(); await f.api.refresh()
  assert.equal(f.counts().plannerReads, 0)
  assert.equal(f.counts().nativeReads.length, 2)
  assert.ok(f.values.has(launchKey(A)), 'A successful save makes the next launch cheap')
})

test('freshness saved in compact launch survives private restoration after an unchanged archive skip',async t=>{
  const f=fixture();t.after(()=>f.api.dispose());await f.api.refresh()
  const before=clone(f.values.get(cacheKey(A))), latest=new Date(start+60_000).toISOString()
  f.advance(60_000);f.data.statuses=f.data.statuses.map(status=>({...status,lastSyncedAt:latest}));await f.api.refresh()
  assert.deepEqual(f.values.get(cacheKey(A)),before,'No unchanged source archive rewrite')
  assert.equal(f.values.get(launchKey(A)).state.statuses[0].lastSyncedAt,latest)
  const restarted=fixture({cacheFactory:()=>f.cache});t.after(()=>restarted.api.dispose())
  assert.equal((await restarted.api.getState()).statuses[0].lastSyncedAt,latest);await flush()
  const restored=await restarted.api.getState();assert.ok(restored.statuses.every(status=>status.lastSyncedAt===latest&&status.state==='connected'&&status.cached===true))
  assert.deepEqual(restored.nativeOperations,[]);assert.ok(restored.records.every(record=>record.readonly))
})

test('source deadline preserves independently completed Notes and Deck while unfinished Calendar stays stale',async t=>{
  let captured;const blocked=deferred();const f=fixture({savedLaunch:false,sourceRead:async input=>{captured=input;input.onSource({records:[{id:'new-note',source:'notes',kind:'note',title:'Fixture note',collectionId:'notes'}],collections:[{id:'notes',source:'notes',title:'Notes'}],statuses:[{source:'notes',state:'connected',count:1,lastSyncedAt:'2026-11-12T12:00:00Z'}]});input.onSource({records:[{id:'new-card',source:'deck',kind:'card',title:'Fixture card',collectionId:'deck'}],collections:[{id:'deck',source:'deck',title:'Deck'}],statuses:[{source:'deck',state:'connected',count:1,lastSyncedAt:'2026-11-12T12:00:00Z'}]});return blocked.promise}});t.after(()=>f.api.dispose())
  await f.api.getState();await flush();const pending=f.api.refresh();await flush();f.fire(120000);await pending
  const current=await f.api.getState();assert.equal(current.statuses.find(value=>value.source==='notes').state,'connected');assert.equal(current.statuses.find(value=>value.source==='deck').state,'connected');assert.equal(current.statuses.find(value=>value.source==='calendar').errorCode,'TIMEOUT');assert.ok(current.records.some(value=>value.id==='new-note'));assert.ok(current.records.some(value=>value.id==='new-card'))
  captured.onSource({records:[],collections:[],statuses:[{source:'notes',state:'connected',count:0}]});assert.ok((await f.api.getState()).records.some(value=>value.id==='new-note'),'late result cannot overwrite the completed source')
  blocked.resolve({records:[],collections:[],statuses:[]});await flush()
})

for (const source of ['notes', 'deck']) for (const scope of ['source', 'collection']) for (const ending of ['timeout', 'background']) test(`partial ${source} ${scope} revocation purges both saved generations despite ${ending}`, async t => {
  const blockedRead = deferred(), blockedRemoval = deferred(), files = new Map()
  let captured, removals = 0
  const storage = {
    size: async path => files.has(path) ? Buffer.byteLength(files.get(path)) : null,
    read: async path => files.get(path) ?? null,
    write: async (path, text) => { files.set(path, text) },
    remove: async path => { removals++; await blockedRemoval.promise; files.delete(path) },
  }
  const f = fixture({cacheFactory: values => {
    for (const [key, value] of values) for (const slot of [0, 1]) files.set(`cache/${key}.${slot}.json`, JSON.stringify({version: 1, generation: slot + 1, value}))
    return createSlotCache(storage)
  }, sourceRead: async input => {
    captured = input
    input.onSource({records: [], collections: [], statuses: [{source, state: 'error', count: 0, ...(scope === 'source' ? {permissionDenied: true} : {revokedCollectionIds: [source]})}]})
    return blockedRead.promise
  }})
  t.after(() => { blockedRemoval.resolve(); blockedRead.resolve({records: [], collections: [], statuses: []}); f.api.dispose() })
  await f.api.getState(); await flush()
  const refreshing = f.api.refresh(); await flush()
  assert.ok(removals > 0, 'Revocation starts invalidation before unrelated source completion')
  assert.ok(!(await f.api.getState()).records.some(record => record.source === source))
  if (ending === 'timeout') f.fire(120_000)
  else await f.api.setAppActive(false)
  await refreshing
  blockedRemoval.resolve(); await flush()
  // A late canceled source cannot restore the revoked rows, in memory or on disk.
  captured.onSource({records: [clone(f.data.records.find(record => record.source === source))], collections: [], statuses: [{source, state: 'connected', count: 1}]})
  blockedRead.resolve({records: [], collections: [], statuses: []}); await flush()
  for (const key of [cacheKey(A), launchKey(A)]) {
    const slots = [0, 1].map(slot => ({path: `cache/${key}.${slot}.json`, text: files.get(`cache/${key}.${slot}.json`)})).filter(slot => slot.text)
    assert.ok(slots.length > 0, 'Unrelated cached source data remains available after cleanup')
    for (const slot of slots) {
      const value = JSON.parse(slot.text).value
      const records = key === launchKey(A) ? value?.state?.records : value?.records
      assert.ok(!records?.some(record => record.source === source), 'Neither generation may contain revoked data')
    }
    slots.sort((a, b) => JSON.parse(b.text).generation - JSON.parse(a.text).generation)
    files.set(slots[0].path, '{interrupted')
    let recovered
    try { recovered = await createSlotCache(storage).load(key) } catch (error) { assert.equal(error.code, 'CACHE_UNREADABLE') }
    assert.ok(!(recovered?.records || recovered?.state?.records || []).some(record => record.source === source), 'Corrupting the newest slot cannot resurrect a revoked backup')
  }
})

test('diagnostics is opt-in, strips raw callback data, stops in background and clears with account',async t=>{
  const f=fixture({savedLaunch:false});t.after(()=>f.api.dispose());await f.api.getState();await flush()
  assert.equal(f.api.getDiagnostics().recording,false);f.api.startDiagnostics();f.api.recordDiagnostic({kind:'ui',stage:'panel',title:'private-note',durationMs:3});await f.api.refresh()
  assert.ok(f.api.getDiagnostics().eventCount>1);assert.ok(!f.api.readDiagnostics().includes('private-note'));await f.api.setAppActive(false);assert.equal(f.api.getDiagnostics().stopReason,'background')
  await f.api.disconnect();assert.equal(f.api.getDiagnostics().eventCount,0);assert.equal(f.api.getDiagnostics().recording,false)
})

test('unexpected native cancellation records a terminal event without certifying a complete refresh', async t => {
  const f = fixture({savedLaunch: false, sourceRead: async input => {
    input.onSource({records: [], collections: [], statuses: [{source: 'notes', state: 'connected', count: 0}]})
    throw Object.assign(new Error('Private provider details'), {code: 'CANCELLED'})
  }})
  t.after(() => f.api.dispose()); await f.api.getState(); f.api.startDiagnostics()
  const state = await f.api.refresh(), report = JSON.parse(f.api.readDiagnostics())
  assert.deepEqual(report.events.filter(event => event.kind === 'source' && event.stage === 'error').map(({code, completed, total, success}) => ({code, completed, total, success})), [{code: 'CANCELLED', completed: 1, total: 5, success: false}])
  assert.equal(report.events.some(event => event.kind === 'source' && event.stage === 'finish'), false)
  assert.equal(f.api.readDiagnostics().includes('Private provider details'), false)
  assert.equal(state.statuses.find(status => status.source === 'notes').state, 'connected')
  assert.equal(state.deviceSync.activity, undefined)
})

test('open/resume signals coalesce planner pulls and due refresh retains all unselected source data', async t => {
  const f = fixture({savedLaunch: false, settings: {caldavMinutes: 15, deckMinutes: 0, wifiOnly: false}}); t.after(() => f.api.dispose())
  f.data.statuses.filter(status => ['tasks', 'calendar'].includes(status.source)).forEach(status => {status.lastSyncedAt = '2026-11-12T10:00:00Z'})
  f.values.get(cacheKey(A)).statuses = clone(f.data.statuses)
  await f.api.getState(); await flush(); const before = await f.api.getState()
  await Promise.all([f.api.resumeSync('open'), f.api.resumeSync('resume'), f.api.resumeSync('online')]); await flush()
  assert.equal(f.counts().plannerReads, 1)
  assert.deepEqual(f.counts().nativeReads, [['tasks', 'calendar']])
  const after = await f.api.getState()
  assert.deepEqual(after.records.filter(record => record.source === 'deck'), before.records.filter(record => record.source === 'deck'))
  assert.deepEqual(after.statuses.find(status => status.source === 'deck'), before.statuses.find(status => status.source === 'deck'))
  await f.api.resumeSync('timer'); await flush(); assert.equal(f.counts().plannerReads, 1)
  f.advance(31_000); await f.api.resumeSync('resume'); await flush(); assert.equal(f.counts().plannerReads, 2)
})

test('due content owns its discovery and a pending lightweight check coalesces repeated focus', async t => {
  const permission = deferred(), checked = []
  const settings = {caldavMinutes: 15, deckMinutes: 0, wifiOnly: false}
  const f = fixture({savedLaunch: false, settings, nativeClient: {readSourceAccess: async input => {checked.push(input.sources); return permission.promise}}})
  t.after(() => {permission.resolve({errors: []}); f.api.dispose()})
  const saved = f.values.get(cacheKey(A))
  for (const status of saved.statuses.filter(status => ['tasks', 'calendar'].includes(status.source))) status.lastSyncedAt = new Date(start - 20 * 60_000).toISOString()
  await f.api.getState(); await flush()
  await f.api.resumeSync('open'); await flush()
  assert.deepEqual(f.counts().nativeReads, [['tasks', 'calendar']])
  assert.deepEqual(checked, [['deck']], 'manual-only Deck still gets a fresh permission check')
  f.advance(31_000)
  await Promise.all([f.api.resumeSync('resume'), f.api.resumeSync('online')]); await flush()
  assert.deepEqual(checked, [['deck']], 'no second check while entry permission work is pending')
  assert.equal(f.counts().plannerReads, 1)
})

test('Calendar history catch-up still verifies Tasks access without refreshing its content', async t => {
  const checked = []
  const settings = {caldavMinutes: 60, deckMinutes: 0, wifiOnly: false, calendarHistoryDays: 90}
  const f = fixture({settings, nativeClient: {readSourceAccess: async input => {checked.push(input.sources); return {errors: []}}}})
  t.after(() => f.api.dispose())
  await f.api.getState(); await flush(); await f.api.resumeSync('open'); await flush()
  assert.deepEqual(f.counts().nativeReads, [['calendar']])
  assert.deepEqual(checked, [['tasks', 'deck']])
})

test('leaving before the planner debounce retains the edit and uploads once on return', async t => {
  let uploads = 0, meta = {workspace: createEmptyState().workspace, revision: 0, metadata: {ready: true}, deviceState: {}, storage: {syncStatus: 'synced'}}
  const f = fixture({makeMetadataStore: () => ({
    load: async () => clone(meta), getState: () => clone(meta),
    saveWorkspace: async workspace => {meta.workspace = clone(workspace); meta.revision++; meta.storage.syncStatus = 'pending'},
    sync: async () => {uploads++; meta.storage.syncStatus = 'synced'},
    reconcileRecords: async records => ({...clone(meta), records: clone(records), remap: new Map()}),
  })})
  t.after(() => f.api.dispose())
  await f.api.getState(); await flush()
  const before = await f.api.getState()
  const saved = await f.api.saveWorkspace({...before.workspace, name: 'Local edit'}, before.revision)
  assert.equal(saved.storage.syncStatus, 'pending')
  const scheduled = [...f.callbacks.values()].find(timer => timer.delay === 1_200)
  assert.ok(scheduled)
  await f.api.setAppActive(false)
  assert.ok(![...f.callbacks.values()].some(timer => timer.delay === 1_200))
  scheduled.callback(); await flush()
  assert.equal(uploads, 0); assert.equal((await f.api.getState()).storage.syncStatus, 'pending')
  await f.api.setAppActive(true); await f.api.resumeSync('resume'); await flush()
  assert.equal(uploads, 1); assert.equal((await f.api.getState()).workspace.name, 'Local edit')
  assert.equal((await f.api.getState()).storage.syncStatus, 'synced')
})

test('source progress uses lightweight subscribers, throttles updates and deadline clears activity', async t => {
  const pending = deferred(); let input
  const f = fixture({savedLaunch: false, sourceRead: async args => {input = args; return pending.promise}}); t.after(() => f.api.dispose())
  await f.api.getState(); await flush(); let full = 0, progress = 0
  f.api.subscribe(() => full++); f.api.subscribeSync(() => progress++)
  const reading = f.api.refresh(); await flush()
  const baseline = progress
  for (let i = 0; i < 200; i++) input.onProgress({stage: 'source-read', completed: i, total: 200})
  assert.ok(progress - baseline <= 1); assert.equal(full, 0)
  f.fire(120_000); const state = await reading
  assert.equal(state.deviceSync.activity, undefined)
  assert.ok(state.statuses.every(status => status.errorCode === 'TIMEOUT'))
  assert.equal(state.records.length, 5)
  pending.resolve({records: [], collections: [], statuses: []}); await flush()
  assert.equal((await f.api.getState()).records.length, 5, 'Late timed-out content cannot erase the cache')
})

test('backgrounding cancels an active pass without a false warning or a stuck progress flag', async t => {
  const pending = deferred(), f = fixture({savedLaunch: false, sourceRead: () => pending.promise}); t.after(() => f.api.dispose())
  await f.api.getState(); await flush(); const before = await f.api.getState(), reading = f.api.refresh(); await flush()
  await f.api.setAppActive(false); const state = await reading
  assert.deepEqual(state.statuses, before.statuses); assert.equal(state.deviceSync.activity, undefined)
  pending.resolve({records: [], collections: [], statuses: []}); await flush()
  assert.equal((await f.api.getState()).records.length, 5)
})

for (const cause of ['background','dispose','timeout']) test(`${cause} records one terminal source result before stopping; late completion adds no success`, async t => {
  const pending=deferred(), entered=deferred(), f=fixture({savedLaunch:false,sourceRead:()=>{entered.resolve();return pending.promise}})
  t.after(()=>f.api.dispose())
  await f.api.getState(); await flush(); f.api.startDiagnostics()
  const reading=f.api.refresh();await entered.promise
  if(cause==='background') await f.api.setAppActive(false)
  else if(cause==='dispose') f.api.dispose()
  else f.fire(120_000)
  await reading
  const terminals=()=>JSON.parse(f.api.readDiagnostics()).events.filter(event=>event.kind==='source'&&['finish','error'].includes(event.stage)&&!event.source)
  assert.equal(terminals().length,1);assert.equal(terminals()[0].code,cause==='timeout'?'TIMEOUT':'CANCELLED')
  pending.resolve({records:[],collections:[],statuses:[]});await flush()
  assert.equal(terminals().length,1);assert.equal(terminals()[0].success,false)
})

test('unavailable authorization records reconnect as the terminal reason before invalidating the source generation', async t => {
  const f=fixture({savedLaunch:false});t.after(()=>f.api.dispose())
  await f.api.getState();await flush();f.api.startDiagnostics()
  f.native.getAccount=async()=>({account:A,reconnectRequired:true})
  const result=await f.api.refresh()
  const terminals=JSON.parse(f.api.readDiagnostics()).events.filter(event=>event.kind==='source'&&['finish','error'].includes(event.stage)&&!event.source)
  assert.equal(result.connection.reconnectRequired,true);assert.equal(result.deviceSync.activity,undefined)
  assert.equal(terminals.length,1);assert.equal(terminals[0].code,'RECONNECT_REQUIRED');assert.equal(terminals[0].success,false)
  assert.equal(f.counts().nativeReads.length,0)
})

test('device intervals persist with exact validation, disabled groups stay manual, scheduler failures stay visible', async t => {
  const f = fixture({savedLaunch: false}); t.after(() => f.api.dispose())
  await f.api.getState()
  await assert.rejects(f.api.setSyncSettings({caldavMinutes: 1, deckMinutes: 15, wifiOnly: false}), {code: 'VALIDATION'})
  f.native.configureSync = async () => {throw new Error('private native exception')}
  const state = await f.api.setSyncSettings({caldavMinutes: 0, deckMinutes: 60, wifiOnly: true})
  assert.deepEqual(f.values.get(syncSettingsKey(A)), {...state.deviceSync.settings,calendarHistoryDays:null})
  assert.equal(state.deviceSync.background.scheduled, false); assert.match(state.deviceSync.background.error, /could not schedule/)
  await f.api.refresh(); assert.deepEqual(f.counts().nativeReads[0], SOURCES, 'Manual refresh ignores disabled automatic intervals')
})

test('confirmed permission loss also invalidates the launch checkpoint', async t => {
  const f = fixture({savedLaunch: false, sourceRead: async () => ({records: [], collections: [], statuses: SOURCES.map(source => ({source, state: 'error', permissionDenied: true, count: 0}))})}); t.after(() => f.api.dispose())
  const state = await f.api.refresh()
  assert.deepEqual(state.records, [])
  assert.deepEqual(f.values.get(launchKey(A)).state.records, [])
})

test('source cache v2 deduplicates exact documents and rejects broken references without weakening edit bases', () => {
  const value = {version: 1, accountKey: cacheKey(A), records: [0, 1, 2].map(index => ({id: `task-${index}`, source: 'tasks', kind: 'task', title: 'Same native resource', remote: {href: 'https://cloud.example.test/remote.php/dav/calendars/fixture/tasks/a.ics', raw: 'BEGIN:VCALENDAR\nEND:VCALENDAR', recurrenceId: index}})), collections: [], statuses: []}
  const compact = compactSourceCache(value)
  assert.equal(compact.version, 2); assert.equal(compact.rawDocuments.length, 1)
  assert.deepEqual(checkedSourceCache(compact, cacheKey(A)).records, value.records)
  assert.deepEqual(checkedSourceCache(value, cacheKey(A)).records, value.records, 'Existing version 1 remains readable')
  for (const corrupt of [
    input => {input.records[0].remote.rawRef = 100},
    input => {input.records[0].source = 'calendar'},
    input => {input.records[0].remote.href += '-different'},
    input => {input.rawDocuments[0].bytes++},
    input => {input.accountKey = 'other-account'},
  ]) {
    const candidate = clone(compact); corrupt(candidate)
    assert.throws(() => checkedSourceCache(candidate, cacheKey(A)), {code: 'CACHE_FORMAT'})
  }
})

test('a genuine foreground re-entry after cancellation pulls metadata even inside the focus debounce window', async t => {
  const authBlocked = deferred(), f = fixture({savedLaunch: false, authBlocked}); t.after(() => f.api.dispose())
  await f.api.getState(); await f.api.resumeSync('open'); await flush()
  await f.api.setAppActive(false); await f.api.setAppActive(true); await f.api.resumeSync('resume')
  authBlocked.resolve(); await flush()
  assert.equal(f.counts().plannerReads, 1)
  assert.equal((await f.api.getState()).deviceSync.activity, undefined)
})

for (const phase of ['saveBlocked', 'reconcileBlocked']) test(`source deadline ends activity even when ${phase} is stalled after a successful read`, async t => {
  const blocked = deferred(), f = fixture({savedLaunch: false, [phase]: blocked}); t.after(() => f.api.dispose())
  await f.api.getState(); const reading = f.api.refresh(); await flush()
  assert.equal((await f.api.getState()).deviceSync.activity.stage, 'local-cache')
  f.fire(120_000); const failed = await reading
  assert.equal(failed.deviceSync.activity, undefined); assert.equal(failed.records.length, 5)
  assert.ok(failed.statuses.every(status => status.errorCode === 'TIMEOUT' && status.errorStage === 'local-cache'))
  blocked.resolve(); await flush()
  assert.deepEqual((await f.api.getState()).statuses, failed.statuses, 'Late persistence/reconciliation does not certify a timed-out pass')
  assert.equal(f.values.has(launchKey(A)), false, 'Timed-out work cannot publish a late launch checkpoint')
})

test('same-account authorization while launch hydration is pending cannot leave restoring stuck', async t => {
  const sourceBlocked = deferred(), f = fixture({sourceBlocked}); t.after(() => f.api.dispose())
  assert.equal((await f.api.getState()).deviceSync.restoring, true)
  const selecting = f.api.selectAccount(); await flush()
  sourceBlocked.resolve(); await selecting; await flush()
  const state = await f.api.getState()
  assert.equal(state.deviceSync.restoring, false); assert.equal(state.records.length, 5)
  assert.equal(state.connection.connected, true)
})

for (const savedLaunch of [false, true]) test(`first publication precedes restoration work (checkpoint ${savedLaunch})`, async t => {
  const startRestore = deferred(), sourceBlocked = deferred()
  const f = fixture({savedLaunch, sourceBlocked, deferRestore: () => startRestore.promise}); t.after(() => f.api.dispose())
  let reads = 0; f.native.getSyncState = async () => {reads++; await sourceBlocked.promise}
  const first = await f.api.getState()
  assert.equal(first.deviceSync.restoring, true); assert.equal(first.records.length, savedLaunch ? 5 : 0)
  assert.equal(f.counts().authReads, 0); assert.equal(reads, 0, 'Native job status is not a restoration barrier')
  startRestore.resolve(); sourceBlocked.resolve(); await flush()
  assert.equal((await f.api.getState()).records.length, 5)
})

test('stalled private restoration ends its local activity without blocking the cached planner', async t => {
  const blocked = deferred(), f = fixture({sourceBlocked: blocked}); t.after(() => f.api.dispose())
  await f.api.getState(); await flush(); f.fire(10_000); await flush()
  const failed = await f.api.getState()
  assert.equal(failed.deviceSync.restoring, false); assert.equal(failed.records.length, 5)
  assert.equal(failed.storage.errorStage, 'local-cache'); assert.equal(failed.storage.errorCode, 'TIMEOUT'); assert.deepEqual(failed.nativeOperations, [])
  blocked.resolve(); await flush(); assert.equal((await f.api.getState()).storage.syncStatus, 'error')
})

test('authorization is single-flight and background job configuration never blocks source or planner work', async t => {
  const auth = deferred(), config = deferred(), f = fixture({authBlocked: auth, configureBlocked: config}); t.after(() => f.api.dispose())
  await f.api.getState(); await flush()
  await f.api.resumeSync('open'); const manual = f.api.syncWorkspace(); await flush()
  assert.equal(f.counts().authReads, 1); assert.equal((await f.api.getState()).deviceSync.plannerSyncing, undefined)
  auth.resolve(); await manual; await flush()
  assert.equal(f.counts().plannerReads, 1); assert.equal(f.counts().nativeReads.length, 0)
  const reads = f.counts().authReads
  await f.api.resumeSync('timer'); await flush(); assert.equal(f.counts().authReads, reads, 'No due sources means no repeated provider check')
  f.fire(10_000); await flush(); assert.match((await f.api.getState()).deviceSync.background.error, /could not schedule/)
  config.resolve(); await flush()
  assert.equal((await f.api.getState()).deviceSync.background.scheduled, false, 'Late scheduler success cannot clear timeout')
})

test('planner transfer timeout clears spinner and ignores late completion, while retry remains possible', async t => {
  const blocked = deferred(), f = fixture({plannerBlocked: blocked}); t.after(() => f.api.dispose())
  await f.api.getState(); await flush()
  const syncing = f.api.syncWorkspace(); await flush()
  assert.equal((await f.api.getState()).deviceSync.plannerSyncing, true)
  f.fire(120_000); const failed = await syncing
  assert.equal(failed.deviceSync.plannerSyncing, false); assert.equal(failed.storage.errorCode, 'TIMEOUT')
  assert.equal(failed.storage.errorStage, 'planner-read')
  blocked.resolve(); await flush(); assert.equal((await f.api.getState()).storage.syncStatus, 'error')
  const retry = await f.api.syncWorkspace(); assert.equal(retry.storage.syncStatus, 'synced')
})

test('backgrounding cancels planner wait immediately without turning cancellation into failure', async t => {
  const blocked = deferred(), f = fixture({plannerBlocked: blocked}); t.after(() => f.api.dispose())
  await f.api.getState(); await flush(); const before = await f.api.getState()
  const syncing = f.api.syncWorkspace(); await flush(); await f.api.setAppActive(false)
  const stopped = await syncing; assert.equal(stopped.deviceSync.plannerSyncing, false)
  assert.deepEqual(stopped.storage, before.storage)
  blocked.resolve(); await flush(); assert.deepEqual((await f.api.getState()).storage, before.storage)
})


test('a failed private archive still saves compact readonly launch data and retains its durability warning', async t => {
  const f = fixture({savedLaunch: false}); t.after(() => f.api.dispose())
  const save = f.cache.save
  f.cache.save = async (key, value) => {if (key === cacheKey(A)) throw Object.assign(new Error('Full'), {code: 'CACHE_LIMIT'}); return save(key, value)}
  const state = await f.api.refresh()
  assert.equal(state.storage.syncStatus, 'error'); assert.equal(state.storage.errorCode, 'CACHE_LIMIT')
  assert.equal(state.storage.errorStage, 'local-cache'); assert.equal(state.records.length, 5)
  const launch = checkedLaunchCheckpoint(f.values.get(launchKey(A)), cacheKey(A))
  assert.equal(launch.state.records.length, 5); assert.ok(launch.state.records.every(record => record.readonly))
  assert.ok(launch.state.records.every(record => record.remote === undefined))
})

for(const history of [null,0,36500])test(`Calendar history ${history} persists independently of cadence and refreshes only Calendar`,async t=>{
  const reads=[],f=fixture({settings:{caldavMinutes:0,deckMinutes:30,wifiOnly:true,calendarHistoryDays:14},sourceRead:async options=>{reads.push(options);return {records:[],collections:[],statuses:[{source:'calendar',state:'connected',count:0,lastSyncedAt:new Date(start).toISOString()}]}}})
  t.after(()=>f.api.dispose());await f.api.getState();await flush()
  assert.equal((await f.api.getState()).calendarHistoryDays,14)
  const result=await f.api.setCalendarHistoryDays(history);assert.equal(result.calendarHistoryDays,history);await flush()
  assert.deepEqual(reads.map(value=>value.sources),[['calendar']]);assert.equal(reads[0].calendarHistoryDays,history)
  assert.equal(f.values.get(cacheKey(A)).calendarHistoryDays,history)
  assert.deepEqual(f.values.get(syncSettingsKey(A)),{caldavMinutes:0,deckMinutes:30,wifiOnly:true,calendarHistoryDays:history})
  await f.api.setSyncSettings({caldavMinutes:60,deckMinutes:0,wifiOnly:false})
  assert.equal(f.values.get(syncSettingsKey(A)).calendarHistoryDays,history)
  for(const invalid of [-1,36501,2.5,'14',undefined])await assert.rejects(f.api.setCalendarHistoryDays(invalid),{code:'VALIDATION'})
})

for(const enabled of [false,true])test(`legacy history catches up once with automatic Calendar ${enabled?'enabled':'off'}`,async t=>{
  const f=fixture({settings:{caldavMinutes:enabled?60:0,deckMinutes:60,wifiOnly:false}});t.after(()=>f.api.dispose())
  delete f.values.get(cacheKey(A)).calendarHistoryDays
  await f.api.getState();await flush();await f.api.resumeSync('open');await flush()
  assert.equal((await f.api.getState()).calendarHistoryDays,null)
  assert.deepEqual(f.counts().nativeReads,enabled?[['calendar']]:[])
  if(enabled){assert.equal(f.values.get(cacheKey(A)).calendarHistoryDays,null);await f.api.resumeSync('timer');await flush();assert.deepEqual(f.counts().nativeReads,[['calendar']])}
})

test('changing Calendar history fences a delayed older read while preserving its selected setting',async t=>{
  const old=deferred(),reads=[],f=fixture({sourceRead:async options=>{
    reads.push(options.calendarHistoryDays)
    if(options.calendarHistoryDays===null)await old.promise
    return {records:[{id:'calendar',source:'calendar',kind:'event',title:options.calendarHistoryDays===null?'Old horizon':'New horizon',collectionId:'calendar'}],collections:[{id:'calendar',source:'calendar',title:'Calendar'}],statuses:[{source:'calendar',state:'connected',count:1,lastSyncedAt:new Date(start).toISOString()}]}
  }});t.after(()=>{old.resolve();f.api.dispose()})
  await f.api.getState();await flush();const earlier=f.api.refresh();await flush()
  const changed=await f.api.setCalendarHistoryDays(30);assert.equal(changed.calendarHistoryDays,30);await flush()
  old.resolve();await earlier;await flush()
  assert.deepEqual(reads,[null,30]);assert.equal((await f.api.getState()).records.find(row=>row.source==='calendar').title,'New horizon');assert.equal(f.values.get(cacheKey(A)).calendarHistoryDays,30)
})

test('failed expanded history keeps prior completed coverage evidence and existing records',async t=>{
  const f=fixture({settings:{caldavMinutes:60,deckMinutes:60,wifiOnly:false,calendarHistoryDays:14},sourceRead:async()=>({records:[],collections:[],statuses:[{source:'calendar',state:'error',errorCode:'LIMIT',count:0,message:'Projection limit reached'}]})});t.after(()=>f.api.dispose())
  f.values.get(cacheKey(A)).calendarHistoryDays=14
  await f.api.getState();await flush();await f.api.setCalendarHistoryDays(null);await flush()
  const result=await f.api.getState();assert.equal(result.calendarHistoryDays,null);assert.equal(result.statuses.find(row=>row.source==='calendar').errorCode,'LIMIT');assert.ok(result.records.some(row=>row.source==='calendar'));assert.equal(f.values.get(cacheKey(A)).calendarHistoryDays,14)
})

test('rapid Calendar history changes preserve the final requested value even when it matches the original',async t=>{
  const f=fixture();t.after(()=>f.api.dispose());await f.api.getState();await flush()
  await Promise.all([f.api.setCalendarHistoryDays(30),f.api.setCalendarHistoryDays(null)]);await flush()
  assert.equal((await f.api.getState()).calendarHistoryDays,null);assert.equal(f.values.get(syncSettingsKey(A)).calendarHistoryDays,null)
})

test('completed source refresh persists a new task even when planner identity publication is rejected', async t => {
  const plannerWorkspace = createEmptyState().workspace, plannerKey = metadataKey(A)
  const initialPlanner = {version:1,accountKey:plannerKey,ready:true,revision:0,workspace:clone(plannerWorkspace),baseline:clone(plannerWorkspace),remoteExists:true,checkpoint:null,etag:null,deviceState:{},status:'synced',message:'Fixture planner'}
  const confirmed = []
  const f = fixture({makeMetadataStore:createMetadataStore, cacheFactory:values => {
    values.set(plannerKey, clone(initialPlanner))
    return {load:async key=>clone(values.get(key)??null),remove:async key=>values.delete(key),save:async(key,value)=>{
      if (key===plannerKey && value.workspace.identities.length) throw Object.assign(new Error('Fictional metadata storage limit'), {code:'LIMIT'})
      values.set(key,clone(value))
    }}
  }})
  t.after(()=>f.api.dispose())
  f.native.confirmSourceReads = async value => {confirmed.push(...value.sources)}
  await f.api.getState(); await flush()
  f.data.records.push({id:'new-native-task',source:'tasks',kind:'task',title:'New fictional task',collectionId:'tasks',remote:{href:'new-task.ics',raw:'BEGIN:VCALENDAR\nEND:VCALENDAR'}})
  const state = await f.api.refresh()
  assert.equal(state.records.some(record=>record.title==='New fictional task'),true)
  assert.equal(f.values.get(cacheKey(A)).records.some(record=>record.title==='New fictional task'),true)
  assert.equal(state.statuses.find(status=>status.source==='tasks').state,'connected')
  assert.equal(state.connection.connected,true)
  assert.ok(state.nativeWriteSources.includes('tasks'))
  assert.ok(confirmed.includes('tasks'))
  assert.equal(state.storage.syncStatus,'error')
  assert.equal(state.storage.errorCode,'LIMIT')
  assert.deepEqual(state.workspace,plannerWorkspace)
  assert.deepEqual(f.values.get(plannerKey).workspace,plannerWorkspace)
  const launch=checkedLaunchCheckpoint(f.values.get(launchKey(A)),cacheKey(A))
  assert.equal(launch.state.records.some(record=>record.title==='New fictional task'),true)
})
