/** Native Deck links and unified Overview interactions, with isolated fixture data only. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
import {selectScope} from './ui-navigation.mjs'

const fixture=plannerFixture(new Date(2026,10,2,9))
fixture.workspace.planner.scopeId='all'
fixture.workspace.appearance.mode='light'
fixture.workspace.categories=[{id:'category-production',spaceId:'space-work',name:'Production',color:'#3975ce',collectionIds:['calendar-work','tasks-work','deck-work']}]
fixture.workspace.projects[0].categoryId='category-production'
Object.assign(fixture.records.find(record=>record.id==='card-mine'),{start:'2026-11-02',due:'2026-11-06'})
fixture.records.find(record=>record.id==='card-mine').nativeDependencies=['card-gig','card-native-undated']
const {start:unusedStart,due:unusedDue,...undatedCard}=fixture.records.find(record=>record.id==='card-mine')
fixture.records.push({...undatedCard,id:'card-native-undated',title:'Undated linked Deck card',nativeDependencies:[]})
Object.assign(fixture.records.find(record=>record.id==='event-review'),{start:'2026-11-02T10:00:00+01:00',end:'2026-11-02T11:00:00+01:00'})
fixture.workspace.relations.push({id:'linked-work-fixture',type:'scheduled_during',fromId:'card-mine',toId:'event-review'})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const context=await browser.newContext({viewport:{width:1652,height:1050},timezoneId:'Europe/Budapest'})
const page=await context.newPage(),checks=[],errors=[]
// The fixture's 10:00 review is an upcoming booking at 09:00 on Nov 2.
// Start the browser clock at the fixture date and let it advance normally;
// Vue's event timestamps and zoom throttling require Date.now() to progress.
await page.clock.install({time:new Date('2026-11-02T09:00:00+01:00')})
page.setDefaultTimeout(12000)
page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(initial=>{
  let state=structuredClone(initial)
  window.__fixtureWrites=[]
  const read=async()=>structuredClone(state)
  const blocked=async input=>{window.__fixtureWrites.push({method:'unexpectedSourceWrite',input});throw new Error('This interaction test never writes native sources')}
  window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale fixture revision');window.__fixtureWrites.push({method:'saveWorkspace'});state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(state.workspace),revision:state.revision,storage:state.storage}},openExternal:async()=>{},readPage:async()=>({body:''}),createEvent:blocked,createTask:blocked,createLinkedEvent:blocked}
},fixture)
const split=page.locator('.overview-split')
const timeline=()=>split.locator('.timeline-view')
const calendar=()=>split.locator('.embedded-calendar')
const details=()=>page.getByRole('complementary',{name:'Item details'})
const row=id=>timeline().locator(`.timeline-row-label[data-record-id="${id}"]`)
const event=id=>calendar().locator(`.calendar-event[data-record-id="${id}"]`)
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const settle=()=>page.waitForFunction(()=>!document.querySelector('.saving-indicator'))
const chooseDate=async date=>{await page.getByLabel('Choose calendar date').fill(date);await page.getByLabel('Choose calendar date').dispatchEvent('change')}
async function assertAligned(){await page.waitForFunction(()=>{
  const top=[...document.querySelectorAll('.overview-split .timeline-days>div')],bottom=[...document.querySelectorAll('.overview-split .calendar-day-track')]
  return top.length===bottom.length&&top.every((item,index)=>{const a=item.getBoundingClientRect(),b=bottom[index].getBoundingClientRect();return Math.abs(a.left-b.left)<1.1&&Math.abs(a.width-b.width)<1.1})
},null,{timeout:4000})}
async function clearHover(){await page.getByRole('tab',{name:'Overview',exact:true}).focus();await page.getByRole('tab',{name:'Overview',exact:true}).hover();await page.waitForFunction(()=>!document.querySelector('.overview-split .hover-linked'))}
async function hoverState(){return page.evaluate(()=>({date:document.querySelector('input[aria-label="Choose calendar date"]').value,selected:[...document.querySelectorAll('.overview-split .timeline-row-label.selected,.overview-split .calendar-event.selected')].map(element=>element.dataset.recordId),writes:window.__fixtureWrites.length,top:document.querySelector('.overview-split .timeline-scroll').scrollTop,bottom:document.querySelector('.overview-split .calendar-times-scroll').scrollTop}))}
try{
  await page.goto('http://127.0.0.1:5173')
  await split.waitFor()
  await chooseDate('2026-11-02')
  await settle()
  assert.equal(await page.getByLabel('Workspace scope',{exact:true}).count(),0)
  await row('card-mine').click()
  await details().getByRole('heading',{name:'Edit the opening sequence',exact:true}).waitFor()
  assert.ok(await row('card-mine').locator('.deck-link-badge').isVisible(),'Native links have an immediate work-row affordance')
  assert.match(await row('card-mine').locator('.deck-link-badge').getAttribute('title'),/Deliver the final cut/)
  assert.ok(await timeline().locator('.dependency-path[data-native="true"]').count()>0,'Native Deck dependencies are visible on the work timeline')
  assert.equal(await timeline().locator('.deck-link-path').count(),0,'Deck dependencies use the common arrow renderer')
  assert.equal(await row('card-native-undated').locator('.deck-link-badge').count(),1,'The undated linked card keeps its native link badge')
  const undatedPlot=timeline().locator('.timeline-chart-row[data-record-id="card-native-undated"]')
  assert.match(await undatedPlot.locator('.dependency-context').innerText(),/Unscheduled.*Needed by/)
  assert.equal(await undatedPlot.locator('.timeline-bar,.timeline-deadline').count(),0,'An undated linked card must not acquire fabricated dates')
  const nativeConnection=details().getByRole('region',{name:'Dependencies',exact:true})
  assert.ok(await nativeConnection.isVisible(),'Native Deck dependencies are visible without expanding optional inspector controls')
  assert.equal(await details().getByRole('region',{name:'Linked in Deck',exact:true}).count(),0)
  assert.ok(await nativeConnection.locator('.inspector-linked-row').filter({hasText:'Undated linked Deck card'}).getByRole('button').first().isVisible(),'Undated native dependencies stay usable in the inspector')
  assert.equal(await nativeConnection.getByText('From Deck',{exact:true}).count(),2)
  await nativeConnection.locator('.inspector-linked-row').filter({hasText:'Deliver the final cut'}).getByRole('button').first().click()
  await details().getByRole('heading',{name:'Deliver the final cut',exact:true}).waitFor()
  assert.ok(await details().getByRole('region',{name:'Dependencies',exact:true}).locator('[data-direction="outgoing"] .inspector-linked-row').filter({hasText:'Edit the opening sequence'}).getByRole('button').first().isVisible(),'Work waiting for this Deck card appears in its outgoing column')
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  checks.push('Native Deck dependencies appear in both directions with standard arrows; undated dependencies retain context without fabricated dates')

  await timeline().locator('.timeline-scroll').evaluate(element=>element.scrollTop=0)
  await calendar().locator('.calendar-times-scroll').evaluate(element=>element.scrollTop=8*48)
  // My overview now has separate native-source headings. Put both hover
  // targets in view before measuring; Playwright otherwise scrolls the row
  // into view as part of hover(), which is unrelated to application behavior.
  await row('card-mine').scrollIntoViewIfNeeded()
  await event('event-review').scrollIntoViewIfNeeded()
  await clearHover()
  const beforeHover=await hoverState()
  await row('card-mine').hover()
  await page.waitForFunction(()=>document.querySelector('.calendar-event[data-record-id="event-review"]')?.classList.contains('hover-linked'))
  assert.match(await row('card-gig').getAttribute('class'),/hover-linked/,'Hover also reveals the native linked Deck card')
  assert.deepEqual(await hoverState(),beforeHover,'Hover must not select, navigate, scroll, or save')
  await page.screenshot({path:'artifacts/overview-hover-linked.png',fullPage:true})
  await clearHover()
  assert.equal(await split.locator('.hover-linked').count(),0)
  await event('event-review').hover()
  await page.waitForFunction(()=>document.querySelector('.timeline-row-label[data-record-id="card-mine"]')?.classList.contains('hover-linked'))
  assert.deepEqual(await hoverState(),beforeHover)
  await clearHover()
  await row('card-mine').click()
  await event('event-review').hover()
  await clearHover()
  assert.match(await row('card-mine').getAttribute('class'),/selected/,'Clearing hover must preserve real selection')
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  checks.push('Work and calendar hover reveal linked items in both directions without changing selection, dates, scroll, or saved data')

  await clearHover()
  const agenda=split.locator('.overview-agenda')
  assert.ok(await agenda.isVisible())
  assert.ok(await agenda.locator('.agenda-booking').count()>0)
  assert.ok(await agenda.locator('.agenda-needs-time').count()>0)
  assert.equal(await agenda.locator('.agenda-needs-time').filter({hasText:'Edit the opening sequence'}).count(),0,'Booked work is excluded from Needs time')
  await agenda.locator('.agenda-booking').filter({hasText:'Client review'}).click()
  await details().getByRole('heading',{name:'Client review',exact:true}).waitFor()
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  checks.push('The calendar sidebar provides actionable upcoming bookings and work needing time, without listing already booked work as unscheduled')

  assert.equal(await split.locator('.overview-date-navigation').count(),0,'Overview has no redundant Dates footer')
  const divider=split.getByRole('separator',{name:'Resize timeline and calendar',exact:true})
  assert.equal(await divider.evaluate(element=>element.getBoundingClientRect().height),4,'Overview divider occupies four pixels')
  await divider.focus();await page.keyboard.press('ArrowDown')
  assert.equal(await divider.getAttribute('aria-valuenow'),'55','The thin divider keeps keyboard resizing')
  await page.keyboard.press('Enter')
  await page.getByLabel('Timeline range').selectOption('14')
  await assertAligned()
  const scrollSurface=timeline().locator('.timeline-scroll')
  const surfaceBounds=await scrollSurface.boundingBox(),scrollBeforePan=await scrollSurface.evaluate(element=>element.scrollLeft)
  await page.mouse.move(surfaceBounds.x+surfaceBounds.width*.8,surfaceBounds.y+surfaceBounds.height*.5)
  await page.mouse.wheel(240,0)
  await page.waitForFunction(previous=>Math.abs(document.querySelector('.overview-split .timeline-scroll').scrollLeft-previous)>1,scrollBeforePan)
  await assertAligned()
  const geometryBefore=await timeline().locator('.timeline-days>div').first().evaluate(element=>({width:element.getBoundingClientRect().width,scale:visualViewport.scale}))
  await timeline().locator('.timeline-days>div').nth(4).hover()
  await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control')
  await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Timeline range"]').value)<14)
  await assertAligned()
  assert.equal(await page.evaluate(()=>visualViewport.scale),geometryBefore.scale,'Ctrl+wheel must zoom dates rather than the browser')
  assert.ok(await timeline().locator('.timeline-days>div').first().evaluate(element=>element.getBoundingClientRect().width)>geometryBefore.width)
  await page.getByLabel('Timeline range').selectOption('7')
  checks.push('Overview has a thin keyboard-resizable divider and no Dates footer; horizontal wheel and Ctrl+wheel retain aligned navigation and date zoom')

  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  assert.equal(await page.locator('.timeline-event-chip>small').count(),0,'Timeline header event subtitles are removed')
  const standaloneBefore=await page.locator('.timeline-days>div').first().evaluate(element=>({width:element.getBoundingClientRect().width,scale:visualViewport.scale}))
  const standaloneRange=Number(await page.getByLabel('Timeline range').inputValue())
  await page.locator('.timeline-days>div').nth(3).hover()
  await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control')
  await page.waitForFunction(previous=>Number(document.querySelector('[aria-label="Timeline range"]').value)<previous,standaloneRange)
  assert.equal(await page.evaluate(()=>visualViewport.scale),standaloneBefore.scale)
  checks.push('Standalone Timeline also changes its visible date range with Ctrl+wheel while preserving browser scale')

  for(const view of ['Overview','Calendar','Timeline','Board','List']){
    await page.getByRole('tab',{name:view,exact:true}).click()
    assert.equal(await page.getByLabel('Workspace scope',{exact:true}).count(),0)
    await selectScope(page,'Production',{space:'Freelance',kind:'category'})
    await settle()
    assert.equal((await backend()).workspace.planner.scopeId,'category-production')
    assert.equal((await backend()).workspace.planner.view,'overview','An organizational scope restores its own layout instead of inheriting My overview')
    await selectScope(page,'Client film',{space:'Freelance',kind:'project'})
    await settle()
    assert.equal((await backend()).workspace.planner.scopeId,'project-gig')
    await selectScope(page,'Personal',{kind:'space'})
    await settle()
    assert.equal((await backend()).workspace.planner.scopeId,'space-personal')
    await selectScope(page,'My overview')
    await settle()
    assert.equal((await backend()).workspace.planner.scopeId,'all')
    assert.equal((await backend()).workspace.planner.view,view.toLowerCase(),'My overview restores its selected layout')
  }
  await page.getByRole('tab',{name:'Overview',exact:true}).click()
  await chooseDate('2026-11-02')
  await page.locator('.toast').waitFor({state:'hidden'})
  await page.screenshot({path:'artifacts/overview-interactions-light.png',fullPage:true})
  await page.getByRole('button',{name:'Open navigation',exact:true}).click()
  await page.getByRole('button',{name:'Settings & connection',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Dark',exact:true}).click()
  await page.getByRole('button',{name:'Close dialog',exact:true}).click()
  await settle()
  await page.screenshot({path:'artifacts/overview-interactions-dark.png',fullPage:true})
  await page.setViewportSize({width:430,height:932})
  await assertAligned()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:'artifacts/overview-interactions-narrow.png',fullPage:true})
  assert.equal(await page.evaluate(()=>window.__fixtureWrites.filter(write=>write.method==='unexpectedSourceWrite').length),0)
  assert.deepEqual(errors,[])
  checks.push('All five views use the drawer for overview, Space, category, and project navigation; narrow layouts retain the aligned dates')
  console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){console.error(JSON.stringify({result:'FAIL',checks,errors,error:String(error)},null,2));await page.screenshot({path:'artifacts/overview-interactions-failure.png',fullPage:true});throw error}finally{await context.close();await browser.close()}
