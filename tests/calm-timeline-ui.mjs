/** Dense, account-free fixture for the calmer categorized overview. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState} from '@nextspace/core/planner.mjs'

const state=createEmptyState()
state.mode='live'
state.connection={connected:true,username:'tester',serverUrl:'https://fixture.invalid'}
state.workspace.appearance.mode='dark'
state.theme={color:'#0491f2',backgroundColor:'#002745',mode:'dark',light:{surfaceColor:'#ffffff',textColor:'#222222',mutedColor:'#666666',hoverColor:'#f5f5f5',borderColor:'#ededed',primaryColor:'#04455a',primaryTextColor:'#ffffff',primaryLightColor:'#e5f2f5',primaryLightTextColor:'#04455a'},darkPalette:{surfaceColor:'#171717',textColor:'#ebebeb',mutedColor:'#aaaaaa',hoverColor:'#212121',borderColor:'#292929',primaryColor:'#0491f2',primaryTextColor:'#000000',primaryLightColor:'#142f42',primaryLightTextColor:'#72bfff'}}
state.workspace.planner.scopeId='first'
const colors={personal:'#38a976',freelance:'#7f79e9'}
for(const category of ['personal','freelance'])for(const source of ['calendar','tasks','deck'])state.collections.push({id:`${category}-${source}`,source,title:`${category==='personal'?'Personal':'Freelance'} ${source==='deck'?'board':source==='calendar'?'calendar':'tasks'}`,color:colors[category],readonly:false,...(source==='deck'?{stacks:[{id:'todo',title:'To do'},{id:'doing',title:'In progress'}]}:{})})
state.workspace.spaces=[{id:'first',name:'First',color:'#3f7389',collectionIds:state.collections.map(collection=>collection.id)}]
state.workspace.categories=['personal','freelance'].map(id=>({id,spaceId:'first',name:id==='personal'?'Personal':'Freelance',color:colors[id],collectionIds:state.collections.filter(collection=>collection.id.startsWith(id)).map(collection=>collection.id)}))
const item=(id,category,title,kind,extra={})=>{const source=kind==='card'?'deck':kind==='event'?'calendar':'tasks';const collection=state.collections.find(value=>value.id===`${category}-${source}`);return {id,title,kind,source,collectionId:collection.id,collectionTitle:collection.title,readonly:false,completed:false,...(kind==='card'?{status:'To do',stackId:'todo',assigneeIds:['tester'],assignmentCount:1,assignmentKnown:true}:{}),...extra}}
for(const category of ['personal','freelance']){
  const label=category==='personal'?'Personal':'Freelance'
  state.records.push(item(`${category}-range`,category,`${label} project preparation`,'card',{start:'2026-11-02',due:'2026-11-06',stackId:'doing'}))
  state.records.push(item(`${category}-due`,category,`${label} deadline`,'task',{due:'2026-11-03'}))
  state.records.push(item(`${category}-linked`,category,`${label} booked work`,'card'))
  state.records.push(item(`${category}-earlier`,category,`${label} overdue follow-up`,'task',{due:'2026-10-20'}))
  if(category==='personal')state.records.push(item('personal-future',category,'Personal later deadline','task',{due:'2026-12-15'}))
  for(let index=0;index<(category==='personal'?11:13);index++)state.records.push(item(`${category}-idea-${index}`,category,`${label} later idea ${index+1}`,index%2?'task':'card'))
  for(let index=0;index<9;index++){
    const day=String(2+index%7).padStart(2,'0'),hour=index<7?'09':'14'
    state.records.push(item(`${category}-event-${index}`,category,`${label} appointment ${index+1}`,'event',{start:`2026-11-${day}T${hour}:00:00+01:00`,end:`2026-11-${day}T${hour}:45:00+01:00`,busy:true}))
  }
  state.workspace.relations.push({id:`${category}-link`,type:'scheduled_during',fromId:`${category}-linked`,toId:`${category}-event-2`})
}
state.statuses=state.statuses.map(status=>({...status,state:'connected',count:state.records.filter(record=>record.source===status.source).length}))
assert.equal(state.records.filter(record=>record.kind!=='event').length,33)
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const errors=[],checks=[]
try{
  const context=await browser.newContext({viewport:{width:1652,height:1050},timezoneId:'Europe/Budapest',colorScheme:'dark'})
  const page=await context.newPage()
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(initial=>{
    let state=structuredClone(initial)
    const read=async()=>structuredClone(state)
    window.__addUngroupedFixture=()=>{state.collections.push({id:'misc-tasks',source:'tasks',title:'Misc tasks'});state.workspace.spaces[0].collectionIds.push('misc-tasks');state.records.push({id:'ungrouped-task',kind:'task',source:'tasks',title:'Unsorted follow-up',collectionId:'misc-tasks',collectionTitle:'Misc tasks',due:'2026-11-05'});state.revision++}
    window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale fixture revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(state.workspace),revision:state.revision,storage:state.storage}},openExternal:async()=>{},readPage:async()=>({body:''})}
  },state)
  await page.goto('http://127.0.0.1:5173')
  await page.getByRole('region',{name:'Timeline',exact:true}).waitFor()
  await page.getByLabel('Choose calendar date').fill('2026-11-02')
  await page.getByLabel('Choose calendar date').dispatchEvent('change')
  assert.equal(await page.getByLabel('Timeline range').inputValue(),'7')
  assert.equal(await page.locator('.overview-split .calendar-day-heading').count(),0)
  assert.equal(await page.locator('.overview-split .calendar-day-track').count(),7)
  assert.equal(await page.locator('.calendar-day-summary').count(),0)
  assert.equal(await page.locator('.timeline-event-chip').count(),0)
  assert.equal(await page.locator('.timeline-plot>.timeline-event-band').count(),0)
  assert.equal(await page.locator('.timeline-row-label').count(),6,'Only dated and booked work is expanded by default')
  assert.equal(await page.locator('.timeline-bucket-label').count(),5,'Unscheduled, overdue and other outside-period work stay explicitly available')
  assert.equal(await page.locator('.timeline-group-label[data-group-kind="category"]').count(),2)
  assert.equal(await page.locator('.timeline-group-label[data-group-kind="space"]').count(),0,'The scoped Space title should not be repeated inside its table')
  for(const category of ['personal','freelance'])assert.equal(await page.locator(`.timeline-row-label[data-category-id="${category}"]`).count(),3)
  assert.equal(await page.locator('.timeline-calendar-header').count(),0)
  assert.equal(await page.locator('.timeline-chart-row[data-record-id="personal-linked"] .session-time-label').innerText(),'09:00 – 09:45')
  await page.screenshot({path:'artifacts/calm-categories-overview.png',fullPage:true})
  checks.push('33 work items and 18 appointments produce six active work rows, two named categories and a calendar sharing the timeline date header')

  const calendar=page.locator('.overview-split .embedded-calendar')
  assert.equal(await calendar.locator('.calendar-event').count(),18)
  await calendar.locator('.calendar-event[data-record-id="personal-event-0"]').click()
  await page.getByRole('complementary',{name:'Item details'}).getByRole('heading',{name:'Personal appointment 1',exact:true}).waitFor()
  assert.equal(await page.locator('.timeline-plot>.timeline-event-band').count(),0,'Opening an event must not add bands behind Overview work rows')
  assert.match(await calendar.locator('.calendar-event[data-record-id="personal-event-0"]').getAttribute('class'),/selected/)
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  checks.push('All appointments remain accessible in the calendar pane; selecting one keeps the task timeline clear')

  await page.getByRole('button',{name:'Show unscheduled work in Personal (11)',exact:true}).click()
  assert.equal(await page.locator('.timeline-row-label[data-category-id="personal"]').count(),14)
  await page.getByRole('button',{name:'Hide unscheduled work in Personal (11)',exact:true}).click()
  await page.getByRole('button',{name:'Show overdue work in Personal (1)',exact:true}).click()
  assert.equal(await page.locator('.timeline-row-label[data-record-id="personal-earlier"]').count(),1)
  await page.getByRole('button',{name:'Hide overdue work in Personal (1)',exact:true}).click()
  await page.getByRole('button',{name:'Show work outside this period in Personal (1)',exact:true}).click()
  assert.equal(await page.locator('.timeline-row-label[data-record-id="personal-future"] .timeline-row-date.overdue').count(),0)
  await page.getByRole('button',{name:'Hide work outside this period in Personal (1)',exact:true}).click()
  const alignment=await page.evaluate(()=>{
    const labels=[...document.querySelector('.timeline-labels').querySelectorAll(':scope>button')],rows=[...document.querySelectorAll('.timeline-chart-row')]
    return labels.map((element,index)=>{const a=element.getBoundingClientRect(),b=rows[index].getBoundingClientRect();return {difference:Math.abs(a.top-b.top),height:a.height,chartHeight:b.height}})
  })
  assert.ok(alignment.every(row=>row.difference<1&&row.height===48&&row.chartHeight===48))
  checks.push('Unscheduled and earlier/later work expand independently without breaking row alignment or mislabelling overdue work')

  await page.locator('.timeline-row-label[data-record-id="personal-linked"]').click()
  assert.equal(await page.locator('.timeline-plot>.timeline-event-band').count(),0)
  assert.match(await calendar.locator('.calendar-event[data-record-id="personal-event-2"]').getAttribute('class'),/related/)
  const session=page.locator('.timeline-chart-row[data-record-id="personal-linked"] .timeline-session-link')
  assert.ok(await session.isVisible())
  await session.click()
  await page.getByRole('complementary',{name:'Item details'}).getByRole('heading',{name:'Personal appointment 3',exact:true}).waitFor()
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  assert.equal(await page.getByLabel('All calendar bands',{exact:true}).count(),0)
  checks.push('Reserved sessions remain directly clickable and highlight linked calendar events without adding bands to Overview')

  await page.setViewportSize({width:430,height:932})
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:'artifacts/calm-categories-narrow.png',fullPage:true})
  await page.setViewportSize({width:1652,height:1050})
  await page.getByRole('button',{name:'Open navigation',exact:true}).click()
  await page.getByRole('button',{name:'Settings & connection',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Light',exact:true}).click()
  await page.getByRole('button',{name:'Close dialog',exact:true}).click()
  await page.screenshot({path:'artifacts/calm-categories-light.png',fullPage:true})
  await page.evaluate(()=>window.__addUngroupedFixture())
  await page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).click()
  await page.getByRole('button',{name:'Collapse Ungrouped',exact:true}).waitFor()
  assert.equal(await page.locator('.timeline-row-label[data-record-id="ungrouped-task"]').getAttribute('data-category-id'),null)
  const order=await page.locator('.timeline-labels>button').evaluateAll(elements=>elements.map(element=>element.textContent))
  assert.ok(order.findIndex(text=>text.includes('Ungrouped'))<order.findIndex(text=>text.includes('Unsorted follow-up')))
  await page.screenshot({path:'artifacts/calm-categories-ungrouped.png',fullPage:true})
  assert.deepEqual(errors,[])
  checks.push('Light/narrow layouts stay readable; unmapped sources have an explicit Ungrouped section rather than appearing inside the last category')
  console.log(JSON.stringify({result:'PASS',checks},null,2))
  await context.close()
}catch(error){console.error(JSON.stringify({result:'FAIL',checks,errors,error:String(error)},null,2));throw error}finally{await browser.close()}
