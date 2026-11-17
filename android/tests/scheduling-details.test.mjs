import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {checkedSchedulingJournal,createSchedulingJournal,schedulingRequest} from '../src/scheduling.mjs'

const input={requestId:'11111111-1111-4111-8111-111111111111',recordId:'task',title:'Work',collectionId:'calendar',start:'2030-06-11T09:00:00Z',end:'2030-06-11T10:00:00Z',expectedRevision:0}
const legacyPayload={recordId:'task',title:'Work',collectionId:'calendar',start:'2030-06-11T09:00:00Z',end:'2030-06-11T10:00:00Z',allDay:false,description:''}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

test('existing pending journals retain absent details and the original serialized fingerprint',()=>{
  const saved={schemaVersion:1,requests:[{requestId:input.requestId,digest:digest(legacyPayload),status:'pending',payload:legacyPayload}]}
  assert.deepEqual(checkedSchedulingJournal(saved),saved)
  assert.equal(JSON.stringify(schedulingRequest(input).payload),JSON.stringify(legacyPayload))
  assert.equal(Object.hasOwn(schedulingRequest(input).payload,'reminders'),false)
  assert.equal(Object.hasOwn(schedulingRequest(input).payload,'location'),false)
})

test('new scheduling details validate without silently supplying a reminder default',()=>{
  assert.deepEqual(schedulingRequest({...input,location:'Studio',reminders:[60,15,0]}).payload,{...legacyPayload,location:'Studio',reminders:[0,15,60]})
  assert.deepEqual(schedulingRequest({...input,location:'',reminders:[]}).payload,{...legacyPayload,location:'',reminders:[]})
  for(const reminders of [[15,15],[-1],[40321],[1.5],[0,1,2,3,4,5],'15'])assert.throws(()=>schedulingRequest({...input,reminders}),{code:'VALIDATION'})
  assert.throws(()=>schedulingRequest({...input,location:'x'.repeat(2001)}),{code:'VALIDATION'})
})

test('pending details freeze across restart and changing them cannot create a second booking',async()=>{
  let stored,creates=0,blocked=true,workspace={relations:[]},revision=0
  const cache={load:async()=>structuredClone(stored??null),save:async(_,value)=>{stored=structuredClone(value)}}
  const context={state:()=>({workspace,revision}),snapshot:()=>({workspace,revision}),resolve:id=>id,record:()=>({id:'task',source:'tasks',kind:'task'}),collection:()=>({id:'calendar',source:'calendar',remote:{href:'https://cloud.example.test/calendar/'}}),
    client:()=>({createEvent:async payload=>{creates++;assert.equal(payload.location,'Studio');assert.deepEqual(payload.reminders,[15]);return {href:'https://cloud.example.test/calendar/event.ics',uid:'event',record:{id:'event'}}},readCreatedEvent:async()=>({id:'event'})}),
    adoptEvent:async record=>record,saveWorkspace:async next=>{if(blocked)throw Error('Local save unavailable');workspace=next;revision++}}
  const first=createSchedulingJournal({cache,key:'journal',context,newId:()=> 'link'}),details={...input,description:'Original brief',location:'Studio',reminders:[15]}
  await assert.rejects(first.create(details));assert.equal(creates,1);const priorDigest=stored.requests[0].digest
  const restored=createSchedulingJournal({cache,key:'journal',context,newId:()=> 'link'});await restored.load()
  assert.equal(restored.pending()[0].location,'Studio');assert.deepEqual(restored.pending()[0].reminders,[15])
  await assert.rejects(restored.create({...details,reminders:[]}),{code:'CONFLICT'})
  await assert.rejects(restored.create({...details,location:'Elsewhere'}),{code:'CONFLICT'})
  blocked=false;await restored.create(details);assert.equal(creates,1);assert.equal(stored.requests[0].digest,priorDigest);assert.equal(stored.requests[0].status,'linked')
})
