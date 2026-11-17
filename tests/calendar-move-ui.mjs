/** Calendar parity through an isolated bridge; never writes a live account. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixture=plannerFixture(new Date(2026,10,2,9))
fixture.workspace.planner.view='calendar';fixture.workspace.planner.assignment='all';fixture.workspace.appearance.mode='dark'
fixture.workspace.plans=[{id:'test-plan',recordId:'task-today',start:'2026-11-04T10:00:00+01:00',end:'2026-11-04T11:00:00+01:00'}]
fixture.workspace.relations=[{id:'link-card-event',fromId:'card-mine',toId:'event-review',type:'scheduled_during'},{id:'link-task-event',fromId:'task-today',toId:'event-review',type:'for_event'}]
Object.assign(fixture.records.find(record=>record.id==='event-review'),{start:'2026-11-02T10:00:00+01:00',end:'2026-11-02T11:00:00+01:00'})
Object.assign(fixture.records.find(record=>record.id==='event-other'),{readonly:true})
Object.assign(fixture.records.find(record=>record.id==='card-mine'),{start:'2026-11-02',due:'2026-11-04',etag:'card-v1'})
Object.assign(fixture.records.find(record=>record.id==='task-personal'),{start:'2026-11-03T09:00:00+01:00',due:'2026-11-03T10:00:00+01:00'})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1700,height:1200},timezoneId:'Europe/Budapest'})
await page.clock.install({time:new Date('2026-11-02T09:00:00+01:00')})
page.setDefaultTimeout(15000)
const checks=[],errors=[];page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
await page.addInitScript(initial=>{
  const state=structuredClone(initial),read=async()=>structuredClone(state)
  window.__nativeWrites=[];window.__metadataWrites=[];window.__hold=false;window.__fail=false
  window.workspaceApi={getState:read,refresh:read,syncWorkspace:read,readPage:async()=>({body:''}),openExternal:async()=>{},exportWorkspace:async()=>({exported:true}),
    saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw Error('Stale fixture');state.workspace=structuredClone(workspace);state.revision++;window.__metadataWrites.push(structuredClone(workspace));return {workspace:structuredClone(workspace),revision:state.revision,storage:structuredClone(state.storage)}},
    updateRecordDates:async input=>{
      const item=state.records.find(record=>record.id===input.id)
      if(item.readonly)throw Error('Read-only fixture source')
      if(item.etag!==input.etag)throw Error('Stale fixture source version')
      window.__nativeWrites.push(structuredClone(input))
      if(window.__hold)await new Promise(resolve=>window.__release=resolve)
      if(window.__fail){window.__fail=false;throw Error('Fixture date save failed')}
      Object.assign(item,input);item.etag=`saved-${window.__nativeWrites.length}`;return read()
    }}
},fixture)
const view=()=>page.locator('.calendar-view')
const timed=id=>view().locator(`.calendar-event[data-record-id="${id}"]:not(.planned)`).first()
const allDay=id=>view().locator(`.all-day-event[data-record-id="${id}"]`)
const writes=()=>page.evaluate(()=>window.__nativeWrites)
const state=()=>page.evaluate(()=>window.workspaceApi.getState())
const idle=()=>page.locator('.source-save-status').waitFor({state:'hidden'})
const record=async id=>(await state()).records.find(item=>item.id===id)
const width=()=>view().locator('.calendar-day-track').first().evaluate(element=>element.getBoundingClientRect().width)
async function chooseDate(){await page.getByLabel('Choose calendar date').fill('2026-11-02');await page.getByLabel('Choose calendar date').dispatchEvent('change')}
async function until(predicate,message){const end=Date.now()+15000;while(Date.now()<end){if(predicate(await state()))return;await new Promise(resolve=>setTimeout(resolve,40))}assert.fail(message)}
async function dragBy(locator,dx,dy=0,beforeDrop){
  await locator.scrollIntoViewIfNeeded()
  const box=await locator.boundingBox(),start={x:box.x+Math.min(box.width/2,45),y:box.y+box.height/2}
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+dx,start.y+dy,{steps:8})
  if(beforeDrop)await beforeDrop()
  await page.mouse.up()
}
async function clearHover(){await page.getByRole('tab',{name:'Calendar',exact:true}).focus();await page.getByRole('tab',{name:'Calendar',exact:true}).hover()}
try{
  await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173');await view().waitFor();await chooseDate()
  await timed('event-review').hover()
  assert.equal(await allDay('card-mine').evaluate(element=>element.classList.contains('hover-linked')),true)
  assert.equal(await allDay('task-today').evaluate(element=>element.classList.contains('hover-linked')),true)
  assert.equal(await allDay('card-mine').evaluate(element=>getComputedStyle(element).outlineStyle),'dashed')
  assert.equal(await page.getByRole('complementary',{name:'Item details'}).count(),0)
  await clearHover();await allDay('card-mine').focus()
  assert.equal(await timed('event-review').evaluate(element=>element.classList.contains('hover-linked')),true)
  await clearHover()
  assert.notEqual(await view().locator('.calendar-day-track').first().evaluate(element=>getComputedStyle(element).cursor),'crosshair')
  checks.push('Standalone calendar shares linked hover/focus highlights, selection behavior and ordinary grid cursors')

  await page.evaluate(()=>window.__hold=true)
  await dragBy(timed('event-review'),await width(),48)
  await page.waitForFunction(()=>typeof window.__release==='function')
  assert.equal(await timed('event-review').locator('..').getAttribute('data-day'),'2026-11-03','Calendar preview moves immediately before the held native save finishes')
  assert.equal((await record('event-review')).start,'2026-11-02T10:00:00+01:00')
  assert.equal(await page.getByRole('complementary',{name:'Item details'}).count(),0,'Dragging must not also open the item')
  await page.evaluate(()=>{window.__hold=false;window.__release()});await idle()
  assert.equal((await record('event-review')).start,'2026-11-03T10:00:00.000Z')
  assert.equal(+new Date((await record('event-review')).end)-+new Date((await record('event-review')).start),3600000)
  checks.push('Timed event movement changes both day and hour, retains duration, and stays optimistic without opening a popup')

  let count=(await writes()).length
  await dragBy(allDay('card-mine'),await width());await until(state=>state.records.find(item=>item.id==='card-mine').start==='2026-11-03','Card should move natively');await idle()
  assert.equal((await record('card-mine')).due,'2026-11-05')
  await dragBy(allDay('task-today'),await width());await until(state=>state.records.find(item=>item.id==='task-today').due==='2026-11-03','Task deadline should move natively');await idle()
  assert.equal((await record('task-today')).start,undefined)
  await dragBy(allDay('event-all-day'),await width());await until(state=>state.records.find(item=>item.id==='event-all-day').start==='2026-11-05','All-day event should move natively');await idle()
  assert.equal((await record('event-all-day')).end,'2026-11-07')
  assert.equal((await writes()).length,count+3)
  checks.push('Multi-day cards, due-only tasks and all-day events move without changing their native date semantics')

  await dragBy(timed('task-personal'),0,24);await until(state=>state.records.find(item=>item.id==='task-personal').start==='2026-11-03T08:30:00.000Z','Timed task should move by half an hour');await idle()
  assert.equal((await record('task-personal')).due,'2026-11-03T09:30:00.000Z')
  count=(await writes()).length
  const taskBefore=await record('task-today')
  const plan=view().locator('.calendar-event.planned[data-record-id="task-today"]')
  await dragBy(plan,await width(),24);await until(state=>state.workspace.plans.find(plan=>plan.id==='test-plan').start==='2026-11-05T09:30:00.000Z','Planner block should move in metadata')
  assert.equal((await writes()).length,count);assert.deepEqual(await record('task-today'),taskBefore)
  checks.push('Timed task ranges retain duration; planner sessions change metadata without moving the underlying native deadline')

  count=(await writes()).length
  await dragBy(timed('event-review'),await width(),0,async()=>page.keyboard.press('Escape'))
  await dragBy(timed('event-review'),0,-1000)
  await dragBy(timed('event-other'),await width())
  assert.equal((await writes()).length,count,'Escape, outside drops and readonly items cannot save date edits')
  await page.waitForTimeout(450) // Let the deliberately suppressed post-drag click expire.
  await timed('event-review').click();await page.getByRole('complementary',{name:'Item details'}).waitFor()
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  await page.evaluate(()=>window.__fail=true)
  const before=await record('event-review')
  await dragBy(timed('event-review'),0,24);await page.locator('.source-edit-error').waitFor()
  assert.deepEqual(await record('event-review'),before)
  await page.getByRole('button',{name:'Retry edit',exact:true}).click();await idle();await page.locator('.source-edit-error').waitFor({state:'hidden'})
  assert.equal(+new Date((await record('event-review')).start)-+new Date(before.start),30*60000)
  checks.push('Clicks still open details; Escape/outside/readonly drags do not save; failed moves remain retryable')

  await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.locator('.overview-split').waitFor();await chooseDate()
  await view().locator('.calendar-times-scroll').evaluate(element=>element.scrollTop=8*48)
  await timed('event-review').hover()
  assert.equal(await page.locator('.timeline-row-label[data-record-id="card-mine"]').evaluate(element=>element.classList.contains('hover-linked')),true)
  const old=await record('event-review');await dragBy(timed('event-review'),await width(),0);await idle()
  assert.equal(+new Date((await record('event-review')).start)-+new Date(old.start),86400000)
  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  assert.notEqual(await page.locator('.timeline-plot').evaluate(element=>getComputedStyle(element).cursor),'crosshair')
  await page.getByRole('tab',{name:'Overview',exact:true}).click()
  await page.screenshot({path:'artifacts/calendar-move-overview.png'})
  checks.push('Split Overview uses the same move behavior and linked highlights, while timeline creation no longer uses crosshairs')

  assert.deepEqual(errors,[])
  const result={passed:checks.length,checks,rendererErrors:errors};await writeFile('artifacts/calendar-move-ui.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(error){await page.screenshot({path:'artifacts/calendar-move-failure.png',fullPage:true});throw error}finally{await browser.close()}
