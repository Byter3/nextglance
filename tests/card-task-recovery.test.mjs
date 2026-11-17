import test from 'node:test'
import assert from 'node:assert/strict'
import {createWebController} from '../web/src/session-controller.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {checklistTaskCandidates,prepareCardTask,createCardTasks} from '@nextspace/core/card-tasks.mjs'

// Use the actual host queues, identity reconciliation and three-way merge. Only
// the session, conditional remote folder and native-task effects are fixtures.
const copy=value=>structuredClone(value)
const serverUrl='https://cloud.example.test',sessionUrl=serverUrl+'/apps/nextglance/session'
const cardId='11111111-1111-4111-8111-111111111111',cardKey='deck:board-1/card-2'
const bootstrap={appId:'nextglance',appVersion:'0.6.13',userId:'example-user',displayName:'Example',serverUrl,basePath:'',sessionUrl,loginUrl:serverUrl+'/login',enabledApps:['tasks','deck']}
const card={id:'native-card',source:'deck',kind:'card',title:'Example production',body:'- [ ] Prepare brief\n- [x] Review draft',collectionId:'board',readonly:false,identity:{source:'deck',key:cardKey}}
const collections=[{id:'board',source:'deck',title:'Production',readonly:false},...['tasks-a','tasks-b'].map(id=>({id,source:'tasks',title:id,readonly:false,remote:{href:`${serverUrl}/remote.php/dav/calendars/example-user/${id}/`}}))]
const statuses=['tasks','calendar','deck','notes','collectives'].map(source=>({source,state:'connected',count:source==='deck'?1:0}))
function barrier(required){let release,arrived=0;const wait=new Promise(resolve=>{release=resolve});return async()=>{if(++arrived>=required)release();await wait}}

function cloudFixture(){
  let cloud=createPlannerWorkspace(),version=1,body=card.body,failTitle,switched=false,reservationGate,nativeGate
  cloud.identities=[{id:cardId,source:'deck',key:cardKey,aliases:['native-card']}]
  const tasks=new Map(),calls=[],clients=[]
  const apiFor=()=>{
    let gated=false
    const native={
      readAll:async()=>({records:[{...card,body},...tasks.values()],collections,statuses}),
      createTask:async input=>{
        calls.push(copy(input));await nativeGate?.()
        if(input.title===failTitle)throw Object.assign(new Error('The task list is temporarily unavailable'),{code:'NETWORK'})
        const key=`${input.collectionId}/${input.requestId}`
        if(!tasks.has(key))tasks.set(key,{id:'native-'+input.requestId,source:'tasks',kind:'task',title:input.title,body:input.description,completed:input.completed,collectionId:input.collectionId,readonly:false,identity:{source:'tasks',key:'tasks:'+key}})
        return {record:copy(tasks.get(key))}
      },
      createdRecord:async(source,saved)=>saved.record,
    }
    const api=createWebController({origin:serverUrl,sessionUrl,requestToken:()=> 'fixture-token',fetch:async()=>new Response(JSON.stringify({...bootstrap,userId:switched?'other-user':bootstrap.userId}),{headers:{'Content-Type':'application/json'}}),createClient:()=>native,createFolder:()=>({
      readWorkspace:async()=>({workspace:copy(cloud),etag:String(version)}),
      writeWorkspace:async(workspace,etag)=>{
        if(!gated&&reservationGate&&Object.values(workspace.properties).some(value=>value?.cardTasks)){gated=true;await reservationGate()}
        if(etag!==String(version))throw Object.assign(new Error('Another device saved first'),{code:'CONFLICT'})
        validateWorkspace(workspace);cloud=copy(workspace);version++;return {workspace:copy(cloud),etag:String(version)}
      },
    })})
    clients.push(api);return api
  }
  return {
    apiFor,calls,tasks,get cloud(){return copy(cloud)},get cardBody(){return body},set cardBody(value){body=value},
    set failTitle(value){failTitle=value},set switched(value){switched=value},
    raceReservations(){reservationGate=barrier(2)},raceNative(){nativeGate=barrier(2)},
    changeCloud(fn){cloud=validateWorkspace(fn(copy(cloud)));version++},dispose(){clients.forEach(api=>api.dispose())},
  }
}
async function loaded(api){await api.getState();return api.refresh()}
async function prepared(api,{index=0,collectionId='tasks-a',manualTitle}={}){
  const state=await api.getState(),current=state.records.find(value=>value.kind==='card')
  if(manualTitle)return prepareCardTask({card:current,workspace:state.workspace,collectionId,title:manualTitle})
  const candidate=(await checklistTaskCandidates({...state,card:current}))[index]
  return prepareCardTask({card:current,workspace:state.workspace,collectionId,candidate})
}

