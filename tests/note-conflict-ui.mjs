/** App drafts and review actions through the real Notes connector, using only an in-memory HTTP fixture. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'
import {plannerFixture} from './fixtures.mjs'

await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const checks=[],errors=[]
const initial={id:101,title:'Client brief',content:'# Original brief\n\nOriginal interview notes.',category:'Research',etag:'note-v1',favorite:false}
const originalBase={title:initial.title,content:initial.content,category:initial.category}
const localText='# My edited brief\n\nLocal interview preparation.'
let activePage

async function scenario(run){
  const context=await browser.newContext({viewport:{width:1600,height:1100},timezoneId:'Europe/Budapest'})
  const page=await context.newPage();activePage=page
  page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message))
  const state=plannerFixture(new Date(2026,10,11,9));state.workspace.appearance.mode='dark';state.workspace.planner.view='list'
  const cached=state.records.find(item=>item.id==='note-brief')
  Object.assign(cached,{body:initial.content,remote:{nativeId:101,category:initial.category},fileId:'101',etag:initial.etag})
  const backend={remote:structuredClone(initial),writes:[],http:[],failWrites:0,failReads:0}
  const client=new NextcloudClient({serverUrl:'https://fixture.invalid',username:'fixture-user',appPassword:'fixture-only'}, {fetch:async(url,options)=>{
    assert.ok(url.endsWith('/notes/api/v1/notes/101'),'Only the test note endpoint is allowed')
    backend.http.push({method:options.method||'GET',etag:options.headers['If-Match'],body:options.body?JSON.parse(options.body):undefined})
    const response=(value,status=200)=>new Response(JSON.stringify(value),{status})
    if(options.method!=='PUT'){
      if(backend.failReads){backend.failReads--;return response({error:'Fixture unavailable'},503)}
      return response(backend.remote)
    }
    if(backend.beforeWrite){const pause=backend.beforeWrite;backend.beforeWrite=undefined;await pause()}
    if(backend.failWrites){backend.failWrites--;return response({error:'Fixture unavailable'},503)}
    if(options.headers['If-Match']!==`"${backend.remote.etag}"`)return response(backend.remote,412)
    backend.remote={...backend.remote,...JSON.parse(options.body),etag:backend.remote.etag+'-saved'}
    return response(backend.remote)
  }})
  const adopt=note=>Object.assign(cached,{title:note.title,body:note.content,etag:note.etag,readonly:Boolean(note.readonly),collectionTitle:note.category||'Uncategorized (default)',remote:{...cached.remote,category:note.category}})
  await page.exposeFunction('__noteFixtureBridge',async(method,input)=>{
    if(method==='getState')return structuredClone(state)
    if(method==='refresh'){adopt(backend.remote);return structuredClone(state)}
    if(method==='saveWorkspace'){state.workspace=structuredClone(input.workspace);state.revision++;return {workspace:state.workspace,revision:state.revision,storage:state.storage}}
    if(method==='updateNote'){
      backend.writes.push(structuredClone(input));const saved=await client.updateNote(input,structuredClone(cached));adopt(saved);return structuredClone(state)
    }
    if(method==='readNote'){const note=await client.readNote(cached);return {...note,id:cached.id,readonly:Boolean(note.readonly)}}
    throw new Error('Unsupported fixture operation '+method)
  })
  await page.addInitScript(()=>{
    const invoke=(method,input)=>window.__noteFixtureBridge(method,input)
    window.workspaceApi={getState:()=>invoke('getState'),refresh:()=>invoke('refresh'),syncWorkspace:()=>invoke('getState'),saveWorkspace:(workspace,revision)=>invoke('saveWorkspace',{workspace,revision}),updateNote:input=>invoke('updateNote',input),readNote:input=>invoke('readNote',input),openExternal:async()=>{},readPage:async()=>({body:''})}
  })
  const inspector=()=>page.getByRole('complementary',{name:'Item details'})
  const editor=()=>page.getByRole('dialog',{name:'Edit note',exact:true})
  const review=()=>page.getByRole('dialog',{name:'Review note versions',exact:true})
  const markdown=async()=>{await editor().getByRole('tab',{name:'Markdown',exact:true}).click();return editor().getByLabel('Note content',{exact:true})}
  const begin=async()=>{await inspector().getByRole('button',{name:'Expand note editor',exact:true}).click();await editor().waitFor();return markdown()}
  const save=async()=>editor().getByRole('button',{name:'Save note',exact:true}).click()
  const expectFailure=async()=>{await editor().getByRole('alert').waitFor();assert.equal(await (await markdown()).inputValue(),localText)}
  const openReview=async()=>{await editor().getByRole('button',{name:'Review Nextcloud version',exact:true}).click();await review().waitFor()}
  try{
    await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173')
    await page.getByRole('tab',{name:'List',exact:true}).click()
    await page.getByLabel('Search this view',{exact:true}).fill('Client brief')
    await page.locator('.list-table-row').filter({hasText:'Client brief'}).click()
    await inspector().getByRole('heading',{name:'Client brief',exact:true,level:2}).waitFor()
    await run({page,backend,cached,inspector,editor,review,markdown,begin,save,expectFailure,openReview})
  }catch(error){await page.screenshot({path:'artifacts/note-conflict-failure.png',fullPage:false}).catch(()=>{});throw error}
  finally{await context.close()}
}

try{
  await scenario(async({backend,cached,inspector,editor,begin,save})=>{
    await (await begin()).fill(localText)
    backend.remote={...backend.remote,title:'Server renamed brief',category:'Interviews',favorite:true,etag:'remote-v2'}
    await save();await editor().waitFor({state:'hidden'})
    await inspector().getByRole('heading',{name:'Server renamed brief',exact:true}).waitFor()
    assert.deepEqual(backend.writes[0].base,originalBase)
    assert.equal(backend.writes[0].etag,'note-v1')
    assert.equal(cached.body,localText);assert.equal(cached.remote.category,'Interviews');assert.equal(backend.remote.favorite,true)
    const puts=backend.http.filter(call=>call.method==='PUT')
    assert.equal(puts.length,2);assert.equal(puts[0].etag,'"note-v1"');assert.equal(puts[1].etag,'"remote-v2"')
    assert.deepEqual(puts[1].body,{content:localText})
    checks.push('Stale note versions safely merge independent remote title/category/favorite changes with the local text using the frozen original baseline')
  })

  await scenario(async({page,backend,cached,editor,review,markdown,begin,save,expectFailure,openReview})=>{
    await (await begin()).fill(localText)
    backend.remote={...backend.remote,title:'Remote interview brief',content:'# Server version\n\nNotes from another device.',category:'Interview preparation',etag:'remote-v2'}
    await save();await expectFailure()
    assert.equal(backend.http.filter(call=>call.method==='PUT').length,1)
    await openReview()
    const columns=review().locator('.note-version-columns>section')
    assert.match(await columns.nth(0).innerText(),/Local interview preparation/)
    assert.match(await columns.nth(1).innerText(),/Notes from another device/)
    await page.screenshot({path:'artifacts/note-conflict-review.png',fullPage:false})
    await review().getByRole('button',{name:'Back to my draft',exact:true}).click()
    assert.equal(await (await markdown()).inputValue(),localText)
    assert.equal(await editor().getByLabel('Note title',{exact:true}).inputValue(),initial.title)
    await openReview()
    await review().getByRole('button',{name:'Save my changes',exact:true}).click()
    await editor().waitFor({state:'hidden'});await review().waitFor({state:'hidden'})
    const replacement=backend.writes.at(-1)
    assert.equal(replacement.etag,'remote-v2')
    assert.deepEqual(replacement.base,{title:'Remote interview brief',content:'# Server version\n\nNotes from another device.',category:'Interview preparation'})
    assert.equal(replacement.title,'Remote interview brief');assert.equal(Object.hasOwn(replacement,'category'),false);assert.equal(replacement.content,localText)
    assert.equal(cached.title,'Remote interview brief');assert.equal(cached.body,localText)
    assert.equal(await page.getByRole('button',{name:'Retry edit',exact:true}).count(),0)
    checks.push('Concurrent text edits open both versions; Back preserves the exact draft, and explicit Save my changes uses the freshly reviewed validator while preserving unrelated server fields')
  })

  await scenario(async({page,backend,inspector,editor,review,begin,save,expectFailure,openReview})=>{
    await (await begin()).fill(localText)
    backend.remote={...backend.remote,title:'Accepted server brief',content:'# Accepted server text',category:'Interviews',etag:'remote-v2'}
    await save();await expectFailure();await openReview()
    await review().getByRole('button',{name:'Use Nextcloud version',exact:true}).click()
    await review().waitFor({state:'hidden'})
    await inspector().getByRole('heading',{name:'Accepted server brief',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Retry edit',exact:true}).count(),0)
    assert.equal(await editor().count(),0)
    const draft=await begin();assert.equal(await draft.inputValue(),'# Accepted server text')
    await draft.fill('# Follow-up edit')
    await save();await editor().waitFor({state:'hidden'})
    assert.equal(backend.writes.at(-1).etag,'remote-v2')
    assert.deepEqual(backend.writes.at(-1).base,{title:'Accepted server brief',content:'# Accepted server text',category:'Interviews'})
    assert.equal(backend.remote.content,'# Follow-up edit')
    checks.push('Use Nextcloud version discards the failed queued edit and reopens later editing against the accepted current title, text, category and version')
  })

  await scenario(async({page,backend,inspector,editor,begin,save,expectFailure})=>{
    await (await begin()).fill(localText);backend.failWrites=1
    await save();await expectFailure()
    const originalWrite=structuredClone(backend.writes[0])
    await editor().getByRole('button',{name:'Back to side panel',exact:true}).click()
    await page.getByRole('button',{name:'Retry edit',exact:true}).click()
    await page.waitForFunction(async()=>{const state=await window.workspaceApi.getState();return state.records.find(item=>item.id==='note-brief').body.includes('Local interview preparation')})
    assert.deepEqual(backend.writes[1],originalWrite)
    assert.equal(backend.remote.content,localText)
    assert.equal(await page.getByRole('button',{name:'Retry edit',exact:true}).count(),0)
    assert.equal(await inspector().locator('.note-editor').count(),0)
    assert.equal(await inspector().getByRole('alert').count(),0)
    assert.equal(await inspector().getByRole('button',{name:'Edit',exact:true}).count(),1)
    checks.push('A failed request keeps the draft; successful queued retry uses the original reference and closes the unchanged editor without a stale error')
  })

  await scenario(async({page,backend,inspector,editor,markdown,begin,save,expectFailure})=>{
    await (await begin()).fill(localText);backend.failWrites=1
    await save();await expectFailure()
    // Reverting to the original text is still a NEW edit after the failed save.
    await (await markdown()).fill(initial.content)
    await editor().getByRole('button',{name:'Back to side panel',exact:true}).click()
    backend.remote={...backend.remote,title:'Renamed during retry',category:'Updated category',etag:'metadata-v2'}
    await page.getByRole('button',{name:'Retry edit',exact:true}).click()
    await page.waitForFunction(async()=>{const state=await window.workspaceApi.getState();return state.records.find(item=>item.id==='note-brief').body.includes('Local interview preparation')})
    await inspector().getByRole('button',{name:'Expand note editor',exact:true}).click()
    assert.equal(await (await markdown()).inputValue(),initial.content,'A reverted draft must not be replaced by the acknowledged retry')
    assert.equal(await editor().getByLabel('Note title',{exact:true}).inputValue(),'Renamed during retry')
    assert.equal(await editor().getByLabel('Note category',{exact:true}).count(),0)
    assert.equal(await editor().getByRole('alert').count(),0)
    await save();await editor().waitFor({state:'hidden'})
    const latest=backend.writes.at(-1)
    assert.equal(latest.base.content,localText);assert.equal(latest.etag,'metadata-v2-saved')
    assert.equal(latest.title,'Renamed during retry');assert.equal(latest.base.title,'Renamed during retry')
    assert.equal(backend.remote.content,initial.content)
    checks.push('Edits made before retry, including reverting text, remain unsaved; unchanged fields adopt remote changes and the next save uses the newly acknowledged baseline')
  })

  await scenario(async({page,backend,inspector,editor,markdown,begin,save,expectFailure})=>{
    await (await begin()).fill(localText);backend.failWrites=1
    await save();await expectFailure()
    await editor().getByRole('button',{name:'Back to side panel',exact:true}).click()
    let release,started
    const waiting=new Promise(resolve=>started=resolve)
    backend.beforeWrite=()=>{started();return new Promise(resolve=>release=resolve)}
    await page.getByRole('button',{name:'Retry edit',exact:true}).click();await waiting
    try{
      await inspector().getByRole('button',{name:'Expand note editor',exact:true}).click()
      await (await markdown()).fill('# New text typed while saving')
    }finally{release()}
    await page.waitForFunction(async()=>{const state=await window.workspaceApi.getState();return state.records.find(item=>item.id==='note-brief').body.includes('Local interview preparation')})
    assert.equal(await (await markdown()).inputValue(),'# New text typed while saving')
    assert.equal(await editor().getByRole('alert').count(),0)
    await save();await editor().waitFor({state:'hidden'})
    assert.equal(backend.writes.at(-1).base.content,localText)
    assert.equal(backend.writes.at(-1).etag,'note-v1-saved')
    assert.equal(backend.remote.content,'# New text typed while saving')
    checks.push('Text entered during a retry is preserved and saved separately with the acknowledged validator')
  })

  await scenario(async({backend,editor,review,begin,save,expectFailure,openReview})=>{
    await (await begin()).fill(localText)
    backend.remote={...backend.remote,content:'First conflicting remote edit',etag:'remote-v2'}
    await save();await expectFailure();await openReview()
    backend.remote={...backend.remote,content:'New remote edit after review',etag:'remote-v3'}
    await review().getByRole('button',{name:'Save my changes',exact:true}).click()
    await expectFailure()
    assert.equal(backend.remote.content,'New remote edit after review')
    assert.equal(backend.writes.at(-1).etag,'remote-v2')
    assert.equal(backend.writes.at(-1).base.content,'First conflicting remote edit')
    await openReview();assert.match(await review().innerText(),/New remote edit after review/)
    checks.push('Changes arriving after conflict review cannot be overwritten; the fresh conflict keeps the local draft and supports reviewing the newer server note')
  })

  await scenario(async({backend,editor,review,markdown,begin,save,expectFailure})=>{
    await (await begin()).fill(localText);backend.failWrites=1
    await save();await expectFailure();backend.failReads=1
    await editor().getByRole('button',{name:'Review Nextcloud version',exact:true}).click()
    await editor().getByRole('alert').filter({hasText:'HTTP 503'}).waitFor()
    assert.equal(await review().count(),0)
    assert.equal(await (await markdown()).inputValue(),localText)
    checks.push('Failure to read the server version leaves the current editor and unsaved text available')
  })
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:checks.length,checks},null,2))
}catch(error){
  if(activePage&&!activePage.isClosed())await activePage.screenshot({path:'artifacts/note-conflict-failure.png',fullPage:false}).catch(()=>{})
  throw error
}finally{await browser.close()}
