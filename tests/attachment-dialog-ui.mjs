/** Unified notes/files attachment UX against isolated native bridge fixtures. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {fileURLToPath} from 'node:url'

const uiUrl=name=>'/@fs/'+fileURLToPath(import.meta.resolve(`@nextspace/ui/${name}`)).replaceAll('\\','/')

await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1300,height:1050}})
page.setDefaultTimeout(12000)
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/attachment-harness',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="${uiUrl('style.css')}"/></head><body><div id="harness" style="max-width:820px;margin:30px auto;padding:25px;background:var(--surface)"></div><script type="module">
import {createApp,h,reactive} from '/node_modules/.vite/deps/vue.js'
import Picker from '${uiUrl('components/NoteLinkPicker.vue')}'
import Resources from '${uiUrl('components/NativeResourcesPanel.vue')}'
const card=reactive({id:'card',kind:'card',source:'deck',title:'Deliver the final cut',attachmentFileIds:['42','8']}),note={id:'note',kind:'note',source:'notes',title:'Client brief',fileId:'42',body:'Approved direction'}
const state=reactive({scene:'picker',dirty:false,busy:false,relations:[],adds:[],done:0,changed:0,reads:0,uploads:0,failUpload:false,attachCalls:[],openDialog:0,card,resourceChanged:0,resourceReads:0,resourceBusy:[],removeCalls:[],failDetach:false,resourceAttachments:[{id:'a1',type:'file',name:'Client brief.md',fileId:'42',url:'https://fixture.invalid/f/42'},{id:'a2',type:'file',name:'Brief.pdf',fileId:'8',url:'https://fixture.invalid/f/8'}]})
window.attachHarness=state
const api={listFiles:async({path})=>{state.reads++;return {path,files:[{id:'8',name:'Brief.pdf',path:'/Brief.pdf',directory:false},{id:'9',name:'Reference.md',path:'/Reference.md',directory:false}]}},attachDeckFile:async({id,path})=>{state.attachCalls.push({id,path});return {attachments:[]}},uploadDeckAttachment:async({id})=>{state.uploads++;if(state.failUpload)throw Error('Fixture upload failed');return {attachments:[]}},readDeckAttachments:async()=>{state.resourceReads++;return {attachments:state.resourceAttachments.map(file=>({...file}))}},removeDeckAttachment:async input=>{state.removeCalls.push(input);if(state.failDetach)throw Error('Fixture detach failed');state.resourceAttachments=state.resourceAttachments.filter(file=>file.id!==input.attachmentId);return {attachments:state.resourceAttachments.map(file=>({...file}))}},readRelatedResources:async()=>({available:true,resources:[]})}
createApp({setup(){return()=>state.scene==='picker'?h(Picker,{record:card,records:[card,note],relations:state.relations,api,canAttachFiles:true,canCreate:true,busy:state.busy,onDirty:value=>state.dirty=value,onOperationBusy:value=>state.busy=value,onAdd:(ids,options)=>{state.adds.push({ids,options});state.relations=ids.map(id=>({id:'relation-'+id,type:'reference',fromId:'card',toId:id,native:true}))},onChanged:()=>state.changed++,onDone:()=>state.done++}):h(Resources,{ref:panel=>window.resourcePanel=panel,record:card,records:[card,note],api,canWrite:true,canAttach:true,connected:true,linkedNoteCount:1,onAttach:()=>state.openDialog++,onChanged:()=>state.resourceChanged++,onBusy:value=>state.resourceBusy.push(value)},{notes:()=>h('button',{class:'fixture-note-row'},'Client brief')})}}).mount('#harness')
</script></body></html>`}))

try{
  await page.goto('http://127.0.0.1:5173/attachment-harness')
  await page.getByRole('heading',{name:'Attach to this work',exact:true}).waitFor()
  assert.deepEqual((await page.getByRole('tab').allTextContents()).map(text=>text.trim()),['Existing notes','Create a note','Other files'])
  assert.equal(await page.evaluate(()=>window.attachHarness.reads),0,'Files load only after opening Other files')
  await page.getByRole('checkbox',{name:'Client brief',exact:true}).check()
  await page.getByRole('tab',{name:'Other files',exact:true}).click()
  await page.getByRole('checkbox',{name:'Brief.pdf',exact:true}).check()
  await page.getByRole('tab',{name:'Create a note',exact:true}).click()
  await page.getByLabel('New note title',{exact:true}).fill('Unsaved production note')
  await page.getByRole('tab',{name:/^Other files/}).click()
  await page.evaluate(()=>window.attachHarness.failUpload=true)
  await page.getByRole('button',{name:'Upload file',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'Fixture upload failed'}).waitFor()
  assert.equal(await page.getByRole('checkbox',{name:'Brief.pdf',exact:true}).isChecked(),true)
  assert.equal(await page.evaluate(()=>window.attachHarness.dirty),true)
  await page.evaluate(()=>window.attachHarness.failUpload=false)
  await page.getByRole('button',{name:'Upload file',exact:true}).click()
  await page.getByRole('status').filter({hasText:'File uploaded and attached in Deck.'}).waitFor()
  assert.equal(await page.evaluate(()=>window.attachHarness.done),0)
  await page.getByRole('tab',{name:'Create a note',exact:true}).click()
  assert.equal(await page.getByLabel('New note title',{exact:true}).inputValue(),'Unsaved production note')
  checks.push('Notes appear first and Other files last; selections and hidden note drafts survive tab changes, failed uploads and successful native uploads')

  await page.getByRole('tab',{name:/^Other files/}).click()
  await page.screenshot({path:'artifacts/unified-attachment-files.png',fullPage:false})
  await page.getByRole('button',{name:'Attach 1 file',exact:true}).click()
  await page.getByLabel('New note title',{exact:true}).waitFor({state:'visible'})
  assert.equal(await page.evaluate(()=>window.attachHarness.done),0,'A successful file attachment cannot close over an unsaved note draft')
  await page.getByRole('tab',{name:/^Existing notes/}).click()
  await page.getByRole('button',{name:'Discard new note draft',exact:true}).click()
  assert.equal(await page.getByRole('checkbox',{name:'Client brief',exact:true}).isChecked(),true)
  await page.getByRole('tab',{name:'Other files',exact:true}).click()
  await page.getByRole('checkbox',{name:'Reference.md',exact:true}).check()
  await page.getByRole('tab',{name:/^Existing notes/}).click()
  await page.screenshot({path:'artifacts/unified-attachment-notes.png',fullPage:false})
  await page.getByRole('button',{name:'Link 1 note',exact:true}).click()
  await page.getByRole('checkbox',{name:'Reference.md',exact:true}).waitFor({state:'visible'})
  assert.deepEqual(await page.evaluate(()=>window.attachHarness.adds.at(-1)),{ids:['note'],options:{keepOpen:true}})
  assert.equal(await page.getByRole('checkbox',{name:'Reference.md',exact:true}).isChecked(),true)
  await page.getByRole('button',{name:'Attach 1 file',exact:true}).click()
  await page.waitForFunction(()=>window.attachHarness.done===1)
  assert.deepEqual(await page.evaluate(()=>window.attachHarness.attachCalls.map(item=>item.path)),['/Brief.pdf','/Reference.md'])
  assert.equal(await page.evaluate(()=>window.attachHarness.dirty),false)
  checks.push('Saving one attachment type preserves the other selection; the dialog completes only when no notes, files or new-note draft remain')

  await page.evaluate(()=>window.attachHarness.scene='resources')
  const section=page.getByRole('region',{name:'Attachments',exact:true})
  await section.locator('.native-file-row > button:first-child').filter({hasText:'Brief.pdf'}).waitFor()
  assert.equal(await section.getByRole('button',{name:'Attach',exact:true}).count(),1)
  assert.equal(await section.getByRole('button',{name:'Client brief',exact:true}).count(),1)
  assert.equal(await page.getByRole('button',{name:/Share from Files|Upload files/}).count(),0)
  await section.getByRole('button',{name:'Attach',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.attachHarness.openDialog),1)
  checks.push('The inspector has one Attachments section with notes and files together and one Attach entry point')

  assert.equal(await page.evaluate(()=>window.attachHarness.resourceChanged),0,'Opening a card with unchanged native attachment IDs must not trigger whole-workspace adoption')
  assert.equal(await page.evaluate(()=>window.attachHarness.resourceReads),1)
  await page.evaluate(async()=>{
    window.attachHarness.resourceAttachments.reverse()
    window.attachHarness.resourceAttachments.find(file=>file.id==='a2').name='Updated brief.pdf'
    await window.resourcePanel.reload()
  })
  await section.getByRole('button',{name:'Remove attachment Updated brief.pdf',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.attachHarness.resourceChanged),0,'Reordered attachments and changed display metadata keep the same native relationship membership')
  checks.push('Unchanged initial/repeated attachment reads do not emit workspace changes; display metadata still refreshes locally')

  await page.evaluate(async()=>{
    window.attachHarness.resourceAttachments.push({id:'a3',type:'file',name:'Storyboard.pdf',fileId:'9',url:'https://fixture.invalid/f/9'})
    await window.resourcePanel.reload()
  })
  assert.equal(await page.evaluate(()=>window.attachHarness.resourceChanged),1,'A genuinely new native file ID must notify the parent to adopt updated relationships')
  await page.evaluate(async()=>{
    window.attachHarness.card.attachmentFileIds=['9','42','8']
    await window.resourcePanel.reload()
  })
  assert.equal(await page.evaluate(()=>window.attachHarness.resourceChanged),1,'After the parent adopts the IDs, another read must stay quiet')
  await page.evaluate(()=>window.attachHarness.failDetach=true)
  await section.getByRole('button',{name:'Remove attachment Storyboard.pdf',exact:true}).click()
  await section.getByRole('alert').filter({hasText:'Fixture detach failed'}).waitFor()
  assert.equal(await page.evaluate(()=>window.attachHarness.resourceChanged),1,'Failed mutations must not emit a successful workspace change')
  await page.evaluate(()=>window.attachHarness.failDetach=false)
  await section.getByRole('button',{name:'Remove attachment Storyboard.pdf',exact:true}).click()
  await section.getByRole('button',{name:'Remove attachment Storyboard.pdf',exact:true}).waitFor({state:'hidden'})
  assert.equal(await page.evaluate(()=>window.attachHarness.resourceChanged),2,'Successful native removal must still notify the parent immediately')
  assert.deepEqual(await page.evaluate(()=>window.attachHarness.removeCalls),[{id:'card',attachmentId:'a3'},{id:'card',attachmentId:'a3'}])
  assert.deepEqual(await page.evaluate(()=>window.attachHarness.resourceBusy),[true,false,true,false])
  checks.push('Changed native attachment IDs and successful mutations emit updates, while failed removals retain their row without a false acknowledgement')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:checks.length,checks},null,2))
}catch(error){console.error(error);try{await page.screenshot({path:'artifacts/unified-attachment-failure.png',fullPage:false,timeout:3000})}catch{};throw error}
finally{await browser.close()}
