/** Source/item presentation and calendar geometry against an isolated bridge. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
import {statusSourceKey,DECK_COMPLETED} from '@nextspace/core/status-mapping.mjs'

const fixture=plannerFixture(new Date(2026,10,16,9))
fixture.workspace.appearance.mode='dark';fixture.workspace.planner.view='board';fixture.workspace.planner.assignment='all'
fixture.workspace.planner.showCompleted=true
fixture.workspace.planner.statusMapping={columns:[{id:'deck-queue',title:'Deck queue',color:'#b47725'},{id:'task-queue',title:'Task queue',color:'#b54bb2'},{id:'finished',title:'Finished',color:'#3eae75'}],assignments:{[statusSourceKey('deck','deck-work','stack-todo')]:'deck-queue',[statusSourceKey('deck','deck-work',DECK_COMPLETED)]:'finished',[statusSourceKey('tasks','tasks-work','NEEDS-ACTION')]:'task-queue'}}
fixture.collections.find(collection=>collection.id==='deck-work').color='#2679c7'
fixture.collections.find(collection=>collection.id==='tasks-work').color='#27936b'
fixture.records.find(record=>record.id==='task-today').color='#6644dd'
const card=fixture.records.find(record=>record.id==='card-mine')
Object.assign(card,{title:'Long checklist card',color:'#e86735',start:'2026-10-25',due:'2026-12-10',body:'- [ ] First step\n- [ ] Second step\n- [ ] Third step\n- [ ] Fourth step\n- [ ] Fifth step'})
const calendar=fixture.collections.find(collection=>collection.source==='calendar')
calendar.color='#27936b'
fixture.records.push(
  {id:'clipped-event',kind:'event',source:'calendar',collectionId:calendar.id,collectionTitle:calendar.title,title:'Earlier multi-day event',color:'#a568d7',start:'2026-11-01',end:'2026-12-06',allDay:true},
  {id:'first-day-event',kind:'event',source:'calendar',collectionId:calendar.id,collectionTitle:calendar.title,title:'First day timed event',color:'#d7a135',start:'2026-11-16T10:00:00+01:00',end:'2026-11-16T12:00:00+01:00',allDay:false},
)
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1680,height:1100},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(15000)
await page.clock.install({time:new Date('2026-11-16T09:00:00+01:00')})
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)?route.continue():route.abort()})
await page.addInitScript(initial=>{
  let state=JSON.parse(sessionStorage.getItem('view-colors-fixture')||'null')||structuredClone(initial)
  const remember=()=>sessionStorage.setItem('view-colors-fixture',JSON.stringify(state))
  const read=async()=>structuredClone(state)
  window.__setFixtureMode=mode=>{state.workspace.appearance.mode=mode;remember()}
  window.workspaceApi={getState:read,refresh:read,syncWorkspace:read,openExternal:async()=>{},readPage:async()=>({body:''}),saveWorkspace:async(workspace,revision)=>{
    if(revision!==state.revision)throw Error('Stale fixture revision')
    state.workspace=structuredClone(workspace);state.revision++;remember()
    return {workspace:structuredClone(state.workspace),revision:state.revision,storage:structuredClone(state.storage)}
  }}
},fixture)
const frame=async()=>{
  let timer
  try{await Promise.race([page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Calendar frame did not settle within 10 seconds')),10000)})])}
  finally{clearTimeout(timer)}
}
const chooseDate=async()=>{await page.getByLabel('Choose calendar date').fill('2026-11-16');await page.getByLabel('Choose calendar date').dispatchEvent('change');await frame()}
const getSource=async locator=>locator.evaluate(element=>({border:getComputedStyle(element).borderLeftColor,item:getComputedStyle(element).getPropertyValue('--record-color').trim()}))
async function sourcePinned(locator,sticky=false){
  await frame()
  const result=await locator.evaluate((element,sticky)=>{
    const marker=element.querySelector('.calendar-source-edge'),view=element.closest('.calendar-all-day-viewport,.calendar-times-scroll'),main=element.closest('.calendar-main')
    const left=Math.max(view.getBoundingClientRect().left,main.getBoundingClientRect().left)+(sticky?view.querySelector('.all-day-gutter,.calendar-hour-labels').getBoundingClientRect().width:0)
    const bounds=marker.getBoundingClientRect(),style=getComputedStyle(marker)
    return {left,marker:bounds.left,width:bounds.width,opacity:style.opacity,color:style.backgroundColor,right:element.getBoundingClientRect().right}
  },sticky)
  assert.equal(result.opacity,'1',`A clipped source edge must stay visible: ${JSON.stringify(result)}`)
  assert.ok(Math.abs(result.marker-result.left)<2.5,`Source stripe must follow the visible leading edge: ${JSON.stringify(result)}`)
  assert.ok(result.width>=2&&result.right>result.left)
  assert.equal(result.color,await locator.evaluate(element=>getComputedStyle(element).borderLeftColor))
}
try{
  await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173')
  for(const mode of ['dark','light']){
    if(mode==='light'){await page.evaluate(()=>window.__setFixtureMode('light'));await page.reload()}
    const tile=page.locator('.board-card[data-record-id="card-mine"]')
    await tile.waitFor();await tile.locator('.board-checklist').waitFor()
    const colors=await tile.evaluate(element=>({border:getComputedStyle(element).borderInlineStartColor,source:getComputedStyle(element.querySelector('.source-color-dot')).backgroundColor,card:getComputedStyle(element).backgroundColor,surface:getComputedStyle(document.querySelector('.app-main')).backgroundColor,header:getComputedStyle(element.querySelector('.board-card-main')).backgroundColor,checklist:getComputedStyle(element.querySelector('.board-checklist')).backgroundColor,item:getComputedStyle(element).getPropertyValue('--item-color').trim()}))
    assert.equal(colors.border,'rgb(38, 121, 199)');assert.equal(colors.border,colors.source)
    assert.equal(colors.item,'#e86735');assert.notEqual(colors.card,colors.surface)
    assert.equal(colors.header,'rgba(0, 0, 0, 0)');assert.equal(colors.checklist,'rgba(0, 0, 0, 0)')
    await tile.locator('.board-checklist-more').click();await frame()
    const body=await tile.boundingBox(),checklist=await tile.locator('.board-checklist').boundingBox()
    assert.ok(body.height>200&&checklist.y+checklist.height<body.y+body.height)
    await page.screenshot({path:`artifacts/nov11-board-colors-${mode}.png`})
  }
  checks.push('Dark and light Board cards keep the original source stripe while item tint covers the entire expanded checklist card')

  for(const [id,columnTitle,mappedColor,sourceColor] of [['card-mine','Deck queue','rgb(180, 119, 37)','rgb(38, 121, 199)'],['task-today','Task queue','rgb(181, 75, 178)','rgb(39, 147, 107)'],['card-complete','Deck queue','rgb(180, 119, 37)','rgb(38, 121, 199)']]){
    await page.locator(`.board-card[data-record-id="${id}"] .board-card-main`).click()
    const details=page.getByRole('complementary',{name:'Item details'})
    const control=details.locator('.detail-properties .inspector-status-control')
    await control.waitFor()
    assert.equal(await control.evaluate(element=>element.title||element.closest('[title]')?.title),`Board column: ${columnTitle}`)
    assert.equal(await control.evaluate(element=>getComputedStyle(element).backgroundColor),mappedColor)
    assert.equal(await details.locator('.mapped-status-swatch').count(),0)
    const source=await details.locator('.inspector-collection i[title="Original source color"]').evaluate(element=>getComputedStyle(element).backgroundColor)
    assert.equal(source,sourceColor);assert.notEqual(source,mappedColor,'Source identity must stay independent of the mapped status')
    if(id==='card-complete')assert.equal(await details.getByLabel('Deck stack',{exact:true}).getAttribute('data-value'),'stack-todo','Completed Deck cards retain their actual native stack in the inspector')
    await details.getByRole('button',{name:'Close item details',exact:true}).click()
  }
  checks.push('Inspector Deck stack and task status controls carry custom mapped colors independently of source identity; completed Deck cards still show their current stack color')

  await page.getByRole('tab',{name:'Calendar',exact:true}).click();await chooseDate()
  const longCard=page.locator('.calendar-view:not(.embedded-calendar) .all-day-event[data-record-id="card-mine"]')
  const longEvent=page.locator('.calendar-view:not(.embedded-calendar) .all-day-event[data-record-id="clipped-event"]')
  assert.ok((await longCard.getAttribute('class')).includes('continues-before'));assert.ok((await longEvent.getAttribute('class')).includes('continues-before'))
  assert.deepEqual(await getSource(longCard),{border:'rgb(38, 121, 199)',item:'#e86735'})
  assert.deepEqual(await getSource(longEvent),{border:'rgb(39, 147, 107)',item:'#a568d7'})
  checks.push('Multi-day cards and events that begin before the current week retain their original source stripe')

  for(const height of [1100,1500,760]){
    await page.setViewportSize({width:1680,height});await frame()
    const layout=await page.locator('.calendar-view:not(.embedded-calendar)').evaluate(element=>{
      const box=element.getBoundingClientRect(),body=element.parentElement.getBoundingClientRect(),main=element.closest('.app-main').getBoundingClientRect(),hours=element.querySelector('.calendar-times-scroll').getBoundingClientRect(),layout=element.querySelector('.calendar-layout').getBoundingClientRect()
      return {bottom:box.bottom,bodyBottom:body.bottom,padding:Number.parseFloat(getComputedStyle(element.parentElement).paddingBottom),mainBottom:main.bottom,hoursBottom:hours.bottom,layoutBottom:layout.bottom,hoursHeight:hours.height,viewport:innerHeight}
    })
    assert.ok(Math.abs(layout.bottom-(layout.bodyBottom-layout.padding))<2,JSON.stringify(layout))
    assert.ok(Math.abs(layout.mainBottom-(height-10))<3,JSON.stringify(layout))
    assert.ok(Math.abs(layout.hoursBottom-layout.layoutBottom)<3,JSON.stringify(layout))
    if(height===1500)assert.ok(layout.hoursHeight>850,'Large windows must not retain the old 660px hour-grid cap')
  }
  await page.screenshot({path:'artifacts/nov11-calendar-full-height.png'})
  checks.push('Calendar fills the available vertical space at short, normal and tall window heights without the old fixed hour-grid cap')
  console.log('Calendar height verified; checking narrow horizontal clipping')

  await page.setViewportSize({width:580,height:1000});await frame()
  const main=page.locator('.calendar-view:not(.embedded-calendar) .calendar-main')
  const overflow=await main.evaluate(element=>element.scrollWidth-element.clientWidth)
  assert.ok(overflow>80,'Narrow layout must provide real horizontal date scrolling')
  const timedEvent=page.locator('.calendar-event[data-record-id="first-day-event"]')
  const cutThroughOffset=await timedEvent.evaluate(element=>{
    const main=element.closest('.calendar-main'),bounds=element.getBoundingClientRect()
    return main.scrollLeft+bounds.left-main.getBoundingClientRect().left+bounds.width/2
  })
  assert.ok(cutThroughOffset>0&&cutThroughOffset<overflow,'The chosen offset must cut through the timed event, leaving a visible remainder')
  await main.evaluate((element,left)=>{element.scrollLeft=left;element.dispatchEvent(new Event('scroll'))},cutThroughOffset);await frame()
  await sourcePinned(longCard);await sourcePinned(longEvent)
  await sourcePinned(timedEvent)
  console.log('Narrow clipped source stripes verified; checking Overview alignment')
  checks.push('Source stripes stay at the visible left edge of all-day and timed items while the narrow Calendar scrolls horizontally')

  await page.setViewportSize({width:1000,height:1100})
  await page.getByRole('tab',{name:'Overview',exact:true}).click();await chooseDate()
  await page.getByRole('button',{name:/^Page options/}).click()
  await page.getByLabel('Timeline range').selectOption('90')
  await page.getByRole('button',{name:'Close page options',exact:true}).click();await frame()
  assert.equal(await page.locator('.overview-date-navigation').count(),0)
  const dates=page.locator('.overview-split .timeline-scroll')
  assert.ok(await dates.evaluate(element=>element.scrollWidth-element.clientWidth)>120)
  await dates.evaluate(element=>{element.scrollLeft+=120;element.dispatchEvent(new Event('scroll'))});await frame()
  await sourcePinned(page.locator('.overview-split .all-day-event[data-record-id="card-mine"]'),true)
  await sourcePinned(page.locator('.overview-split .all-day-event[data-record-id="clipped-event"]'),true)
  const geometry=await page.evaluate(()=>[...document.querySelectorAll('.overview-split .timeline-days>div')].map((element,index)=>({top:element.getBoundingClientRect().left,bottom:document.querySelectorAll('.overview-split .calendar-day-track')[index].getBoundingClientRect().left})))
  assert.ok(geometry.every(item=>Math.abs(item.top-item.bottom)<1.1))
  await page.screenshot({path:'artifacts/nov11-overview-clipped-source-stripes.png'})
  checks.push('Overview source stripes follow the fixed gutter during date scrolling while task/calendar dates remain aligned')
  assert.deepEqual(errors,[])
  const result={passed:checks.length,checks,rendererErrors:errors}
  await writeFile('artifacts/nov11-view-colors-ui-results.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
}finally{await browser.close()}
