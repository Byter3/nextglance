import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {mergeBackgroundState,reuseUnchangedState} from '@nextspace/core/background-state.mjs'

const copy=value=>structuredClone(value)
function fixture(){
  const before=createEmptyState()
  before.connection={serverUrl:'https://fixture.invalid',username:'user',connected:true};before.revision=1
  before.statuses=[{source:'tasks',state:'connected'},{source:'deck',state:'connected'}]
  before.workspace.identities=[{id:'local-task',source:'tasks',key:'tasks:one'},{id:'local-card',source:'deck',key:'deck:two'}]
  before.records=[{id:'local-task',source:'tasks',kind:'task',title:'Task',body:'Acknowledged',collectionId:'list',nativeDependencies:['local-card'],nativeRelatedIds:['local-card','unmapped-native-id']},{id:'local-card',source:'deck',kind:'card',title:'Card',collectionId:'board',nativeDependents:['local-task']}]
  before.workspace.properties['local-task']={estimate:45}
  before.workspace.relations=[{id:'edge',type:'depends_on',fromId:'local-task',toId:'local-card'}]
  const current=copy(before);current.revision=2
  const incoming=copy(before);incoming.revision=3
  incoming.workspace.identities=[{id:'cloud-task',source:'tasks',key:'tasks:one'},{id:'cloud-card',source:'deck',key:'deck:two'}]
  incoming.workspace.properties={'cloud-task':{estimate:45}}
  incoming.workspace.relations=[{id:'edge',type:'depends_on',fromId:'cloud-task',toId:'cloud-card'}]
  incoming.records=[{...copy(before.records[0]),id:'cloud-task',nativeDependencies:['cloud-card'],nativeRelatedIds:['cloud-card','unmapped-native-id']},{...copy(before.records[1]),id:'cloud-card',nativeDependents:['cloud-task']}]
  return {before,current,incoming}
}

test('background identity adoption preserves a pending native draft under one canonical ID',()=>{
  const {before,current,incoming}=fixture()
  incoming.recordIdAliases={'local-task':'intermediate-task','intermediate-task':'cloud-task','local-card':'cloud-card'}
  current.records[0].body='Unacknowledged description'
  const inputs=copy({before,current,incoming})
  const result=mergeBackgroundState(before,current,incoming,['local-task'])
  assert.deepEqual(result.conflicts,[])
  assert.deepEqual(result.state.records.map(record=>record.id),['cloud-task','cloud-card'])
  assert.equal(result.state.records[0].body,'Unacknowledged description')
  assert.deepEqual(result.state.records[0].nativeDependencies,['cloud-card'])
  assert.deepEqual(result.state.records[0].nativeRelatedIds,['cloud-card','unmapped-native-id'])
  assert.deepEqual(result.state.records[1].nativeDependents,['cloud-task'])
  assert.equal(result.state.recordIdAliases['local-task'],'cloud-task')
  assert.equal(result.state.recordIdAliases['intermediate-task'],'cloud-task')
  assert.equal(result.state.workspace.properties['cloud-task'].estimate,45)
  assert.equal(result.state.workspace.relations[0].fromId,'cloud-task')
  assert.deepEqual({before,current,incoming},inputs,'Merging must not mutate any caller snapshot')
})

test('source/key registry matching remaps changed records without an explicit bridge alias map',()=>{
  const {before,current,incoming}=fixture()
  current.records[0].title='Locally acknowledged new title'
  const result=mergeBackgroundState(before,current,incoming)
  assert.equal(result.state.records.length,2)
  assert.equal(result.state.records[0].title,'Locally acknowledged new title')
  assert.equal(result.state.records[0].id,'cloud-task')
  assert.equal(result.state.recordIdAliases['local-task'],'cloud-task','Queue callbacks can still resolve the old UUID after adoption')
})

test('canonical and old-ID duplicates collapse while a protected old-ID draft wins',()=>{
  const {before,current,incoming}=fixture()
  current.records[0].body='Pending edit'
  current.records.push({...incoming.records[0],body:'Earlier canonical snapshot'})
  incoming.records.push(copy(before.records[0]))
  const result=mergeBackgroundState(before,current,incoming,['local-task'])
  assert.deepEqual(result.state.records.map(record=>record.id),['cloud-task','cloud-card'])
  assert.equal(result.state.records[0].body,'Pending edit')
})

test('stale background replies cannot replace newer metadata, permissions or aliases',()=>{
  const {before,current,incoming}=fixture()
  incoming.revision=1;incoming.statuses[0].state='error';incoming.recordIdAliases={'local-task':'cloud-task'}
  current.storage.syncStatus='pending';current.workspace.properties.new={value:1}
  const result=mergeBackgroundState(before,current,incoming,['local-task'])
  assert.deepEqual(result,{state:current,conflicts:[]})
})

test('confirmed permission revocation removes protected records after canonical identity remapping',()=>{
  const {before,current,incoming}=fixture()
  current.records[0].body='Protected but now unauthorized';current.records[1].title='Protected revoked board'
  incoming.statuses=[{source:'tasks',state:'error',permissionDenied:true},{source:'deck',state:'error',revokedCollectionIds:['board']}]
  incoming.records=[]
  const result=mergeBackgroundState(before,current,incoming,['local-task','local-card'])
  assert.deepEqual(result.state.records,[],'Protected edits cannot retain source content after confirmed access revocation')
})

