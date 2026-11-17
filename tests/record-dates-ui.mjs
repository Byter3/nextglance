/** Inspector dates and mini-timeline gestures against an isolated in-memory bridge. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixture=plannerFixture(new Date(2026,10,4,9))
fixture.workspace.appearance.mode='dark'
Object.assign(fixture.records.find(record=>record.id==='card-mine'),{start:undefined,due:undefined})
fixture.records.push({...fixture.records.find(record=>record.id==='task-undated'),id:'readonly-date-task',title:'Read only date fixture',readonly:true})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1550,height:1050},timezoneId:'Europe/Budapest'})
const errors=[],checks=[]
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(initial=>{
  let state=structuredClone(initial)
  window.__dateWrites=[]
  window.__dateAttempts=[]
  window.__otherWrites=[]
  window.__failNextDate=false
  const read=async()=>structuredClone(state)
  window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw Error('Stale fixture');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},updateRecordDates:async input=>{const record=state.records.find(record=>record.id===input.id);if(record.readonly)throw Error('Read only fixture');window.__dateAttempts.push(structuredClone(input));if(window.__failNextDate){window.__failNextDate=false;throw Error('Fixture date save failed')}window.__dateWrites.push(structuredClone(input));for(const field of ['start','due','end'])if(input[field]!==undefined)record[field]=input[field]||undefined;if(input.allDay!==undefined)record.allDay=input.allDay;record.etag='dates-fixture-'+window.__dateWrites.length;return read()},setTaskCompleted:async input=>{window.__otherWrites.push({method:'setTaskCompleted',input:structuredClone(input)});const record=state.records.find(record=>record.id===input.id);record.completed=input.completed;record.status=input.completed?'COMPLETED':'NEEDS-ACTION';return read()},openExternal:async()=>{},readPage:async()=>({body:''})}
},fixture)
const inspector=()=>page.getByRole('complementary',{name:'Item details'})
const dialog=()=>page.getByRole('dialog',{name:'Plan dates',exact:true})
const editor=()=>dialog().locator('.record-dates-editor')
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const writes=()=>page.evaluate(()=>window.__dateWrites)
const readDays=()=>editor().locator('.dates-day-grid>div').evaluateAll(nodes=>nodes.map(node=>node.dataset.date))
async function open(title){await page.getByRole('tab',{name:'List',exact:true}).click();await page.getByLabel('Search this view',{exact:true}).fill(title);await page.locator('.list-table-row').filter({hasText:title}).click();await inspector().getByRole('heading',{name:title,exact:true,level:2}).waitFor()}
async function edit(){await inspector().getByRole('button',{name:/^(Set|Edit) dates$/}).click();await dialog().waitFor()}
async function select(first,last,escape=false){const box=await editor().locator('.dates-edit-lane').boundingBox();await page.mouse.move(box.x+box.width/14*(first+.5),box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width/14*(last+.5),box.y+box.height*.5,{steps:10});if(escape)await page.keyboard.press('Escape');await page.mouse.up()}
async function save(){await dialog().getByRole('button',{name:'Save dates',exact:true}).click();await dialog().waitFor({state:'hidden'});await page.waitForTimeout(120)}
async function precise(){await editor().locator('.dates-precise>summary').click()}
async function shift(locator,days){const handle=await locator.boundingBox(),lane=await editor().locator('.dates-edit-lane').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+lane.width/14*days,handle.y+handle.height/2,{steps:10});await page.mouse.up()}
try{
  await page.goto('http://127.0.0.1:5173');await page.locator('.overview-split').waitFor()
  await open('Collect reference material');await inspector().getByRole('button',{name:'Set dates',exact:true}).waitFor();await edit()
  const dates=await readDays();await select(2,5)
  assert.equal((await writes()).length,0,'Dragging must only edit the draft')
  await save();let last=(await writes()).at(-1)
  assert.equal(last.start,dates[2]);assert.equal(last.due,dates[5])
  checks.push('Undated task exposes Set dates; dragged range saves real start/deadline only on Save')

  await edit();await precise()
  const beforeStart=await dialog().getByLabel('Start date',{exact:true}).inputValue(),beforeDue=await dialog().getByLabel('Deadline date',{exact:true}).inputValue()
  await dialog().getByRole('button',{name:'Drag start date',exact:true}).focus();await page.keyboard.press('ArrowLeft')
  assert.equal(await dialog().getByLabel('Deadline date',{exact:true}).inputValue(),beforeDue,'Handle keyboard event must not bubble and move both bounds')
  assert.notEqual(await dialog().getByLabel('Start date',{exact:true}).inputValue(),beforeStart)
  await shift(dialog().getByRole('button',{name:'Drag deadline',exact:true}),1)
  const adjustedDue=await dialog().getByLabel('Deadline date',{exact:true}).inputValue()
  assert.notEqual(adjustedDue,beforeDue)
  await save();checks.push('Start keyboard handle and deadline pointer handle independently change their own bound')

  await edit();await precise();const originalStart=await dialog().getByLabel('Start date',{exact:true}).inputValue(),originalDue=await dialog().getByLabel('Deadline date',{exact:true}).inputValue()
  await shift(editor().locator('.dates-edit-bar'),1)
  assert.notEqual(await dialog().getByLabel('Start date',{exact:true}).inputValue(),originalStart)
  assert.notEqual(await dialog().getByLabel('Deadline date',{exact:true}).inputValue(),originalDue)
  const beforeCancel=(await writes()).length
  page.once('dialog',d=>d.dismiss());await dialog().getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await dialog().count(),1,'Reject discard keeps edited draft open')
  page.once('dialog',d=>d.accept());await dialog().getByRole('button',{name:'Cancel',exact:true}).click();await dialog().waitFor({state:'hidden'})
  assert.equal((await writes()).length,beforeCancel);checks.push('Bar movement updates both dates; cancel protects unsaved edits and never writes')

  await open('Edit the opening sequence');await edit();await select(2,5,true)
  assert.equal(await dialog().count(),1,'Escape during drag cancels gesture before App closes the modal')
  assert.equal(await editor().locator('.dates-edit-bar').count(),0)
  const cardDays=await readDays();await select(2,4)
  await save();last=(await writes()).at(-1)
  assert.equal(last.id,'card-mine');assert.equal(typeof last.start,'string');assert.ok(last.start.endsWith('Z'));assert.ok(last.due.endsWith('Z'))
  const local=await page.evaluate(dates=>({start:new Date(dates.start).getDate(),hour:new Date(dates.start).getHours(),due:new Date(dates.due).getDate(),dueHour:new Date(dates.due).getHours(),minute:new Date(dates.due).getMinutes()}),last)
  assert.equal(local.start,Number(cardDays[2].slice(-2)));assert.equal(local.hour,0);assert.equal(local.due,Number(cardDays[4].slice(-2)));assert.equal(local.dueHour,23);assert.equal(local.minute,59)
  checks.push('Undated Deck card can be planned; Escape cancels a drag and native dates use correct local-day instants')

  await edit();await precise();await dialog().getByRole('button',{name:'Remove all dates',exact:true}).click();await save();last=(await writes()).at(-1);assert.equal(last.start,'');assert.equal(last.due,'')
  await inspector().getByRole('button',{name:'Set dates',exact:true}).waitFor()
  await open('Collect reference material');await edit();await precise();await dialog().getByRole('button',{name:'Remove all dates',exact:true}).click();const singleDays=await readDays();await select(3,3);await save();last=(await writes()).at(-1);assert.equal(last.start,'');assert.equal(last.due,singleDays[3])
  checks.push('Clear removes native bounds; a one-day DATE task becomes a deadline-only item')

  const beforeFailedDate=(await backend()).records.find(record=>record.id==='task-undated')
  const writesBeforeFailure=(await writes()).length
  await edit();await precise();await dialog().getByLabel('Start date',{exact:true}).fill('2026-11-08');await dialog().getByLabel('Deadline date',{exact:true}).fill('2026-11-10')
  await page.evaluate(()=>{window.__failNextDate=true});await save()
  const failure=page.locator('.source-edit-error').filter({hasText:'Collect reference material'})
  await failure.getByRole('button',{name:'Retry edit',exact:true}).waitFor()
  assert.match(await failure.innerText(),/Fixture date save failed/)
  let afterFailedDate=(await backend()).records.find(record=>record.id==='task-undated')
  assert.deepEqual({start:afterFailedDate.start,due:afterFailedDate.due,completed:afterFailedDate.completed},{start:beforeFailedDate.start,due:beforeFailedDate.due,completed:beforeFailedDate.completed})
  assert.equal((await writes()).length,writesBeforeFailure)
  await edit();await precise();assert.equal(await dialog().getByLabel('Start date',{exact:true}).inputValue(),beforeFailedDate.start||'');assert.equal(await dialog().getByLabel('Deadline date',{exact:true}).inputValue(),beforeFailedDate.due||'')
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click();await dialog().waitFor({state:'hidden'})
  const failedAttempt=await page.evaluate(()=>window.__dateAttempts.at(-1))
  const attemptCount=await page.evaluate(()=>window.__dateAttempts.length)
  await inspector().getByRole('button',{name:'Mark done',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.__otherWrites.length),0,'An unrelated source edit on the same item must not replace a failed date retry')
  assert.equal(await page.evaluate(()=>window.__dateAttempts.length),attemptCount)
  assert.equal(await failure.count(),1,'The date failure must remain available after a blocked completion edit')
  await failure.getByRole('button',{name:'Retry edit',exact:true}).click();await failure.waitFor({state:'hidden'})
  await page.waitForFunction(count=>window.__dateWrites.length===count+1,writesBeforeFailure)
  const retriedAttempt=await page.evaluate(()=>window.__dateAttempts.at(-1))
  assert.deepEqual(retriedAttempt,failedAttempt,'Retry preserves the original failed date proposal')
  afterFailedDate=(await backend()).records.find(record=>record.id==='task-undated')
  assert.equal(afterFailedDate.start,'2026-11-08');assert.equal(afterFailedDate.due,'2026-11-10');assert.equal(afterFailedDate.completed,false)
  checks.push('Failed date save rolls back visibly; other edits cannot replace its retry, and Retry restores the original date proposal')

  await open('Production days');await edit();await precise();assert.equal(await dialog().getByLabel('All day',{exact:true}).isChecked(),true)
  const expected=fixture.records.find(record=>record.id==='event-all-day');assert.equal(await dialog().getByLabel('Start date',{exact:true}).inputValue(),expected.start);assert.equal(await dialog().getByLabel('End date',{exact:true}).inputValue(),expected.end)
  await dialog().getByRole('button',{name:'Drag end date',exact:true}).focus();await page.keyboard.press('ArrowRight');await save();last=(await writes()).at(-1);assert.equal(last.start,expected.start);assert.equal(last.allDay,true)
  await open('Read only date fixture');assert.equal(await inspector().getByRole('button',{name:'Set dates',exact:true}).isDisabled(),true)
  checks.push('All-day event keeps exclusive end semantics; read-only items do not permit native edits')

  await open('Collect reference material');await edit();await precise();await dialog().getByLabel('Start date',{exact:true}).fill('2026-11-10');await dialog().getByLabel('Deadline date',{exact:true}).fill('2026-11-09');const writesBeforeInvalid=(await writes()).length;await dialog().getByRole('button',{name:'Save dates',exact:true}).click();await dialog().getByRole('alert').waitFor();assert.equal((await writes()).length,writesBeforeInvalid)
  await dialog().getByLabel('Start date',{exact:true}).fill('2026-11-04');await dialog().getByLabel('Deadline date',{exact:true}).fill('2026-11-08');await editor().locator('.dates-precise>summary').click();await page.screenshot({path:'artifacts/record-dates-editor.png'})
  checks.push('Invalid draft is blocked before native mutation; context timeline remains visible')
  assert.deepEqual(errors,[]);await writeFile('artifacts/record-dates-ui.json',JSON.stringify({result:'PASS',checks},null,2));console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){await page.screenshot({path:'artifacts/record-dates-failure.png'});console.error(JSON.stringify({result:'FAIL',checks,errors,error:String(error)},null,2));throw error}finally{await browser.close()}
