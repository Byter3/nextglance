/** Isolated visual fixture for comparison with the approved November timeline mockup.
 * No live account, credentials or remote writes are used by this script. */
import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState} from '@nextspace/core/planner.mjs'

const state=createEmptyState()
state.mode='live'
state.connection={connected:true,username:'JD',serverUrl:'https://fixture.invalid'}
state.theme={name:'Nextspace',color:'#04455a',textColor:'#ffffff',backgroundColor:'#04455a',mode:'light',light:{surfaceColor:'#ffffff',textColor:'#222222',mutedColor:'#626b75',hoverColor:'#f5f7f8',borderColor:'#e8ecef',primaryColor:'#04455a',primaryTextColor:'#ffffff',primaryLightColor:'#e5f2f5',primaryLightTextColor:'#04455a'}}
state.workspace.name='Approved design fixture'
state.workspace.planner.showCompleted=true
state.workspace.planner.assignment='me'
const stacks=[{id:'todo',title:'To do'},{id:'planned',title:'Planned'},{id:'progress',title:'In progress'},{id:'done',title:'Done'}]
state.collections=[
  {id:'calendar-work',source:'calendar',title:'Freelance calendar',color:'#2b90ff',readonly:false},
  {id:'calendar-shared',source:'calendar',title:'Shared calendar',color:'#8256ff',readonly:false},
  {id:'tasks-work',source:'tasks',title:'Freelance tasks',readonly:false},
  {id:'tasks-personal',source:'tasks',title:'Personal tasks',readonly:false},
  {id:'tasks-shared',source:'tasks',title:'Shared tasks',readonly:false},
  {id:'deck-work',source:'deck',title:'Freelance board',stacks,readonly:false},
  {id:'deck-personal',source:'deck',title:'Personal board',stacks,readonly:false},
  {id:'deck-shared',source:'deck',title:'Shared board',stacks,readonly:false},
  {id:'notes',source:'notes',title:'Notes',readonly:false},
]
const item=(id,title,kind,collectionId,extra={})=>({id,title,kind,source:kind==='card'?'deck':kind==='task'?'tasks':kind==='event'?'calendar':'notes',collectionId,collectionTitle:state.collections.find(collection=>collection.id===collectionId).title,readonly:false,completed:false,etag:'fixture-only',url:`https://fixture.invalid/item/${id}`,...(kind==='card'?{stackId:'todo',status:'To do',assigneeIds:['JD'],assignmentCount:1,assignmentKnown:true}:{}),...extra})
state.records=[
  item('brief','Prepare the brief','task','tasks-work',{start:'2026-11-02',due:'2026-11-03T12:00:00+01:00',completed:true,status:'COMPLETED'}),
  item('opening','Edit the opening sequence','card','deck-work',{start:'2026-11-03T16:00:00+01:00',due:'2026-11-05',stackId:'progress',status:'In progress'}),
  item('revisions','Review revisions','card','deck-work',{start:'2026-11-06',due:'2026-11-08',stackId:'planned',status:'Planned'}),
  item('delivery','Deliver final cut','card','deck-work',{due:'2026-11-09',stackId:'planned',status:'Planned'}),
  item('service','Book annual service','task','tasks-personal',{due:'2026-11-04',status:'NEEDS-ACTION'}),
  item('budget','Review monthly budget','card','deck-personal',{start:'2026-11-05',due:'2026-11-06',stackId:'planned',status:'Planned'}),
  item('references','Collect reference material','task','tasks-personal',{status:'NEEDS-ACTION'}),
  item('trip','Plan the trip','card','deck-shared',{start:'2026-11-07',due:'2026-11-09',stackId:'progress',status:'In progress'}),
  item('equipment','Pack equipment','task','tasks-shared',{due:'2026-11-10',status:'NEEDS-ACTION'}),
  item('edit-session','Opening edit session','event','calendar-work',{start:'2026-11-04T10:00:00+01:00',end:'2026-11-04T12:00:00+01:00',busy:true}),
  item('client-review','Client review','event','calendar-work',{start:'2026-11-06',end:'2026-11-09',allDay:true,busy:true}),
  item('shared-trip','Shared trip','event','calendar-shared',{start:'2026-11-10',end:'2026-11-12',allDay:true,busy:true}),
  item('client-brief','Client brief','note','notes',{body:'# Client brief\n\nThe approved film direction, reference shots and delivery notes.'}),
]
state.workspace.spaces=[
  {id:'work',name:'Freelance',color:'#2b90ff',collectionIds:['tasks-work','deck-work','calendar-work'],defaultCalendarId:'calendar-work',defaultTaskListId:'tasks-work',defaultBoardId:'deck-work'},
  {id:'personal',name:'Personal',color:'#24a34b',collectionIds:['tasks-personal','deck-personal']},
  {id:'shared',name:'Shared',color:'#8256ff',collectionIds:['tasks-shared','deck-shared','calendar-shared'],defaultCalendarId:'calendar-shared'},
]
state.workspace.projects=[{id:'film',spaceId:'work',name:'Client film',collectionIds:['tasks-work','deck-work'],recordIds:[]}]
state.workspace.relations=[
  {id:'opening-after-brief',type:'depends_on',fromId:'opening',toId:'brief'},
  {id:'revisions-after-opening',type:'depends_on',fromId:'revisions',toId:'opening'},
  {id:'opening-calendar',type:'scheduled_during',fromId:'opening',toId:'edit-session'},
  {id:'opening-brief',type:'reference',fromId:'opening',toId:'client-brief'},
]
state.statuses=['tasks','calendar','deck','notes','collectives'].map(source=>({source,state:'connected',count:state.records.filter(record=>record.source===source).length,lastSyncedAt:'2026-11-02T09:00:00Z'}))
state.storage={syncStatus:'local',localPath:'fixture-only/planner.json'}

