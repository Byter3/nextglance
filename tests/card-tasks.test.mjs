import test from 'node:test'
import assert from 'node:assert/strict'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {checklistTaskCandidates,prepareCardTask,createCardTasks,taskCreationOptions,validateCardTaskReceipts} from '@nextspace/core/card-tasks.mjs'
const copy=value=>structuredClone(value)
function fixture(){
  const workspace=createPlannerWorkspace(),card={id:'card',source:'deck',kind:'card',title:'Launch film',body:'- [ ] **Collect** footage\n- [x] Record sound',collectionId:'board'}
  workspace.identities=[{id:'card',source:'deck',key:'deck:17'}]
  let state={mode:'live',connection:{connected:true,serverUrl:'https://cloud.example.test',username:'demo'},workspace,revision:1,records:[card],collections:[{id:'tasks',source:'tasks',title:'Production tasks'}],storage:{syncStatus:'synced'}},creates=0,failSync=false,failSave=false,lost=false
  const native=new Map(),api={getState:async()=>copy(state),syncWorkspace:async()=>{if(failSync)throw new Error('Cloud unavailable');return copy(state)},saveWorkspace:async(w,revision)=>{if(failSave)throw new Error('Metadata unavailable');assert.equal(revision,state.revision);validateWorkspace(w);state.workspace=copy(w);state.revision++;return {workspace:copy(w),revision:state.revision,storage:state.storage}},createTask:async input=>{
    let task=native.get(input.requestId)
    if(!task){creates++;task={id:`task-${creates}`,source:'tasks',kind:'task',title:input.title,completed:input.completed,collectionId:input.collectionId};native.set(input.requestId,task)}
    if(lost){lost=false;throw new Error('Response lost')}
    state.records=state.records.filter(r=>r.id!==task.id).concat(task)
    if(!state.workspace.identities.some(r=>r.id===task.id))state.workspace.identities.push({id:task.id,source:'tasks',key:`tasks:${input.requestId}`})
    return {...copy(state),createdRecordId:task.id}
  }}
  return {api,card,get state(){return state},get creates(){return creates},set failSync(v){failSync=v},set failSave(v){failSave=v},set lost(v){lost=v}}
}
test('checklist keys survive reordered rows, emphasis and checked-state changes',async()=>{
  const f=fixture(),a=await checklistTaskCandidates({...f.state,card:f.card})
  f.card.body='Paragraph\n\n- [ ] Record sound\n- [x] Collect footage'
  const b=await checklistTaskCandidates({...f.state,card:f.card})
  assert.equal(a[0].key,b[1].key);assert.equal(a[1].key,b[0].key)
  assert.deepEqual(a.map(r=>r.completed),[false,true])
  assert.equal((await checklistTaskCandidates({...f.state,card:{...f.card,body:'```md\n- [ ] example\n```'}})).length,0)
})

