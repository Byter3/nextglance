/** Grouped timeline interaction and geometry checks against an isolated fixture bridge. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

await mkdir('artifacts',{recursive:true})
const browser = await chromium.launch({headless:true,channel:'msedge'})
const errors = [], checked = []
const fixture = plannerFixture(new Date(2026,10,2,10))
fixture.workspace.relations.push({id:'timeline-visible-dependency',type:'depends_on',fromId:'card-gig',toId:'task-today'})
fixture.workspace.relations.push({id:'timeline-work-session',type:'scheduled_during',fromId:'card-mine',toId:'event-other'})
fixture.records.find(record=>record.id==='event-other').end=new Date(2026,10,3,12).toISOString()
fixture.records.push({id:'past-event',kind:'event',source:'calendar',collectionId:'calendar-work',title:'Exclusive end before window',start:'2026-11-01',end:'2026-11-02',allDay:true})
fixture.records.find(record=>record.id==='card-mine').stackId='stack-review'
fixture.records.find(record=>record.id==='card-mine').status='Stale status'

async function openFixture(initial,viewport={width:1652,height:952},detailed=true) {
  const context = await browser.newContext({viewport})
  const page = await context.newPage()
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(initial=>{
    const clone=value=>structuredClone(value)
    let state=clone(initial)
    window.__fixtureWrites=[]
    window.workspaceApi={
      getState:async()=>clone(state),refresh:async()=>clone(state),
      saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale test revision');state.workspace=clone(workspace);state.revision++;return {workspace:clone(workspace),revision:state.revision,storage:state.storage}},
      openExternal:async()=>{},readPage:async()=>({body:''}),
    }
  },initial)
  await page.goto('http://127.0.0.1:5173')
  await page.getByRole('region',{name:'Timeline',exact:true}).waitFor()
  if(detailed)await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  await page.getByLabel('Choose calendar date').fill('2026-11-02')
  await page.getByLabel('Choose calendar date').dispatchEvent('change')
  return {context,page}
}
async function assertAlignment(page) {
  const result = await page.evaluate(()=>{
    const labels=[...document.querySelector('.timeline-labels').querySelectorAll(':scope > button')]
    const charts=[...document.querySelectorAll('.timeline-chart-row')]
    return {labels:labels.length,charts:charts.length,mismatches:labels.flatMap((element,index)=>{
      const a=element.getBoundingClientRect(),b=charts[index]?.getBoundingClientRect()
      return !b||Math.abs(a.top-b.top)>.75||Math.abs(a.height-b.height)>.75?[{index,top:a.top,chartTop:b?.top,height:a.height,chartHeight:b?.height}]:[]
    })}
  })
  assert.equal(result.labels,result.charts,'Every group and item needs an aligned chart row')
  assert.deepEqual(result.mismatches,[])
}
async function assertNoPageOverflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal scrolling must stay inside the chart')}
async function openCalendarEvent(page,title){
  const chip=page.getByRole('button',{name:new RegExp(`^Calendar event: ${title}`)})
  if(await chip.count())await chip.click()
  else{
    await page.locator('.timeline-event-picker>summary').click()
    await page.locator('.timeline-event-list>button').filter({hasText:title}).click()
  }
}
async function assertEventBands(page){
  const sizes=await page.evaluate(()=>{
    const plot=document.querySelector('.timeline-plot').getBoundingClientRect()
    return [...document.querySelectorAll('.timeline-plot>.timeline-event-band')].map(element=>({height:element.getBoundingClientRect().height,expected:plot.height,top:element.getBoundingClientRect().top,expectedTop:plot.top,pointerEvents:getComputedStyle(element).pointerEvents}))
  })
  assert.ok(sizes.length>0)
  for(const size of sizes){assert.ok(size.height>0&&size.height<=size.expected+1);assert.ok(size.top>=size.expectedTop-1&&size.top+size.height<=size.expectedTop+size.expected+1);assert.equal(size.pointerEvents,'none')}
  const labels=await page.locator('.timeline-event-chip').evaluateAll(elements=>elements.map(element=>({left:parseFloat(element.style.left),top:parseFloat(element.style.top),width:parseFloat(element.style.width)})))
  for(let index=0;index<labels.length;index++)for(let next=index+1;next<labels.length;next++){
    const a=labels[index],b=labels[next]
    if(a.top===b.top)assert.ok(a.left+a.width<=b.left||b.left+b.width<=a.left,'Header labels in the same lane must not overlap')
  }
}

try {
  const {page,context}=await openFixture(fixture,{width:1652,height:952},false)
  assert.equal(await page.getByRole('tab',{name:'Overview',exact:true}).getAttribute('aria-selected'),'true')
  assert.equal(await page.locator('.timeline-plot>.timeline-event-band').count(),0,'Overview starts without unrelated calendar bands')
  assert.equal(await page.locator('.embedded-calendar .calendar-day-heading').count(),0,'Overview uses the timeline date header for its calendar')
  assert.equal(await page.locator('.embedded-calendar .calendar-day-track').count(),7,'Overview defaults to seven aligned calendar day columns')
  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  await page.getByRole('region',{name:'Timeline',exact:true}).waitFor()
  for(const name of ['Freelance','Personal','Shared','Client film'])await page.getByRole('button',{name:`Collapse ${name}`,exact:true}).waitFor()
  assert.equal(await page.locator('.timeline-group-label').filter({hasText:'Client film'}).evaluate(element=>getComputedStyle(element).getPropertyValue('--depth').trim()),'1')
  assert.equal(await page.locator('.timeline-row-label').filter({hasText:'Edit the opening sequence'}).locator('.timeline-status').innerText(),'Review')
  assert.equal(await page.locator('.timeline-row-label').filter({hasText:'Exclusive end before window'}).count(),0)
  await assertAlignment(page)
  assert.equal(await page.locator('.timeline-row-label[data-record-id^="event-"]').count(),0)
  assert.equal(await page.locator('.timeline-plot>.timeline-event-band').count(),4)
  assert.equal(await page.locator('.timeline-plot>.timeline-event-band[data-event-id="past-event"]').count(),0)
  await assertEventBands(page)
  checked.push('Overview starts focused; detailed Timeline contains work rows, Space/project hierarchy, native statuses and scoped calendar bands')

  const originalCount=await page.locator('.timeline-row-label').count()
  await page.getByRole('button',{name:'Collapse Freelance',exact:true}).click()
  assert.equal(await page.locator('.timeline-row-label').filter({hasText:'Deliver the final cut'}).count(),0)
  assert.ok(await page.locator('.timeline-row-label').count()<originalCount)
  await assertAlignment(page)
  await page.getByRole('button',{name:'Expand Freelance',exact:true}).click()
  assert.equal(await page.locator('.timeline-row-label').count(),originalCount)
  await page.locator('.timeline-scroll').evaluate(element=>{element.scrollTop=140;element.scrollLeft=90})
  await assertAlignment(page)
  await page.locator('.timeline-scroll').evaluate(element=>{element.scrollTop=0;element.scrollLeft=0})
  checked.push('Collapse, expand and scrolling preserve exact list/chart row alignment')

  for(const count of [7,28,14]){
    await page.getByLabel('Timeline range').selectOption(String(count))
    assert.equal(await page.locator('.timeline-days>div').count(),count)
    await assertNoPageOverflow(page)
  }
  const allDay=page.locator('.timeline-plot>.timeline-event-band[data-event-id="event-all-day"]')
  const eventStyle=await allDay.evaluate(element=>({color:element.style.getPropertyValue('--record-color'),width:parseFloat(element.style.width)}))
  assert.equal(eventStyle.color,'#3975ce')
  assert.ok(Math.abs(eventStyle.width-2/14*100)<.01,'All-day event end must remain exclusive')
  const deadlineRow=page.locator('.timeline-chart-row[data-record-id="task-today"]')
  assert.equal(await deadlineRow.locator('.timeline-bar:not(.planned)').count(),0,'Deadline-only task must not acquire a duration')
  const deadline=deadlineRow.locator('.timeline-deadline')
  assert.ok(Math.abs(await deadline.evaluate(element=>parseFloat(element.style.left))-.5/14*100)<.01)
  checked.push('7/14/28-day zoom, native event colors, exclusive all-day ends and honest deadline markers')

  await page.locator('.timeline-row-label').filter({hasText:'Deliver the final cut'}).click()
  await page.getByRole('complementary',{name:'Item details'}).getByRole('heading',{name:'Deliver the final cut',exact:true}).waitFor()
  const dependency=await page.evaluate(()=>{
    const rows=[...document.querySelector('.timeline-labels').querySelectorAll(':scope > button')]
    const before=rows.findIndex(element=>element.textContent.includes('Prepare review notes'))
    const after=rows.findIndex(element=>element.textContent.includes('Deliver the final cut'))
    const path=document.querySelector('.dependency-lines>path')
    return {before,after,path:path?.getAttribute('d'),startY:path?.getPointAtLength(0).y,endY:path?.getPointAtLength(path.getTotalLength()).y}
  })
  assert.ok(dependency.before>=0&&dependency.after>=0)
  assert.equal(dependency.startY,dependency.before*48+24)
  assert.equal(dependency.endY,dependency.after*48+24)
  assert.match(dependency.path||'',/ Q /,'Dependency corners are rounded')
  await assertAlignment(page)
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  await openCalendarEvent(page,'Production days')
  await page.getByRole('complementary',{name:'Item details'}).getByRole('heading',{name:'Production days',exact:true}).waitFor()
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  checked.push('Dependency endpoints align to item rows and calendar labels or overflow entries open the shared inspector')

  await page.locator('.timeline-row-label[data-record-id="card-mine"]').click()
  const sessionLink=page.getByRole('button',{name:'Open linked work session: Another client meeting',exact:true})
  await sessionLink.waitFor()
  const sessionBand=page.locator('.timeline-plot>.timeline-event-band[data-event-id="event-other"]')
  assert.match(await sessionBand.getAttribute('class'),/linked/)
  const sessionWidth=await sessionBand.evaluate(element=>parseFloat(element.style.width))
  assert.ok(Math.abs(sessionWidth-2/24/14*100)<.001,'A two-hour work session must not occupy a whole day')
  await assertAlignment(page)
  await page.screenshot({path:'artifacts/approved-timeline-selected-work.png',fullPage:true})
  await sessionLink.click()
  await page.getByRole('complementary',{name:'Item details'}).getByRole('heading',{name:'Another client meeting',exact:true}).waitFor()
  assert.match(await page.locator('.timeline-row-label[data-record-id="card-mine"]').getAttribute('class'),/connected/)
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  checked.push('Selecting linked work highlights its real calendar band; the intersection chain opens the event and connects its work row')

  await page.locator('.timeline-scroll').evaluate(element=>{element.scrollTop=0;element.scrollLeft=0})
  await page.screenshot({path:'artifacts/grouped-overview.png',fullPage:true})
  await page.setViewportSize({width:430,height:932})
  // Resizing starts the navigation drawer's CSS transition; capture its settled state.
  await page.waitForFunction(()=>document.querySelector('.app-sidebar').getBoundingClientRect().right<=.5)
  await assertNoPageOverflow(page)
  await assertAlignment(page)
  await page.screenshot({path:'artifacts/grouped-overview-narrow.png',fullPage:true})
  checked.push('Narrow layout keeps timeline scrolling inside the view')
  await context.close()

  const fallback=structuredClone(fixture)
  fallback.workspace.spaces=[];fallback.workspace.projects=[]
  const fallbackSession=await openFixture(fallback)
  for(const name of ['Freelance tasks','Freelance board','Client film','Personal tasks','Shared board'])await fallbackSession.page.getByRole('button',{name:`Collapse ${name}`,exact:true}).waitFor()
  assert.equal(await fallbackSession.page.getByRole('button',{name:'Collapse Freelance calendar',exact:true}).count(),0)
  await assertAlignment(fallbackSession.page)
  await fallbackSession.page.screenshot({path:'artifacts/grouped-source-fallback.png',fullPage:true})
  await fallbackSession.context.close()
  checked.push('Unconfigured accounts fall back to real source collections without losing records')

  const crowded=structuredClone(fixture)
  for(let index=0;index<12;index++)crowded.records.push({...crowded.records.find(record=>record.id==='event-other'),id:`crowded-${index}`,title:`Overlapping appointment ${index}`})
  const dense=await openFixture(crowded)
  await assertEventBands(dense.page)
  assert.equal(await dense.page.locator('.timeline-plot>.timeline-event-band').count(),16)
  assert.ok(await dense.page.locator('.timeline-overflow-count').count()>0)
  await dense.page.locator('.timeline-event-picker>summary').click()
  assert.equal(await dense.page.locator('.timeline-event-list>button').count(),16)
  await dense.page.locator('.timeline-event-list>button').filter({hasText:'Overlapping appointment 11'}).click()
  await dense.page.getByRole('complementary',{name:'Item details'}).getByRole('heading',{name:'Overlapping appointment 11',exact:true}).waitFor()
  await dense.context.close()
  checked.push('Overlapping calendar events have collision-free header lanes and remain reachable through the event list')

  const calendarOnly=structuredClone(fixture)
  calendarOnly.records=calendarOnly.records.filter(record=>record.kind==='event')
  calendarOnly.workspace.relations=[];calendarOnly.workspace.plans=[]
  const eventsOnly=await openFixture(calendarOnly)
  assert.equal(await eventsOnly.page.locator('.timeline-row-label').count(),0)
  await eventsOnly.page.getByText('No tasks or cards in this view',{exact:true}).waitFor()
  await assertEventBands(eventsOnly.page)
  await assertAlignment(eventsOnly.page)
  await openCalendarEvent(eventsOnly.page,'Client review')
  await eventsOnly.page.getByRole('complementary',{name:'Item details'}).getByRole('heading',{name:'Client review',exact:true}).waitFor()
  await eventsOnly.context.close()
  checked.push('Calendar-only views retain accessible event labels and an honest empty work table')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({ok:true,checked},null,2))
} finally {await browser.close()}
