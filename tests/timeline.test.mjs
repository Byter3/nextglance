import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {indexTimelineEvents, timelineDayEvents, timelineEvents, timelineGroups, timelineGeometry, timelineInterval, timelineOffset, timelineStatus} from '@nextspace/core/timeline.mjs'

const flatten = groups => groups.flatMap(group => [...group.records, ...flatten(group.children)])
const task = (id, collectionId) => ({id, collectionId, kind:'task', source:'tasks', title:id})

test('timeline uses actual source collections when the user has not created Spaces', () => {
  const records = [task('t','tasks-personal'), {id:'e',collectionId:'cal-personal',kind:'event',source:'calendar',title:'Appointment'}, {id:'n',kind:'note',source:'notes'}]
  const groups = timelineGroups(records,{collections:[{id:'tasks-personal',title:'Personal',source:'tasks'},{id:'cal-personal',title:'Personal',source:'calendar'}]})
  assert.equal(groups.length,1)
  assert.deepEqual(groups.map(group=>group.source),['tasks'])
  assert.deepEqual(flatten(groups).map(record=>record.id),['t'])
})

test('an explicitly scoped timeline nests work under its own Space and projects', () => {
  const records = [task('t','tasks'),task('project-item','board'),{id:'e',kind:'event',source:'calendar',collectionId:'cal'}]
  const spaces = [{id:'work',name:'Freelance',collectionIds:['tasks','cal','board']},{id:'shared',name:'Shared',collectionIds:['tasks','board']}]
  const projects = [{id:'film',name:'Client film',spaceId:'work',collectionIds:['board'],recordIds:[]}]
  const groups = timelineGroups([...records,records[0]],{spaces,projects,scopeId:'work'})
  assert.deepEqual(groups.map(group=>group.name),['Freelance'])
  assert.equal(groups[0].children[0].name,'Client film')
  assert.equal(groups[0].children[0].depth,1)
  assert.equal(groups[0].count,2)
  assert.deepEqual(new Set(flatten(groups).map(record=>record.id)),new Set(['t','project-item']))
  assert.equal(flatten(groups).length,2)
})

test('explicit project membership wins over broad source membership and archived projects are ignored', () => {
  const spaces = [{id:'work',name:'Work',collectionIds:['tasks']}]
  const projects = [{id:'archived',name:'Old',spaceId:'work',archived:true,recordIds:['t']},{id:'broad',name:'Broad',spaceId:'work',collectionIds:['tasks']},{id:'specific',name:'Specific',spaceId:'work',recordIds:['t']}]
  const groups = timelineGroups([task('t','tasks')],{spaces,projects,scopeId:'work'})
  assert.deepEqual(groups[0].children.map(group=>group.name),['Specific'])
})

test('scoped timeline keeps related context under the chosen project', () => {
  const spaces = [{id:'work',name:'Work',collectionIds:['tasks']}]
  const projects = [{id:'project',name:'Delivery',spaceId:'work',recordIds:['t']}]
  const records = [task('t','tasks'),{id:'e',kind:'event',source:'calendar',collectionId:'other-calendar'}]
  const groups = timelineGroups(records,{spaces,projects,scopeId:'project'})
  assert.equal(groups[0].children[0].count,1)
  assert.deepEqual(flatten(groups).map(record=>record.id),['t'])
})

test('deadline-only and undated work never receive an invented Gantt duration', () => {
  const anchor = new Date(2026,10,2)
  assert.deepEqual(timelineGeometry({...task('a','tasks'),due:'2026-11-03'},anchor),{bar:null,point:{offset:1.5,kind:'due'},scheduled:true,visible:true})
  assert.deepEqual(timelineGeometry(task('b','tasks'),anchor),{bar:null,point:null,scheduled:false,visible:false})
  const startOnly = timelineGeometry({...task('c','tasks'),start:'2026-11-04'},anchor)
  assert.equal(startOnly.bar,null)
  assert.equal(startOnly.point.kind,'start')
})

