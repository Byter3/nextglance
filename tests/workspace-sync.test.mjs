import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkspaceStore, accountScope} from '@nextspace/nextcloud-node/workspace.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {mergeWorkspaces} from '@nextspace/core/workspace-merge.mjs'

const clone = value => structuredClone(value)
const scope = accountScope('https://fixture.invalid', 'same-user')
const initialState = () => ({workspace:createPlannerWorkspace(),records:[],collections:[],statuses:[]})
async function device(t) {
  const dataDir=await mkdtemp(join(tmpdir(),'nextspace-multi-pc-'))
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  return {dataDir,store:await WorkspaceStore.open({dataDir,scope,initialState:initialState()})}
}
function cloud() {
  let data=null,version=0
  const writes=[]
  return {
    writes,
    readWorkspace:async()=>({workspace:clone(data),etag:data?`"${version}"`:null}),
    writeWorkspace:async(value,etag)=>{
      if(etag!==(data?`"${version}"`:null))throw Object.assign(Error('race'),{code:'CONFLICT'})
      data=clone(value);version++;writes.push(clone(value));return {etag:`"${version}"`}
    },
    mutate:change=>{data=change(clone(data));version++},
    data:()=>clone(data),
  }
}
async function change(store,callback) {const value=store.snapshot();callback(value.workspace);return store.saveWorkspace(value.workspace,value.revision)}
const nativeRecord=(id,key,source='tasks')=>({id,source,kind:source==='notes'?'note':'task',title:key,identity:{source,key,aliases:[`${source}:${key}`]}})
const cache=records=>({records,collections:[],statuses:[]})

test('another PC receives all custom organization, links, attributes, plans, appearance and status mappings',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await a.store.updateCache(cache([nativeRecord('native:task','task'),nativeRecord('native:note','note','notes')]))
  const [task,note]=a.store.snapshot().cache.records
  await change(a.store,w=>{
    w.spaces=[{id:'work',name:'Work',color:'#123456',collectionIds:['tasks','calendar','deck']}]
    w.categories=[{id:'freelance',spaceId:'work',name:'Freelance',color:'#654321',collectionIds:['tasks','deck']}]
    w.projects=[{id:'film',spaceId:'work',categoryId:'freelance',name:'Film',recordIds:[task.id],collectionIds:[]}]
    w.relations=[{id:'brief',type:'reference',fromId:task.id,toId:note.id}]
    w.plans=[{id:'session',recordId:task.id,start:'2026-11-10T09:00:00Z',end:'2026-11-10T10:00:00Z'}]
    w.properties[task.id]={estimate:45,color:'#abcdef',tagColors:{Review:'#123456'}}
    w.appearance={mode:'dark',calendarColors:{calendar:'#234567'}}
    w.planner.workflow[task.id]='planned'
    w.planner.statusMapping={columns:[{id:'queued',title:'Queued',color:'#123456'}],assignments:{'["tasks","tasks","NEEDS-ACTION"]':'queued'}}
  })
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'synced')
  assert.deepEqual(b.store.snapshot().workspace,a.store.snapshot().workspace)
  const reopened=await WorkspaceStore.open({dataDir:b.dataDir,scope,initialState:initialState()})
  assert.deepEqual(reopened.snapshot().workspace.properties[task.id],{estimate:45,color:'#abcdef',tagColors:{Review:'#123456'}})
  assert.deepEqual(reopened.snapshot().sync.baseWorkspace,remote.data())
  assert.equal(remote.data().cache,undefined)
})

test('first sync rebases independently read item UUIDs and keeps local view preferences without losing cloud links',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  const records=[nativeRecord('native:task','task'),nativeRecord('native:note','note','notes')]
  await a.store.updateCache(cache(records));await b.store.updateCache(cache(records))
  const [aTask,aNote]=a.store.snapshot().cache.records,[bTask]=b.store.snapshot().cache.records
  assert.notEqual(aTask.id,bTask.id)
  await change(a.store,w=>{w.relations=[{id:'note-link',type:'reference',fromId:aTask.id,toId:aNote.id}];w.properties[aTask.id]={estimate:30}})
  await a.store.syncWith(remote)
  await change(b.store,w=>{w.planner.view='board';w.planner.showCompleted=true})
  await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'synced')
  assert.equal(b.store.snapshot().cache.records[0].id,aTask.id)
  assert.deepEqual(b.store.snapshot().workspace.relations,remote.data().relations)
  assert.equal(b.store.snapshot().workspace.planner.view,'board')
  assert.equal(b.store.snapshot().workspace.properties[aTask.id].estimate,30)
  assert.equal(b.store.snapshot().workspace.properties[bTask.id],undefined)
})

