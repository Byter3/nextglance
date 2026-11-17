import {chunkPort} from './fixtures/chunk-cache-port.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {Worker} from 'node:worker_threads'
import {createWorkerApi} from '../src/worker/client.mjs'
import {createPublisher,createPublicState} from '../src/worker/publication.mjs'
import {createRpc,checkedCall,checkedFileEffect,COMMANDS,EFFECTS,USER_ACTION_COMMANDS,USER_ACTION_EFFECTS,WORKER_PROTOCOL} from '../src/worker/protocol.mjs'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {cacheKey,launchKey,schedulingKey} from '../src/controller.mjs'
import {launchCheckpoint} from '../src/launch-cache.mjs'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
const account={name:'fixture',username:'tester',serverUrl:'https://cloud.example.test'}
const wrap=node=>({postMessage:value=>node.postMessage(value),terminate:()=>node.terminate(),addEventListener(type,listener){node.on(type,type==='message'?data=>listener({data}):listener)}})
const envelope=value=>JSON.stringify({version:1,generation:1,value})
function fixture({count=3,holdPrivate=false,holdAuth=false}={}){
  const releasePrivate=deferred(),privateEntered=deferred(),releaseAuth=deferred(),saved=new Map(),workers=[]
  let calls=0,authCalls=0,diagnosticChanges=0
  const rows=Array.from({length:count},(_,i)=>({id:`note-${i}`,source:'notes',kind:'note',title:`Fixture note ${i}`,collectionId:'notes',description:'Context '.repeat(150),readonly:false,remote:{id:i+1,secretFixture:'private-only'}}))
  const state={...createEmptyState(),records:rows,collections:[{id:'notes',source:'notes',title:'Notes'}],statuses:[{source:'notes',state:'connected',count}],deviceState:{scopeId:'all'},connection:{connected:false,serverUrl:account.serverUrl,username:account.username}}
  saved.set(`cache/${cacheKey(account)}.0.json`,envelope({version:1,accountKey:cacheKey(account),records:rows,collections:state.collections,statuses:state.statuses}))
  saved.set(`cache/${launchKey(account)}.0.json`,envelope(launchCheckpoint(state,cacheKey(account))))
  const effects={
    'native.getSavedAccount':async()=>({account}),'native.getAccount':async()=>{authCalls++;if(holdAuth)await releaseAuth.promise;return {account,capabilities:{davReadMode:'propfind-get'}}},
    'files.keys':async()=>[...saved.keys()], 'files.size':async path=>saved.has(path)?Buffer.byteLength(saved.get(path)):null,
    'files.read':async path=>{if(path===`cache/${cacheKey(account)}.0.json`){privateEntered.resolve();if(holdPrivate)await releasePrivate.promise}return saved.get(path)??null},
    'files.write':async(path,text)=>saved.set(path,text),'files.remove':async path=>saved.delete(path),
    'network.status':async()=>({connected:false,connectionType:'none'}),'hints.save':async()=>{},'hints.clear':async()=>{},
  }
  effects['native.cacheFile']=chunkPort({size:effects['files.size'],read:effects['files.read'],write:effects['files.write'],remove:effects['files.remove']})
  const api=createWorkerApi({createWorker:()=>{calls++;const thread=new Worker(new URL('./fixtures/data-worker.mjs',import.meta.url));workers.push(thread);return wrap(thread)},effects,isNative:true,onDiagnosticsChange:()=>diagnosticChanges++})
  return {api,effects,saved,state,workers,releasePrivate,privateEntered,releaseAuth,counts:()=>({calls,authCalls,diagnosticChanges})}
}