test('simultaneous devices reserve one checklist operation and converge on one native task and dependency',async t=>{
  const f=cloudFixture();t.after(()=>f.dispose());const a=f.apiFor(),b=f.apiFor();await Promise.all([loaded(a),loaded(b)])
  const [entryA,entryB]=await Promise.all([prepared(a),prepared(b)]);assert.deepEqual(entryA,entryB)
  f.raceReservations();f.raceNative()
  const results=await Promise.all([createCardTasks({api:a,cardId,entries:[entryA]}),createCardTasks({api:b,cardId,entries:[entryB]})])
  assert.equal(f.calls.length,2);assert.equal(f.tasks.size,1);assert.equal(f.cloud.relations.length,1)
  assert.equal(new Set(f.calls.map(input=>input.requestId)).size,1)
  const identities=f.cloud.identities.filter(value=>value.source==='tasks');assert.equal(identities.length,1)
  assert.equal(f.cloud.relations[0].fromId,cardId);assert.equal(f.cloud.relations[0].toId,identities[0].id)
  assert.equal(f.cloud.properties[cardId].cardTasks[entryA.key].taskIdentityKey,identities[0].key)
  for(const result of results)assert.equal(result.state.storage.syncStatus,'synced')
})

test('simultaneous incompatible destinations reject one reservation before its native task creation',async t=>{
  const f=cloudFixture();t.after(()=>f.dispose());const a=f.apiFor(),b=f.apiFor();await Promise.all([loaded(a),loaded(b)])
  const entries=await Promise.all([prepared(a,{collectionId:'tasks-a'}),prepared(b,{collectionId:'tasks-b'})]);assert.equal(entries[0].receipt.requestId,entries[1].receipt.requestId)
  f.raceReservations()
  const results=await Promise.allSettled([createCardTasks({api:a,cardId,entries:[entries[0]]}),createCardTasks({api:b,cardId,entries:[entries[1]]})])
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(results.filter(value=>value.status==='rejected').length,1)
  assert.equal(f.calls.length,1);assert.equal(f.tasks.size,1);assert.equal(f.cloud.relations.length,1)
  assert.equal(f.calls[0].collectionId,f.cloud.properties[cardId].cardTasks[entries[0].key].collectionId)
})

test('cloud canonical card UUID replacement before reservation preserves native request identity and property owner',async t=>{
  const f=cloudFixture();t.after(()=>f.dispose());const api=f.apiFor();await loaded(api);const entry=await prepared(api)
  const canonical='22222222-2222-4222-8222-222222222222'
  f.changeCloud(workspace=>({...workspace,identities:workspace.identities.map(value=>value.source==='deck'?{...value,id:canonical}:value)}))
  const result=await createCardTasks({api,cardId,entries:[entry]})
  assert.equal(f.tasks.size,1);assert.equal(f.calls[0].requestId,entry.receipt.requestId)
  assert.ok(f.cloud.properties[canonical].cardTasks[entry.key]);assert.equal(f.cloud.properties[cardId],undefined)
  assert.equal(f.cloud.relations[0].fromId,canonical);assert.equal(result.state.records.find(value=>value.kind==='card').id,canonical)
})