test('all-day events have exclusive ends and do not spill into the next window', () => {
  const record = {kind:'event',start:'2026-11-01',end:'2026-11-02',allDay:true}
  assert.equal(timelineGeometry(record,new Date(2026,10,2)).visible,false)
  const span = timelineGeometry({...record,start:'2026-11-02',end:'2026-11-04'},new Date(2026,10,2)).bar
  assert.deepEqual(span,{start:0,end:2,clippedStart:false,clippedEnd:false})
})

test('calendar spans and work sessions clip to the displayed range without changing their source dates', () => {
  const anchor = new Date(2026,10,2)
  assert.deepEqual(timelineInterval('2026-11-01','2026-11-20',anchor,14),{start:0,end:14,clippedStart:true,clippedEnd:true})
  assert.equal(timelineInterval('2026-11-01','2026-11-02',anchor),null)
  assert.equal(timelineInterval('2026-11-04','2026-11-03',anchor),null)
  assert.equal(timelineGeometry({kind:'event',start:'2026-11-16',end:'2026-11-17'},anchor,14).visible,false)
})

test('vertical calendar bands preserve timed duration and exclude events ending at the window boundary', () => {
  const timed={id:'session',kind:'event',source:'calendar',title:'Edit session',start:'2026-11-03T10:00:00',end:'2026-11-03T12:00:00'}
  const old={id:'old',kind:'event',source:'calendar',title:'Yesterday',start:'2026-11-01',end:'2026-11-02',allDay:true}
  const layout=timelineEvents([timed,timed,old,task('task','tasks')],new Date(2026,10,2),7,700)
  assert.equal(layout.entries.length,1)
  assert.equal(layout.entries[0].record.id,'session')
  assert.ok(Math.abs(layout.entries[0].range.end-layout.entries[0].range.start-2/24)<1e-10)
  assert.equal(layout.entries[0].range.start,1+10/24)
  assert.ok(layout.entries[0].labelWidth>2/24/7*700,'Readable labels must not inflate the actual event duration')
  assert.ok(Math.abs(layout.entries[0].labelLeft+layout.entries[0].labelWidth/2-(1+11/24)/7*700)<1e-10,'Short booking labels center over their band')
})

test('calendar window index preserves exact clipping, point fallback, ordering and label lanes', () => {
  const event=(id,start,end,extra={})=>({id,kind:'event',source:'calendar',title:'Booking',start,end,...extra})
  const records=[
    event('span','2026-01-01','2026-12-01'),
    event('exclusive','2026-10-14','2026-10-24'),
    event('timed-a','2026-10-25T09:00:00','2026-10-25T10:00:00'),
    event('timed-b','2026-10-25T09:00:00','2026-10-25T10:00:00'),
    event('duplicate','2026-10-25','2026-10-26'),
    event('duplicate','1950-01-01','1950-01-02'),
    event('point','2026-10-27'),
    event('fallback-due','2026-10-27','2026-10-28',{due:'2026-11-01'}),
    event('invalid-start','invalid','2026-10-28',{due:'2026-11-03'}),
    event('zone','2026-10-25T23:55:00+01:00','2026-10-26T01:30:00+01:00'),
    task('work','tasks'),
  ]
  const candidates=indexTimelineEvents(records)
  for(const anchor of ['1950-01-01','2026-10-24','2026-10-25','2026-10-27','2026-11-01','2026-12-01']){
    for(const days of [1,7,28]){
      assert.deepEqual(timelineEvents(candidates(anchor,days),anchor,days,500),timelineEvents(records,anchor,days,500))
    }
  }
})

test('panning the calendar window lays out candidates without re-reading distant history', () => {
  let historicalDateReads=0
  const history=Array.from({length:10000},(_,index)=>{
    const start=new Date(Date.UTC(1950,0,1+index)).toISOString().slice(0,10)
    const end=new Date(Date.UTC(1950,0,2+index)).toISOString().slice(0,10)
    return {id:`history-${index}`,kind:'event',title:`Archived booking ${index}`,get start(){historicalDateReads++;return start},get end(){historicalDateReads++;return end}}
  })
  const long={id:'long',kind:'event',title:'Continuing interval',start:'1950-01-01',end:'2026-12-01'}
  const appointment={id:'current',kind:'event',title:'Current booking',start:'2026-11-19',end:'2026-11-20'}
  const candidates=indexTimelineEvents([long,...history,appointment])
  assert.equal(historicalDateReads,20000)
  for(const anchor of ['2026-11-12','2026-11-17','2026-11-24']){
    const relevant=candidates(anchor,14)
    assert.deepEqual(timelineEvents(relevant,anchor,14).entries.map(entry=>entry.record.id),anchor==='2026-11-24'?['long']:['long','current'])
  }
  assert.equal(historicalDateReads,20000)
})

