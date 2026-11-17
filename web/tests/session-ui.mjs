/** Development-server browser test only. No production bundle, account or server. */
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {readFileSync,mkdirSync} from 'node:fs'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {plannerFixture} from '../../tests/fixtures.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const server=await createServer({root,configFile:fileURLToPath(new URL('../vite.config.ts',import.meta.url)),plugins:[{name:'nextcloud-test-shell',configureServer(server){server.middlewares.use('/__host-fixture',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(readFileSync(new URL('./host-fixture.html',import.meta.url),'utf8').replace('./session-ui-entry.ts','/tests/session-ui-entry.ts'))})}}],server:{port:0,strictPort:false,host:'127.0.0.1'},logLevel:'error'})
await server.listen()
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})})
const page=await browser.newPage({viewport:{width:1360,height:900},timezoneId:'UTC'})
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
const fixture=plannerFixture(new Date());fixture.workspace.appearance.mode='dark';fixture.workspace.planner.view='board';fixture.workspace.planner.scopeId='all'
await page.addInitScript(initial=>{
  let state=structuredClone(initial),host={phase:'ready',userId:'fixture-user',appVersion:'0.6.12',sourceUrl:'/source/source.tar.gz'}
  const listeners=new Set(),hostListeners=new Set(),read=async()=>structuredClone(state)
  window.storageWrites=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){window.storageWrites.push(key);return original.call(this,key,value)}
  window.fixtureApi={getState:read,refresh:read,resumeSync:read,syncWorkspace:read,readPage:async()=>({body:''}),openExternal:async()=>{},
    saveWorkspace:async(workspace,revision)=>{state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},subscribeHost:listener=>{hostListeners.add(listener);return()=>hostListeners.delete(listener)},getHostState:()=>({...host}),setOnline:()=>{},dispose:()=>{},
  }
  window.setHost=phase=>{host={...host,phase,message:phase==='expired'?'Session expired fixture':undefined};for(const listener of hostListeners)listener({...host})}
},fixture)
try{
  const base=`http://127.0.0.1:${server.httpServer.address().port}`
  await page.goto(`${base}/__host-fixture`)
  await page.getByRole('tab',{name:'Board',exact:true}).waitFor()
  assert.equal(await page.locator('.nextglance-session-gate').isVisible(),false)
  const host=await page.locator('#host-control').evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderWidth,radius:getComputedStyle(el).borderRadius,font:getComputedStyle(el).fontSize}))
  assert.deepEqual(host,{background:'rgb(240, 202, 105)',border:'3px',radius:'0px',font:'16px'})
  assert.equal(await page.locator('html').getAttribute('data-theme'),null)
  assert.equal(await page.locator('html').getAttribute('style'),null)
  assert.equal(await page.locator('#nextglance-root .topbar-brand').count(),0)
  const rect=await page.locator('.app-topbar').boundingBox();assert.ok(rect.y>=50);assert.ok(rect.y+rect.height<120)
  mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/web-host-desktop.png'})
  for(const view of ['Overview','Calendar','Timeline','Board','List']){
    await page.getByRole('tab',{name:view,exact:true}).click()
    await page.getByRole('tab',{name:view,exact:true,selected:true}).waitFor()
  }
  await page.getByRole('button',{name:'Open navigation',exact:true}).click()
  await page.getByRole('button',{name:/Settings & connection/}).click()
  await page.locator('.settings-connection-actions').waitFor()
  assert.equal(await page.getByRole('button',{name:'Disconnect',exact:true}).count(),0)
  assert.equal(await page.getByRole('group',{name:'Color mode'}).count(),0)
  assert.equal(await page.locator('.manual-login').count(),0)
  await page.getByRole('link',{name:/Download source code/}).waitFor()
  assert.ok(await page.getByText('A connection is required to save changes.',{exact:false}).isVisible())
  await page.getByRole('button',{name:'Close dialog',exact:true}).click()
  await page.setViewportSize({width:430,height:850})
  await page.locator('.view-switcher button').click()
  await page.locator('#nextglance-root .page-selector-menu').waitFor()
  assert.equal(await page.locator('body > .page-selector-menu').count(),0)
  await page.getByRole('menuitemradio',{name:'Calendar',exact:true}).click()
  const phone=await page.locator('.app-topbar').boundingBox();assert.ok(phone.y>=50)
  await page.screenshot({path:'artifacts/web-host-phone.png'})
  await page.evaluate(()=>window.setHost('offline'))
  assert.ok(await page.locator('.planner-app').isVisible())
  await page.getByRole('status').filter({hasText:'Offline · Reconnect to edit'}).waitFor()
  const offlineBox=await page.locator('.nextglance-offline').boundingBox(),rootBox=await page.locator('#nextglance-root').boundingBox()
  assert.ok(offlineBox&&rootBox&&offlineBox.y>=rootBox.y&&offlineBox.y+offlineBox.height<=rootBox.y+rootBox.height&&offlineBox.x>=rootBox.x&&offlineBox.x+offlineBox.width<=rootBox.x+rootBox.width,'offline status remains inside the visible host region')
  await page.getByRole('button',{name:'Open navigation',exact:true}).click()
  assert.ok(await page.getByRole('button',{name:'Create Space',exact:true}).isDisabled())
  await page.evaluate(()=>window.setHost('expired'))
  await page.getByRole('heading',{name:'Your Nextcloud session ended'}).waitFor()
  assert.equal(await page.locator('.planner-app').count(),0)
  assert.equal(await page.locator('.page-selector-menu').count(),0)
  assert.deepEqual(await page.evaluate(()=>window.storageWrites),[])
  assert.deepEqual(errors,[])
  console.log('PASS: shared five views; scoped host styles/theme; session settings; contained mobile dropdown; expiry removes private UI; no private browser writes')
}finally{await browser.close();await server.close()}
