/** Resizable inspector and native Markdown editing through an isolated fixture bridge. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixture=plannerFixture(new Date(2026,10,2,9))
fixture.workspace.appearance.mode='dark'
const originalBody='# Editorial brief\n\nPrepare **final delivery** and *client review* with `scene_010`.\n\n- Opening sequence\n- Final delivery\n\n'+Array.from({length:10},(_,index)=>`Paragraph ${index+1}: The description should remain readable inside a generously sized inspector without a tiny nested scrolling box.`).join('\n\n')
for(const id of ['card-mine','task-today','event-review'])Object.assign(fixture.records.find(record=>record.id===id),{body:originalBody,etag:`fixture-${id}-v1`})
fixture.records.push({...fixture.records.find(record=>record.id==='task-today'),id:'readonly-task',title:'Read-only shared task',readonly:true,body:'# Shared instructions\n\nThis is **read-only**.\n\n- [ ] Read-only checkbox',etag:'readonly-v1'})
const checklistBody='# Checklist\r\n\r\n- [ ] Same\r\n- [x] Same\r\n\r\n```md\r\n- [ ] Example\r\n```\r\n\r\n    - [ ] Indented\r\n'
const richBody='# Visual brief\n\n**Bold** and *italic* with [source](https://example.invalid/brief).\n\n- Plain bullet\n\n1. First step\n2. Second step\n\n- [ ] Rich task\n- [x] Ready\n\n> Quote.\n\n```js\nconst answer = 42\n```\n\n| Name | State |\n| --- | --- |\n| Shot A | Ready |\n'
fixture.records.push({...fixture.records.find(record=>record.id==='task-today'),id:'checklist-task',title:'Checklist interaction test',body:checklistBody,etag:'checklist-v1'})
fixture.records.push({...fixture.records.find(record=>record.id==='card-mine'),id:'rich-card',title:'Visual editor round trip',body:richBody,etag:'rich-v1'})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const context=await browser.newContext({viewport:{width:1652,height:1050},timezoneId:'Europe/Budapest'})
const page=await context.newPage(),checks=[],errors=[]
page.setDefaultTimeout(12000)
page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(initial=>{
  let state=JSON.parse(sessionStorage.getItem('inspector-ui-fixture')||'null')||structuredClone(initial)
  window.__inspectorWrites=JSON.parse(sessionStorage.getItem('inspector-ui-writes')||'[]')
  window.__failNextDescription=false
  const remember=()=>{sessionStorage.setItem('inspector-ui-fixture',JSON.stringify(state));sessionStorage.setItem('inspector-ui-writes',JSON.stringify(window.__inspectorWrites))}
  const read=async()=>structuredClone(state)
  window.workspaceApi={
    getState:read,refresh:read,
    saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Stale fixture revision');state.workspace=structuredClone(workspace);state.revision++;remember();return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},
    updateDescription:async input=>{const record=state.records.find(record=>record.id===input.id);if(record.readonly)throw new Error('Read-only source');if(input.etag&&input.etag!==record.etag)throw new Error('Stale source etag');if(window.__failNextDescription){window.__failNextDescription=false;throw new Error('Fixture save failed; your draft is safe')}window.__inspectorWrites.push({method:'updateDescription',input:structuredClone(input)});record.body=input.description;record.etag=`updated-${record.id}`;remember();return read()},
    updateNote:async input=>{const record=state.records.find(record=>record.id===input.id);window.__inspectorWrites.push({method:'updateNote',input:structuredClone(input)});record.title=input.title;record.body=input.content;record.etag='updated-note';remember();return read()},
    openExternal:async()=>{},readPage:async()=>({body:''}),
  }
},fixture)
const inspector=()=>page.getByRole('complementary',{name:'Item details'})
const description=()=>inspector().locator('.description-section')
const editor=()=>description().locator('.markdown-editor')
const textarea=()=>editor().getByLabel('Markdown',{exact:true})
const divider=()=>page.getByRole('separator',{name:'Resize item details',exact:true})
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const writes=()=>page.evaluate(()=>window.__inspectorWrites)
const chooseDate=async()=>{await page.getByLabel('Choose calendar date').fill('2026-11-02');await page.getByLabel('Choose calendar date').dispatchEvent('change')}
async function openListItem(title){
  await page.getByRole('tab',{name:'List',exact:true}).click()
  await page.getByLabel('Search this view',{exact:true}).fill(title)
  await page.locator('.list-table-row').filter({hasText:title}).click()
  await inspector().getByRole('heading',{name:title,exact:true,level:2}).waitFor()
}
async function assertAligned(){await page.waitForFunction(()=>{
  const top=[...document.querySelectorAll('.overview-split .timeline-days>div')],bottom=[...document.querySelectorAll('.overview-split .calendar-day-track')]
  return top.length===bottom.length&&top.length>0&&top.every((element,index)=>{const a=element.getBoundingClientRect(),b=bottom[index].getBoundingClientRect();return Math.abs(a.left-b.left)<1.1&&Math.abs(a.width-b.width)<1.1})
},null,{timeout:4000})}
async function beginEdit(source=true){await description().getByRole('button',{name:'Edit',exact:true}).click();await editor().waitFor();if(source){await editor().getByRole('tab',{name:'Markdown',exact:true}).click();await textarea().waitFor()}}
async function saveDescription(){await description().getByRole('button',{name:'Save description',exact:true}).click();await editor().waitFor({state:'hidden'})}

try{
  await page.goto('http://127.0.0.1:5173')
  await page.locator('.overview-split').waitFor()
  await chooseDate()
  await page.locator('.timeline-row-label[data-record-id="card-mine"]').click()
  await inspector().getByRole('heading',{name:'Edit the opening sequence',exact:true}).waitFor()
  const initialWidth=(await inspector().boundingBox()).width
  assert.ok(initialWidth>=470&&initialWidth<=490,'The inspector starts with a larger reading width')
  const handle=await divider().boundingBox()
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2)
  await page.mouse.down();await page.mouse.move(handle.x+handle.width/2-160,handle.y+handle.height/2,{steps:10});await page.mouse.up()
  await page.waitForFunction(previous=>document.querySelector('.inspector').getBoundingClientRect().width>previous+130,initialWidth)
  const resizedWidth=(await inspector().boundingBox()).width
  await assertAligned()
  await divider().focus();await divider().press('ArrowLeft')
  assert.ok(Math.abs((await inspector().boundingBox()).width-resizedWidth-20)<2)
  await divider().press('ArrowRight')
  assert.ok(Math.abs((await inspector().boundingBox()).width-resizedWidth)<2)
  await divider().press('Shift+ArrowLeft')
  assert.ok(Math.abs((await inspector().boundingBox()).width-resizedWidth-80)<2)
  await divider().press('Shift+ArrowRight')
  await assertAligned()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.reload()
  await page.locator('.overview-split').waitFor()
  await chooseDate()
  await page.locator('.timeline-row-label[data-record-id="card-mine"]').click()
  await inspector().waitFor()
  assert.ok(Math.abs((await inspector().boundingBox()).width-resizedWidth)<2,'Inspector width survives reload and reopen')
  await assertAligned()
  checks.push('The inspector grows by dragging its left edge, supports keyboard resizing, persists width, and keeps Overview date columns aligned')

  await description().scrollIntoViewIfNeeded()
  const rendered=description().locator('.markdown-content')
  assert.equal(await rendered.locator('h1').innerText(),'Editorial brief')
  assert.equal(await rendered.locator('strong').innerText(),'final delivery')
  const textGeometry=await rendered.evaluate(element=>{const style=getComputedStyle(element);return {height:element.getBoundingClientRect().height,fontSize:parseFloat(style.fontSize),maxHeight:style.maxHeight,overflowY:style.overflowY}})
  assert.ok(textGeometry.height>300&&textGeometry.fontSize>=14,JSON.stringify(textGeometry))
  assert.ok(textGeometry.maxHeight==='none'||!['auto','scroll'].includes(textGeometry.overflowY),'Long descriptions use the inspector scroll area rather than a cramped nested box')
  await page.screenshot({path:'artifacts/inspector-readable-description.png',fullPage:true})
  await beginEdit()
  assert.equal(await textarea().inputValue(),originalBody)
  await textarea().fill('Unsaved replacement')
  page.once('dialog',dialog=>dialog.accept())
  await description().getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal((await backend()).records.find(record=>record.id==='card-mine').body,originalBody)
  assert.deepEqual(await writes(),[])
  checks.push('Long Markdown descriptions have readable space; cancelling an edit leaves source content untouched')

  await beginEdit()
  await textarea().fill('focus words')
  await textarea().evaluate(element=>{element.focus();element.setSelectionRange(0,5)})
  await editor().getByRole('button',{name:'Bold',exact:true}).click()
  assert.equal(await textarea().inputValue(),'**focus** words')
  await textarea().fill('emphasis')
  await textarea().press('Control+A');await textarea().press('Control+I')
  assert.equal(await textarea().inputValue(),'*emphasis*')
  const markdown='# Updated card brief\n\n**Strong direction**, *careful timing*, and `shot_020`.\n\n- [x] References ready\n- [ ] Final export\n\n> A clear review note.\n\n[Source brief](https://example.invalid/brief)\n\n<script>window.inspectorXss = true</script>\n\n[Unsafe link](javascript:alert(1))'
  await textarea().fill(markdown)
  await editor().getByRole('tab',{name:'Preview',exact:true}).click()
  const preview=editor().locator('.markdown-editor-preview')
  assert.equal(await preview.locator('h1').innerText(),'Updated card brief')
  assert.equal(await preview.locator('strong').innerText(),'Strong direction')
  assert.equal(await preview.locator('code').innerText(),'shot_020')
  assert.equal(await preview.locator('.markdown-task-checkbox[aria-checked="true"]').count(),1)
  assert.equal(await preview.locator('.markdown-task-checkbox[aria-checked="false"]').count(),1)
  assert.equal(await preview.locator('script,iframe,[onclick],[onerror],a[href^="javascript:"]').count(),0)
  assert.match(await preview.innerText(),/<script>window\.inspectorXss = true<\/script>/)
  assert.equal(await page.evaluate(()=>window.inspectorXss),undefined)
  await page.screenshot({path:'artifacts/inspector-markdown-preview.png',fullPage:true})
  await editor().getByRole('tab',{name:'Markdown',exact:true}).click()
  assert.equal(await textarea().inputValue(),markdown,'Preview switching preserves the exact Markdown draft')
  await saveDescription()
  assert.deepEqual((await writes()).at(-1),{method:'updateDescription',input:{id:'card-mine',description:markdown,etag:'fixture-card-mine-v1'}})
  assert.equal((await backend()).records.find(record=>record.id==='card-mine').body,markdown)
  assert.equal(await description().locator('.markdown-content h1').innerText(),'Updated card brief')
  checks.push('Markdown source and Preview preserve exact source, safely render HTML as text, and save the Deck description with its etag')

  for(const testCase of [{id:'task-today',title:'Prepare review notes',body:'# Updated task\n\n**Task description** saved to its source.'},{id:'event-review',title:'Client review',body:'# Updated meeting\n\n*Calendar context* saved to its source.'}]){
    await openListItem(testCase.title)
    await beginEdit();await textarea().fill(testCase.body)
    if(testCase.id==='task-today'){
      await page.evaluate(()=>window.__failNextDescription=true)
      await description().getByRole('button',{name:'Save description',exact:true}).click()
      await description().getByRole('alert').filter({hasText:'Fixture save failed; your draft is safe'}).waitFor()
      assert.equal(await textarea().inputValue(),testCase.body,'A failed save retains the exact editable draft')
      assert.equal((await backend()).records.find(record=>record.id===testCase.id).body,originalBody)
    }
    await saveDescription()
    assert.deepEqual((await writes()).at(-1),{method:'updateDescription',input:{id:testCase.id,description:testCase.body,etag:`fixture-${testCase.id}-v1`}})
    assert.equal((await backend()).records.find(record=>record.id===testCase.id).body,testCase.body)
  }
  checks.push('Task and calendar descriptions use the correct native payload; a failed save retains the draft for a safe retry')

  await openListItem('Checklist interaction test')
  assert.equal(await description().locator('.markdown-task-checkbox').count(),2,'Code examples are not interactive checklists')
  let count=(await writes()).length
  await description().locator('.markdown-task-checkbox').first().click()
  await page.waitForFunction(previous=>window.__inspectorWrites.length>previous,count)
  const firstToggle=checklistBody.replace('- [ ] Same','- [x] Same')
  assert.equal((await backend()).records.find(record=>record.id==='checklist-task').body,firstToggle)
  assert.equal(await editor().count(),0,'Read-view checklist saves do not open the editor')
  count=(await writes()).length
  await description().locator('.markdown-task-checkbox').nth(1).focus()
  await description().locator('.markdown-task-checkbox').nth(1).press('Space')
  await page.waitForFunction(previous=>window.__inspectorWrites.length>previous,count)
  const secondToggle=firstToggle.replace('- [x] Same\r\n\r\n```','- [ ] Same\r\n\r\n```')
  assert.equal((await backend()).records.find(record=>record.id==='checklist-task').body,secondToggle,'Keyboard toggles preserve CRLF and all code examples exactly')
  checks.push('Read-view checklist clicks and keyboard toggles save one marker through the native API without opening an editor or touching code examples')

  await openListItem('Visual editor round trip')
  await beginEdit(false)
  const visual=()=>editor().locator('.markdown-rich-text')
  await visual().waitFor()
  assert.equal(await editor().getByRole('tab',{name:'Formatted',exact:true}).getAttribute('aria-selected'),'true')
  assert.equal(await visual().locator('h1').innerText(),'Visual brief')
  assert.equal(await visual().locator('table').count(),1)
  assert.equal(await visual().locator('li[data-type="taskItem"]').count(),2)
  assert.equal(await visual().locator('pre code').innerText(),'const answer = 42')
  await editor().getByRole('tab',{name:'Markdown',exact:true}).click()
  assert.equal(await textarea().inputValue(),richBody,'Opening rich mode does not normalize the stored source')
  await editor().getByRole('tab',{name:'Formatted',exact:true}).click()
  await visual().locator('blockquote p').click()
  await page.keyboard.press('End');await page.keyboard.type(' Visible edit.')
  assert.match(await visual().locator('blockquote').innerText(),/Visible edit/)
  await visual().locator('blockquote p').evaluate(element=>{
    const range=document.createRange();range.setStart(element.firstChild,0);range.setEnd(element.firstChild,5)
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await editor().getByRole('button',{name:'Bold',exact:true}).click()
  assert.equal(await visual().locator('blockquote strong').innerText(),'Quote','The Bold tool formats the selected rich text, not Markdown punctuation')
  await visual().locator('li[data-type="taskItem"] input').first().check()
  await page.screenshot({path:'artifacts/inspector-visual-editor.png',fullPage:true})
  await saveDescription()
  const richSaved=(await backend()).records.find(record=>record.id==='rich-card').body
  assert.match(richSaved,/Visible edit/)
  assert.match(richSaved,/\*\*Bold\*\*/)
  assert.match(richSaved,/- \[x\] Rich task/)
  assert.match(richSaved,/- \[x\] Ready/)
  assert.match(richSaved,/\*\*Quote\*\*/)
  assert.match(richSaved,/const answer = 42/)
  assert.match(richSaved,/Shot A/)
  assert.equal(await description().locator('.markdown-content table').count(),1)
  checks.push('Formatted mode edits real rich text while preserving headings, marks, lists, task lists, quotes, code, links, and tables in Markdown storage')

  await openListItem('Client brief')
  await beginEdit()
  await description().getByLabel('Title',{exact:true}).fill('Updated Notes brief')
  const noteBody='# Notes edit\n\nThis note shares the **Markdown editor**.'
  await textarea().fill(noteBody)
  await editor().getByRole('tab',{name:'Preview',exact:true}).click()
  assert.equal(await editor().locator('.markdown-editor-preview strong').innerText(),'Markdown editor')
  await description().getByRole('button',{name:'Save note',exact:true}).click()
  await editor().waitFor({state:'hidden'})
  assert.deepEqual((await writes()).at(-1),{method:'updateNote',input:{id:'note-brief',title:'Updated Notes brief',content:noteBody,etag:'note-v1'}})
  assert.equal((await backend()).records.find(record=>record.id==='note-brief').body,noteBody)
  const writeCount=(await writes()).length
  await openListItem('Read-only shared task')
  assert.equal(await description().getByRole('button',{name:'Edit',exact:true}).count(),0)
  assert.equal(await description().locator('.markdown-content strong').innerText(),'read-only')
  assert.equal(await description().locator('.markdown-task-checkbox').getAttribute('disabled'),'')
  await description().locator('.markdown-task-checkbox').evaluate(element=>element.click())
  assert.equal((await writes()).length,writeCount)
  checks.push('Notes reuse the Markdown editor and Notes API; read-only descriptions remain readable without an edit action')

  await openListItem('Updated Notes brief')
  await beginEdit()
  await page.setViewportSize({width:430,height:932})
  const narrow=await inspector().boundingBox()
  assert.ok(narrow.x>=0&&narrow.x+narrow.width<=431)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:'artifacts/inspector-narrow.png',fullPage:true})
  assert.deepEqual(errors,[])
  checks.push('The resized inspector fits narrow screens without horizontal page overflow or renderer errors')
  console.log(JSON.stringify({result:'PASS',checks},null,2))
}catch(error){console.error(JSON.stringify({result:'FAIL',checks,errors,error:String(error)},null,2));await page.screenshot({path:'artifacts/inspector-failure.png',fullPage:true});throw error}finally{await context.close();await browser.close()}
