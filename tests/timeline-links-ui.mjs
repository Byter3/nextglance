/** Real browser checks using isolated records and a read-only fixture bridge. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState} from '@nextspace/core/planner.mjs'

const state=createEmptyState()
state.mode='live';state.connection={connected:true,username:'tester',serverUrl:'https://fixture.invalid'}
state.workspace.appearance.mode='dark'
state.collections=[{id:'work',source:'deck',title:'Freelance board',color:'#368bba'},{id:'personal',source:'tasks',title:'Personal tasks',color:'#925ad0'},{id:'calendar',source:'calendar',title:'Personal calendar',color:'#925ad0'}]
const card=(id,title,start,due,extra={})=>({id,title,start,due,kind:'card',source:'deck',collectionId:'work',collectionTitle:'Freelance board',assigneeIds:['tester'],assignmentKnown:true,assignmentCount:1,...extra})
state.records=[card('predecessor','Website move','2026-11-03','2026-11-06'),card('successor','Publish website','2026-11-04','2026-11-07'),card('native-target','Houdini Blueprints','2026-11-05','2026-11-07',{nativeDependencies:['predecessor']}),card('undated','A linked undated card',undefined,undefined,{nativeDependencies:['predecessor']}),{id:'personal-task',title:'Personal task',kind:'task',source:'tasks',collectionId:'personal',due:'2026-11-04'},{id:'meeting',title:'A calendar meeting',kind:'event',source:'calendar',collectionId:'calendar',collectionTitle:'Personal calendar',start:'2026-11-04T10:00:00+01:00',end:'2026-11-04T12:00:00+01:00'}]
state.workspace.spaces=[{id:'freelance',name:'Freelance',collectionIds:['work']},{id:'personal',name:'Personal',collectionIds:['personal','calendar']}]
state.workspace.relations=[{id:'dependency',type:'depends_on',fromId:'successor',toId:'predecessor'}]
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const context=await browser.newContext({viewport:{width:1652,height:1050},timezoneId:'Europe/Budapest'}),page=await context.newPage(),checks=[],errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(state=>{window.workspaceApi={getState:async()=>structuredClone(state),refresh:async()=>structuredClone(state),openExternal:async()=>{},readPage:async()=>({body:''}),saveWorkspace:async(workspace)=>{state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}}}},state)
async function assertFullHoverBand(){
  const band=page.locator('.timeline-event-hover-band[data-event-id="meeting"]')
  await band.waitFor()
  const geometry=await band.evaluate(element=>{const box=element.getBoundingClientRect(),plot=element.parentElement.getBoundingClientRect();return {top:box.top,height:box.height,plotTop:plot.top,plotHeight:plot.height,pointerEvents:getComputedStyle(element).pointerEvents,width:parseFloat(element.style.width)}})
  assert.ok(Math.abs(geometry.top-geometry.plotTop)<1)
  assert.ok(Math.abs(geometry.height-geometry.plotHeight)<1,'Hover band spans all rows and Spaces')
  assert.equal(geometry.pointerEvents,'none','Highlight cannot intercept editing')
  assert.ok(Math.abs(geometry.width-2/24/7*100)<.001,'Highlight retains actual event interval')
}
try{
  await page.goto('http://127.0.0.1:5173')
  await page.locator('.overview-split').waitFor()
  await page.getByLabel('Choose calendar date').fill('2026-11-02');await page.getByLabel('Choose calendar date').dispatchEvent('change')
  await page.locator('.calendar-event[data-record-id="meeting"]').hover()
  await assertFullHoverBand()
  await page.screenshot({path:'artifacts/overview-event-column-hover.png',fullPage:true})
  await page.getByRole('tab',{name:'Overview',exact:true}).hover()
  await page.locator('.timeline-event-hover-band').waitFor({state:'detached'})
  checks.push('Overview event hover temporarily highlights its exact time column across the complete work timeline')

  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  await page.getByLabel('Timeline range').selectOption('7')
  await page.getByRole('tab',{name:'Timeline',exact:true}).hover()
  const endpoints=await page.evaluate(()=>{
    const plot=document.querySelector('.timeline-plot').getBoundingClientRect()
    const bar=id=>document.querySelector(`.timeline-chart-row[data-record-id="${id}"]>.timeline-bar`).getBoundingClientRect()
    const first=bar('predecessor'),last=bar('successor'),native=bar('native-target')
    const geometry=path=>{const start=path.getPointAtLength(0),end=path.getPointAtLength(path.getTotalLength());return {start:[start.x,start.y],end:[end.x,end.y],path:path.getAttribute('d'),arrow:path.getAttribute('marker-end')}}
    return {dependency:geometry(document.querySelector('.dependency-path[data-relation-id="dependency"]')),native:[...document.querySelectorAll('.dependency-path[data-native="true"]')].map(geometry),expected:{start:[first.right-plot.left,first.top+first.height/2-plot.top],end:[last.left-plot.left,last.top+last.height/2-plot.top],nativeEnd:[native.left-plot.left,native.top+native.height/2-plot.top]}}
  })
  const near=(a,b)=>a.every((value,index)=>Math.abs(value-b[index])<1)
  assert.ok(near(endpoints.dependency.start,endpoints.expected.start),'Dependency begins at predecessor end')
  assert.ok(near(endpoints.dependency.end,endpoints.expected.end),'Dependency ends at successor start')
  assert.match(endpoints.dependency.path,/Q/,'Corners are rounded')
  assert.match(endpoints.dependency.arrow,/grouped-dependency-arrow/)
  assert.ok(endpoints.native.some(path=>near(path.start,endpoints.expected.start)&&near(path.end,endpoints.expected.nativeEnd)),'Native Deck dependency runs from prerequisite end to dependent start')
  assert.equal(endpoints.native.length,2,'Undated native dependency remains visible without hover')
  for(const path of endpoints.native){assert.match(path.arrow,/grouped-dependency-arrow/,'Deck dependencies use the same directional arrows');assert.match(path.path,/Q/)}
  assert.equal(await page.locator('.deck-link-path').count(),0,'There is no second undirected Deck-link graph')
  checks.push('All dependencies attach to prerequisite end and dependent start with rounded corners and directional arrows, including native Deck dependencies')
  await page.screenshot({path:'artifacts/timeline-rounded-links.png',fullPage:true})

  await page.locator('.timeline-event-chip[data-event-id="meeting"]').hover()
  await assertFullHoverBand()
  assert.match(await page.locator('.header-band').getAttribute('class'),/hover-band/)
  await page.screenshot({path:'artifacts/timeline-event-column-hover.png',fullPage:true})
  await page.getByRole('tab',{name:'Timeline',exact:true}).hover()
  await page.locator('.timeline-event-hover-band').waitFor({state:'detached'})
  checks.push('Timeline event chip hover highlights the header and full body column, and clears on pointer leave')

  await page.getByLabel('All calendar bands', {exact:true}).uncheck()
  await page.locator('.timeline-event-picker>summary').click()
  await page.locator('.timeline-event-list>button').filter({hasText:'A calendar meeting'}).hover()
  await assertFullHoverBand()
  checks.push('Event-list hover also shows the column while persistent calendar bands are disabled')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){await page.screenshot({path:'artifacts/timeline-links-failure.png',fullPage:true});console.error({checks,errors});throw error}finally{await context.close();await browser.close()}
