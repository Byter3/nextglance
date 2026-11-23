import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeWidgetConfig,widgetCatalog,widgetPlannerContext,projectWidget,projectWidgets,validateWidgetIntent,widgetNavigation} from '@nextspace/core/widgets.mjs'
import {statusSourceKey} from '@nextspace/core/status-mapping.mjs'

const options={accountKey:'fixture-account',now:'2026-11-23T12:00:00Z',timeZone:'UTC',locale:'en-GB'}
const config=(overrides={})=>normalizeWidgetConfig({widgetId:1,accountKey:options.accountKey,...overrides})
const itemIds=snapshot=>snapshot.rows.filter(row=>row.type==='item').map(row=>row.recordId)
function fixture(){return {
  workspace:{spaces:[{id:'work',name:'Work',collectionIds:['work-cal','work-tasks','work-deck']}],categories:[],projects:[],relations:[{id:'link',type:'depends_on',fromId:'card',toId:'task-done'}],plans:[],planner:{hiddenCollectionIds:['work-cal'],assignment:'me',scopeId:'work',view:'list'}},
  records:[
    {id:'event',kind:'event',source:'calendar',collectionId:'work-cal',title:'Design review',start:'2026-11-23T14:00:00Z',end:'2026-11-23T15:00:00Z'},
    {id:'other-event',kind:'event',source:'calendar',collectionId:'home-cal',title:'Club meeting',start:'2026-11-24T18:00:00Z',end:'2026-11-24T19:00:00Z'},
    {id:'task',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Prepare notes',due:'2026-11-23',tags:['Launch']},
    {id:'task-done',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Collect questions',due:'2026-11-23',completed:true},
    {id:'undated',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Review ideas'},
    {id:'card',kind:'card',source:'deck',collectionId:'work-deck',stackId:'doing',title:'Release guide',start:'2026-11-23',due:'2026-11-27',tags:['Launch']},
    {id:'done-card',kind:'card',source:'deck',collectionId:'work-deck',stackId:'doing',title:'Finished guide',due:'2026-11-23',completed:true},
  ],
  collections:[{id:'work-cal',source:'calendar',title:'Work calendar',color:'#0082c9'},{id:'home-cal',source:'calendar',title:'Home calendar'},{id:'work-tasks',source:'tasks',title:'Work tasks'},{id:'work-deck',source:'deck',title:'Delivery board',stacks:[{id:'doing',title:'Doing'}]}],
  statuses:[{source:'calendar',state:'connected',lastSyncedAt:'2026-11-23T10:00:00Z'},{source:'tasks',state:'connected',lastSyncedAt:'2026-11-23T11:00:00Z'},{source:'deck',state:'connected',lastSyncedAt:'2026-11-23T09:00:00Z'}],connection:{connected:true,username:'fixture'},storage:{lastSyncedAt:'2026-11-23T08:00:00Z'}
}}
test('widget badges retain their displayed civil day for weekend shading',()=>{
  const state=fixture()
  const event=state.records.find(record=>record.id==='event')
  event.start='2026-11-27T23:30:00Z'
  event.end='2026-11-28T00:30:00Z'
  const calendar=projectWidget(state,config({page:'calendar'}),{...options,timeZone:'Europe/Budapest'})
  assert.equal(calendar.rows.find(row=>row.recordId==='event').dateKey,'2026-11-28')
  const board=projectWidget(state,config({page:'board'}),options)
  assert.equal(board.rows.find(row=>row.recordId==='card').dateKey,'2026-11-27')
  assert.equal(board.rows.find(row=>row.recordId==='undated').dateKey,undefined)
})
test('independent normalized settings retain no mutable input references',()=>{
  const selected=['work-cal'],a=config({page:'calendar',collectionIds:selected,sourceMode:'selected'}),b=config({widgetId:2,page:'board'})
  selected.push('home-cal');assert.deepEqual(a.collectionIds,['work-cal']);assert.deepEqual(b.kinds,['task','card']);assert.equal(a.transparency,32)
  assert.equal(normalizeWidgetConfig({widgetId:1,accountKey:'a',version:3}),null)
  assert.equal(normalizeWidgetConfig({widgetId:1,accountKey:'a'},{accountKey:'b'}),null)
  assert.equal(normalizeWidgetConfig({widgetId:-1,accountKey:'a'}),null)
  assert.equal(normalizeWidgetConfig({widgetId:1,accountKey:'a',generation:0}),null)
  assert.deepEqual(config({page:'board',kinds:['event','card','card']}).kinds,['card'])
})
test('separate widgets use their own filters and ignore saved app filters',()=>{
  const state=fixture(),before=structuredClone(state)
  const result=projectWidgets(state,[config({page:'calendar'}),config({widgetId:2,page:'list',scopeId:'work'})],options)
  assert.deepEqual(itemIds(result[0]),['event','other-event']);assert.deepEqual(itemIds(result[1]),['task','undated']);assert.deepEqual(state,before)
})
test('missing Space, source and foreign account fail closed',()=>{
  const state=fixture()
  for(const c of [config({scopeId:'gone'}),config({sourceMode:'selected',collectionIds:['gone']}),config({scopeId:'work',sourceMode:'selected',collectionIds:['home-cal']})]){const result=projectWidget(state,c,options);assert.equal(result.state,'unavailable');assert.deepEqual(result.rows,[])}
  assert.equal(projectWidget(state,config(),{...options,accountKey:'other'}).state,'unavailable')
})
test('event-only scope preserves native contextual event associations but exclusions win',()=>{
  const state=fixture();state.workspace.spaces[0].collectionIds=['work-deck'];state.workspace.relations.push({id:'calendar-link',type:'for_event',fromId:'card',toId:'event'})
  assert.deepEqual(itemIds(projectWidget(state,config({scopeId:'work',page:'calendar'}),options)),['event'])
  assert.deepEqual(itemIds(projectWidget(state,config({scopeId:'work',page:'calendar',sourceMode:'selected',collectionIds:['work-deck']}),options)),[])
})


test('Board preserves done Deck cards and only admits completed tasks through visible cards',()=>{
  const state=fixture(),c=config({page:'board',scopeId:'work'})
  const snapshot=projectWidget(state,c,options),linked=snapshot.rows.find(row=>row.recordId==='task-done')
  assert.ok(itemIds(snapshot).includes('done-card'));assert.equal(linked.parentId,'card');assert.equal(linked.direction,'incoming');assert.equal(linked.completed,true)
  assert.ok(!itemIds(projectWidget(state,{...c,query:'Collect questions'},options)).includes('task-done'))
  assert.ok(!itemIds(projectWidget(state,{...c,kinds:['task']},options)).includes('task-done'))
  assert.ok(!itemIds(projectWidget(state,{...c,sourceMode:'selected',collectionIds:['work-tasks']},options)).includes('task-done'))
})
test('status map, tag and project filters narrow current Space without overriding native status',()=>{
  const state=fixture();state.workspace.spaces[0].statusMapping={columns:[{id:'ready',title:'Ready',color:'#123456'}],assignments:{[statusSourceKey('deck','work-deck','doing')]:'ready'}}
  state.workspace.projects=[{id:'launch',spaceId:'work',name:'Launch',collectionIds:['work-deck','work-tasks'],recordIds:[],tagNames:['launch']}]
  const c=config({page:'board',scopeId:'work',statusIds:['ready'],projectIds:['launch'],tagNames:['LAUNCH']})
  const result=projectWidget(state,c,options);assert.deepEqual(itemIds(result),['card']);assert.equal(result.rows[0].title,'Ready');assert.equal(state.records.find(record=>record.id==='card').completed,undefined)
})
test('all configured Board headings survive empty selection and item bound',()=>{
  const state=fixture();state.records=Array.from({length:40},(_,i)=>({id:`task-${String(i).padStart(2,'0')}`,kind:'task',source:'tasks',collectionId:'work-tasks',title:`Task ${i}`}))
  const result=projectWidget(state,config({page:'board'}),options)
  assert.equal(itemIds(result).length,25);assert.equal(result.totalCount,40);assert.equal(result.truncated,true)
  assert.deepEqual(result.rows.filter(row=>row.type==='heading').map(row=>row.title),['Unmapped','To do','In progress','Done','Cancelled'])
  assert.equal(projectWidget(state,config({page:'board',query:'no match'}),options).rows.filter(row=>row.type==='heading').length,5)
})
test('all five pages use the shared work selection with dated-only time views',()=>{
  const state=fixture()
  for(const page of ['overview','calendar','timeline'])assert.ok(!itemIds(projectWidget(state,config({page,dateRange:'all'}),options)).includes('undated'))
  for(const page of ['board','list'])assert.ok(itemIds(projectWidget(state,config({page,dateRange:'all'}),options)).includes('undated'))
})

test('Overview summaries count the complete scoped selection beyond the launcher row budget',()=>{
  const state=fixture();state.records=[
    ...Array.from({length:30},(_,i)=>({id:`event-${i}`,kind:'event',source:'calendar',collectionId:'work-cal',title:`Review ${i}`,start:'2026-11-23T14:00:00Z',end:'2026-11-23T15:00:00Z'})),
    ...Array.from({length:5},(_,i)=>({id:`task-${i}`,kind:'task',source:'tasks',collectionId:'work-tasks',title:`Prepare ${i}`,due:'2026-11-23'})),
    {id:'excluded',kind:'event',source:'calendar',collectionId:'home-cal',title:'Club meeting',start:'2026-11-23T16:00:00Z',end:'2026-11-23T17:00:00Z'}]
  const c=config({page:'overview',scopeId:'work',kinds:['event','task']}),before=structuredClone({state,c}),result=projectWidget(state,c,options)
  assert.deepEqual(result.overview,{bookings:30,work:5});assert.equal(result.totalCount,35);assert.equal(itemIds(result).length,25);assert.equal(result.truncated,true)
  assert.equal(result.contextLabel,'Work · Calendar events + Tasks')
  assert.deepEqual(result.rows.filter(row=>row.type==='heading').map(row=>[row.title,row.sectionCount]),[['Work',5],['Ungrouped sources',5],['Calendar events',30]])
  assert.deepEqual({state,c},before)
  const empty=projectWidget(state,{...c,query:'no matching item'},options),unavailable=projectWidget(state,{...c,scopeId:'missing'},options)
  assert.deepEqual(empty.overview,{bookings:0,work:0});assert.equal(empty.state,'empty')
  assert.equal(unavailable.overview,undefined);assert.equal(unavailable.contextLabel,undefined);assert.equal(unavailable.state,'unavailable')
})

test('Calendar presentation separates ongoing ranges and preserves exclusive all-day end meaning',()=>{
  const state=fixture();state.records=[
    {id:'past',source:'calendar',kind:'event',collectionId:'work-cal',title:'Past booking',start:'2026-11-21',end:'2026-11-22',allDay:true},
    {id:'ongoing',source:'calendar',kind:'event',collectionId:'work-cal',title:'Conference',start:'2026-11-22',end:'2026-11-24',allDay:true},
    {id:'today',source:'calendar',kind:'event',collectionId:'work-cal',title:'Review',start:'2026-11-23T14:00:00Z',end:'2026-11-23T15:00:00Z'},
    {id:'task',source:'tasks',kind:'task',collectionId:'work-tasks',title:'Prepare notes',due:'2026-11-23'}]
  const result=projectWidget(state,config({page:'calendar',dateRange:'all',calendarLayout:'agenda',kinds:['event','task']}),options)
  assert.deepEqual(result.rows.filter(row=>row.type==='heading').map(row=>[row.id,row.title,row.sectionCount]),[['heading:overdue','Earlier',1],['heading:ongoing','Ongoing',1],['heading:2026-11-23','Today',2]])
  const ongoing=result.rows.find(row=>row.recordId==='ongoing'),today=result.rows.find(row=>row.recordId==='today'),task=result.rows.find(row=>row.recordId==='task')
  assert.equal(ongoing.leadingLabel,'All day');assert.equal(ongoing.secondaryLabel,'Work calendar · Through 23 Nov');assert.equal(ongoing.displayDay,'22 Nov – 23 Nov')
  assert.equal(today.leadingLabel,'14:00');assert.equal(today.secondaryLabel,'Work calendar · Until 15:00');assert.equal(today.displayDay,'23 Nov');assert.equal(today.trailingLabel,'')
  assert.equal(task.leadingLabel,'');assert.equal(task.trailingLabel,'Today');assert.equal(task.kind,'task')
  assert.equal(today.subtitle,'Work calendar · 14:00–15:00');assert.equal(today.dateLabel,'14:00–15:00')
})

test('Board linked directions and undated List rows retain compact non-duplicated metadata',()=>{
  const state=fixture();state.workspace.relations.push({id:'follow-up',type:'depends_on',fromId:'task',toId:'card'})
  const board=projectWidget(state,config({page:'board'}),options),incoming=board.rows.find(row=>row.recordId==='task-done'),outgoing=board.rows.find(row=>row.recordId==='task')
  assert.equal(incoming.secondaryLabel,'Prerequisite · Work tasks');assert.equal(incoming.completed,true);assert.equal(incoming.depth,1);assert.equal(incoming.parentId,'card')
  assert.equal(outgoing.secondaryLabel,'Follow-up · Work tasks');assert.equal(outgoing.direction,'outgoing');assert.equal(outgoing.depth,1)
  assert.ok(board.rows.filter(row=>row.type==='heading').every(row=>Number.isInteger(row.sectionCount)&&String(row.sectionCount)===row.subtitle))
  assert.ok(board.rows.some(row=>row.type==='heading'&&row.sectionCount===0))
  const undated=projectWidget(state,config({page:'list'}),options).rows.find(row=>row.recordId==='undated')
  assert.equal(undated.secondaryLabel,'Work tasks');assert.equal(undated.trailingLabel,'');assert.equal(undated.displayDay,'');assert.equal(undated.dateLabel,'No deadline')
})
test('work widgets expose dependencies only for eligible work and other widget pages omit them',()=>{
  const state=fixture()
  state.workspace.relations.push(
    {id:'open-prerequisite',type:'depends_on',fromId:'card',toId:'task'},
    {id:'event-link',type:'depends_on',fromId:'card',toId:'event'},
    {id:'missing',type:'depends_on',fromId:'card',toId:'missing-work'},
  )
  const expected={edges:[{prerequisiteId:'task',dependentId:'card'}],counts:[
    {recordId:'card',prerequisites:1,dependents:0},{recordId:'task',prerequisites:0,dependents:1},
  ]}
  for(const page of ['overview','timeline']){
    const preferred=config({page,scopeId:'work'})
    assert.deepEqual(projectWidget(state,preferred,options).dependencies,expected)
    const shownCompleted=projectWidget(state,{...preferred,showCompleted:true},options)
    assert.deepEqual(shownCompleted.dependencies.edges,[...expected.edges,{prerequisiteId:'task-done',dependentId:'card'}])
    assert.equal(projectWidget(state,{...preferred,sourceMode:'selected',collectionIds:['work-tasks']},options).dependencies,undefined)
    assert.equal(projectWidget(state,preferred,{...options,accountKey:'other-account'}).dependencies,undefined)
  }
  for(const page of ['calendar','board','list'])assert.equal(projectWidget(state,config({page}),options).dependencies,undefined)
})
test('work widget dependency cap keeps eligible counts when drawing or row limits hide a partner',()=>{
  const state=fixture()
  const item=index=>`item-${String(index).padStart(2,'0')}`
  state.records=Array.from({length:28},(_,index)=>({id:item(index),kind:'task',source:'tasks',collectionId:'work-tasks',title:item(index),due:'2026-11-24'}))
  const edge=(dependent,prerequisite)=>({id:`link-${dependent}-${prerequisite}`,type:'depends_on',fromId:item(dependent),toId:item(prerequisite)})
  state.workspace.relations=[...Array.from({length:70},(_,index)=>edge(10+index%10,Math.floor(index/10))).reverse(),edge(27,0),edge(22,27)]
  for(const page of ['overview','timeline']){
    const preference=config({page,groupBy:'none',sort:'title'})
    const {dependencies,rows}=projectWidget(state,preference,options)
    assert.ok(!rows.some(row=>row.recordId===item(27)))
    assert.equal(dependencies.edges.length,60)
    assert.deepEqual(dependencies.edges[0],{prerequisiteId:item(0),dependentId:item(10)})
    assert.deepEqual(dependencies.edges.at(-1),{prerequisiteId:item(5),dependentId:item(19)})
    assert.deepEqual(dependencies.counts.find(row=>row.recordId===item(0)),{recordId:item(0),prerequisites:0,dependents:11})
    assert.deepEqual(dependencies.counts.find(row=>row.recordId===item(6)),{recordId:item(6),prerequisites:0,dependents:10})
    assert.deepEqual(dependencies.counts.find(row=>row.recordId===item(22)),{recordId:item(22),prerequisites:1,dependents:0})
    assert.ok(!JSON.stringify(dependencies).includes(item(27)))
  }
})
test('exclusive all-day ends and ongoing multi-day events use calendar-day overlap',()=>{
  const state=fixture();state.records=[
    {id:'past',source:'calendar',kind:'event',collectionId:'work-cal',title:'Past',start:'2026-11-21',end:'2026-11-23',allDay:true},
    {id:'ongoing',source:'calendar',kind:'event',collectionId:'work-cal',title:'Ongoing',start:'2026-11-22',end:'2026-11-24',allDay:true},
    {id:'after',source:'calendar',kind:'event',collectionId:'work-cal',title:'After',start:'2026-11-30',end:'2026-12-01',allDay:true}]
  assert.deepEqual(itemIds(projectWidget(state,config({page:'calendar'}),options)),['ongoing'])
})
test('timed and linked planned end boundaries respect local time including DST',()=>{
  const state=fixture();state.records=[
    {id:'one',source:'calendar',kind:'event',collectionId:'work-cal',title:'Ends at 01',start:'2026-11-22T22:00:00Z',end:'2026-11-23T00:00:00Z'},
    {id:'midnight',source:'calendar',kind:'event',collectionId:'work-cal',title:'Ends at midnight',start:'2026-11-22T20:00:00Z',end:'2026-11-22T23:00:00Z'},
    {id:'work',source:'tasks',kind:'task',collectionId:'work-tasks',title:'Linked work'}]
  state.workspace.relations=[{id:'session',type:'scheduled_during',fromId:'work',toId:'one'}]
  assert.deepEqual(itemIds(projectWidget(state,config({page:'timeline',dateRange:'today',groupBy:'date'}),{...options,timeZone:'Europe/Budapest'})),['one','work'])
  state.records=[{id:'dst',kind:'event',source:'calendar',collectionId:'work-cal',title:'After DST midnight',start:'2026-03-29T21:30:00Z',end:'2026-03-29T22:30:00Z'}]
  assert.deepEqual(itemIds(projectWidget(state,config({page:'calendar',dateRange:'today'}),{...options,now:'2026-03-30T10:00:00Z',timeZone:'Europe/Budapest'})),['dst'])
})
test('work with several sessions is selected if any session overlaps the requested day',()=>{
  const state=fixture();state.records=[{id:'work',source:'tasks',kind:'task',collectionId:'work-tasks',title:'Planned work'}];state.workspace.plans=[{id:'past',recordId:'work',start:'2026-11-20T10:00:00Z',end:'2026-11-20T12:00:00Z'},{id:'current',recordId:'work',start:'2026-11-23T10:00:00Z',end:'2026-11-23T15:00:00Z'}]
  assert.deepEqual(itemIds(projectWidget(state,config({page:'overview',dateRange:'today'}),options)),['work'])
})
test('month data counts the same unbounded selection and excludes exclusive end dates',()=>{
  const state=fixture();state.records=[{id:'span',kind:'event',source:'calendar',collectionId:'work-cal',title:'Conference',start:'2026-11-23',end:'2026-11-25',allDay:true}]
  const result=projectWidget(state,config({page:'calendar',calendarLayout:'month'}),options)
  assert.equal(result.month.cells.length,42);assert.equal(result.month.cells.find(cell=>cell.date==='2026-11-23').count,1);assert.equal(result.month.cells.find(cell=>cell.date==='2026-11-25').count,0)
  assert.equal(result.month.label,'November 2026');assert.deepEqual(result.month.weekdays,['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);assert.equal(result.month.cells[0].inMonth,false)
})
test('month itinerary reads eligible items beyond the ordinary row budget and retains stable start order',()=>{
  const state=fixture()
  const visit=(id,title,start,end)=>({id,title,start,end,source:'calendar',kind:'event',collectionId:'work-cal'})
  const earlier=Array.from({length:25},(_,index)=>visit(`earlier-${index}`,`Earlier ${index}`,'2026-11-10T08:00:00Z','2026-11-10T09:00:00Z'))
  const sameTime=Array.from({length:7},(_,index)=>visit(`item-${6-index}`,`Item ${index}`,'2026-11-23T08:00:00Z','2026-11-23T09:00:00Z'))
  state.records=[...earlier,...sameTime,visit('day','Open house','2026-11-23','2026-11-24')]
  const c=config({page:'calendar',calendarLayout:'month',dateRange:'all'}),snapshot=projectWidget(state,c,options)
  const cell=snapshot.month.cells.find(value=>value.date==='2026-11-23')
  const itinerary=cell.itinerary.map(index=>snapshot.month.itineraryRows[index])
  assert.equal(cell.count,8)
  assert.deepEqual(itinerary.map(row=>row.recordId),['day','item-0','item-1','item-2','item-3','item-4'])
  assert.equal(itinerary[0].leadingLabel,'All day')
  assert.ok(!itemIds(snapshot).includes('item-0'))
  const intent={widgetId:1,accountKey:options.accountKey,generation:1,action:'item',recordId:'item-0'}
  assert.equal(validateWidgetIntent(intent,c,state,options).ok,true)
  assert.equal(snapshot.month.cells.find(value=>value.date==='2026-11-24').count,0)
})
test('month reuses a spanning row and keeps exact counts when its UTF-8 itinerary budget is reached',()=>{
  const state=fixture(),c=config({page:'calendar',calendarLayout:'month',dateRange:'all'})
  state.records=[{id:'span',kind:'event',source:'calendar',collectionId:'work-cal',title:'Studio residency',start:'2026-10-26',end:'2026-12-07',allDay:true}]
  const span=projectWidget(state,c,options).month
  assert.equal(span.itineraryRows.length,1)
  for(const cell of span.cells)assert.deepEqual(cell.itinerary,[0])

  state.collections.find(value=>value.id==='work-cal').title='暦'.repeat(500)
  for(const cell of span.cells)for(let index=0;index<6;index++)state.records.push({id:`${cell.date}-${index}`,kind:'event',source:'calendar',collectionId:'work-cal',title:'予定'.repeat(250),start:`${cell.date}T08:00:00Z`,end:`${cell.date}T09:00:00Z`})
  const snapshot=projectWidget(state,c,options),{month}=snapshot,bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength
  assert.ok(bytes(month)<=384*1024)
  assert.ok(bytes(snapshot)<1_000_000)
  assert.ok(month.cells.some(cell=>cell.itinerary.length<6))
  for(const cell of month.cells){
    assert.equal(cell.count,7)
    assert.ok(cell.itinerary.length<=6)
    assert.equal(month.itineraryRows[cell.itinerary[0]].recordId,'span')
  }
})
test('Timeline All excludes rows outside its seven-day preview and clips continuing bars',()=>{
  const state=fixture();state.records=[{id:'past',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Past deadline',due:'2026-11-20'},{id:'span',kind:'card',source:'deck',collectionId:'work-deck',title:'Work range',start:'2026-11-22',due:'2026-11-25'},{id:'future',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Future deadline',due:'2026-12-10'}]
  const result=projectWidget(state,config({page:'timeline',dateRange:'all'}),options),rows=result.rows.filter(row=>row.type==='item')
  assert.deepEqual(itemIds(result),['span'])
  assert.equal(result.totalCount,1)
  assert.deepEqual(rows.find(row=>row.recordId==='span').timeline,{offset:0,length:3/7*100})
  assert.match(rows.find(row=>row.recordId==='span').subtitle,/22 Nov–25 Nov/)
  assert.equal(result.timelineAxis.label,'23 Nov – 29 Nov · 7-day preview')
  assert.equal(rows.find(row=>row.recordId==='span').displayDay,'22 Nov – 25 Nov')
})

test('Overview applies its visible timeframe before grouping and limiting work and bookings',()=>{
  const state=fixture()
  state.records=[
    ...Array.from({length:28},(_,index)=>({id:`old-${index}`,kind:'task',source:'tasks',collectionId:'work-tasks',title:`Previous work ${index}`,due:'2026-11-20'})),
    ...state.records,
    {id:'late',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Next week',due:'2026-11-30'},
  ]
  const c=config({page:'overview',dateRange:'all',calendarLayout:'day',groupBy:'source'})
  const result=projectWidget(state,c,options)
  assert.deepEqual(result.overview,{bookings:1,work:2})
  assert.equal(result.totalCount,3)
  assert.equal(result.truncated,false)
  assert.deepEqual(new Set(itemIds(result)),new Set(['event','task','card']))
  assert.ok(result.rows.filter(row=>row.type==='heading').every(row=>row.sectionCount===1))
  const outside={widgetId:c.widgetId,accountKey:c.accountKey,generation:c.generation,action:'item',recordId:'other-event'}
  assert.equal(validateWidgetIntent(outside,c,state,options).ok,false)
  assert.equal(validateWidgetIntent(outside,{...c,calendarLayout:'week'},state,options).ok,true)
})

test('Timeline Overdue preserves only past-due work with an intersecting session or plan',()=>{
  const state=fixture()
  state.records=[
    {id:'plan',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Draft revisions',due:'2026-11-18'},
    {id:'linked',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Proofread copy',due:'2026-11-17'},
    {id:'old',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Old deadline',due:'2026-11-16'},
    {id:'future',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Future deadline',due:'2026-11-25'},
    {id:'booking',kind:'event',source:'calendar',collectionId:'work-cal',title:'Proofreading session',start:'2026-11-25T15:00:00Z',end:'2026-11-25T16:00:00Z'},
  ]
  state.workspace.plans=[
    {id:'later',recordId:'plan',start:'2026-11-27T15:00:00Z',end:'2026-11-27T16:00:00Z'},
    {id:'earliest',recordId:'plan',start:'2026-11-24T15:00:00Z',end:'2026-11-24T16:00:00Z'},
  ]
  state.workspace.relations=[{id:'linked-booking',type:'scheduled_during',fromId:'linked',toId:'booking'}]
  const c=config({page:'timeline',dateRange:'overdue'})
  const result=projectWidget(state,c,options)
  assert.equal(result.timelineAxis.label,'23 Nov – 29 Nov · 7-day preview')
  assert.deepEqual(new Set(itemIds(result)),new Set(['linked','plan']))
  for(const [recordId,day,offset] of [['linked','25',2],['plan','24',1]]){
    const row=result.rows.find(row=>row.recordId===recordId)
    assert.deepEqual(row.timeline,{offset:offset/7*100,length:1/7*100})
    assert.equal(row.displayDay,`${day} Nov`)
    assert.match(row.trailingLabel,/Overdue/)
    const intent={widgetId:c.widgetId,accountKey:c.accountKey,generation:c.generation,action:'item',recordId}
    assert.deepEqual(widgetNavigation(validateWidgetIntent(intent,c,state,options)),{page:'timeline',scopeId:'all',recordId,date:`2026-11-${day}`})
  }
})

test('work timeframe and item actions roll forward at local midnight across the DST transition',()=>{
  const state=fixture()
  state.records=[
    {id:'old-day',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Saturday notes',due:'2026-03-28'},
    {id:'new-day',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Sunday notes',due:'2026-03-29'},
    {id:'span',kind:'card',source:'deck',collectionId:'work-deck',title:'Weekend preparation',start:'2026-03-28',due:'2026-03-29'},
  ]
  state.workspace.relations=[
    {id:'old',type:'depends_on',fromId:'span',toId:'old-day'},
    {id:'new',type:'depends_on',fromId:'span',toId:'new-day'},
  ]
  for(const page of ['overview','timeline']){
    const c=config({page,dateRange:'today',calendarLayout:'day'})
    const before={...options,now:'2026-03-28T22:59:59Z',timeZone:'Europe/Budapest'}
    const after={...before,now:'2026-03-28T23:00:00Z'}
    const saturday=projectWidget(state,c,before),sunday=projectWidget(state,c,after)
    assert.equal(saturday.timelineAxis.end,'2026-03-29')
    assert.equal(sunday.timelineAxis.start,'2026-03-29')
    assert.equal(sunday.timelineAxis.end,'2026-03-30')
    assert.deepEqual(saturday.dependencies.edges,[{prerequisiteId:'old-day',dependentId:'span'}])
    assert.deepEqual(sunday.dependencies.edges,[{prerequisiteId:'new-day',dependentId:'span'}])
    const intent={widgetId:c.widgetId,accountKey:c.accountKey,generation:c.generation,action:'item',recordId:'old-day'}
    assert.equal(validateWidgetIntent(intent,c,state,before).ok,true)
    assert.equal(validateWidgetIntent(intent,c,state,after).ok,false)
  }
})

test('Timeline date axis aligns to row geometry through local DST, locale and horizon changes',()=>{
  const state=fixture();state.records=[{id:'work',kind:'task',source:'tasks',collectionId:'work-tasks',title:'Next-day deadline',due:'2026-03-30'}]
  const dstOptions={...options,now:'2026-03-28T23:30:00Z',timeZone:'Europe/Budapest'},week=projectWidget(state,config({page:'timeline'}),dstOptions)
  assert.equal(week.timelineAxis.start,'2026-03-29');assert.equal(week.timelineAxis.end,'2026-04-05');assert.equal(week.timelineAxis.label,'29 Mar – 4 Apr');assert.equal(week.timelineAxis.ticks.length,8)
  assert.deepEqual(week.timelineAxis.ticks[1],{offset:1/7*100,label:'30 Mar'})
  assert.deepEqual(week.rows.find(row=>row.recordId==='work').timeline,{offset:1/7*100,length:1/7*100})
  assert.deepEqual(week.timelineAxis.ticks.slice(-2),[{offset:6/7*100,label:'4 Apr'},{offset:100,label:''}])
  state.records.push(
    {id:'last-minute',kind:'event',source:'calendar',collectionId:'work-cal',title:'End of Month review',start:'2026-04-28T21:55:00Z',end:'2026-04-28T22:00:00Z'},
    {id:'next-month',kind:'event',source:'calendar',collectionId:'work-cal',title:'Next period review',start:'2026-04-28T22:00:00Z',end:'2026-04-28T23:00:00Z'},
  )
  const month=projectWidget(state,config({page:'timeline',dateRange:'month'}),dstOptions)
  assert.equal(month.timelineAxis.end,'2026-04-29');assert.equal(month.timelineAxis.label,'29 Mar – 28 Apr');assert.equal(month.timelineAxis.ticks.length,32)
  assert.deepEqual(month.timelineAxis.ticks.slice(-2),[{offset:30/31*100,label:'28 Apr'},{offset:100,label:''}])
  assert.deepEqual(new Set(itemIds(month)),new Set(['work','last-minute']))
  assert.deepEqual(month.rows.find(row=>row.recordId==='work').timeline,{offset:1/31*100,length:1/31*100})
  const today=projectWidget(state,config({page:'timeline',dateRange:'today'}),{...options,locale:'en-US'})
  assert.deepEqual(today.timelineAxis,{start:'2026-11-23',end:'2026-11-24',label:'Nov 23',ticks:[{offset:0,label:'Nov 23'},{offset:100,label:''}]})
})
test('month actions are fenced to currently represented cells after date rollover',()=>{
  const state=fixture(),c=config({page:'calendar',calendarLayout:'month'}),intent={widgetId:1,accountKey:options.accountKey,generation:1,action:'date',date:'2026-11-23'}
  assert.equal(validateWidgetIntent(intent,c,state,options).ok,true)
  assert.equal(validateWidgetIntent({...intent,date:'2026-09-01'},c,state,options).ok,false)
  assert.equal(validateWidgetIntent(intent,{...c,calendarLayout:'agenda'},state,options).ok,false)
})
test('catalog carries shared defaults and only minimal data, source scope and status metadata',()=>{
  const state=fixture();state.records[0].body='PRIVATE BODY';state.records[0].url='https://example.invalid/private'
  const catalog=widgetCatalog(state,{accountKey:options.accountKey})
  assert.deepEqual(catalog.defaults.calendar.kinds,['event']);assert.deepEqual(catalog.sources.find(source=>source.id==='home-cal').scopeIds,['all'])
  assert.ok(!JSON.stringify(catalog).includes('PRIVATE BODY'));assert.ok(!JSON.stringify(catalog).includes('/private'))
})
test('source freshness retains successful timestamp and transient failures do not fabricate empty data',()=>{
  const state=fixture();state.statuses[0].state='error';const result=projectWidget(state,config({page:'calendar'}),options)
  assert.equal(result.state,'ready');assert.equal(result.sourceVerifiedAt,'2026-11-23T10:00:00Z');assert.match(result.message,/saved items/);assert.equal(result.metadataVerifiedAt,'2026-11-23T08:00:00Z')
  assert.equal(projectWidget(state,config({page:'calendar'}),{...options,now:'2026-11-23T13:00:00Z'}).fingerprint,result.fingerprint)
})
test('current action validation rejects account/generation/deletion/filter changes',()=>{
  const state=fixture(),c=config({page:'calendar'}),intent={widgetId:1,accountKey:options.accountKey,generation:1,action:'item',recordId:'event'}
  assert.equal(validateWidgetIntent(intent,c,state,options).ok,true)
  assert.equal(validateWidgetIntent({...intent,generation:2},c,state,options).ok,false)
  assert.equal(validateWidgetIntent({...intent,accountKey:'other'},c,state,options).ok,false)
  assert.equal(validateWidgetIntent(intent,{...c,query:'none'},state,options).ok,false)
  state.records=[];assert.equal(validateWidgetIntent(intent,c,state,options).ok,false)
})
test('full widget context and item actions are not truncated to the launcher row budget',()=>{
  const state=fixture();state.records=Array.from({length:40},(_,i)=>({id:`task-${i}`,kind:'task',source:'tasks',collectionId:'work-tasks',title:`Task ${i}`}))
  const c=config({page:'list'});assert.equal(widgetPlannerContext(state,c,options).records.length,40)
  assert.equal(validateWidgetIntent({widgetId:1,accountKey:options.accountKey,generation:1,action:'item',recordId:'task-39'},c,state,options).ok,true)
})
test('creation defaults remain source constrained and never certify server write authority',()=>{
  const state=fixture(),c=config({page:'calendar',scopeId:'work',creationDefaults:{event:{collectionId:'home-cal'}}}),intent={widgetId:1,accountKey:options.accountKey,generation:1,action:'create'}
  const result=validateWidgetIntent(intent,c,state,options);assert.equal(result.kind,'event');assert.equal(result.collectionId,'work-cal');assert.equal(result.authorized,undefined)
  assert.equal(validateWidgetIntent({...intent,kind:'task'},c,state,options).ok,false)
  state.collections.find(collection=>collection.id==='work-cal').readonly=true;assert.equal(validateWidgetIntent(intent,c,state,options).ok,false)
})
test('projection requires injected time and validates calendar dates',()=>{
  assert.throws(()=>projectWidget(fixture(),config(),{accountKey:options.accountKey}),/explicit valid time/)
  assert.equal(validateWidgetIntent({widgetId:1,accountKey:options.accountKey,generation:1,action:'date',date:'2026-02-30'},config({page:'calendar'}),fixture(),options).ok,false)
})

test('grouped Board task status/date are context while source, kind, tag and search exclusions remain hard',()=>{
  const state=fixture();state.records.find(record=>record.id==='task-done').due='2026-11-01'
  const c=config({page:'board',scopeId:'work',statusIds:['$unmapped'],dateRange:'today'})
  const parent=state.records.find(record=>record.id==='card');parent.due='2026-11-23'
  const before=structuredClone(state),result=projectWidget(state,c,options),child=result.rows.find(row=>row.recordId==='task-done')
  assert.equal(child.parentId,'card');assert.equal(child.statusLabel,'Done');assert.equal(child.completed,true)
  assert.ok(!itemIds(projectWidget(state,{...c,groupLinkedTasks:false},options)).includes('task-done'))
  for(const exclusion of [{sourceMode:'selected',collectionIds:['work-deck']},{kinds:['card']},{tagNames:['Launch']},{query:'Release guide'}])assert.ok(!itemIds(projectWidget(state,{...c,...exclusion},options)).includes('task-done'))
  assert.deepEqual(state,before)
})

test('Board respects project/source/none grouping and planner hierarchy preserves explicit project priority',()=>{
  const state=fixture();state.workspace.projects=[{id:'tagged',spaceId:'work',name:'Tag project',collectionIds:['work-deck'],tagNames:['Launch']},{id:'explicit',spaceId:'work',name:'Explicit project',recordIds:['card'],collectionIds:[]}]
  const c=config({page:'board',scopeId:'work',query:'Release guide',groupBy:'project'})
  assert.deepEqual(projectWidget(state,c,options).rows.filter(row=>row.type==='heading').map(row=>row.title),['Explicit project'])
  assert.deepEqual(projectWidget(state,{...c,groupBy:'source'},options).rows.filter(row=>row.type==='heading').map(row=>row.title),['Delivery board'])
  assert.equal(projectWidget(state,{...c,groupBy:'none'},options).rows.some(row=>row.type==='heading'),false)
  const timeline=projectWidget(state,{...c,page:'timeline',groupBy:'planner'},options)
  assert.deepEqual(timeline.rows.filter(row=>row.type==='heading').map(row=>[row.title,row.depth]),[['Work',0],['Explicit project',1]])
})

test('ordinary navigation retains widget membership guards without copying widget preferences',()=>{
  const state=fixture(),before=structuredClone(state),c=config({page:'calendar',scopeId:'work',query:'Design',dateRange:'today'})
  const result=validateWidgetIntent({widgetId:1,accountKey:options.accountKey,generation:1,action:'item',recordId:'event'},c,state,options)
  assert.deepEqual(widgetNavigation(result),{page:'calendar',scopeId:'work',recordId:'event',date:'2026-11-23'})
  assert.deepEqual(state,before);assert.equal(widgetNavigation({...result,ok:false}),null)
  assert.deepEqual(widgetNavigation(validateWidgetIntent({widgetId:1,accountKey:options.accountKey,generation:1,action:'date',date:'2026-11-24'},{...c,calendarLayout:'week'},state,options)),{page:'calendar',scopeId:'work',date:'2026-11-24',calendarMode:'day'})
})

test('new chart defaults preserve every explicit legacy presentation choice',()=>{
  for(const page of ['overview','calendar'])assert.equal(config({page}).calendarLayout,'week')
  for(const page of ['overview','timeline'])assert.equal(config({page}).groupBy,'planner')
  for(const calendarLayout of ['agenda','month','day','week'])assert.equal(config({page:'calendar',calendarLayout}).calendarLayout,calendarLayout)
  assert.equal(config({page:'timeline',groupBy:'date'}).groupBy,'date')
  const old=projectWidget(fixture(),config({page:'overview',calendarLayout:'month'}),options)
  assert.equal(old.calendarGrid.mode,'week');assert.equal(old.calendarGrid.days.length,7)
})

test('Overview reserves current work ranges and a current calendar below under a shared record cap',()=>{
  const state=fixture();state.records=[...Array.from({length:30},(_,i)=>({id:`event-${i}`,kind:'event',source:'calendar',collectionId:'work-cal',title:`Booking ${i}`,start:'2026-11-23T14:00:00Z',end:'2026-11-23T15:00:00Z'})),...Array.from({length:30},(_,i)=>({id:`work-${i}`,kind:'task',source:'tasks',collectionId:'work-tasks',title:`Prepare ${i}`,due:'2026-11-23'}))]
  const snapshot=projectWidget(state,config({page:'overview'}),options)
  assert.equal(snapshot.totalCount,60);assert.equal(snapshot.truncated,true);assert.equal(itemIds(snapshot).length,25)
  assert.equal(snapshot.overviewRangeIds.length,12);assert.equal(snapshot.calendarGrid.timed.length,13)
  assert.equal(snapshot.timelineAxis.start,snapshot.calendarGrid.days[0].date)
  assert.deepEqual(snapshot.overview,{bookings:30,work:30})
})

test('date-only calendar records remain all-day Overview ranges without needing an extra flag',()=>{
  const state=fixture();state.records=[{id:'day',kind:'event',source:'calendar',collectionId:'work-cal',title:'Workshop',start:'2026-11-23',end:'2026-11-24'}]
  const snapshot=projectWidget(state,config({page:'overview'}),options)
  assert.deepEqual(snapshot.overviewRangeIds,['day']);assert.equal(snapshot.calendarGrid.allDay[0].recordId,'day')
  assert.equal(snapshot.calendarGrid.timed.length,0)
})

test('many genuine sessions keep original lane geometry but bound published chart payload',()=>{
  const state=fixture();state.records=[{id:'work',title:'Prepare release',kind:'task',source:'tasks',collectionId:'work-tasks'}]
  state.workspace.plans=Array.from({length:220},(_,i)=>({id:`session-${i}`,recordId:'work',start:new Date(Date.parse('2026-11-23T10:00:00Z')+i*1000).toISOString(),end:new Date(Date.parse('2026-11-23T11:00:00Z')+i*1000).toISOString()}))
  const snapshot=projectWidget(state,config({page:'calendar',kinds:['task']}),options)
  assert.deepEqual(itemIds(snapshot),['work']);assert.equal(snapshot.totalCount,1);assert.equal(snapshot.truncated,true)
  assert.equal(snapshot.calendarGrid.timed.length,175);assert.equal(snapshot.calendarGrid.timed.at(-1).lane,174)
  assert.equal(snapshot.calendarGrid.timed[0].laneCount,220,'Truncation must not repack retained segments into invented available space')
})