test('batch creation keeps durable per-row receipts with only reservation and final cloud sync',async()=>{
  const f=fixture(),entries=[];let syncs=0,saves=0,publications=0
  for(let index=0;index<8;index++)entries.push(await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',title:`Step ${index}`}))
  const sync=f.api.syncWorkspace,save=f.api.saveWorkspace
  f.api.syncWorkspace=async()=>{syncs++;return sync()};f.api.saveWorkspace=async(...args)=>{saves++;return save(...args)}
  await createCardTasks({api:f.api,cardId:'card',entries,onState:()=>publications++})
  assert.equal(syncs,2);assert.equal(saves,9);assert.equal(publications,2);assert.equal(f.creates,8);assert.equal(Object.values(f.state.workspace.properties.card.cardTasks).filter(value=>value.taskIdentityKey).length,8)
})

test('Android continues from durable per-task checkpoints and leaves final link sync to the host',async()=>{
  const f=fixture(),entries=[]
  for(let index=0;index<3;index++)entries.push(await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',title:`Step ${index}`}))
  const {getState,syncWorkspace,saveWorkspace,createTask}=f.api
  const account={serverUrl:'https://cloud.example.test',username:'demo'},operations=[]
  f.api.getState=async()=>{operations.push('read');return getState()}
  f.api.syncWorkspace=async()=>{operations.push('sync');f.state.storage.syncStatus='synced';return syncWorkspace()}
  f.api.saveWorkspace=async(workspace,revision,expectedAccount,options)=>{
    assert.deepEqual(expectedAccount,account)
    operations.push(options?.coalesceLaunch?'save-link':'reserve')
    f.state.storage.syncStatus='pending'
    return saveWorkspace(workspace,revision)
  }
  f.api.createTask=async input=>{assert.deepEqual(input.expectedAccount,account);operations.push('create');return createTask(input)}
  const result=await createCardTasks({api:f.api,cardId:'card',entries,deferLinkSync:true})
  assert.deepEqual(operations,['read','reserve','sync','create','save-link','read','create','save-link','read','create','save-link'])
  assert.equal(result.linksPending,true)
  assert.equal(result.state.revision,f.state.revision)
  assert.equal(result.state.workspace.relations.length,3)
})

test('a timed-out later Android create preserves earlier links and retries the same native request',async()=>{
  const f=fixture(),entries=[]
  for(let index=0;index<3;index++)entries.push(await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',title:`Step ${index}`}))
  const {syncWorkspace,saveWorkspace,createTask}=f.api;let syncs=0,calls=0,partialState
  f.api.syncWorkspace=async()=>{syncs++;f.state.storage.syncStatus='synced';return syncWorkspace()}
  f.api.saveWorkspace=async(...args)=>{f.state.storage.syncStatus='pending';return saveWorkspace(...args)}
  f.api.createTask=async input=>{if(++calls===2)f.lost=true;return createTask(input)}
  const options={api:f.api,cardId:'card',entries,deferLinkSync:true,onState:state=>partialState=state}
  await assert.rejects(createCardTasks(options),/1 task\(s\) were created or recovered; their planner links are pending/)
  assert.equal(syncs,1);assert.equal(f.creates,2);assert.equal(partialState.workspace.relations.length,1)
  const result=await createCardTasks(options)
  assert.equal(syncs,2);assert.equal(f.creates,3);assert.equal(result.state.workspace.relations.length,3)
})

test('the foreground reports an unconfirmed final link sync without immediately repeating it',async()=>{
  const f=fixture(),entry=await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',title:'Write brief'})
  const sync=f.api.syncWorkspace;let syncs=0
  f.api.syncWorkspace=async()=>{if(++syncs===2)throw new Error('Final sync timed out');return sync()}
  await assert.rejects(createCardTasks({api:f.api,cardId:'card',entries:[entry]}),/Final sync timed out/)
  assert.equal(syncs,2);assert.equal(f.state.workspace.relations.length,1)
})

test('editing a checklist task title preserves checklist identity and duplicate prevention',async()=>{
  const f=fixture(),candidate=(await checklistTaskCandidates({...f.state,card:f.card}))[0]
  const entry=await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',candidate,title:'Gather interview footage'})
  assert.equal(entry.key,candidate.key);assert.equal(entry.receipt.checklist.text,candidate.text);assert.equal(entry.receipt.title,'Gather interview footage')
  await createCardTasks({api:f.api,cardId:'card',entries:[entry]})
  assert.equal((await checklistTaskCandidates({...f.state,card:f.card}))[0].state,'existing')
})
test('identical rows are separate; ambiguous matching linked tasks are never guessed',async()=>{
  const f=fixture();f.card.body='- [ ] Collect footage\n- [ ] Collect footage'
  let rows=await checklistTaskCandidates({...f.state,card:f.card});assert.notEqual(rows[0].key,rows[1].key)
  f.state.records.push({id:'t',source:'tasks',kind:'task',title:'Collect footage'});f.state.workspace.identities.push({id:'t',source:'tasks',key:'tasks:t'});f.state.workspace.relations.push({id:'r',type:'depends_on',fromId:'card',toId:'t'})
  rows=await checklistTaskCandidates({...f.state,card:f.card});assert.deepEqual(rows.map(r=>r.state),['ambiguous','ambiguous'])
})

test('empty rendered checklist labels cannot create placeholder tasks',async()=>{
  const f=fixture();f.card.body='- [ ]   \n- [ ] ![](image.png)'
  const rows=await checklistTaskCandidates({...f.state,card:f.card})
  assert.ok(rows.length>0);assert.ok(rows.every(row=>row.state==='invalid'))
  for(const candidate of rows)await assert.rejects(prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',candidate}))
  assert.equal(f.creates,0)
})
test('cloud-confirmed reservation creates checked native task, links incoming, and does not recreate after unlink',async()=>{
  const f=fixture(),candidate=(await checklistTaskCandidates({...f.state,card:f.card}))[1]
  const entry=await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',candidate})
  assert.match(entry.receipt.requestId,/^[a-f0-9-]{14}8/)
  await createCardTasks({api:f.api,cardId:'card',entries:[entry]})
  assert.equal(f.creates,1);assert.equal(f.state.records[1].completed,true)
  assert.equal(f.state.workspace.relations[0].fromId,'card');assert.equal(f.state.workspace.relations[0].toId,'task-1')
  f.state.workspace.relations=[]
  await createCardTasks({api:f.api,cardId:'card',entries:[entry]});assert.equal(f.creates,1);assert.equal(f.state.workspace.relations.length,0)
})
test('uncertain native response retries same request; metadata failure retains recoverable reservation',async()=>{
  const f=fixture(),entry=await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',title:'Write brief'})
  f.lost=true;await assert.rejects(createCardTasks({api:f.api,cardId:'card',entries:[entry]}),/Response lost/)
  assert.equal(f.creates,1);assert.ok(f.state.workspace.properties.card.cardTasks[entry.key])
  const original=f.api.createTask;f.api.createTask=async input=>{const result=await original(input);f.failSave=true;return result}
  await assert.rejects(createCardTasks({api:f.api,cardId:'card',entries:[entry]}),/Metadata unavailable/)
  f.failSave=false;f.api.createTask=original
  await createCardTasks({api:f.api,cardId:'card',entries:[entry]});assert.equal(f.creates,1);assert.equal(f.state.workspace.relations.length,1)
})
test('failed sync and incompatible destination reservation prevent every native write',async()=>{
  const f=fixture(),entry=await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',title:'Write brief'})
  f.failSync=true;await assert.rejects(createCardTasks({api:f.api,cardId:'card',entries:[entry]}),/Cloud unavailable/);assert.equal(f.creates,0)
  f.failSync=false;f.state.workspace.properties.card={cardTasks:{[entry.key]:{...entry.receipt,collectionId:'elsewhere'}}}
  await assert.rejects(createCardTasks({api:f.api,cardId:'card',entries:[entry]}),/changed on another device/);assert.equal(f.creates,0)
})
test('account switch fences creation and receipt survives canonical card ID remap',async()=>{
  const f=fixture(),entry=await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',title:'Write brief'})
  let calls=0;const sync=f.api.syncWorkspace;f.api.syncWorkspace=async()=>{calls++;if(calls===1){f.state.records[0].id='canonical';f.state.workspace.identities[0].id='canonical';f.state.workspace.properties.canonical=f.state.workspace.properties.card;delete f.state.workspace.properties.card}return sync()}
  await createCardTasks({api:f.api,cardId:'card',entries:[entry]});assert.equal(f.state.workspace.relations[0].fromId,'canonical')
  f.api.syncWorkspace=async()=>({...await sync(),connection:{...f.state.connection,username:'other'}})
  await assert.rejects(createCardTasks({api:f.api,cardId:'canonical',entries:[entry]}),/account changed/);assert.equal(f.creates,1)
})
test('a single linked task is reused without changing completion; missing receipts never recreate',async()=>{
  const f=fixture();f.state.records.push({id:'t',kind:'task',source:'tasks',title:'Collect footage',completed:true});f.state.workspace.identities.push({id:'t',source:'tasks',key:'tasks:t'});f.state.workspace.relations.push({id:'r',type:'depends_on',fromId:'card',toId:'t'})
  let candidate=(await checklistTaskCandidates({...f.state,card:f.card}))[0];assert.equal(candidate.state,'existing')
  const entry=await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',candidate});await createCardTasks({api:f.api,cardId:'card',entries:[entry]})
  assert.equal(f.creates,0);assert.equal(f.state.records[1].completed,true)
  f.state.records.pop();candidate=(await checklistTaskCandidates({...f.state,card:f.card}))[0];assert.equal(candidate.state,'unavailable')
  await assert.rejects(prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',candidate}),/not loaded/)
})
test('receipt and native creation option validation rejects malformed inputs',()=>{
  assert.throws(()=>taskCreationOptions({completed:1}),/true or false/);assert.throws(()=>taskCreationOptions({requestId:'arbitrary'}),/valid task/)
  assert.throws(()=>validateCardTaskReceipts({'checklist-wrong':{}}),/Invalid card task receipt/)
})
test('server JSON property ordering does not change a reserved checklist request',async()=>{
  const f=fixture(),candidate=(await checklistTaskCandidates({...f.state,card:f.card}))[0],entry=await prepareCardTask({card:f.card,workspace:f.state.workspace,collectionId:'tasks',candidate})
  f.state.workspace.properties.card={cardTasks:{[entry.key]:{...entry.receipt,checklist:{occurrence:1,text:candidate.text}}}}
  await createCardTasks({api:f.api,cardId:'card',entries:[entry]});assert.equal(f.creates,1)
})
