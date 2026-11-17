/** Pointer editing is exercised against fixture APIs only, never a live account. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState} from '@nextspace/core/planner.mjs'

const state=createEmptyState()
state.mode='live';state.connection={connected:true,username:'tester',serverUrl:'https://fixture.invalid'}
state.workspace.appearance.mode='light'
state.collections=[{id:'deck-a',source:'deck',title:'Personal Deck',color:'#368bba',stacks:[{id:'todo',title:'To do'}]},{id:'deck-b',source:'deck',title:'Freelance Deck',color:'#9560c1',stacks:[{id:'todo',title:'To do'}]},{id:'tasks',source:'tasks',title:'Personal tasks',color:'#368bba'},{id:'calendar',source:'calendar',title:'Personal calendar',color:'#368bba'}]
const record=(id,title,kind,extra={})=>({id,title,kind,source:kind==='card'?'deck':kind==='event'?'calendar':'tasks',collectionId:kind==='card'?'deck-a':kind==='event'?'calendar':'tasks',collectionTitle:kind==='card'?'Personal Deck':kind==='event'?'Personal calendar':'Personal tasks',readonly:false,completed:false,etag:`${id}-v1`,...(kind==='card'?{stackId:'todo',status:'To do',assigneeIds:['tester'],assignmentKnown:true,assignmentCount:1}:{}),...extra})
state.records=[record('range','A range card','card',{start:'2026-11-03',due:'2026-11-05'}),record('due','B due task','task',{due:'2026-11-05'}),record('start','C start task','task',{start:'2026-11-03'}),record('undated','D unscheduled task','task'),record('undated-card','E undated Deck card','card',{nativeDependencies:['range']}),record('readonly','F read-only task','task',{due:'2026-11-04',readonly:true}),record('target','G linked card','card',{collectionId:'deck-b',collectionTitle:'Freelance Deck',start:'2026-11-04',due:'2026-11-07',nativeDependencies:['range']}),record('meeting','Client work session','event',{start:'2026-11-03T10:00:00+01:00',end:'2026-11-03T12:00:00+01:00',busy:true})]
state.workspace.spaces=[{id:'personal',name:'A Personal',color:'#368bba',collectionIds:['deck-a','tasks','calendar']},{id:'freelance',name:'B Freelance',color:'#9560c1',collectionIds:['deck-b']}]
state.workspace.relations=[{id:'existing-dependency',type:'depends_on',fromId:'target',toId:'range'},{id:'reserved',type:'scheduled_during',fromId:'range',toId:'meeting'}]
state.workspace.plans=[{id:'plan',recordId:'due',start:'2026-11-04T09:00:00+01:00',end:'2026-11-04T11:00:00+01:00'}]
state.statuses=state.statuses.map(status=>({...status,state:'connected',count:state.records.filter(record=>record.source===status.source).length}))
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const context=await browser.newContext({viewport:{width:1652,height:1100},timezoneId:'Europe/Budapest'})
const page=await context.newPage(),checks=[],errors=[]
page.setDefaultTimeout(12000)
page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(initial=>{
  let state=structuredClone(initial)
  window.__dateWrites=[];window.__metadataWrites=[];window.__holdDateSave=false;window.__failDateSave=false
  const read=async()=>structuredClone(state)
  window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale fixture revision');window.__metadataWrites.push(structuredClone(workspace));state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},updateRecordDates:async input=>{
    const item=state.records.find(record=>record.id===input.id)
    if(item.readonly)throw new Error('Read-only source')
    if(input.etag!==item.etag)throw new Error('Stale native record')
    window.__dateWrites.push(structuredClone(input))
    if(window.__failDateSave){window.__failDateSave=false;throw new Error('Fixture rejected date edit')}
    if(window.__holdDateSave)await new Promise(resolve=>window.__releaseDateSave=resolve)
    Object.assign(item,input);item.etag=`${item.id}-v${window.__dateWrites.length+1}`;return read()
  },openExternal:async()=>{},readPage:async()=>({body:''})}
},state)
const timeline=()=>page.locator('.timeline-view')
const row=id=>timeline().locator(`.timeline-chart-row[data-record-id="${id}"]`)
const label=id=>timeline().locator(`.timeline-row-label[data-record-id="${id}"]`)
const bar=id=>row(id).locator(':scope>.timeline-bar:not(.planned)')
const point=id=>row(id).locator('.timeline-deadline')
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const writes=()=>page.evaluate(()=>window.__dateWrites)
const metadataCount=()=>page.evaluate(()=>window.__metadataWrites.length)
const dayWidth=()=>timeline().locator('.timeline-days>div').first().evaluate(element=>element.getBoundingClientRect().width)
async function chooseDate(value){await page.getByLabel('Choose calendar date').fill(value);await page.getByLabel('Choose calendar date').dispatchEvent('change')}
async function dragBy(locator,dx,dy=0,beforeDrop){
  await locator.scrollIntoViewIfNeeded()
  const position=await locator.evaluate(element=>{const b=element.getBoundingClientRect();for(const vertical of [.5,.15,.85,.05,.95])for(const fraction of [.5,.15,.85,.05,.95]){const x=b.width*fraction,y=b.height*vertical;if(element.contains(document.elementFromPoint(b.x+x,b.y+y)))return {x,y}}const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);throw new Error('No exposed drag handle: '+JSON.stringify({wanted:element.className,bounds:{x:b.x,y:b.y,width:b.width,height:b.height},coveredBy:hit?.outerHTML.slice(0,500)}))})
  await locator.hover({position});const box=await locator.boundingBox()
  await page.mouse.move(box.x+position.x,box.y+position.y);await page.mouse.down();await page.mouse.move(box.x+position.x+dx,box.y+position.y+dy,{steps:8});if(beforeDrop)await beforeDrop();await page.mouse.up()
}
async function waitRecord(id,values){await page.waitForFunction(({id,values})=>window.workspaceApi.getState().then(state=>{const item=state.records.find(record=>record.id===id);return Object.entries(values).every(([key,value])=>item[key]===value)}),{id,values})}
async function waitNativeCount(count){await page.waitForFunction(count=>window.__dateWrites.length===count,count)}

try{
  await page.goto('http://127.0.0.1:5173')
  await page.locator('.overview-split').waitFor();await chooseDate('2026-11-02')
  assert.equal(await page.getByRole('complementary',{name:'Item details'}).count(),0)
  assert.equal(await label('undated-card').count(),1,'The undated native neighbor of scheduled work is expanded without selection')
  assert.match(await row('undated-card').locator('.dependency-context').innerText(),/Unscheduled.*Depends on A range card/)
  assert.equal(await row('undated-card').locator('.timeline-bar,.timeline-deadline').count(),0)
  assert.equal(await timeline().locator('.dependency-path[data-native="true"]').count(),2,'Dated and undated native dependencies both have persistent visible arrows')
  assert.equal(await timeline().locator('.dependency-path').count(),2,'A legacy planner copy of a native dependency does not draw a second arrow')
  await page.screenshot({path:'artifacts/timeline-native-links-overview.png',fullPage:true})
  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  await page.getByLabel('Timeline range').selectOption('7')
  await chooseDate('2026-11-02')
  await page.getByRole('tab',{name:'Timeline',exact:true}).hover()
  assert.equal(await timeline().locator('.calendar-day-summaries').count(),0,'Detailed calendar bands must not also render the compact calendar summaries')
  assert.equal(await timeline().locator('.dependency-path[data-native="true"]').count(),2)
  assert.equal(await timeline().locator('.dependency-path').count(),2)
  checks.push('Native dependencies stay visible across groups without hover; undated work has an explicit dependency anchor without invented dates or duplicate arrows')

  let width=await dayWidth(),count=(await writes()).length
  await dragBy(bar('range'),width,0,async()=>{assert.equal((await writes()).length,count);assert.ok(await timeline().locator('.timeline-edit-ghost').isVisible());assert.ok(await timeline().locator('.timeline-drag-tooltip').isVisible());await page.screenshot({path:'artifacts/timeline-drag-preview.png',fullPage:true})})
  await waitNativeCount(++count);await waitRecord('range',{start:'2026-11-04',due:'2026-11-06'})
  assert.equal((await writes()).at(-1).etag,'range-v1')
  assert.equal(await page.getByRole('complementary',{name:'Item details'}).count(),0,'Dragging must not also trigger selection')
  await dragBy(bar('range').locator('.timeline-resize-handle.end'),width)
  await waitNativeCount(++count);await waitRecord('range',{start:'2026-11-04',due:'2026-11-07'})
  await dragBy(bar('range').locator('.timeline-resize-handle.start'),-width)
  await waitNativeCount(++count);await waitRecord('range',{start:'2026-11-03',due:'2026-11-07'})
  checks.push('Moving and resizing both ends previews dates, emits once on drop, preserves record identity/etag, and does not open the inspector')

  await dragBy(point('due'),width)
  await waitNativeCount(++count);await waitRecord('due',{due:'2026-11-06'})
  assert.equal((await backend()).records.find(record=>record.id==='due').start,undefined)
  await dragBy(row('due').locator('.timeline-point-handle.start'),-2*width)
  await waitNativeCount(++count);await waitRecord('due',{start:'2026-11-04',due:'2026-11-06'})
  await dragBy(point('start'),width)
  await waitNativeCount(++count);await waitRecord('start',{start:'2026-11-04'})
  assert.equal((await backend()).records.find(record=>record.id==='start').due,undefined)
  await dragBy(row('start').locator('.timeline-point-handle.end'),2*width)
  await waitNativeCount(++count);await waitRecord('start',{start:'2026-11-04',due:'2026-11-06'})
  checks.push('Due-only and start-only work can move without inventing the other date, then gain a valid work span through the appropriate edge handle')

  for(const [id,dayIndex] of [['undated',3],['undated-card',4]]){
    const source=await label(id).boundingBox(),target=await timeline().locator('.timeline-days>div').nth(dayIndex).boundingBox()
    await page.mouse.move(source.x+70,source.y+source.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,source.y+source.height/2,{steps:10});await page.mouse.up()
    await waitNativeCount(++count)
    const item=(await backend()).records.find(record=>record.id===id)
    assert.equal(item.start,undefined)
    assert.equal(item.due,id==='undated'?'2026-11-05':'2026-11-06T22:59:00.000Z')
  }
  checks.push('Dragging undated rows onto a day sets only the task deadline or the Deck end-of-day deadline')

  const taskBefore=(await backend()).records.find(record=>record.id==='due')
  await dragBy(timeline().locator('.timeline-bar.planned[data-plan-id="plan"]'),width)
  await page.waitForFunction(()=>window.workspaceApi.getState().then(state=>state.workspace.plans[0].start==='2026-11-05T08:00:00.000Z'))
  assert.equal((await writes()).length,count,'Planner sessions do not call the native date API')
  assert.equal((await backend()).records.find(record=>record.id==='due').due,taskBefore.due)
  await dragBy(timeline().locator('.timeline-bar.planned[data-plan-id="plan"] .timeline-resize-handle.end'),width)
  await page.waitForFunction(()=>window.workspaceApi.getState().then(state=>state.workspace.plans[0].end==='2026-11-06T10:00:00.000Z'))
  await dragBy(timeline().locator('.timeline-event-chip[data-event-id="meeting"]'),2*width)
  await waitNativeCount(++count);await waitRecord('meeting',{start:'2026-11-05T09:00:00.000Z',end:'2026-11-05T11:00:00.000Z'})
  await dragBy(timeline().locator('.timeline-event-chip[data-event-id="meeting"] .timeline-resize-handle.end'),width)
  await waitNativeCount(++count);await waitRecord('meeting',{start:'2026-11-05T09:00:00.000Z',end:'2026-11-06T11:00:00.000Z'})
  checks.push('Planner sessions move/resize as planner metadata; calendar event chips move/resize native event dates while preserving their times')

  const beforeLink=await metadataCount(),connector=await row('due').locator('.timeline-connector').boundingBox(),target=await label('start').boundingBox()
  await page.mouse.move(connector.x+connector.width/2,connector.y+connector.height/2);await page.mouse.down();await page.mouse.move(target.x+80,target.y+target.height/2,{steps:10})
  assert.ok(await label('start').evaluate(element=>element.classList.contains('link-drop-target')))
  assert.equal(await metadataCount(),beforeLink)
  await page.mouse.up()
  await page.waitForFunction(()=>window.workspaceApi.getState().then(state=>state.workspace.relations.some(edge=>edge.type==='depends_on'&&edge.fromId==='start'&&edge.toId==='due')))
  assert.equal((await writes()).length,count)
  checks.push('Dragging a connector to a successor adds one dependency with the correct direction and no source date write')

  // Selecting the predecessor opens its inspector; its width changes day geometry.
  // Close that panel so later gestures retain the full-width pointer-editing setup.
  const inspector=page.getByRole('complementary',{name:'Item details'})
  if(await inspector.count())await inspector.getByRole('button',{name:'Close item details',exact:true}).click()
  await page.getByRole('tab',{name:'Timeline',exact:true}).hover()
  width=await dayWidth()

  await dragBy(bar('range'),width,0,async()=>{await page.keyboard.press('Escape')})
  assert.equal((await writes()).length,count)
  assert.equal(await timeline().locator('.timeline-edit-ghost').count(),0)
  await dragBy(bar('range').locator('.timeline-resize-handle.end'),-5*width)
  assert.equal((await writes()).length,count,'Crossed date edges are rejected before save')
  await dragBy(point('readonly'),width)
  assert.equal((await writes()).length,count,'Read-only native dates cannot be dragged')
  const beforeFailure=(await backend()).records.find(record=>record.id==='range').due
  await page.evaluate(()=>window.__failDateSave=true)
  await dragBy(bar('range'),-width)
  await waitNativeCount(++count)
  await page.getByRole('alert').filter({hasText:'Fixture rejected date edit'}).waitFor()
  assert.equal((await backend()).records.find(record=>record.id==='range').due,beforeFailure)
  await page.getByRole('button',{name:'Discard failed edit for A range card',exact:true}).click()
  checks.push('Escape, crossed edges, read-only data, and a rejected source save leave original dates intact')

  await page.getByLabel('Timeline range').selectOption('1');await chooseDate('2026-11-05')
  width=await dayWidth()
  await dragBy(timeline().locator('.timeline-event-chip[data-event-id="meeting"]'),width/96)
  await waitNativeCount(++count);await waitRecord('meeting',{start:'2026-11-05T09:15:00.000Z',end:'2026-11-06T11:15:00.000Z'})
  assert.deepEqual(errors,[])
  await page.getByLabel('Timeline range').selectOption('7');await chooseDate('2026-11-02')
  await page.getByRole('tab',{name:'Timeline',exact:true}).hover()
  await page.locator('.toast').waitFor({state:'hidden'})
  await page.screenshot({path:'artifacts/timeline-direct-edit.png',fullPage:true})
  checks.push('At one-day zoom, timed calendar work snaps to fifteen-minute moves instead of whole days')
  console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){console.error(JSON.stringify({result:'FAIL',checks,errors,error:String(error)},null,2));await page.screenshot({path:'artifacts/timeline-manipulation-failure.png',fullPage:true});throw error}finally{await context.close();await browser.close()}
