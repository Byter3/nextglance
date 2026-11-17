/** PRESENT-05: exercise the real Windows entry with omitted capability options.
 * Fast dev-server transforms only; no app build and no real account/network writes.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {readFile,mkdir} from 'node:fs/promises'
import {createServer as createHttpServer} from 'node:http'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import {plannerFixture} from '../../tests/fixtures.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url))
const built=process.argv.includes('--built'),dist=path.join(root,'win/dist')
const fixture=plannerFixture(new Date(2026,10,12,9))
fixture.workspace.planner.view='list'
fixture.workspace.appearance.mode='dark'
fixture.storage.syncStatus='synced'
fixture.workspace.relations=fixture.workspace.relations.filter(edge=>edge.id!=='relation-note')
Object.assign(fixture.records.find(record=>record.id==='note-brief'),{fileId:'101',body:'# Client brief\n\nOriginal content.',collectionTitle:'Research',remote:{nativeId:101,category:'Research'},tagDetails:[{id:'1',title:'Managed team',assignable:false},{id:'2',title:'Review',assignable:true}],tags:['Managed team','Review']})
Object.assign(fixture.records.find(record=>record.id==='card-mine'),{attachmentFileIds:['101']})
const server=built?createHttpServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    const file=path.resolve(dist,pathname==='/'?'index.html':`.${pathname}`)
    if(!file.startsWith(`${dist}${path.sep}`))throw Error('Invalid asset path')
    const bytes=await readFile(file)
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream'})
    res.end(bytes)
  }catch{res.writeHead(404);res.end()}
}):await createServer({configFile:path.join(root,'win/vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'})
let browser,testPage
const errors=[]
try{
  if(built)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));else await server.listen()
  const origin=`http://127.0.0.1:${(built?server:server.httpServer).address().port}`
  browser=await chromium.launch({headless:true,channel:'msedge'})
  const page=await browser.newPage({viewport:{width:1600,height:1050},timezoneId:'Europe/Budapest'})
  testPage=page
  page.setDefaultTimeout(12000)
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort())
  await page.addInitScript(initial=>{
    const clone=value=>structuredClone(value),state=clone(initial)
    window.__nativeWrites=[]
    window.__fixtureState=state
    window.__failTags=false;window.__holdTags=false
    let tagSequence=100
    const read=async()=>clone(state)
    const record=(method,input)=>window.__nativeWrites.push({method,input:clone(input)})
    const assignedTags=id=>({tags:clone(state.records.find(item=>item.id===id).tagDetails||[]),availableTags:[]})
    window.workspaceApi={getState:read,refresh:read,syncWorkspace:read,
      saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale fixture revision');state.workspace=clone(workspace);state.revision++;return {workspace:clone(state.workspace),revision:state.revision,storage:clone(state.storage)}},
      updateTaskStatus:async input=>{record('updateTaskStatus',input);const item=state.records.find(item=>item.id===input.id);if(item.etag!==input.etag)throw new Error('Stale task fixture');Object.assign(item,{status:input.status,completed:input.status==='COMPLETED',percentComplete:input.status==='IN-PROCESS'?1:0,etag:'task-v2'});return read()},
      updateNote:async input=>{record('updateNote',input);const item=state.records.find(item=>item.id===input.id);if(item.etag!==input.etag)throw new Error('Stale note fixture');Object.assign(item,{title:input.title,body:input.content,etag:'note-v2',remote:{...item.remote,...(Object.hasOwn(input,'category')?{category:input.category}:{})}});return read()},
      readNoteTags:async({id})=>assignedTags(id),
      setNoteTags:async input=>{record('setNoteTags',input);if(window.__holdTags)await new Promise(resolve=>{window.__releaseTags=resolve});if(window.__failTags)throw Error('Fixture native tag save failed');const item=state.records.find(item=>item.id===input.id);item.tagDetails=[...item.tagDetails.filter(tag=>tag.assignable===false||input.tagIds.includes(tag.id)),...(input.newTags||[]).map(title=>({id:String(++tagSequence),title,assignable:true}))];item.tags=item.tagDetails.map(tag=>tag.title);return assignedTags(input.id)},
      readDeckAttachments:async({id})=>({attachments:id==='card-mine'?[{id:'attachment-101',type:'file',name:'Client brief.md',fileId:'101',path:'/Notes/Client brief.md',url:'https://fixture.invalid/f/101'}]:[]}),
      createLinkedEvent:async input=>{record('createLinkedEvent',input);if(input.expectedRevision!==state.revision)throw new Error('Stale schedule fixture');const id='fixture-booking';state.records.push({id,kind:'event',source:'calendar',title:input.title,start:input.start,end:input.end,allDay:input.allDay,collectionId:input.collectionId,collectionTitle:'Freelance calendar',readonly:false});state.workspace.relations.push({id:'fixture-booking-link',fromId:input.recordId,toId:id,type:'scheduled_during'});state.revision++;return read()},
      updateRecordDates:async()=>read(),openExternal:async()=>{},exportWorkspace:async()=>({exported:true}),
    }
  },fixture)
  const inspector=()=>page.getByRole('complementary',{name:'Item details'})
  const writes=method=>page.evaluate(method=>window.__nativeWrites.filter(write=>write.method===method),method)
  async function select(title){
    await page.getByRole('tab',{name:'List',exact:true}).click()
    await page.getByRole('textbox',{name:'Search this view',exact:true}).fill(title)
    await page.locator('.list-table-row').filter({hasText:title}).click()
    await inspector().getByRole('heading',{name:title,exact:true,level:2}).waitFor()
  }
  await page.goto(origin)
  await select('Prepare review notes')
  assert.equal(await inspector().getByRole('combobox',{name:'Task status',exact:true}).isEnabled(),true,'Omitted Windows canMutateNative must default to true at the actual Vue mount')
  await inspector().getByRole('combobox',{name:'Task status',exact:true}).click()
  await page.getByRole('listbox',{name:'Task status',exact:true}).getByRole('option',{name:'In progress',exact:true}).click()
  await page.waitForFunction(()=>window.__nativeWrites.some(write=>write.method==='updateTaskStatus'))
  assert.deepEqual((await writes('updateTaskStatus'))[0].input,{id:'task-today',status:'IN-PROCESS',etag:'task-v1'})
  await select('Edit the opening sequence')
  assert.equal(await inspector().getByRole('button',{name:'Schedule in calendar',exact:true}).isEnabled(),true)
  await inspector().locator('.linked-notes-section .inspector-linked-row>button:first-child').filter({hasText:'Client brief'}).click()
  await inspector().getByRole('heading',{name:'Client brief',exact:true,level:2}).waitFor()
  assert.equal(await page.locator('.note-tags-editor:visible').count(),1)
  assert.match(await inspector().locator('.inspector-collection').innerText(),/Folder:.*Research/)
  await inspector().getByRole('button',{name:'Edit note tags',exact:true}).click()
  const tagPicker=()=>page.getByRole('dialog',{name:'Note tags',exact:true})
  assert.equal(await tagPicker().getByRole('checkbox',{name:'Managed team Managed',exact:true}).isDisabled(),true)
  await tagPicker().getByRole('checkbox',{name:'Review',exact:true}).uncheck()
  await tagPicker().getByRole('checkbox',{name:'Review',exact:true}).check()
  await tagPicker().getByLabel('Find note tags',{exact:true}).fill('Delivery')
  await tagPicker().getByRole('button',{name:'Create “Delivery”',exact:true}).click()
  await page.evaluate(()=>window.__holdTags=true)
  await tagPicker().getByRole('button',{name:'Done',exact:true}).click()
  await page.waitForFunction(()=>typeof window.__releaseTags==='function')
  // The open picker overlaps the pointer target; keyboard users can still expand.
  await inspector().getByRole('button',{name:'Expand note editor',exact:true}).focus()
  await page.keyboard.press('Enter')
  const noteEditor=page.getByRole('dialog',{name:'Edit note',exact:true})
  await noteEditor.waitFor()
  await noteEditor.locator('.note-tags-editor:visible').waitFor()
  assert.equal(await page.locator('.note-tags-editor:visible').count(),1,'The same tagging surface moves into the expanded editor')
  assert.equal(await noteEditor.locator('.note-tags-editor:visible').count(),1)
  const modalBackground=await noteEditor.locator('.modal-content').evaluate(element=>getComputedStyle(element).backgroundColor)
  const alpha=modalBackground.match(/\/\s*([\d.]+)\s*\)/)?.[1]||modalBackground.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)?.[1]||'1'
  assert.equal(Number(alpha),1,'Expanded Notes must have an opaque reading background')
  assert.equal(await page.getByLabel('Note category',{exact:true}).count(),0)
  assert.equal(await page.getByLabel('Nextcloud Notes category',{exact:true}).count(),0)
  await page.evaluate(()=>{window.__holdTags=false;window.__releaseTags()})
  await tagPicker().waitFor({state:'hidden'})
  assert.deepEqual((await writes('setNoteTags'))[0].input,{id:'note-brief',tagIds:['1','2'],newTags:['Delivery']})
  assert.equal((await writes('updateNote')).length,0,'Tagging never writes note content or its folder')
  assert.match(await noteEditor.locator('.note-tag-chips').innerText(),/Delivery/)
  await mkdir(path.join(root,'artifacts/windows-notes-tags'),{recursive:true})
  await page.screenshot({path:path.join(root,`artifacts/windows-notes-tags/expanded-${built?'built':'dev'}.png`)})
  await noteEditor.getByRole('tab',{name:'Markdown',exact:true}).click()
  await noteEditor.getByLabel('Note content',{exact:true}).fill('Unsaved content survives tag transitions')
  await noteEditor.getByRole('button',{name:'Edit note tags',exact:true}).click()
  await tagPicker().getByLabel('Find note tags',{exact:true}).fill('Retry tag')
  await tagPicker().getByRole('button',{name:'Create “Retry tag”',exact:true}).click()
  await page.evaluate(()=>window.__failTags=true)
  await tagPicker().getByRole('button',{name:'Done',exact:true}).click()
  await tagPicker().getByRole('alert').waitFor()
  const tagAttempts=(await writes('setNoteTags')).length
  await noteEditor.getByRole('button',{name:'Back to side panel',exact:true}).click()
  await noteEditor.waitFor({state:'hidden'})
  assert.equal(await inspector().locator('.note-tags-editor:visible').count(),1)
  assert.equal(await inspector().getByLabel('Nextcloud Notes category',{exact:true}).count(),0)
  await inspector().getByRole('button',{name:'Expand note editor',exact:true}).focus()
  await page.keyboard.press('Enter')
  assert.equal((await writes('setNoteTags')).length,tagAttempts,'Moving between editors never silently retries a failed native tag write')
  assert.equal(await noteEditor.getByLabel('Note content',{exact:true}).inputValue(),'Unsaved content survives tag transitions')
  assert.equal(await tagPicker().getByRole('checkbox',{name:'Retry tag',exact:true}).isChecked(),true)
  await page.evaluate(()=>window.__failTags=false)
  await tagPicker().getByRole('button',{name:'Retry',exact:true}).click()
  await tagPicker().waitFor({state:'hidden'})
  page.once('dialog',dialog=>dialog.accept())
  await noteEditor.getByRole('button',{name:'Cancel changes',exact:true}).click()
  await noteEditor.waitFor({state:'hidden'})
  assert.equal((await writes('updateNote')).length,0)
  assert.match(await inspector().locator('.note-tag-chips').innerText(),/Delivery/)
  assert.match(await inspector().locator('.note-tag-chips').innerText(),/Retry tag/)
  await inspector().getByRole('button',{name:'Back to previous item',exact:true}).click()
  await inspector().locator('.linked-notes-section .inspector-linked-row>button:first-child').filter({hasText:'Client brief'}).click()
  await inspector().getByRole('heading',{name:'Client brief',exact:true,level:2}).waitFor()
  assert.match(await inspector().locator('.note-tag-chips').innerText(),/Retry tag/,'Reopening loads the acknowledged native assignments')
  await inspector().getByRole('button',{name:'Expand note editor',exact:true}).click()
  await noteEditor.getByRole('tab',{name:'Markdown',exact:true}).click()
  await noteEditor.getByLabel('Note content',{exact:true}).fill('# Client brief\n\nEdited through the linked note.')
  await page.evaluate(()=>{window.__fixtureState.records.find(item=>item.id==='note-brief').remote.category='Remote folder'})
  await noteEditor.getByRole('button',{name:'Save note',exact:true}).click()
  await noteEditor.waitFor({state:'hidden'})
  const noteWrite=(await writes('updateNote'))[0].input
  assert.equal(noteWrite.id,'note-brief');assert.equal(noteWrite.etag,'note-v1');assert.equal(noteWrite.content,'# Client brief\n\nEdited through the linked note.')
  assert.equal(Object.hasOwn(noteWrite,'category'),false,'Ordinary content edits cannot move a note folder')
  assert.equal(noteWrite.base.category,'Research','Concurrency uses the frozen original folder baseline')
  const updatedNote=await page.evaluate(()=>window.__fixtureState.records.find(item=>item.id==='note-brief'))
  assert.equal(updatedNote.remote.category,'Remote folder')
  assert.deepEqual(updatedNote.tags,['Managed team','Review','Delivery','Retry tag'])
  await inspector().getByRole('button',{name:'Back to previous item',exact:true}).click()
  await inspector().getByRole('heading',{name:'Edit the opening sequence',exact:true,level:2}).waitFor()
  await inspector().getByRole('button',{name:'Schedule in calendar',exact:true}).click()
  const schedule=page.getByRole('dialog')
  await schedule.getByRole('combobox',{name:'Calendar',exact:true}).selectOption('calendar-work')
  await schedule.getByLabel('Event title',{exact:true}).fill('Opening sequence work session')
  await schedule.locator('summary').filter({hasText:'Exact dates'}).click()
  await schedule.getByLabel('Start',{exact:true}).fill('2026-11-13T11:00')
  await schedule.getByLabel('End',{exact:true}).fill('2026-11-13T12:00')
  await schedule.getByRole('button',{name:'Create & link',exact:true}).click()
  await schedule.waitFor({state:'hidden'})
  const booking=(await writes('createLinkedEvent'))[0].input
  assert.equal(booking.recordId,'card-mine');assert.equal(booking.collectionId,'calendar-work')
  assert.equal(booking.start,'2026-11-13T10:00:00.000Z');assert.equal(booking.end,'2026-11-13T11:00:00.000Z')
  assert.ok(booking.requestId)
  const saved=await page.evaluate(()=>window.workspaceApi.getState())
  assert.ok(saved.workspace.relations.some(edge=>edge.type==='scheduled_during'&&edge.fromId==='card-mine'&&edge.toId==='fixture-booking'))
  // Successful host defaults must not bypass record readonly or source verification.
  await page.evaluate(()=>{window.__fixtureState.records.find(item=>item.id==='task-today').readonly=true;window.__fixtureState.statuses.find(item=>item.source==='calendar').state='error'})
  await page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).click()
  await select('Prepare review notes')
  assert.equal(await inspector().getByRole('combobox',{name:'Task status',exact:true}).isDisabled(),true)
  await select('Edit the opening sequence')
  assert.equal(await inspector().getByRole('button',{name:'Schedule in calendar',exact:true}).isDisabled(),true)
  assert.equal((await writes('updateTaskStatus')).length,1)
  assert.equal((await writes('createLinkedEvent')).length,1)
  assert.deepEqual(errors,[])
  console.log(`PASS (${built?'production assets':'development entry'}): Windows native task/note/scheduling; one native tagging surface with pending/failed draft retention; tag-only writes and folder-preserving content saves; readonly/source verification; no renderer errors or live requests.`)
}catch(error){
  console.error('Renderer errors:',errors)
  if(testPage){console.error((await testPage.locator('body').innerText()).slice(-3000));await mkdir(path.join(root,'artifacts/windows-notes-tags'),{recursive:true});await testPage.screenshot({path:path.join(root,'artifacts/windows-notes-tags/failure.png')}).catch(()=>{})}
  throw error
}finally{await browser?.close();if(built)await new Promise(resolve=>server.close(resolve));else await server.close()}