test('publication deltas preserve order/deletions/account epochs and return detached public state',()=>{
  const pub=createPublisher(),mirror=createPublicState(),state={...createEmptyState(),records:[{id:'a',title:'A'},{id:'b',title:'B'}]}
  assert.ok(mirror.apply(pub.encode(state)));const caller=mirror.read();caller.records[0].title='caller';assert.equal(mirror.read().records[0].title,'A')
  const frame=pub.encode({...state,records:[{id:'b',title:'B changed'},{id:'c',title:'C'}]});assert.equal(frame.full,undefined);assert.deepEqual(frame.records.removed,['a']);mirror.apply(frame);assert.deepEqual(mirror.read().records.map(row=>row.id),['b','c'])
  const skip=pub.encode({...state,revision:3});pub.encode({...state,revision:4});const later=pub.encode({...state,revision:5});assert.throws(()=>mirror.apply(later),{code:'STATE_GAP'});mirror.apply(pub.encode({...state,connection:{serverUrl:'https://other.example',username:'another'}},true));assert.equal(mirror.read().connection.username,'another');assert.equal(mirror.apply(skip),false)
})
test('RPC closes every pending request and rejects arbitrary methods and file paths',async()=>{
  const sent=[],rpc=createRpc({session:'abcdef0123456789',send:value=>sent.push(value),methods:COMMANDS})
  await assert.rejects(rpc.call('__proto__'),{code:'SECURITY'});const pending=rpc.call('refresh');rpc.close();await assert.rejects(pending,{code:'UNAVAILABLE'});assert.equal(rpc.pending,0)
  assert.throws(()=>checkedCall({version:1,type:'call',session:'abcdef0123456789',id:1,method:'constructor',args:[]},'abcdef0123456789',COMMANDS),{code:'SECURITY'})
  assert.throws(()=>checkedFileEffect('files.read',['../credentials.json']),{code:'SECURITY'});assert.throws(()=>checkedFileEffect('files.keys',[]),{code:'SECURITY'});checkedFileEffect('files.read',[`cache/${'a'.repeat(64)}.0.json`])
})
test('actual Worker publishes launch state before blocked hydration/auth and keeps private locators out',async t=>{
  const f=fixture({holdPrivate:true,holdAuth:true});t.after(()=>{f.releasePrivate.resolve();f.releaseAuth.resolve();f.api.dispose()})
  const state=await f.api.getState();assert.equal(state.records.length,3);assert.equal(state.deviceSync.restoring,true);assert.deepEqual(state.nativeOperations,[]);assert.equal(f.counts().authCalls,0);assert.ok(!JSON.stringify(state).includes('private-only'))
  state.records[0].title='caller change';assert.equal((await f.api.getState()).records[0].title,'Fixture note 0')
  await f.privateEntered.promise;const restored=deferred();f.api.subscribe(value=>{if(!value.deviceSync.restoring)restored.resolve(value)})
  f.releasePrivate.resolve();const next=await restored.promise;assert.equal(next.records.length,3);assert.ok(!JSON.stringify(next).includes('private-only'));assert.equal(f.counts().authCalls,0)
})
test('actual Worker restores a large private archive while presentation heartbeat continues',async t=>{
  const f=fixture({count:7000,holdPrivate:true});t.after(()=>{f.releasePrivate.resolve();f.api.dispose()});await f.api.getState();await f.privateEntered.promise
  let beats=0;const timer=setInterval(()=>beats++,1);t.after(()=>clearInterval(timer));const restored=deferred();f.api.subscribe(value=>{if(!value.deviceSync.restoring)restored.resolve(value)})
  const start=performance.now();f.releasePrivate.resolve();const next=await restored.promise;const elapsed=performance.now()-start
  assert.equal(next.records.length,7000);assert.ok(beats>0,`presentation heartbeat ${beats}`)
  t.diagnostic(JSON.stringify({fixture:'worker-private-restore',records:7000,sourceBytes:Buffer.byteLength(f.saved.get(`cache/${cacheKey(account)}.0.json`)),elapsedMs:Math.round(elapsed),heartbeatTicks:beats}))
})
test('worker crash rejects uncertain calls, keeps readonly cached view, and explicitly restarts once',async t=>{
  const f=fixture({holdPrivate:true});t.after(()=>{f.releasePrivate.resolve();f.api.dispose()});await f.api.getState();await f.privateEntered.promise
  const waiting=f.api.refresh();f.workers[0].emit('error',new Error('Fixture crash'))
  await assert.rejects(waiting);const failed=await f.api.getState();assert.equal(failed.records.length,3);assert.deepEqual(failed.nativeOperations,[]);assert.deepEqual(failed.nativeWriteSources,[]);assert.equal(failed.storage.errorCode,'UNAVAILABLE')
  await assert.rejects(f.api.createLinkedEvent({}),{code:'UNAVAILABLE'});assert.equal(f.counts().calls,1)
  f.releasePrivate.resolve();await f.api.retryConnection().catch(()=>{});assert.equal(f.counts().calls,2)
})
test('diagnostic mirror privacy, background stop event and recording generations stay coherent',async t=>{
  const f=fixture();t.after(()=>f.api.dispose());await f.api.getState();f.api.startDiagnostics();f.api.recordDiagnostic({kind:'ui',stage:'panel',durationMs:4,title:'private',url:account.serverUrl});await f.api.setAppActive(false)
  const report=JSON.parse(f.api.readDiagnostics());assert.equal(report.summary.recording,false);assert.equal(report.summary.stopReason,'background');assert.ok(f.counts().diagnosticChanges>=2);assert.ok(!JSON.stringify(report).includes('private'));assert.ok(!JSON.stringify(report).includes(account.serverUrl))
})