test('independent offline links and custom attributes merge across PCs and survive restart',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  await change(a.store,w=>{w.relations.push({id:'work-note',type:'reference',fromId:'task',toId:'note'})})
  await change(b.store,w=>{w.properties.task={estimate:60,tags:['Review']}})
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'synced')
  assert.equal(remote.data().relations.length,1)
  assert.equal(remote.data().properties.task.estimate,60)
  const reopened=await WorkspaceStore.open({dataDir:a.dataDir,scope,initialState:initialState()})
  await reopened.syncWith(remote)
  assert.equal(reopened.snapshot().workspace.properties.task.estimate,60)
  assert.deepEqual(reopened.snapshot().workspace.relations,remote.data().relations)
})

test('deleting a link on one PC is not undone by unrelated edits on another',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await change(a.store,w=>{w.relations=[{id:'remove-me',type:'reference',fromId:'task',toId:'note'}]})
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  await change(a.store,w=>{w.relations=[]})
  await change(b.store,w=>{w.properties.task={tagColors:{Later:'#ffff00'}}})
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'synced')
  assert.deepEqual(remote.data().relations,[])
  assert.equal(remote.data().properties.task.tagColors.Later,'#ffff00')
})

test('same-field conflicts preserve local edits, the cloud copy and the validated merge baseline',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  await change(a.store,w=>{w.name='Studio A'})
  await change(b.store,w=>{w.name='Studio B'})
  const before=b.store.snapshot()
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'conflict')
  assert.equal(b.store.snapshot().workspace.name,'Studio B')
  assert.equal(remote.data().name,'Studio A')
  assert.equal(b.store.snapshot().sync.conflictWorkspace.name,'Studio A')
  assert.equal(b.store.snapshot().revision,before.revision)
  assert.deepEqual(b.store.snapshot().sync.baseWorkspace,before.sync.baseWorkspace)
  assert.equal(JSON.parse(await readFile(b.store.path,'utf8')).workspace.name,'Studio B')
})

test('a conditional PUT race re-reads and merges the new server changes instead of overwriting',async t=>{
  const {store}=await device(t),remote=cloud()
  await store.syncWith(remote)
  await change(store,w=>{w.properties.local={estimate:10}})
  let raced=false,attempts=0
  const client={readWorkspace:remote.readWorkspace,writeWorkspace:async(value,etag)=>{
    attempts++
    if(!raced){raced=true;remote.mutate(w=>{w.properties.remote={estimate:20};return w})}
    return remote.writeWorkspace(value,etag)
  }}
  await store.syncWith(client)
  assert.equal(attempts,2)
  assert.equal(store.storage().syncStatus,'synced')
  assert.deepEqual(remote.data().properties,{local:{estimate:10},remote:{estimate:20}})
})

test('a failed merged upload does not replace the local workspace or remap cached records prematurely',async t=>{
  const {store}=await device(t),remote=cloud()
  await store.syncWith(remote)
  await change(store,w=>{w.properties.local={value:'keep'}})
  remote.mutate(w=>{w.properties.remote={value:'not acknowledged yet'};return w})
  const before=store.snapshot()
  await store.syncWith({readWorkspace:remote.readWorkspace,writeWorkspace:async()=>{throw Error('offline')}})
  assert.equal(store.storage().syncStatus,'error')
  assert.deepEqual(store.snapshot().workspace,before.workspace)
  assert.deepEqual(store.snapshot().cache,before.cache)
  assert.equal(store.snapshot().revision,before.revision)
})

test('older envelopes without a base remain readable and never guess at simultaneous custom changes',async t=>{
  const {store,dataDir}=await device(t),remote=cloud()
  await store.syncWith(remote)
  const old=store.snapshot();delete old.sync.baseWorkspace;delete old.sync.initialWorkspace
  await writeFile(store.path,JSON.stringify(old))
  const reopened=await WorkspaceStore.open({dataDir,scope,initialState:initialState()})
  await change(reopened,w=>{w.properties.local={value:'keep'}})
  remote.mutate(w=>{w.properties.remote={value:'keep too'};return w})
  await reopened.syncWith(remote)
  assert.equal(reopened.storage().syncStatus,'conflict')
  assert.equal(reopened.snapshot().workspace.properties.local.value,'keep')
  assert.equal(remote.data().properties.remote.value,'keep too')
})

