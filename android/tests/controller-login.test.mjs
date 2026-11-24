import test from 'node:test'
import assert from 'node:assert/strict'
import {createMobileController, cacheKey, syncSettingsKey} from '../src/controller.mjs'

const A = {name:'old-provider-key',serverUrl:'https://cloud.example/nc',username:'a'}
const B = {name:'nextspace-direct:new-user',serverUrl:A.serverUrl,username:'b'}
const sources = ['tasks','calendar','deck','notes','collectives']
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no}); return {promise,resolve,reject} }
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture({initial=A,isNative=true,hostAvailable=isNative,makeMetadataStore}={}) {
  let current=initial
  const values=new Map(), calls={open:[],poll:[],cancel:[],read:[]}, clients=new Map()
  const native={
    getAccount:async()=>({account:current}),
    beginLogin:async()=>({flowId:'flow-1',loginUrl:A.serverUrl+'/login/flow'}),
    pollLogin:async({flowId})=>{calls.poll.push(flowId); current=B; return {pending:false,account:B}},
    cancelLogin:async input=>{calls.cancel.push(input);return {pending:false}},
    disconnect:async()=>{current=null},
  }
  const cache={load:async key=>structuredClone(values.get(key)),save:async(key,value)=>{values.set(key,structuredClone(value))},remove:async key=>values.delete(key)}
  const makeClient=account=>{const client={readAll:async()=>{
    calls.read.push(account.username)
    return {records:[{id:account.username,source:'notes',kind:'note',title:account.username}],collections:[],statuses:sources.map(source=>({source,state:'connected',count:source==='notes'?1:0}))}
  }};clients.set(account.username,client);return client}
  const api=createMobileController({native,cache,makeClient,isNative,hostAvailable,...(makeMetadataStore?{makeMetadataStore}:{}),openExternal:async url=>calls.open.push(url)})
  return {api,native,calls,values,clients,setCurrent:value=>{current=value}}
}

test('trusted browser host authorizes without Files or exposing credentials',async()=>{
  const f=fixture({initial:null,isNative:false,hostAvailable:true})
  assert.equal(f.api.isNative,false);assert.equal(f.api.canAuthenticate,true)
  const started=await f.api.beginLogin(A.serverUrl)
  assert.deepEqual(started,{flowId:'flow-1',loginUrl:A.serverUrl+'/login/flow'})
  assert.deepEqual(f.calls.open,[A.serverUrl+'/login/flow'])
  const result=await f.api.pollLogin(started.flowId)
  assert.equal(result.pending,false);assert.equal(result.state.connection.username,'b')
  assert.deepEqual(result.state.records.map(record=>record.id),['b'])
  assert.ok(!JSON.stringify(result).includes('appPassword'))
})

test('a direct switch keeps the account key and re-arms the saved Android background policy',async t=>{
  const f=fixture();t.after(()=>f.api.dispose())
  let method='files'
  const configured=[], started=[]
  const settings={caldavMinutes:30,deckMinutes:0,wifiOnly:true}
  f.values.set(syncSettingsKey(A),settings)
  f.native.getSavedAccount=f.native.getAccount=async()=>({account:A,authorizationMethod:method})
  f.native.configureSync=async args=>{configured.push(args);return {background:{supported:true,scheduled:true}}}
  f.native.beginLogin=async args=>{started.push(args);return {flowId:'flow-1',loginUrl:A.serverUrl+'/login/flow'}}
  f.native.pollLogin=async()=>{method='direct';return {pending:false,account:A,authorizationMethod:method,capabilities:{davReadMode:'report'}}}
  const before=await f.api.refresh()
  assert.equal(before.connection.authorizationMethod,'files')
  assert.equal(before.records[0].id,'a')
  await f.api.beginLogin(A.serverUrl,{sameAccount:true})
  assert.deepEqual(started,[{serverUrl:A.serverUrl,expectedAccount:A}])
  const result=await f.api.pollLogin('flow-1')
  await tick()
  assert.equal(result.state.connection.authorizationMethod,'direct')
  assert.equal(result.state.connection.username,A.username)
  assert.equal(result.state.records[0].id,'a')
  assert.ok(f.values.has(cacheKey(A)))
  assert.deepEqual(configured,[{accountName:A.name,settings}])
  assert.equal((await f.api.getState()).deviceSync.background.scheduled,true)
})

test('an explicit direct switch cannot adopt authorization for another account',async t=>{
  const f=fixture();t.after(()=>f.api.dispose())
  f.native.getAccount=async()=>({account:A,authorizationMethod:'files'})
  const before=await f.api.refresh(), saved=structuredClone(f.values.get(cacheKey(A)))
  f.native.pollLogin=async()=>({pending:false,account:B,authorizationMethod:'direct'})
  await f.api.beginLogin(A.serverUrl,{sameAccount:true})
  await assert.rejects(f.api.pollLogin('flow-1'),{code:'AUTH'})
  assert.deepEqual((await f.api.getState()).connection,before.connection)
  assert.deepEqual(f.values.get(cacheKey(A)),saved)
  assert.deepEqual(f.calls.read,['a'])
})

