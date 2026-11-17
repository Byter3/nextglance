import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {WorkspaceStore,accountScope} from '@nextspace/nextcloud-node/workspace.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
const require=createRequire(import.meta.url)
const {OperationLanes}=require('../win/electron/operation-lanes.cjs')
const {reconcileRefreshedCache}=require('../win/electron/security.cjs')
const clone=value=>structuredClone(value)
const gate=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release}}
const promptly=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Local operation waited for network sync')),1000))])}finally{clearTimeout(timer)}}
async function device(t){const dataDir=await mkdtemp(join(tmpdir(),'nextspace-background-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));return WorkspaceStore.open({dataDir,scope:accountScope('https://fixture.invalid','user'),initialState:{workspace:createPlannerWorkspace(),records:[],collections:[],statuses:[]}})}
function cloud(){let data=null,version=0;return {readWorkspace:async()=>({workspace:clone(data),etag:data?`"${version}"`:null}),writeWorkspace:async(workspace,etag)=>{assert.equal(etag,data?`"${version}"`:null);data=clone(workspace);return {etag:`"${++version}"`}},mutate:fn=>{fn(data);version++},data:()=>clone(data)}}
async function change(store,mutate){const current=store.snapshot();mutate(current.workspace);return store.saveWorkspace(current.workspace,current.revision)}

test('local metadata and source commits complete while cloud reads are held; final merge retains both',async t=>{
  const store=await device(t),remote=cloud();await store.syncWith(remote)
  remote.mutate(workspace=>workspace.properties.remote={value:'Other PC'})
  const entered=gate(),hold=gate(),read=remote.readWorkspace
  remote.readWorkspace=async()=>{const snapshot=await read();entered.release();await hold.promise;return snapshot}
  const sync=store.syncWith(remote);await entered.promise
  await promptly(change(store,workspace=>workspace.properties.local={value:'Typed during sync'}))
  await promptly(store.updateCache(cache=>({...cache,records:[{id:'source-task',source:'tasks',kind:'task',title:'Latest source edit',identity:{source:'tasks',key:'native-task'}}]})))
  hold.release();await sync
  assert.equal(store.snapshot().workspace.properties.local.value,'Typed during sync')
  assert.equal(store.snapshot().workspace.properties.remote.value,'Other PC')
  assert.equal(store.snapshot().cache.records[0].title,'Latest source edit')
  assert.equal(store.storage().syncStatus,'pending')
  remote.readWorkspace=read;await store.syncWith(remote)
  assert.equal(remote.data().properties.local.value,'Typed during sync');assert.equal(store.storage().syncStatus,'synced')
})

test('an edit during a held cloud upload remains pending and uploads in the next cycle',async t=>{
  const store=await device(t),remote=cloud();await store.syncWith(remote)
  await change(store,workspace=>workspace.properties.first={value:1})
  const entered=gate(),hold=gate(),write=remote.writeWorkspace
  remote.writeWorkspace=async(...args)=>{entered.release();await hold.promise;return write(...args)}
  const sync=store.syncWith(remote);await entered.promise
  await promptly(change(store,workspace=>workspace.properties.second={value:2}))
  hold.release();await sync
  assert.equal(store.snapshot().workspace.properties.second.value,2)
  assert.equal(remote.data().properties.second,undefined)
  assert.equal(store.storage().syncStatus,'pending')
  remote.writeWorkspace=write;await store.syncWith(remote)
  assert.equal(remote.data().properties.second.value,2)
})

test('late network failure preserves the newer workspace and cache',async t=>{
  const store=await device(t),remote=cloud();await store.syncWith(remote)
  const entered=gate(),hold=gate()
  remote.readWorkspace=async()=>{entered.release();await hold.promise;throw Error('offline')}
  const sync=store.syncWith(remote);await entered.promise
  await promptly(change(store,workspace=>workspace.name='Newest local name'))
  const revision=store.snapshot().revision
  hold.release();await sync
  assert.equal(store.snapshot().workspace.name,'Newest local name');assert.equal(store.snapshot().revision,revision)
  assert.equal(store.storage().syncStatus,'error')
})

test('overlapping local and remote edits during sync keep both copies as an explicit conflict',async t=>{
  const store=await device(t),remote=cloud();await store.syncWith(remote)
  remote.mutate(workspace=>workspace.name='Remote name')
  const entered=gate(),hold=gate(),read=remote.readWorkspace
  remote.readWorkspace=async()=>{const value=await read();entered.release();await hold.promise;return value}
  const sync=store.syncWith(remote);await entered.promise
  await promptly(change(store,workspace=>workspace.name='Local name'))
  hold.release();await sync
  assert.equal(store.snapshot().workspace.name,'Local name')
  assert.equal(store.snapshot().sync.conflictWorkspace.name,'Remote name')
  assert.equal(store.storage().syncStatus,'conflict')
})

test('IPC background reads do not block native mutations or local saves',async()=>{
  const lanes=new OperationLanes(),hold=gate(),entered=gate(),calls=[]
  const background=lanes.run(async()=>{entered.release();await hold.promise;calls.push('refresh')},{parallel:true});await entered.promise
  await promptly(lanes.run(async()=>calls.push('native')))
  await promptly(lanes.run(async()=>calls.push('local'),{parallel:true}))
  assert.deepEqual(calls,['native','local']);hold.release();await background
})

test('account switches wait for old background work and gate later operations',async()=>{
  const lanes=new OperationLanes(),hold=gate(),entered=gate(),calls=[]
  const first=lanes.run(async()=>{entered.release();await hold.promise;calls.push('old account')},{parallel:true});await entered.promise
  const change=lanes.run(async()=>calls.push('switch'),{contextChange:true})
  const later=lanes.run(async()=>calls.push('new account'),{parallel:true})
  await new Promise(resolve=>setTimeout(resolve,15));assert.deepEqual(calls,[])
  hold.release();await Promise.all([first,change,later]);assert.deepEqual(calls,['old account','switch','new account'])
})

test('native mutation order is kept even when unrelated reads run beside it',async()=>{
  const lanes=new OperationLanes(),hold=gate(),calls=[]
  const first=lanes.run(async()=>{await hold.promise;calls.push(1)})
  const second=lanes.run(async()=>calls.push(2))
  await promptly(lanes.run(async()=>calls.push('read'),{parallel:true}))
  assert.deepEqual(calls,['read']);hold.release();await Promise.all([first,second]);assert.deepEqual(calls,['read',1,2])
})

const item=(id,title=id)=>({id,source:'tasks',kind:'task',title,collectionId:'list',identity:{key:id}})
const cache=records=>({records,collections:[{id:'list',source:'tasks'}],statuses:[{source:'tasks',state:'connected',count:records.length}]})
test('refresh merges untouched remote updates while protecting locally edited and newly created items',()=>{
  const before=cache([item('edited'),item('remote'),item('deleted')])
  const current=cache([item('edited','Local newer'),item('remote'),item('deleted'),item('created')])
  const incoming=cache([item('edited','Stale remote'),item('remote','Remote newer')])
  const result=reconcileRefreshedCache(before,current,incoming,['tasks']).cache
  assert.deepEqual(result.records.map(record=>[record.id,record.title]),[['edited','Local newer'],['remote','Remote newer'],['created','created']])
  assert.equal(result.statuses[0].count,3)
})

test('permission revocation wins over edits made while refresh was running',()=>{
  const before=cache([item('edited')]),current=cache([item('edited','Local newer'),item('created')])
  for(const denied of [{permissionDenied:true},{revokedCollectionIds:['list']}]){
    const incoming={records:[],collections:[],statuses:[{source:'tasks',state:'error',...denied}]}
    const result=reconcileRefreshedCache(before,current,incoming,['tasks'])
    assert.deepEqual(result.cache.records,[]);assert.deepEqual(result.cache.collections,[]);assert.equal(result.purgeBackup,true)
  }
})

test('canonical cloud UUID adoption retains account-local aliases for native edits already in flight',async t=>{
  const store=await device(t),remote=cloud()
  await store.updateCache(cache([item('native-task')]))
  const oldId=store.snapshot().cache.records[0].id
  await store.syncWith(remote)
  const canonical=randomUUID()
  remote.mutate(workspace=>workspace.identities.find(identity=>identity.id===oldId).id=canonical)
  await store.syncWith(remote)
  assert.equal(store.snapshot().cache.records[0].id,canonical)
  assert.equal(store.resolveRecordId(oldId),canonical)
  assert.deepEqual(store.recordIdAliases(),{[oldId]:canonical})
  assert.equal(store.resolveRecordId('unrelated-id'),'unrelated-id')
  // A native write holding the original record id can update only that same
  // native identity after the background registry commit.
  await store.updateCache(current=>({...current,records:current.records.map(record=>record.id===store.resolveRecordId(oldId)?{...record,title:'Saved after canonical merge'}:record)}))
  assert.equal(store.snapshot().cache.records[0].title,'Saved after canonical merge')
  const newer=randomUUID()
  remote.mutate(workspace=>workspace.identities.find(identity=>identity.id===canonical).id=newer)
  await store.syncWith(remote)
  assert.equal(store.resolveRecordId(oldId),newer);assert.equal(store.resolveRecordId(canonical),newer)
  assert.deepEqual(store.recordIdAliases(),{[oldId]:newer,[canonical]:newer})
  const reopened=await WorkspaceStore.open({dataDir:join(store.directory,'../..'),scope:store.scope,initialState:{workspace:createPlannerWorkspace(),records:[],collections:[],statuses:[]}})
  assert.deepEqual(reopened.recordIdAliases(),{},'Session aliases never leak into other accounts or persisted planner metadata')
})
