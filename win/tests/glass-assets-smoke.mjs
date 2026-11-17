/** Visual checks of the shipped Windows frontend assets, using isolated fixture data. */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile, mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {chromium} from 'playwright'
import {plannerFixture} from '../../tests/fixtures.mjs'

const root=path.resolve(import.meta.dirname,'../..'), dist=path.join(root,'win/dist')
const output=path.join(root,'artifacts/windows-glass-build')
await mkdir(output,{recursive:true})
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    const file=path.resolve(dist,pathname==='/'?'index.html':`.${pathname}`)
    if(!file.startsWith(`${dist}${path.sep}`))throw Error('Invalid asset path')
    const bytes=await readFile(file)
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream'})
    res.end(bytes)
  }catch{res.writeHead(404);res.end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin=`http://127.0.0.1:${server.address().port}`
let browser
const reports=[],errors=[]
try{
  browser=await chromium.launch({headless:true,channel:'msedge'})
  for(const mode of ['dark','light']){
    const fixture=plannerFixture(new Date(2026,10,11,9))
    fixture.workspace.appearance.mode=mode;fixture.workspace.planner.view='board'
    fixture.collections.find(item=>item.id==='deck-work').color='#3975ce'
    Object.assign(fixture.records.find(item=>item.id==='card-mine'),{color:'#ac6845',body:'## Opening sequence\n\nKeep the action readable against the bright wallpaper.\n\n- [x] Review references\n- [ ] Finish the opening shot'})
    const context=await browser.newContext({viewport:{width:1680,height:1050},timezoneId:'Europe/Budapest'})
    await context.addInitScript(initial=>{
      const state=structuredClone(initial),canvas=document.createElement('canvas')
      canvas.width=1200;canvas.height=800
      const painter=canvas.getContext('2d'),gradient=painter.createLinearGradient(0,0,1200,800)
      gradient.addColorStop(0,'#ffc58c');gradient.addColorStop(.35,'#f172a4');gradient.addColorStop(.7,'#8bbcf7');gradient.addColorStop(1,'#cef2e3')
      painter.fillStyle=gradient;painter.fillRect(0,0,1200,800)
      state.theme.backgroundDataUrl=canvas.toDataURL('image/png')
      const snapshot=async()=>structuredClone(state)
      window.workspaceApi={getState:snapshot,refresh:snapshot,syncWorkspace:snapshot,openExternal:async()=>{},readPage:async()=>({body:''}),
        saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw Error('Stale fixture revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}}}
    },fixture)
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort())
    const page=await context.newPage();page.setDefaultTimeout(15_000)
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto(origin)
    const card=page.locator('[data-record-id="card-mine"] .board-card-main')
    await card.waitFor();await card.click()
    await page.getByRole('complementary',{name:'Item details'}).waitFor()
    const navigation=page.getByRole('complementary',{name:'Navigation'})
    if(!await navigation.isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click()
    const styles=await page.evaluate(()=>{
      const surface=selector=>{const element=document.querySelector(selector),style=getComputedStyle(element);return {background:style.backgroundColor,backdrop:style.backdropFilter,position:style.position,filter:style.filter,transform:style.transform}}
      const alpha=color=>{const slash=/\/\s*([\d.]+)\s*\)/.exec(color),rgba=/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(color);return color==='transparent'?0:slash?Number(slash[1]):rgba?Number(rgba[1]):1}
      const main=surface('.app-main'),sidebar=surface('.app-sidebar'),inspector=surface('.inspector'),lane=surface('.board-column'),card=surface('.board-card')
      return {theme:document.documentElement.dataset.theme,main,sidebar,inspector,lane,card,panelAlpha:[alpha(sidebar.background),alpha(inspector.background)],laneAlpha:alpha(lane.background),wallpaper:getComputedStyle(document.body).backgroundImage.startsWith('url('),blur:getComputedStyle(document.querySelector('.planner-app'),'::before').backdropFilter,overflow:document.documentElement.scrollWidth>innerWidth+1}
    })
    assert.equal(styles.theme,mode);assert.equal(styles.wallpaper,true)
    assert.equal(styles.overflow,false);assert.ok(styles.panelAlpha.every(value=>value>=.94))
    assert.ok(styles.laneAlpha<styles.panelAlpha[0]);assert.equal(styles.card.backdrop,'none')
    assert.equal(styles.main.filter,'none');assert.equal(styles.main.transform,'none')
    assert.notEqual(styles.blur,'none')
    await page.screenshot({path:path.join(output,`navigation-${mode}.png`),fullPage:true})
    const scrim=page.locator('.sidebar-scrim')
    if(await scrim.isVisible())await scrim.click({position:{x:400,y:100}})
    await page.screenshot({path:path.join(output,`board-${mode}.png`),fullPage:true})
    await page.getByRole('tab',{name:'Calendar',exact:true}).click()
    await page.locator('.calendar-event[data-record-id="event-review"]').waitFor()
    const calendar=await page.evaluate(()=>({eventBlur:[...document.querySelectorAll('.calendar-event,.all-day-event')].map(element=>getComputedStyle(element).backdropFilter),overflow:document.documentElement.scrollWidth>innerWidth+1}))
    assert.ok(calendar.eventBlur.length>0);assert.ok(calendar.eventBlur.every(value=>value==='none'));assert.equal(calendar.overflow,false)
    await page.screenshot({path:path.join(output,`calendar-${mode}.png`),fullPage:true})
    reports.push({mode,styles,calendar})
    await context.close()
  }
  assert.deepEqual(errors,[])
  await writeFile(path.join(output,'styles.json'),JSON.stringify(reports,null,2))
  console.log(JSON.stringify({result:'PASS',checks:['final Windows assets','dark/light bright wallpaper','nearly opaque navigation/details','more transparent Board lanes','cards/events without per-item blur','no filter/transform containing block on main','no root overflow','no renderer errors'],artifacts:path.relative(root,output)},null,2))
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
