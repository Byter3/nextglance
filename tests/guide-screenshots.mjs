/** Actual shared UI screenshots for the practical guide. Fictional records only.
 * Uses Vite development transforms; never builds an app or opens an account.
 * Run from the repository root: node tests/guide-screenshots.mjs
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {defaultStatusMapping,statusSourceKey} from '@nextspace/core/status-mapping.mjs'

const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'docs/images/guide')
const today='2026-06-15',now=new Date(`${today}T09:00:00Z`)
function fixture(stage){
 const state=createEmptyState(),date=day=>`2026-06-${String(15+day).padStart(2,'0')}`
 state.mode='live';state.connection={connected:true,username:'sample-user',serverUrl:'https://cloud.example.test'}
 state.theme={name:'Example Cloud',color:'#0082c9',textColor:'#ffffff'}
 state.collections=[
  {id:'work-calendar',source:'calendar',title:'Work calendar',color:'#3975ce',readonly:false},
  {id:'work-tasks',source:'tasks',title:'Work tasks',color:'#a46abd',readonly:false},
  {id:'work-deck',source:'deck',title:'Work Deck',color:'#268ba3',readonly:false,stacks:[{id:'todo',title:'To do'},{id:'progress',title:'In progress'},{id:'review',title:'Review'}]},
  {id:'home-tasks',source:'tasks',title:'Home tasks',color:'#3d966f',readonly:false},
 ]
 const tag=name=>({id:name==='Project A'?'tag-a':'tag-b',title:name,color:name==='Project A'?'#228c76':'#b76d21'})
 const card=(id,title,status,start,due,project,body)=>({id,title,status,stackId:{'To do':'todo','In progress':'progress',Review:'review'}[status],start:date(start),due:date(due),source:'deck',kind:'card',collectionId:'work-deck',collectionTitle:'Work Deck',assigneeIds:['sample-user'],assignmentCount:1,assignmentKnown:true,completed:false,readonly:false,tags:[project],tagDetails:[tag(project)],body})
 const task=(id,title,start,due,home=false)=>({id,title,start:date(start),due:date(due),source:'tasks',kind:'task',collectionId:home?'home-tasks':'work-tasks',collectionTitle:home?'Home tasks':'Work tasks',status:'NEEDS-ACTION',completed:false,readonly:false,etag:'fictional-task-v1'})
 state.records=[
  card('card-a-design','Design landing page','To do',0,2,'Project A','- [ ] Sketch the layout\n- [ ] Choose typography\n- [ ] Prepare mobile version'),
  card('card-a-form','Build sign-up form','In progress',1,3,'Project A','- [x] Add form fields\n- [ ] Validate input\n- [ ] Show success message'),
  card('card-a-review','Review accessibility','Review',3,4,'Project A','- [x] Check contrast\n- [x] Test keyboard navigation\n- [ ] Review labels'),
  card('card-b-help','Update help center','To do',0,3,'Project B','- [ ] Draft help articles\n- [ ] Review examples'),
  card('card-b-release','Prepare release notes','In progress',2,5,'Project B','- [x] Collect changes\n- [ ] Write release summary'),
  task('task-references','Gather reference images',0,1),task('task-agenda','Confirm review agenda',2,3),
  task('task-home','Book bicycle service',1,3,true),
  {id:'event-design',kind:'event',source:'calendar',title:'Design review',collectionId:'work-calendar',collectionTitle:'Work calendar',start:date(2)+'T14:00:00Z',end:date(2)+'T15:00:00Z',readonly:false,etag:'fictional-event-v1'},
  {id:'event-release',kind:'event',source:'calendar',title:'Release planning',collectionId:'work-calendar',collectionTitle:'Work calendar',start:date(4)+'T10:00:00Z',end:date(4)+'T11:00:00Z',readonly:false,etag:'fictional-event-v1'},
 ]
 state.workspace.name='Example planner';state.workspace.updatedAt=now.toISOString();state.workspace.appearance.mode='light'
 state.workspace.spaces=[{id:'space-work',name:'Work',color:'#3975ce',collectionIds:['work-calendar','work-tasks','work-deck'],defaultCalendarId:'work-calendar',defaultTaskListId:'work-tasks',defaultBoardId:'work-deck'},{id:'space-home',name:'Home',color:'#3d966f',collectionIds:['home-tasks']}]
 const mapping=defaultStatusMapping(state.collections);mapping.columns.splice(2,0,{id:'review',title:'Review',color:'#b18231'})
 for(const [stack,column] of [['todo','todo'],['progress','doing'],['review','review']])mapping.assignments[statusSourceKey('deck','work-deck',stack)]=column
 state.workspace.spaces[0].statusMapping=mapping
 state.workspace.categories=stage===1?[]:[{id:'group-delivery',spaceId:'space-work',name:'Delivery',color:'#3975ce',collectionIds:['work-calendar','work-tasks','work-deck']}]
 state.workspace.projects=stage===3?['A','B'].map(letter=>({id:`project-${letter.toLowerCase()}`,spaceId:'space-work',categoryId:'group-delivery',name:`Project ${letter}`,color:'#3975ce',collectionIds:['work-deck'],recordIds:[],tagNames:[`Project ${letter}`]})):[]
 state.workspace.planner={...state.workspace.planner,scopeId:stage===3?'project-a':'space-work',view:stage===2?'timeline':'board',assignment:'all',scopeAssignments:{'space-work':'all','project-a':'all'}}
 state.statuses=['tasks','calendar','deck','notes','collectives'].map(source=>({source,state:'connected',count:state.records.filter(record=>record.source===source).length,lastSyncedAt:now.toISOString()}))
 state.storage={syncStatus:'synced',lastSyncedAt:now.toISOString(),message:'Planner files are up to date.'}
 return state
}
await mkdir(output,{recursive:true})
const server=await createServer({configFile:path.join(root,'win/vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
let browser
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})})
 for(const stage of [1,2,3]){
  const context=await browser.newContext({viewport:{width:1400,height:stage===1?870:stage===2?680:520},deviceScaleFactor:1,locale:'en-GB',timezoneId:'UTC',colorScheme:'light'})
  await context.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort())
  await context.addInitScript(initial=>{
   let state=structuredClone(initial),preferences={format:'nextspace-view-preferences',version:1,scopes:{}}
   const snapshot=async()=>structuredClone(state)
   window.workspaceApi={getState:snapshot,refresh:snapshot,syncWorkspace:snapshot,readDeckAttachments:async()=>({attachments:[]}),readRelatedResources:async()=>({resources:[]}),
    getViewPreferences:async()=>({preferences:structuredClone(preferences),etag:null}),saveViewPreferences:async input=>{preferences=structuredClone(input.preferences);return{preferences,etag:null}},
    saveWorkspace:async(workspace,revision)=>{assertRevision(revision);state.workspace=structuredClone(workspace);state.revision++;return{workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}}}
   function assertRevision(revision){if(revision!==state.revision)throw new Error('Stale fictional fixture revision')}
  },fixture(stage))
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
  await page.clock.setFixedTime(now);await page.goto(origin);await page.locator('.topbar-scope').waitFor()
  await page.getByRole('tab',{name:stage===2?'Timeline':'Board',exact:true}).click()
  await page.evaluate(()=>document.fonts.ready)
  if(stage!==2)await page.getByRole('combobox',{name:'Board source',exact:true}).selectOption(stage===3?'work-deck':'')
  if(stage===1){
   await page.getByRole('button',{name:'Open navigation',exact:true}).click()
   await page.getByRole('button',{name:'Space actions for Work',exact:true}).click()
   await page.getByRole('menuitem',{name:/Manage Space/}).click()
   const dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Manage Space',exact:true}).waitFor()
   for(const name of ['Include Calendar: Work calendar','Include Task list: Work tasks','Include Deck board: Work Deck'])assert.equal(await dialog.getByRole('checkbox',{name,exact:true}).isChecked(),true)
   assert.equal(await dialog.getByRole('checkbox',{name:'Include Task list: Home tasks',exact:true}).isChecked(),false)
   await page.screenshot({path:path.join(output,'01-space-view.png'),animations:'disabled'})
  }else if(stage===2){
   await page.locator('.timeline-scroll').waitFor();await page.getByRole('combobox',{name:'Timeline range',exact:true}).selectOption('7')
   await page.getByText('Delivery',{exact:true}).filter({visible:true}).first().waitFor()
   assert.equal(await page.locator('.timeline-row-label[data-record-id="task-home"]').count(),0)
   assert.equal(await page.locator('.timeline-row-label[data-record-id]').count(),7)
   assert.equal(await page.getByText('Unmapped',{exact:true}).count(),0)
   await page.screenshot({path:path.join(output,'02-source-group-view.png'),animations:'disabled'})
  }else{
   await page.locator('.board-card[data-record-id="card-a-design"]').waitFor()
   for(const id of ['card-a-design','card-a-form','card-a-review'])assert.equal(await page.locator(`.board-card[data-record-id="${id}"]`).count(),1)
   for(const id of ['card-b-help','card-b-release','task-home','task-references'])assert.equal(await page.locator(`.board-card[data-record-id="${id}"]`).count(),0)
   assert.match(await page.locator('.topbar-scope').innerText(),/Project A/)
   assert.equal(await page.getByRole('combobox',{name:'Board source',exact:true}).inputValue(),'work-deck')
   await page.screenshot({path:path.join(output,'03-project-view.png'),animations:'disabled'})
  }
  assert.deepEqual(errors,[]);await context.close()
 }
 console.log('PASS: three actual UI guide screenshots; fictional Work/Home sources, Delivery source group, Project A tag filter; no live requests or renderer errors.')
}finally{await browser?.close();await server.close()}
