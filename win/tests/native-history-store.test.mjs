import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {WorkspaceStore,accountScope,validateWorkspace} from '@nextspace/nextcloud-node/workspace.mjs'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {prepareCardTask,createCardTasks} from '@nextspace/core/card-tasks.mjs'
import {SourceHistorySession} from '../electron/calendar-history.mjs'
import {refreshNativeSources} from '../electron/source-refresh.mjs'

const serverUrl='https://calendar.example.invalid/nextcloud',scope=accountScope(serverUrl,'fixture'),clone=structuredClone
const sourceRecord=(id,source='tasks')=>({id:`native-${id}`,source,kind:source==='tasks'?'task':'event',title:`Fictional ${id}`,readonly:false,etag:'"fixture"',identity:{source,key:`0123456789abcdef:${source}:${id}`,locator:`${serverUrl}/remote.php/dav/calendars/fixture/work/${id}.ics`,aliases:[`native-${id}`]},remote:{href:`${serverUrl}/remote.php/dav/calendars/fixture/work/${id}.ics`,raw:'fixture body'}})
const sourceCache=records=>({records,collections:[],statuses:[...new Set(records.map(record=>record.source))].map(source=>({source,state:'connected',count:records.filter(record=>record.source===source).length,lastSyncedAt:'2026-11-23T12:00:00Z'}))})
async function fixture(t){const dataDir=await mkdtemp(path.join(tmpdir(),'nextglance-native-history-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));const initialState={workspace:createPlannerWorkspace(),records:[],collections:[],statuses:[]};return {dataDir,initialState,store:await WorkspaceStore.open({dataDir,scope,initialState})}}
function remote(){let value=null,version=0;const writes=[];return {writes,readWorkspace:async()=>({workspace:clone(value),etag:value?`"${version}"`:null}),writeWorkspace:async workspace=>{value=clone(workspace);version++;writes.push(clone(workspace));return {etag:`"${version}"`}},mutate:fn=>{value=fn(clone(value));version++}}}
async function publish(store,records){let verified=[];await refreshNativeSources({store,client:{primeFileMetadata:()=>{},readAll:async()=>sourceCache(records)},session:new SourceHistorySession(),current:()=>true,selected:['tasks','calendar'],sources:['tasks','calendar'],onVerified:successful=>verified=[...successful]});return verified}
function paddedWorkspace(workspace,remaining){const next=clone(workspace);for(let i=0;i<41;i++)next.properties[`saved-${i}`]={note:'x'.repeat(200000)};next.properties.padding={note:''};next.properties.padding.note='x'.repeat(8*1024*1024-remaining-Buffer.byteLength(JSON.stringify(next)));return validateWorkspace(next)}

test('ten thousand real native occurrences publish without metadata growth or another planner upload',async t=>{
  const {store,dataDir,initialState}=await fixture(t),cloud=remote();await store.syncWith(cloud)
  const before=store.snapshot(),client=new NextcloudClient({serverUrl,username:'fixture',appPassword:'fixture-only'}),href=serverUrl+'/remote.php/dav/calendars/fixture/8bd62f5c-aaad-4c85-b5a8-ef37c989f09e/'
  const raw='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:74a31c13-3de6-4c50-bb45-78bf72aca4af\r\nSUMMARY:Fictional daily series\r\nDTSTART:20000101T090000Z\r\nDTEND:20000101T100000Z\r\nRRULE:FREQ=DAILY;COUNT=10000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
  const collection={id:client.id('calendar',href),source:'calendar',title:'Fictional Calendar',readonly:false,remote:{href}}
  const events=client.calendarRecords(raw,href+'series.ics','"1"',collection,new Date('1999-01-01T00:00:00Z'),new Date('2030-01-01T00:00:00Z'))
  assert.equal(events.length,10000);assert.deepEqual((await publish(store,[...events,sourceRecord('new-task')])).sort(),['calendar','tasks'])
  const after=store.snapshot();assert.deepEqual(after.workspace,before.workspace);assert.equal(after.revision,before.revision);assert.equal(after.sync.status,'synced');assert.equal(after.cache.records.length,10001);assert.equal(after.workspace.identities.length,0)
  assert.ok(Buffer.byteLength(JSON.stringify(after.workspace))<2048)
  const task=after.cache.records.find(record=>record.source==='tasks');assert.equal(store.recordSnapshot(task.id,'tasks').readonly,false);assert.equal(store.recordSnapshot(task.id,'tasks').etag,'"fixture"')
  assert.ok(after.cache.records.every(record=>!record.id.includes('http')&&!record.id.includes('remote.php')))
  const reopened=await WorkspaceStore.open({dataDir,scope,initialState});assert.equal(reopened.recordSnapshot(task.id,'tasks').id,task.id)
  await reopened.syncWith(cloud);assert.equal(cloud.writes.length,1);assert.equal(reopened.snapshot().workspace.identities.length,0)
})
test('customization promotes only referenced native records and keeps their existing selected IDs',async t=>{
  const {store}=await fixture(t);await store.updateCache(sourceCache([sourceRecord('one'),sourceRecord('two'),sourceRecord('unlinked')]))
  const before=store.snapshot(),[one,two]=before.cache.records,workspace=clone(before.workspace)
  workspace.relations.push({id:'fixture-relation',type:'depends_on',fromId:one.id,toId:two.id})
  const saved=await store.saveWorkspace(workspace,before.revision)
  assert.deepEqual(saved.workspace.identities.map(identity=>identity.id).sort(),[one.id,two.id].sort())
  assert.deepEqual(store.snapshot().cache.records.map(record=>record.id),before.cache.records.map(record=>record.id))
  const revision=saved.revision;await store.updateCache(sourceCache([sourceRecord('one'),sourceRecord('two'),sourceRecord('unlinked'),sourceRecord('another')]))
  assert.equal(store.snapshot().revision,revision);assert.equal(store.snapshot().workspace.identities.length,2)
})
test('a newly projected public Deck card can create one linked task with durable retry receipts',async t=>{
  const {store}=await fixture(t),cloud=remote(),card={...sourceRecord('card','deck'),kind:'card'},calendar=sourceRecord('event','calendar'),tasks={id:'task-list',source:'tasks',title:'Fictional tasks',readonly:false,identity:{source:'tasks',key:'collection-private'},remote:{href:'private'}}
  await store.updateCache({...sourceCache([card,calendar]),collections:[tasks]})
  const state=()=>{const value=store.publicSnapshot();return {workspace:value.workspace,revision:value.revision,records:value.cache.records,collections:value.cache.collections,statuses:value.cache.statuses,connection:{connected:true,serverUrl,username:'fixture'},storage:store.storage()}}
  const initial=state(),publicCard=initial.records.find(record=>record.kind==='card')
  assert.equal(initial.workspace.identities.length,0);assert.deepEqual(publicCard.identity,{source:'deck',key:card.identity.key});assert.equal(publicCard.remote,undefined);assert.equal(publicCard.identity.locator,undefined);assert.equal(publicCard.identity.aliases,undefined);assert.equal(initial.records.find(record=>record.kind==='event').identity,undefined);assert.equal(initial.collections[0].identity,undefined)
  const prepared=await prepareCardTask({card:publicCard,workspace:initial.workspace,collectionId:tasks.id,title:'Fictional follow-up',requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})
  let creations=0
  const api={getState:async()=>state(),saveWorkspace:(workspace,revision)=>store.saveWorkspace(workspace,revision),syncWorkspace:async()=>{await store.syncWith(cloud);return state()},createTask:async()=>{creations++;const record={...sourceRecord('created-task'),collectionId:tasks.id};await store.updateCache(cache=>({...cache,records:[...cache.records,record]}));const created=store.snapshot().cache.records.find(item=>item.identity.key===record.identity.key);return {...state(),createdRecordId:created.id}}}
  const result=await createCardTasks({api,cardId:publicCard.id,entries:[prepared]});assert.equal(result.created,1);assert.equal(result.linked,1);assert.equal(result.state.workspace.identities.length,2)
  const retried=await createCardTasks({api,cardId:publicCard.id,entries:[prepared]});assert.equal(retried.reused,1);assert.equal(creations,1);assert.equal(store.snapshot().workspace.relations.length,1)
})
test('a cloud canonical identity remaps an in-flight projected ID without losing native edit lookup',async t=>{
  const {store}=await fixture(t),cloud=remote();await store.syncWith(cloud);await store.updateCache(sourceCache([sourceRecord('one')]))
  const projected=store.snapshot().cache.records[0],canonical='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  cloud.mutate(workspace=>({...workspace,identities:[{id:canonical,...projected.identity}]}))
  await store.syncWith(cloud)
  assert.equal(store.recordSnapshot(projected.id,'tasks').id,canonical);assert.equal(store.resolveRecordId(projected.id),canonical);assert.equal(store.recordIdAliases()[projected.id],canonical)
})
test('derived metadata overflow retains prior customization and still publishes verified native reads',async t=>{
  const {store}=await fixture(t),initial=store.snapshot();await store.saveWorkspace(paddedWorkspace(initial.workspace,100),initial.revision)
  const before=store.snapshot(),legacy=Array.from({length:5},(_,index)=>({id:`legacy-${index}`,source:'tasks',title:'Fictional legacy task',readonly:false,etag:'"1"'}))
  assert.deepEqual(await publish(store,legacy),['tasks'])
  const after=store.snapshot();assert.deepEqual(after.workspace,before.workspace);assert.equal(after.revision,before.revision);assert.equal(after.cache.records.length,5);assert.equal(after.cache.statuses.find(status=>status.source==='tasks').state,'connected');assert.equal(store.storage().syncStatus,'error');assert.match(store.storage().message,/Planner metadata/)
})
test('a customization whose identity promotion exceeds metadata limits is rejected atomically',async t=>{
  const {store}=await fixture(t),initial=store.snapshot();await store.saveWorkspace(paddedWorkspace(initial.workspace,140),initial.revision);await store.updateCache(sourceCache([sourceRecord('one')]))
  const before=store.snapshot(),workspace=clone(before.workspace),record=before.cache.records[0];workspace.properties[record.id]={note:'link'}
  validateWorkspace(workspace)
  await assert.rejects(store.saveWorkspace(workspace,before.revision),/maximum size is 8 MB/)
  assert.deepEqual(store.snapshot(),before);assert.equal(store.recordSnapshot(record.id,'tasks').readonly,false)
})
