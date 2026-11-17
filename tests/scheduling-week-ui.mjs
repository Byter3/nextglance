/** The visual booking week edits a local draft; native writes happen only on submit. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

process.env.TZ='Europe/Budapest'
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const context=await browser.newContext({viewport:{width:1600,height:1100},timezoneId:'Europe/Budapest'})
const page=await context.newPage(),errors=[],checked=[]
page.on('pageerror',error=>errors.push(error.message))
page.setDefaultTimeout(15000)
const fixture=plannerFixture(new Date(2026,10,2,9))
fixture.workspace.planner.view='list'
fixture.records.push({id:'cancelled-visual-event',kind:'event',source:'calendar',title:'Cancelled booking',start:'2026-11-04T10:00:00+01:00',end:'2026-11-04T11:00:00+01:00',status:'CANCELLED',collectionId:'calendar-work'})
await page.addInitScript(initial=>{
  let state=structuredClone(initial)
  window.__visualBookingWrites=[]
  window.workspaceApi={
    getState:async()=>structuredClone(state),refresh:async()=>structuredClone(state),
    saveWorkspace:async(workspace)=>{state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(state.workspace),revision:state.revision,storage:structuredClone(state.storage)}},
    createLinkedEvent:async input=>{window.__visualBookingWrites.push(structuredClone(input));const id='visual-booking-created';state.records.push({id,kind:'event',source:'calendar',title:input.title,collectionId:input.collectionId,start:input.start,end:input.end,allDay:input.allDay});state.workspace.relations.push({id:'visual-booking-link',type:'scheduled_during',fromId:input.recordId,toId:id});state.revision++;return structuredClone(state)},
    readPage:async()=>({body:''}),openExternal:async()=>{},exportWorkspace:async()=>({exported:true}),syncWorkspace:async()=>structuredClone(state),
  }
},fixture)
const dialog=()=>page.getByRole('dialog')
const week=()=>dialog().locator('.scheduling-week')
const field=name=>dialog().getByLabel(name,{exact:true})
const dates=async()=>[await field('Start').inputValue(),await field('End').inputValue()]
const writes=()=>page.evaluate(()=>window.__visualBookingWrites)
async function timedPoint(day,hour){const track=week().locator(`.week-day-track[data-day="2026-11-${String(day).padStart(2,'0')}"]`);const box=await track.boundingBox();assert.ok(box);return {x:box.x+box.width*.54,y:box.y+hour*44}}
async function drag(a,b){await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});await page.mouse.up()}
try{
  await page.goto('http://127.0.0.1:5173')
  await page.locator('.list-table-row').filter({hasText:'Edit the opening sequence'}).first().click()
  await page.getByRole('complementary',{name:'Item details'}).getByRole('button',{name:'Schedule in calendar',exact:true}).click()
  await week().waitFor()
  assert.equal(await dialog().locator('.schedule-exact').evaluate(node=>node.open),false)
  await dialog().locator('.schedule-exact').evaluate(node=>node.open=true)
  await field('Start').fill('2026-11-04T09:00')
  await field('End').fill('2026-11-04T10:00')
  await dialog().locator('.schedule-exact').evaluate(node=>node.open=false)
  await week().locator('[data-record-id="event-review"]').waitFor()
  await week().locator('[data-record-id="card-gig"]').waitFor()
  await week().locator('[data-record-id="task-personal"]').waitFor()
  assert.equal(await week().locator('[data-record-id="cancelled-visual-event"]').count(),0)
  assert.equal(await week().locator('[data-record-id="event-all-day"]').count(),1,'Multi-day context remains a single merged event')
  checked.push('Week context includes all loaded calendars, cards and tasks, with merged all-day spans and cancelled events omitted')

  await week().locator('.week-times-scroll').evaluate(node=>node.scrollTop=12*44)
  await drag(await timedPoint(4,13),await timedPoint(4,14.5))
  assert.deepEqual(await dates(),['2026-11-04T13:00','2026-11-04T14:30'])
  assert.equal((await writes()).length,0,'Selecting a slot cannot create a native event')
  const endHandle=week().getByRole('button',{name:'Adjust booking end time',exact:true})
  const endBox=await endHandle.boundingBox();assert.ok(endBox)
  await drag({x:endBox.x+endBox.width/2,y:endBox.y+endBox.height/2},{x:endBox.x+endBox.width/2,y:endBox.y+endBox.height/2+22})
  assert.deepEqual(await dates(),['2026-11-04T13:00','2026-11-04T15:00'])
  const body=await week().getByRole('button',{name:'Move selected booking',exact:true}).boundingBox();assert.ok(body)
  const wed=await timedPoint(4,14),thu=await timedPoint(5,14)
  await drag({x:body.x+body.width/2,y:body.y+body.height/2},{x:body.x+body.width/2+thu.x-wed.x,y:body.y+body.height/2})
  assert.deepEqual(await dates(),['2026-11-05T13:00','2026-11-05T15:00'])
  checked.push('Timed drag creates a 15-minute-snapped draft, end handles resize it, and moving across days preserves its duration')

  const from=await timedPoint(6,15),to=await timedPoint(6,16)
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.keyboard.press('Escape');await page.mouse.up()
  assert.deepEqual(await dates(),['2026-11-05T13:00','2026-11-05T15:00'])
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8})
  await week().locator('.week-time-grid').dispatchEvent('lostpointercapture',{pointerId:1})
  await page.mouse.up()
  assert.deepEqual(await dates(),['2026-11-05T13:00','2026-11-05T15:00'],'Losing pointer capture cancels rather than committing an abandoned drag')
  await week().getByRole('button',{name:'Move selected booking',exact:true}).focus()
  await page.keyboard.press('ArrowDown')
  assert.deepEqual(await dates(),['2026-11-05T13:15','2026-11-05T15:15'])
  await week().getByRole('button',{name:'Adjust booking start time',exact:true}).focus();await page.keyboard.press('ArrowUp')
  assert.deepEqual(await dates(),['2026-11-05T13:00','2026-11-05T15:15'])
  checked.push('Escape and lost pointer capture cancel the in-flight selection; arrow keys move and resize the draft without a mouse')

  await week().getByRole('button',{name:'Next scheduling week',exact:true}).click()
  assert.equal(await week().locator('.week-day-track[data-day="2026-11-09"]').count(),1)
  assert.deepEqual(await dates(),['2026-11-05T13:00','2026-11-05T15:15'],'Browsing another week cannot move the draft')
  await week().getByRole('button',{name:'Selected week',exact:true}).click()
  await week().locator('[data-record-id="event-all-day"]').click()
  assert.match(await week().locator('.week-context-detail').innerText(),/Production days/)
  assert.equal((await writes()).length,0)
  await week().getByRole('button',{name:'Close calendar item preview'}).click()
  checked.push('Week navigation and contextual event details leave the booking draft and existing events unchanged')

  await week().locator('.week-all-day-scroll').evaluate(node=>node.scrollTop=node.scrollHeight)
  const invite=await week().locator('.week-all-day-invite').boundingBox(),grid=await week().locator('.week-all-day').boundingBox();assert.ok(invite&&grid)
  const width=(grid.width-44)/7,point=index=>({x:grid.x+44+(index+.5)*width,y:invite.y+invite.height/2})
  await drag(point(4),point(2))
  assert.deepEqual(await dates(),['2026-11-04','2026-11-07'],'Reverse all-day selection uses exclusive native DTEND')
  assert.equal(await field('All day').isChecked(),true)
  assert.equal(await week().locator('.all-day-draft').count(),1)
  await page.screenshot({path:'artifacts/scheduling-week-visual.png',fullPage:true})
  checked.push('All-day drag selects an inclusive visible span and stores an exclusive event end date')

  await dialog().getByRole('button',{name:'Create & link',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  const calls=await writes();assert.equal(calls.length,1)
  assert.equal(calls[0].start,'2026-11-04');assert.equal(calls[0].end,'2026-11-07');assert.equal(calls[0].allDay,true);assert.equal(calls[0].recordId,'card-mine')
  assert.deepEqual(errors,[])
  checked.push('Only Create & link writes the selected range to the native calendar and links the original card')
  console.log(JSON.stringify({result:'PASS',checks:checked},null,2))
}catch(error){await page.screenshot({path:'artifacts/scheduling-week-failure.png',fullPage:true}).catch(()=>{});console.error(JSON.stringify({result:'FAIL',checks:checked,rendererErrors:errors,error:String(error)},null,2));throw error}finally{await browser.close()}
