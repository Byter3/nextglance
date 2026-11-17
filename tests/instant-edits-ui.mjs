/** Deliberately unresolved fixture requests prove UI response is independent of network latency. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
const fixture=plannerFixture(new Date(2026,10,2,9))
Object.assign(fixture.records.find(record=>record.id==='card-mine'),{body:'- [ ] First\n- [ ] Second',etag:'card-v1',start:'2026-11-02',due:'2026-11-04'})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1652,height:1100},timezoneId:'Europe/Budapest'})
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000)
await page.addInitScript(initial=>{
  const state=structuredClone(initial);window.__writes=[];window.__held=[];window.__hold=true;window.__reject=false;window.__refreshes=0
  const read=async()=>structuredClone(state)
  async function edit(method,input){
    const record=state.records.find(item=>item.id===input.id)
    if(input.etag!==record.etag)throw new Error('Stale ETag in fixture')
    window.__writes.push({method,input:structuredClone(input)})
    if(window.__hold)await new Promise((resolve,reject)=>window.__held.push({resolve,reject}))
    if(window.__reject){window.__reject=false;throw new Error('Fixture connection interrupted')}
    if(method==='body')record.body=input.description
    else for(const key of ['start','due','end'])if(key in input)record[key]=input[key]
    record.etag=`card-v${window.__writes.length+1}`
    return read()
  }
  window.workspaceApi={getState:read,refresh:async()=>{window.__refreshes++;return read()},
    saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale planner revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},
    updateDescription:input=>edit('body',input),updateRecordDates:input=>edit('dates',input),openExternal:async()=>{},readPage:async()=>({body:''})}
},fixture)
const checkboxes=()=>page.locator('.description-section .markdown-content [role="checkbox"]')
const bar=()=>page.locator('.timeline-chart-row[data-record-id="card-mine"]>.timeline-bar:not(.planned)')
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const count=()=>page.evaluate(()=>window.__writes.length)
const release=()=>page.evaluate(()=>window.__held.shift().resolve())
async function drag(locator,dx){
  const b=await locator.boundingBox(),x=b.x+b.width*.4,y=b.y+b.height/2
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:5});await page.mouse.up()
}
try{
  await page.goto('http://127.0.0.1:5173');await page.locator('.overview-split').waitFor()
  await page.getByLabel('Choose calendar date').fill('2026-11-02');await page.getByLabel('Choose calendar date').dispatchEvent('change')
  await page.locator('.timeline-row-label[data-record-id="card-mine"]').click()
  await checkboxes().first().click();await checkboxes().nth(1).click()
  assert.equal(await checkboxes().first().getAttribute('aria-checked'),'true')
  assert.equal(await checkboxes().nth(1).getAttribute('aria-checked'),'true')
  assert.equal(await checkboxes().first().isEnabled(),true)
  assert.equal(await count(),1,'Second same-record write waits without disabling interaction')
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').body,'- [ ] First\n- [ ] Second')
  await page.getByRole('tab',{name:'Calendar',exact:true}).click();await page.locator('.calendar-view').waitFor()
  await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.locator('.overview-split').waitFor()
  assert.equal(await checkboxes().nth(1).getAttribute('aria-checked'),'true','Navigation remains available without losing pending content')
  await release();await page.waitForFunction(()=>window.__writes.length===2)
  assert.equal(await checkboxes().nth(1).getAttribute('aria-checked'),'true','First save must not undo the second toggle')
  assert.equal(await page.evaluate(()=>window.__writes[1].input.etag),'card-v2')
  await release();await page.locator('.source-save-status').waitFor({state:'hidden'})
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').body,'- [x] First\n- [x] Second')
  checks.push('Two checklist clicks render before either response; navigation stays live and writes use the latest acknowledged ETag')

  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  const width=await page.locator('.timeline-days>div').first().evaluate(element=>element.getBoundingClientRect().width)
  const before=await bar().boundingBox();await drag(bar(),width)
  assert.ok(Math.abs((await bar().boundingBox()).x-before.x-width)<2,'Bar moves immediately before save resolves')
  await drag(bar(),width)
  assert.ok(Math.abs((await bar().boundingBox()).x-before.x-width*2)<2,'A second drag is accepted while the first is saving')
  assert.equal(await count(),3)
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').start,'2026-11-02')
  await release();await page.waitForFunction(()=>window.__writes.length===4)
  assert.ok(Math.abs((await bar().boundingBox()).x-before.x-width*2)<2,'Acknowledgement does not jump back to the earlier drag')
  await release();await page.locator('.source-save-status').waitFor({state:'hidden'})
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').start,'2026-11-04')
  assert.equal(await page.evaluate(()=>window.__refreshes),1,'Edits do not invoke a whole-source refresh')
  checks.push('Repeated timeline drags update instantly and remain at the latest position while earlier requests complete')

  const saved=await bar().boundingBox()
  await drag(bar(),-width)
  await page.evaluate(()=>window.__reject=true);await release()
  await page.locator('.source-edit-error').waitFor()
  assert.ok(Math.abs((await bar().boundingBox()).x-saved.x)<2,'Rejected save restores last acknowledged date')
  await page.getByRole('button',{name:'Retry edit',exact:true}).click()
  assert.ok(Math.abs((await bar().boundingBox()).x-saved.x+width)<2,'Retry reapplies preserved draft immediately')
  await release();await page.locator('.source-save-status').waitFor({state:'hidden'})
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').start,'2026-11-03')
  assert.equal(await page.locator('.source-edit-error').count(),0)
  checks.push('Failed saves restore server-confirmed data and retain a working retry draft')

  await page.getByRole('tab',{name:'List',exact:true}).click()
  await page.getByLabel('Search this view',{exact:true}).fill('Edit the opening sequence')
  await page.locator('.list-table-row').filter({hasText:'Edit the opening sequence'}).click()
  const description=page.locator('.description-section'),editor=description.locator('.markdown-editor')
  for(const body of ['Earlier draft','Latest draft']){
    await description.getByRole('button',{name:'Edit',exact:true}).click()
    await editor.getByRole('tab',{name:'Markdown',exact:true}).click()
    await editor.getByLabel('Markdown',{exact:true}).fill(body)
    await description.getByRole('button',{name:'Save description',exact:true}).click()
    await editor.waitFor({state:'hidden'})
  }
  await page.evaluate(()=>window.__reject=true);await release()
  await editor.waitFor();await editor.getByRole('tab',{name:'Markdown',exact:true}).click()
  assert.equal(await editor.getByLabel('Markdown',{exact:true}).inputValue(),'Latest draft','A failed batch must reopen the newest description, not the earlier draft')
  await page.evaluate(()=>window.__hold=false)
  await description.getByRole('button',{name:'Save description',exact:true}).click()
  await page.locator('.source-save-status').waitFor({state:'hidden'})
  assert.equal((await backend()).records.find(item=>item.id==='card-mine').body,'Latest draft')
  checks.push('Two fast description saves retain the newest editable draft when an earlier request fails')
  await page.screenshot({path:'artifacts/instant-edits-description.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:checks.length,checks,rendererErrors:errors},null,2))
}finally{await browser.close()}
