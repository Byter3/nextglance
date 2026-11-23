import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkspaceStore,accountScope} from '@nextspace/nextcloud-node/workspace.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {createTaskDeleteHandler} from '../electron/task-delete.cjs'
import {reconcileRefreshedCache} from '../electron/security.cjs'

const connection={connected:true,serverUrl:'https://cloud.example.test',username:'alex'}
const expectedAccount={serverUrl:connection.serverUrl,username:connection.username}
const list={id:'tasks',source:'tasks',title:'Delivery',remote:{href:`${connection.serverUrl}/remote.php/dav/calendars/alex/tasks/`}}
const calendar={id:'work',source:'calendar',title:'Work',remote:{href:`${connection.serverUrl}/remote.php/dav/calendars/alex/work/`}}
const task={id:'task',source:'tasks',kind:'task',collectionId:list.id,etag:'"reviewed"',title:'Prepare brief',identity:{source:'tasks',key:'task-native'},remote:{uid:'native'}}

test('confirmed task deletion preserves other items, planner relations and durable recovery',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'nextglance-task-delete-'))
  t.after(()=>rm(directory,{recursive:true,force:true}))
  const event={id:'booking',source:'calendar',kind:'event',collectionId:calendar.id,title:'Planning meeting',identity:{source:'calendar',key:'event-native'}}
  const other={id:'other',source:'tasks',kind:'task',collectionId:list.id,title:'Send draft',identity:{source:'tasks',key:'other-native'}}
  const untouchedCheckpoint={href:calendar.remote.href,token:'calendar-token'}
  const cache={
    records:[task,event,other],collections:[list,calendar],statuses:[{source:'tasks',state:'connected',count:2},{source:'calendar',state:'connected',count:1}],
    davCheckpoint:{version:1,collections:[{href:list.remote.href,token:'task-token'},untouchedCheckpoint]},
  }
  const options={dataDir:directory,scope:accountScope(connection.serverUrl,connection.username),initialState:{workspace:createPlannerWorkspace(),...cache}}
  const store=await WorkspaceStore.open(options)
  await store.updateCache(cache)
  const before=store.cacheSnapshot(), prior=before.records.find(item=>item.identity?.key===task.identity.key), booking=before.records.find(item=>item.source==='calendar')
  const snapshot=store.snapshot()
  snapshot.workspace.relations=[{id:'work-session',type:'scheduled_during',fromId:prior.id,toId:booking.id}]
  await store.saveWorkspace(snapshot.workspace,snapshot.revision)
  const baseline=store.snapshot().workspace
  const client={deleteTask:async (input,record,collection)=>{
    assert.deepEqual(input,{id:prior.id,etag:prior.etag})
    assert.equal(record.remote.uid,'native')
    assert.deepEqual(collection,list)
    return {deleted:true}
  }}
  const handler=createTaskDeleteHandler({getContext:id=>({store,client,record:store.recordSnapshot(id,'tasks'),collection:list}),getAccount:()=>connection,isCurrent:()=>true,state:()=>store.snapshot()})
  const result=await handler({id:prior.id,etag:prior.etag,expectedAccount})
  assert.deepEqual(result.cache.records.map(item=>item.identity.key),[event.identity.key,other.identity.key])
  assert.deepEqual(result.cache.statuses.map(status=>status.count),[1,1])
  assert.deepEqual(result.cache.davCheckpoint.collections,[untouchedCheckpoint])
  assert.deepEqual(result.workspace.relations,baseline.relations)
  assert.deepEqual(result.workspace.identities,baseline.identities)

  const late=reconcileRefreshedCache(before,result.cache,{...before,records:before.records.map(item=>({...item,id:`changed-${item.id}`}))},['tasks','calendar'])
  assert.ok(!late.cache.records.some(item=>item.identity.key===task.identity.key),'Racing refresh cannot restore the deleted identity')
  await store.updateCache({...result.cache,...late.cache})
  await writeFile(store.path,'invalid latest archive')
  const restored=await WorkspaceStore.open(options)
  assert.ok(!restored.snapshot().cache.records.some(item=>item.identity.key===task.identity.key),'Backup does not restore confirmed deletion')
  assert.deepEqual(restored.snapshot().workspace.relations,baseline.relations)
})

test('task deletion rejects account and revision changes, malformed requests and uncertain results',async()=>{
  let account=connection, current=true, calls=0, commits=0
  const store={updateCache:async()=>{commits++}}
  const client={deleteTask:async()=>{calls++;return {}}}
  const handler=createTaskDeleteHandler({getContext:()=>({store,record:task,collection:list,client}),getAccount:()=>account,isCurrent:()=>current,state:()=>({})})
  const request={id:task.id,etag:task.etag,expectedAccount}
  for(const input of [null,[],{...request,href:'ignored'},{...request,id:'task\0'},{id:task.id,etag:task.etag},{...request,etag:'"old"'},{...request,expectedAccount:{...expectedAccount,username:'other'}}])await assert.rejects(handler(input))
  assert.equal(calls,0)
  await assert.rejects(handler(request),/did not confirm/)
  client.deleteTask=async()=>{throw new Error('Connection interrupted')}
  await assert.rejects(handler(request),/Connection interrupted/)
  client.deleteTask=async()=>{account={...connection,username:'other'};current=false;return {deleted:true}}
  await assert.rejects(handler(request),/account changed/)
  assert.equal(commits,0)
})
