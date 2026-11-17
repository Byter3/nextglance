/** Native status controls, mapped colors, and save recovery through an isolated bridge. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
import {defaultStatusMapping,statusSourceKey} from '@nextspace/core/status-mapping.mjs'

const fixture=plannerFixture(new Date(2026,10,11,9))
Object.assign(fixture.workspace.planner,{view:'board',assignment:'all',showCompleted:true})
fixture.workspace.appearance.mode='dark'
fixture.workspace.relations=[]
fixture.workspace.planner.statusMapping=defaultStatusMapping(fixture.collections)
const colors={todo:'#d83c3c',doing:'#eed65c',done:'#218452',cancelled:'#7557a8'}
for(const column of fixture.workspace.planner.statusMapping.columns)column.color=colors[column.id]
for(const [stack,column] of [['stack-todo','todo'],['stack-progress','doing'],['stack-review','done']])fixture.workspace.planner.statusMapping.assignments[statusSourceKey('deck','deck-work',stack)]=column
Object.assign(fixture.records.find(record=>record.id==='task-today'),{status:'NEEDS-ACTION',percentComplete:0})
fixture.records.push({...structuredClone(fixture.records.find(record=>record.id==='task-today')),id:'task-readonly',title:'Read-only task',readonly:true})
for(let index=0;index<24;index++)fixture.records.push({...structuredClone(fixture.records.find(record=>record.id==='card-mine')),id:`scroll-card-${index}`,title:`Long board work ${index}`})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1680,height:1100},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(15000)
const checks=[],errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
await page.addInitScript(initial=>{
  const clone=value=>structuredClone(value),key='status-inspector-fixture'
  let state=JSON.parse(sessionStorage.getItem(key)||'null')||clone(initial)
  window.__writes=[];window.__held=[];window.__hold=false;window.__fail=false
  const persist=()=>sessionStorage.setItem(key,JSON.stringify(state))
  const read=async()=>clone(state)
  window.__patchFixture=patch=>{
    if(patch.mode)state.workspace.appearance.mode=patch.mode
    if(patch.connected!==undefined)state.connection.connected=patch.connected
    if(patch.taskSourceState)state.statuses.find(item=>item.source==='tasks').state=patch.taskSourceState
    if(patch.taskCollectionReadonly!==undefined)state.collections.find(item=>item.id==='tasks-work').readonly=patch.taskCollectionReadonly
    persist()
  }
  async function edit(method,input){
    const record=state.records.find(item=>item.id===input.id)
    if(input.etag!==undefined&&input.etag!==record.etag)throw Error('Fixture stale native revision')
    if(record.readonly||state.collections.find(item=>item.id===record.collectionId)?.readonly||!state.connection.connected||state.statuses.find(item=>item.source===record.source)?.state!=='connected')throw Error('Fixture rejects unavailable source writes')
    window.__writes.push({method,...clone(input)})
    if(window.__hold)await new Promise((resolve,reject)=>window.__held.push({resolve,reject}))
    if(window.__fail){window.__fail=false;throw Error('Fixture status save interrupted')}
    if(method==='task'){
      record.status=input.status;record.completed=input.status==='COMPLETED'
      const progress=Math.max(0,Math.min(100,Math.round(Number(record.percentComplete)||0)))
      record.percentComplete=record.completed?100:input.status==='IN-PROCESS'?Math.max(1,Math.min(99,progress)):input.status==='NEEDS-ACTION'?Math.min(99,progress):progress
    }else if(method==='deck'){
      record.stackId=input.stackId
      record.status=state.collections.find(item=>item.id===record.collectionId).stacks.find(stack=>stack.id===input.stackId).title
    }else record.completed=input.completed
    record.etag=`native-v${window.__writes.length+1}`;persist();return read()
  }
  window.workspaceApi={getState:read,refresh:read,syncWorkspace:read,readPage:async()=>({body:''}),openExternal:async()=>{},exportWorkspace:async()=>({exported:true}),
    saveWorkspace:async(workspace,revision)=>{
      if(revision!==state.revision)throw Error('Fixture stale planner revision')
      state.workspace=clone(workspace);state.revision++;persist()
      return {workspace:clone(state.workspace),revision:state.revision,storage:clone(state.storage)}
    },updateTaskStatus:input=>edit('task',input),moveCard:input=>edit('deck',input),setCardCompleted:input=>edit('complete',input),
    setTaskCompleted:input=>edit('task',{...input,status:input.completed?'COMPLETED':'NEEDS-ACTION'})}
},fixture)
const board=()=>page.getByRole('region',{name:'Kanban board',exact:true})
const tile=id=>board().locator(`.board-card[data-record-id="${id}"]`)
const details=()=>page.getByRole('complementary',{name:'Item details',exact:true})
const taskStatus=()=>details().getByLabel('Task status',{exact:true})
async function choose(control,value){await control.click();await page.locator(`.status-select-option[data-value="${value}"]`).click()}
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const savedTask=async()=> (await backend()).records.find(item=>item.id==='task-today')
const close=async()=>{await details().getByRole('button',{name:'Close item details',exact:true}).click();await details().waitFor({state:'hidden'})}
const open=async id=>{await tile(id).locator('.board-card-main').click();await details().waitFor()}
const idle=()=>page.locator('.source-save-status').waitFor({state:'hidden'})
const release=()=>page.evaluate(()=>window.__held.shift().resolve())
async function until(predicate,message){const end=Date.now()+15000;while(Date.now()<end){if(predicate(await backend()))return;await new Promise(resolve=>setTimeout(resolve,40))}assert.fail(message)}
function rgb(hex){return `rgb(${[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)).join(', ')})`}
function luminance(color){const parts=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return parts[0]*.2126+parts[1]*.7152+parts[2]*.0722}
async function coloredControl(locator,color){
  const style=await locator.evaluate(element=>{const style=getComputedStyle(element);return {background:style.backgroundColor,color:style.color,width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}})
  assert.equal(style.background,rgb(color),'The entire status selector must carry its mapped Board color')
  const a=luminance(style.background),b=luminance(style.color)
  assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`Status text must stay readable: ${JSON.stringify(style)}`)
  assert.ok(style.width>100&&style.height>=30,'A status is a usable full label, not a detached color chip')
  assert.equal(await details().locator('.mapped-status-swatch').count(),0,'The old detached swatch must be removed')
}
try{
  await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173');await board().waitFor()
  await open('card-mine')
  const stack=details().getByLabel('Deck stack',{exact:true})
  await coloredControl(stack,colors.todo)
  await stack.click()
  for(const [id,column] of [['stack-todo','todo'],['stack-progress','doing'],['stack-review','done']])await coloredControl(page.locator(`.status-select-option[data-value="${id}"]`),colors[column])
  await stack.press('End')
  assert.equal(await page.locator('.status-select-menu').getByRole('option',{name:'Review',exact:true}).getAttribute('id'),await stack.getAttribute('aria-activedescendant'))
  await stack.press('Home')
  assert.equal(await page.locator('.status-select-menu').getByRole('option',{name:'To do',exact:true}).getAttribute('id'),await stack.getAttribute('aria-activedescendant'))
  await stack.press('i')
  assert.equal(await page.locator('.status-select-menu').getByRole('option',{name:'In progress',exact:true}).getAttribute('id'),await stack.getAttribute('aria-activedescendant'))
  await stack.press('Escape');assert.equal(await stack.getAttribute('data-value'),'stack-todo')
  await stack.press('ArrowDown');await stack.press('ArrowDown');await stack.press('Enter')
  await until(state=>state.records.find(item=>item.id==='card-mine').stackId==='stack-progress','Keyboard selection must save')
  await idle();await choose(stack,'stack-todo');await idle()
  await stack.click();await details().locator('.inspector-kind').click()
  assert.equal(await page.getByRole('listbox',{name:'Deck stack'}).count(),0,'Clicking outside closes the menu')
  checks.push('Every dropdown option shows its mapped color with readable text; keyboard navigation, typeahead, Escape, selection and outside dismissal work')

  await page.evaluate(()=>window.scrollTo(0,650))
  assert.ok(await page.evaluate(()=>window.scrollY)>100,'Fixture must exercise a genuinely scrolled long Board')
  const header=await page.locator('.app-topbar').boundingBox(),inspector=await details().boundingBox()
  assert.equal(Math.round(header.y),0);assert.equal(Math.round(inspector.y),Math.round(header.height),'Inspector meets the pinned app header without a gap')
  await page.screenshot({path:'artifacts/status-header-long-board.png'})
  await page.setViewportSize({width:740,height:900})
  const mobileHeader=await page.locator('.app-topbar').boundingBox(),mobileInspector=await details().boundingBox()
  assert.equal(Math.round(mobileHeader.y),0);assert.equal(Math.round(mobileInspector.y),Math.round(mobileHeader.height))
  assert.ok(mobileHeader.x>=0&&mobileHeader.x+mobileHeader.width<=740)
  await page.setViewportSize({width:1680,height:1100});await page.evaluate(()=>window.scrollTo(0,0))
  checks.push('The global header remains at the top when a long Board scrolls, and the inspector meets it at desktop and narrow widths')
  await choose(stack,'stack-progress')
  await until(state=>state.records.find(item=>item.id==='card-mine').stackId==='stack-progress','Deck change must reach its native API')
  await idle();await coloredControl(stack,colors.doing)
  assert.equal(await tile('card-mine').locator('..').locator('..').getAttribute('data-column-id'),'doing')
  await page.screenshot({path:'artifacts/status-inspector-deck-dark.png'})
  await close()
  checks.push('Deck stack color fills the selector itself and follows the actual mapped stack after a native move')

  await open('task-today')
  await taskStatus().click()
  assert.deepEqual(await page.locator('.status-select-menu').getByRole('option').evaluateAll(options=>options.map(option=>option.dataset.value)),['NEEDS-ACTION','IN-PROCESS','COMPLETED','CANCELLED'])
  for(const [status,column] of [['NEEDS-ACTION','todo'],['IN-PROCESS','doing'],['COMPLETED','done'],['CANCELLED','cancelled']])await coloredControl(page.locator(`.status-select-option[data-value="${status}"]`),colors[column])
  await taskStatus().press('Escape')
  assert.equal(await taskStatus().getAttribute('data-value'),'NEEDS-ACTION')
  for(const [status,column,complete,percent] of [['IN-PROCESS','doing',false,1],['COMPLETED','done',true,100],['IN-PROCESS','doing',false,99],['CANCELLED','cancelled',false,99],['NEEDS-ACTION','todo',false,99],['COMPLETED','done',true,100],['CANCELLED','cancelled',false,100],['NEEDS-ACTION','todo',false,99]]){
    await choose(taskStatus(),status)
    await until(state=>state.records.find(item=>item.id==='task-today').status===status,`Native task must save ${status}`)
    await idle();assert.equal(await taskStatus().getAttribute('data-value'),status)
    assert.deepEqual(((record)=>({completed:record.completed,percentComplete:record.percentComplete}))(await savedTask()),{completed:complete,percentComplete:percent})
    assert.equal(await board().locator(`[data-column-id="${column}"] [data-record-id="task-today"]`).count(),1)
    await coloredControl(taskStatus(),colors[column])
  }
  assert.ok((await page.evaluate(()=>window.__writes)).filter(item=>item.method==='task').every(item=>item.etag),'Task edits carry the latest native version')
  checks.push('All four native task statuses are directly editable and mapped; reopening clears completion, retains partial progress, and cancellation stays distinct from completion at 100%')

  await page.evaluate(()=>window.__hold=true)
  const before=(await savedTask()).status
  await choose(taskStatus(),'IN-PROCESS')
  await page.waitForFunction(()=>window.__held.length===1)
  assert.equal(await taskStatus().getAttribute('data-value'),'IN-PROCESS')
  assert.equal((await savedTask()).status,before,'Server is deliberately unresolved while the UI changes')
  assert.equal(await board().locator('[data-column-id="doing"] [data-record-id="task-today"]').count(),1)
  await coloredControl(taskStatus(),colors.doing)
  await release();await idle();assert.equal((await savedTask()).status,'IN-PROCESS')
  checks.push('Status and Board changes render immediately while the native save is unresolved')

  await page.evaluate(()=>window.__fail=true)
  await choose(taskStatus(),'CANCELLED');await page.waitForFunction(()=>window.__held.length===1)
  await release();await page.locator('.source-edit-error').waitFor()
  assert.equal(await taskStatus().getAttribute('data-value'),'IN-PROCESS','Failed save restores the last acknowledged source status')
  assert.equal((await savedTask()).status,'IN-PROCESS')
  await page.getByRole('button',{name:'Retry edit',exact:true}).click()
  await page.waitForFunction(()=>window.__held.length===1)
  assert.equal(await taskStatus().getAttribute('data-value'),'CANCELLED','Retry reapplies the retained status draft immediately')
  await release();await idle();await page.locator('.source-edit-error').waitFor({state:'hidden'})
  assert.equal((await savedTask()).status,'CANCELLED')
  await page.evaluate(()=>window.__hold=false);await close()
  await page.reload();await board().waitFor();await open('task-today')
  assert.equal(await taskStatus().getAttribute('data-value'),'CANCELLED')
  await coloredControl(taskStatus(),colors.cancelled)
  checks.push('Failed status saves preserve a retryable draft, restore confirmed data, and persist correctly through reload')

  await close();await open('task-readonly')
  assert.equal(await taskStatus().isDisabled(),true)
  await close();await page.evaluate(()=>window.__patchFixture({taskCollectionReadonly:true}));await page.reload();await board().waitFor();await open('task-today')
  assert.equal(await taskStatus().isDisabled(),true,'Read-only task lists disable editing even if the individual record flag is stale')
  await close();await page.evaluate(()=>window.__patchFixture({taskCollectionReadonly:false,taskSourceState:'error'}));await page.reload();await board().waitFor();await open('task-today')
  assert.equal(await taskStatus().isDisabled(),true,'A failed source refresh cannot expose native editing')
  await close();await page.evaluate(()=>window.__patchFixture({taskSourceState:'connected',connected:false}));await page.reload();await board().waitFor();await open('task-today')
  assert.equal(await taskStatus().isDisabled(),true,'Cached offline tasks remain visible but cannot be edited')
  assert.deepEqual(await page.evaluate(()=>window.__writes),[])
  checks.push('Read-only, source-error and disconnected tasks expose their status without allowing unsupported writes')

  await close();await page.evaluate(()=>window.__patchFixture({connected:true,mode:'light'}));await page.reload();await board().waitFor();await open('task-today')
  await choose(taskStatus(),'IN-PROCESS');await until(state=>state.records.find(item=>item.id==='task-today').status==='IN-PROCESS','Light-mode task edit must save');await idle()
  await coloredControl(taskStatus(),colors.doing)
  await page.screenshot({path:'artifacts/status-inspector-task-light.png'})
  await close();await open('card-mine');await coloredControl(details().getByLabel('Deck stack',{exact:true}),colors.doing)
  await page.screenshot({path:'artifacts/status-inspector-deck-light.png'})
  checks.push('Bright mapped colors retain readable task and Deck status text in light and dark themes')

  assert.deepEqual(errors,[])
  const result={passed:checks.length,checks,rendererErrors:errors}
  await writeFile('artifacts/status-inspector-ui.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
}catch(error){
  console.error('Status inspector failure:',error)
  await writeFile('artifacts/status-inspector-failure.json',JSON.stringify({checks,rendererErrors:errors,error:String(error?.stack||error)},null,2))
  // A failed renderer or an oversized Board must not hide the original failure
  // behind a second timeout while collecting a diagnostic image.
  await page.screenshot({path:'artifacts/status-inspector-failure.png',timeout:4000,animations:'disabled'}).catch(()=>{})
  throw error
}finally{await browser.close()}
