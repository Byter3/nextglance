/** Space organization is exercised through the Windows renderer with isolated data. */
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir} from 'node:fs/promises'
import {plannerFixture} from './fixtures.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
const fixture=plannerFixture()
fixture.workspace.categories=[{id:'existing-group',spaceId:'space-work',name:'Existing work',color:'#3975ce',collectionIds:['deck-work','tasks-work']}]
fixture.workspace.planner.excludedSpaceIds=['space-work']
fixture.records.find(record=>record.id==='card-mine').body='A native description.'
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1550,height:1080},colorScheme:'dark'})
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message))
page.on('dialog',dialog=>dialog.accept())
await page.addInitScript(initial=>{
 const saved=sessionStorage.getItem('spaces-ui-fixture'),state=saved?JSON.parse(saved):structuredClone(initial),writes=[]
 const copy=value=>structuredClone(value),remember=()=>sessionStorage.setItem('spaces-ui-fixture',JSON.stringify(state))
 window.spaceHarness={state,writes,removeSpace(id){state.workspace.spaces=state.workspace.spaces.filter(space=>space.id!==id);state.workspace.categories=state.workspace.categories.filter(group=>group.spaceId!==id);state.workspace.projects=state.workspace.projects.filter(project=>project.spaceId!==id);state.revision++;remember()}}
 window.workspaceApi={
  getState:async()=>copy(state),refresh:async()=>copy(state),syncWorkspace:async()=>copy(state),openExternal:async()=>{},
  saveWorkspace:async(workspace,revision)=>{if(window.failNextOrganization){window.failNextOrganization=false;throw Error('Fixture organization save failed')}if(revision!==state.revision)throw Error('Stale fixture revision');state.workspace=copy(workspace);state.revision++;remember();writes.push(copy(workspace));return {workspace:copy(state.workspace),revision:state.revision,storage:state.storage}},
  createTask:async()=>copy(state),createCard:async()=>copy(state),createEvent:async()=>copy(state),createNote:async()=>copy(state),createLinkedEvent:async()=>copy(state),
 }
},fixture)
const modal=()=>page.getByRole('dialog')
const row=id=>page.locator(`.timeline-row-label[data-record-id="${id}"]`)
async function nav(name){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.locator('.app-sidebar').getByRole('button',{name}).click()}
async function snapshot(){return page.evaluate(()=>({groups:[...document.querySelectorAll('.timeline-group-label')].map(element=>({id:element.dataset.groupId,kind:element.dataset.groupKind,title:element.querySelector('strong').textContent,color:element.style.getPropertyValue('--group-color')})),rows:[...document.querySelectorAll('.timeline-row-label')].map(element=>element.dataset.recordId),count:document.querySelector('.sidebar-main .nav-count').textContent}))}
async function settle(){await page.waitForFunction(()=>!document.querySelector('.sidebar-save')?.textContent.includes('Saving…'));await page.evaluate(()=>new Promise(requestAnimationFrame))}
try{
 await page.goto('http://127.0.0.1:5173');await page.getByRole('heading',{name:'My overview',exact:true}).waitFor()
 await page.getByRole('tab',{name:'Timeline',exact:true}).click();await row('card-mine').waitFor();await settle()
 assert.equal(await page.getByRole('button',{name:'Group sources',exact:true}).count(),0)
 assert.equal(await page.locator('.timeline-group-label[data-group-kind="space"],.timeline-group-label[data-group-kind="category"],.timeline-group-label[data-group-kind="project"]').count(),0)
 const baseline=await snapshot()
 assert.ok(baseline.rows.includes('task-personal')&&baseline.rows.includes('card-gig'))
 await page.getByRole('button',{name:/^Filters/}).click()
 assert.equal(await page.getByText('Spaces in My overview',{exact:true}).count(),0)
 await page.getByRole('button',{name:/^Filters/}).click()
 checks.push('My overview ignores legacy Space exclusions and uses native-source headings without a global group editor')

 await row('card-mine').click();assert.equal(await page.locator('.inspector-location').count(),0)
 await page.getByRole('button',{name:'Schedule in calendar',exact:true}).click()
 assert.equal(await modal().getByLabel('Calendar',{exact:true}).inputValue(),'','Multiple global calendars require explicit selection, even when a matching Space has a default')
 await modal().getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Close item details',exact:true}).click()
 await page.getByRole('button',{name:'New item',exact:true}).click()
 assert.equal(await modal().getByLabel('Task list',{exact:true}).inputValue(),'','Global creation does not adopt first matching Space defaults')
 await modal().getByRole('button',{name:'Cancel',exact:true}).click()
 checks.push('Overview item context and creation/scheduling destinations do not infer a Space owner')

 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Create Space',exact:true}).click()
 const beforeCancel=await page.evaluate(()=>window.spaceHarness.writes.length)
 await modal().getByRole('checkbox',{name:'Suggest Personal',exact:true}).check()
 await modal().getByRole('button',{name:'Add selected groups',exact:true}).click()
 await modal().getByRole('button',{name:'Cancel',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.spaceHarness.writes.length),beforeCancel)
 checks.push('Accepting starter groups in a draft and cancelling writes no organization changes')

 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Create Space',exact:true}).click()
 await modal().locator('#scope-name').fill('Review view')
 for(const name of ['Deck board: Freelance board','Task list: Freelance tasks','Calendar: Freelance calendar'])await modal().getByRole('checkbox',{name:'Include '+name,exact:true}).check()
 for(const name of ['Personal','Shared'])await modal().getByRole('checkbox',{name:'Suggest '+name,exact:true}).check()
 await modal().getByRole('button',{name:'Add selected groups',exact:true}).click()
 await modal().getByRole('combobox',{name:'Source group for Deck board: Freelance board',exact:true}).selectOption({label:'Personal'})
 await modal().getByRole('combobox',{name:'Source group for Task list: Freelance tasks',exact:true}).selectOption({label:'Personal'})
 await modal().getByRole('button',{name:'Create Space',exact:true}).click();await page.getByRole('heading',{name:'Review view',exact:true}).waitFor();await settle()
 const created=await page.evaluate(()=>window.spaceHarness.state.workspace.spaces.find(space=>space.name==='Review view'))
 let saved=await page.evaluate(()=>window.spaceHarness.state.workspace)
 validateWorkspace(saved)
 assert.deepEqual(saved.categories.find(group=>group.id==='existing-group'),fixture.workspace.categories[0])
 const personal=saved.categories.find(group=>group.spaceId===created.id&&group.name==='Personal')
 assert.ok(personal&&personal.id!=='existing-group');assert.deepEqual(personal.collectionIds.sort(),['deck-work','tasks-work'])
 assert.ok(saved.categories.some(group=>group.spaceId===created.id&&group.name==='Shared'&&group.collectionIds.length===0))
 await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/spaces-own-groups.png'})
 checks.push('A single Save creates a Space and ordinary synced groups with independent IDs, including empty accepted groups')

 await page.getByRole('button',{name:'Project',exact:true}).click()
 await modal().getByLabel('Name',{exact:true}).fill('Retried project')
 await page.evaluate(()=>window.failNextOrganization=true)
 await modal().getByRole('button',{name:'Create project',exact:true}).click()
 await modal().locator('.modal-error').getByText('Fixture organization save failed',{exact:true}).waitFor()
 await modal().getByRole('button',{name:'Save changes',exact:true}).click()
 await modal().waitFor({state:'hidden'});await settle()
 assert.equal(await page.evaluate(()=>window.spaceHarness.state.workspace.projects.filter(project=>project.name==='Retried project').length),1)
 await nav(/^Review view/)
 checks.push('Retrying a failed new-project save retains one stable identity and creates no duplicate project')

 await page.getByRole('button',{name:'Group sources',exact:true}).click()
 await modal().getByRole('textbox',{name:'Source group name 1',exact:true}).fill('Focus')
 await modal().getByRole('button',{name:'Save source groups',exact:true}).click();await modal().waitFor({state:'hidden'});await settle()
 saved=await page.evaluate(()=>window.spaceHarness.state.workspace)
 assert.equal(saved.categories.find(group=>group.id===personal.id).name,'Focus');assert.equal(saved.categories.find(group=>group.id==='existing-group').name,'Existing work')
 await page.getByRole('button',{name:/^Filters/}).click();await page.getByText('Visible sources',{exact:true}).click()
 await page.getByRole('checkbox',{name:'Freelance board',exact:true}).uncheck()
 await page.getByRole('button',{name:/^Filters/}).click()
 await nav(/^My overview/);await page.getByRole('tab',{name:'Timeline',exact:true,selected:true}).waitFor();await row('card-mine').waitFor();await settle()
 assert.deepEqual(await snapshot(),baseline)
 checks.push('Renaming groups and hiding sources inside a Space leaves Overview rows, heading colors, counts and saved layout unchanged')

 await nav(/^Review view/);await page.getByRole('heading',{name:'Review view',exact:true}).waitFor()
 assert.equal(await row('card-mine').count(),0)
 await page.reload();await page.getByRole('heading',{name:'Review view',exact:true}).waitFor()
 assert.equal(await row('card-mine').count(),0)
 await nav(/^My overview/);await row('card-mine').waitFor();await settle();assert.deepEqual(await snapshot(),baseline)
 checks.push('Per-account Space filters and Overview preferences survive restart without leaking across scopes')

 await nav(/^Review view/);await page.getByRole('button',{name:'Manage Space',exact:true}).click()
 await modal().getByRole('button',{name:'Remove Space',exact:true}).click()
 await modal().getByRole('button',{name:'Remove Space',exact:true}).click();await page.getByRole('heading',{name:'My overview',exact:true}).waitFor();await settle()
 assert.deepEqual(await snapshot(),baseline)
 saved=await page.evaluate(()=>window.spaceHarness.state.workspace)
 assert.ok(!saved.spaces.some(space=>space.id===created.id)&&!saved.categories.some(group=>group.spaceId===created.id))
 assert.deepEqual(saved.relations,fixture.workspace.relations);assert.equal(await page.evaluate(()=>window.spaceHarness.state.records.length),fixture.records.length)
 checks.push('Removing a Space removes only its owned organization and restores Overview; native items and links remain intact')

 await nav(/^Client film/);await page.getByRole('tab',{name:'Calendar',exact:true}).click()
 const linked=page.locator('.calendar-event[data-record-id="event-review"]')
 await linked.waitFor();assert.match(await linked.getAttribute('title'),/Linked context/)
 await linked.click();await page.getByText('Linked context · this source is outside the selected view.',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Close item details',exact:true}).click()
 await page.evaluate(()=>window.spaceHarness.removeSpace('space-work'))
 await page.locator('.topbar-actions').getByRole('button',{name:/Refresh/}).click()
 await page.getByRole('heading',{name:'My overview',exact:true}).waitFor()
 checks.push('Linked external resources are labeled as context, and a remotely deleted active Space safely falls back to Overview')
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({passed:checks.length,checks},null,2))
}catch(error){console.error(JSON.stringify({errors,diagnostic:await page.evaluate(()=>({alerts:[...document.querySelectorAll('[role=alert],.sidebar-save')].map(e=>e.textContent),invalid:[...document.querySelectorAll(':invalid')].map(e=>({tag:e.tagName,id:e.id,name:e.getAttribute('aria-label'),message:e.validationMessage})),writes:window.spaceHarness.writes.length})).catch(()=>null)},null,2));await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/spaces-overview-failure.png'}).catch(()=>{});throw error}
finally{await browser.close()}
