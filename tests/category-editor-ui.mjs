/** Isolated source-category editor flow. This test never accesses a real account. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {selectScope} from './ui-navigation.mjs'

const fixture=plannerFixture()
fixture.collections.push(
  {id:'calendar-personal',source:'calendar',title:'Personal calendar',color:'#218c6a',readonly:true},
  {id:'deck-personal',source:'deck',title:'Personal Deck',stacks:[{id:'personal-todo',title:'To do'}]},
)
fixture.records.push(
  {...fixture.records.find(record=>record.id==='card-mine'),id:'card-personal',title:'Plan personal project',collectionId:'deck-personal',collectionTitle:'Personal Deck',stackId:'personal-todo'},
  {...fixture.records.find(record=>record.id==='event-review'),id:'event-personal',title:'Personal appointment',collectionId:'calendar-personal',collectionTitle:'Personal calendar',readonly:true},
)
fixture.workspace.spaces=[
  {id:'space-first',name:'First',color:'#3975ce',collectionIds:['calendar-work','tasks-work','deck-work','missing-source']},
  {id:'space-other',name:'Another Space',color:'#9e5bd6',collectionIds:['notes']},
]
fixture.workspace.projects=[{id:'project-retained',spaceId:'space-first',name:'Existing project',categoryId:'category-retained',collectionIds:[],recordIds:[]}]
fixture.workspace.categories=[
  {id:'category-retained',spaceId:'space-first',name:'Retained',color:'#3975ce',collectionIds:['missing-source','legacy-only-source']},
  {id:'category-other',spaceId:'space-other',name:'Reference',color:'#9e5bd6',collectionIds:['notes']},
]
fixture.workspace.planner.scopeId='space-first'
fixture.workspace.planner.view='overview'
validateWorkspace(fixture.workspace)
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1500,height:980},colorScheme:'light'})
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message))
page.on('dialog',dialog=>dialog.accept())
await page.addInitScript(initial=>{
  let state=JSON.parse(sessionStorage.getItem('category-editor-fixture')||'null')||structuredClone(initial)
  const read=async()=>structuredClone(state)
  const save=()=>sessionStorage.setItem('category-editor-fixture',JSON.stringify(state))
  window.__categoryNativeWrites=[]
  const blocked=async input=>{window.__categoryNativeWrites.push(input);throw new Error('Source writes are not allowed in this test.')}
  window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{
    if(revision!==state.revision)throw new Error('Stale fixture revision')
    state.workspace=structuredClone(workspace);state.revision++;save()
    return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}
  },createTask:blocked,createNote:blocked,createEvent:blocked,createLinkedEvent:blocked,moveCard:blocked,setCardCompleted:blocked,setTaskCompleted:blocked,openExternal:async()=>{}}
},fixture)
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const dialog=()=>page.getByRole('dialog')
const openManager=async()=>{
  await page.getByRole('button',{name:'Group sources',exact:true}).click()
  await dialog().getByRole('heading',{name:'Group sources',exact:true}).waitFor()
}
const assign=async(label,id)=>{await dialog().getByLabel(label,{exact:true}).selectOption(id);const confirmation=dialog().locator('.assignment-confirm');if(await confirmation.count())await confirmation.getByRole('button',{name:/^(Move source|Add to this Space and group)$/}).click()}
const categories=async()=>{const state=await backend();return state.workspace.categories.filter(category=>category.spaceId==='space-first')}

try{
  await page.goto('http://127.0.0.1:5173')
  await page.getByRole('heading',{name:'First',exact:true}).waitFor()
  await openManager()
  assert.equal(await dialog().getByLabel('Source group for missing-source',{exact:true}).inputValue(),'category-retained')
  assert.equal(await dialog().getByText('saved connection retained',{exact:false}).count(),2)
  await assign('Source group for legacy-only-source','')
  assert.equal(await dialog().getByLabel('Source group for Calendar: Personal calendar',{exact:true}).count(),0)
  await dialog().getByRole('button',{name:'Create custom group',exact:true}).click()
  await dialog().getByLabel('Source group name 2',{exact:true}).fill('Personal')
  assert.equal(await dialog().getByLabel('Space to categorize',{exact:true}).count(),0,'Group editing stays bound to the explicit Space')
  await dialog().getByRole('button',{name:'Create custom group',exact:true}).click()
  await dialog().getByLabel('Source group name 3',{exact:true}).fill('Freelance')
  const personalId=await dialog().locator('.category-edit-row').nth(1).getAttribute('data-category-id')
  const freelanceId=await dialog().locator('.category-edit-row').nth(2).getAttribute('data-category-id')
  await dialog().getByLabel('Sources to show',{exact:true}).selectOption('all')
  await assign('Source group for Calendar: Personal calendar',personalId)
  await assign('Source group for Deck board: Personal Deck',personalId)
  await assign('Source group for Task list: Personal tasks',personalId)
  await assign('Source group for Calendar: Freelance calendar',freelanceId)
  await assign('Source group for Deck board: Freelance board',freelanceId)
  await assign('Source group for Task list: Freelance tasks',freelanceId)
  await page.screenshot({path:'artifacts/category-source-mapping.png'})
  await dialog().getByRole('button',{name:'Save source groups',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  let state=await backend()
  validateWorkspace(state.workspace)
  let personal=state.workspace.categories.find(category=>category.id===personalId)
  assert.deepEqual(personal.collectionIds.sort(),['calendar-personal','deck-personal','tasks-personal'])
  assert.ok(personal.collectionIds.every(id=>state.workspace.spaces.find(space=>space.id==='space-first').collectionIds.includes(id)))
  assert.ok(state.workspace.spaces.find(space=>space.id==='space-first').collectionIds.includes('legacy-only-source'),'Ungrouping a category-only legacy source retains its parent Space membership')
  assert.deepEqual(state.workspace.categories.find(category=>category.id==='category-other'),fixture.workspace.categories[1])
  assert.deepEqual(state.workspace.categories.find(category=>category.id==='category-retained').collectionIds,['missing-source'])
  checks.push('Explicit calendar, Deck and task-list assignment groups sources and adds outside sources to their parent Space without native writes')

  await page.locator(`.timeline-group-label[data-group-id="category:${personalId}"]`).waitFor()
  assert.equal(await page.locator('.timeline-row-label[data-record-id="task-personal"]').getAttribute('data-category-id'),personalId)
  assert.equal(await page.locator('.timeline-row-label[data-record-id="card-personal"]').getAttribute('data-category-id'),personalId)
  await selectScope(page,'Personal',{space:'First',kind:'category'})
  await page.getByRole('heading',{name:'Personal',exact:true}).waitFor()
  await page.getByRole('tab',{name:'Calendar',exact:true}).click()
  await page.locator('.calendar-event[data-record-id="event-personal"]').waitFor()
  assert.equal(await page.locator('.calendar-event[data-record-id="event-review"]').count(),0)
  await selectScope(page,'First',{kind:'space'})
  await page.getByRole('tab',{name:'Overview',exact:true}).click()
  checks.push('Personal tasks and Deck cards share one category, and its calendar view includes the assigned calendar without unrelated events')

  const beforeCancel=JSON.stringify(await categories())
  await openManager()
  await dialog().getByLabel('Source group name 2',{exact:true}).fill('Unsaved name')
  await assign('Source group for Calendar: Personal calendar','')
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  assert.equal(JSON.stringify(await categories()),beforeCancel)
  checks.push('Cancel discards draft names and assignments without mutating saved categories')

  await openManager()
  await assign('Source group for Calendar: Personal calendar',freelanceId)
  await dialog().getByRole('button',{name:'Save source groups',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  state=await backend()
  assert.equal(state.workspace.categories.filter(category=>category.spaceId==='space-first'&&category.collectionIds.includes('calendar-personal')).length,1)
  assert.ok(state.workspace.categories.find(category=>category.id===freelanceId).collectionIds.includes('calendar-personal'))
  assert.equal(state.workspace.categories.find(category=>category.id===personalId).collectionIds.includes('calendar-personal'),false)
  checks.push('Moving a source changes exactly one category assignment within the Space')

  await openManager()
  await dialog().getByRole('button',{name:'Remove source group Retained',exact:true}).click()
  assert.equal(await dialog().getByLabel('Source group for missing-source',{exact:true}).inputValue(),'')
  await dialog().getByRole('button',{name:'Save source groups',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  state=await backend()
  assert.ok(state.workspace.spaces.find(space=>space.id==='space-first').collectionIds.includes('missing-source'))
  assert.equal(state.workspace.projects.find(project=>project.id==='project-retained').categoryId,undefined)
  assert.deepEqual(state.workspace.categories.find(category=>category.id==='category-other'),fixture.workspace.categories[1])
  validateWorkspace(state.workspace)
  checks.push('Removing a category preserves unavailable sources and projects, clears only its project category, and preserves other Spaces')

  await page.reload()
  await page.getByRole('heading',{name:'First',exact:true}).waitFor()
  await openManager()
  assert.equal(await dialog().getByLabel('Source group for Calendar: Personal calendar',{exact:true}).inputValue(),freelanceId)
  assert.equal(await dialog().getByLabel('Source group for Deck board: Personal Deck',{exact:true}).inputValue(),personalId)
  await page.setViewportSize({width:430,height:932})
  const width=await page.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth}))
  assert.ok(width.body<=width.viewport+1,JSON.stringify(width))
  await page.screenshot({path:'artifacts/category-source-mapping-narrow.png'})
  assert.deepEqual(await page.evaluate(()=>window.__categoryNativeWrites),[])
  assert.deepEqual(errors,[])
  checks.push('Assignments survive reload, remain readable at 430px, and cause no source writes or renderer errors')
  console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){
  await page.screenshot({path:'artifacts/category-editor-failure.png',fullPage:true}).catch(()=>{})
  console.error(JSON.stringify({result:'FAIL',checks,errors,error:String(error)},null,2))
  throw error
}finally{await browser.close()}
