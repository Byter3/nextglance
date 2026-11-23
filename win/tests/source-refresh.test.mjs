import test from 'node:test'
import assert from 'node:assert/strict'
import {SourceHistorySession} from '../electron/calendar-history.mjs'
import {refreshNativeSources} from '../electron/source-refresh.mjs'
const sources=['tasks','calendar','deck','notes','collectives'],clone=structuredClone
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
const record=(id,source='calendar',title=id)=>({id,source,title,collectionId:source,identity:{key:id}})
function fixture(){
  let cache={records:[record('event'),record('task','tasks')],collections:[{id:'calendar',source:'calendar'},{id:'tasks',source:'tasks'}],statuses:sources.map(source=>({source,state:'connected',count:1,lastSyncedAt:'2026-11-23T08:00:00Z'})),davCheckpoint:{old:true}}
  const store={cacheSnapshot:()=>clone(cache),updateCache:async fn=>{cache=clone(fn(clone(cache)))}}
  const verified=[],client={primeFileMetadata:()=>{},readAll:async()=>({records:[record('event')],collections:[{id:'calendar',source:'calendar'}],statuses:[{source:'calendar',state:'connected'}],davCheckpoint:{current:true}})}
  const options={store,client,session:new SourceHistorySession(),current:()=>true,selected:['calendar'],sources,onVerified:(successful,selected)=>verified.push({successful:[...successful],selected})}
  return {options,verified,cache:()=>cache}
}
test('history refresh changes only Calendar and persists private checkpoint without resetting unrelated successes',async()=>{
  const {options,verified,cache}=fixture();let input,flush=0
  const read=options.client.readAll;options.client.readAll=async value=>{input=value;return read()};options.resourceCache={flush:async()=>{flush++}}
  assert.equal(await refreshNativeSources(options),true)
  assert.equal(input.calendarHistoryDays,null);assert.deepEqual(input.sources,['calendar']);assert.equal(input.isActive(),true)
  assert.equal(cache().records.some(item=>item.id==='task'),true);assert.equal(cache().statuses.length,5);assert.equal(cache().statuses[0].lastSyncedAt,'2026-11-23T08:00:00Z');assert.deepEqual(cache().davCheckpoint,{current:true})
  assert.deepEqual(verified,[{successful:['calendar'],selected:['calendar']}]);assert.equal(flush,1)
})
test('obsolete slow history result cannot publish after a newer persisted choice',async()=>{
  const {options,cache,verified}=fixture(),started=deferred(),release=deferred();let input
  options.client.readAll=async value=>{input=value;started.resolve();return release.promise}
  const reading=refreshNativeSources(options);await started.promise
  await options.session.set(7,async days=>days);assert.equal(input.isActive(),false)
  release.resolve({records:[record('obsolete')],collections:[],statuses:[{source:'calendar',state:'connected'}]})
  assert.equal(await reading,false);assert.equal(cache().records[0].id,'event');assert.deepEqual(verified,[])
})
test('acknowledged edits and deletions during slow reproject win over its older source rows',async()=>{
  const {options,cache}=fixture(),started=deferred(),release=deferred()
  options.client.readAll=async()=>{started.resolve();return release.promise}
  const reading=refreshNativeSources(options);await started.promise
  await options.store.updateCache(value=>({...value,records:[record('created'),record('task','tasks','Edited task')]}))
  release.resolve({records:[record('event'),record('stale-task','tasks')],collections:[],statuses:[{source:'calendar',state:'connected'}]})
  await reading;assert.deepEqual(cache().records.map(item=>item.id).sort(),['created','task']);assert.equal(cache().records.find(item=>item.id==='task').title,'Edited task')
})
test('failed projections retain saved data and prior success time while removing write verification',async()=>{
  const {options,cache,verified}=fixture();options.client.readAll=async()=>{throw Object.assign(Error('network'),{code:'NETWORK'})}
  await refreshNativeSources(options)
  assert.equal(cache().records[0].id,'event');const status=cache().statuses.find(item=>item.source==='calendar');assert.equal(status.state,'error');assert.equal(status.lastSyncedAt,'2026-11-23T08:00:00Z');assert.deepEqual(cache().davCheckpoint,{old:true});assert.deepEqual(verified,[{successful:[],selected:['calendar']}])
})
test('permission revocation wins over concurrent edits and purges denied data only',async()=>{
  const {options,cache}=fixture();let purge
  const update=options.store.updateCache;options.store.updateCache=async(fn,settings)=>{purge=settings.purgeBackup;return update(fn)}
  options.client.readAll=async()=>{throw Object.assign(Error('denied'),{code:'AUTH'})}
  await refreshNativeSources(options);assert.equal(purge,true);assert.deepEqual(cache().records.map(item=>item.id),['task']);assert.equal(cache().statuses.find(item=>item.source==='calendar').permissionDenied,true)
})
test('cache index failure is visible without discarding a complete source read',async()=>{
  const {options,cache}=fixture();options.resourceCache={flush:async()=>{throw Error('disk')}}
  await refreshNativeSources(options);const status=cache().statuses.find(item=>item.source==='calendar');assert.equal(status.state,'connected');assert.match(status.message,/cache could not be saved/)
})
test('portable resource-cache warnings stay visible after successful source projection',async()=>{
  const {options,cache}=fixture(),read=options.client.readAll
  options.client.readAll=async()=>({...await read(),cacheWarning:{message:'The device resource cache could not be saved.'}})
  await refreshNativeSources(options);assert.match(cache().statuses.find(item=>item.source==='calendar').message,/resource cache could not be saved/)
})
