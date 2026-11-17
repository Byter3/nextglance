/** Mobile glass presentation against a bright fixture wallpaper; no live accounts. */
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState,createPlannerWorkspace} from '@nextspace/core/planner.mjs'

const output=path.resolve(import.meta.dirname,'../../artifacts/android-glass')
await mkdir(output,{recursive:true})
const baseUrl=process.env.ANDROID_PREVIEW_URL||'http://127.0.0.1:5174'
const workspace=createPlannerWorkspace()
const records=[{id:'card-1',source:'deck',kind:'card',title:'Prepare the project handover',body:'Keep the source files and delivery notes together.\n\n- [ ] Review the final export\n- [x] Confirm the deadline',collectionId:'deck-1',collectionTitle:'Freelance',stackId:'review',assignmentKnown:true,assigneeIds:['fixture'],color:'#c17c47',tags:['Delivery']}]
const live={...createEmptyState(),mode:'live',workspace,records,revision:0,
  connection:{connected:true,serverUrl:'https://fixture.invalid',username:'fixture'},
  collections:[{id:'deck-1',source:'deck',title:'Freelance',color:'#3489d0',stacks:[{id:'review',title:'Review'}]}],
  statuses:['tasks','calendar','deck','notes','collectives'].map(source=>({source,state:'connected',count:source==='deck'?1:0})),
  storage:{syncStatus:'synced'},metadata:{ready:true},deviceState:{},nativeOperations:[],
}
const browser=await chromium.launch({headless:true,channel:'msedge'}),errors=[]
async function screenshot(page,name){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No horizontal page overflow')
  await page.screenshot({path:path.join(output,name+'.png'),fullPage:true})
}
async function surface(page,selector){
  return page.locator(selector).evaluate(element=>{
    const style=getComputedStyle(element),canvas=document.createElement('canvas');canvas.width=canvas.height=1
    const context=canvas.getContext('2d');context.fillStyle=style.backgroundColor;context.fillRect(0,0,1,1)
    return {alpha:context.getImageData(0,0,1,1).data[3]/255,filter:style.backdropFilter,background:style.backgroundColor}
  })
}
try{
  for(const width of [384,900])for(const mode of ['light','dark']){
    const context=await browser.newContext({viewport:{width,height:1000},colorScheme:mode})
    await context.addInitScript(({live,mode})=>{
      const state=structuredClone(live),canvas=document.createElement('canvas');canvas.width=400;canvas.height=600
      const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,400,600)
      gradient.addColorStop(0,'#ffe85c');gradient.addColorStop(.28,'#ff9ca8');gradient.addColorStop(.55,'#f9faff');gradient.addColorStop(.8,'#43cdff');gradient.addColorStop(1,'#8a73ff')
      ctx.fillStyle=gradient;ctx.fillRect(0,0,400,600);ctx.fillStyle='#ffffff';ctx.fillRect(140,0,50,600)
      state.theme={mode,dark:mode==='dark',color:'#2d84c8',backgroundColor:'#357ec3',backgroundDataUrl:canvas.toDataURL('image/png')}
      const snapshot=()=>structuredClone(state)
      window.__setSyncFixture=patch=>Object.assign(state,patch)
      window.__fixture={isNative:true,getState:async()=>snapshot(),refresh:async()=>snapshot(),syncWorkspace:async()=>snapshot(),subscribe:()=>()=>{},selectAccount:async()=>snapshot(),openExternal:async()=>{},readPage:async()=>({body:''}),saveWorkspace:async(workspace,revision)=>{assertRevision(revision);state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}}}
      function assertRevision(value){if(value!==state.revision)throw new Error('Unexpected fixture revision')}
    },{live,mode})
    await context.route('**/src/adapter.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const createAndroidApi=()=>window.__fixture'}))
    await context.route('**/__nextglance/**',route=>{errors.push('Unexpected live host request');return route.abort()})
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10_000)
    await page.goto(baseUrl);await page.getByRole('tab',{name:'Board',exact:true}).click()
    const card=page.locator('.board-card[data-record-id="card-1"]');await card.waitFor()
    assert.equal(await card.evaluate(element=>getComputedStyle(element).borderLeftColor),'rgb(52, 137, 208)','Original board color remains visible')
    const lane=await surface(page,'.board-column:has([data-record-id="card-1"])')
    assert.ok(lane.alpha<.9,'Board lane keeps the approved glass treatment')
    assert.equal((await surface(page,'.board-card[data-record-id="card-1"]')).filter,'none','No per-card blur')
    await screenshot(page,`board-${mode}-${width}`)
    await card.locator('.board-card-main').click();await page.locator('.inspector').waitFor()
    const inspector=await surface(page,'.inspector');assert.ok(Math.abs(inspector.alpha-.68)<.01,'Inspector uses the common glass shell')
    assert.equal((await surface(page,'.inspector-content')).alpha,1,'Inspector information prevents underlying text from showing through')
    assert.equal(inspector.filter,'none','Inspector does not add a blur layer')
    const box=await page.locator('.inspector').boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=width+1,'Inspector stays within viewport')
    if(width===384)assert.ok(Math.abs(box.width-width)<=1,'Phone inspector uses the full width')
    await screenshot(page,`inspector-${mode}-${width}`)
    await page.getByRole('button',{name:'Close item details',exact:true}).click()
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.locator('.planner-app.sidebar-open').waitFor()
    await page.waitForFunction(()=>{const box=document.querySelector('.app-sidebar').getBoundingClientRect();return box.x>=-.5&&box.width>180&&box.right<=innerWidth})
    assert.ok(Math.abs((await surface(page,'.app-sidebar')).alpha-.68)<.01,'Navigation uses the common glass shell')
    assert.equal((await surface(page,'.spaces-nav')).alpha,1,'Navigation information is opaque')
    await screenshot(page,`navigation-${mode}-${width}`)
    await page.getByRole('button',{name:'Close navigation',exact:true}).click()
    if(width===384){
      assert.equal(await page.locator('#planner-search').isVisible(),false,'Phone search is collapsed initially')
      await page.getByRole('button',{name:'Search this view',exact:true}).click()
      await page.locator('#planner-search').fill('handover')
      assert.equal(await page.locator('#planner-search').inputValue(),'handover')
      await page.getByRole('button',{name:'Clear search',exact:true}).click()
      await page.keyboard.press('Escape')
      await page.getByRole('button',{name:'Filters',exact:true}).click()
      const completed=page.getByLabel('Show completed and cancelled',{exact:true})
      await completed.check();assert.equal(await completed.isChecked(),true)
      assert.equal(await page.getByRole('button',{name:'Show done',exact:true}).count(),0,'No duplicate toolbar toggle')
      assert.equal(await page.locator('.filter-active-dot').isVisible(),true)
      await page.getByRole('button',{name:'Filters',exact:true}).click()
    }
    if(width===384&&mode==='dark'){
      await page.evaluate(()=>window.__setSyncFixture({statuses:[{source:'tasks',state:'error',count:1947,errorCode:'LIMIT',errorStage:'source-read',message:'Fixture read budget exceeded; partial data remains available.',lastSyncedAt:'2026-11-11T10:00:00Z'},{source:'calendar',state:'error',count:157,errorCode:'LIMIT',errorStage:'source-read',message:'Fixture read budget exceeded.'}]}))
      await page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).click()
      await page.locator('.sync-notice').waitFor()
      assert.equal(await page.locator('.sync-notice').count(),1)
      assert.match(await page.locator('.sync-notice').innerText(),/scan limit reached/)
      assert.doesNotMatch(await page.locator('.sync-notice').innerText(),/1947|authorization|offline/i)
      await page.locator('.sync-notice').getByRole('button',{name:'Details'}).click()
      assert.equal((await surface(page,'.modal-content')).alpha,1,'Dialog information stays solid')
      assert.ok(Math.abs((await surface(page,'.modal')).alpha-.68)<.01,'Dialog uses the common glass shell')
      assert.match(await page.locator('.source-statuses').innerText(),/Fixture read budget exceeded; partial data remains available/)
      assert.match(await page.locator('.source-statuses').innerText(),/Reading sources · LIMIT/)
      await screenshot(page,'sync-details-dark-phone')
      await page.getByRole('button',{name:'Close dialog',exact:true}).click()
    }
    await page.emulateMedia({contrast:'more'})
    assert.equal((await surface(page,'.board-column:has([data-record-id="card-1"])')).alpha,1,'High contrast removes transparency')
    assert.equal(await page.locator('.planner-app').evaluate(element=>getComputedStyle(element,'::before').backdropFilter),'none','High contrast removes wallpaper blur')
    await context.close()
  }
  assert.deepEqual(errors,[])
  console.log('PASS mobile glass: light/dark phone/tablet, shared glass shells with solid information, compact controls, truthful sync details, source stripe, no per-card blur, solid contrast fallback')
}finally{await browser.close()}
