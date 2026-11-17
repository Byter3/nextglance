import assert from 'node:assert/strict'
import test from 'node:test'
import {linkedWorkSessions, scheduledWorkFor, eventConflicts, defaultCalendarForRecord} from '@nextspace/core/scheduling.mjs'

process.env.TZ='Europe/Budapest'
const event=(id,start='2026-11-04T10:00:00+01:00',end='2026-11-04T11:00:00+01:00',extra={})=>({id,kind:'event',title:id,start,end,...extra})
const ids=values=>values.map(value=>value.id)
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}

test('busy event intervals are half-open and task or planner ranges are not reservations',()=>{
  const candidate=event('chosen')
  const records=[
    candidate,
    event('touching-before','2026-11-04T09:00:00+01:00','2026-11-04T10:00:00+01:00'),
    event('overlap','2026-11-04T10:30:00+01:00','2026-11-04T11:30:00+01:00'),
    event('touching-after','2026-11-04T11:00:00+01:00','2026-11-04T12:00:00+01:00'),
    {id:'task-span',kind:'task',start:'2026-11-01',due:'2026-11-08',end:'2026-11-08'},
    {id:'card-span',kind:'card',start:'2026-11-01',due:'2026-11-08',end:'2026-11-08'},
    {id:'metadata-plan',recordId:'task-span',start:candidate.start,end:candidate.end},
  ]
  assert.deepEqual(ids(eventConflicts(candidate,records)),['overlap'])
  assert.deepEqual(eventConflicts(records[4],records),[])
  assert.deepEqual(ids(eventConflicts({...candidate,id:'new-draft'},[candidate])),['chosen'],'A distinct draft checks the existing event')
})

test('linking work to calendar events does not hide a collision between two real bookings',()=>{
  const work={id:'work',kind:'task',title:'Work'}
  const first=event('first'),second=event('second')
  const relations=[{id:'r1',type:'scheduled_during',fromId:'work',toId:'first'},{id:'r2',type:'scheduled_during',fromId:'work',toId:'second'}]
  const records=[work,first,second]
  assert.equal(linkedWorkSessions('work',records,relations).length,2)
  assert.deepEqual(ids(eventConflicts(first,records)),['second'])
  assert.deepEqual(ids(eventConflicts(second,records)),['first'])
})

test('free, transparent, canceled and repeated events do not create false busy warnings',()=>{
  const slot=event('slot')
  const records=[event('free',undefined,undefined,{busy:false}),event('transparent',undefined,undefined,{transparency:'TRANSPARENT'}),event('canceled',undefined,undefined,{status:' cancelled '}),event('busy'),event('busy')]
  assert.deepEqual(ids(eventConflicts(slot,records)),['busy'])
  for(const extra of [{busy:false},{status:'CANCELLED'},{transparency:'transparent'}])assert.deepEqual(eventConflicts({...slot,...extra},[event('busy')]),[])
})

test('invalid, missing, reversed and zero-length dates are ignored',()=>{
  const slot=event('slot')
  const malformed=[event('invalid','not a date'),event('missing',undefined,undefined,{end:undefined}),event('zero',slot.start,slot.start),event('reversed',slot.end,slot.start),event('impossible-date','2026-02-30','2026-03-03')]
  assert.deepEqual(eventConflicts(slot,malformed),[])
  for(const value of malformed)assert.deepEqual(eventConflicts(value,[slot]),[])
  assert.deepEqual(eventConflicts(undefined,[slot]),[])
  assert.deepEqual(eventConflicts(slot,undefined),[])
})

test('timed events compare actual instants across timezone offsets and autumn DST',()=>{
  // Budapest repeats 02:00 on 25 October 2026; these two 02:15 labels are an hour apart.
  const first=event('summer-offset','2026-10-25T02:00:00+02:00','2026-10-25T02:30:00+02:00')
  const later=event('winter-offset','2026-10-25T02:15:00+01:00','2026-10-25T02:45:00+01:00')
  const sameInstant=event('utc','2026-10-25T00:15:00Z','2026-10-25T00:45:00Z')
  assert.deepEqual(ids(eventConflicts(first,[later,sameInstant])),['utc'])
  assert.deepEqual(ids(eventConflicts(later,[first,sameInstant])),[])
})