test('background refresh adopts unchanged source records while retaining protected missing drafts',()=>{
  const {before,current,incoming}=fixture()
  incoming.records[0].body='Fresh cloud description'
  assert.equal(mergeBackgroundState(before,current,incoming).state.records[0].body,'Fresh cloud description')
  incoming.records=incoming.records.filter(record=>record.id!=='cloud-task')
  current.records[0].body='Retryable description draft'
  const result=mergeBackgroundState(before,current,incoming,['local-task'])
  assert.equal(result.state.records.filter(record=>record.id==='cloud-task').length,1)
  assert.equal(result.state.records.find(record=>record.id==='cloud-task').body,'Retryable description draft')
})

test('background replies from another account do not carry records or aliases across accounts',()=>{
  const {before,current,incoming}=fixture()
  incoming.connection.username='another-user';incoming.recordIdAliases={'local-task':'cloud-task'}
  assert.deepEqual(mergeBackgroundState(before,current,incoming),{state:current,conflicts:[]})
})

test('an already detached host baseline can be reused without another library clone',()=>{
  const {before,current,incoming}=fixture()
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
  freeze(before)
  current.records[0].body='Pending local edit'
  const first=mergeBackgroundState(before,current,incoming,['local-task'],{reuseUnchanged:true})
  incoming.records[1].body='Later cloud update'
  const second=mergeBackgroundState(before,first.state,incoming,['cloud-task'],{reuseUnchanged:true})
  assert.equal(second.state.records.find(record=>record.id==='cloud-task').body,'Pending local edit')
  assert.equal(second.state.records.find(record=>record.id==='cloud-card').body,'Later cloud update')
  assert.equal(before.records[0].body,'Acknowledged','Immutable baseline still identifies the original acknowledged edit')
  assert.equal(before.records[1].body,undefined)
  assert.equal(second.conflicts.length,0)
})

test('a metadata conflict retains local values while keeping canonical identities consistent with records',()=>{
  const {before,current,incoming}=fixture()
  current.workspace.properties['local-task'].estimate=60
  incoming.workspace.properties['cloud-task'].estimate=90
  const result=mergeBackgroundState(before,current,incoming,['local-task'])
  assert.ok(result.conflicts.length)
  assert.equal(result.state.workspace.properties['cloud-task'].estimate,60)
  assert.equal(result.state.workspace.identities[0].id,result.state.records[0].id)
  assert.equal(result.state.workspace.relations[0].fromId,result.state.records[0].id)
})

test('UI adoption retains unchanged branches and only replaces edited or revoked records',()=>{
  const {before,current}=fixture()
  const incoming=copy(current);incoming.storage.lastSyncedAt='2026-11-11T10:00:00Z'
  let result=mergeBackgroundState(before,current,incoming,[],{reuseUnchanged:true})
  assert.equal(result.state.records,current.records)
  assert.equal(result.state.collections,current.collections)
  assert.equal(result.state.workspace,current.workspace)
  assert.equal(result.state.connection,current.connection)
  assert.notEqual(result.state.storage,current.storage)
  incoming.records[1].body='Changed in Deck'
  result=mergeBackgroundState(before,current,incoming,[],{reuseUnchanged:true})
  assert.equal(result.state.records[0],current.records[0])
  assert.notEqual(result.state.records[1],current.records[1])
  assert.equal(current.records[1].body,undefined)
  incoming.records=[];incoming.statuses=[{source:'tasks',permissionDenied:true},{source:'deck',permissionDenied:true}]
  assert.deepEqual(mergeBackgroundState(before,current,incoming,['local-task'],{reuseUnchanged:true}).state.records,[])
})

test('stable UI branches respect deletions, reordering and values changed without an ETag',()=>{
  const {current}=fixture(),incoming=copy(current)
  incoming.records.reverse();delete incoming.records[1].nativeRelatedIds
  incoming.records[0].readonly=true
  const result=reuseUnchangedState(current,incoming)
  assert.equal(result.records[0].id,'local-card')
  assert.equal(result.records[0].readonly,true)
  assert.equal(Object.hasOwn(result.records[1],'nativeRelatedIds'),false)
  assert.deepEqual(result,incoming)
  assert.equal(reuseUnchangedState(current,copy(current)),current)
})

test('optimized identity merge detects cross-source and new alias collisions without pairwise scans',async()=>{
  const {mergeWorkspaces}=await import('@nextspace/core/workspace-merge.mjs')
  const base=createEmptyState().workspace,local=copy(base),remote=copy(base)
  local.identities=[{id:'local',source:'tasks',key:'new-list/task',aliases:['shared-uid']}]
  remote.identities=[{id:'remote',source:'tasks',key:'old-list/task',aliases:['shared-uid']}]
  assert.deepEqual(mergeWorkspaces(base,local,remote).conflicts,['identities[local].alias'])
  remote.identities[0].source='calendar'
  assert.deepEqual(mergeWorkspaces(base,local,remote).conflicts,[])
  remote.identities[0].source='tasks';base.identities=copy([...local.identities,...remote.identities])
  assert.deepEqual(mergeWorkspaces(base,local,remote).conflicts,[],'Known distinct native items may share aliases')
})
