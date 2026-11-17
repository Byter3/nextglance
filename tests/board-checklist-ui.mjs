/** Native Deck description markers, with held responses proving rapid checkbox edits. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixture=plannerFixture(new Date(2026,10,2,9))
const body='# Installation\r\n\r\n- [ ] Confirm **delivery**\r\n- [x] Clear floor\r\n  - [ ] Check `dimensions`\r\n- [ ] Confirm **delivery**\r\n- [ ] Final check\r\n\r\n```md\r\n- [ ] Example\r\n```\r\n\r\n    - [ ] Indented example\r\n'
const card=fixture.records.find(record=>record.id==='card-mine')
Object.assign(card,{body,etag:'deck-v1'})
fixture.records.push({...card,id:'readonly-card',title:'Shared read-only card',readonly:true,body:'- [ ] Read-only item'})
fixture.records.find(record=>record.id==='task-today').body='- [ ] A native task checklist'
fixture.workspace.appearance.mode='dark'
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1652,height:1050},timezoneId:'Europe/Budapest'}),checks=[],errors=[]
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(initial=>{
  const state=structuredClone(initial);window.__writes=[];window.__held=[];window.__moves=[];window.__hold=true;window.__fail=false
  const read=async()=>structuredClone(state)
  window.workspaceApi={getState:read,refresh:read,openExternal:async()=>{},readPage:async()=>({body:''}),
    saveWorkspace:async(workspace)=>{state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},
    updateDescription:async input=>{
      const record=state.records.find(item=>item.id===input.id)
      if(record.readonly)throw new Error('Read-only source')
      if(record.etag!==input.etag)throw new Error('Stale fixture ETag')
      window.__writes.push(structuredClone(input))
      if(window.__hold)await new Promise(resolve=>window.__held.push(resolve))
      if(window.__fail){window.__fail=false;throw new Error('Checklist fixture rejected save')}
      record.body=input.description;record.etag=`deck-v${window.__writes.length+1}`;return read()
    },
    moveCard:async input=>{window.__moves.push(structuredClone(input));return read()},
  }
},fixture)
const native=()=>page.locator('.board-card[data-record-id="card-mine"]')
const checklist=()=>native().locator('.board-checklist')
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const release=()=>page.evaluate(()=>window.__held.shift()())
try{
  await page.goto('http://127.0.0.1:5173');await page.locator('.overview-split').waitFor()
  await page.getByRole('tab',{name:'Board',exact:true}).click();await native().waitFor()
  assert.equal(await checklist().getByRole('checkbox').count(),3)
  assert.match(await checklist().locator('.board-checklist-progress').innerText(),/1 \/ 5/)
  assert.equal(await page.locator('.board-card[data-record-id="task-today"] .board-checklist').count(),0)
  await checklist().getByRole('button',{name:'Show 2 more',exact:true}).click()
  assert.equal(await checklist().getByRole('checkbox').count(),5)
  assert.equal(await checklist().getByRole('checkbox',{name:'Confirm delivery',exact:true}).count(),2)
  assert.equal(await checklist().getByRole('checkbox',{name:'Example',exact:true}).count(),0)
  await checklist().locator('.board-checklist-heading').click();assert.equal(await checklist().getByRole('checkbox').count(),0)
  await checklist().locator('.board-checklist-heading').click()
  checks.push('Deck descriptions expose a calm preview, progress and expandable child rows; native tasks and code examples remain separate')

  await checklist().getByRole('checkbox',{name:'Confirm delivery',exact:true}).first().click()
  await checklist().getByRole('checkbox',{name:'Check dimensions',exact:true}).click()
  assert.equal(await checklist().getByRole('checkbox',{name:'Confirm delivery',exact:true}).first().getAttribute('aria-checked'),'true')
  assert.equal(await checklist().getByRole('checkbox',{name:'Confirm delivery',exact:true}).last().getAttribute('aria-checked'),'false')
  assert.equal(await checklist().getByRole('checkbox',{name:'Check dimensions',exact:true}).getAttribute('aria-checked'),'true')
  assert.equal(await page.getByRole('complementary',{name:'Item details'}).count(),0)
  assert.equal(await page.evaluate(()=>window.__writes.length),1)
  assert.equal((await backend()).records.find(record=>record.id==='card-mine').body,body)
  await release();await page.waitForFunction(()=>window.__writes.length===2)
  assert.equal(await page.evaluate(()=>window.__writes[1].etag),'deck-v2')
  await release();await page.locator('.source-save-status').waitFor({state:'hidden'})
  const saved=(await backend()).records.find(record=>record.id==='card-mine')
  assert.equal(saved.body,body.replace('- [ ] Confirm','- [x] Confirm').replace('  - [ ] Check','  - [x] Check'))
  assert.equal(saved.completed,false);assert.equal(saved.stackId,'stack-todo')
  assert.equal((await backend()).records.length,fixture.records.length)
  checks.push('Rapid child toggles update immediately, modify only their exact native markers, and do not create or complete tasks/cards')

  const readonly=page.locator('.board-card[data-record-id="readonly-card"] .board-checklist')
  assert.equal(await readonly.getByRole('checkbox').isDisabled(),true)
  await page.getByLabel('Board source',{exact:true}).selectOption('deck-work')
  // Changing from combined status columns to native Deck stacks remounts the
  // card and intentionally restores its compact three-row checklist preview.
  assert.equal(await checklist().getByRole('checkbox').count(),3)
  await checklist().getByRole('button',{name:'Show 2 more',exact:true}).click()
  const checkbox=checklist().getByRole('checkbox',{name:'Clear floor',exact:true})
  await checkbox.dispatchEvent('pointerdown',{button:0})
  const dragAllowed=await native().evaluate(element=>element.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()})))
  assert.equal(dragAllowed,false,'Dragging from a child control cannot move its parent card')
  await page.evaluate(()=>window.__hold=false)
  await checkbox.focus();await checkbox.press('Space')
  await page.locator('.source-save-status').waitFor({state:'hidden'})
  assert.equal(await checkbox.getAttribute('aria-checked'),'false')
  assert.deepEqual(await page.evaluate(()=>window.__moves),[])
  checks.push('Read-only markers stay disabled and keyboard/drag interactions do not open or move the parent card')

  await page.evaluate(()=>window.__fail=true)
  await checklist().getByRole('checkbox',{name:'Final check',exact:true}).click()
  await page.locator('.source-edit-error').filter({hasText:'Checklist fixture rejected save'}).waitFor()
  assert.equal(await checklist().getByRole('checkbox',{name:'Final check',exact:true}).getAttribute('aria-checked'),'false')
  await page.getByRole('button',{name:'Retry edit',exact:true}).click()
  await page.locator('.source-save-status').waitFor({state:'hidden'})
  assert.equal(await checklist().getByRole('checkbox',{name:'Final check',exact:true}).getAttribute('aria-checked'),'true')
  checks.push('Rejected checklist saves restore confirmed markers and retain a working Retry edit')
  await page.screenshot({path:'artifacts/board-checklist-children.png',fullPage:true})
  await page.setViewportSize({width:600,height:1000})
  assert.ok(await checklist().getByRole('checkbox').first().isVisible())
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){await page.screenshot({path:'artifacts/board-checklist-failure.png',fullPage:true});console.error({checks,errors});throw error}finally{await browser.close()}
