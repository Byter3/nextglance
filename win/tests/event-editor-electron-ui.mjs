/** EDIT-18: actual Windows Electron controls, isolated fictional profile. No app build. */
import assert from 'node:assert/strict'
import {_electron as electron} from 'playwright'
import {createServer} from 'vite'
import {createRequire} from 'node:module'
import {mkdir,writeFile,rm} from 'node:fs/promises'
import path from 'node:path'
import {plannerFixture} from '../../tests/fixtures.mjs'
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url),runtime=path.join(root,'.runtime/windows-event-editor'),profile=path.join(runtime,`electron-profile-${Date.now()}`)
await mkdir(profile,{recursive:true})
const server=await createServer({configFile:path.join(root,'win/vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
const env={...process.env,NEXTSPACE_DATA_DIR:profile,NEXTSPACE_TEST_MODE:'1',NEXTSPACE_DEV_URL:origin};delete env.ELECTRON_RUN_AS_NODE
let app;const results=[]
try {
 app=await electron.launch({executablePath:require('electron'),args:[path.join(root,'win')],cwd:root,env,timeout:45000})
 const page=await app.firstWindow();page.setDefaultTimeout(15000)
 page.on('dialog',dialog=>dialog.accept())
 await page.waitForFunction(()=>document.readyState==='complete'&&Boolean(document.querySelector('.planner-app')))
 await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort())
 const fixture=plannerFixture();fixture.storage.syncStatus='synced';fixture.workspace.planner.view='list'
 await app.evaluate(({ipcMain},initial)=>{
  globalThis.fixture=initial;globalThis.calls=[]
  for(const method of ['getState','refresh','syncWorkspace','createEvent','createLinkedEvent','updateRecordDates','readDeckAttachments','readRelatedResources','readPage','saveWorkspace','setDeckDependency','getViewPreferences','saveViewPreferences']) {
   ipcMain.removeHandler(`nextspace:${method}`)
   ipcMain.handle(`nextspace:${method}`,(_event,...args)=>{globalThis.calls.push({method,args});if(method==='getViewPreferences')return{preferences:globalThis.preferences||{format:'nextspace-view-preferences',version:1,scopes:{}},etag:null};if(method==='saveViewPreferences'){globalThis.preferences=args[0].preferences;return{preferences:globalThis.preferences,etag:null}}if(method==='readDeckAttachments')return {attachments:[]};if(method==='readRelatedResources')return {resources:[]};if(method==='readPage')return {body:''};if(method==='saveWorkspace') {globalThis.fixture.workspace=args[0];globalThis.fixture.revision++;return {workspace:args[0],revision:globalThis.fixture.revision,storage:globalThis.fixture.storage}}return structuredClone(globalThis.fixture)})
  }
 },fixture)
 await page.reload();await page.locator('.list-table-row').first().waitFor()
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus()})
 for(const size of [{width:1480,height:980},{width:1024,height:768}]) {
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size.width,size.height),size)
  await page.locator('.list-table-row').filter({hasText:'Edit the opening sequence'}).click()
  await page.getByRole('complementary',{name:'Item details'}).getByRole('button',{name:'Schedule in calendar',exact:true}).click()
  const dialog=page.getByRole('dialog'),title=dialog.getByLabel('Event title',{exact:true}),calendar=dialog.getByRole('combobox',{name:'Calendar',exact:true})
  await title.waitFor();const inspect=loc=>loc.evaluate(el=>{const r=el.getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},disabled:el.matches(':disabled'),hitSelf:h===el,hitClass:h?.className,appRegion:getComputedStyle(el).webkitAppRegion,ancestors:Array.from((function*(node){while(node){yield node;node=node.parentElement}})(el)).map(n=>({tag:n.tagName,class:n.className,z:getComputedStyle(n).zIndex,region:getComputedStyle(n).webkitAppRegion}))}})
  const hitTitle=await inspect(title),hitCalendar=await inspect(calendar)
  await title.click();await page.keyboard.press('Control+A');await page.keyboard.type('Fictional native booking')
  await calendar.click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter')
  assert.equal(await title.inputValue(),'Fictional native booking');assert.equal(hitTitle.hitSelf,true);assert.equal(hitCalendar.hitSelf,true);assert.equal(hitTitle.appRegion,'none')
  results.push({size,title:await title.inputValue(),calendar:await calendar.inputValue(),hitTitle,hitCalendar})
  await page.screenshot({path:path.join(runtime,`electron-schedule-${size.width}.png`)})
  await title.fill('Edit the opening sequence')
  await page.getByRole('button',{name:'Close dialog',exact:true}).click()
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1480,980))
 await page.getByRole('tab',{name:'Calendar',exact:true}).click()
 const hide=page.getByRole('button',{name:'Hide unscheduled sidebar',exact:true});if(await hide.isVisible())await hide.click()
 await page.locator('.calendar-times-scroll').evaluate(el=>el.scrollTop=0)
 const point=await page.locator('.calendar-times-scroll').evaluate(el=>{const v=el.getBoundingClientRect();const row=[...el.querySelectorAll('.calendar-day-track')].find(e=>{const b=e.getBoundingClientRect();return b.left>=v.left+60&&b.right<v.right});const r=row.getBoundingClientRect();return{x:r.x+r.width/2,y:v.y+42}})
 await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x,point.y+70,{steps:8});await page.mouse.up()
 const ordinary=page.getByRole('dialog',{name:'New item',exact:true});await ordinary.waitFor()
 const ordinaryTitle=ordinary.getByLabel('Title',{exact:true}),ordinaryCalendar=ordinary.getByLabel('Calendar',{exact:true})
 const hit=await ordinaryTitle.evaluate(el=>{const r=el.getBoundingClientRect();return{hitSelf:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el,region:getComputedStyle(el).webkitAppRegion,disabled:el.matches(':disabled')}})
 await ordinaryTitle.click();await page.keyboard.type('Fictional range booking')
 const before=await ordinaryCalendar.inputValue();await ordinaryCalendar.click()
 await page.screenshot({path:path.join(runtime,'electron-create-dropdown-open.png')})
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter')
 assert.equal(await ordinaryTitle.inputValue(),'Fictional range booking');assert.equal(hit.hitSelf,true);assert.equal(await ordinaryCalendar.inputValue(),'calendar-work')
 results.push({flow:'ordinary create after native pointer range drag with inspector open',title:await ordinaryTitle.inputValue(),calendarBefore:before,calendarAfter:await ordinaryCalendar.inputValue(),hit})
 await page.screenshot({path:path.join(runtime,'electron-create-range.png')})
 console.log('PASS: actual Electron scheduling title/calendar controls at1480/1024 plus ordinary creation after Calendar range drag; native dropdown screenshot saved.');await writeFile(path.join(runtime,'electron-event-probe.json'),JSON.stringify(results,null,2)+'\n')
} finally {if(app){await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())w.destroy()}).catch(()=>{});await app.close().catch(()=>{})};await server.close();const relative=path.relative(runtime,profile);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(profile).startsWith('electron-profile-'))await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200})}
