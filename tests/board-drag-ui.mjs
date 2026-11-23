/** Actual Board compact presentation, pointer/touch feedback and native-edit recovery. */
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {mkdir} from 'node:fs/promises'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),fixture=plannerFixture(new Date(2030,3,8,9))
fixture.workspace.planner.view='board';fixture.workspace.planner.scopeId='all';fixture.workspace.appearance.mode='dark'
fixture.workspace.planner.statusMapping={columns:[{id:'todo',title:'To do',color:'#888888'},{id:'doing',title:'In progress',color:'#0082c9'},{id:'review',title:'Review',color:'#22aa66'},{id:'empty',title:'No matching source',color:'#999999'}],assignments:{'["deck","deck-work","stack-todo"]':'todo','["deck","deck-work","stack-progress"]':'doing','["deck","deck-work","stack-review"]':'review'}}
fixture.collections=fixture.collections.filter(c=>c.id==='deck-work');fixture.workspace.spaces=[];fixture.workspace.projects=[];fixture.workspace.relations=[];fixture.workspace.plans=[]
const prototype=fixture.records.find(r=>r.id==='card-mine')
fixture.records=Array.from({length:18},(_,i)=>({...prototype,id:`drag-${i}`,title:`Card ${String(i).padStart(2,'0')}`,body:undefined,due:undefined}))
fixture.storage.syncStatus='synced';fixture.metadata={ready:true};fixture.nativeWriteSources=['deck'];fixture.nativeOperations=['moveCard','setCardCompleted']
const taskFixture=plannerFixture(new Date(2030,3,8,9))
const compactFixture=structuredClone(fixture)
const compactTask=taskFixture.records.find(record=>record.id==='task-today')
compactFixture.records.push({...compactTask,tags:['Review']})
compactFixture.collections.push(taskFixture.collections.find(collection=>collection.id===compactTask.collectionId))
const server=await createServer({configFile:path.join(root,'win/vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
let browser,page
try{
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
  browser=await chromium.launch({headless:true,channel:'msedge'})
  async function open(viewport,touch=false,initialState=fixture){
    const page=await browser.newPage({viewport,hasTouch:touch});page.setDefaultTimeout(15000)
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.errors=errors
    await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort())
    await page.route('**/drag-fixture',route=>route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module">import {mountNextspace} from '/@fs/${root.replaceAll('\\','/')}packages/ui/src/index.ts';mountNextspace(window.workspaceApi,'#app',{portalTarget:'#app',mobileHost:${touch}})</script></body></html>`}))
    await page.addInitScript(initial=>{
      const state=structuredClone(initial),read=async()=>structuredClone(state);window.__state=state;window.__writes=[];window.__holdMove=false;window.__failMove=false
      window.workspaceApi={getState:read,refresh:read,openExternal:async()=>{},setCardCompleted:async({id,completed})=>{state.records.find(r=>r.id===id).completed=completed;return read()},
        saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw Error('Stale fixture revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(state.workspace),revision:state.revision,storage:structuredClone(state.storage)}},
        moveCard:async input=>{window.__writes.push(structuredClone(input));if(window.__holdMove)await new Promise(resolve=>window.__releaseMove=resolve);if(window.__failMove){window.__failMove=false;throw Error('Fixture server rejected this move')}const record=state.records.find(r=>r.id===input.id);record.stackId=input.stackId;record.status=state.collections[0].stacks.find(s=>s.id===input.stackId).title;return read()},
      }
    },initialState)
    await page.goto(origin+'/drag-fixture',{waitUntil:'domcontentloaded',timeout:60000});await page.locator('.board-card.can-drag[data-record-id="drag-0"]').waitFor()
    return page
  }
  const card=(id)=>page.locator(`.board-card[data-record-id="${id}"]`),column=id=>page.locator(`.board-column[data-column-id="${id}"]`),preview=()=>page.locator('.board-drag-preview')
  async function point(locator){const b=await locator.boundingBox();assert.ok(b);return {x:b.x+Math.min(b.width/2,80),y:b.y+Math.min(b.height/2,35)}}
  async function assertPreview(x,y,offset){const b=await preview().boundingBox();assert.ok(b);assert.ok(Math.abs(b.x-(x-offset.x))<2,`preview x ${b.x}`);assert.ok(Math.abs(b.y-(y-offset.y))<2,`preview y ${b.y}`);assert.equal(await preview().getAttribute('aria-hidden'),'true');assert.equal(await preview().locator('[id],[data-record-id],[data-order-id]').count(),0);assert.equal(await preview().evaluate(el=>getComputedStyle(el).pointerEvents),'none');assert.equal(await page.locator('#app > .board-drag-preview').count(),1,'Preview stays in host portal')}

  page=await open({width:1440,height:900},false,compactFixture)
  const taskCard=card(compactTask.id),taskButton=taskCard.locator('.board-card-main')
  const taskSummary=taskCard.locator('.board-task-summary')
  await taskSummary.waitFor()
  assert.match(await taskSummary.innerText(),/Freelance tasks/)
  assert.equal(await taskSummary.locator('.board-task-due').getAttribute('data-date'),compactTask.due)
  assert.equal(await taskCard.locator('.board-item-icon.lucide-circle-icon').count(),1)
  assert.equal(await card('drag-0').locator('.board-item-icon.lucide-folder-kanban-icon').count(),1)
  const restingHeight=(await taskCard.boundingBox()).height
  assert.ok(restingHeight<58,`The resting task uses two compact lines: ${restingHeight}px`)
  const nativeStatus=taskCard.locator('.board-native-status'),tags=taskCard.locator('.board-card-tags')
  assert.equal(await nativeStatus.isVisible(),false)
  assert.equal(await tags.isVisible(),false)
  await taskButton.hover()
  const move=taskCard.getByRole('combobox',{name:`Move ${compactTask.title}`})
  const waitForMove=()=>page.waitForFunction(id=>{
    const footer=document.querySelector(`[data-record-id="${id}"] .board-card-controls`)
    return footer&&getComputedStyle(footer).opacity==='1'
  },compactTask.id)
  await waitForMove()
  assert.ok((await taskCard.boundingBox()).height>restingHeight)
  assert.ok(await move.isVisible())
  assert.ok(await nativeStatus.isVisible())
  assert.equal(await tags.innerText(),'Review')
  await page.locator('.board-column > header').first().hover()
  assert.equal(await nativeStatus.isVisible(),false)
  await taskButton.focus()
  await waitForMove()
  assert.ok(await nativeStatus.isVisible())
  assert.ok(await move.isVisible())
  await taskButton.press('Enter')
  await page.waitForFunction(id=>document.querySelector(`[data-record-id="${id}"]`)?.classList.contains('selected'),compactTask.id)
  assert.deepEqual(await page.evaluate(()=>window.__writes),[],'Opening a compact task does not change native status')
  assert.deepEqual(page.errors,[]);await page.close()

  page=await open({width:780,height:900},true,compactFixture)
  const touchCard=card(compactTask.id)
  await touchCard.locator('.board-task-summary').waitFor()
  assert.ok((await touchCard.locator('.board-card-main').boundingBox()).height<58)
  assert.equal(await touchCard.locator('.board-native-status').isVisible(),false)
  await waitForMove()
  assert.ok(await touchCard.getByRole('combobox',{name:`Move ${compactTask.title}`}).isVisible())
  assert.deepEqual(page.errors,[]);await page.close()

  page=await open({width:1600,height:950})
  await page.getByRole('combobox',{name:'Board source'}).selectOption('deck-work')
  // Mouse drag follows the original grab offset; pending native response lands optimistically.
  let b=await card('drag-0').boundingBox(),start={x:b.x+34,y:b.y+30},target=await point(column('stack-progress'))
  await page.evaluate(()=>window.__holdMove=true)
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:8})
  await preview().waitFor({state:'visible'});await assertPreview(target.x,target.y,{x:34,y:30})
  assert.ok(Number(await card('drag-0').evaluate(el=>getComputedStyle(el).opacity))<.5)
  assert.ok(await column('stack-progress').evaluate(el=>el.classList.contains('drop-over')))
  assert.equal(await page.evaluate(()=>window.__writes.length),0)
  await page.mouse.up();await preview().waitFor({state:'hidden'})
  await column('stack-progress').locator('[data-record-id="drag-0"]').waitFor()
  assert.deepEqual(await page.evaluate(()=>window.__writes),[{id:'drag-0',stackId:'stack-progress'}])
  await page.evaluate(()=>{window.__holdMove=false;window.__releaseMove()});await page.waitForFunction(()=>window.__state.records.find(r=>r.id==='drag-0').stackId==='stack-progress')
  // Escape, pointer cancellation and invalid outside drops never alter the source.
  for(const mode of ['escape','cancel','outside']){
    const from=await point(card('drag-1')),to=await point(column('stack-review'))
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await preview().waitFor({state:'visible'})
    if(mode==='escape')await page.keyboard.press('Escape')
    else if(mode==='cancel')await card('drag-1').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',bubbles:true})
    else await page.mouse.move(5,5)
    await page.mouse.up();await preview().waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__writes.length),1)
  }
  // Mapped invalid source has no destination highlight and cannot mutate.
  await page.getByRole('combobox',{name:'Board source'}).selectOption('__unified__')
  start=await point(card('drag-1'));target=await point(column('empty'))
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:5});await preview().waitFor({state:'visible'})
  assert.equal(await column('empty').evaluate(el=>el.classList.contains('drop-over')),false)
  await page.mouse.up();await preview().waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__writes.length),1)
  // A mapped native rejection rolls back, exposes Retry, and only explicit retry writes again.
  await page.evaluate(()=>window.__failMove=true)
  start=await point(card('drag-1'));target=await point(column('review'))
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:5});await page.mouse.up()
  await page.locator('.source-edit-error').filter({hasText:'Fixture server rejected this move'}).waitFor()
  await column('todo').locator('[data-record-id="drag-1"]').waitFor();assert.equal(await page.evaluate(()=>window.__writes.length),2)
  await page.getByRole('button',{name:'Retry edit',exact:true}).click();await column('review').locator('[data-record-id="drag-1"]').waitFor();await page.locator('.source-edit-error').waitFor({state:'hidden'})
  assert.equal(await page.evaluate(()=>window.__writes.length),3)
  // Within-column movement uses the same preview and commits only manual order.
  start=await point(card('drag-2'));const sibling=page.locator('.board-order-item[data-order-id="drag-4"]');b=await sibling.boundingBox();target={x:b.x+45,y:b.y+b.height-8}
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:5})
  await page.locator('.board-order-item.order-drop-before,.board-order-item.order-drop-after').waitFor();await preview().waitFor({state:'visible'})
  await page.mouse.up();await preview().waitFor({state:'hidden'})
  await page.waitForFunction(()=>Object.values(window.__state.workspace.planner.arrangements?.all?.boardCards||{}).some(ids=>ids.indexOf('drag-2')===ids.indexOf('drag-4')+1))
  assert.equal(await page.evaluate(()=>window.__writes.length),3,'Reordering does not perform a native status write')
  await mkdir(path.join(root,'artifacts/board-drag'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/board-drag/desktop.png')})
  assert.deepEqual(page.errors,[]);await page.close()
  // Genuine touch input: early movement pans; a deliberate hold starts the same drag.
  page=await open({width:780,height:900},true)
  let cdp=await page.context().newCDPSession(page)
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:7,radiusX:3,radiusY:3,force:1}]})
  start=await point(card('drag-0'));await touch('touchStart',start.x,start.y)
  await touch('touchMove',start.x,start.y-70);await touch('touchEnd');assert.equal(await preview().isVisible(),false);assert.equal(await page.evaluate(()=>window.__writes.length),0)
  assert.ok(await card('drag-0').evaluate(el=>el.getBoundingClientRect().y<125),'Early touch movement scrolls the Board')
  assert.deepEqual(page.errors,[]);await page.close()
  page=await open({width:390,height:844},true);cdp=await page.context().newCDPSession(page)
  await page.locator('#page-options-toggle').click()
  await page.getByRole('combobox',{name:'Board source'}).selectOption('deck-work')
  await page.getByRole('button',{name:'Close page options',exact:true}).click()
  b=await card('drag-0').boundingBox();start={x:b.x+31,y:b.y+28};target=await point(column('stack-progress'))
  await touch('touchStart',start.x,start.y);await preview().waitFor({state:'visible'});await touch('touchMove',target.x,target.y)
  await page.waitForFunction(()=>document.querySelector('.board-column[data-column-id="stack-progress"]')?.classList.contains('drop-over'))
  await assertPreview(target.x,target.y,{x:31,y:28});await page.screenshot({path:path.join(root,'artifacts/board-drag/touch-preview.png')})
  await touch('touchEnd');await preview().waitFor({state:'hidden'});await column('stack-progress').locator('[data-record-id="drag-0"]').waitFor()
  assert.deepEqual(await page.evaluate(()=>window.__writes),[{id:'drag-0',stackId:'stack-progress'}])
  start=await point(card('drag-1'));await touch('touchStart',start.x,start.y);await preview().waitFor({state:'visible'});await touch('touchMove',target.x,target.y);await touch('touchCancel');await preview().waitFor({state:'hidden'})
  assert.equal(await page.evaluate(()=>window.__writes.length),1);assert.deepEqual(page.errors,[])
  console.log('PASS: compact Board task rows and type icons, hover/focus/touch details and controls, native and mapped Board drops, inert drag preview, optimistic commit and retry, real touch pan/hold/drop/cancel')
}catch(error){if(page){await mkdir(path.join(root,'artifacts/board-drag'),{recursive:true});await page.screenshot({path:path.join(root,'artifacts/board-drag/failure.png')}).catch(()=>{})}throw error}
finally{await browser?.close();await server.close()}