test('all-day dates use local midnight and an exclusive end across DST',()=>{
  const allDay=event('all-day','2026-10-25','2026-10-26',{allDay:true})
  const events=[
    event('before','2026-10-24T22:00:00+02:00','2026-10-25T00:00:00+02:00'),
    event('start','2026-10-25T00:00:00+02:00','2026-10-25T00:30:00+02:00'),
    event('last-hour','2026-10-25T23:00:00+01:00','2026-10-26T00:00:00+01:00'),
    event('next-day','2026-10-26T00:00:00+01:00','2026-10-26T01:00:00+01:00'),
  ]
  assert.deepEqual(ids(eventConflicts(allDay,events)),['start','last-hour'])
  assert.deepEqual(eventConflicts(event('next','2026-10-26','2026-10-27',{allDay:true}),[allDay]),[])
})

test('work session projections are stable, deduplicated and use only scheduled_during associations',()=>{
  const records=freeze([
    {id:'task',kind:'task',title:'Zulu task'}, {id:'card',kind:'card',title:'Alpha card'}, {id:'note',kind:'note',title:'Note'},
    event('late','2026-11-04T14:00:00+01:00','2026-11-04T15:00:00+01:00'),event('early'),event('context'),
  ])
  const edge=(id,type,fromId,toId)=>({id,type,fromId,toId})
  const relations=freeze([
    edge('late','scheduled_during','task','late'),edge('early','scheduled_during','task','early'),edge('duplicate','scheduled_during','task','early'),
    edge('card','scheduled_during','card','early'),edge('context','for_event','task','context'),edge('wrong-kind','scheduled_during','note','early'),
    edge('missing','scheduled_during','task','unavailable'),edge('wrong-end','scheduled_during','task','note'),
  ])
  const sessions=linkedWorkSessions('task',records,relations)
  assert.deepEqual(sessions.map(value=>value.event.id),['early','late'])
  assert.equal(sessions[0].relation.id,'early')
  assert.equal(sessions[0].event,records[4],'Projection retains the source event, without copying or changing it')
  assert.deepEqual(scheduledWorkFor('early',records,relations).map(value=>value.record.id),['card','task'])
  assert.deepEqual(linkedWorkSessions('note',records,relations),[])
  assert.deepEqual(scheduledWorkFor('note',records,relations),[])
})

test('calendar defaults follow explicit project membership, project sources and configured space defaults',()=>{
  const collections=freeze([{id:'fallback',source:'calendar'}, {id:'space-cal',source:'calendar'}, {id:'project-cal',source:'calendar'}, {id:'explicit-cal',source:'calendar'}])
  const workspace=freeze({spaces:[{id:'space',collectionIds:['tasks','space-cal'],defaultCalendarId:'space-cal'}],projects:[
    {id:'source-project',spaceId:'space',collectionIds:['board','project-cal'],recordIds:[]},
    {id:'explicit-project',spaceId:'space',collectionIds:['explicit-cal'],recordIds:['chosen-card']},
  ]})
  assert.equal(defaultCalendarForRecord({id:'chosen-card',kind:'card',collectionId:'board'},workspace,collections,'space'),'explicit-cal')
  assert.equal(defaultCalendarForRecord({id:'another-card',kind:'card',collectionId:'board'},workspace,collections,'space'),'project-cal')
  assert.equal(defaultCalendarForRecord({id:'task',kind:'task',collectionId:'tasks'},workspace,collections,'space'),'space-cal')
  assert.equal(defaultCalendarForRecord({id:'event',kind:'event',collectionId:'project-cal'},workspace,collections),'project-cal')
})

test('calendar defaults exclude readonly sources, ignore title guesses and return undefined when none are writable',()=>{
  const collections=freeze([{id:'readonly',source:'calendar',title:'Personal',readonly:true},{id:'fallback',source:'calendar',title:'Unrelated'}, {id:'matched-title',source:'calendar',title:'Personal'}, {id:'tasks',source:'tasks',title:'Personal'}])
  const workspace=freeze({spaces:[{id:'space',collectionIds:['tasks','readonly'],defaultCalendarId:'readonly'}],projects:[{id:'archived',spaceId:'space',collectionIds:['matched-title'],recordIds:['task'],archived:true}]})
  assert.equal(defaultCalendarForRecord({id:'task',kind:'task',collectionId:'tasks',collectionTitle:'Personal'},workspace,collections),undefined)
  assert.equal(defaultCalendarForRecord({id:'task',kind:'task',collectionId:'tasks'},workspace,collections.filter(value=>value.readonly||value.source==='tasks')),undefined)
  const staleDefault={spaces:[{id:'space',collectionIds:['tasks','matched-title'],defaultCalendarId:'fallback'}],projects:[]}
  assert.equal(defaultCalendarForRecord({id:'task',kind:'task',collectionId:'tasks'},staleDefault,collections,'space'),'matched-title','A removed default is not treated as current scope membership')
})
