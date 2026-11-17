import test from 'node:test'
import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'
import {defaultCalendarForRecord} from '@nextspace/core/scheduling.mjs'
import {canAddRelation, selectPlanner, planningColumnForRecord, boardColumns} from '@nextspace/core/planner.mjs'
import {reconcileIdentities} from '@nextspace/core/identity.mjs'
import {plannerFixture} from './fixtures.mjs'
import {nativePermissionResponse} from './native-permission-fixtures.mjs'

process.env.TZ='Europe/Budapest'
const server='https://cloud.example.test'
const now=new Date('2026-11-02T10:00:00Z')
const reply=(body,status=200,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers})
function clientFixture(handler){
  const calls=[]
  const client=new NextcloudClient({serverUrl:server,username:'alex',appPassword:'fixture'}, {now:()=>now,fetch:async(url,options)=>{calls.push({url,...options});return nativePermissionResponse(url,options)||handler(url,options)}})
  return {client,calls}
}
const board={id:'board',source:'deck',title:'Freelance',stacks:[{id:'3',title:'To do'},{id:'4',title:'Doing'}],remote:{nativeId:2}}
const nativeCard=extra=>({id:10,stackId:3,title:'Created card',description:'- [ ] First step',type:'plain',order:99999,lastModified:1793620800,done:null,assignedUsers:[],startdate:null,duedate:null,...extra})

test('scheduling defaults follow the active Space, category and project for multiply grouped sources',()=>{
  const work={id:'work',kind:'card',collectionId:'board'}
  const collections=['calA','calB','projectB'].map(id=>({id,source:'calendar'}))
  const workspace={spaces:[{id:'A',collectionIds:['board','calA'],defaultCalendarId:'calA'},{id:'B',collectionIds:['board','calB'],defaultCalendarId:'calB'}],categories:[{id:'catA',spaceId:'A',collectionIds:['board','calA']},{id:'catB',spaceId:'B',collectionIds:['board','calB']}],projects:[{id:'projectA',spaceId:'A',categoryId:'catA',collectionIds:['board','calA'],recordIds:[]},{id:'projectB',spaceId:'B',categoryId:'catB',collectionIds:['projectB'],recordIds:[]}]}
  assert.equal(defaultCalendarForRecord(work,workspace,collections),undefined,'My overview must not infer an owner from Spaces')
  assert.equal(defaultCalendarForRecord(work,workspace,collections,'A'),'calA')
  assert.equal(defaultCalendarForRecord(work,workspace,collections,'B'),'calB')
  assert.equal(defaultCalendarForRecord(work,workspace,collections,'catB'),'calB')
  assert.equal(defaultCalendarForRecord(work,workspace,collections,'projectB'),'projectB')
  assert.equal(defaultCalendarForRecord(work,workspace,[{id:'calA',source:'calendar'}],'B'),undefined,'Explicit scope cannot silently fall back to another Space')
  assert.equal(defaultCalendarForRecord(work,workspace,collections,'deleted-space'),undefined)
})

test('navigation counts use each destination assignment preference regardless of active view',()=>{
  const state=plannerFixture(now)
  state.workspace.planner.scopeAssignments={'space-work':'me','space-shared':'all'}
  const first=selectPlanner(state,{scopeId:'all',now}),second=selectPlanner(state,{scopeId:'space-shared',now})
  for(const space of first.spaces){
    assert.equal(space.openCount,second.spaces.find(item=>item.id===space.id).openCount)
    assert.equal(space.openCount,selectPlanner(state,{scopeId:space.id,now}).counts.actions)
  }
})

test('manual dependencies accept only known task/card endpoints while reference and event links remain available',()=>{
  const records=[{id:'task',kind:'task'},{id:'card',kind:'card'},{id:'note',kind:'note'},{id:'event',kind:'event'}]
  assert.equal(canAddRelation([],'task','card','depends_on',records).ok,true)
  for(const from of ['task','note','event'])for(const to of ['note','event','missing'])assert.equal(canAddRelation([],from,to,'depends_on',records).ok,false)
  assert.equal(canAddRelation([],'task','note','reference',records).ok,true)
  assert.equal(canAddRelation([],'task','event','for_event',records).ok,true)
})