await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const errors=[]
try{
  const context=await browser.newContext({viewport:{width:1652,height:952},locale:'en-GB',timezoneId:'Europe/Budapest',colorScheme:'light'})
  const page=await context.newPage()
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(initial=>{
    let state=structuredClone(initial)
    const read=async()=>structuredClone(state)
    const noWrite=async()=>{throw new Error('This visual fixture never writes source data.')}
    window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale fixture revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},openExternal:async()=>{},readPage:async()=>({body:''}),createEvent:noWrite,createLinkedEvent:noWrite,setTaskCompleted:noWrite,setCardCompleted:noWrite,moveCard:noWrite}
  },state)
  await page.goto('http://127.0.0.1:5173')
  await page.getByRole('region',{name:'Timeline',exact:true}).waitFor()
  await page.getByLabel('Choose calendar date').fill('2026-11-02')
  await page.getByLabel('Choose calendar date').dispatchEvent('change')
  await page.getByLabel('Timeline range').selectOption('14')
  await page.screenshot({path:'artifacts/design-qa-overview.png'})
  await page.locator('.timeline-row-label[data-record-id="opening"]').click()
  await page.getByRole('complementary',{name:'Item details'}).getByRole('heading',{name:'Edit the opening sequence',exact:true}).waitFor()
  await page.getByRole('button',{name:'Open linked work session: Opening edit session',exact:true}).waitFor()
  await page.evaluate(()=>document.fonts.ready)
  const alignment=await page.evaluate(()=>{
    const header=[...document.querySelector('.timeline-head-name').children].map(element=>element.getBoundingClientRect())
    const row=[...document.querySelector('.timeline-row-label[data-record-id="opening"]').children].map(element=>element.getBoundingClientRect())
    return header.map((rect,index)=>({left:rect.left,workLeft:row[index].left,width:rect.width,workWidth:row[index].width}))
  })
  for(const cells of alignment){assert.ok(Math.abs(cells.left-cells.workLeft)<1,JSON.stringify(alignment));assert.ok(Math.abs(cells.width-cells.workWidth)<1,JSON.stringify(alignment))}
  assert.equal(await page.locator('.timeline-row-label[data-record-id^="edit-session"]').count(),0)
  assert.equal(await page.locator('.timeline-plot>.timeline-event-band').count(),3)
  assert.equal(await page.locator('.dependency-lines>path').count(),2)
  await page.screenshot({path:'artifacts/design-qa-selected.png'})
  await page.getByRole('button',{name:'Open linked work session: Opening edit session',exact:true}).click()
  await page.getByRole('complementary',{name:'Item details'}).getByRole('heading',{name:'Opening edit session',exact:true}).waitFor()
  await page.screenshot({path:'artifacts/design-qa-event.png'})
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  await page.locator('.timeline-row-label[data-record-id="opening"]').click()
  await page.getByRole('button',{name:'Schedule in calendar',exact:true}).click()
  await page.getByRole('dialog').waitFor()
  await page.screenshot({path:'artifacts/design-qa-schedule.png'})
  const reference=process.env.NEXTGLANCE_DESIGN_REFERENCE||'artifacts/design-reference.png'
  try{
    const images=await Promise.all([reference,'artifacts/design-qa-selected.png'].map(async file=>(await readFile(file)).toString('base64')))
    const comparison=await context.newPage()
    await comparison.setViewportSize({width:1652,height:512})
    await comparison.setContent(`<html><style>*{box-sizing:border-box}body{margin:0;background:#e8edf0;font:14px system-ui;display:grid;grid-template-columns:1fr 1fr;gap:4px}section{min-width:0}h2{font-size:14px;font-weight:600;margin:0;padding:8px 12px}img{width:100%;height:auto;display:block}</style><section><h2>Approved mockup</h2><img src="data:image/png;base64,${images[0]}"></section><section><h2>Implemented interface · isolated fixture data</h2><img src="data:image/png;base64,${images[1]}"></section></html>`)
    await comparison.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())))
    await comparison.screenshot({path:'artifacts/design-qa-comparison.png'})
    await comparison.close()
  }catch(error){if(error.code!=='ENOENT')throw error}
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({ok:true,viewport:'1652x952',screenshots:['design-qa-overview.png','design-qa-selected.png','design-qa-event.png','design-qa-schedule.png'],columnAlignment:alignment},null,2))
  await context.close()
}finally{await browser.close()}
