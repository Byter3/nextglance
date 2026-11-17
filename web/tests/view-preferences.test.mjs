import test from 'node:test'
import assert from 'node:assert/strict'
import {createWebController} from '../src/session-controller.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'

const serverUrl='https://cloud.example.test/cloud',sessionUrl=`${serverUrl}/apps/nextglance/session`
const preferences={format:'nextspace-view-preferences',version:1,scopes:{}}
const clone=value=>structuredClone(value)
const deferred=()=>{let resolve;const promise=new Promise(value=>{resolve=value});return {promise,resolve}}
function fixture({read=async()=>({preferences,etag:'"filters-1"'}),save=async input=>({preferences:input.preferences,etag:'"filters-2"'})}={}) {
  let user='example-user',sourceReads=0,reads=0,writes=0
  const workspace=createPlannerWorkspace()
  const native={readAll:async()=>{sourceReads++;return {records:[],collections:[],statuses:[]}}}
  const api=createWebController({origin:'https://cloud.example.test',sessionUrl,requestToken:()=> 'fixture-token',
    fetch:async()=>new Response(JSON.stringify({appId:'nextglance',appVersion:'0.6.15',userId:user,serverUrl,basePath:'/cloud',sessionUrl}),{headers:{'Content-Type':'application/json'}}),
    createClient:()=>native,
    createFolder:()=>({readWorkspace:async()=>({workspace:clone(workspace),etag:'"planner-1"'}),writeWorkspace:async()=>assert.fail('Preferences must not write organization')}),
    createViewPreferences:client=>{assert.equal(client,native);return {read:async()=>{reads++;return read()},save:async input=>{writes++;return save(input)}}},
  })
  return {api,get sourceReads(){return sourceReads},get reads(){return reads},get writes(){return writes},changeAccount(){user='another-user'}}
}

test('Web preference operations use the session client and return isolated in-memory values',async t=>{
  const received=[],f=fixture({save:async input=>{received.push(input);return {preferences:input.preferences,etag:'"filters-2"'}}})
  t.after(()=>f.api.dispose())
  const first=await f.api.getViewPreferences()
  assert.deepEqual(first,{preferences,etag:'"filters-1"'})
  first.preferences.scopes.changed={pages:{}}
  assert.deepEqual((await f.api.getViewPreferences()).preferences,preferences)
  const input={base:clone(preferences),preferences:clone(preferences),etag:'"filters-1"'},pending=f.api.saveViewPreferences(input)
  input.preferences.scopes.changed={pages:{}}
  assert.deepEqual(await pending,{preferences,etag:'"filters-2"'})
  assert.deepEqual(received,[{base:preferences,preferences,etag:'"filters-1"'}])
})

test('an unreadable preference file stays an isolated error and never blocks source refresh',async t=>{
  const f=fixture({read:async()=>{throw Object.assign(new Error('Invalid saved filters'),{code:'FORMAT'})}})
  t.after(()=>f.api.dispose())
  const before=await f.api.refresh()
  await assert.rejects(f.api.getViewPreferences(),{code:'FORMAT'})
  const after=await f.api.refresh()
  assert.equal(f.sourceReads,2)
  assert.equal(after.storage.syncStatus,'synced')
  assert.deepEqual(after.workspace,before.workspace)
  assert.equal(f.api.getHostState().phase,'ready')
  assert.equal(f.writes,0)
})

test('offline filters never form an outbox and reconnect does not replay an unsent save',async t=>{
  const f=fixture();t.after(()=>f.api.dispose())
  await f.api.getViewPreferences();await f.api.setOnline(false)
  await assert.rejects(f.api.saveViewPreferences({base:preferences,preferences,etag:'"filters-1"'}),{code:'OFFLINE'})
  assert.equal(f.writes,0)
  await f.api.setOnline(true)
  assert.equal(f.writes,0)
  assert.equal((await f.api.getViewPreferences()).etag,'"filters-1"')
})

test('account change fences late preference reads before returning private saved filters',async t=>{
  const entered=deferred(),release=deferred(),f=fixture({read:async()=>{entered.resolve();await release.promise;return {preferences,etag:'"filters-1"'}}})
  t.after(()=>f.api.dispose())
  const pending=f.api.getViewPreferences();await entered.promise
  f.changeAccount();await assert.rejects(f.api.syncWorkspace(),{code:'AUTH'})
  release.resolve();await assert.rejects(pending,{code:'CANCELLED'})
  assert.equal(f.api.getHostState().phase,'expired')
  assert.equal(f.writes,0)
})

test('expiry rejects queued preference saves without sending them under another account',async t=>{
  const entered=deferred(),release=deferred(),f=fixture({save:async input=>{entered.resolve();await release.promise;return {preferences:input.preferences,etag:'"filters-2"'}}})
  t.after(()=>f.api.dispose())
  await f.api.getViewPreferences()
  const input={base:preferences,preferences,etag:'"filters-1"'}
  const first=f.api.saveViewPreferences(input),second=f.api.saveViewPreferences(input)
  const outcomes=Promise.allSettled([first,second])
  await entered.promise;f.changeAccount();await assert.rejects(f.api.syncWorkspace(),{code:'AUTH'})
  release.resolve()
  for(const outcome of await outcomes){assert.equal(outcome.status,'rejected');assert.equal(outcome.reason.code,'CANCELLED')}
  assert.equal(f.writes,1,'Only the already-issued original-account write may reach its server')
})
