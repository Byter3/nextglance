/** Popup relations use isolated fixture data; no real account or source writes. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { plannerFixture } from './fixtures.mjs'

await mkdir('artifacts', {recursive:true})
const initial=plannerFixture(new Date(2026,10,4,9))
initial.workspace.planner.view='list'
initial.workspace.appearance.mode='dark'
initial.records.find(record=>record.id==='card-mine').nativeDependencies=['card-gig']
initial.records.find(record=>record.id==='card-mine').attachmentFileIds=['101']
initial.records.find(record=>record.id==='note-brief').fileId='101'
initial.workspace.relations.push(
  {id:'already-blocked',type:'depends_on',fromId:'card-mine',toId:'task-overdue'},
  {id:'cycle-path',type:'depends_on',fromId:'task-undated',toId:'card-mine'},
  {id:'missing-scheduled-work',type:'scheduled_during',fromId:'no-longer-loaded-task',toId:'event-other'},
  {id:'legacy-note-schedule',type:'scheduled_during',fromId:'note-new',toId:'event-review'},
)
initial.records.push(
  {id:'note-new',kind:'note',source:'notes',fileId:'102',title:'Shot checklist',body:'Camera setup and rendering checks.',collectionId:'notes',collectionTitle:'Production notes'},
  {id:'page-new',kind:'page',source:'collectives',title:'Delivery reference',body:'Shared delivery specifications.',collectionId:'collective',collectionTitle:'Studio knowledge'},
  ...Array.from({length:90},(_,index)=>({id:`extra-${index}`,kind:'task',source:'tasks',title:`Additional task ${String(index).padStart(2,'0')}`,collectionId:'tasks-work',collectionTitle:'Freelance tasks'})),
)
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1536,height:1000},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(15000)
const checks=[],errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(data=>{
  const clone=value=>structuredClone(value);let state=clone(data)
  const read=async()=>clone(state)
  const files=id=>(state.records.find(item=>item.id===id)?.attachmentFileIds||[]).map(fileId=>({id:fileId,type:'file',fileId,name:(state.records.find(item=>item.fileId===fileId)?.title||'Note')+'.md',url:'https://fixture.invalid/f/'+fileId}))
  window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{
    if(revision!==state.revision)throw Error('Stale relation fixture')
    state.workspace=clone(workspace);state.revision++
    return {workspace:clone(workspace),revision:state.revision,storage:clone(state.storage)}
  },setDeckDependency:async({fromId,toId,remove})=>{
    const record=state.records.find(item=>item.id===fromId)
    record.nativeDependencies=remove?(record.nativeDependencies||[]).filter(id=>id!==toId):[...new Set([...(record.nativeDependencies||[]),toId])]
    return read()
  },readDeckAttachments:async({id})=>({attachments:files(id)}),attachDeckFile:async({id,noteId})=>{const card=state.records.find(item=>item.id===id),note=state.records.find(item=>item.id===noteId);card.attachmentFileIds=[...new Set([...(card.attachmentFileIds||[]),note.fileId])];return {attachments:files(id)}},removeDeckAttachment:async({id,attachmentId})=>{const card=state.records.find(item=>item.id===id);card.attachmentFileIds=card.attachmentFileIds.filter(fileId=>fileId!==attachmentId);return {attachments:files(id)}},openExternal:async()=>{},readPage:async()=>({body:'Shared delivery specifications.'}),updateRecordDates:read,updateDescription:read,setTaskDue:read,updateEvent:read,createLinkedEvent:read,exportWorkspace:async()=>({exported:true}),syncWorkspace:read}
},initial)
const details=()=>page.getByRole('complementary',{name:'Item details'})
const dialog=name=>page.getByRole('dialog',{name,exact:true})
const state=()=>page.evaluate(()=>window.workspaceApi.getState())
async function waitState(predicate,message){
  const deadline=Date.now()+15000
  do{
    const snapshot=await state()
    if(predicate(snapshot)===true)return snapshot
    await new Promise(resolve=>setTimeout(resolve,50))
  }while(Date.now()<deadline)
  assert.fail(message)
}
async function savedRelation(fromId,toId,type){return waitState(state=>state.workspace.relations.some(edge=>edge.fromId===fromId&&edge.toId===toId&&edge.type===type),`Relation ${type}: ${fromId} -> ${toId} was not saved`)}
async function openDependency(){await details().getByRole('button',{name:'Add dependency',exact:true}).click();await dialog('Add dependency').waitFor();return dialog('Add dependency')}
async function openNotes(){await details().getByRole('button',{name:'Attach',exact:true}).click();await dialog('Attach notes or files').waitFor();return dialog('Attach notes or files')}
try{
  await page.goto('http://127.0.0.1:5173')
  await page.getByRole('heading',{name:'My overview',exact:true}).waitFor()
  await page.locator('.list-table-row').filter({hasText:'Edit the opening sequence'}).first().click()
  const nativeRow=details().locator('.dependencies-section .inspector-linked-row').filter({hasText:'Deliver the final cut'})
  assert.equal(await nativeRow.getByText('From Deck',{exact:true}).count(),1)
  assert.equal(await nativeRow.getByRole('button',{name:/Remove dependency/}).isEnabled(),true)
  checks.push('Native dependency provenance is visible and removal is available through Deck')
  let picker=await openDependency()
  assert.equal(await picker.getByRole('radio',{name:'Waits for (incoming)',exact:false}).isChecked(),true)
  assert.ok(await picker.locator('.relation-option').count()>80,'Picker must not silently truncate sources at eighty results')
  assert.equal(await picker.getByRole('radio',{name:'Send revised estimate',exact:true}).isDisabled(),true)
  assert.equal(await picker.getByRole('radio',{name:'Collect reference material',exact:true}).isDisabled(),true)
  assert.equal(await picker.getByRole('radio',{name:'Client review',exact:true}).count(),0)
  assert.equal(await picker.getByRole('radio',{name:'Client brief',exact:true}).count(),0)
  await picker.getByLabel('Find related work',{exact:true}).fill('Prepare review')
  await picker.getByRole('radio',{name:'Prepare review notes',exact:true}).check()
  assert.match(await picker.locator('.relation-preview').textContent(),/Edit the opening sequence waits for Prepare review notes/)
  await page.screenshot({path:'artifacts/relation-picker-dependency.png'})
  await picker.getByRole('button',{name:'Add dependency',exact:true}).click()
  await picker.waitFor({state:'hidden'});await savedRelation('card-mine','task-today','depends_on')
  checks.push('Incoming popup searches all task/card sources and rejects duplicate and circular dependencies')

  picker=await openDependency()
  await picker.getByRole('radio',{name:'Needed by (outgoing)',exact:false}).check()
  await picker.getByLabel('Find related work',{exact:true}).fill('Book annual')
  await picker.getByRole('radio',{name:'Book annual service',exact:true}).check()
  assert.match(await picker.locator('.relation-preview').textContent(),/Book annual service waits for Edit the opening sequence/)
  await picker.getByRole('button',{name:'Add dependency',exact:true}).click()
  await picker.waitFor({state:'hidden'});await savedRelation('task-personal','card-mine','depends_on')
  assert.ok((await details().locator('.dependencies-section').textContent()).includes('Needed by'))
  checks.push('Outgoing popup stores the inverse depends_on direction and shows Needed by in the inspector')

  picker=await openNotes()
  assert.equal(await picker.getByRole('checkbox',{name:'Client brief',exact:true}).isDisabled(),true)
  assert.equal(await picker.getByRole('checkbox',{name:'Delivery reference',exact:true}).count(),1)
  assert.equal(await picker.getByRole('checkbox',{name:'Client review',exact:true}).count(),0)
  await picker.getByLabel('Find notes and pages',{exact:true}).fill('rendering')
  await picker.getByRole('checkbox',{name:'Shot checklist',exact:true}).check()
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}),true)
  page.once('dialog',prompt=>prompt.dismiss());await picker.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(await picker.isVisible(),true,'Cancel must offer to keep a selected unsaved link')
  page.once('dialog',prompt=>prompt.accept());await picker.getByRole('button',{name:'Cancel',exact:true}).click()
  await picker.waitFor({state:'hidden'})
  assert.equal((await state()).workspace.relations.some(edge=>edge.toId==='note-new'),false)
  checks.push('Note picker includes Collective pages and searchable note content; unsaved selection is protected')

  picker=await openNotes();await picker.getByRole('checkbox',{name:'Shot checklist',exact:true}).check()
  await page.screenshot({path:'artifacts/relation-picker-notes.png'})
  await picker.getByRole('button',{name:'Link 1 note',exact:true}).click()
  await picker.waitFor({state:'hidden'});await waitState(state=>state.records.find(item=>item.id==='card-mine').attachmentFileIds.includes('102'),'Note was not attached in Deck')
  assert.equal((await state()).workspace.relations.some(edge=>edge.fromId==='card-mine'&&edge.toId==='note-new'),false,'Deck note attachments do not create custom links')
  await details().getByRole('button',{name:'Unlink note Shot checklist',exact:true}).click()
  await waitState(state=>!state.records.find(item=>item.id==='card-mine').attachmentFileIds.includes('102'),'Native note attachment was not removed')
  assert.ok((await state()).records.some(record=>record.id==='note-new'),'Unlinking preserves note content')
  checks.push('The attachment popup links notes natively in Deck; unlink removes the attachment and preserves note content')

  await details().getByText('Organization & personal planning',{exact:true}).click()
  await details().getByRole('button',{name:'Link another item',exact:true}).click()
  picker=dialog('Link related item')
  await picker.getByLabel('Connection type',{exact:true}).selectOption('event-work')
  await picker.getByLabel('Role',{exact:true}).selectOption('follow_up')
  await picker.getByRole('radio',{name:'Client review',exact:true}).check()
  assert.equal(await picker.getByRole('radio',{name:'Prepare review notes',exact:true}).count(),0)
  await picker.getByRole('button',{name:'Link item',exact:true}).click()
  await picker.waitFor({state:'hidden'});await savedRelation('card-mine','event-review','for_event')
  assert.equal((await state()).workspace.relations.find(edge=>edge.fromId==='card-mine'&&edge.toId==='event-review').role,'follow_up')
  checks.push('Related item popup retains preparation/during/follow-up context for calendar events')

  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  await page.locator('.list-table-row').filter({hasText:'Another client meeting'}).first().click()
  let otherLinks=details().locator('section[aria-label="Other linked items"]')
  assert.match(await otherLinks.textContent(),/Unavailable item/)
  await otherLinks.getByRole('button',{name:'Remove connection',exact:true}).click()
  await waitState(state=>!state.workspace.relations.some(edge=>edge.id==='missing-scheduled-work'),'Unavailable work relation was not removed')
  assert.ok((await state()).records.some(record=>record.id==='event-other'))
  checks.push('An unavailable incoming scheduled task remains visible and its stale link can be removed')

  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  await page.locator('.list-table-row').filter({hasText:'Client review'}).first().click()
  otherLinks=details().locator('section[aria-label="Other linked items"]')
  assert.match(await otherLinks.textContent(),/Shot checklist/)
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  await page.locator('.list-table-row').filter({hasText:'Shot checklist'}).first().click()
  otherLinks=details().locator('section[aria-label="Other linked items"]')
  assert.match(await otherLinks.textContent(),/Client review/)
  await otherLinks.getByRole('button',{name:'Remove connection',exact:true}).click()
  await waitState(state=>!state.workspace.relations.some(edge=>edge.id==='legacy-note-schedule'),'Legacy note schedule relation was not removed')
  assert.ok((await state()).records.some(record=>record.id==='note-new'))
  assert.ok((await state()).records.some(record=>record.id==='event-review'))
  checks.push('Legacy note-to-event scheduling links remain visible at both endpoints and unlink preserves both items')
  assert.deepEqual(errors,[])
  await writeFile('artifacts/relation-picker-ui.json',JSON.stringify({checks,errors},null,2))
  console.log(JSON.stringify({passed:checks.length,checks},null,2))
}finally{await browser.close()}
