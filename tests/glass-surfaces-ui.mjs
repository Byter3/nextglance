/** Material/geometry checks against isolated synthetic wallpaper and source fixtures. */
import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const output='artifacts/glass-surfaces'
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const errors=[],checks=[]
const url=process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173'
try {
  for(const mode of ['dark','light']) {
    const state=plannerFixture(new Date(2026,10,11,9))
    state.workspace.appearance.mode=mode
    state.workspace.planner.view='board'
    state.workspace.planner.responsibility='all'
    state.collections.find(c=>c.id==='deck-work').color='#3975ce'
    state.collections.find(c=>c.id==='tasks-work').color='#218c6a'
    Object.assign(state.records.find(r=>r.id==='card-mine'),{color:'#9b653a',body:'- [ ] First step\n- [ ] Second step\n- [x] Third step',start:'2026-11-11',due:'2026-11-15'})
    const context=await browser.newContext({viewport:{width:1550,height:1014},colorScheme:mode,timezoneId:'Europe/Budapest'})
    const page=await context.newPage()
    page.on('pageerror',e=>errors.push(e.message))
    await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
    await page.addInitScript(initial=>{
      const state=structuredClone(initial)
      // Deliberately bright, reproducible stress wallpaper: never an application asset.
      const canvas=document.createElement('canvas');canvas.width=1550;canvas.height=1014
      const paint=canvas.getContext('2d'),gradient=paint.createLinearGradient(0,0,0,1014)
      gradient.addColorStop(0,'#134b6d');gradient.addColorStop(.55,'#1f4a64');gradient.addColorStop(1,'#dbae77')
      paint.fillStyle=gradient;paint.fillRect(0,0,1550,1014)
      for(let i=0;i<18;i++){paint.fillStyle=i%3?'#f9d7a8':'#fff7e6';paint.beginPath();paint.arc((i*173)%1550,760+(i*61)%254,18+(i*7)%44,0,Math.PI*2);paint.fill()}
      state.theme={...state.theme,backgroundColor:'#143b55',backgroundDataUrl:canvas.toDataURL('image/png')}
      const read=async()=>structuredClone(state)
      window.__setGlassHighContrast=value=>{state.theme.highContrast=value}
      window.workspaceApi={getState:read,refresh:read,openExternal:async()=>{},readPage:async()=>({body:''}),
        saveWorkspace:async(workspace)=>{state.workspace=structuredClone(workspace);state.revision++;return {workspace:state.workspace,revision:state.revision,storage:state.storage}},
        syncWorkspace:read,
      }
    },state)
    await page.goto(url)
    await page.getByRole('tab',{name:'Board',exact:true}).click()
    await page.locator('.board-card').first().waitFor()
    const computed=await page.evaluate(()=>{
      const css=selector=>{const s=getComputedStyle(document.querySelector(selector));return {background:s.backgroundColor,filter:s.backdropFilter}}
      return {main:css('.app-main'),lane:css('.board-column'),card:css('.board-card'),header:css('.app-topbar'),pseudo:getComputedStyle(document.querySelector('.planner-app'),'::before').backdropFilter,headerImage:getComputedStyle(document.querySelector('.app-topbar')).backgroundImage}
    })
    assert.equal(computed.pseudo,'blur(25px)')
    assert.equal(computed.headerImage,'none','Header must not paint an unblurred wallpaper copy')
    for(const part of ['main','lane','card','header'])assert.equal(computed[part].filter,'none','One shared backdrop, no per-item filters')
    assert.match(computed.main.background,/0\.68/)
    assert.match(computed.lane.background,/0\.38/)
    const card=page.locator('.board-card[data-record-id="card-mine"]')
    assert.equal(await card.evaluate(el=>getComputedStyle(el).borderInlineStartColor),'rgb(57, 117, 206)')
    await page.screenshot({path:`${output}/${mode}-board.png`})
    await card.locator('.board-card-main').click()
    const inspector=page.getByRole('complementary',{name:'Item details'})
    await inspector.waitFor()
    assert.match(await inspector.evaluate(el=>getComputedStyle(el).backgroundColor),/0\.68/)
    assert.match(await page.locator('.inspector-content').evaluate(el=>getComputedStyle(el).backgroundColor),/^rgb\(/,'Inspector information is opaque inside its glass shell')
    await page.screenshot({path:`${output}/${mode}-inspector.png`})
    await page.evaluate(()=>window.scrollTo(0,500))
    assert.equal((await page.locator('.app-topbar').boundingBox()).y,0)
    assert.ok(Math.abs((await inspector.boundingBox()).y-52)<=1,'Docked inspector stays beneath the fixed header (subpixel tolerance)')
    await inspector.getByRole('button',{name:'Close item details'}).click()
    await page.evaluate(()=>window.scrollTo(0,0))
    await page.getByRole('tab',{name:'Overview',exact:true}).click()
    await page.locator('.overview-split').waitFor()
    assert.match(await page.locator('.app-main').evaluate(el=>getComputedStyle(el).backgroundColor),/0\.68/,'Overview uses the same shell as Board')
    await page.screenshot({path:`${output}/${mode}-overview.png`})
    const aligned=await page.evaluate(()=>({timeline:document.querySelector('.grouped-timeline').getBoundingClientRect().x,calendar:document.querySelector('.overview-calendar-pane').getBoundingClientRect().x,split:document.querySelector('.overview-split').getBoundingClientRect().width}))
    assert.ok(Math.abs(aligned.timeline-aligned.calendar)<2,'Split panes retain aligned outer geometry')
    await page.locator('.app-topbar button').first().click()
    await page.locator('.app-sidebar').waitFor({state:'visible'})
    assert.match(await page.locator('.app-sidebar').evaluate(el=>getComputedStyle(el).backgroundColor),/0\.68/)
    assert.match(await page.locator('.spaces-nav').evaluate(el=>getComputedStyle(el).backgroundColor),/^rgb\(/,'Navigation list content stays opaque')
    await page.screenshot({path:`${output}/${mode}-navigation.png`})
    await page.keyboard.press('Escape')
    const mediaSession=await context.newCDPSession(page)
    await mediaSession.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]})
    assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches),true)
    assert.equal(await page.locator('.planner-app').evaluate(el=>getComputedStyle(el,'::before').backdropFilter),'none')
    assert.match(await page.locator('.app-main').evaluate(el=>getComputedStyle(el).backgroundColor),/^rgb\(/)
    await mediaSession.send('Emulation.setEmulatedMedia',{features:[]})
    await mediaSession.detach()
    await page.evaluate(()=>window.__setGlassHighContrast(true))
    await page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).click()
    await page.waitForFunction(()=>document.documentElement.dataset.highContrast==='true')
    assert.equal(await page.locator('.planner-app').evaluate(el=>getComputedStyle(el,'::before').backdropFilter),'none')
    assert.match(await page.locator('.app-main').evaluate(el=>getComputedStyle(el).backgroundColor),/^rgb\(/)
    await page.emulateMedia({forcedColors:'active'})
    assert.equal(await page.locator('.planner-app').evaluate(el=>getComputedStyle(el,'::before').backdropFilter),'none')
    checks.push(`${mode}: consistent glass shells, opaque information panels and source-colored cards, fixed header/sidebar geometry and accessibility fallback`)
    await context.close()
  }
  assert.deepEqual(errors,[])
  await writeFile(`${output}/checks.json`,JSON.stringify({checks,errors},null,2))
  console.log(checks.join('\n'))
} finally {await browser.close()}
