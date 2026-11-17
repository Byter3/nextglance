/** Isolated account-free coverage for Overview's aligned work/calendar surface. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {selectScope} from './ui-navigation.mjs'

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
  for(let index=0;index<12;index++)state.records.push(item(`${category}-work-${index}`,category,`${label} ${index%2?'task':'card'} ${index+1}`,index%2?'task':'card',{start:'2026-11-02',due:`2026-11-${String(2+index%7).padStart(2,'0')}`}))
  for(let index=0;index<6;index++)state.records.push(item(`${category}-idea-${index}`,category,`${label} later idea ${index+1}`,index%2?'task':'card'))
  state.records.push(item(`${category}-later`,category,`${label} next week task`,'task',{due:'2026-11-10'}))
  for(let index=0;index<8;index++){
    const day=String(2+index).padStart(2,'0')
    state.records.push(item(`${category}-event-${index}`,category,`${label} appointment ${index+1}`,'event',{start:`2026-11-${day}T09:00:00+01:00`,end:`2026-11-${day}T10:00:00+01:00`,busy:true}))
  }
  state.workspace.relations.push({id:`${category}-link`,type:'scheduled_during',fromId:`${category}-work-0`,toId:`${category}-event-0`})
}
Object.assign(state.records.find(record=>record.id==='freelance-event-6'),{start:'2026-11-08T17:00:00+01:00',end:'2026-11-08T18:00:00+01:00'})
state.workspace.relations.push({id:'lower-work-link',type:'scheduled_during',fromId:'freelance-work-10',toId:'freelance-event-6'})
state.workspace.relations.push({id:'task-booking-link',type:'scheduled_during',fromId:'personal-work-3',toId:'personal-event-3'})
state.records.push(item('spanning-event','personal','Multi-day fixture trip','event',{start:'2026-10-30',end:'2026-11-04',allDay:true}))
for(let index=0;index<8;index++)state.records.push(item(`all-day-${index}`,'personal',`All-day reminder ${index+1}`,'event',{start:'2026-11-02',end:'2026-11-03',allDay:true}))
state.statuses=state.statuses.map(status=>({...status,state:'connected',count:state.records.filter(record=>record.source===status.source).length}))
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const errors=[],checks=[]
const context=await browser.newContext({viewport:{width:1652,height:1050},timezoneId:'Europe/Budapest',colorScheme:'dark'})
const page=await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(initial=>{
  let state=structuredClone(initial)
  const read=async()=>structuredClone(state)
  window.__fixtureNativeWrites=[]
  window.__emptyOverviewFixture=()=>{state.records=[];state.workspace.relations=[];state.workspace.plans=[];state.revision++}
  window.workspaceApi={
    getState:read,refresh:read,
    saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale fixture revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(state.workspace),revision:state.revision,storage:state.storage}},
    openExternal:async()=>{},readPage:async()=>({body:''}),
    createEvent:async()=>{throw new Error('Header creation test must cancel without submitting')},
    createTask:async()=>{throw new Error('Header creation test must cancel without submitting')},
    updateEvent:async input=>{window.__fixtureNativeWrites.push({method:'updateEvent',input});Object.assign(state.records.find(record=>record.id===input.id),{start:input.start,end:input.end,allDay:input.allDay});return read()},
    updateRecordDates:async input=>{window.__fixtureNativeWrites.push({method:'updateRecordDates',input});const record=state.records.find(record=>record.id===input.id);for(const key of ['start','due','end'])if(input[key]!==undefined)record[key]=input[key]||undefined;if(input.allDay!==undefined)record.allDay=input.allDay;return read()},
    setTaskDue:async input=>{window.__fixtureNativeWrites.push({method:'setTaskDue',input});state.records.find(record=>record.id===input.id).due=input.due;return read()},
    createLinkedEvent:async input=>{
      if(input.expectedRevision!==state.revision)throw new Error('Stale fixture schedule revision')
      window.__fixtureNativeWrites.push({method:'createLinkedEvent',input})
      const collection=state.collections.find(value=>value.id===input.collectionId)
      state.records.push({id:'fixture-booking',kind:'event',source:'calendar',title:input.title,collectionId:input.collectionId,collectionTitle:collection.title,start:input.start,end:input.end,allDay:input.allDay,busy:true,readonly:false})
      state.workspace.relations.push({id:'fixture-booking-link',type:'scheduled_during',fromId:input.recordId,toId:'fixture-booking'})
      state.revision++;return read()
    },
  }
},state)
const split=page.locator('.overview-split')
const timeline=()=>split.locator('.timeline-view')
const calendar=()=>split.locator('.embedded-calendar')
const separator=()=>page.getByRole('separator',{name:'Resize timeline and calendar',exact:true})
const details=()=>page.getByRole('complementary',{name:'Item details'})
const chooseDate=async value=>{await page.getByLabel('Choose calendar date').fill(value);await page.getByLabel('Choose calendar date').dispatchEvent('change')}
const closeDetails=async()=>{await page.getByRole('button',{name:'Close item details',exact:true}).click()}
const paneBoxes=async()=>({timeline:await timeline().boundingBox(),calendar:await calendar().boundingBox(),split:await split.boundingBox()})
const scrollPositions=()=>page.evaluate(()=>({timeline:document.querySelector('.overview-split .timeline-scroll').scrollTop,calendar:document.querySelector('.overview-split .calendar-times-scroll').scrollTop,page:window.scrollY}))
const settle=async()=>{await page.waitForFunction(()=>!document.querySelector('.saving-indicator'))}
const alignment=()=>page.evaluate(()=>{
  const headings=[...document.querySelectorAll('.overview-split .timeline-days>div')],tracks=[...document.querySelectorAll('.overview-split .calendar-day-track')]
  return headings.map((heading,index)=>{const top=heading.getBoundingClientRect(),bottom=tracks[index]?.getBoundingClientRect();return {left:bottom?Math.abs(top.left-bottom.left):Infinity,width:bottom?Math.abs(top.width-bottom.width):Infinity}})
})
async function assertAligned(label){
  try{await page.waitForFunction(()=>{
      const headings=[...document.querySelectorAll('.overview-split .timeline-days>div')],tracks=[...document.querySelectorAll('.overview-split .calendar-day-track')]
      return headings.length===tracks.length&&headings.every((heading,index)=>{const top=heading.getBoundingClientRect(),bottom=tracks[index].getBoundingClientRect();return Math.abs(top.left-bottom.left)<1.1&&Math.abs(top.width-bottom.width)<1.1})
    },null,{timeout:4000})
  }catch{throw new Error(`${label} is misaligned: ${JSON.stringify(await alignment())}`)}
  assert.ok((await alignment()).every(value=>value.left<1.1&&value.width<1.1),`${label}: ${JSON.stringify(await alignment())}`)
}
async function isVisibleWithin(item,scrollRegion){
  const target=await item.elementHandle(),container=await scrollRegion.elementHandle()
  try{await page.waitForFunction(({target,container})=>{const bounds=target.getBoundingClientRect(),region=container.getBoundingClientRect();return bounds.y>=region.y-1&&bounds.bottom<=region.bottom+1},{target,container},{timeout:4000});return true}catch{return false}
}

try{
  await page.goto('http://127.0.0.1:5173')
  await split.waitFor()
  await chooseDate('2026-11-02')
  assert.equal(await page.getByLabel('Timeline range').inputValue(),'7')
  assert.equal(await timeline().locator('.timeline-days>div').count(),7)
  assert.equal(await calendar().locator('.calendar-day-heading').count(),0,'Overview has one shared date header')
  assert.equal(await calendar().locator('.calendar-day-track').count(),7)
  await assertAligned('Initial seven-day axis')
  assert.equal(await timeline().locator('.timeline-calendar-context,.timeline-calendar-header,.calendar-day-summary,.timeline-event-band').count(),0,'Overview task rows must have no calendar strip or bands')
  assert.equal(await split.getByLabel('All calendar bands',{exact:true}).count(),0)
  assert.equal(await calendar().locator('.unscheduled-tray,.view-explainer').count(),0)
  let boxes=await paneBoxes()
  assert.ok(boxes.timeline.height>280&&boxes.calendar.height>280,JSON.stringify(boxes))
  assert.ok(Math.abs(boxes.timeline.height-boxes.calendar.height)<90,'Both planning panes start near half height')
  assert.ok(boxes.calendar.y>boxes.timeline.y+boxes.timeline.height,'Calendar belongs below the work timeline')
  assert.ok(boxes.split.y+boxes.split.height<=1051,'The split stays within the available desktop height')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1),'The desktop page itself must not overflow')
  assert.equal(await timeline().locator('.timeline-group-label[data-group-kind="category"]').count(),2)
  assert.equal(await timeline().locator('.timeline-row-label').count(),24)
  assert.ok(await calendar().locator('.calendar-all-day-viewport').evaluate(element=>element.getBoundingClientRect().height<=176),'Dense all-day items have a generous shared strip while leaving room for the time grid')
  await page.screenshot({path:'artifacts/overview-split-dark.png',fullPage:true})
  checks.push('Dense grouped work and native calendar share one aligned seven-day axis in a balanced surface without duplicate date headers or page overflow')

  await timeline().locator('.timeline-days>div').nth(2).getByRole('button',{name:/^New item on /}).click()
  let capture=page.getByRole('dialog')
  assert.equal(await capture.getByRole('combobox',{name:'Item type',exact:true}).inputValue(),'task')
  assert.equal(await capture.getByLabel('Start',{exact:true}).inputValue(),'')
  assert.equal(await capture.getByLabel('Deadline',{exact:true}).inputValue(),'2026-11-04')
  await capture.getByRole('combobox',{name:'Item type',exact:true}).selectOption('event')
  assert.equal(await capture.getByLabel('Start',{exact:true}).inputValue(),'2026-11-04')
  assert.equal(await capture.getByLabel('End',{exact:true}).inputValue(),'2026-11-05')
  assert.equal(await capture.getByLabel('All day',{exact:true}).isChecked(),true)
  page.once('dialog',dialog=>dialog.accept())
  await capture.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>window.__fixtureNativeWrites),[])
  checks.push('The shared date header opens creation for its full selected day with an exclusive next-day event end, and cancels without writing')

  const topScroller=timeline().locator('.timeline-scroll'),bottomScroller=calendar().locator('.calendar-times-scroll')
  const before=await scrollPositions()
  await topScroller.hover();await page.mouse.wheel(0,540)
  await page.waitForFunction(previous=>document.querySelector('.overview-split .timeline-scroll').scrollTop>previous, before.timeline)
  const afterTop=await scrollPositions()
  assert.equal(afterTop.calendar,before.calendar);assert.equal(afterTop.page,before.page)
  await bottomScroller.hover();await page.mouse.wheel(0,360)
  await page.waitForFunction(previous=>document.querySelector('.overview-split .calendar-times-scroll').scrollTop>previous,afterTop.calendar)
  const afterBottom=await scrollPositions()
  assert.equal(afterBottom.timeline,afterTop.timeline);assert.equal(afterBottom.page,before.page)
  await topScroller.evaluate(element=>element.scrollTop=0)
  await bottomScroller.evaluate(element=>element.scrollTop=7*48)
  checks.push('Wheel scrolling in either pane leaves the other pane and outer page stationary')

  await separator().focus()
  const initialValue=Number(await separator().getAttribute('aria-valuenow'))
  await separator().press('ArrowDown')
  assert.ok(Number(await separator().getAttribute('aria-valuenow'))>initialValue)
  await separator().press('ArrowUp')
  assert.equal(Number(await separator().getAttribute('aria-valuenow')),initialValue)
  await separator().press('Home')
  assert.equal(Number(await separator().getAttribute('aria-valuenow')),Number(await separator().getAttribute('aria-valuemin')))
  await separator().press('End')
  assert.equal(Number(await separator().getAttribute('aria-valuenow')),Number(await separator().getAttribute('aria-valuemax')))
  await separator().press('Home')
  const divider=await separator().boundingBox(),container=await split.boundingBox()
  await page.mouse.move(divider.x+divider.width/2,divider.y+divider.height/2)
  await page.mouse.down();await page.mouse.move(divider.x+divider.width/2,container.y+container.height/2,{steps:12});await page.mouse.up()
  assert.ok(Math.abs(Number(await separator().getAttribute('aria-valuenow'))-50)<=3)
  checks.push('Accessible splitter supports keyboard bounds and pointer dragging back to a balanced layout')

  await timeline().locator('[data-record-id="personal-work-0"].timeline-row-label').click()
  await details().getByRole('heading',{name:'Personal card 1',exact:true}).waitFor()
  const linked=calendar().locator('.calendar-event[data-record-id="personal-event-0"]')
  assert.match(await linked.getAttribute('class'),/related/)
  assert.ok(await isVisibleWithin(linked,bottomScroller),'Selecting work reveals its booked time')
  assert.equal(await linked.evaluate(element=>element.style.getPropertyValue('--record-color')),colors.personal)
  assert.equal(await timeline().locator('.timeline-days>div.active-day').count(),1)
  assert.equal(await calendar().locator('.calendar-day-track.active-day').getAttribute('data-day'),'2026-11-02')
  await assertAligned('Inspector open')
  await details().getByRole('button',{name:'Schedule in calendar',exact:true}).click()
  const dialog=page.getByRole('dialog')
  await dialog.getByRole('heading',{name:'Schedule in calendar',exact:true}).waitFor()
  assert.equal(await dialog.getByLabel('Event title',{exact:true}).inputValue(),'Personal card 1')
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
  await linked.click()
  await details().getByRole('heading',{name:'Personal appointment 1',exact:true}).waitFor()
  assert.match(await linked.getAttribute('class'),/selected/)
  await closeDetails()
  assert.deepEqual(await page.evaluate(()=>window.__fixtureNativeWrites),[])
  await topScroller.evaluate(element=>element.scrollTop=0)
  await bottomScroller.evaluate(element=>element.scrollTop=16*48)
  await calendar().locator('.calendar-event[data-record-id="freelance-event-6"]').click()
  await details().getByRole('heading',{name:'Freelance appointment 7',exact:true}).waitFor()
  const relatedWork=timeline().locator('.timeline-row-label[data-record-id="freelance-work-10"]')
  await page.waitForFunction(()=>document.querySelector('.overview-split .timeline-scroll').scrollTop>0)
  assert.match(await relatedWork.getAttribute('class'),/connected/)
  assert.ok(await isVisibleWithin(relatedWork,topScroller),'Selecting an event reveals its linked work row')
  await closeDetails()
  await assertAligned('Inspector closed')
  checks.push('Linked selection reveals the matching booking or work row, highlights its day, and keeps the shared axis aligned through inspector resizing')

  await calendar().locator('.all-day-event[data-record-id="spanning-event"]').click()
  await details().getByRole('heading',{name:'Multi-day fixture trip',exact:true}).waitFor()
  assert.equal(await page.getByLabel('Choose calendar date').inputValue(),'2026-11-02','A spanning event focuses its visible part without jumping to its earlier start')
  assert.equal(await calendar().locator('.calendar-day-track.active-day').getAttribute('data-day'),'2026-11-02')
  await closeDetails()
  await timeline().locator('.timeline-row-label[data-record-id="personal-work-0"]').click()
  await page.getByRole('button',{name:'Next period',exact:true}).click()
  await page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).click()
  await settle()
  assert.equal(await page.getByLabel('Choose calendar date').inputValue(),'2026-11-09','Selection refresh must respect manual period navigation')
  if(!await timeline().locator('.timeline-row-label[data-record-id="personal-work-0"]').count())await timeline().getByRole('button',{name:/Show work outside this period in Personal/}).click()
  await timeline().locator('.timeline-row-label[data-record-id="personal-work-0"]').click()
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Choose calendar date"]').value==='2026-11-02')
  assert.ok(await isVisibleWithin(calendar().locator('.calendar-event[data-record-id="personal-event-0"]'),bottomScroller),'Re-clicking selected work reveals its booking again')
  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  await page.getByRole('button',{name:'Next period',exact:true}).click()
  await page.getByRole('tab',{name:'Overview',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Choose calendar date"]').value==='2026-11-02')
  assert.ok(await isVisibleWithin(calendar().locator('.calendar-event[data-record-id="personal-event-0"]'),bottomScroller),'Re-entering Overview honors the existing selected work')
  await closeDetails()
  checks.push('Multi-day events focus their visible intersection; manual navigation stays put until work is reselected, and Overview entry restores selected work context')

  for(const dayCount of [14,28]){
    await page.getByLabel('Timeline range').selectOption(String(dayCount))
    assert.equal(await timeline().locator('.timeline-days>div').count(),dayCount)
    assert.equal(await calendar().locator('.calendar-day-track').count(),dayCount)
    assert.equal(await calendar().locator('.calendar-day-heading').count(),0)
    await assertAligned(`${dayCount}-day axis`)
    const available=await topScroller.evaluate(element=>element.clientWidth-element.querySelector('.timeline-head-name').getBoundingClientRect().width)
    const axisWidth=await timeline().locator('.timeline-days').evaluate(element=>element.getBoundingClientRect().width)
    assert.ok(axisWidth<=available+1,'The selected desktop range fits the shared date area')
    assert.equal(await topScroller.evaluate(element=>getComputedStyle(element).overflowX),'hidden','Work rows must not show a second horizontal scrollbar')
    assert.ok(await split.locator('.date-scroll-thumb').isVisible(),'A shared visible date thumb remains available when columns fit')
  }
  await page.getByLabel('Timeline range').selectOption('14')
  assert.equal(await calendar().locator('.calendar-event[data-record-id="personal-event-7"]').count(),1)
  await page.getByRole('button',{name:'Next period',exact:true}).click()
  assert.equal(await page.getByLabel('Choose calendar date').inputValue(),'2026-11-16')
  assert.equal(await calendar().locator('.calendar-event').count(),0)
  await page.getByRole('button',{name:'Previous period',exact:true}).click()
  await page.getByLabel('Timeline range').selectOption('7')
  await selectScope(page,'Personal',{space:'First',kind:'category'})
  await settle()
  assert.equal(await timeline().locator('.timeline-row-label[data-category-id="freelance"]').count(),0)
  assert.equal(await calendar().locator('.calendar-event[data-record-id^="freelance-"]').count(),0)
  assert.equal(await calendar().locator('.calendar-event[data-record-id^="personal-"]').count(),7)
  await selectScope(page,'First',{kind:'space'})
  await settle()
  checks.push('Seven, fourteen and twenty-eight-day columns fit the desktop and stay pixel-aligned through date navigation and category filters')

  await timeline().locator('[data-record-id="personal-work-0"].timeline-row-label').click()
  await calendar().locator('.calendar-event[data-record-id="personal-event-0"]').click()
  await details().getByRole('button',{name:'Edit dates',exact:true}).click()
  await dialog.locator('.dates-precise>summary').click()
  await dialog.getByLabel('Start date',{exact:true}).fill('2026-11-03T16:00')
  await dialog.getByLabel('End date',{exact:true}).fill('2026-11-03T17:00')
  await dialog.getByRole('button',{name:'Save dates',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.overview-split .timeline-chart-row[data-record-id="personal-work-0"] .session-time-label')?.textContent.includes('16:00'))
  assert.match(await calendar().locator('.calendar-event[data-record-id="personal-event-0"]').getAttribute('aria-label'),/16:00/)
  await timeline().locator('[data-record-id="personal-work-0"].timeline-row-label').click()
  await details().getByRole('button',{name:'Schedule in calendar',exact:true}).click()
  await dialog.getByLabel('Event title',{exact:true}).fill('New connected fixture booking')
  await dialog.locator('.schedule-exact>summary').click()
  await dialog.getByLabel('Start',{exact:true}).fill('2026-11-04T11:00')
  await dialog.getByLabel('End',{exact:true}).fill('2026-11-04T12:00')
  await dialog.getByRole('button',{name:'Create & link',exact:true}).click()
  await dialog.waitFor({state:'hidden'})
  await chooseDate('2026-11-02')
  assert.equal(await calendar().locator('.calendar-event[data-record-id="fixture-booking"]').count(),1)
  assert.match(await timeline().locator('.timeline-chart-row[data-record-id="personal-work-0"]').innerText(),/11:00/)
  assert.deepEqual(await page.evaluate(()=>window.__fixtureNativeWrites.map(call=>call.method)),['updateRecordDates','createLinkedEvent'])
  await closeDetails()
  await assertAligned('After fixture date and booking updates')
  checks.push('Editing an event or creating a linked booking updates its work marker and calendar block together using isolated fixture writes')

  for(const testCase of [{id:'personal-work-1',due:'2026-11-06',dayIndex:4,activeDay:'2026-11-06'},{id:'personal-work-3',due:'2026-11-07',dayIndex:5,activeDay:'2026-11-05'}]){
    const bookingsBefore=await page.evaluate(()=>window.workspaceApi.getState().then(state=>state.records.filter(record=>record.kind==='event').map(record=>({id:record.id,start:record.start,end:record.end}))))
    await timeline().locator(`.timeline-row-label[data-record-id="${testCase.id}"]`).click()
    await details().getByRole('button',{name:'Edit dates',exact:true}).click()
    await dialog.locator('.dates-precise>summary').click()
    await dialog.getByLabel('Deadline date',{exact:true}).fill(testCase.due)
    await dialog.getByRole('button',{name:'Save dates',exact:true}).click()
    await calendar().locator(`.all-day-event[data-last-day="${testCase.due}"][data-record-id="${testCase.id}"]`).waitFor()
    const marker=await timeline().locator(`.timeline-chart-row[data-record-id="${testCase.id}"] .timeline-deadline`).boundingBox()
    const header=await timeline().locator('.timeline-days>div').nth(testCase.dayIndex).boundingBox()
    assert.ok(marker.x+marker.width/2>=header.x-1&&marker.x+marker.width/2<=header.x+header.width+1,'The due marker moves to the same day as its calendar deadline chip')
    assert.equal(await calendar().locator('.calendar-day-track.active-day').getAttribute('data-day'),testCase.activeDay)
    const bookingsAfter=await page.evaluate(()=>window.workspaceApi.getState().then(state=>state.records.filter(record=>record.kind==='event').map(record=>({id:record.id,start:record.start,end:record.end}))))
    assert.deepEqual(bookingsAfter,bookingsBefore,'Changing a task deadline must not move native calendar bookings')
    await closeDetails()
  }
  await assertAligned('After native task deadline updates')
  checks.push('Native task deadline edits move both due markers together, focus the relevant day, and preserve separately linked calendar booking times')

  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  assert.equal(await split.count(),0)
  assert.equal(await page.getByLabel('Timeline range').inputValue(),'14')
  assert.equal(await page.locator('.timeline-calendar-header').count(),1)
  assert.equal(await page.getByLabel('All calendar bands',{exact:true}).isChecked(),true)
  assert.ok(await page.locator('.timeline-event-band').count()>0)
  await page.getByRole('tab',{name:'Calendar',exact:true}).click()
  assert.equal(await page.locator('.unscheduled-tray').count(),1)
  assert.equal(await page.locator('.calendar-day-heading').count(),7)
  await page.getByRole('tab',{name:'Overview',exact:true}).click()
  checks.push('Separate Timeline retains its detailed agenda and calendar bands; standalone Calendar retains its unscheduled tray')

  await page.getByRole('button',{name:'Open navigation',exact:true}).click()
  await page.getByRole('button',{name:'Settings & connection',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Light',exact:true}).click()
  await page.getByRole('button',{name:'Close dialog',exact:true}).click()
  await page.locator('.toast').waitFor({state:'hidden'})
  await page.screenshot({path:'artifacts/overview-split-light.png',fullPage:true})
  await page.setViewportSize({width:430,height:932})
  await split.waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Narrow Overview must not widen the page')
  boxes=await paneBoxes()
  assert.ok(boxes.timeline.height>=200&&boxes.calendar.height>=200)
  assert.ok(boxes.calendar.y>=boxes.timeline.y+boxes.timeline.height)
  await assertAligned('Narrow viewport')
  await bottomScroller.evaluate(element=>element.scrollLeft=300)
  await assertAligned('Narrow viewport after horizontal scrolling')
  await page.screenshot({path:'artifacts/overview-split-narrow.png',fullPage:true})
  await page.setViewportSize({width:1652,height:1050})
  await page.evaluate(()=>window.__emptyOverviewFixture())
  await page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).click()
  await settle()
  assert.equal(await timeline().locator('.timeline-row-label').count(),0)
  assert.equal(await calendar().locator('.calendar-event,.all-day-event').count(),0)
  assert.equal(await calendar().locator('.calendar-day-heading').count(),0)
  assert.equal(await calendar().locator('.calendar-day-track').count(),7)
  await assertAligned('Empty Overview')
  assert.ok(await separator().isVisible())
  assert.deepEqual(errors,[])
  checks.push('Light, narrow and empty Overview remain usable and retain the two-pane structure')
  console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){console.error(JSON.stringify({result:'FAIL',checks,errors,error:String(error)},null,2));await page.screenshot({path:'artifacts/overview-split-failure.png',fullPage:true});throw error}finally{await context.close();await browser.close()}