test('effective planning status matches Board even for conflicting closed-item metadata',()=>{
  const records=[{id:'done',kind:'task',completed:true},{id:'cancelled',kind:'task',status:'CANCELLED'},{id:'open',kind:'card'}]
  const workflow={done:'doing',cancelled:'planned',open:'planned'}
  const columns=boardColumns(records,[],{mode:'planning',workflow})
  for(const record of records)assert.equal(planningColumnForRecord(record,workflow),columns.find(column=>column.records.includes(record)).id)
  assert.equal(planningColumnForRecord(records[0],{}),'done')
  assert.equal(planningColumnForRecord(records[1],{}),'cancelled')
})

test('new tasks preserve the selected native range and description and normalize without source refresh',async()=>{
  const {client,calls}=clientFixture((url,options)=>{assert.equal(options.method,'PUT');assert.equal(options.headers['If-None-Match'],'*');return reply('',201,{ETag:'"created"'})})
  const collection={id:'tasks',source:'tasks',title:'Personal',remote:{href:`${server}/remote.php/dav/calendars/alex/tasks/`}}
  const saved=await client.createTask({title:'Prepare review',start:'2026-11-02T08:00:00Z',due:'2026-11-02T10:00:00Z',description:'- [ ] Brief'},collection)
  const record=await client.createdRecord('tasks',saved,collection)
  assert.equal(record.start,'2026-11-02T08:00:00.000Z');assert.equal(record.due,'2026-11-02T10:00:00.000Z');assert.equal(record.body,'- [ ] Brief');assert.equal(record.readonly,false)
  const todo=new ICAL.Component(ICAL.parse(saved.raw)).getFirstSubcomponent('vtodo');assert.equal(todo.getFirstPropertyValue('uid'),saved.uid)
  const resolved=reconcileIdentities({identities:[],relations:[],plans:[],projects:[],properties:{}},[record])
  const again=reconcileIdentities(resolved.workspace,[record])
  assert.equal(again.records[0].id,resolved.records[0].id,'Newly returned source identity survives refresh')
  assert.equal(calls.length,2)
})

test('invalid task creation ranges fail before any native request',async()=>{
  const {client,calls}=clientFixture(()=>assert.fail('Invalid dates cannot write'))
  const collection={id:'tasks',source:'tasks',remote:{href:`${server}/remote.php/dav/calendars/alex/tasks/`}}
  for(const dates of [{start:'2026-11-02',due:'2026-11-02'},{start:'2026-11-03',due:'2026-11-02'},{start:'2026-11-02',due:'2026-11-02T10:00:00Z'},{start:'2026-02-30'}])await assert.rejects(client.createTask({title:'Task',...dates},collection),{code:'VALIDATION'})
  assert.equal(calls.length,0)
})

test('a created DAV item keeps its identity if only the follow-up read fails',async()=>{
  const {client,calls}=clientFixture((url,options)=>options.method==='PUT'?reply('',201):reply('',503))
  const collection={id:'cal',source:'calendar',title:'Personal',remote:{href:`${server}/remote.php/dav/calendars/alex/calendar/`}}
  const saved=await client.createEvent({title:'Focus',start:'2026-11-02',end:'2026-11-03',allDay:true},collection)
  const record=await client.createdRecord('calendar',saved,collection)
  assert.equal(record.title,'Focus');assert.equal(record.remote.uid,saved.uid);assert.equal(record.readonly,true);assert.match(record.creationWarning,/do not create it again/)
  assert.equal(calls.filter(call=>call.method==='PUT').length,1)
  assert.equal(calls.length,3)
})