function transportWorker(){
  const listeners=new Map(),sent=[];let session,seq=0
  const value={...createEmptyState(),records:[{id:'row',source:'tasks',kind:'task',title:'Saved row'}]}
  const emit=message=>queueMicrotask(()=>{for(const listener of listeners.get('message')||[])listener({data:{version:1,session,...message}})})
  return {sent,emit,get session(){return session},terminate(){},addEventListener(type,listener){const list=listeners.get(type)||[];list.push(listener);listeners.set(type,list)},crash(){for(const listener of listeners.get('error')||[])listener(new Error('Fixture crash'))},
    postMessage(message){sent.push(message);session=message.session;if(message.type==='init')emit({type:'ready'});else if(message.type==='call'&&['getState','refresh','retryConnection'].includes(message.method)){emit({type:'state',epoch:1,seq:++seq,full:structuredClone(value)});emit({type:'result',id:message.id,value:{$nextglanceState:seq}})}},
  }
}
test('crash keeps an issued journal write and fences restart reads without replaying uncertain mutations',async t=>{
  const workers=[],entered=deferred(),release=deferred(),read=deferred();let durable,readCalls=0
  const path=`cache/${schedulingKey(account)}.0.json`,intent=envelope({version:1,pending:[{recordId:'fixture',phase:'prepared'}]})
  const api=createWorkerApi({isNative:true,createWorker:()=>{const worker=transportWorker();workers.push(worker);return worker},effects:{'files.write':async(key,text)=>{assert.equal(key,path);entered.resolve();await release.promise;durable=text},'files.read':async key=>{readCalls++;read.resolve();return durable}}});t.after(()=>{release.resolve();api.dispose()})
  await api.getState();workers[0].emit({type:'call',id:701,method:'files.write',args:[path,intent]});await entered.promise
  const mutation=api.createLinkedEvent({recordId:'fixture'});await tick();workers[0].crash();await assert.rejects(mutation)
  await api.retryConnection();workers[1].emit({type:'call',id:702,method:'files.read',args:[path]});await tick();assert.equal(readCalls,0,'replacement read waits for old durable write')
  release.resolve();await read.promise;await tick();assert.equal(durable,intent)
  assert.equal(workers.flatMap(worker=>worker.sent).filter(message=>message.method==='createLinkedEvent').length,1,'uncertain user operation is never replayed')
  const result=workers[1].sent.find(message=>message.type==='result'&&message.id===702);assert.equal(result.value,intent)
})
test('worker creation failure rejects promptly and explicit Retry starts a fresh endpoint',async t=>{
  let attempts=0;const api=createWorkerApi({isNative:true,effects:{},createWorker:()=>{if(++attempts===1)throw new Error('Fixture construction failure');return transportWorker()}});t.after(()=>api.dispose())
  await assert.rejects(api.getState());const state=await api.retryConnection();assert.equal(state.records[0].title,'Saved row');assert.equal(attempts,2)
})
test('diagnostic events from stopped/cleared generations cannot enter a new report',async t=>{
  const worker=transportWorker();let clock=1000;const api=createWorkerApi({isNative:true,effects:{},createWorker:()=>worker,now:()=>clock,timeOrigin:()=>100000});t.after(()=>api.dispose());await api.getState()
  api.startDiagnostics();const old=worker.sent.findLast(message=>message.type==='diagnostic-control').generation;clock+=20
  worker.emit({type:'diagnostic',generation:old,at:101005,event:{kind:'source',stage:'finish',count:1,secret:'hidden'}});await tick()
  assert.equal(JSON.parse(api.readDiagnostics()).events[0].atMs,5)
  api.clearDiagnostics();api.startDiagnostics();worker.emit({type:'diagnostic',generation:old,at:101010,event:{kind:'source',count:99}});await tick();assert.equal(api.getDiagnostics().eventCount,0)
  worker.emit({type:'call',id:555,method:'browser.open',args:['javascript:alert(1)']});await tick();assert.equal(worker.sent.find(message=>message.type==='result'&&message.id===555).error.code,'SECURITY')
})