test('first sync protects customized legacy migration even when its initial hash matches',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'nextspace-legacy-sync-'))
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  const directory=join(dataDir,'workspaces',scope)
  await mkdir(directory,{recursive:true})
  const workspace=createPlannerWorkspace()
  workspace.properties.task={estimate:60,legacyNote:'Unsynced old PC'}
  workspace.relations=[{id:'legacy-link',type:'reference',fromId:'task',toId:'note'}]
  await writeFile(join(directory,'workspace.json'),JSON.stringify({schemaVersion:1,revision:4,workspace,cache:cache([])}))
  const store=await WorkspaceStore.open({dataDir,scope,initialState:initialState()})
  const before=store.snapshot(),remote=cloud()
  const published=createPlannerWorkspace();published.properties.other={estimate:30}
  await remote.writeWorkspace(published,null)
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'conflict')
  assert.deepEqual(store.snapshot().workspace,before.workspace)
  assert.equal(store.snapshot().revision,before.revision)
  assert.deepEqual(store.snapshot().sync.conflictWorkspace,published)
  assert.deepEqual(remote.data(),published)
  assert.equal(remote.writes.length,1)
})

test('device navigation does not conflict with shared changes or cause revision/upload ping-pong',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  await change(a.store,w=>{w.planner.view='board';w.planner.showCompleted=true;w.planner.showCompletedByView={board:true,calendar:false};w.properties.task={estimate:45}})
  await change(b.store,w=>{w.planner.view='calendar';w.planner.assignment='me';w.planner.showCompletedByView={board:false,calendar:true};w.relations=[{id:'note-link',type:'reference',fromId:'task',toId:'note'}]})
  await a.store.syncWith(remote);await b.store.syncWith(remote);await a.store.syncWith(remote)
  assert.equal(a.store.storage().syncStatus,'synced');assert.equal(b.store.storage().syncStatus,'synced')
  assert.equal(a.store.snapshot().workspace.planner.view,'board')
  assert.equal(a.store.snapshot().workspace.planner.showCompleted,true)
  assert.equal(b.store.snapshot().workspace.planner.view,'calendar')
  assert.equal(b.store.snapshot().workspace.planner.assignment,'me')
  assert.deepEqual(a.store.snapshot().workspace.planner.showCompletedByView,{board:true,calendar:false})
  assert.deepEqual(b.store.snapshot().workspace.planner.showCompletedByView,{board:false,calendar:true})
  assert.equal(remote.data().properties.task.estimate,45)
  assert.equal(remote.data().relations[0].id,'note-link')
  const revisions=[a.store.snapshot().revision,b.store.snapshot().revision],writes=remote.writes.length
  const published=remote.data()
  for(let i=0;i<4;i++){await b.store.syncWith(remote);await a.store.syncWith(remote)}
  assert.deepEqual([a.store.snapshot().revision,b.store.snapshot().revision],revisions)
  assert.equal(remote.writes.length,writes)
  assert.deepEqual(a.store.snapshot().sync.baseWorkspace,published)
  assert.deepEqual(b.store.snapshot().sync.baseWorkspace,published)
  await change(a.store,w=>{w.planner.view='list';w.planner.showCompletedByView.list=true})
  const saved=a.store.snapshot()
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.equal(a.store.snapshot().revision,saved.revision)
  assert.equal(a.store.snapshot().workspace.updatedAt,saved.workspace.updatedAt)
  assert.equal(remote.writes.length,writes)
  assert.equal(a.store.snapshot().workspace.planner.view,'list')
  assert.equal(b.store.snapshot().workspace.planner.view,'calendar')
  assert.deepEqual(a.store.snapshot().workspace.planner.showCompletedByView,{board:true,calendar:false,list:true})
  assert.deepEqual(b.store.snapshot().workspace.planner.showCompletedByView,{board:false,calendar:true})
  const restarted=await WorkspaceStore.open({dataDir:a.dataDir,scope,initialState:initialState()})
  assert.deepEqual(restarted.snapshot().workspace.planner.showCompletedByView,{board:true,calendar:false,list:true},'Every layout preference survives restart')
})