test('new Deck card uses one native create with selected stack, range, checklist and explicit self assignment',async()=>{
  let card
  const {client,calls}=clientFixture((url,options)=>{
    if(options.method==='POST'){
      assert.equal(url,`${server}/index.php/apps/deck/api/v1.0/boards/2/stacks/3/cards`)
      const body=JSON.parse(options.body);assert.equal(body.type,'plain');assert.deepEqual(body.users,[{id:'alex',type:0}]);assert.equal(body.description,'- [ ] First step')
      card=nativeCard({...body,assignedUsers:[{participant:{uid:'alex'},type:0}]});return reply({...card,assignedUsers:null})
    }
    assert.match(url,/\/cards\/10$/);return reply(card)
  })
  const saved=await client.createCard({title:'Created card',stackId:'3',description:'- [ ] First step',start:'2026-11-02',due:'2026-11-02',assignToMe:true},board)
  const record=await client.createdRecord('deck',saved,board)
  assert.equal(record.start,'2026-11-01T23:00:00.000Z');assert.equal(record.due,'2026-11-02T22:59:00.000Z');assert.deepEqual(record.assigneeIds,['alex']);assert.equal(record.stackId,'3');assert.equal(record.status,'To do');assert.equal(record.body,'- [ ] First step');assert.equal(saved.warning,undefined);assert.equal(calls.length,4)
})

test('Deck creation rejects unavailable stacks, bad dates and excessive title before a request',async()=>{
  const {client,calls}=clientFixture(()=>assert.fail('Invalid input must not create'))
  for(const input of [{stackId:'7'},{stackId:'3',title:'x'.repeat(256)},{stackId:'3',start:'2026-11-03',due:'2026-11-02'},{stackId:'3',start:'2026-02-30'}])await assert.rejects(client.createCard({title:'Card',...input},board),{code:'VALIDATION'})
  await assert.rejects(client.createCard({title:'Card',stackId:'3'},{...board,readonly:true}),{code:'VALIDATION'})
  assert.equal(calls.length,0)
})

test('Deck servers that omit requested fields return the existing card with a warning, never a second create',async()=>{
  const {client,calls}=clientFixture(()=>reply(nativeCard()))
  const saved=await client.createCard({title:'Created card',stackId:'3',start:'2026-11-02',assignToMe:true},board)
  assert.equal(saved.record.remote.nativeId,10);assert.equal(saved.record.start,undefined);assert.match(saved.warning,/start date and assignment/)
  assert.equal(calls.filter(call=>call.method==='POST').length,1)
})

test('Deck creation read failure retains the created card identity and disables editing until refresh',async()=>{
  const {client,calls}=clientFixture((url,options)=>options.method==='POST'?reply(nativeCard()):reply('',503))
  const saved=await client.createCard({title:'Created card',stackId:'3'},board)
  assert.equal(saved.record.remote.nativeId,10);assert.equal(saved.record.readonly,true);assert.match(saved.warning,/do not create it again/)
  assert.equal(calls.length,4)
})

test('Notes distinguish a literal Uncategorized category from the empty default and preserve native identity after creation',async()=>{
  const notes=[{id:1,title:'Default',category:'',content:'Default note',etag:'1'},{id:2,title:'Named',category:'Uncategorized',content:'Named note',etag:'2'}]
  const {client,calls}=clientFixture((url,options)=>{
    if(options.method==='POST'){const payload=JSON.parse(options.body);assert.equal(payload.category,'Uncategorized');return reply({...payload,id:3,etag:'3'})}
    return reply(notes)
  })
  const read=await client.readNotes()
  assert.deepEqual(read.collections.map(c=>c.title),['Uncategorized (default)','Uncategorized'])
  assert.notEqual(read.collections[0].id,read.collections[1].id)
  const saved=await client.createNote({title:'New',content:'Text',category:read.collections[1].remote.category})
  const record=await client.createdRecord('notes',saved,read.collections[1])
  assert.equal(record.collectionId,read.collections[1].id);assert.equal(record.remote.nativeId,3);assert.equal(record.body,'Text');assert.ok(record.identity.key);assert.equal(calls.length,2)
})