test('bounded worker evidence batches wait for ACK and flush terminal cancellation before stop',async()=>{
  const {installWorkerRuntime}=await import('../src/worker/runtime.mjs')
  const sent=[],callbacks=new Map();let listener,diagnostics,timer=0
  const port={postMessage:message=>sent.push(message),addEventListener(_type,value){listener=value},removeEventListener(){}}
  const runtime=installWorkerRuntime(port,{timers:{setTimeout(fn,ms){callbacks.set(++timer,{fn,ms});return timer},clearTimeout(id){callbacks.delete(id)}},makeController:options=>{diagnostics=options.diagnostics;return {subscribe(){},subscribeSync(){},getState:async()=>createEmptyState(),setAppActive:async()=>{diagnostics.record({kind:'source',stage:'error',code:'CANCELLED'});diagnostics.stop('background')},dispose(){}}}})
  const session='abcdef0123456789',send=value=>listener({data:{version:1,session,...value}})
  send({type:'init',isNative:true});await tick();send({type:'diagnostic-control',generation:1,recording:true})
  for(let i=0;i<1000;i++)diagnostics.record({kind:'cache',count:i,body:'secret'})
  const scheduled=[...callbacks].find(([,value])=>value.ms===50);assert.ok(scheduled);callbacks.delete(scheduled[0]);scheduled[1].fn()
  assert.equal(sent.filter(message=>message.type==='diagnostic-batch').length,1)
  for(let i=0;i<300;i++)diagnostics.record({kind:'cache',count:i})
  send({type:'call',id:5,method:'setAppActive',args:[false]});await tick()
  let seen=0
  while(true){const batch=sent.filter(message=>message.type==='diagnostic-batch')[seen++];if(!batch)break;assert.ok(batch.events.length<=64);send({type:'diagnostic-ack',generation:1,seq:batch.seq});await tick()}
  const batches=sent.filter(message=>message.type==='diagnostic-batch'),events=batches.flatMap(message=>message.events)
  assert.equal(events.length,320);assert.equal(batches.reduce((sum,message)=>sum+message.dropped,0),981)
  assert.equal(events.at(-1).event.code,'CANCELLED');assert.ok(!JSON.stringify(events).includes('secret'))
  const stopped=sent.findIndex(message=>message.type==='diagnostic-stop');assert.ok(stopped>sent.findLastIndex(message=>message.type==='diagnostic-batch'));assert.ok(sent.findIndex(message=>message.type==='result'&&message.id===5)>stopped)
  runtime.dispose()
})
test('background command reaches actual Worker during blocked cold hydration without authorization',async t=>{
  const f=fixture({holdPrivate:true,holdAuth:true});t.after(()=>{f.releasePrivate.resolve();f.releaseAuth.resolve();f.api.dispose()})
  await f.api.getState();await f.privateEntered.promise;f.api.startDiagnostics();await f.api.setAppActive(false)
  await f.api.resumeSync('open');assert.equal(f.counts().authCalls,0);assert.equal(f.api.getDiagnostics().recording,false)
})

test('task and event commands cross the actual RPC runtime and retain acknowledged creation warnings',async t=>{
  const {installWorkerRuntime}=await import('../src/worker/runtime.mjs')
  const handlers=new Map();let workerListener;const called=[]
  const state={...createEmptyState(),records:[{id:'created',source:'tasks',kind:'task',title:'Created task'}]}
  const runtime=installWorkerRuntime({postMessage:message=>queueMicrotask(()=>{for(const listener of handlers.get('message')||[])listener({data:message})}),addEventListener(_type,listener){workerListener=listener},removeEventListener(){}},{makeController:()=>({
    subscribe(){},subscribeSync(){},getState:async()=>state,dispose(){},
    ...Object.fromEntries(['createTask','createCard','createEvent','updateDescription','respondToEvent','setDeckDependency','moveCard','updateTaskStatus','updateRecordAppearance','createDeckLabel','readRelatedResources','readPageAsset','exportWorkspace'].map(method=>[method,async input=>{called.push({method,input});return {...state,...(method.startsWith('create')?{createdRecordId:'created',creationWarning:'Created; refresh before editing.'}:{})}}])),
  })})
  const worker={postMessage:message=>queueMicrotask(()=>workerListener({data:message})),terminate(){runtime.dispose()},addEventListener(type,listener){handlers.set(type,[...(handlers.get(type)||[]),listener])}}
  const api=createWorkerApi({createWorker:()=>worker,effects:{},isNative:true});t.after(()=>api.dispose())
  await api.getState()
  for(const method of ['createTask','createCard','createEvent','updateDescription','respondToEvent','setDeckDependency','moveCard','updateTaskStatus','updateRecordAppearance','createDeckLabel','readRelatedResources','readPageAsset','exportWorkspace']){
    const input={id:'fixture',description:'## Draft',attendees:[{email:'guest@example.test'}],participation:'ACCEPTED',etag:'"version"',...(method==='createTask'?{requestId:'11111111-1111-8111-8111-111111111111',completed:true}:{})}
    const result=await api[method](input)
    assert.deepEqual(called.at(-1),{method,input})
    if(method.startsWith('create')){assert.equal(result.createdRecordId,'created');assert.equal(result.creationWarning,'Created; refresh before editing.')}
  }
  assert.equal(called.length,13)
})

