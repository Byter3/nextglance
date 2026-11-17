/** FILTER-03: real shared UI/core and document client, isolated browser profiles. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {ViewPreferencesClient} from '@nextspace/nextcloud-client/view-preferences.mjs'
import {scopePreferenceStorageKey} from '@nextspace/core/scope-preferences.mjs'
import {plannerFixture} from './fixtures.mjs'
import {selectScope} from './ui-navigation.mjs'

const root=path.resolve(import.meta.dirname,'..'),artifacts=path.join(root,'.runtime/view-preferences-ui')
await mkdir(artifacts,{recursive:true})
const server=await createServer({configFile:path.join(root,'win/vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
const cloud=new Map(),writes=[],errors=[],checks=[]
function remote(account){
 if(!cloud.has(account))cloud.set(account,{document:null,version:0})
 return new ViewPreferencesClient({
  async readPlannerFile(name){assert.equal(name,'view-preferences.json');const value=cloud.get(account);return {document:structuredClone(value.document),etag:value.document?`"v${value.version}"`:null}},
  async writePlannerFile(name,document,etag){assert.equal(name,'view-preferences.json');const value=cloud.get(account),current=value.document?`"v${value.version}"`:null;if(etag!==current)throw Object.assign(new Error('Fixture precondition failed'),{status:412});value.document=structuredClone(document);value.version++;writes.push({account,document:structuredClone(document)})},
 })
}
async function until(predicate,message){const end=Date.now()+15000;while(Date.now()<end){if(await predicate())return;await delay(40)}assert.fail(message)}
let browser
async function device(username='fixture-user',sessionHost=false){
 const context=await browser.newContext({viewport:{width:1600,height:980}}),page=await context.newPage(),client=remote(username)
 page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
 await page.exposeFunction('__preferenceRead',()=>client.read())
 await page.exposeFunction('__preferenceSave',input=>client.save(input))
 const initial=plannerFixture();initial.workspace.planner.view='overview';initial.storage.syncStatus='synced';initial.connection.username=username
 await page.addInitScript(initial=>{
  const clone=value=>structuredClone(value),full=clone(initial);let state=clone(initial)
  if(localStorage.getItem('fixture-partial-start')==='true'){state.workspace.spaces=[];state.workspace.projects=[];state.workspace.planner.scopeId='space-work'}
  const read=async()=>clone(state)
  window.__releasePartial=()=>{localStorage.removeItem('fixture-partial-start');state=clone(full)}
  window.workspaceApi={getState:read,refresh:read,syncWorkspace:read,openExternal:async()=>{},getViewPreferences:()=>window.__preferenceRead(),saveViewPreferences:input=>window.__preferenceSave(input),saveWorkspace:async workspace=>{state.workspace=clone(workspace);state.revision++;return {workspace:clone(workspace),revision:state.revision,storage:clone(state.storage)}}}
 },initial)
 await page.route('**/*',route=>{
  if(sessionHost&&route.request().url()===origin+'/src/main.ts')return route.fulfill({contentType:'application/javascript',body:`import {mountNextspace} from ${JSON.stringify('/@fs/'+path.join(root,'packages/ui/src/index.ts').replaceAll('\\','/'))};mountNextspace(window.workspaceApi,'#app',{sessionHost:true,nativeConnection:false});`})
  return route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort()
 })
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});await page.locator('.overview-split').waitFor()
 return {context,page,key:scopePreferenceStorageKey(initial.connection)}
}
const search=page=>page.getByRole('textbox',{name:'Search this view',exact:true})
const saved=(scope,view)=>cloud.get('fixture-user')?.document?.scopes[scope]?.pages[view]
async function resume(page){await page.evaluate(()=>window.dispatchEvent(new Event('focus')))}
try{
 browser=await chromium.launch({headless:true,channel:'msedge'})
 const a=await device()
 await search(a.page).fill('overview query')
 await until(()=>saved('all','overview')?.query==='overview query','Overview query not synced')
 await a.page.getByRole('tab',{name:'Board',exact:true}).click()
 assert.equal(await search(a.page).inputValue(),'','Page filters must be independent')
 await search(a.page).fill('board query')
 await a.page.getByRole('button',{name:'Filters',exact:true}).click()
 await a.page.getByLabel('Show completed/cancelled tasks',{exact:true}).check()
 await a.page.getByRole('button',{name:'Filters',exact:true}).click()
 await until(()=>saved('all','board')?.query==='board query'&&saved('all','board')?.showCompleted===true,'Board filters not synced')
 await selectScope(a.page,'Freelance',{kind:'space'})
 await a.page.getByRole('tab',{name:'List',exact:true}).click()
 await search(a.page).fill('space list query')
 await until(()=>saved('space-work','list')?.query==='space list query','Space page not synced')
 checks.push('Device A saves independent My overview/Board/Space List filters through the production document client')

 const writesBeforeFreshDevice=writes.length
 const b=await device()
 await until(async()=>await search(b.page).inputValue()==='overview query','Device B did not download My overview filters')
 assert.equal(writes.length,writesBeforeFreshDevice,'A fresh device must read shared filters without uploading defaults')
 await b.page.getByRole('tab',{name:'Board',exact:true}).click()
 assert.equal(await search(b.page).inputValue(),'board query')
 await b.page.getByRole('button',{name:'Filters',exact:true}).click()
 assert.equal(await b.page.getByLabel('Show completed/cancelled tasks',{exact:true}).isChecked(),true)
 await b.page.getByRole('button',{name:'Filters',exact:true}).click()
 await selectScope(b.page,'Freelance',{kind:'space'})
 await b.page.getByRole('tab',{name:'List',exact:true}).click()
 assert.equal(await search(b.page).inputValue(),'space list query')
 await search(b.page).fill('space list revised')
 await until(()=>saved('space-work','list')?.query==='space list revised','Device B did not upload changed filters')
 await resume(a.page)
 await until(async()=>await search(a.page).inputValue()==='space list revised','Device A did not apply resumed preference refresh')
 checks.push('Isolated Device B downloads all scopes/pages; its edit returns to Device A on resume')

 await a.page.evaluate(()=>localStorage.setItem('fixture-partial-start','true'))
 await a.page.reload({waitUntil:'domcontentloaded'});await search(a.page).waitFor()
 assert.equal(await a.page.evaluate(key=>JSON.parse(localStorage.getItem(key)).scopes['space-work'].pages.list.query,a.key),'space list revised','Partial startup cannot delete remembered Space filters')
 await a.page.evaluate(()=>window.__releasePartial())
 await a.page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).click()
 await selectScope(a.page,'Freelance',{kind:'space'})
 await a.page.getByRole('tab',{name:'List',exact:true}).click()
 assert.equal(await search(a.page).inputValue(),'space list revised')
 checks.push('Incomplete cold-start Space inventory preserves filters; full native snapshot restores their use')

 const other=await device('other-fixture-user')
 await delay(750)
 assert.equal(await search(other.page).inputValue(),'','Different account must not receive the first account filters')
 assert.notEqual(other.key,a.key)
 assert.equal(cloud.get('other-fixture-user').document,null,'Viewing an untouched account must not upload default filters')
 for(const write of writes)for(const entry of Object.values(write.document.scopes)){
  assert.deepEqual(Object.keys(entry),['pages'])
  for(const page of Object.values(entry.pages))assert.equal(Object.keys(page).some(key=>/width|height|scroll|calendarMode|view$|groupTasks/i.test(key)),false,'Presentation geometry must not enter the cloud document')
 }
 checks.push('Account isolation and cloud/presentation separation hold')
 const web=await device('fixture-user',true)
 await until(async()=>await search(web.page).inputValue()==='overview query','Web session did not load shared filters')
 const beforeOffline=writes.length
 await web.context.setOffline(true);await web.page.evaluate(()=>window.dispatchEvent(new Event('offline')))
 await search(web.page).fill('offline session filter')
 await delay(750)
 assert.equal(writes.length,beforeOffline,'Offline Web edits cannot write preferences')
 await web.context.setOffline(false);await web.page.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'))})
 await until(async()=>await search(web.page).inputValue()==='overview query','Web must restore server filters on reconnect without replaying offline choices')
 assert.equal(writes.length,beforeOffline,'Web reconnection must not replay unsent offline filters')
 assert.equal(await web.page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('nextspace.scope-preferences'))),false,'Session host must not persist private filter cache/outbox')
 checks.push('Web session offline filter edits are not uploaded, replayed on reconnect, or written to local filter storage')
 await a.page.screenshot({path:path.join(artifacts,'space-filters.png')})
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({result:'PASS',checks,writes:writes.length},null,2))
}finally{await browser?.close();await server.close()}