test('day agendas retain calendar order, timed points and exclusive interval ends', () => {
  const events=[
    {record:{id:'clipped'},range:{start:0,end:.3}},
    {record:{id:'spanning'},range:{start:0,end:2}},
    {record:{id:'midnight'},range:{start:1,end:1}},
    {record:{id:'timed-point'},range:{start:1.5,end:1.5}},
    {record:{id:'last-day'},range:{start:2,end:3}},
  ]
  assert.deepEqual(timelineDayEvents(events,3).map(day=>day.map(event=>event.record.id)),[
    ['clipped','spanning'],['spanning','timed-point'],['last-day'],
  ])
})

test('overlapping event labels use bounded collision-free lanes and keep overflow events available', () => {
  const records=Array.from({length:12},(_,index)=>({id:`event-${index}`,kind:'event',source:'calendar',title:`Meeting ${index}`,start:'2026-11-03T10:00:00',end:'2026-11-03T11:00:00'}))
  records.push({id:'later',kind:'event',source:'calendar',title:'Later appointment',start:'2026-11-06T12:00:00',end:'2026-11-06T13:00:00'})
  const layout=timelineEvents(records,new Date(2026,10,2),7,700,3)
  assert.equal(layout.entries.length,13)
  assert.equal(layout.lanes,3)
  assert.equal(layout.overflow.length,9)
  assert.ok(layout.overflow.every(entry=>entry.lane===-1&&entry.overflow))
  for(let lane=0;lane<layout.lanes;lane++){
    const items=layout.entries.filter(entry=>entry.lane===lane)
    for(let index=1;index<items.length;index++)assert.ok(items[index].labelLeft>=items[index-1].labelLeft+items[index-1].labelWidth+8)
  }
  assert.deepEqual(new Set(layout.entries.map(entry=>entry.record.id)),new Set(records.map(record=>record.id)))
})

test('calendar header labels remain within very small viewports and clipped events remain available', () => {
  const records=[{id:'long',kind:'event',source:'calendar',title:'Long running event',start:'2026-11-01',end:'2026-11-20',allDay:true}]
  const layout=timelineEvents(records,new Date(2026,10,2),14,90)
  assert.deepEqual(layout.entries[0].range,{start:0,end:14,clippedStart:true,clippedEnd:true})
  assert.equal(layout.entries[0].labelLeft,0)
  assert.equal(layout.entries[0].labelWidth,90)
})

test('timeline status uses native completion and Deck stacks without guessing from custom names', () => {
  const collections = [{id:'deck',stacks:[{id:'review',title:'Client review'}]}]
  const card = {kind:'card',collectionId:'deck',stackId:'review',status:'Old label'}
  assert.equal(timelineStatus(card,collections),'Client review')
  assert.equal(timelineStatus({...card,completed:true},collections),'Done')
  assert.equal(timelineStatus({kind:'task',status:'CANCELLED'}),'Cancelled')
  assert.equal(timelineStatus({kind:'task',status:'IN-PROCESS'}),'In progress')
  assert.equal(timelineStatus({kind:'card',status:'Done',completed:false}),'Done')
  assert.equal(card.completed,undefined)
})

test('timeline calendar columns retain local day offsets across the Budapest DST change', () => {
  const result = spawnSync(process.execPath,['--input-type=module','-e',`import {timelineOffset} from '@nextspace/core/timeline.mjs'; console.log(timelineOffset('2026-10-26T09:00:00',new Date(2026,9,24)))`],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,TZ:'Europe/Budapest'}})
  assert.equal(result.status,0,result.stderr)
  assert.equal(Number(result.stdout.trim()),2.375)
  assert.ok(Number.isNaN(timelineOffset(undefined,new Date())))
})
