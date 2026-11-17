/** Integrated native note attachments, tags, navigation and draft safety. No live Nextcloud writes. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixture=plannerFixture(new Date(2026,10,11,9))
fixture.workspace.appearance.mode='dark';fixture.workspace.planner.view='list'
const brief=fixture.records.find(item=>item.id==='note-brief')
Object.assign(brief,{fileId:'101',body:'# Client brief\n\nApproved direction.',remote:{nativeId:101,category:'Research'},tagDetails:[],tags:[]})
fixture.records.push({...structuredClone(brief),id:'note-production',fileId:'102',title:'Production reference',remote:{nativeId:102,category:'Research'},etag:'note-2'})
Object.assign(fixture.records.find(item=>item.id==='card-mine'),{attachmentFileIds:[],tagDetails:[{id:'deck-priority',title:'Action needed',color:'#e5534b'}],tags:['Action needed']})
fixture.workspace.relations.push({id:'legacy-related-note',type:'related',fromId:'note-brief',toId:'card-gig'})
fixture.workspace.relations.push({id:'legacy-note-pending',type:'reference',fromId:'card-both',toId:'note-production'})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1600,height:1100},timezoneId:'Europe/Budapest'})
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000)
await page.addInitScript(initial=>{
  const state=structuredClone(initial),attachments={},availableTags=[{id:'1',title:'Team',assignable:false},{id:'2',title:'Action needed',assignable:true},{id:'3',title:'Freelance',assignable:true}]
  let sequence=200
  window.__noteWrites=[];window.__failNoteTags=false;window.__failAttachNote='';window.__failNoteSave=false
  const read=async()=>structuredClone(state)
  const remember=(method,input)=>window.__noteWrites.push({method,input:structuredClone(input)})
  const fileTags=id=>({tags:structuredClone(state.records.find(item=>item.id===id)?.tagDetails||[]),availableTags:structuredClone(availableTags)})
  const getAttachments=id=>structuredClone(attachments[id]||[])
  window.workspaceApi={getState:read,refresh:read,syncWorkspace:read,
    saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale fixture revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(state.workspace),revision:state.revision,storage:state.storage}},
    migrateDeckNoteLinks:async input=>{remember('migrateDeckNoteLinks',input||{});const candidates=state.workspace.relations.filter(edge=>['reference','related'].includes(edge.type)).map(edge=>{const endpoints=[edge.fromId,edge.toId].map(id=>state.records.find(item=>item.id===id));return {edge,card:endpoints.find(item=>item?.kind==='card'),note:endpoints.find(item=>item?.kind==='note')}}).filter(pair=>pair.card&&pair.note);if(!candidates.length)return {state:await read(),converted:0,remaining:0,errors:[]};const {edge,card,note}=candidates[0];if(card.id==='card-both')return {state:await read(),converted:0,remaining:1,errors:[{relationId:edge.id,message:'Fixture attachment permission denied'}]};attachments[card.id]||=[];if(!attachments[card.id].some(file=>file.fileId===note.fileId))attachments[card.id].push({id:String(++sequence),type:'file',name:note.title+'.md',fileId:note.fileId,path:'/Notes/'+note.title+'.md',url:'https://fixture.invalid/f/'+note.fileId});card.attachmentFileIds=attachments[card.id].map(file=>file.fileId);state.workspace.relations=state.workspace.relations.filter(edge=>!(['reference','related'].includes(edge.type)&&[edge.fromId,edge.toId].includes(card.id)&&[edge.fromId,edge.toId].includes(note.id)));state.revision++;return {state:await read(),converted:1,remaining:1,errors:[]}},
    readNoteTags:async({id})=>fileTags(id),
    setNoteTags:async input=>{remember('setNoteTags',input);if(window.__failNoteTags)throw new Error('Fixture note tags save failed');const record=state.records.find(item=>item.id===input.id);const added=(input.newTags||[]).map(title=>{const existing=availableTags.find(tag=>tag.title.toLocaleLowerCase()===title.toLocaleLowerCase());if(existing)return existing;const tag={id:String(++sequence),title,assignable:true};availableTags.push(tag);return tag});record.tagDetails=[...input.tagIds.map(id=>availableTags.find(tag=>tag.id===id)).filter(Boolean),...added];record.tags=record.tagDetails.map(tag=>tag.title);return fileTags(input.id)},
    readDeckAttachments:async({id})=>({attachments:getAttachments(id)}),
    attachDeckFile:async input=>{remember('attachDeckFile',input);if(window.__failAttachNote===input.noteId)throw new Error('Fixture native attachment failed');const note=state.records.find(item=>item.id===input.noteId),record=state.records.find(item=>item.id===input.id);const fileId=note?.fileId||'file-555';attachments[input.id]||=[];if(!attachments[input.id].some(file=>file.fileId===fileId))attachments[input.id].push({id:String(++sequence),type:'file',name:note?note.title+'.md':'Asset.pdf',fileId,path:input.path||'/Notes/'+note.title+'.md',url:'https://fixture.invalid/f/'+fileId});record.attachmentFileIds=attachments[input.id].map(file=>file.fileId);return {attachments:getAttachments(input.id)}},
    removeDeckAttachment:async input=>{remember('removeDeckAttachment',input);attachments[input.id]=(attachments[input.id]||[]).filter(file=>file.id!==input.attachmentId);state.records.find(item=>item.id===input.id).attachmentFileIds=attachments[input.id].map(file=>file.fileId);return {attachments:getAttachments(input.id)}},
    readRelatedResources:async()=>({available:true,resources:[{providerId:'files',itemId:'700',title:'Shared project folder',subtitle:'Nextcloud Files',url:'https://fixture.invalid/f/700'}]}),
    createNote:async input=>{remember('createNote',input);const number=++sequence,id='created-note-'+number;state.records.push({id,source:'notes',kind:'note',fileId:String(number),title:input.title,body:input.content,remote:{nativeId:number,category:input.category||''},collectionId:'notes',collectionTitle:input.category||'Uncategorized (default)',etag:'created-v1',readonly:false,tagDetails:[],tags:[]});state.createdRecordId=id;return read()},
    updateNote:async input=>{remember('updateNote',input);if(window.__failNoteSave)throw new Error('Fixture note content save failed');const record=state.records.find(item=>item.id===input.id);if(record.etag!==input.etag)throw new Error('Fixture stale note version');const category=input.category??record.remote.category;Object.assign(record,{title:input.title,body:input.content,etag:'updated-'+(++sequence),remote:{...record.remote,category},collectionTitle:category||'Uncategorized (default)'});return read()},
    listFiles:async()=>({path:'/',files:[{id:'555',name:'Asset.pdf',path:'/Asset.pdf',directory:false,size:8192}]}),
    openExternal:async()=>{},readPage:async()=>({body:''}),
  }
},fixture)
const inspector=()=>page.getByRole('complementary',{name:'Item details'})
const dialog=()=>page.getByRole('dialog',{name:'Attach notes or files',exact:true})
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const writes=method=>page.evaluate(method=>window.__noteWrites.filter(write=>write.method===method),method)
async function openListItem(title){await page.getByRole('tab',{name:'List',exact:true}).click();await page.getByLabel('Search this view',{exact:true}).fill(title);await page.locator('.list-table-row').filter({hasText:title}).click();await inspector().getByRole('heading',{name:title,exact:true,level:2}).waitFor()}
async function linkPicker(){await inspector().getByRole('button',{name:'Attach',exact:true}).click();await dialog().waitFor()}
async function openLinked(title){await inspector().locator('.linked-notes-section .inspector-linked-row>button:first-child').filter({hasText:title}).click();await inspector().getByRole('heading',{name:title,exact:true,level:2}).waitFor()}

try{
  await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173')
  await page.waitForFunction(async()=>{const state=await window.workspaceApi.getState();return state.records.find(item=>item.id==='card-gig').attachmentFileIds?.includes('101')&&!state.workspace.relations.some(edge=>['relation-note','legacy-related-note'].includes(edge.id))})
  await openListItem('Deliver the final cut')
  await inspector().locator('.linked-notes-section').getByText('Attached in Deck',{exact:true}).waitFor()
  assert.equal(await inspector().getByRole('button',{name:'Attach in Deck',exact:true}).count(),0)
  assert.ok((await writes('migrateDeckNoteLinks')).length>=1)
  await openListItem('Plan the weekend')
  assert.equal(await inspector().locator('.linked-notes-section .inspector-linked-row').count(),0,'An unconfirmed migration must not be displayed as a native link')
  assert.ok((await backend()).workspace.relations.some(edge=>edge.id==='legacy-note-pending'),'The pending migration intent remains available for retry')
  checks.push('Existing custom card-note links migrate automatically to native Deck attachments; old reference and related copies disappear without a special per-row action')
  await openListItem('Edit the opening sequence')
  await linkPicker()
  await dialog().getByRole('checkbox',{name:'Client brief',exact:true}).check()
  await dialog().getByRole('checkbox',{name:'Production reference',exact:true}).check()
  await page.screenshot({path:'artifacts/notes-multi-picker.png',fullPage:false})
  await page.evaluate(()=>window.__failAttachNote='note-production')
  await dialog().getByRole('button',{name:'Link 2 notes',exact:true}).click()
  await dialog().getByRole('alert').waitFor()
  assert.equal(await dialog().getByRole('checkbox',{name:'Client brief',exact:true}).isDisabled(),true)
  assert.equal(await dialog().getByRole('checkbox',{name:'Production reference',exact:true}).isChecked(),true)
  await page.evaluate(()=>window.__failAttachNote='')
  await dialog().getByRole('button',{name:'Link 1 note',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  assert.deepEqual((await writes('attachDeckFile')).map(write=>write.input.noteId),['note-brief','note-production','note-production'])
  assert.deepEqual((await backend()).records.find(item=>item.id==='card-mine').attachmentFileIds,['101','102'])
  assert.equal((await backend()).workspace.relations.some(edge=>edge.fromId==='card-mine'&&edge.type==='reference'),false)
  assert.equal(await inspector().locator('.linked-notes-section').getByText('Attached in Deck',{exact:true}).count(),2)
  checks.push('Bulk Deck note links create native attachments; a failed subset retries without duplicating successful attachments or custom relations')

  await openLinked('Client brief')
  await inspector().getByRole('button',{name:'Back to previous item',exact:true}).waitFor()
  await inspector().getByRole('button',{name:'Action needed',exact:true}).click()
  await page.waitForFunction(()=>window.__noteWrites.some(write=>write.method==='setNoteTags'))
  assert.deepEqual((await writes('setNoteTags')).at(-1).input.tagIds,[])
  assert.deepEqual((await writes('setNoteTags')).at(-1).input.newTags,['Action needed'])
  await inspector().getByRole('button',{name:'Edit note tags',exact:true}).click()
  await inspector().getByLabel('Find note tags',{exact:true}).fill('Client delivery')
  await inspector().getByRole('button',{name:'Create “Client delivery”',exact:true}).click()
  await page.evaluate(()=>window.__failNoteTags=true)
  await inspector().getByRole('button',{name:'Done',exact:true}).click()
  await inspector().getByRole('dialog',{name:'Note tags'}).getByRole('alert').waitFor()
  await inspector().getByRole('button',{name:'Back to previous item',exact:true}).click()
  assert.equal(await inspector().getByRole('heading',{name:'Client brief',exact:true,level:2}).count(),1)
  assert.equal((await writes('setNoteTags')).length,2,'Navigation must not silently retry a failed tag save')
  await page.evaluate(()=>window.__failNoteTags=false)
  if(!await inspector().getByRole('button',{name:'Retry',exact:true}).isVisible())await inspector().getByRole('button',{name:'Edit note tags',exact:true}).click()
  await inspector().getByRole('button',{name:'Retry',exact:true}).click()
  await page.waitForFunction(async()=>{const state=await window.workspaceApi.getState();return state.records.find(item=>item.id==='note-brief').tags.includes('Client delivery')})
  checks.push('Linked work suggests native note tags; multi-tag creation saves through Files, and a failed tag save blocks navigation until retried')

  await inspector().getByRole('button',{name:'Expand note editor',exact:true}).click()
  const editor=page.getByRole('dialog',{name:'Edit note',exact:true})
  await editor.getByLabel('Note title',{exact:true}).fill('Client brief updated')
  assert.equal(await editor.getByLabel('Note category',{exact:true}).count(),0)
  assert.equal(await page.locator('.note-tags-editor:visible').count(),1)
  await page.screenshot({path:'artifacts/notes-expanded-editor.png',fullPage:false})
  await editor.getByRole('tab',{name:'Markdown',exact:true}).click()
  await editor.getByLabel('Note content',{exact:true}).fill('# Production brief\n\n- [ ] Review delivery')
  await editor.getByRole('button',{name:'Back to side panel',exact:true}).click()
  await editor.waitFor({state:'hidden'})
  assert.equal(await inspector().getByLabel('Title',{exact:true}).inputValue(),'Client brief updated')
  page.once('dialog',event=>event.dismiss())
  await inspector().getByRole('button',{name:'Back to previous item',exact:true}).click()
  assert.equal(await inspector().getByRole('heading',{name:'Client brief',exact:true,level:2}).count(),1)
  await inspector().getByRole('button',{name:'Expand note editor',exact:true}).click()
  assert.equal(await editor.getByLabel('Note title',{exact:true}).inputValue(),'Client brief updated')
  await page.evaluate(()=>window.__failNoteSave=true)
  await editor.getByRole('button',{name:'Save note',exact:true}).click()
  await editor.getByRole('alert').waitFor()
  assert.equal(await editor.getByLabel('Note title',{exact:true}).inputValue(),'Client brief updated')
  await page.evaluate(()=>window.__failNoteSave=false)
  await editor.getByRole('button',{name:'Save note',exact:true}).click()
  await editor.waitFor({state:'hidden'})
  await inspector().getByRole('heading',{name:'Client brief updated',exact:true}).waitFor()
  const updated=(await backend()).records.find(item=>item.id==='note-brief')
  assert.equal(updated.remote.category,'Research');assert.equal(updated.body,'# Production brief\n\n- [ ] Review delivery')
  assert.equal(Object.hasOwn((await writes('updateNote')).at(-1).input,'category'),false)
  assert.equal((await writes('updateNote')).at(-1).input.base.category,'Research')
  assert.ok(updated.tags.includes('Client delivery'))
  await inspector().getByRole('button',{name:'Back to previous item',exact:true}).click()
  await inspector().getByRole('heading',{name:'Edit the opening sequence',exact:true}).waitFor()
  checks.push('Back navigation restores the originating card; expanded editing preserves drafts across resizing, failed saves and attempted navigation without changing the native folder')

  await openListItem('Prepare review notes')
  await linkPicker()
  await dialog().getByRole('checkbox',{name:'Client brief updated',exact:true}).check()
  await dialog().getByRole('checkbox',{name:'Production reference',exact:true}).check()
  await dialog().getByRole('button',{name:'Link 2 notes',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  assert.equal((await backend()).workspace.relations.filter(edge=>edge.fromId==='task-today'&&edge.type==='reference').length,2)
  assert.equal((await writes('attachDeckFile')).length,3)
  checks.push('Task note references remain synced planner relationships where there is no native Deck attachment destination')

  await linkPicker()
  await dialog().getByRole('tab',{name:'Create a note',exact:true}).click()
  await dialog().getByLabel('New note title',{exact:true}).fill('New review checklist')
  assert.equal(await dialog().getByRole('button',{name:/^Suggested category:/}).count(),0)
  await dialog().getByLabel('New note folder',{exact:true}).fill('Freelance')
  await dialog().getByRole('button',{name:'Create note',exact:true}).click()
  await dialog().getByRole('checkbox',{name:'New review checklist',exact:true}).waitFor()
  assert.equal(await dialog().getByRole('checkbox',{name:'New review checklist',exact:true}).isChecked(),true)
  await dialog().getByRole('button',{name:'Link 1 note',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  assert.equal((await writes('createNote')).length,1)
  const created=(await backend()).records.find(item=>item.title==='New review checklist')
  assert.equal(created.remote.category,'Freelance')
  assert.ok((await backend()).workspace.relations.some(edge=>edge.fromId==='task-today'&&edge.toId===created.id))
  checks.push('The selection dialog creates a real categorized note and links its retained creation receipt without a duplicate')

  await linkPicker()
  await dialog().getByRole('tab',{name:'Create a note',exact:true}).click()
  await dialog().getByLabel('New note title',{exact:true}).fill('Unsaved draft kept across tabs')
  await dialog().getByRole('tab',{name:'Existing notes',exact:true}).click()
  page.once('dialog',event=>event.dismiss())
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
  await dialog().getByRole('tab',{name:'Create a note',exact:true}).click()
  assert.equal(await dialog().getByLabel('New note title',{exact:true}).inputValue(),'Unsaved draft kept across tabs')
  page.once('dialog',event=>event.accept())
  await dialog().getByRole('button',{name:'Close dialog',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  checks.push('Switching from Create to Existing notes keeps hidden drafts dirty and cancellation asks before discarding them')

  await page.screenshot({path:'artifacts/notes-native-workflow.png',fullPage:false})
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:checks.length,checks},null,2))
}catch(error){
  await page.screenshot({path:'artifacts/notes-native-failure.png',fullPage:false}).catch(()=>{})
  throw error
}finally{await browser.close()}