test('missing completed target and deliberate unlink never recreate or silently restore a dependency',async t=>{
  const f=cloudFixture();t.after(()=>f.dispose());const api=f.apiFor();await loaded(api);const entry=await prepared(api)
  await createCardTasks({api,cardId,entries:[entry]});const nativeCalls=f.calls.length
  f.changeCloud(workspace=>({...workspace,relations:[]}))
  const unlinked=await createCardTasks({api,cardId,entries:[entry]});assert.equal(unlinked.reused,1);assert.equal(f.cloud.relations.length,0);assert.equal(f.calls.length,nativeCalls)
  f.tasks.clear();await api.refresh()
  await assert.rejects(createCardTasks({api,cardId,entries:[entry]}),/already created but is not loaded/)
  assert.equal(f.calls.length,nativeCalls);assert.equal(f.tasks.size,0);assert.equal(f.cloud.relations.length,0)
  assert.ok(f.cloud.properties[cardId].cardTasks[entry.key].taskIdentityKey)
})

test('a later native failure preserves earlier linked rows and retries only the unfinished row',async t=>{
  const f=cloudFixture();t.after(()=>f.dispose());const api=f.apiFor();await loaded(api)
  const entries=await Promise.all([prepared(api,{index:0}),prepared(api,{index:1})]);f.failTitle=entries[1].receipt.title
  await assert.rejects(createCardTasks({api,cardId,entries}),/1 task\(s\) were created or recovered/)
  assert.equal(f.tasks.size,1);assert.equal(f.cloud.relations.length,1)
  assert.ok(f.cloud.properties[cardId].cardTasks[entries[0].key].taskIdentityKey);assert.equal(f.cloud.properties[cardId].cardTasks[entries[1].key].taskIdentityKey,undefined)
  f.failTitle=undefined
  await createCardTasks({api,cardId,entries})
  assert.equal(f.calls.filter(value=>value.requestId===entries[0].receipt.requestId).length,1)
  assert.equal(f.tasks.size,2);assert.equal(f.cloud.relations.length,2)
  assert.equal([...f.tasks.values()].find(value=>value.title===entries[1].receipt.title).completed,true)
})

test('duplicate normalized labels retain distinct occurrences and become ambiguous without their receipts',async t=>{
  const f=cloudFixture();t.after(()=>f.dispose());f.cardBody='- [ ] **Review**　draft\n- [x] REVIEW draft'
  const api=f.apiFor();const state=await loaded(api),current=state.records.find(value=>value.kind==='card')
  const candidates=await checklistTaskCandidates({...state,card:current});assert.deepEqual(candidates.map(value=>value.text),['review draft','review draft']);assert.deepEqual(candidates.map(value=>value.occurrence),[1,2])
  const entries=await Promise.all(candidates.map(candidate=>prepareCardTask({card:current,workspace:state.workspace,collectionId:'tasks-a',candidate})))
  assert.notEqual(entries[0].receipt.requestId,entries[1].receipt.requestId)
  await createCardTasks({api,cardId,entries});assert.equal(f.tasks.size,2)
  f.changeCloud(workspace=>({...workspace,properties:{}}));const missing=await api.syncWorkspace()
  const ambiguous=await checklistTaskCandidates({...missing,card:missing.records.find(value=>value.kind==='card')})
  assert.deepEqual(ambiguous.map(value=>value.state),['ambiguous','ambiguous'])
  await assert.rejects(prepareCardTask({card:current,workspace:missing.workspace,collectionId:'tasks-a',candidate:ambiguous[0]}),/Several checklist/)
  assert.equal(f.tasks.size,2)
})

test('account change between completed first row and second row prevents further native creation',async t=>{
  const f=cloudFixture();t.after(()=>f.dispose());const api=f.apiFor();await loaded(api)
  const entries=await Promise.all([prepared(api,{index:0}),prepared(api,{index:1})])
  await assert.rejects(createCardTasks({api,cardId,entries,onProgress:value=>{if(value.completed===1)f.switched=true}}),/account|session|signing in/i)
  assert.equal(f.calls.length,1);assert.equal(f.tasks.size,1);assert.equal(f.cloud.relations.length,1)
  assert.ok(f.cloud.properties[cardId].cardTasks[entries[0].key].taskIdentityKey);assert.equal(f.cloud.properties[cardId].cardTasks[entries[1].key].taskIdentityKey,undefined)
})
