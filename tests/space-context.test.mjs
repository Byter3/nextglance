import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmptyState, selectPlanner, scopeRecordIds, scopeContextRecordIds} from '@nextspace/core/planner.mjs'
import {timelineGroups, recordGrouping} from '@nextspace/core/timeline.mjs'
import {defaultCalendarForRecord} from '@nextspace/core/scheduling.mjs'

function fixture() {
  const state=createEmptyState()
  state.connection={connected:true,username:'me',serverUrl:'https://fixture.invalid'}
  state.workspace.planner.assignment='all'
  state.collections=[
    {id:'tasks',title:'Personal',source:'tasks',color:'#123456'},
    {id:'board',title:'Personal',source:'deck',color:'#abcdef'},
    {id:'calendar',title:'Appointments',source:'calendar',color:'#112233'},
    {id:'other-calendar',title:'Bookings',source:'calendar',color:'#445566'},
  ]
  state.records=[
    {id:'task',kind:'task',source:'tasks',title:'Task',collectionId:'tasks',due:'2026-11-15'},
    {id:'card',kind:'card',source:'deck',title:'Card',collectionId:'board',assignmentKnown:true,assigneeIds:['me']},
    {id:'unassigned',kind:'card',source:'deck',title:'Unassigned',collectionId:'board',assignmentKnown:true,assigneeIds:[]},
    {id:'event',kind:'event',source:'calendar',title:'Event',collectionId:'calendar',start:'2026-11-15T10:00:00Z',end:'2026-11-15T11:00:00Z'},
    {id:'context-event',kind:'event',source:'calendar',title:'Context',collectionId:'other-calendar',start:'2026-11-15T12:00:00Z',end:'2026-11-15T13:00:00Z'},
    {id:'note',kind:'note',source:'notes',title:'Brief',collectionId:'notes'},
  ]
  state.workspace.spaces=[
    {id:'daily',name:'Daily life',color:'#123456',collectionIds:['tasks','board','calendar'],defaultCalendarId:'calendar'},
    {id:'planning',name:'Planning',color:'#abcdef',collectionIds:['board','other-calendar'],defaultCalendarId:'other-calendar'},
  ]
  state.workspace.categories=[
    {id:'personal',spaceId:'daily',name:'Personal',color:'#123456',collectionIds:['tasks','board','calendar']},
    {id:'home',spaceId:'planning',name:'Home',color:'#abcdef',collectionIds:['board','other-calendar']},
  ]
  state.workspace.projects=[{id:'gig',spaceId:'daily',categoryId:'personal',name:'Client gig',collectionIds:['tasks'],recordIds:['card']}]
  state.workspace.relations=[
    {id:'booking',type:'scheduled_during',fromId:'card',toId:'context-event'},
    {id:'brief',type:'reference',fromId:'task',toId:'note'},
  ]
  return state
}
const options=state=>({...state.workspace,collections:state.collections,scopeId:'all'})
const overview=state=>{
  const model=selectPlanner(state,{scopeId:'all',now:'2026-11-11T10:00:00Z'})
  return {records:model.records,actions:model.actions,events:model.events,counts:model.counts,contextRecordIds:model.contextRecordIds,groups:timelineGroups(model.records,options(state)),location:recordGrouping(state.records[1],options(state)),destination:defaultCalendarForRecord(state.records[1],state.workspace,state.collections,'all')}
}

test('My overview membership, groups, colors, context and destinations ignore all organization mutations',()=>{
  const state=fixture(),expected=overview(state)
  assert.deepEqual(expected.groups.map(group=>[group.id,group.name,group.color]),[
    ['collection:tasks','Personal · Task list','#123456'],['collection:board','Personal · Deck board','#abcdef'],
  ])
  const changes=[
    value=>{value.workspace.spaces.reverse();value.workspace.categories.reverse();value.workspace.projects.reverse()},
    value=>{value.workspace.spaces[0].name='Renamed';value.workspace.spaces[0].collectionIds=[];value.workspace.categories[0].color='#ee1122';value.workspace.categories[0].name='New group';value.workspace.projects[0].recordIds=['task']},
    value=>{value.workspace.spaces.push({id:'new',name:'New',color:'#998877',collectionIds:['tasks','board','calendar'],defaultCalendarId:'other-calendar'});value.workspace.categories.push({id:'new-group',spaceId:'new',name:'All work',color:'#112233',collectionIds:['board']})},
    value=>{value.workspace.spaces=[];value.workspace.categories=[];value.workspace.projects=[]},
    value=>{value.workspace.planner.excludedSpaceIds=['daily','planning']},
  ]
  for(const change of changes){const changed=structuredClone(state);change(changed);assert.deepEqual(overview(changed),expected)}
})

