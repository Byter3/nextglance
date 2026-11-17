/** Real pointer gestures over isolated fixture surfaces. No live source access. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixture=plannerFixture(new Date(2026,10,2,9))
fixture.workspace.planner.view='overview'
fixture.workspace.planner.scopeId='all'
Object.assign(fixture.records.find(r=>r.id==='card-mine'),{start:'2026-11-02',due:'2026-11-04'})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const context=await browser.newContext({viewport:{width:1652,height:1050},timezoneId:'Europe/Budapest'})
const page=await context.newPage(),errors=[],checks=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
await mkdir('artifacts',{recursive:true})
await page.addInitScript(initial=>{
 let state=structuredClone(initial)
 const read=async()=>structuredClone(state),forbidden=async()=>{throw Error('This range test must never create source data')}
 window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw Error('Stale fixture');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},createTask:forbidden,createCard:forbidden,createEvent:forbidden,createNote:forbidden,updateRecordDates:forbidden,openExternal:async()=>{},readPage:async()=>({body:''})}
},fixture)
const dialog=()=>page.getByRole('dialog')
const date=page.getByLabel('Choose calendar date'),range=page.getByLabel('Timeline range')
async function setDate(){await date.fill('2026-11-02');await date.dispatchEvent('change');await page.waitForTimeout(100)}
async function close(){await dialog().getByRole('button',{name:'Cancel',exact:true}).click();await dialog().waitFor({state:'hidden'})}
async function chooseEvent(){await dialog().getByLabel('Item type',{exact:false}).selectOption('event')}
async function assertEvent(start,end,allDay){await chooseEvent();assert.equal(await dialog().getByLabel('Start',{exact:true}).inputValue(),start);assert.equal(await dialog().getByLabel('End',{exact:true}).inputValue(),end);assert.equal(await dialog().getByLabel('All day',{exact:true}).isChecked(),allDay)}
async function gesture(start,end,{escape=false}={}){await page.mouse.move(start.x,start.y);await page.mouse.down();if(end)await page.mouse.move(end.x,end.y,{steps:10});if(escape)await page.keyboard.press('Escape');await page.mouse.up()}
async function timelinePoint(offset){const plot=page.locator('.timeline-plot'),box=await plot.boundingBox(),count=Number(await range.inputValue());return{x:box.x+box.width/count*offset,y:box.y+24}}
async function calendarPoint(day,hour){const track=page.locator(`.calendar-day-track[data-day="${day}"]`),box=await track.boundingBox(),height=await track.locator('.calendar-hour-line').first().evaluate(e=>e.getBoundingClientRect().height);return{x:box.x+box.width*.7,y:box.y+height*hour}}
async function scrollHours(hour=7){await page.locator('.calendar-times-scroll').evaluate((el,hour)=>{const line=el.querySelector('.calendar-hour-line');el.scrollTop=hour*line.getBoundingClientRect().height},hour);await page.waitForTimeout(80)}
try{
 await page.goto('http://127.0.0.1:5173');await page.locator('.overview-split').waitFor();await setDate()
 await gesture(await timelinePoint(1.2),await timelinePoint(3.6));await dialog().waitFor()
 assert.equal(await dialog().getByLabel('Item type',{exact:false}).inputValue(),'task')
 assert.equal(await dialog().getByLabel('Start',{exact:false}).inputValue(),'2026-11-03')
 assert.equal(await dialog().getByLabel('Deadline',{exact:false}).inputValue(),'2026-11-05')
 await assertEvent('2026-11-03','2026-11-06',true);await close()
 await gesture(await timelinePoint(3.6),await timelinePoint(1.2));await assertEvent('2026-11-03','2026-11-06',true);await close()
 checks.push('Overview top forward/reverse drag selects inclusive work days and exclusive event end')

 await gesture(await timelinePoint(2.2));await assertEvent('2026-11-04','2026-11-05',true);await close()
 await gesture(await timelinePoint(1.2),await timelinePoint(2.7),{escape:true})
 assert.equal(await dialog().count(),0);assert.equal(await page.locator('.timeline-new-range').count(),0)
 checks.push('Timeline blank click proposes one day; Escape cancels without opening the popup')

 await scrollHours();await gesture(await calendarPoint('2026-11-02',8),await calendarPoint('2026-11-02',9.5));await assertEvent('2026-11-02T08:00','2026-11-02T09:30',false);await close()
 await gesture(await calendarPoint('2026-11-02',8.1));await assertEvent('2026-11-02T08:00','2026-11-02T09:00',false);await close()
 checks.push('Overview calendar drag uses quarter-hour times; a click defaults to one hour')

 const allDay=page.locator('.calendar-all-day'),first=await allDay.locator('.all-day-cell').first().boundingBox(),last=await allDay.locator('.all-day-cell').nth(2).boundingBox()
 await gesture({x:first.x+first.width*.2,y:first.y+first.height-3},{x:last.x+last.width*.8,y:last.y+last.height-3})
 await assertEvent('2026-11-02','2026-11-05',true);await close()
 checks.push('Overview all-day strip creates one continuous multi-day range')

 await page.getByRole('tab',{name:'Calendar',exact:true}).click();await setDate();await scrollHours()
 await gesture(await calendarPoint('2026-11-04',10),await calendarPoint('2026-11-04',8.25));await assertEvent('2026-11-04T08:15','2026-11-04T10:00',false);await close()
 await gesture(await calendarPoint('2026-11-02',8),await calendarPoint('2026-11-02',9),{escape:true});assert.equal(await dialog().count(),0)
 await scrollHours(12);await page.locator('.calendar-event[data-record-id="event-review"]').click();assert.equal(await dialog().count(),0);await page.getByRole('complementary',{name:'Item details'}).waitFor();await page.getByRole('button',{name:'Close item details'}).click()
 checks.push('Standalone Calendar reverse drags and Escape work; existing events still open details')

 await page.getByRole('tab',{name:'Timeline',exact:true}).click();await setDate();await range.selectOption('7')
 await gesture(await timelinePoint(.2),await timelinePoint(1.8));await assertEvent('2026-11-02','2026-11-04',true);await close()
 await range.selectOption('3');await gesture(await timelinePoint(.375),await timelinePoint(.5));await assertEvent('2026-11-02T09:00','2026-11-02T12:00',false);await close()
 await page.locator('.timeline-chart-row[data-record-id="card-mine"] .timeline-bar').first().click();assert.equal(await dialog().count(),0);await page.getByRole('complementary',{name:'Item details'}).waitFor();await page.getByRole('button',{name:'Close item details'}).click()
 checks.push('Standalone Timeline supports day and narrow timed ranges without hijacking existing work clicks')

 await range.selectOption('7');await setDate();const prior=await date.inputValue(),point=await timelinePoint(2)
 await page.mouse.move(point.x,point.y);await page.mouse.wheel(180,0);await page.waitForFunction(prior=>document.querySelector('[aria-label="Choose calendar date"]').value!==prior,prior)
 assert.equal(await dialog().count(),0);assert.equal(await page.locator('.timeline-new-range').count(),0)
 await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.wheel(0,100);await page.mouse.up();assert.equal(await dialog().count(),0)
 checks.push('Touchpad horizontal pan and vertical scrolling never trigger accidental creation')
 await page.screenshot({path:'artifacts/range-creation-timeline.png'})
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){console.error(JSON.stringify({result:'FAIL',checks,errors,error:String(error)},null,2));await page.screenshot({path:'artifacts/range-creation-failure.png'});throw error}finally{await browser.close()}
