/** WIDGET-03: real shared UI with fictional state and fake native ports; no asset build. */
import assert from 'node:assert/strict'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {normalizeWidgetConfig} from '@nextspace/core/widgets.mjs'
import {scopePreferenceStorageKey} from '@nextspace/core/scope-preferences.mjs'
import {emptyViewPreferences} from '@nextspace/core/view-preferences.mjs'
import {plannerFixture} from '../../tests/fixtures.mjs'

const root=path.resolve(import.meta.dirname,'../..'),errors=[]
const server=await createServer({configFile:path.join(root,'win/vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
let browser
try{
 browser=await chromium.launch({headless:true,channel:'msedge'})
 const context=await browser.newContext({viewport:{width:1600,height:980}}),page=await context.newPage()
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
 const initial=plannerFixture();initial.workspace.planner.view='list';initial.workspace.planner.scopeId='all';initial.workspace.planner.assignment='all';initial.storage.syncStatus='synced'
 await page.addInitScript(({initial,preferences})=>{
  const clone=value=>structuredClone(value);let state=clone(initial),pending=null,listeners=[],claimGate
  const read=async()=>clone(state)
  window.__widgetWrites=[];window.__widgetCreates=[];window.__widgetPreferenceWrites=[];window.__widgetClaims=0
  window.__sendWidget=value=>{if(value.state)state=clone(value.state);pending=value;window.dispatchEvent(new Event('nextspace:widget'))}
  window.__holdWidgetClaim=()=>{claimGate=new Promise(resolve=>window.__releaseWidgetClaim=()=>{claimGate=undefined;resolve()})}
  window.__takeWidget=async()=>{const value=pending;pending=null;if(value){window.__widgetClaims++;if(claimGate)await claimGate}return value}
  window.__widgetBackground=()=>{state.revision++;for(const listener of listeners)listener(clone(state))}
  window.__widgetTasksReadOnly=readonly=>{state.collections=state.collections.map(row=>row.source==='tasks'?{...row,readonly}:row);state.revision++;for(const listener of listeners)listener(clone(state))}
  window.__widgetDenyTasks=()=>{state.records=state.records.filter(row=>row.source!=='tasks');state.collections=state.collections.filter(row=>row.source!=='tasks');state.statuses=state.statuses.map(row=>row.source==='tasks'?{...row,state:'unavailable',permissionDenied:true}:row);state.revision++;return clone(state)}
  window.workspaceApi={getState:read,refresh:read,syncWorkspace:read,openExternal:async()=>{},getViewPreferences:async()=>({preferences:clone(preferences),etag:'fixture'}),saveViewPreferences:async value=>{preferences=clone(value.preferences);window.__widgetPreferenceWrites.push(clone(preferences));return {preferences:clone(preferences),etag:'fixture'}},subscribe:listener=>{listeners.push(listener);return()=>listeners=listeners.filter(value=>value!==listener)},saveWorkspace:async workspace=>{window.__widgetWrites.push(clone(workspace));state.workspace=clone(workspace);state.revision++;return {workspace:clone(workspace),revision:state.revision,storage:clone(state.storage)}},createTask:async value=>{window.__widgetCreates.push(clone(value));const row={...value,id:'new-task',source:'tasks',kind:'task',readonly:false};state.records.push(row);state.createdRecordId=row.id;state.revision++;return clone(state)},createCard:async()=>clone(state),createEvent:async()=>clone(state)}
 },{initial,preferences:emptyViewPreferences()})
 await page.route('**/*',route=>{
  if(route.request().url()===origin+'/src/main.ts')return route.fulfill({contentType:'application/javascript',body:`import {mountNextspace} from ${JSON.stringify('/@fs/'+path.join(root,'packages/ui/src/index.ts').replaceAll('\\','/'))};window.__widgetVm=mountNextspace(window.workspaceApi,'#app',{subscribe:listener=>window.workspaceApi.subscribe(listener),takeWidgetAction:()=>window.__takeWidget()});`})
  return route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort()
 })
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000})
 const search=page.getByRole('textbox',{name:'Search this view',exact:true}),key=scopePreferenceStorageKey(initial.connection)
 const config=extra=>normalizeWidgetConfig({widgetId:1,accountKey:'fixture',page:'list',scopeId:'all',sourceMode:'selected',collectionIds:['tasks-work'],title:'Review tasks',query:'Prepare',...extra})
 const send=async(action,extra={},state)=>{const saved=config(extra);await page.evaluate(value=>window.__sendWidget(value),{action:{widgetId:1,accountKey:'fixture',generation:saved.generation,...action},config:saved,accountKey:'fixture',...(state?{state}:{})})}
 const active=async name=>page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected')
 const launch=async(action,extra={})=>{const claims=await page.evaluate(()=>window.__widgetClaims);await send(action,extra);await page.waitForFunction(count=>window.__widgetClaims>count,claims);await delay(180)}
 const noPseudoSpace=async()=>{assert.equal(await page.locator('.widget-context-notice').count(),0);assert.equal(await page.getByRole('button',{name:'Return to planner',exact:true}).count(),0)}
 const saveQuery=async query=>{await search.fill(query);await delay(850)}
 const preferenceCount=()=>page.evaluate(()=>window.__widgetPreferenceWrites.length)
 const ordinaryCreate=()=>page.getByRole('button',{name:'New item',exact:true}).click()
 const cancel=async()=>{await page.locator('.create-item-form').getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('.create-item-form').waitFor({state:'detached'})}

 await saveQuery('ordinary saved query')
 const writes=await preferenceCount();assert.ok(writes>0)
 await launch({action:'open'})
 assert.equal(await search.inputValue(),'ordinary saved query','widget filters never replace the same page preferences')
 assert.equal(await active('List'),'true');await noPseudoSpace()
 await page.evaluate(()=>window.__widgetBackground());await delay(180)
 assert.equal(await search.inputValue(),'ordinary saved query','background publication preserves ordinary preferences')
 await launch({action:'item',recordId:'task-today'},{query:''})
 await page.locator('.inspector').getByRole('heading',{name:'Prepare review notes',exact:true,level:2}).waitFor()
 assert.equal(await search.inputValue(),'ordinary saved query','exact item details open without clearing ordinary filters')
 assert.equal(await page.locator('.list-row').count(),0,'ordinary list remains filtered independently')
 await page.getByRole('tab',{name:'Board',exact:true}).click()
 assert.equal(await page.locator('.inspector').getByRole('heading',{name:'Prepare review notes',exact:true,level:2}).count(),1,'item selection survives normal page navigation')
 await launch({action:'open'},{scopeId:'space-work'})
 await saveQuery('space-specific query')
 const spaceWrites=await preferenceCount()
 await launch({action:'open'},{scopeId:'all'})
 assert.equal(await search.inputValue(),'ordinary saved query')
 await launch({action:'open'},{scopeId:'space-work'})
 assert.equal(await search.inputValue(),'space-specific query','real Space uses its own saved page filters')
 await noPseudoSpace()
 assert.equal(await preferenceCount(),spaceWrites,'widget navigation does not import or write semantic filters')

 for(const pageName of ['overview','calendar','timeline','board','list']){
  await launch({action:'open'},{page:pageName,scopeId:'all',query:'',sourceMode:'all',collectionIds:[],kinds:pageName==='calendar'?['event']:pageName==='board'?['task','card']:['event','task','card']})
  assert.equal(await active(pageName[0].toUpperCase()+pageName.slice(1)),'true');await noPseudoSpace()
 }
 assert.equal(await search.inputValue(),'ordinary saved query')
 await launch({action:'create',kind:'task'},{query:'',creationDefaults:{task:{collectionId:'tasks-work'}}})
 await page.locator('.create-item-form').waitFor()
 assert.equal(await page.getByLabel('Item type',{exact:true}).inputValue(),'task')
 assert.equal(await page.getByRole('combobox',{name:'Task list',exact:true}).inputValue(),'tasks-work')
 assert.deepEqual(await page.getByRole('combobox',{name:'Task list',exact:true}).locator('option').evaluateAll(rows=>rows.map(row=>row.value)),['','tasks-work'])
 await page.getByLabel('Title',{exact:true}).fill('Draft stays here')
 const claimsBefore=await page.evaluate(()=>window.__widgetClaims)
 await send({action:'open'},{page:'calendar',kinds:['event'],collectionIds:['calendar-work'],title:'Bookings'})
 await delay(180)
 assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Draft stays here')
 assert.equal(await page.evaluate(()=>window.__widgetClaims),claimsBefore,'dirty draft defers claiming the launcher action')
 await cancel(true)
 await page.waitForFunction(()=>document.querySelector('[role=tab][aria-selected=true]')?.textContent?.trim()==='Calendar')
 await noPseudoSpace()
 await ordinaryCreate();await page.locator('.create-item-form').waitFor()
 await page.getByLabel('Item type',{exact:true}).selectOption('task')
 assert.ok((await page.getByRole('combobox',{name:'Task list',exact:true}).locator('option').evaluateAll(rows=>rows.map(row=>row.value))).includes('tasks-personal'),'cancel removes widget destination restrictions')
 await cancel(true)

 await launch({action:'create',kind:'task'},{query:'Prepare',creationDefaults:{task:{collectionId:'tasks-work'}}})
 await page.locator('.create-item-form').waitFor();await page.getByLabel('Title',{exact:true}).fill('Outside widget search')
 await page.locator('.create-item-form').getByRole('button',{name:'Create task',exact:true}).click()
 await page.locator('.inspector').getByRole('heading',{name:'Outside widget search',exact:true,level:2}).waitFor()
 assert.equal(await page.evaluate(()=>window.__widgetCreates.length),1)
 assert.equal(await search.inputValue(),'ordinary saved query')
 await ordinaryCreate();await page.locator('.create-item-form').waitFor()
 assert.ok((await page.getByRole('combobox',{name:'Task list',exact:true}).locator('option').evaluateAll(rows=>rows.map(row=>row.value))).includes('tasks-personal'),'success clears widget composer restrictions')
 await cancel(false)

 await page.evaluate(()=>window.__holdWidgetClaim())
 await launch({action:'open'},{page:'calendar',query:'',kinds:['event'],collectionIds:['calendar-work']})
 await ordinaryCreate();await page.locator('.create-item-form').waitFor()
 await page.getByLabel('Title',{exact:true}).fill('Draft opened during native claim')
 await page.evaluate(()=>window.__releaseWidgetClaim());await delay(180)
 assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Draft opened during native claim','an asynchronously claimed action must not replace a newly dirty composer')
 assert.equal(await active('List'),'true','the interrupted native claim must not navigate behind the draft')
 await cancel(true)
 await page.waitForFunction(()=>document.querySelector('[role=tab][aria-selected=true]')?.textContent?.trim()==='Calendar')
 await noPseudoSpace()

 const today=new Date(),day=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
 await launch({action:'date',date:day},{page:'calendar',calendarLayout:'month',query:'',kinds:['event'],collectionIds:['calendar-work']})
 assert.equal(await page.getByLabel('Choose calendar date',{exact:true}).inputValue(),day)
 assert.equal(await page.locator('.calendar-month').count(),0,'date action opens the normal Calendar day')
 await noPseudoSpace()
 await page.evaluate(()=>window.__widgetTasksReadOnly(true));await delay(150)
 await launch({action:'create',kind:'task'},{query:'',creationDefaults:{task:{collectionId:'tasks-work'}}})
 assert.equal(await page.locator('.create-item-form').count(),0,'cached readonly destinations do not open a writable composer')
 await page.evaluate(()=>window.__widgetTasksReadOnly(false))
 await page.locator('.create-item-form').waitFor()
 assert.equal(await page.getByLabel('Item type',{exact:true}).inputValue(),'task','pending creation wakes after current source access arrives')
 assert.equal(await page.getByRole('combobox',{name:'Task list',exact:true}).inputValue(),'tasks-work')
 await cancel(false)
 await launch({action:'open'},{page:'calendar',query:'',kinds:['event'],collectionIds:['calendar-work']})
 const preferenceAfter=await preferenceCount()
 const denied=await page.evaluate(()=>window.__widgetDenyTasks())
 await send({action:'item',recordId:'task-today'},{query:''},denied);await delay(250)
 assert.equal(await page.locator('.inspector').getByRole('heading',{name:'Prepare review notes',exact:true,level:2}).count(),0,'denied cached task cannot be opened')
 assert.equal(await active('Calendar'),'true','denied action does not navigate')
 assert.match(await page.locator('.error-notice').allTextContents().then(rows=>rows.join(' ')),/no longer visible|unavailable/i)
 assert.equal(await preferenceCount(),preferenceAfter)
 assert.deepEqual(await page.evaluate(()=>window.__widgetWrites),[],'widget routes never save organization')
 const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)
 assert.equal(saved.scopes.all.pages.list.query,'ordinary saved query');assert.equal(saved.scopes['space-work'].pages.list.query,'space-specific query')
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({result:'PASS',checks:['normal routes for all five pages','independent real Space/page filters','no pseudo-Space','hidden exact item and persistent selection','source-scoped creation','dirty launch deferral','interrupted asynchronous claim preserves draft','composer cleanup on cancel/success','readonly creation waits for access','normal date navigation','denial adoption','no semantic filter or organization imports']}))
}catch(reason){
 const page=browser?.contexts()[0]?.pages()[0]
 if(page)console.error(JSON.stringify({fixtureFailure:await page.locator('body').innerText().then(text=>text.slice(-1800)),state:await page.evaluate(()=>{const s=window.__widgetVm?.$?.setupState;return s?{blocked:s.widgetNavigationBlocked,claims:window.__widgetClaims,modal:s.modal,scope:s.settings?.scopeId,view:s.settings?.view,readonly:s.state?.collections?.filter(row=>row.source==='tasks').map(row=>row.readonly)}:null}),errors}))
 throw reason
}finally{await browser?.close();await server.close()}