test('same source has independent group identity and calendar context in each selected Space',()=>{
  const state=fixture(),card=state.records[1]
  // Remove curated project precedence to exercise the source's two groups.
  state.workspace.projects=[]
  const daily={...options(state),scopeId:'daily'},planning={...options(state),scopeId:'planning'}
  assert.equal(recordGrouping(card,daily).category.id,'personal')
  assert.equal(recordGrouping(card,planning).category.id,'home')
  assert.equal(defaultCalendarForRecord(card,state.workspace,state.collections,'daily'),'calendar')
  assert.equal(defaultCalendarForRecord(card,state.workspace,state.collections,'planning'),'other-calendar')
  const before=timelineGroups([card],planning)
  state.workspace.categories[0].name='Private';state.workspace.categories[0].color='#ff0000';state.workspace.spaces[0].collectionIds=[]
  assert.deepEqual(timelineGroups([card],planning),before)
  assert.equal(recordGrouping(card,{...options(state),scopeId:'deleted'}).space,undefined)
  assert.deepEqual(timelineGroups([card],{...options(state),scopeId:'deleted'}),[])
  assert.equal(defaultCalendarForRecord(card,state.workspace,state.collections,'deleted'),undefined)
})

test('linked-context IDs distinguish resources from curated project membership without importing dependencies or sources',()=>{
  const state=fixture()
  state.records.push({id:'external-task',kind:'task',source:'tasks',title:'Prerequisite',collectionId:'external'})
  state.workspace.relations.push({id:'dep',type:'depends_on',fromId:'task',toId:'external-task'})
  const selected=selectPlanner(state,{scopeId:'gig'}),context=scopeContextRecordIds(state.workspace,state.records,'gig')
  assert.deepEqual([...context].sort(),['context-event','note'])
  assert.deepEqual([...selected.contextRecordIds].sort(),['context-event','note'])
  assert.ok(selected.actions.some(record=>record.id==='card'),'Curated individual work remains primary')
  assert.ok(!scopeRecordIds(state.workspace,state.records,'gig').has('unassigned'),'A curated item does not import its whole board')
  assert.ok(!scopeRecordIds(state.workspace,state.records,'gig').has('external-task'),'Dependencies do not import work')
  assert.equal(recordGrouping(state.records.find(record=>record.id==='context-event'),{...options(state),scopeId:'gig'}).category,undefined)
  assert.deepEqual(selectPlanner(state,{scopeId:'all'}).contextRecordIds,[])
})

test('global calendar choice is single-writable only and explicit projects retain narrower boundaries',()=>{
  const state=fixture(),work=state.records[0]
  assert.equal(defaultCalendarForRecord(work,state.workspace,state.collections),undefined)
  assert.equal(defaultCalendarForRecord(work,state.workspace,state.collections,'all'),undefined)
  assert.equal(defaultCalendarForRecord(work,state.workspace,state.collections,'gig'),undefined,'A project with no calendar must ask rather than use its parent Space')
  state.collections.find(collection=>collection.id==='other-calendar').readonly=true
  assert.equal(defaultCalendarForRecord(work,state.workspace,state.collections,'all'),'calendar')
  assert.equal(defaultCalendarForRecord(state.records[3],state.workspace,state.collections,'all'),'calendar')
  state.collections.find(collection=>collection.id==='calendar').readonly=true
  assert.equal(defaultCalendarForRecord(work,state.workspace,state.collections,'all'),undefined)
})

test('destination navigation counts ignore the current scope temporary source and unassigned filters',()=>{
  const state=fixture()
  state.workspace.planner.scopeAssignments.planning='me'
  const expected=selectPlanner(state,{scopeId:'daily'}).spaces.map(space=>[space.id,space.openCount])
  const filtered=selectPlanner(state,{scopeId:'daily',hiddenCollectionIds:['board'],includeUnassigned:true,unassignedBoardIds:['board'],assignment:'all'})
  assert.deepEqual(filtered.spaces.map(space=>[space.id,space.openCount]),expected)
  assert.equal(filtered.spaces.find(space=>space.id==='planning').openCount,1)
})
