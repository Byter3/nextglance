/** Integrated tag creation and scoped note suggestions. Fixture data only. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixture=plannerFixture(new Date(2026,10,11,9))
fixture.workspace.appearance.mode='dark';fixture.workspace.planner.view='list'
fixture.workspace.relations=[]
const board=fixture.collections.find(item=>item.id==='deck-work')
// Deliberately collide Deck label IDs with unrelated Files tag IDs. Only names
// may cross the namespace when a board label is suggested for a note.
board.labels=[{id:'501',title:'Action needed',color:'#e5534b'},{id:'502',title:'Board only label',color:'#ffee00'},...Array.from({length:150},(_,i)=>({id:String(1000+i),title:`Known board label ${String(i).padStart(3,'0')}`,color:'#3975ce'}))]
board.color='#3975ce'
Object.assign(fixture.records.find(item=>item.id==='card-mine'),{tagDetails:[board.labels[0]],tags:['Action needed'],etag:'card-v1'})
Object.assign(fixture.records.find(item=>item.id==='task-today'),{tags:['Task existing']})
Object.assign(fixture.records.find(item=>item.id==='task-undated'),{tags:['Peer task tag']})
Object.assign(fixture.records.find(item=>item.id==='event-review'),{tags:['Calendar existing']})
Object.assign(fixture.records.find(item=>item.id==='event-other'),{tags:['Peer calendar tag']})
const assignedNoteTags=[{id:'501',title:'Managed team',assignable:false},{id:'502',title:'Existing note tag',assignable:true}]
Object.assign(fixture.records.find(item=>item.id==='note-brief'),{fileId:'101',remote:{nativeId:101,category:'Research'},body:'# Brief\n\nProduction notes.',tagDetails:assignedNoteTags,fileTags:assignedNoteTags,tags:assignedNoteTags.map(tag=>tag.title)})

await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1652,height:1100},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(15000)
const checks=[],errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
await page.addInitScript(initial=>{
  const state=structuredClone(initial)
  let sequence=8000
  const fileCatalog=[...state.records.find(record=>record.id==='note-brief').tagDetails,...Array.from({length:5000},(_,i)=>({id:String(20000+i),title:`Archive-only global tag ${String(i).padStart(4,'0')}`,assignable:true}))]
  window.__knownTagCalls=[];window.__holdTagCreation=false;window.__failTagAssignment=false
  const recordCall=(method,input)=>window.__knownTagCalls.push({method,input:structuredClone(input)})
  const read=async()=>structuredClone(state)
  const noteTags=id=>({tags:structuredClone(state.records.find(record=>record.id===id).tagDetails||[]),availableTags:structuredClone(fileCatalog)})
  window.workspaceApi={
    getState:read,refresh:read,syncWorkspace:async()=>{state.storage.syncStatus='synced';return read()},openExternal:async()=>{},readPage:async()=>({body:''}),
    saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw Error('Stale fixture revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},
    createDeckLabel:async input=>{
      recordCall('createDeckLabel',input)
      if(window.__holdTagCreation)await new Promise(resolve=>window.__releaseTagCreation=resolve)
      const collection=state.collections.find(item=>item.id===input.collectionId)
      let label=collection.labels.find(tag=>tag.title.toLocaleLowerCase()===input.title.toLocaleLowerCase())
      if(!label){label={id:String(++sequence),title:input.title,color:input.color};collection.labels.push(label)}
      return {label:structuredClone(label),state:await read()}
    },
    updateRecordAppearance:async input=>{
      recordCall('updateRecordAppearance',input)
      if(window.__failTagAssignment){window.__failTagAssignment=false;throw Error('Fixture native tag assignment failed')}
      const record=state.records.find(item=>item.id===input.id)
      if(input.etag!==record.etag)throw Error('Stale native fixture version')
      if(input.tagIds!==undefined){record.tagDetails=state.collections.find(item=>item.id===record.collectionId).labels.filter(tag=>input.tagIds.includes(tag.id));record.tags=record.tagDetails.map(tag=>tag.title)}
      if(input.tags!==undefined)record.tags=[...input.tags]
      if(input.color!==undefined)record.color=input.color||undefined
      record.etag='saved-'+(++sequence)
      return read()
    },
    readNoteTags:async input=>{recordCall('readNoteTags',input);return noteTags(input.id)},
    setNoteTags:async input=>{
      recordCall('setNoteTags',input)
      const record=state.records.find(item=>item.id===input.id)
      const selected=input.tagIds.map(id=>fileCatalog.find(tag=>tag.id===id)).filter(Boolean)
      for(const title of input.newTags||[]){let tag=fileCatalog.find(tag=>tag.title.toLocaleLowerCase()===title.toLocaleLowerCase());if(!tag){tag={id:String(++sequence),title,assignable:true};fileCatalog.push(tag)}if(!selected.some(item=>item.id===tag.id))selected.push(tag)}
      record.tagDetails=selected;record.fileTags=selected;record.tags=selected.map(tag=>tag.title)
      return noteTags(input.id)
    },
    readRelatedResources:async()=>({available:false,resources:[]}),readDeckAttachments:async()=>({attachments:[]}),
  }
},fixture)

const inspector=()=>page.getByRole('complementary',{name:'Item details'})
const appearance=()=>inspector().getByRole('region',{name:'Item color and tags'})
const tagDialog=()=>appearance().getByRole('dialog',{name:'Choose tags',exact:true})
const noteDialog=()=>inspector().getByRole('dialog',{name:'Note tags',exact:true})
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const calls=method=>page.evaluate(method=>window.__knownTagCalls.filter(call=>call.method===method),method)
async function openItem(title){await page.getByRole('tab',{name:'List',exact:true}).click();await page.getByLabel('Search this view',{exact:true}).fill(title);await page.locator('.list-table-row').filter({hasText:title}).click();await inspector().getByRole('heading',{name:title,exact:true,level:2}).waitFor()}
async function openTags(){await appearance().getByRole('button',{name:'Choose tags',exact:true}).click();await tagDialog().waitFor()}
async function away(){await inspector().locator('.inspector-kind').click()}
async function settled(){await tagDialog().waitFor({state:'hidden'});assert.equal(await appearance().getByRole('alert').count(),0)}
async function createItemTag(title){await tagDialog().getByLabel('Find or add a tag',{exact:true}).fill(title);await tagDialog().getByRole('button',{name:`Create tag “${title}”`,exact:true}).click()}

try{
  await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173')
  await openItem('Edit the opening sequence')
  await openTags()
  await page.evaluate(()=>window.__holdTagCreation=true)
  await createItemTag('Native production tag')
  await page.waitForFunction(()=>typeof window.__releaseTagCreation==='function')
  assert.equal((await calls('updateRecordAppearance')).length,0,'Creating a native board label does not assign it before leaving the selector')
  await away()
  assert.equal((await calls('updateRecordAppearance')).length,0,'Leaving while creation is pending waits for the native ID')
  await page.evaluate(()=>{window.__holdTagCreation=false;window.__releaseTagCreation()})
  await settled()
  const created=(await backend()).collections.find(item=>item.id==='deck-work').labels.find(tag=>tag.title==='Native production tag')
  assert.deepEqual((await calls('createDeckLabel')).at(-1).input,{collectionId:'deck-work',title:'Native production tag',color:'#3975ce'})
  assert.deepEqual((await calls('updateRecordAppearance')).at(-1).input.tagIds,['501',created.id])
  assert.ok((await backend()).records.find(item=>item.id==='card-mine').tags.includes('Native production tag'))
  checks.push('Deck tag creation waits for the native label ID, then one click-away assigns it to the card through the native appearance API')

  await openTags();await createItemTag('Retry assignment tag')
  await tagDialog().getByRole('checkbox',{name:'Retry assignment tag',exact:true}).waitFor()
  assert.equal(await tagDialog().getByRole('checkbox',{name:'Retry assignment tag',exact:true}).isChecked(),true)
  await page.evaluate(()=>window.__failTagAssignment=true)
  await away();await appearance().getByRole('alert').filter({hasText:'Fixture native tag assignment failed'}).waitFor()
  const creationCount=(await calls('createDeckLabel')).length,assignmentCount=(await calls('updateRecordAppearance')).length
  await away()
  assert.equal((await calls('updateRecordAppearance')).length,assignmentCount,'Click-away does not silently retry a failed assignment')
  await appearance().getByRole('button',{name:'Retry',exact:true}).click();await settled()
  assert.equal((await calls('createDeckLabel')).length,creationCount,'Assignment retry must not recreate the acknowledged board label')
  assert.ok((await backend()).records.find(item=>item.id==='card-mine').tags.includes('Retry assignment tag'))
  checks.push('A failed native assignment keeps the created label and selected draft; explicit retry assigns it without duplicate label creation')

  const beforeCancelledAssignment=(await calls('updateRecordAppearance')).length
  await openTags();await createItemTag('Reusable board tag')
  await tagDialog().getByRole('checkbox',{name:'Reusable board tag',exact:true}).waitFor()
  assert.equal((await calls('updateRecordAppearance')).length,beforeCancelledAssignment,'Creation leaves assignment pending')
  await page.keyboard.press('Escape');await settled()
  assert.equal(await inspector().isVisible(),true,'Escape after creating a tag cancels only its assignment, not the whole inspector')
  assert.equal((await calls('updateRecordAppearance')).length,beforeCancelledAssignment,'Escape cannot flush the cancelled assignment')
  assert.ok((await backend()).collections.find(item=>item.id==='deck-work').labels.some(tag=>tag.title==='Reusable board tag'))
  assert.ok(!(await backend()).records.find(item=>item.id==='card-mine').tags.includes('Reusable board tag'))
  await openTags();await tagDialog().getByLabel('Find or add a tag',{exact:true}).fill('Reusable board tag')
  assert.equal(await tagDialog().getByRole('checkbox',{name:'Reusable board tag',exact:true}).isChecked(),false)
  assert.equal(await tagDialog().getByRole('button',{name:'Create tag “Reusable board tag”',exact:true}).count(),0)
  await page.keyboard.press('Escape');await settled()
  checks.push('Cancelling the card assignment keeps the explicitly created native board label available for reuse')

  await openItem('Prepare review notes');await openTags()
  await tagDialog().getByRole('checkbox',{name:'Peer task tag',exact:true}).check()
  await createItemTag('New task label');await away();await settled()
  assert.deepEqual((await calls('updateRecordAppearance')).at(-1).input.tags,['Task existing','Peer task tag','New task label'])
  assert.equal((await calls('updateRecordAppearance')).at(-1).input.tagIds,undefined)
  await openItem('Client review');await openTags()
  await tagDialog().getByRole('checkbox',{name:'Peer calendar tag',exact:true}).check()
  await createItemTag('New calendar label');await away();await settled()
  assert.deepEqual((await calls('updateRecordAppearance')).at(-1).input.tags,['Calendar existing','Peer calendar tag','New calendar label'])
  assert.equal((await calls('updateRecordAppearance')).at(-1).input.tagIds,undefined)
  assert.equal((await calls('createDeckLabel')).length,3,'Tasks and events create native categories without calling the Deck-label namespace')
  checks.push('Task and calendar selectors create category names and reuse known peer tags, with native categories saved on click-away')

  await openItem('Client brief')
  await inspector().getByRole('button',{name:'Edit note tags',exact:true}).click()
  await noteDialog().waitFor()
  assert.equal(await noteDialog().getByRole('checkbox',{name:'Managed team Managed',exact:true}).isDisabled(),true)
  assert.equal(await noteDialog().getByRole('checkbox',{name:'Existing note tag',exact:true}).isChecked(),true)
  assert.ok(await noteDialog().getByRole('checkbox').count()<200,'The 5,000 unrelated global tags must not be rendered')
  assert.equal(await noteDialog().getByRole('checkbox',{name:/Archive-only global tag/}).count(),0)
  await noteDialog().getByLabel('Find note tags',{exact:true}).fill('Known board label 149')
  assert.equal(await noteDialog().getByRole('checkbox').count(),1)
  await noteDialog().getByRole('checkbox',{name:'Known board label 149',exact:true}).check()
  await noteDialog().getByLabel('Find note tags',{exact:true}).fill('Archive-only global tag 4999')
  assert.equal(await noteDialog().getByRole('checkbox').count(),0)
  for(const title of ['Action needed','Board only label','Freelance','Client film','New task label','New calendar label']){
    await noteDialog().getByLabel('Find note tags',{exact:true}).fill(title)
    await noteDialog().getByRole('checkbox',{name:title,exact:true}).check()
  }
  await noteDialog().getByLabel('Find note tags',{exact:true}).fill('New note label')
  await noteDialog().getByRole('button',{name:'Create “New note label”',exact:true}).click()
  await page.screenshot({path:'artifacts/known-tags-note-picker.png',fullPage:false})
  assert.equal((await calls('setNoteTags')).length,0,'Multiple note-tag choices stay one draft')
  await noteDialog().getByRole('button',{name:'Done',exact:true}).click()
  await noteDialog().waitFor({state:'hidden'})
  const noteWrite=(await calls('setNoteTags')).at(-1).input
  assert.deepEqual(noteWrite.tagIds,['501','502'],'Only assigned Files IDs belong in tagIds, even when Deck IDs happen to be the same numbers')
  assert.deepEqual(new Set(noteWrite.newTags),new Set(['Known board label 149','Action needed','Board only label','Freelance','Client film','New task label','New calendar label','New note label']))
  assert.ok(!noteWrite.newTags.some(title=>title.startsWith('Archive-only')))
  const note=(await backend()).records.find(item=>item.id==='note-brief')
  assert.ok(note.tagDetails.every(tag=>/^\d+$/.test(tag.id)),'Synthetic context IDs are replaced by native Files IDs after acknowledgement')
  assert.equal(note.tagDetails.find(tag=>tag.title==='Managed team').assignable,false)
  checks.push('Note suggestions stay scoped to loaded tags, board labels, spaces and projects; search remains usable and the whole global catalog is ignored')
  checks.push('Note multi-select and creation send known names as newTags; Deck IDs never leak into Files assignments, while managed native tags remain intact')

  await inspector().getByRole('button',{name:'Edit note tags',exact:true}).click()
  for(const title of ['Action needed','Board only label','New note label']){
    await noteDialog().getByLabel('Find note tags',{exact:true}).fill(title)
    assert.equal(await noteDialog().getByRole('checkbox',{name:title,exact:true}).count(),1,'A native assignment replaces its context suggestion without a duplicate option')
    assert.equal(await noteDialog().getByRole('checkbox',{name:title,exact:true}).isChecked(),true)
  }
  await noteDialog().getByRole('button',{name:'Done',exact:true}).click()
  assert.equal((await calls('setNoteTags')).length,1,'Reopening and searching without changes does not issue another write')
  checks.push('After saving, native note-tag IDs replace suggestions without duplicate options or unnecessary writes')
  assert.deepEqual(errors,[])
  await writeFile('artifacts/known-tags-ui.json',JSON.stringify({passed:checks.length,checks},null,2))
  console.log(JSON.stringify({passed:checks.length,checks},null,2))
}catch(error){await page.screenshot({path:'artifacts/known-tags-ui-failure.png',fullPage:false}).catch(()=>{});throw error}
finally{await browser.close()}
