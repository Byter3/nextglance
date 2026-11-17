/** Current guide findings, exercised without any live account or native writes. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
import {selectScope,openNavigation} from './ui-navigation.mjs'

await mkdir('artifacts',{recursive:true})
const initial=plannerFixture(new Date(2026,10,2,9))
initial.workspace.projects.push({id:'curated',spaceId:'space-work',name:'Curated project',collectionIds:[],recordIds:['task-today']})
initial.records.push({...initial.records.find(r=>r.id==='task-today'),id:'closed-task',title:'Finished task',completed:true,status:'COMPLETED'},{...initial.records.find(r=>r.id==='task-today'),id:'cancelled-task',title:'Cancelled task',completed:false,status:'CANCELLED'})
initial.records.find(r=>r.id==='note-brief').body='# Brief\n\nOriginal text.'
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1536,height:1000},timezoneId:'Europe/Budapest'})
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000)
await page.addInitScript(data=>{
 const clone=x=>structuredClone(x);let state=clone(data)
 window.__failSave=false;window.__partialRefresh=false;window.__writes=[];window.__holdMembership=false;window.__failDescription=false;window.__disconnects=0
 window.workspaceApi={getState:async()=>clone(state),refresh:async()=>{if(window.__partialRefresh)state.statuses.find(s=>s.source==='deck').state='error';return clone(state)},
 saveWorkspace:async(workspace,revision)=>{if(window.__failSave)throw Error('Test disk unavailable');if(window.__holdMembership&&workspace.projects.some(p=>p.recordIds.some(id=>id.startsWith('created-'))))await new Promise(resolve=>window.__releaseMembership=resolve);if(revision!==state.revision)throw Error('Stale fixture');state.workspace=clone(workspace);state.revision++;return {workspace:clone(workspace),revision:state.revision,storage:state.storage}},
 createTask:async input=>{window.__writes.push(input);const id='created-'+window.__writes.length;state.records.push({id,kind:'task',source:'tasks',title:input.title,collectionId:input.collectionId,start:input.start,due:input.due,body:input.description,completed:false,readonly:false});return {...clone(state),createdRecordId:id}},
 createEvent:async input=>{const id='created-event';state.records.push({id,source:'calendar',kind:'event',...input});return{...clone(state),createdRecordId:id}},
 createCard:async()=>clone(state),createNote:async()=>clone(state),updateDescription:async()=>{if(window.__failDescription)throw Error('Description failed');return clone(state)},updateNote:async()=>clone(state),setTaskDue:async()=>clone(state),updateEvent:async()=>clone(state),updateRecordDates:async()=>clone(state),setTaskCompleted:async()=>clone(state),disconnect:async()=>{window.__disconnects++;return clone(state)},cancelLogin:async()=>clone(state),
 createLinkedEvent:async()=>clone(state),openExternal:async()=>{},readPage:async()=>({body:''}),exportWorkspace:async()=>({exported:true}),syncWorkspace:async()=>clone(state)}
},initial)
const details=()=>page.getByRole('complementary',{name:'Item details'})
const dialog=()=>page.getByRole('dialog')
const state=()=>page.evaluate(()=>window.workspaceApi.getState())
const guarded=()=>page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})
const settle=()=>page.waitForTimeout(180)
async function accept(action){page.once('dialog',d=>d.accept());await action()}
async function openListItem(title){await page.getByRole('tab',{name:'List',exact:true}).click();await page.locator('.list-table-row').filter({hasText:title}).first().click()}
try{
 await page.goto('http://127.0.0.1:5173');await page.getByRole('heading',{name:'My overview',exact:true}).waitFor();await settle()
 assert.equal(await guarded(),false)
 await openListItem('Client brief');await details().locator('.description-section').getByRole('button',{name:'Edit',exact:true}).click();await details().getByRole('tab',{name:'Markdown',exact:true}).click();await details().getByLabel('Markdown',{exact:true}).fill('# Unsaved brief')
 assert.equal(await guarded(),true,'Changed description protects window close')
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Close item details'}).click();assert.equal(await details().count(),1,'Keep draft retains inspector')
 await accept(()=>page.getByRole('button',{name:'Close item details'}).click());assert.equal(await details().count(),0)
 await settle();assert.equal(await guarded(),false)
 checks.push('Description drafts protect close and item switches; explicit discard is required')

 await page.getByRole('button',{name:'New item',exact:true}).click();await dialog().getByLabel('Title',{exact:true}).fill('Unfinished capture');assert.equal(await guarded(),true)
 await accept(()=>dialog().getByRole('button',{name:'Cancel',exact:true}).click());assert.equal(await guarded(),false)
 await openNavigation(page);await page.getByRole('button',{name:'Create Space',exact:true}).click();await dialog().getByLabel('Name',{exact:true}).fill('Unsaved Space');assert.equal(await guarded(),true)
 await accept(()=>dialog().getByRole('button',{name:'Cancel',exact:true}).click());await settle();assert.equal(await guarded(),false)
 checks.push('New-item and grouping drafts participate in close protection')

 await selectScope(page,'My overview');await page.getByRole('button',{name:'Filters',exact:true}).click()
 assert.equal(await page.getByText('Spaces in My overview',{exact:true}).count(),0)
 await page.getByText('Visible sources',{exact:true}).click();await page.locator('.filter-popover').getByLabel('Personal tasks',{exact:true}).uncheck()
 await page.getByText('Unassigned exceptions by board',{exact:true}).click();await page.locator('.filter-popover details').filter({has:page.getByText('Unassigned exceptions by board',{exact:true})}).getByLabel('Freelance board',{exact:true}).check()
 await settle();await page.getByRole('button',{name:'Filters',exact:true}).click();assert.ok((await page.getByRole('button',{name:'Filters',exact:true}).getAttribute('class')).includes('active'))
 await page.getByRole('button',{name:'Filters',exact:true}).click();await page.locator('.filter-popover').getByRole('button',{name:'Reset',exact:true}).click();await settle()
 assert.deepEqual((await state()).workspace.planner.excludedSpaceIds,[]);assert.deepEqual((await state()).workspace.planner.hiddenCollectionIds,[]);assert.deepEqual((await state()).workspace.planner.unassignedBoardIds,[])
 await page.getByRole('button',{name:'Filters',exact:true}).click();assert.ok(!(await page.getByRole('button',{name:'Filters',exact:true}).getAttribute('class')).includes('active'))
 checks.push('All filter options reset together and hidden preferences mark Filters active')

 await page.evaluate(()=>window.__failSave=true);await page.getByRole('tab',{name:'Board',exact:true}).click();await page.getByRole('alert').filter({hasText:'Test disk unavailable'}).waitFor();assert.equal(await guarded(),true)
 await page.evaluate(()=>window.__failSave=false);await page.getByRole('button',{name:'Retry save',exact:true}).click();await settle();assert.equal(await guarded(),false)
 checks.push('Failed planner saves block close until Retry save succeeds')

 await selectScope(page,'Curated project',{space:'Freelance',kind:'project'});await page.getByRole('button',{name:'New item',exact:true}).click();await dialog().getByLabel('Title',{exact:true}).fill('Created in curated project');await page.evaluate(()=>window.__holdMembership=true);await dialog().getByRole('button',{name:'Create task',exact:true}).click();await page.waitForFunction(()=>Boolean(window.__releaseMembership));assert.equal(await dialog().getByRole('button',{name:'Creating…',exact:true}).isDisabled(),true);await dialog().locator('form').evaluate(el=>el.requestSubmit());assert.equal(await page.evaluate(()=>window.__writes.length),1,'Slow project save cannot create duplicate native records');await page.evaluate(()=>{window.__holdMembership=false;window.__releaseMembership()});await dialog().waitFor({state:'hidden'});await settle()
 const backend=await state();const created=backend.records.find(r=>r.title==='Created in curated project');assert.ok(created);assert.ok(backend.workspace.projects.find(p=>p.id==='curated').recordIds.includes(created.id))
 await page.getByRole('button',{name:'Close item details'}).click();await page.getByRole('tab',{name:'List',exact:true}).click();await page.locator('.list-table-row').filter({hasText:'Created in curated project'}).waitFor()
 checks.push('Native creation keeps curated project membership and remains visible in its project')

 await selectScope(page,'My overview');await openListItem('Prepare review notes');await details().getByRole('button',{name:'Add dependency',exact:true}).click();const opts=await dialog().locator('.relation-option').allTextContents();assert.ok(!opts.some(v=>v.includes('Client brief')||v.includes('Client review')));assert.ok(opts.some(v=>v.includes('Edit the opening sequence')));await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
 await page.getByRole('button',{name:'Close item details'}).click()
 await page.getByRole('button',{name:'Filters',exact:true}).click();await page.getByLabel('Show completed and cancelled',{exact:true}).check();await page.getByRole('button',{name:'Filters',exact:true}).click()
 await openListItem('Finished task');await details().getByText('Organization & personal planning',{exact:true}).click();assert.equal(await details().getByLabel('Personal planning column',{exact:true}).inputValue(),'done');assert.equal(await details().getByLabel('Personal planning column',{exact:true}).isDisabled(),true)
 await page.getByRole('button',{name:'Close item details'}).click();await openListItem('Cancelled task');await details().getByText('Organization & personal planning',{exact:true}).click();assert.equal(await details().getByLabel('Personal planning column',{exact:true}).inputValue(),'cancelled')
 checks.push('Dependencies only offer work items; closed/cancelled planning selectors match the Board')

 await page.getByRole('button',{name:'Close item details'}).click();await openListItem('Edit the opening sequence');await details().locator('.description-section').getByRole('button',{name:'Edit',exact:true}).click();await details().getByRole('tab',{name:'Markdown',exact:true}).click();await details().getByLabel('Markdown',{exact:true}).fill('Retain this failed draft');await page.evaluate(()=>window.__failDescription=true);await details().getByRole('button',{name:'Save description',exact:true}).click();await page.locator('.source-edit-error').waitFor();await openNavigation(page);await page.getByRole('button',{name:'Settings & connection',exact:false}).click();await dialog().getByRole('button',{name:'Disconnect',exact:true}).click();await dialog().getByText('Resolve failed edits with Retry edit or explicitly discard them before disconnecting or changing accounts.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__disconnects),0);await dialog().getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'Discard failed edit for Edit the opening sequence',exact:true}).click();assert.equal(await guarded(),true,'Failed editor draft remains dirty even after discarding the retry');await accept(()=>page.getByRole('button',{name:'Close item details'}).click());await settle();assert.equal(await guarded(),false)
 checks.push('Account changes cannot silently clear failed edits; failed editor drafts stay protected')

 await page.evaluate(()=>window.__partialRefresh=true);await page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).click();await page.getByText('Some sources could not refresh. Check Deck.',{exact:true}).waitFor();assert.equal(await page.getByText('Sources refreshed',{exact:true}).count(),0)
 checks.push('Partial refresh reports the failed source rather than full success')
 assert.deepEqual(errors,[]);await page.screenshot({path:'artifacts/audit-regressions.png'});await writeFile('artifacts/audit-regressions.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2))
}finally{await browser.close()}
