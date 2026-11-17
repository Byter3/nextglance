/** Native creation UI against an isolated bridge; never accesses a real account. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
import {selectScope} from './ui-navigation.mjs'

process.env.TZ='Europe/Budapest'
await mkdir('artifacts',{recursive:true})
const initial=plannerFixture(new Date(2026,10,2,9))
initial.workspace.planner.view='overview'
initial.collections.push({id:'notes-real-uncategorized',source:'notes',title:'Uncategorized',remote:{category:'Uncategorized'}},{id:'readonly-board',source:'deck',title:'Read-only board',readonly:true,stacks:[{id:'readonly-stack',title:'To do'}]})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1500,height:1000},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(15000)
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message))
page.on('dialog',dialog=>dialog.accept())
await page.addInitScript(initial=>{
  const clone=value=>structuredClone(value)
  let state=clone(initial),nextId=0
  const read=async()=>clone(state)
  window.__creationCalls=[];window.__holdCreation=false;window.__failCreation=false
  const create=type=>async input=>{
    window.__creationCalls.push({type,input:clone(input)})
    if(window.__holdCreation)await new Promise(resolve=>{window.__releaseCreation=()=>{window.__holdCreation=false;resolve()}})
    if(window.__failCreation){window.__failCreation=false;throw Error('Example source rejected this creation. Please retry.')}
    const id=`created-${++nextId}`,kind=type,source=type==='event'?'calendar':type==='card'?'deck':type==='task'?'tasks':'notes'
    const record={id,kind,source,...clone(input),body:input.description||input.content||'',readonly:false,collectionTitle:state.collections.find(c=>c.id===input.collectionId)?.title}
    if(type==='card')Object.assign(record,{assigneeIds:input.assignToMe?[state.connection.username]:[],assignmentKnown:true,assignmentCount:input.assignToMe?1:0,status:state.collections.find(c=>c.id===input.collectionId)?.stacks?.find(s=>s.id===input.stackId)?.title})
    state.records.push(record);state.createdRecordId=id
    return clone(state)
  }
  window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{
    if(revision!==state.revision)throw Error('Stale creation fixture')
    state.workspace=clone(workspace);state.revision++
    return {workspace:clone(workspace),revision:state.revision,storage:clone(state.storage)}
  },createTask:create('task'),createCard:create('card'),createEvent:create('event'),createNote:create('note'),openExternal:async()=>{},readPage:async()=>({body:''}),syncWorkspace:read,exportWorkspace:async()=>({exported:true})}
},initial)
const dialog=()=>page.getByRole('dialog',{name:'New item',exact:true})
const form=()=>dialog().locator('.create-item-form')
const read=()=>page.evaluate(()=>window.workspaceApi.getState())
const calls=()=>page.evaluate(()=>window.__creationCalls)
async function closeDetails(){const close=page.getByRole('button',{name:'Close item details',exact:true});if(await close.count())await close.click()}
async function open(type){await closeDetails();await page.locator('.topbar-actions').getByRole('button',{name:'New item',exact:true}).click();if(type)await form().getByLabel('Item type',{exact:true}).selectOption(type)}
async function fillTitle(title){await form().getByLabel('Title',{exact:true}).fill(title)}
async function create(type){await form().getByRole('button',{name:`Create ${type}`,exact:true}).click();await dialog().waitFor({state:'hidden'})}
async function anchor(){await page.getByLabel('Choose calendar date',{exact:true}).fill('2026-11-02');await page.getByLabel('Choose calendar date',{exact:true}).dispatchEvent('change')}

try{
  await page.goto('http://127.0.0.1:5173');await page.locator('.overview-split').waitFor()
  await selectScope(page,'Freelance',{kind:'space'})
  await open('event')
  assert.deepEqual(await form().getByLabel('Item type',{exact:true}).locator('option').evaluateAll(items=>items.map(x=>x.value)),['task','card','event','note'])
  assert.equal(await form().getByLabel('Calendar',{exact:true}).inputValue(),'calendar-work')
  await form().getByLabel('Start',{exact:true}).fill('2026-11-03T10:15')
  await form().getByLabel('End',{exact:true}).fill('2026-11-05T11:45')
  await form().getByLabel('All day',{exact:true}).check()
  assert.equal(await form().getByLabel('Start',{exact:true}).inputValue(),'2026-11-03')
  assert.equal(await form().getByLabel('End',{exact:true}).inputValue(),'2026-11-06')
  await form().getByLabel('All day',{exact:true}).uncheck()
  assert.equal(await form().getByLabel('Start',{exact:true}).inputValue(),'2026-11-03T10:15')
  assert.equal(await form().getByLabel('End',{exact:true}).inputValue(),'2026-11-05T11:45')
  await form().getByLabel('All day',{exact:true}).check()
  await fillTitle('Multi-day creation example')
  await page.evaluate(()=>{window.__holdCreation=true})
  await form().getByRole('button',{name:'Create event',exact:true}).click()
  await form().getByRole('button',{name:'Creating…',exact:true}).waitFor()
  assert.equal(await form().getByLabel('Item type',{exact:true}).isDisabled(),true)
  assert.equal(await form().getByLabel('Item type',{exact:true}).locator('option').count(),4,'Busy must not remove supported item types')
  assert.equal(await form().getByLabel('Calendar',{exact:true}).inputValue(),'calendar-work')
  await page.evaluate(()=>window.__releaseCreation())
  await dialog().waitFor({state:'hidden'})
  let sent=(await calls()).at(-1)
  assert.equal(sent.input.start,'2026-11-03');assert.equal(sent.input.end,'2026-11-06');assert.equal(sent.input.allDay,true)
  checks.push('All-day conversion preserves a multi-day interval and exact times on a round trip; source and type remain stable while creating')

  await open('task');assert.equal(await form().getByLabel('Task list',{exact:true}).inputValue(),'tasks-work')
  await fillTitle('Task with validated dates')
  await form().getByLabel('Start',{exact:true}).fill('2026-11-03');await form().getByLabel('Deadline',{exact:true}).fill('2026-11-03')
  const before=(await calls()).length
  await form().getByRole('button',{name:'Create task',exact:true}).click()
  await form().getByRole('alert').filter({hasText:'For a one-day date-only task, leave Start empty'}).waitFor()
  assert.equal((await calls()).length,before)
  await form().getByLabel('Start',{exact:true}).fill('2026-11-02');await create('task')
  sent=(await calls()).at(-1);assert.equal(sent.input.start,'2026-11-02');assert.equal(sent.input.due,'2026-11-03')
  checks.push('Task creation uses its scope destination and rejects equal DATE start/deadline before making a native request')

  await open('card');assert.equal(await form().getByLabel('Deck board',{exact:true}).inputValue(),'deck-work')
  assert.equal(await form().getByLabel('Deck board',{exact:true}).locator('option[value="readonly-board"]').count(),0)
  assert.equal(await form().getByLabel('Assign to me',{exact:true}).isChecked(),true)
  await form().getByLabel('Deck stack',{exact:true}).selectOption('stack-progress')
  await fillTitle('Created Deck checklist')
  await form().getByLabel('Start',{exact:true}).fill('2026-11-04');await form().getByLabel('Deadline',{exact:true}).fill('2026-11-04')
  await form().getByLabel(/^Description/).fill('- [ ] First step\n- [ ] Second step')
  await page.screenshot({path:'artifacts/creation-card-form.png'})
  await create('card')
  sent=(await calls()).at(-1);assert.equal(sent.type,'card');assert.equal(sent.input.stackId,'stack-progress');assert.equal(sent.input.assignToMe,true);assert.equal(sent.input.start,'2026-11-04');assert.equal(sent.input.due,'2026-11-04');assert.match(sent.input.description,/First step/)
  checks.push('Deck creation chooses a writable board and native stack, preserves description/range, and defaults Assign to me')

  await closeDetails();await selectScope(page,'Personal',{kind:'space'});await open('card')
  assert.equal(await form().getByLabel('Deck board',{exact:true}).inputValue(),'','An explicit Space without a board must not default to another Space board')
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
  await selectScope(page,'My overview');await page.getByRole('tab',{name:'Overview',exact:true}).click();await anchor()
  const personalLabel=page.locator('.timeline-row-label[data-record-id="task-personal"]');await personalLabel.scrollIntoViewIfNeeded()
  const personalRow=page.locator('.timeline-chart-row[data-record-id="task-personal"]'),personalBox=await personalRow.boundingBox()
  await page.mouse.click(personalBox.x+12,personalBox.y+personalBox.height/2)
  await dialog().waitFor();assert.equal(await form().getByLabel('Task list',{exact:true}).inputValue(),'tasks-personal');assert.equal(await form().locator('.creation-context').count(),0,'An Overview row provides its native destination without inheriting a matching Space')
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click();await selectScope(page,'Freelance',{kind:'space'})
  checks.push('Explicit Spaces never suggest unrelated boards, and Overview rows prefill native destinations without inheriting a Space or project')

  await closeDetails();await page.getByRole('tab',{name:'Overview',exact:true}).click();await anchor()
  const header=page.locator('.overview-split .timeline-days > div').first(),box=await header.boundingBox()
  await page.mouse.click(box.x+box.width/2,box.y+18)
  await dialog().waitFor()
  assert.equal(await form().getByLabel('Item type',{exact:true}).inputValue(),'task')
  assert.equal(await form().getByLabel('Start',{exact:true}).inputValue(),'')
  assert.equal(await form().getByLabel('Deadline',{exact:true}).inputValue(),'2026-11-02')
  await form().getByText('A one-day task uses a deadline. Add a start for a longer range.',{exact:true}).waitFor()
  await form().getByLabel('Item type',{exact:true}).selectOption('event')
  assert.equal(await form().getByLabel('Start',{exact:true}).inputValue(),'2026-11-02');assert.equal(await form().getByLabel('End',{exact:true}).inputValue(),'2026-11-03')
  await form().getByLabel('Item type',{exact:true}).selectOption('card')
  assert.equal(await form().getByLabel('Start',{exact:true}).inputValue(),'2026-11-02');assert.equal(await form().getByLabel('Deadline',{exact:true}).inputValue(),'2026-11-02')
  await form().getByLabel('Item type',{exact:true}).selectOption('note')
  assert.equal(await form().getByLabel('Start',{exact:true}).count(),0)
  await form().getByText('Notes have no scheduled dates. The selected range will not be saved.',{exact:true}).waitFor()
  await form().getByLabel('Folder',{exact:true}).selectOption('notes-real-uncategorized')
  await fillTitle('A note from the timeline');await form().getByLabel('Note',{exact:true}).fill('Reference material')
  await create('note')
  sent=(await calls()).at(-1);assert.equal(sent.input.collectionId,'notes-real-uncategorized');assert.equal(sent.input.content,'Reference material');assert.equal('start' in sent.input,false)
  checks.push('Timeline selection pre-fills each item type correctly, makes one-day tasks deadline-only, and keeps Note category identity without inventing dates')

  await closeDetails();await page.getByRole('tab',{name:'Calendar',exact:true}).click();await anchor()
  const track=page.locator('.calendar-day-track[data-day="2026-11-02"]')
  const hourHeight=await page.locator('.calendar-hour-line').first().evaluate(e=>e.getBoundingClientRect().height)
  await page.locator('.calendar-times-scroll').evaluate((e,h)=>{e.scrollTop=7*h},hourHeight)
  const bounds=await track.boundingBox(),x=bounds.x+bounds.width/2
  await page.mouse.move(x,bounds.y+8*hourHeight);await page.mouse.down();await page.mouse.move(x,bounds.y+9.5*hourHeight,{steps:12});await page.mouse.up()
  await dialog().waitFor()
  assert.equal(await form().getByLabel('Item type',{exact:true}).inputValue(),'event')
  assert.equal(await form().getByLabel('Start',{exact:true}).inputValue(),'2026-11-02T08:00')
  assert.equal(await form().getByLabel('End',{exact:true}).inputValue(),'2026-11-02T09:30')
  await fillTitle('Timed calendar selection');await create('event')
  sent=(await calls()).at(-1);assert.equal(sent.input.start,new Date('2026-11-02T08:00:00+01:00').toISOString());assert.equal(sent.input.end,new Date('2026-11-02T09:30:00+01:00').toISOString())
  checks.push('Calendar drag opens the event popup with its exact selected times and writes UTC instants')

  await open('task');await fillTitle('Keep this failed draft');await form().getByLabel('Deadline',{exact:true}).fill('2026-11-10')
  await page.evaluate(()=>{window.__failCreation=true})
  await form().getByRole('button',{name:'Create task',exact:true}).click()
  await dialog().getByRole('alert').filter({hasText:'Example source rejected'}).first().waitFor()
  assert.equal(await form().getByLabel('Title',{exact:true}).inputValue(),'Keep this failed draft')
  assert.equal(await form().getByLabel('Deadline',{exact:true}).inputValue(),'2026-11-10')
  await create('task')
  assert.equal((await read()).records.filter(r=>r.title==='Keep this failed draft').length,1)
  checks.push('A failed creation keeps the complete form draft for correction and retry')

  assert.deepEqual(errors,[])
  await writeFile('artifacts/creation-form-ui-report.json',JSON.stringify({checks,errors},null,2))
  console.log(JSON.stringify({checks,errors},null,2))
}finally{await browser.close()}
