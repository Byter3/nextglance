/** Reconnection through the real shared UI; all host operations are isolated fixtures. */
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState,createPlannerWorkspace} from '@nextspace/core/planner.mjs'

const output=path.resolve(import.meta.dirname,'../../artifacts/android-reference')
await mkdir(output,{recursive:true})
const baseUrl=process.env.ANDROID_PREVIEW_URL||'http://127.0.0.1:5174'
const account={connected:false,serverUrl:'https://fixture.invalid',username:'fixture'}
const live={...createEmptyState(),mode:'live',workspace:createPlannerWorkspace(),revision:0,
  connection:{...account,connected:true},nativeOperations:['updateNote','setNoteTags'],
  records:[{id:'note-1',source:'notes',kind:'note',title:'Keep my draft',body:'Saved note content.',collectionId:'notes-1',collectionTitle:'Notes',remote:{category:'Notes'},etag:'n1'}],
  collections:[{id:'notes-1',source:'notes',title:'Notes'}],
  statuses:['tasks','calendar','deck','notes','collectives'].map(source=>({source,state:'connected',count:source==='notes'?1:0})),
  storage:{syncStatus:'synced'},metadata:{ready:true},deviceState:{},
}
const browser=await chromium.launch({headless:true,channel:'msedge'}),errors=[]
async function fixture({native=false,width=384,initial='reconnect'}={}){
  const context=await browser.newContext({viewport:{width,height:900}})
  await context.addInitScript(({live,native,initial})=>{
    let state=structuredClone(live),listener
    if(initial==='reconnect'){state.connection={...state.connection,connected:false,reconnectRequired:true,restoreError:'Authorization unavailable. Reconnect to Nextcloud.'};state.statuses=state.statuses.map(status=>({...status,state:'unavailable'}))}
    if(initial==='unverified')state.connection.connected=false
    if(initial==='clean'){state.connection={connected:false};state.records=[];state.collections=[]}
    const calls=[],snapshot=()=>structuredClone(state)
    window.__calls=calls;window.__snapshot=snapshot;window.__result='cancel'
    window.__emit=()=>listener?.(snapshot())
    window.__expire=()=>{state.connection={...state.connection,connected:false,reconnectRequired:true,restoreError:'Authorization unavailable. Reconnect to Nextcloud.'};state.nativeOperations=[];state.statuses=state.statuses.map(status=>({...status,state:'unavailable'}));listener?.(snapshot())}
    const authorize=()=>{
      if(window.__result==='disconnected'){state.connection={...state.connection,connected:false,reconnectRequired:true};return snapshot()}
      state.connection={connected:false,serverUrl:'https://fixture.invalid',username:'fixture'}
      state.statuses=structuredClone(live.statuses).map(status=>status.source==='calendar'?{...status,state:'error',message:'Fixture calendar unavailable'}:status)
      return snapshot()
    }
    window.__fixture={isNative:native,
      getState:async()=>{calls.push('getState');return snapshot()},
      refresh:async()=>{calls.push('refresh');return snapshot()},syncWorkspace:async()=>snapshot(),
      retryConnection:async()=>{calls.push('retryConnection');return snapshot()},
      beginLogin:async serverUrl=>{calls.push(['beginLogin',serverUrl]);return {flowId:'fixture-flow',loginUrl:'https://fixture.invalid/login'}},
      pollLogin:async()=>{calls.push('pollLogin');return {pending:false,state:authorize()}},
      cancelLogin:async()=>snapshot(),
      selectAccount:async()=>{calls.push('selectAccount');if(window.__result==='cancel')throw new Error('Account selection cancelled.');if(window.__result==='missing')throw new Error('Nextcloud Files is not available. Use browser sign-in.');return authorize()},
      subscribe:fn=>{listener=fn;return()=>{listener=undefined}},openExternal:async()=>{},
      readNote:async({id})=>{const note=state.records.find(record=>record.id===id);return {id,title:note.title,content:note.body,category:'Notes',etag:'n1',readonly:false}},
      updateNote:async()=>{calls.push('updateNote');throw new Error('Fixture save failed; keep the draft')},
      readNoteTags:async()=>({tags:[],availableTags:[]}),
      saveWorkspace:async workspace=>{state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},
    }
  },{live,native,initial})
  await context.route('**/src/adapter.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const createAndroidApi=()=>window.__fixture'}))
  await context.route('**/__nextglance/**',route=>{errors.push('Unexpected live preview request');return route.abort()})
  const page=await context.newPage();page.setDefaultTimeout(10_000);page.on('pageerror',error=>errors.push(error.message))
  await page.goto(baseUrl)
  await page.getByRole('tab',{name:'List',exact:true}).waitFor()
  return {context,page,dialog:page.getByRole('dialog',{name:'Settings and connection',exact:true})}
}
async function noSuccess(page){assert.equal(await page.locator('.toast').filter({hasText:'Connected to Nextcloud'}).count(),0)}
async function shot(page,name){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(output,name+'.png'),fullPage:true})}
try{
  for(const width of [384,900]){
    const {context,page,dialog}=await fixture({native:true,width})
    await dialog.waitFor();assert.equal(await dialog.getByRole('textbox',{name:'Server URL'}).inputValue(),'https://fixture.invalid')
    const buttons=dialog.locator('.settings-section').first().locator('button')
    assert.equal((await buttons.first().textContent()).trim(),'Continue with Nextcloud Files')
    assert.match(await buttons.first().getAttribute('class'),/primary/)
    assert.equal(await dialog.getByRole('button',{name:'Sign in using browser',exact:true}).isEnabled(),true)
    assert.deepEqual((await page.evaluate(()=>window.__calls)).filter(call=>call!=='getState'),[],'Startup must not launch auth or unauthorized refresh')
    assert.equal((await page.evaluate(()=>window.__snapshot().records)).length,1)
    await shot(page,`fixture-native-reconnect-${width}`)
    await dialog.getByRole('button',{name:'Close dialog'}).click()
    const reads=await page.evaluate(()=>window.__calls.filter(call=>call==='getState').length)
    await page.evaluate(()=>{window.__emit();window.dispatchEvent(new Event('focus'))})
    await page.waitForFunction(reads=>window.__calls.filter(call=>call==='getState').length>reads,reads)
    assert.equal(await dialog.count(),0,'Dismissal survives background publication/focus')
    await page.getByRole('button',{name:'Reconnect',exact:true}).click();await dialog.waitFor()
    assert.equal((await page.evaluate(()=>window.__calls)).includes('refresh'),false)
    await dialog.getByRole('button',{name:'Retry saved connection',exact:true}).click()
    assert.equal(await dialog.isVisible(),true);await noSuccess(page)
    for(const result of ['cancel','missing','disconnected']){
      await page.evaluate(result=>window.__result=result,result)
      await dialog.getByRole('button',{name:'Continue with Nextcloud Files',exact:true}).click()
      await dialog.getByRole('alert').waitFor();assert.equal(await dialog.isVisible(),true);await noSuccess(page)
      assert.equal((await page.evaluate(()=>window.__snapshot().records)).length,1)
    }
    await page.evaluate(()=>window.__result='partial')
    await dialog.getByRole('button',{name:'Continue with Nextcloud Files',exact:true}).click()
    await dialog.waitFor({state:'detached'});await page.locator('.source-refresh-warning').waitFor()
    await page.locator('.toast').filter({hasText:'Connected to Nextcloud'}).waitFor()
    await context.close()
  }
  // Browser preview keeps browser-first sign-in and still rejects a resolved disconnected poll.
  {
    const {context,page,dialog}=await fixture()
    await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:'Continue with Nextcloud Files'}).count(),0)
    assert.match(await dialog.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).getAttribute('class'),/primary/)
    await shot(page,'fixture-preview-reconnect-384')
    await page.evaluate(()=>window.__result='disconnected')
    await dialog.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).click()
    await dialog.getByRole('alert').waitFor();await noSuccess(page)
    await page.evaluate(()=>window.__result='partial')
    await dialog.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).click()
    await dialog.waitFor({state:'detached'});await page.locator('.source-refresh-warning').waitFor()
    const begins=(await page.evaluate(()=>window.__calls)).filter(call=>Array.isArray(call)&&call[0]==='beginLogin')
    assert.deepEqual(begins,[['beginLogin','https://fixture.invalid'],['beginLogin','https://fixture.invalid']])
    await context.close()
  }
  for(const initial of ['clean','unverified']){
    const {context,page,dialog}=await fixture({initial})
    if(initial==='clean')await page.getByRole('heading',{name:'Your life has different parts. See how they fit together.'}).waitFor()
    else await page.waitForFunction(()=>window.__calls.includes('refresh'))
    assert.equal(await dialog.count(),0)
    assert.equal((await page.evaluate(()=>window.__calls)).some(call=>call==='selectAccount'||Array.isArray(call)&&call[0]==='beginLogin'),false)
    await context.close()
  }
  // Auth loss must never take the editor away or clear its draft.
  {
    const {context,page,dialog}=await fixture({initial:'connected',width:900})
    await page.getByRole('tab',{name:'List',exact:true}).click()
    await page.locator('.list-table-row').filter({hasText:'Keep my draft'}).click()
    await page.getByRole('button',{name:'Expand note editor',exact:true}).click()
    const editor=page.getByRole('dialog',{name:'Edit note',exact:true})
    await editor.getByRole('textbox',{name:'Note title',exact:true}).fill('Unsaved note title')
    await page.evaluate(()=>window.__expire())
    await page.getByRole('button',{name:'Reconnect',exact:true}).waitFor()
    assert.equal(await dialog.count(),0);assert.equal(await editor.isVisible(),true)
    assert.equal(await editor.getByRole('textbox',{name:'Note title',exact:true}).inputValue(),'Unsaved note title')
    await editor.getByRole('button',{name:'Back to side panel',exact:true}).click()
    // The tablet inspector overlays the main notice. Its global navigation remains reachable.
    await page.getByRole('button',{name:'Open navigation',exact:true}).click()
    await page.getByRole('button',{name:'Settings & connection',exact:true}).click();await dialog.waitFor()
    assert.equal(await page.locator('.note-editor').getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Unsaved note title')
    await dialog.getByRole('button',{name:'Close dialog'}).click()
    assert.equal(await page.locator('.note-editor').getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Unsaved note title')
    await context.close()
  }
  assert.deepEqual(errors,[])
  console.log('PASS reconnect UI: native phone/tablet, preview sign-in, cancellation/unavailable/disconnected results, partial source auth, startup/dismissal/runtime draft guards')
}finally{await browser.close()}