function fakeClock(){
  let now=0,next=0;const timers=new Map()
  return {setTimeout(fn,ms){const id=++next;timers.set(id,{fn,at:now+ms});return id},clearTimeout(id){timers.delete(id)},advance(ms){
    const until=now+ms
    while(true){const due=[...timers].filter(([,value])=>value.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);now=due[1].at;due[1].fn()}
    now=until
  }}
}

async function exportTransport(){
  const {installWorkerRuntime}=await import('../src/worker/runtime.mjs')
  const handlers=new Map(),clock=fakeClock(),picker=deferred(),entered=deferred(),sent=[];let workerListener,saveCalls=0
  const runtime=installWorkerRuntime({postMessage:message=>queueMicrotask(()=>{for(const listener of handlers.get('message')||[])listener({data:message})}),addEventListener(_type,listener){workerListener=listener},removeEventListener(){}},{timers:clock,makeController:options=>({
    subscribe(){},subscribeSync(){},getState:async()=>createEmptyState(),dispose(){},exportWorkspace:()=>options.exportPlanner('{"fixture":"validated upstream"}'),
  })})
  const worker={postMessage:message=>{sent.push(message);queueMicrotask(()=>workerListener({data:message}))},terminate(){runtime.dispose()},addEventListener(type,listener){handlers.set(type,[...(handlers.get(type)||[]),listener])}}
  const api=createWorkerApi({createWorker:()=>worker,timers:clock,effects:{'planner.export':async()=>{saveCalls++;entered.resolve();return picker.promise}},isNative:true})
  await api.getState()
  return {api,clock,picker,entered,sent,saveCalls:()=>saveCalls}
}

for(const exported of [true,false])test(`export chooser survives both RPC deadlines and returns eventual ${exported?'save':'cancellation'} once`,async t=>{
  const f=await exportTransport();t.after(()=>{f.picker.resolve({exported:false});f.api.dispose()})
  let settled=false;const pending=f.api.exportWorkspace().finally(()=>{settled=true})
  await f.entered.promise;f.clock.advance(300000);await tick()
  assert.equal(settled,false,'neither the 50-second effect nor 130-second command deadline expires user interaction')
  f.picker.resolve({exported});assert.deepEqual(await pending,{exported})
  assert.equal(f.saveCalls(),1);assert.equal(f.sent.filter(message=>message.type==='call'&&message.method==='exportWorkspace').length,1,'export is not replayed')
})

test('disposing an export session rejects pending user interaction and ignores late chooser completion',async()=>{
  const f=await exportTransport();let settled=0
  const pending=f.api.exportWorkspace().finally(()=>{settled++});await f.entered.promise
  f.api.dispose();await assert.rejects(pending,{code:'UNAVAILABLE'})
  f.picker.resolve({exported:true});f.clock.advance(300000);await tick()
  assert.equal(settled,1);assert.equal(f.saveCalls(),1)
})

test('user-interaction exemptions do not weaken command or native network deadlines',async()=>{
  for(const options of [{methods:COMMANDS,userActions:USER_ACTION_COMMANDS,method:'refresh',timeout:130000},{methods:EFFECTS,userActions:USER_ACTION_EFFECTS,method:'native.request',timeout:50000}]){
    const timers=fakeClock(),rpc=createRpc({send(){},session:'abcdef0123456789',timers,...options})
    const pending=rpc.call(options.method),rejection=assert.rejects(pending,{code:'TIMEOUT'})
    timers.advance(options.timeout);await rejection;assert.equal(rpc.pending,0);rpc.close()
  }
})
