/** Large realistic attachment library. Timing is reported; work/DOM bounds are asserted. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {fileURLToPath} from 'node:url'

const uiUrl=name=>'/@fs/'+fileURLToPath(import.meta.resolve(`@nextspace/ui/${name}`)).replaceAll('\\','/')
const baseline=process.argv.includes('--baseline')
const pickerUrl=baseline?'/@fs/'+fileURLToPath(new URL('../.runtime/NoteLinkPickerBaseline.vue',import.meta.resolve('@nextspace/ui/components/NoteLinkPicker.vue'))).replaceAll('\\','/'):uiUrl('components/NoteLinkPicker.vue')
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1350,height:1100}})
page.setDefaultTimeout(20000)
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/note-picker-perf',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="${uiUrl('style.css')}"/></head><body><main id="app" style="width:850px;padding:24px;margin:auto"></main><script type="module">
import {createApp,h,reactive,nextTick} from '/node_modules/.vite/deps/vue.js'
import Picker from '${pickerUrl}'
const stats=window.pickerStats={tags:0,mountMs:0,selected:[],dirty:false}
const record={id:'work',source:'deck',kind:'card',title:'Production delivery'}
const notes=Array.from({length:1200},(_,index)=>({id:'note-'+index,source:index%5?'notes':'collectives',kind:index%5?'note':'page',title:'Research note '+String(index).padStart(4,'0'),collectionTitle:'Production research',body:('# Context\\n\\nDetailed production research and planning. '.repeat(160))+' bodyneedle'+index,tagDetails:[{id:'team',title:'Production',color:'#0082c9'}]}))
const state=reactive({records:[record,...notes,...Array.from({length:1200},(_,index)=>({id:'task-'+index,source:'tasks',kind:'task',title:'Work '+index}))],relations:Array.from({length:1800},(_,index)=>({id:'edge-'+index,type:'reference',fromId:'task-'+index%1200,toId:'note-'+index%1200})),linkedIds:['note-1199'],createdNote:undefined})
window.pickerState=state
const tagsFor=note=>{stats.tags++;return note.tagDetails||[]}
window.settle=()=>nextTick().then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const started=performance.now()
createApp({setup(){return()=>h(Picker,{record,records:state.records,relations:state.relations,linkedIds:state.linkedIds,createdNote:state.createdNote,canCreate:true,tagsFor,onDirty:value=>stats.dirty=value,onAdd:ids=>stats.selected=ids})}}).mount('#app')
await window.settle();stats.mountMs=performance.now()-started;stats.initialTags=stats.tags;window.pickerReady=true
</script></body></html>`}))

try{
  await page.goto('http://127.0.0.1:5173/note-picker-perf')
  await page.waitForFunction(()=>window.pickerReady)
  const initial=await page.evaluate(()=>({mountMs:window.pickerStats.mountMs,tags:window.pickerStats.tags,rows:document.querySelectorAll('.note-picker-option').length,editors:document.querySelectorAll('.markdown-rich-text').length}))
  const selection=await page.evaluate(async()=>{const before=window.pickerStats.tags,started=performance.now();document.querySelector('.note-picker-option input').click();await window.settle();return {ms:performance.now()-started,tagReads:window.pickerStats.tags-before,checked:document.querySelector('.note-picker-option input').checked}})
  assert.equal(selection.checked,true)
  const search=await page.evaluate(async()=>{const before=window.pickerStats.tags,started=performance.now(),input=document.querySelector('[aria-label="Find notes and pages"]');input.value='bodyneedle1198';input.dispatchEvent(new Event('input',{bubbles:true}));await window.settle();return {ms:performance.now()-started,tagReads:window.pickerStats.tags-before,rows:document.querySelectorAll('.note-picker-option').length}})
  await page.getByRole('checkbox',{name:'Research note 1198',exact:true}).check()
  await page.getByRole('button',{name:'Link 2 notes',exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>window.pickerStats.selected),['note-0','note-1198'])
  await page.getByLabel('Find notes and pages').fill('bodyneedle1199')
  assert.equal(await page.getByRole('checkbox',{name:'Research note 1199',exact:true}).isDisabled(),true)
  await page.getByLabel('Find notes and pages').fill('')
  await page.evaluate(()=>window.settle())
  if(!baseline){
    assert.ok(initial.rows<=50,'Initial render must not mount the entire note library')
    assert.equal(initial.editors,0,'The unused note editor must not initialize when choosing attachments')
    assert.equal(selection.tagReads,0,'Selecting a note must not recompute every note tag or excerpt')
    assert.equal(search.tagReads,0,'Searching must reuse the prepared note search index')
    await page.getByRole('button',{name:/Show more notes/}).click()
    assert.equal(await page.locator('.note-picker-option').count(),100)
    assert.equal(await page.getByRole('checkbox',{name:'Research note 0000',exact:true}).isChecked(),true)
    await page.evaluate(()=>window.pickerState.linkedIds.push('note-1198'))
    await page.getByRole('button',{name:'Link 1 note',exact:true}).waitFor()
    await page.getByRole('tab',{name:'Create a note',exact:true}).click()
    await page.getByRole('textbox',{name:'New note content formatted text',exact:true}).waitFor()
    await page.getByLabel('New note title',{exact:true}).fill('Preserved hidden draft')
    await page.getByRole('tab',{name:/^Existing notes/}).click()
    await page.getByRole('tab',{name:'Create a note',exact:true}).click()
    assert.equal(await page.getByLabel('New note title',{exact:true}).inputValue(),'Preserved hidden draft')
  }
  assert.deepEqual(errors,[])
  const result={mode:baseline?'baseline':'optimized',fixture:{notes:1200,otherRecords:1200,relations:1800,bodyCharactersPerNote:notesLength()},initial,selection,search}
  await writeFile('artifacts/note-picker-performance-'+result.mode+'.json',JSON.stringify(result,null,2))
  console.log(JSON.stringify(result,null,2))
}catch(error){await page.screenshot({path:'artifacts/note-picker-performance-failure.png'}).catch(()=>{});throw error}
finally{await browser.close()}
function notesLength(){return ('# Context\n\nDetailed production research and planning. '.repeat(160)).length}