test('a saved Files account can start a guarded direct switch while Files authorization is unavailable',async t=>{
  const f=fixture();t.after(()=>f.api.dispose())
  const files={account:A,authorizationMethod:'files'}
  f.native.getAccount=async()=>files
  const before=await f.api.refresh()
  f.native.getAccount=async()=>({...files,reconnectRequired:true})
  const reconnecting=await f.api.refresh()
  assert.equal(reconnecting.connection.reconnectRequired,true)
  assert.equal(reconnecting.connection.authorizationMethod,'files')
  assert.deepEqual(reconnecting.records.map(record=>record.id),before.records.map(record=>record.id))
  const started=await f.api.beginLogin(A.serverUrl,{sameAccount:true})
  f.native.pollLogin=async()=>({pending:true})
  assert.deepEqual(await f.api.pollLogin(started.flowId),{pending:true})
  assert.deepEqual((await f.api.cancelLogin(started.flowId)).connection,reconnecting.connection)
  assert.deepEqual(f.calls.read,['a'])
})

test('cancelling a pending replacement preserves the current account and cache',async()=>{
  const f=fixture();await f.api.refresh();const previous=structuredClone(f.values.get(cacheKey(A)))
  await f.api.beginLogin(A.serverUrl)
  f.native.pollLogin=async()=>({pending:true})
  assert.deepEqual(await f.api.pollLogin('flow-1'),{pending:true})
  const state=await f.api.cancelLogin('flow-1')
  assert.equal(state.connection.username,'a');assert.equal(state.records[0].id,'a')
  assert.deepEqual(f.values.get(cacheKey(A)),previous)
  await assert.rejects(f.api.pollLogin('flow-1'),{code:'CANCELLED'})
})

test('cancellation invalidates a native poll immediately before its account barrier ends',async()=>{
  const f=fixture(),pending=deferred();await f.api.getState();await f.api.beginLogin(A.serverUrl)
  f.native.pollLogin=()=>pending.promise
  const polling=f.api.pollLogin('flow-1');await tick()
  const cancelling=f.api.cancelLogin('flow-1');await tick()
  assert.deepEqual(f.calls.cancel,[{flowId:'flow-1'}])
  pending.reject(Object.assign(new Error('Cancelled'),{code:'CANCELLED'}))
  await assert.rejects(polling,{code:'CANCELLED'})
  assert.equal((await cancelling).connection.username,'a')
})

test('cancellation after native credential commit returns the committed account',async()=>{
  const f=fixture();await f.api.beginLogin(A.serverUrl)
  f.setCurrent(B);f.native.cancelLogin=async()=>({pending:false,account:B})
  assert.equal((await f.api.cancelLogin('flow-1')).connection.username,'b')
})

test('late begin completion after cancellation cannot open a browser or activate a flow',async()=>{
  const f=fixture(),pending=deferred();f.native.beginLogin=()=>pending.promise
  const beginning=f.api.beginLogin(A.serverUrl);await tick();await f.api.cancelLogin()
  pending.resolve({flowId:'late-flow',loginUrl:A.serverUrl+'/login/flow'})
  await assert.rejects(beginning,{code:'CANCELLED'})
  assert.deepEqual(f.calls.open,[]);assert.deepEqual(f.calls.cancel.at(-1),{flowId:'late-flow'})
})

test('unsafe login URL is cancelled before opening external browser',async()=>{
  const f=fixture();f.native.beginLogin=async()=>({flowId:'flow-1',loginUrl:'https://evil.example/login'})
  await assert.rejects(f.api.beginLogin(A.serverUrl),{code:'SECURITY'})
  assert.deepEqual(f.calls.open,[]);assert.deepEqual(f.calls.cancel,[{flowId:'flow-1'}])
})

test('lost host authorization preserves current source cache and requires reconnection',async()=>{
  const f=fixture({isNative:false,hostAvailable:true});await f.api.refresh();f.setCurrent(null)
  const state=await f.api.refresh()
  assert.equal(state.connection.username,'a');assert.equal(state.connection.connected,false);assert.equal(state.connection.reconnectRequired,true)
  assert.equal(state.records[0].id,'a');assert.equal(state.records[0].readonly,true)
  assert.equal(f.values.get(cacheKey(A)).records[0].id,'a')
})

test('saved unauthorized startup restores its real cache without reading sources or opening authorization',async()=>{
  const f=fixture({isNative:false,hostAvailable:true})
  f.values.set(cacheKey(A),{version:1,accountKey:cacheKey(A),records:[{id:'saved',source:'notes',kind:'note',title:'Saved note'}],collections:[],statuses:[]})
  f.native.getAccount=async()=>({account:A,reconnectRequired:true})
  const state=await f.api.getState()
  assert.equal(state.connection.serverUrl,A.serverUrl);assert.equal(state.connection.reconnectRequired,true)
  assert.equal(state.records[0].title,'Saved note');assert.equal(state.records[0].readonly,true)
  await f.api.refresh()
  assert.deepEqual(f.calls.read,[]);assert.deepEqual(f.calls.open,[]);assert.deepEqual(f.calls.poll,[])
})