test('ordinary three-way merge keeps current-device view fields while combining substantive planner settings',()=>{
  const base=createPlannerWorkspace(),local=clone(base),remote=clone(base)
  local.planner.view='board';local.planner.scopeId='personal';local.properties.task={estimate:60}
  remote.planner.view='calendar';remote.planner.scopeId='freelance';remote.relations=[{id:'note-link',type:'reference',fromId:'task',toId:'note'}]
  remote.planner.statusMapping={columns:[{id:'ready',title:'Ready',color:'#abcdef'}],assignments:{rule:'ready'}}
  const merged=mergeWorkspaces(base,local,remote)
  assert.deepEqual(merged.conflicts,[])
  assert.equal(merged.workspace.planner.view,'board')
  assert.equal(merged.workspace.planner.scopeId,'personal')
  assert.equal(merged.workspace.properties.task.estimate,60)
  assert.equal(merged.workspace.relations[0].id,'note-link')
  assert.deepEqual(merged.workspace.planner.statusMapping,remote.planner.statusMapping)
})

test('independently discovered moved-or-copied UID aliases require review instead of orphaning metadata',()=>{
  const base=createPlannerWorkspace(),local=clone(base),remote=clone(base)
  local.identities=[{id:'local-event',source:'calendar',key:'calendar-A:event-UID',aliases:['uid:event-UID']}]
  local.properties['local-event']={estimate:60}
  remote.identities=[{id:'remote-event',source:'calendar',key:'calendar-B:event-UID',aliases:['uid:event-UID']}]
  remote.relations=[{id:'note-link',type:'reference',fromId:'remote-event',toId:'note'}]
  let merged=mergeWorkspaces(base,local,remote)
  assert.ok(merged.conflicts.includes('identities[local-event].alias'))
  assert.equal(local.properties['local-event'].estimate,60)
  assert.equal(remote.relations[0].fromId,'remote-event')
  // Once the baseline establishes both records as separate, sharing a UID is
  // legitimate (for example copied events in two calendars).
  base.identities=[...clone(local.identities),...clone(remote.identities)]
  local.identities=clone(base.identities);remote.identities=clone(base.identities)
  merged=mergeWorkspaces(base,local,remote)
  assert.deepEqual(merged.conflicts,[])
})

test('ordered status columns and assignment maps merge independent changes, but detect competing reorders',()=>{
  const base=createPlannerWorkspace()
  base.planner.statusMapping={columns:[{id:'a',title:'To do',color:'#123456'},{id:'b',title:'Doing',color:'#234567'},{id:'c',title:'Done',color:'#345678'}],assignments:{one:'a'}}
  const local=clone(base),remote=clone(base)
  local.planner.statusMapping.columns[0].title='Ready'
  remote.planner.statusMapping.assignments.two='b'
  let merged=mergeWorkspaces(base,local,remote)
  assert.deepEqual(merged.conflicts,[])
  assert.equal(merged.workspace.planner.statusMapping.columns[0].title,'Ready')
  assert.equal(merged.workspace.planner.statusMapping.assignments.two,'b')
  local.planner.statusMapping.columns.reverse()
  remote.planner.statusMapping.columns=[remote.planner.statusMapping.columns[1],remote.planner.statusMapping.columns[0],remote.planner.statusMapping.columns[2]]
  merged=mergeWorkspaces(base,local,remote)
  assert.ok(merged.conflicts.includes('planner.statusMapping.columns.order'))
})

test('deletion versus edit is flagged, while independent membership changes and duplicate links merge',()=>{
  const base=createPlannerWorkspace()
  base.spaces=[{id:'space',name:'Work',color:'#123456',collectionIds:['one','two']}]
  const local=clone(base),remote=clone(base)
  local.spaces[0].collectionIds=['two','three'];remote.spaces[0].collectionIds.push('four')
  local.relations=[{id:'a',type:'reference',fromId:'task',toId:'note'}]
  remote.relations=[{id:'b',type:'reference',fromId:'task',toId:'note'}]
  let merged=mergeWorkspaces(base,local,remote)
  assert.deepEqual(merged.conflicts,[])
  assert.deepEqual(merged.workspace.spaces[0].collectionIds,['two','three','four'])
  assert.equal(merged.workspace.relations.length,1)
  local.spaces=[];remote.spaces[0].name='Updated remotely'
  merged=mergeWorkspaces(base,local,remote)
  assert.ok(merged.conflicts.includes('spaces[space]'))
})
