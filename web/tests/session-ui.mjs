/** Development-server browser test only. No production bundle, account or server. */
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {readFileSync,mkdirSync} from 'node:fs'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {plannerFixture} from '../../tests/fixtures.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const server=await createServer({root,configFile:fileURLToPath(new URL('../vite.config.ts',import.meta.url)),plugins:[{name:'nextcloud-test-shell',configureServer(server){server.middlewares.use('/__host-fixture',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(readFileSync(new URL('./host-fixture.html',import.meta.url),'utf8').replace('./session-ui-entry.ts','/tests/session-ui-entry.ts'))})}}],server:{port:0,strictPort:false,host:'127.0.0.1',hmr:false},logLevel:'error'})
await server.listen()
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})})
const page=await browser.newPage({viewport:{width:1360,height:900},timezoneId:'UTC',locale:'en-GB'})
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
const now=new Date('2026-11-23T12:00:00Z'),weekendKey='nextglance:appearance:weekend-mask.v1'
await page.clock.setFixedTime(now)
const fixture=plannerFixture(now);fixture.workspace.appearance.mode='dark';fixture.workspace.planner.view='board';fixture.workspace.planner.scopeId='all'
await page.addInitScript(initial=>{
  let state=structuredClone(initial),host={phase:'ready',userId:'fixture-user',appVersion:'0.6.25',sourceUrl:'/source/source.tar.gz'}
  const listeners=new Set(),hostListeners=new Set(),read=async()=>structuredClone(state)
  window.storageWrites=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){window.storageWrites.push(key);return original.call(this,key,value)}
  window.calendarRequests=[]
  window.fixtureApi={getState:read,refresh:read,resumeSync:read,syncWorkspace:read,readPage:async()=>({body:''}),openExternal:async()=>{},
    readCalendarWindow:async input=>{window.calendarRequests.push(structuredClone(input));return read()},
    saveWorkspace:async(workspace,revision)=>{state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},subscribeHost:listener=>{hostListeners.add(listener);return()=>hostListeners.delete(listener)},getHostState:()=>({...host}),setOnline:()=>{},dispose:()=>{},
  }
  window.setHost=phase=>{host={...host,phase,message:phase==='expired'?'Session expired fixture':undefined};for(const listener of hostListeners)listener({...host})}
},fixture)
async function settings(){
  await page.getByRole('button',{name:'Open navigation',exact:true}).click()
  await page.getByRole('button',{name:/Settings & connection/}).click()
  await page.getByRole('group',{name:'Weekend days',exact:true}).waitFor()
}
async function setCalendarMode(mode){
  const select=page.getByRole('combobox',{name:'Calendar view',exact:true})
  if(!await select.isVisible())await page.getByRole('button',{name:/^Page options/}).click()
  await select.selectOption(mode)
  if(await page.getByRole('button',{name:'Close page options',exact:true}).isVisible())await page.getByRole('button',{name:'Close page options',exact:true}).click()
}
async function assertWeekend(selector,date='2026-11-25',enabled=true){
  const nodes=page.locator(`${selector}[data-date="${date}"]`)
  await nodes.first().waitFor({state:'attached'})
  assert.ok(await nodes.count()>0,`${selector} includes ${date}`)
  for(const classes of await nodes.evaluateAll(elements=>elements.map(el=>el.classList.contains('weekend'))))assert.equal(classes,enabled,`${selector} weekend appearance for ${date}`)
}
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
  await settings()
  await page.locator('.settings-connection-actions').waitFor()
  assert.equal(await page.getByRole('button',{name:'Disconnect',exact:true}).count(),0)
  assert.equal(await page.getByRole('group',{name:'Color mode'}).count(),0)
  assert.equal(await page.getByRole('combobox',{name:'Calendar history',exact:true}).count(),0,'Web history is fetched by navigation, not a native sync preference')
  assert.equal(await page.locator('.manual-login').count(),0)
  await page.getByRole('link',{name:/Download source code/}).waitFor()
  assert.ok(await page.getByText('A connection is required to save changes.',{exact:false}).isVisible())
  // Installed Edge can retain the operating-system Intl locale despite the
  // browser-context language; assert full localized names in Monday-first order.
  const weekdays=await page.evaluate(()=>[1,2,3,4,5,6,0].map(day=>new Intl.DateTimeFormat(undefined,{weekday:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,0,4+day)))))
  const weekendSettings=page.getByRole('group',{name:'Weekend days',exact:true})
  for(const [index,day] of weekdays.entries())assert.equal(await weekendSettings.getByRole('checkbox',{name:day,exact:true}).isChecked(),index>=5)
  for(const day of weekdays)await weekendSettings.getByRole('checkbox',{name:day,exact:true}).setChecked(false)
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),weekendKey),'0','an empty weekend choice is valid')
  await weekendSettings.getByRole('checkbox',{name:weekdays[2],exact:true}).check()
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),weekendKey),'8','stores only the seven-bit appearance scalar')
  assert.ok((await page.evaluate(()=>window.storageWrites)).every(key=>key===weekendKey),'no private storage writes while changing appearance')
  await page.reload()
  await page.getByRole('tab',{name:'Board',exact:true}).waitFor()
  await settings()
  for(const [index,day] of weekdays.entries())assert.equal(await page.getByRole('group',{name:'Weekend days',exact:true}).getByRole('checkbox',{name:day,exact:true}).isChecked(),index===2,'weekend appearance survives a new session mount')
  await page.getByRole('button',{name:'Close dialog',exact:true}).click()
  await page.getByRole('tab',{name:'Calendar',exact:true}).click()
  await setCalendarMode('week')
  for(const selector of ['.calendar-day-heading','.all-day-cell','.calendar-day-track']){
    await assertWeekend(selector)
    await assertWeekend(selector,'2026-11-28',false)
  }
  assert.ok(await page.locator('.calendar-day-heading.today[data-date="2026-11-23"]').count()>0,'Today retains its independent cue')
  const shading=await page.locator('.calendar-day-track.weekend').first().evaluate(el=>({tint:getComputedStyle(el).getPropertyValue('--weekend-tint').trim(),background:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage}))
  assert.ok(shading.tint,'weekend cells receive a scoped tint token')
  const themePaint=await page.evaluate(()=>{
    const root=document.getElementById('nextglance-root'),before=root.getAttribute('style'),result=[]
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1
    const context=canvas.getContext('2d')
    const brightness=(surface,paint)=>{context.clearRect(0,0,1,1);context.fillStyle=surface;context.fillRect(0,0,1,1);context.fillStyle=paint;context.fillRect(0,0,1,1);const values=context.getImageData(0,0,1,1).data;return (values[0]+values[1]+values[2])/3}
    try{
      for(const [theme,surface,text] of [['light','#ffffff','#222222'],['dark','#172127','#e7ecef']]){
        root.style.setProperty('--color-main-background',surface);root.style.setProperty('--color-main-text',text)
        const weekend=getComputedStyle(root.querySelector('.calendar-day-track[data-date="2026-11-25"]')).backgroundColor
        const weekday=getComputedStyle(root.querySelector('.calendar-day-track[data-date="2026-11-28"]')).backgroundColor
        result.push({theme,weekend:brightness(surface,weekend),weekday:brightness(surface,weekday)})
      }
    }finally{if(before===null)root.removeAttribute('style');else root.setAttribute('style',before)}
    return result
  })
  for(const theme of themePaint)assert.ok(theme.weekend>theme.weekday,`${theme.theme} Nextcloud palette renders a lighter weekend column`)
  await setCalendarMode('day')
  await page.getByLabel('Choose calendar date',{exact:true}).fill('2026-11-25')
  await assertWeekend('.calendar-day-track')
  await setCalendarMode('month')
  await assertWeekend('.month-cell')
  await assertWeekend('.month-cell','2026-11-28',false)
  await page.getByRole('tab',{name:'Overview',exact:true}).click()
  await assertWeekend('.timeline-days > div')
  await assertWeekend('.timeline-grid-lines > div')
  await assertWeekend('.calendar-day-track')
  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  await assertWeekend('.timeline-days > div')
  await assertWeekend('.timeline-grid-lines > div')
  await page.getByRole('tab',{name:'Board',exact:true}).click()
  assert.equal(await page.locator('.board-card[data-record-id="task-personal"] .weekend-date').count(),1,'Board shades the date of Wednesday work')
  assert.equal(await page.locator('.board-card[data-record-id="task-undated"] .weekend-date').count(),0,'undated Board cards remain neutral')
  assert.equal(await page.locator('.board-card.weekend').count(),0,'date appearance does not recolor entire cards')
  await page.getByRole('tab',{name:'List',exact:true}).click()
  assert.equal(await page.locator('.list-table-row').filter({hasText:'Book annual service'}).locator('.weekend-date').count(),1,'List shows the same weekday appearance')
  assert.equal(await page.locator('.list-table-row').filter({hasText:'Collect reference material'}).locator('.weekend-date').count(),0)
  assert.deepEqual(await page.locator('#host-control').evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderWidth,radius:getComputedStyle(el).borderRadius,font:getComputedStyle(el).fontSize})),host,'appearance leaves Nextcloud controls untouched')
  assert.equal(await page.locator('#nextcloud-header').evaluate(el=>getComputedStyle(el).getPropertyValue('--weekend-tint').trim()),'','weekend styling does not leak into the Nextcloud shell')

  async function assertRange(from,to,after){
    await page.waitForFunction(({from,to,after})=>window.calendarRequests.length>after&&window.calendarRequests.at(-1).from<=from&&window.calendarRequests.at(-1).to>=to,{from,to,after})
    const requests=await page.evaluate(()=>window.calendarRequests)
    for(const request of requests)assert.ok(Number.isSafeInteger(request.from)&&Number.isSafeInteger(request.to)&&request.to>request.from&&request.to-request.from<=120*86400000,'each navigation request is a bounded instant interval')
    return requests.length
  }
  await page.getByRole('tab',{name:'Calendar',exact:true}).click();await setCalendarMode('day')
  let requests=await page.evaluate(()=>window.calendarRequests.length)
  await page.getByLabel('Choose calendar date',{exact:true}).fill('2001-01-12')
  requests=await assertRange(Date.parse('2001-01-12T00:00:00Z'),Date.parse('2001-01-13T00:00:00Z'),requests)
  await setCalendarMode('week');await page.getByLabel('Choose calendar date',{exact:true}).fill('1999-02-11')
  requests=await assertRange(Date.parse('1999-02-11T00:00:00Z'),Date.parse('1999-02-18T00:00:00Z'),requests)
  await setCalendarMode('month');await page.getByLabel('Choose calendar date',{exact:true}).fill('2001-02-11')
  await page.locator('.month-cell[data-date="2001-02-11"]').waitFor({state:'attached'})
  const monthDates=await page.locator('.month-cell[data-date]').evaluateAll(elements=>elements.map(el=>el.dataset.date).sort())
  requests=await assertRange(Date.parse(monthDates[0]+'T00:00:00Z'),Date.parse(monthDates.at(-1)+'T00:00:00Z')+86400000,requests)
  for(const [view,date] of [['Overview','2003-04-14'],['Timeline','2004-05-15']]){
    await page.getByRole('tab',{name:view,exact:true}).click();await page.getByLabel('Choose calendar date',{exact:true}).fill(date)
    requests=await assertRange(Date.parse(date+'T00:00:00Z'),Date.parse(date+'T00:00:00Z')+7*86400000,requests)
  }
  await page.evaluate(()=>{const input=document.querySelector('input[aria-label="Choose calendar date"]');for(const date of ['1980-01-12','1981-01-12','1982-01-12']){input.value=date;input.dispatchEvent(new Event('change',{bubbles:true}))}})
  const settled=await assertRange(Date.parse('1982-01-12T00:00:00Z'),Date.parse('1982-01-19T00:00:00Z'),requests)
  assert.equal(settled,requests+1,'rapid date selections coalesce into one settled request')
  await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>window.calendarRequests.length),settled,'a stationary page does not keep requesting its range')
  await page.getByRole('tab',{name:'Board',exact:true}).click()
  if(!await page.getByRole('button',{name:'Filters',exact:true}).isVisible())await page.getByRole('button',{name:/^Page options/}).click()
  await page.getByRole('button',{name:'Filters',exact:true}).click()
  assert.equal(await page.getByRole('spinbutton',{name:'Completed items in days',exact:true}).inputValue(),'14')
  await page.getByRole('combobox',{name:'Completed items',exact:true}).selectOption('zero')
  assert.equal(await page.getByRole('spinbutton',{name:'Completed items in days',exact:true}).count(),0)
  await page.getByRole('combobox',{name:'Completed items',exact:true}).selectOption('all')
  await page.getByRole('combobox',{name:'Completed items',exact:true}).selectOption('limited')
  await page.getByRole('spinbutton',{name:'Completed items in days',exact:true}).fill('30')
  await page.getByRole('spinbutton',{name:'Completed items in days',exact:true}).blur()
  assert.equal(await page.evaluate(()=>localStorage.getItem('nextspace-board-completed-days')),'30')
  await page.getByRole('button',{name:'Filters',exact:true}).click()
  if(await page.getByRole('button',{name:'Close page options',exact:true}).isVisible())await page.getByRole('button',{name:'Close page options',exact:true}).click()
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
  assert.ok((await page.evaluate(()=>window.storageWrites)).every(key=>[weekendKey,'nextspace-board-completed-days'].includes(key)),'no private browser writes; only approved presentation scalars are allowed')
  assert.deepEqual((await page.evaluate(()=>Object.keys(localStorage))).sort(),[weekendKey,'nextspace-board-completed-days'].sort())
  assert.deepEqual(errors,[])
  console.log('PASS: five views and Calendar day/week/month; bounded historical navigation and settled requests; Board completion controls; persisted weekend appearance; scoped host styles/theme; session settings; contained mobile dropdown; expiry removes private UI; no private browser writes')
}catch(error){
  console.error('Mounted fixture state:',await page.locator('.weekend-settings').allTextContents())
  console.error('Visible view:',await page.locator('[role="tab"][aria-selected="true"]').allTextContents())
  throw error
}finally{await browser.close();await server.close()}
