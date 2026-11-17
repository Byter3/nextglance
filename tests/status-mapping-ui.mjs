/** Mapping/drag behavior with isolated fixture data and native API mocks. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
import {statusSourceKey} from '@nextspace/core/status-mapping.mjs'

const initial=plannerFixture(new Date(2026,10,10,9))
initial.workspace.planner.view='board';initial.workspace.planner.assignment='all';initial.workspace.planner.showCompleted=true
initial.workspace.appearance.mode='dark'
initial.workspace.relations=[]
initial.collections.find(item=>item.id==='deck-work').color='#e8bc42'
Object.assign(initial.records.find(item=>item.id==='card-mine'),{color:'#8844cc',tags:['Review'],tagDetails:[{id:'42',title:'Review',color:'#e85564'}]})
initial.records.find(item=>item.id==='task-undated').status='CANCELLED'
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1680,height:1080},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(15000)
const checks=[],errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(data=>{
  const clone=value=>structuredClone(value),key='status-mapping-fixture'
  let state=JSON.parse(sessionStorage.getItem(key)||'null')||clone(data)
  window.__statusWrites=[]
  const persist=()=>sessionStorage.setItem(key,JSON.stringify(state))
  const read=async()=>clone(state)
  window.workspaceApi={getState:read,refresh:read,syncWorkspace:read,saveWorkspace:async(workspace,revision)=>{
    if(revision!==state.revision)throw Error('Stale mapping fixture')
    state.workspace=clone(workspace);state.revision++;persist()
    return {workspace:clone(state.workspace),revision:state.revision,storage:clone(state.storage)}
  },moveCard:async input=>{window.__statusWrites.push({method:'moveCard',...input});const record=state.records.find(item=>item.id===input.id);record.stackId=input.stackId;record.status=state.collections.find(item=>item.id===record.collectionId).stacks.find(stack=>stack.id===input.stackId).title;persist();return read()},
  setCardCompleted:async input=>{window.__statusWrites.push({method:'setCardCompleted',...input});state.records.find(item=>item.id===input.id).completed=input.completed;persist();return read()},
  updateTaskStatus:async input=>{window.__statusWrites.push({method:'updateTaskStatus',...input});const record=state.records.find(item=>item.id===input.id);record.status=input.status;record.completed=input.status==='COMPLETED';record.percentComplete=record.completed?100:input.status==='NEEDS-ACTION'?0:record.percentComplete;persist();return read()},
  updateDescription:read,openExternal:async()=>{},readPage:async()=>({body:''}),exportWorkspace:async()=>({exported:true})}
},initial)
const state=()=>page.evaluate(()=>window.workspaceApi.getState())
const writes=()=>page.evaluate(()=>window.__statusWrites)
const board=()=>page.getByRole('region',{name:'Kanban board',exact:true})
const card=id=>board().locator(`.board-card[data-record-id="${id}"]`)
const editor=()=>page.locator('.status-mapping-editor')
async function until(predicate,message){const end=Date.now()+15000;while(Date.now()<end){if(predicate(await state())===true)return;await new Promise(resolve=>setTimeout(resolve,50))}assert.fail(message)}
async function map(source,status,column){await editor().locator(`.mapping-native-status[data-status-key='${statusSourceKey('deck',source,status)}'] select`).selectOption(column)}
try{
  await page.goto('http://127.0.0.1:5173')
  await board().waitFor()
  await board().getByRole('button',{name:'Map statuses',exact:true}).click()
  await editor().getByRole('heading',{name:'Map unified statuses',exact:true}).waitFor()
  assert.ok(await editor().locator('[data-column-id="$unmapped"] .mapping-native-status').count()>0)
  await map('deck-work','stack-todo','todo')
  await map('deck-work','stack-progress','doing')
  await map('deck-work','stack-review','doing')
  await map('deck-shared','shared-todo','todo')
  await page.screenshot({path:'artifacts/status-mapping-editor.png'})
  await editor().getByRole('button',{name:'Save mapping',exact:true}).click()
  await editor().waitFor({state:'hidden'})
  await until(value=>value.workspace.planner.statusMapping?.assignments[statusSourceKey('deck','deck-work','stack-review')]==='doing','Mapping should persist')
  assert.equal(await board().getByLabel('Board source').inputValue(),'__unified__')
  assert.equal(await board().locator('[data-column-id="todo"] [data-record-id="card-mine"]').count(),1)
  assert.equal(await board().locator('[data-column-id="todo"] [data-record-id="card-both"]').count(),1)
  assert.equal(await board().locator('[data-column-id="done"] [data-record-id="card-complete"]').count(),1)
  assert.equal(await board().locator('[data-column-id="cancelled"] [data-record-id="task-undated"]').count(),1)
  assert.equal(await board().locator('[data-column-id="$unmapped"] [data-record-id="card-gig"]').count(),1)
  assert.deepEqual(await writes(),[],'Mapping changes grouping only; source fields remain unchanged')
  checks.push('Source-specific Deck stacks and task statuses map into shared columns while completed, cancelled, and unmapped work stay accurate')

  const itemColor=await card('card-mine').evaluate(element=>getComputedStyle(element).borderInlineStartColor)
  const sourceColor=await card('card-mine').locator('.source-color-dot').evaluate(element=>getComputedStyle(element).backgroundColor)
  assert.equal(itemColor,sourceColor,'The left stripe keeps the native source color')
  assert.equal(await card('card-mine').evaluate(element=>element.style.getPropertyValue('--item-color')),'#8844cc')
  assert.notEqual(await card('card-mine').evaluate(element=>getComputedStyle(element).backgroundColor),await page.locator('.app-main').evaluate(element=>getComputedStyle(element).backgroundColor),'The full card carries its item tint')
  assert.match(await card('card-mine').locator('.board-card-tags').textContent(),/Review/)
  checks.push('Item color and colored tags coexist with the original Deck source-color marker')

  await card('card-mine').getByLabel('Move Edit the opening sequence',{exact:true}).selectOption('doing')
  const choice=page.getByRole('dialog',{name:'Choose the native status',exact:true})
  await choice.waitFor()
  assert.equal(await choice.getByRole('radio').count(),2)
  await choice.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.deepEqual(await writes(),[])
  assert.equal(await card('card-mine').getByLabel('Move Edit the opening sequence',{exact:true}).inputValue(),'todo')
  await card('card-mine').dragTo(board().locator('[data-column-id="doing"] header'))
  await choice.getByRole('radio',{name:'Review',exact:true}).check()
  await choice.getByRole('button',{name:'Update status',exact:true}).click()
  await until(value=>value.records.find(item=>item.id==='card-mine').stackId==='stack-review','Choosing a mapped destination must write that native stack')
  assert.ok((await writes()).some(call=>call.method==='moveCard'&&call.id==='card-mine'&&call.stackId==='stack-review'))
  assert.match(await card('card-mine').locator('.board-native-status').textContent(),/Review/)
  checks.push('Ambiguous drop asks for the native target; cancelling leaves data unchanged and choosing Review moves the Deck card')

  await card('task-today').getByLabel('Move Prepare review notes',{exact:true}).selectOption('doing')
  await until(value=>value.records.find(item=>item.id==='task-today').status==='IN-PROCESS','Task status must update natively')
  assert.ok((await writes()).some(call=>call.method==='updateTaskStatus'&&call.id==='task-today'&&call.status==='IN-PROCESS'))
  await card('task-today').getByLabel('Move Prepare review notes',{exact:true}).selectOption('done')
  await until(value=>value.records.find(item=>item.id==='task-today').completed===true,'Mapped Done must complete the native task')
  checks.push('Unambiguous mapped moves write actual CalDAV task status and completion')

  await card('card-complete').getByLabel('Move Completed delivery',{exact:true}).selectOption('todo')
  await until(value=>!value.records.find(item=>item.id==='card-complete').completed&&value.records.find(item=>item.id==='card-complete').stackId==='stack-todo','Moving a completed Deck card to an open stack must reopen it')
  assert.equal(await board().locator('[data-column-id="todo"] [data-record-id="card-complete"]').count(),1)
  checks.push('Completed Deck work can reopen into a mapped native stack without remaining incorrectly completed')

  await board().getByRole('button',{name:'Map statuses',exact:true}).click()
  await editor().getByRole('button',{name:'Remove In progress column',exact:true}).click()
  assert.equal(await editor().locator('[data-column-id="$unmapped"] .mapping-native-status').filter({hasText:'Review'}).count(),1)
  page.once('dialog',dialog=>dialog.dismiss());await editor().getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(await editor().isVisible(),true,'Dirty mapping must be protected')
  page.once('dialog',dialog=>dialog.accept());await editor().getByRole('button',{name:'Cancel',exact:true}).click()
  assert.ok((await state()).workspace.planner.statusMapping.columns.some(column=>column.id==='doing'))
  await page.reload();await board().waitFor()
  assert.equal(await board().getByLabel('Board source').inputValue(),'__unified__')
  assert.equal(await board().locator('[data-column-id="doing"] [data-record-id="card-mine"]').count(),1)
  await page.screenshot({path:'artifacts/unified-status-board.png'})
  checks.push('Removing a column only unmaps its statuses; cancelled drafts and saved mappings survive reload correctly')
  assert.deepEqual(errors,[])
  await writeFile('artifacts/status-mapping-ui.json',JSON.stringify({passed:checks.length,checks,errors},null,2))
  console.log(JSON.stringify({passed:checks.length,checks},null,2))
}catch(error){await page.screenshot({path:'artifacts/status-mapping-failure.png',fullPage:true});throw error}finally{await browser.close()}
