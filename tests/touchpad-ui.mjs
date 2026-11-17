/** Precision touchpad gestures against an isolated, mutable fixture bridge. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixture=plannerFixture(new Date(2026,10,2,9))
for(let index=0;index<60;index++)fixture.records.push({id:`scroll-task-${index}`,source:'tasks',kind:'task',title:`Scroll fixture ${index+1}`,collectionId:'tasks-work',collectionTitle:'Freelance tasks',due:`2026-11-${String(2+index%7).padStart(2,'0')}`,completed:false,readonly:false})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const context=await browser.newContext({viewport:{width:1652,height:1100},timezoneId:'Europe/Budapest'})
const page=await context.newPage(),checks=[],errors=[]
page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(initial=>{
  const state=structuredClone(initial),read=async()=>structuredClone(state)
  window.__nativeWrites=0
  window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale fixture revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},openExternal:async()=>{},readPage:async()=>({body:''})}
},fixture)
const split=()=>page.locator('.overview-split')
const timeline=()=>page.locator('.timeline-scroll')
const hours=()=>page.locator('.calendar-times-scroll')
const date=()=>page.getByLabel('Choose calendar date')
const range=()=>page.getByLabel('Timeline range')
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const chooseDate=async value=>{await date().fill(value);await date().dispatchEvent('change');await frame()}
const plusDay=(value,days)=>{const result=new Date(`${value}T12:00:00Z`);result.setUTCDate(result.getUTCDate()+days);return result.toISOString().slice(0,10)}
const dayWidth=()=>page.locator('.timeline-days>div').first().evaluate(element=>element.getBoundingClientRect().width)
async function aligned(){await page.waitForFunction(()=>{
  const top=[...document.querySelectorAll('.overview-split .timeline-days>div')],bottom=[...document.querySelectorAll('.overview-split .calendar-day-track')]
  return top.length===bottom.length&&top.length>0&&top.every((element,index)=>{const a=element.getBoundingClientRect(),b=bottom[index].getBoundingClientRect();return Math.abs(a.left-b.left)<1.1&&Math.abs(a.width-b.width)<1.1})
})}
async function wheel(locator,dx,dy=0,{shift=false,ctrl=false,count=1}={}){
  const box=await locator.boundingBox();assert.ok(box)
  await page.mouse.move(box.x+box.width*.8,box.y+Math.min(box.height/2,90))
  if(shift)await page.keyboard.down('Shift')
  if(ctrl)await page.keyboard.down('Control')
  try{for(let index=0;index<count;index++){await page.mouse.wheel(dx,dy);await frame()}}
  finally{if(shift)await page.keyboard.up('Shift');if(ctrl)await page.keyboard.up('Control')}
}
async function assertDate(value){await page.waitForFunction(value=>document.querySelector('[aria-label="Choose calendar date"]').value===value,value)}

try{
  await page.goto('http://127.0.0.1:5173');await split().waitFor();await chooseDate('2026-11-02');await aligned()
  const width=await dayWidth()
  await hours().evaluate(element=>element.scrollTop=610);await frame()
  const hourTop=await hours().evaluate(element=>element.scrollTop)
  await wheel(timeline(),width/8,.4,{count:12})
  await assertDate('2026-11-03');await aligned()
  assert.equal(await range().inputValue(),'7','Date scrolling must not zoom the range')
  assert.ok(Math.abs(await hours().evaluate(element=>element.scrollTop)-hourTop)<1,'Panning does not reset the visible hour')
  checks.push('Small precision touchpad deltas accumulate into date movement over a fitted Overview timeline, preserving hour position and shared alignment')

  await chooseDate('2026-11-05')
  await wheel(hours(),-width*1.2,.4)
  await assertDate('2026-11-04');await aligned()
  assert.ok(Math.abs(await hours().evaluate(element=>element.scrollTop)-hourTop)<1)
  await chooseDate('2026-11-07')
  await wheel(split().locator('.calendar-all-day-viewport'),width*1.2)
  await assertDate('2026-11-08');await aligned()
  await chooseDate('2026-11-10')
  await wheel(hours(),0,width*1.2,{shift:true})
  await assertDate('2026-11-11');await aligned()
  checks.push('Calendar hours and all-day area pan dates in either direction; Shift+wheel is handled once instead of double-panning')

  await chooseDate('2026-11-02')
  await timeline().evaluate(element=>element.scrollTop=80);await frame()
  const beforeTop=await timeline().evaluate(element=>element.scrollTop)
  await wheel(timeline(),2,140)
  await page.waitForFunction(previous=>document.querySelector('.timeline-scroll').scrollTop>previous+20,beforeTop)
  assert.equal(await date().inputValue(),'2026-11-02','Minor horizontal noise must not intercept a vertical gesture')
  const pageY=await page.evaluate(()=>window.scrollY)
  await wheel(hours(),0,100)
  assert.equal(await date().inputValue(),'2026-11-02')
  assert.equal(await page.evaluate(()=>window.scrollY),pageY)
  checks.push('Vertical gestures with slight touchpad jitter scroll their own pane without shifting dates or the outer page')

  await split().evaluate(element=>{element.style.width='480px';element.style.maxWidth='480px';element.style.boxSizing='content-box'})
  await range().selectOption('90');await chooseDate('2026-11-02');await aligned()
  const geometry=await timeline().evaluate(element=>({left:element.scrollLeft,max:element.scrollWidth-element.clientWidth}))
  assert.ok(geometry.max>300,'Fixture must exercise real horizontal overflow')
  await wheel(timeline(),90)
  await page.waitForFunction(()=>document.querySelector('.timeline-scroll').scrollLeft>80)
  assert.equal(await date().inputValue(),'2026-11-02','Overflow scroll should be consumed before panning the date window')
  await aligned()
  await timeline().evaluate(element=>element.scrollLeft=element.scrollWidth);await frame();await aligned()
  const edge=await timeline().evaluate(element=>element.scrollLeft),smallWidth=await dayWidth()
  await wheel(hours(),smallWidth*1.2)
  await assertDate('2026-11-03');await aligned()
  assert.ok(Math.abs(await timeline().evaluate(element=>element.scrollLeft)-edge)<2,'Panning beyond the right edge must retain that edge instead of jumping to the left')
  checks.push('Narrow overflowing Overview scrolls existing dates first, then pans beyond the edge while keeping both panes aligned')

  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  await range().selectOption('7');await chooseDate('2026-11-02')
  const standaloneWidth=await dayWidth()
  await wheel(timeline(),standaloneWidth/6,0,{count:8})
  await assertDate('2026-11-03')
  assert.equal(await range().inputValue(),'7')
  await chooseDate('2026-11-05')
  await wheel(timeline(),0,-standaloneWidth*1.2,{shift:true})
  await assertDate('2026-11-04')
  checks.push('Standalone Timeline supports accumulated horizontal touchpad movement and reverse Shift+wheel date panning')
  assert.equal(await page.evaluate(()=>window.__nativeWrites),0)
  assert.deepEqual(errors,[])
  await page.screenshot({path:'artifacts/touchpad-timeline.png',fullPage:true})
  console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){await page.screenshot({path:'artifacts/touchpad-failure.png',fullPage:true});console.error(JSON.stringify({result:'FAIL',checks,errors,error:String(error),geometry:await page.evaluate(()=>({date:document.querySelector('[aria-label="Choose calendar date"]')?.value,scroll:[...document.querySelectorAll('.timeline-scroll,.calendar-times-scroll')].map(el=>({left:el.scrollLeft,max:el.scrollWidth-el.clientWidth,client:el.clientWidth,width:el.scrollWidth})),axis:document.querySelector('.overview-split')?.getBoundingClientRect().width}))},null,2));throw error}
finally{await context.close();await browser.close()}