test('runtime preview expiry preserves source cache and immediately reports reconnect to subscribers',async()=>{
  const f=fixture({isNative:false,hostAvailable:true});await f.api.refresh()
  const saved=structuredClone(f.values.get(cacheKey(A))),published=[]
  f.api.subscribe(value=>published.push(value))
  f.native.getAccount=async()=>{throw Object.assign(new Error('Expired'),{code:'PREVIEW_SESSION_EXPIRED'})}
  const state=await f.api.refresh()
  assert.equal(state.connection.reconnectRequired,true);assert.match(state.connection.restoreError,/preview server restarted/)
  assert.equal(state.records[0].id,'a');assert.equal(state.records[0].readonly,true)
  assert.deepEqual(f.values.get(cacheKey(A)),saved);assert.deepEqual(state.nativeOperations,[])
  assert.equal(published.at(-1).connection.reconnectRequired,true)
})

test('expiry during source reads requires reconnect without purging saved data',async()=>{
  const f=fixture();await f.api.refresh();const saved=structuredClone(f.values.get(cacheKey(A)))
  f.clients.get('a').readAll=async()=>{throw Object.assign(new Error('Expired'),{code:'PREVIEW_SESSION_EXPIRED'})}
  const state=await f.api.refresh()
  assert.equal(state.connection.reconnectRequired,true);assert.equal(state.records[0].id,'a')
  assert.deepEqual(f.values.get(cacheKey(A)),saved)
})

test('same-account Files reauthorization clears reconnect even when source refresh fails',async()=>{
  const f=fixture();await f.api.refresh()
  f.native.getAccount=async()=>({account:A,reconnectRequired:true});await f.api.refresh()
  f.native.selectAccount=async()=>({account:A})
  f.native.getAccount=async()=>({account:A})
  f.clients.get('a').readAll=async()=>{throw new Error('Network unavailable')}
  const state=await f.api.selectAccount()
  assert.equal(state.connection.username,'a');assert.equal(state.connection.reconnectRequired,false)
  assert.equal(state.connection.connected,false);assert.equal(state.records[0].id,'a')
})

test('cancelled Files picker preserves authorization and cache without an extra source refresh',async()=>{
  const f=fixture();await f.api.refresh()
  const saved=structuredClone(f.values.get(cacheKey(A))),before=await f.api.getState(),reads=f.calls.read.length
  f.native.selectAccount=async()=>({account:null})
  await assert.rejects(f.api.selectAccount(),{code:'CANCELLED'})
  assert.deepEqual(await f.api.getState(),before);assert.deepEqual(f.values.get(cacheKey(A)),saved)
  assert.equal(f.calls.read.length,reads)
})

test('unavailable or denied Files picker preserves the previous authorization and cache',async()=>{
  for(const code of ['UNAVAILABLE','PERMISSION']) {
    const f=fixture();await f.api.refresh();const before=await f.api.getState(),saved=structuredClone(f.values.get(cacheKey(A)))
    f.native.selectAccount=async()=>{throw Object.assign(new Error('Picker unavailable'),{code})}
    await assert.rejects(f.api.selectAccount(),{code})
    assert.deepEqual(await f.api.getState(),before);assert.deepEqual(f.values.get(cacheKey(A)),saved)
  }
})

test('cancellation observes a committed same-account reauthorization even with unchanged capabilities',async()=>{
  const f=fixture();await f.api.refresh()
  f.native.getAccount=async()=>({account:A,reconnectRequired:true});await f.api.refresh()
  await f.api.beginLogin(A.serverUrl)
  f.native.cancelLogin=async()=>({pending:false,account:A})
  f.native.getAccount=async()=>({account:A})
  const state=await f.api.cancelLogin('flow-1')
  assert.equal(state.connection.reconnectRequired,undefined);assert.equal(state.connection.connected,true)
  assert.equal(state.records[0].id,'a')
})

test('an older missing-authorization reply cannot overwrite a newer runtime authorization transition',async()=>{
  const f=fixture(),pending=deferred();await f.api.refresh()
  f.native.getAccount=()=>pending.promise
  const refreshing=f.api.refresh();await tick()
  // An independent source request can expire the current generation while the
  // account lookup is in flight; its reconnect message must remain authoritative.
  f.clients.get('a').readNote=async()=>{throw Object.assign(new Error('Expired'),{code:'PREVIEW_SESSION_EXPIRED'})}
  await assert.rejects(f.api.readNote({id:'a'}),{code:'PREVIEW_SESSION_EXPIRED'})
  const current=await f.api.getState()
  pending.resolve({account:A,reconnectRequired:true})
  await refreshing
  assert.deepEqual((await f.api.getState()).connection,current.connection)
})
