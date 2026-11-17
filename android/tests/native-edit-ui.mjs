/** Actual shared Android UI with isolated operation fixtures; no live account requests. */
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState,createPlannerWorkspace} from '@nextspace/core/planner.mjs'

const baseUrl=process.env.ANDROID_PREVIEW_URL||'http://127.0.0.1:5174'
const output=path.resolve(import.meta.dirname,'../../artifacts/android-reference')
await mkdir(output,{recursive:true})
const operations=['createNote','updateNote','setNoteTags','updateRecordDates','createLinkedEvent']
const workspace=createPlannerWorkspace()
workspace.relations=[{id:'note-link',type:'reference',fromId:'task-1',toId:'note-1'}]
const records=[
  {id:'task-1',source:'tasks',kind:'task',title:'Review launch checklist',body:'A task description.',collectionId:'tasks-1',collectionTitle:'Work tasks',start:'2026-11-11',due:'2026-11-13',status:'NEEDS-ACTION',etag:'"t1"',tags:['Action needed']},
  {id:'card-1',source:'deck',kind:'card',title:'Prepare release notes',body:'A card description.',collectionId:'deck-1',collectionTitle:'Product board',stackId:'review',assignmentKnown:true,assigneeIds:['fixture'],start:'2026-11-11T08:00:00Z',due:'2026-11-13T08:00:00Z',etag:'c1'},
  {id:'event-1',source:'calendar',kind:'event',title:'Team review',collectionId:'calendar-1',collectionTitle:'Work calendar',start:'2026-11-12T10:00:00Z',end:'2026-11-12T11:00:00Z',etag:'"e1"'},
  {id:'note-1',source:'notes',kind:'note',title:'Research notes',body:'# Research\n\nA **formatted** note.\n\n- [ ] Read the brief',collectionId:'notes-1',collectionTitle:'Work',remote:{category:'Work'},etag:'n1',fileId:'100'},
  {id:'undated',source:'tasks',kind:'task',title:'Plan new work',body:'',collectionId:'tasks-1',collectionTitle:'Work tasks',etag:'"u1"'},
]
const live={...createEmptyState(),mode:'live',workspace,records,revision:0,nativeOperations:operations,
  connection:{connected:true,serverUrl:'https://fixture.invalid',username:'fixture'},
  collections:[{id:'tasks-1',source:'tasks',title:'Work tasks',color:'#226688'},{id:'calendar-1',source:'calendar',title:'Work calendar',color:'#bb5533'},{id:'deck-1',source:'deck',title:'Product board',color:'#7755aa',stacks:[{id:'review',title:'Review'}]},{id:'notes-1',source:'notes',title:'Work'}],
  statuses:['tasks','calendar','deck','notes','collectives'].map(source=>({source,state:'connected',count:records.filter(record=>record.source===source).length})),
  storage:{syncStatus:'synced'},metadata:{ready:true},deviceState:{},
}
const browser=await chromium.launch({headless:true,channel:'msedge'})
const errors=[]
async function fixture(viewport,mode='enabled'){
  const context=await browser.newContext({viewport})
  await context.addInitScript(({live,mode})=>{
    let state=structuredClone(live),listener,counter=1
    const calls=[],snapshot=()=>structuredClone(state),record=id=>state.records.find(item=>item.id===id)
    if(mode==='empty')state.nativeOperations=[]
    if(mode==='missing')delete state.nativeOperations
    if(mode==='readonly')for(const item of state.records)item.readonly=true
    if(mode==='offline')Object.defineProperty(navigator,'onLine',{get:()=>false})
    let tags=[{id:'1',title:'Research',visible:true,assignable:true}]
    window.__calls=calls;window.__snapshot=snapshot
    window.__revoke=()=>{state.nativeOperations=[];listener?.(snapshot())}
    const forbidden=async()=>{calls.push(['forbidden']);throw new Error('Unsupported write was invoked')}
    window.__fixture={isNative:false,getState:async()=>snapshot(),refresh:async()=>snapshot(),syncWorkspace:async()=>snapshot(),
      subscribe:fn=>{listener=fn;return()=>{listener=undefined}},openExternal:async()=>{},readPage:async()=>({body:''}),
      saveWorkspace:async(workspace,revision)=>{if(revision!==state.revision)throw new Error('Wrong revision');state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},
      createTask:forbidden,setTaskCompleted:forbidden,createCard:forbidden,moveCard:forbidden,updateTaskStatus:forbidden,setDeckDependency:forbidden,
      readNote:async({id})=>{calls.push(['readNote',{id}]);const item=record(id);return {id,title:item.title,content:item.body,category:item.remote.category,etag:item.etag,readonly:Boolean(item.readonly)}},
      readNoteTags:async({id})=>{calls.push(['readNoteTags',{id}]);Object.assign(record(id),{fileTags:structuredClone(tags),tagDetails:structuredClone(tags),tags:tags.map(tag=>tag.title)});return {tags:structuredClone(tags),availableTags:[]}},
      updateNote:async input=>{calls.push(['updateNote',structuredClone(input)]);if(window.__failNextNote){window.__failNextNote=false;throw new Error('This item changed on Nextcloud. Your draft is kept.')}const item=record(input.id);Object.assign(item,{title:input.title,body:input.content,etag:'n'+(++counter),remote:{category:input.category??item.remote.category}});return snapshot()},
      setNoteTags:async input=>{calls.push(['setNoteTags',structuredClone(input)]);if(window.__failNextTags){window.__failNextTags=false;throw new Error('Native Files tags are temporarily unavailable.')}tags=[...tags.filter(tag=>input.tagIds.includes(tag.id)),...(input.newTags||[]).map((title,index)=>({id:String(20+counter++ +index),title,visible:true,assignable:true}))];Object.assign(record(input.id),{fileTags:structuredClone(tags),tagDetails:structuredClone(tags),tags:tags.map(tag=>tag.title)});return {tags:structuredClone(tags),availableTags:[],message:'Tags saved'}},
      updateRecordDates:async input=>{calls.push(['updateRecordDates',structuredClone(input)]);const item=record(input.id);for(const key of ['start','due','end','allDay'])if(key in input)item[key]=input[key]||undefined;item.etag='v'+(++counter);return snapshot()},
      createLinkedEvent:async input=>{calls.push(['createLinkedEvent',structuredClone(input)]);const event={id:'booking-1',source:'calendar',kind:'event',title:input.title,start:input.start,end:input.end,allDay:input.allDay,collectionId:input.collectionId,collectionTitle:'Work calendar',etag:'"b1"'};state.records.push(event);state.workspace.relations.push({id:'booking-link',type:'scheduled_during',fromId:input.recordId,toId:event.id});state.revision++;return snapshot()},
      createNote:async input=>{calls.push(['createNote',structuredClone(input)]);const item={id:'note-created',source:'notes',kind:'note',title:input.title,body:input.content,collectionId:'notes-1',collectionTitle:input.category||'Uncategorized (default)',remote:{category:input.category},etag:'new-note'};state.records.push(item);return {...snapshot(),createdRecordId:item.id}},
    }
    if(mode==='api-missing')delete window.__fixture.updateNote
  },{live,mode})
  await context.route('**/src/adapter.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const createAndroidApi=()=>window.__fixture'}))
  await context.route('**/__nextglance/**',route=>{errors.push('Unexpected live preview bridge request');return route.abort()})
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10_000)
  await page.goto(baseUrl);await page.getByRole('tab',{name:'List',exact:true}).click()
  return {context,page}
}
async function openItem(page,title){await page.locator('.list-table-row').filter({hasText:title}).click();await page.locator('.inspector').waitFor()}
async function closeItem(page){await page.getByRole('button',{name:'Close item details',exact:true}).click();await page.locator('.inspector').waitFor({state:'detached'})}
async function waitCall(page,name,count=1){await page.waitForFunction(({name,count})=>window.__calls.filter(call=>call[0]===name).length>=count,{name,count})}
async function saveShot(page,name){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(output,name+'.png'),fullPage:true})}
try{
  for(const viewport of [{width:384,height:854},{width:900,height:1100}]){
    const {context,page}=await fixture(viewport)
    await openItem(page,'Review launch checklist')
    assert.equal(await page.getByRole('button',{name:'Edit dates',exact:true}).isEnabled(),true)
    assert.equal(await page.getByRole('button',{name:'Schedule in calendar',exact:true}).isEnabled(),true)
    assert.equal(await page.getByRole('button',{name:'Mark done',exact:true}).isDisabled(),true)
    assert.equal(await page.getByRole('combobox',{name:'Task status'}).isDisabled(),true)
    assert.equal(await page.getByRole('button',{name:'New item',exact:true}).count(),0)
    await page.locator('.linked-notes-section').getByRole('button').filter({hasText:'Research notes'}).click()
    await waitCall(page,'readNoteTags');await page.locator('.note-tag-chip').filter({hasText:'Research'}).waitFor()
    assert.equal(await page.locator('.note-tags-editor').count(),1,'One native tagging control in compact view')
    assert.equal(await page.locator('.inspector-collection').innerText(),'Folder: Work')
    assert.equal(await page.getByRole('textbox',{name:/category/i}).count(),0,'Existing note folders are not editable classifications')
    assert.equal(await page.getByRole('button',{name:'Expand note editor',exact:true}).isEnabled(),true)
    assert.equal(await page.getByRole('button',{name:'Back to previous item',exact:true}).isEnabled(),true)
    await page.getByRole('checkbox',{name:'Read the brief',exact:true}).click();await waitCall(page,'updateNote')
    await page.waitForFunction(()=>window.__snapshot().records.find(record=>record.id==='note-1').body.includes('[x]'))
    await page.getByRole('button',{name:'Edit note tags',exact:true}).click()
    await page.getByRole('textbox',{name:'Find note tags',exact:true}).fill('Review')
    await page.getByRole('button',{name:'Create “Review”',exact:true}).click()
    await page.getByRole('dialog',{name:'Note tags',exact:true}).getByRole('button',{name:'Done',exact:true}).click()
    await waitCall(page,'setNoteTags');await page.locator('.note-tag-chip').filter({hasText:'Review'}).waitFor()
    const tagCall=await page.evaluate(()=>window.__calls.find(call=>call[0]==='setNoteTags')[1]);assert.deepEqual(tagCall.newTags,['Review']);assert.deepEqual(tagCall.tagIds,['1'])
    await page.getByRole('button',{name:'Expand note editor',exact:true}).click()
    const editor=page.getByRole('dialog',{name:'Edit note',exact:true})
    await editor.waitFor()
    const modalColor=await page.locator('.modal.note-editor-modal').evaluate(element=>getComputedStyle(element).backgroundColor)
    const modalAlpha=modalColor.includes('/')?Number(modalColor.split('/').at(-1).replace(')','')):modalColor.startsWith('rgba(')?Number(modalColor.split(',').at(-1).replace(')','')):1
    assert.notEqual(modalColor,'transparent');assert.equal(modalAlpha,1,'Notes writing surface is opaque so underlying text cannot show through')
    assert.equal(await page.locator('.note-tags-editor').count(),1,'Expansion moves the same tagging control')
    assert.equal(await editor.getByRole('button',{name:'Edit note tags',exact:true}).count(),1)
    assert.equal(await page.locator('.inspector').getByRole('button',{name:'Edit note tags',exact:true}).count(),0)
    assert.equal(await editor.getByRole('textbox',{name:/category|folder/i}).count(),0)
    assert.equal(await editor.getByRole('textbox',{name:'Note title',exact:true}).getAttribute('maxlength'),'500')
    assert.equal(await editor.getByRole('tab',{name:'Formatted',exact:true}).getAttribute('aria-selected'),'true')
    await editor.getByRole('textbox',{name:'Note title',exact:true}).fill('Research notes revised')
    await editor.getByRole('tab',{name:'Markdown',exact:true}).click()
    await editor.getByRole('textbox',{name:'Note content',exact:true}).fill('# Revised\n\n**Saved from mobile**\n\n- [x] Read the brief')
    await editor.getByRole('button',{name:'Edit note tags',exact:true}).click()
    await editor.getByRole('textbox',{name:'Find note tags',exact:true}).fill('Expanded tag')
    await editor.getByRole('button',{name:'Create “Expanded tag”',exact:true}).click()
    await page.evaluate(()=>window.__failNextTags=true)
    await editor.getByRole('dialog',{name:'Note tags',exact:true}).getByRole('button',{name:'Done',exact:true}).click()
    await waitCall(page,'setNoteTags',2)
    await editor.getByRole('button',{name:'Retry',exact:true}).waitFor()
    assert.equal(await editor.getByRole('textbox',{name:'Note title',exact:true}).inputValue(),'Research notes revised')
    await editor.getByRole('button',{name:'Back to side panel',exact:true}).click()
    assert.equal(await page.locator('.note-tags-editor').count(),1,'Failed tag draft survives collapse without duplication')
    assert.equal(await page.locator('.inspector .note-tag-chip').filter({hasText:'Expanded tag'}).count(),1)
    assert.equal(await page.locator('.note-editor').getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Research notes revised')
    assert.equal(await page.getByRole('textbox',{name:/category|folder/i}).count(),0)
    await page.getByRole('textbox',{name:'Find note tags',exact:true}).press('Escape')
    await page.getByRole('button',{name:'Expand note editor',exact:true}).click()
    await editor.getByRole('button',{name:'Review',exact:true}).click()
    await editor.getByRole('button',{name:'Retry',exact:true}).click();await waitCall(page,'setNoteTags',3)
    await editor.getByRole('dialog',{name:'Note tags',exact:true}).waitFor({state:'detached'})
    assert.equal(await editor.locator('.note-tag-chip').filter({hasText:'Expanded tag'}).count(),1)
    assert.equal(await editor.getByRole('textbox',{name:'Note title',exact:true}).inputValue(),'Research notes revised')
    assert.equal((await page.evaluate(()=>window.__calls.filter(call=>call[0]==='updateNote'))).length,1,'Tag saves do not submit the content draft')
    assert.equal(await page.evaluate(()=>window.__snapshot().records.find(record=>record.id==='note-1').remote.category),'Work','Native tag saves preserve the folder')
    await saveShot(page,`fixture-note-editor-${viewport.width}`)
    await editor.getByRole('button',{name:'Back to side panel',exact:true}).click()
    assert.equal(await page.locator('.note-editor').getByRole('textbox',{name:'Title',exact:true}).inputValue(),'Research notes revised')
    await page.getByRole('button',{name:'Expand note editor',exact:true}).click()
    await editor.getByRole('button',{name:'Save note',exact:true}).click();await waitCall(page,'updateNote',2)
    await editor.waitFor({state:'detached'});await page.locator('.inspector h2').filter({hasText:'Research notes revised'}).waitFor()
    const saved=await page.evaluate(()=>window.__calls.filter(call=>call[0]==='updateNote').at(-1)[1]);assert.equal(saved.base.category,'Work');assert.equal(Object.hasOwn(saved,'category'),false);assert.ok(saved.base.content.includes('[x]'));assert.match(saved.content,/Saved from mobile/)
    assert.equal(await page.evaluate(()=>window.__calls.filter(call=>call[0]==='updateNote').every(call=>!Object.hasOwn(call[1],'category'))),true,'Checklist and ordinary content saves omit desired category')
    assert.equal(await page.evaluate(()=>window.__snapshot().records.find(record=>record.id==='note-1').remote.category),'Work')
    await page.getByRole('button',{name:'Back to previous item',exact:true}).click()
    await page.locator('.inspector h2').filter({hasText:'Review launch checklist'}).waitFor()
    await page.getByRole('button',{name:'Edit dates',exact:true}).click()
    const dates=page.getByRole('dialog',{name:'Plan dates',exact:true});await dates.waitFor()
    assert.ok(await dates.locator('.dates-context-row').count()>0)
    await dates.getByRole('button',{name:'Move date range. Use left and right arrow keys to move one day.',exact:true}).press('ArrowRight')
    await saveShot(page,`fixture-date-editor-${viewport.width}`)
    await dates.getByRole('button',{name:'Save dates',exact:true}).click();await waitCall(page,'updateRecordDates')
    assert.equal((await page.evaluate(()=>window.__calls.find(call=>call[0]==='updateRecordDates')[1])).start,'2026-11-12')
    await page.getByRole('button',{name:'Schedule in calendar',exact:true}).click()
    const schedule=page.getByRole('dialog',{name:'Schedule in calendar',exact:true});await schedule.waitFor()
    assert.ok(await schedule.locator('.scheduling-week').count()>0)
    await schedule.getByRole('combobox',{name:'Calendar',exact:true}).selectOption('calendar-1')
    await schedule.locator('summary').filter({hasText:'Exact dates & description'}).click()
    await schedule.getByLabel('Start',{exact:true}).fill('2026-11-12T12:00')
    await schedule.getByLabel('End',{exact:true}).fill('2026-11-12T13:00')
    await saveShot(page,`fixture-schedule-editor-${viewport.width}`)
    await schedule.getByRole('button',{name:'Create & link',exact:true}).click();await waitCall(page,'createLinkedEvent');await schedule.waitFor({state:'detached'})
    assert.ok((await page.evaluate(()=>window.__snapshot().workspace.relations)).some(edge=>edge.type==='scheduled_during'&&edge.fromId==='task-1'))
    await page.locator('.linked-booking').waitFor()
    await closeItem(page)
    for(const title of ['Prepare release notes','Team review']){
      await openItem(page,title);await page.getByRole('button',{name:'Edit dates',exact:true}).click()
      await dates.getByRole('button',{name:'Move date range. Use left and right arrow keys to move one day.',exact:true}).press('ArrowRight')
      await dates.getByRole('button',{name:'Save dates',exact:true}).click();await dates.waitFor({state:'detached'});await closeItem(page)
    }
    await openItem(page,'Plan new work');await page.getByRole('button',{name:'Set dates',exact:true}).click();await dates.waitFor()
    await dates.locator('summary').filter({hasText:'Exact dates & times'}).click()
    await dates.getByLabel('Start date',{exact:true}).fill('2026-11-14')
    await dates.getByLabel('Deadline date',{exact:true}).fill('2026-11-15')
    await dates.getByRole('button',{name:'Save dates',exact:true}).click();await waitCall(page,'updateRecordDates',4);await dates.waitFor({state:'detached'})
    await page.getByRole('button',{name:'Attach',exact:true}).click()
    const picker=page.getByRole('dialog',{name:'Attach notes or files',exact:true});await picker.getByRole('tab',{name:'Create a note',exact:true}).click()
    await picker.getByRole('textbox',{name:'New note title',exact:true}).fill('New project brief')
    assert.equal(await picker.getByText('Suggested category',{exact:false}).count(),0)
    await picker.getByLabel('New note folder',{exact:true}).fill('Work/Briefs')
    await picker.getByRole('button',{name:'Create note',exact:true}).click();await waitCall(page,'createNote')
    assert.equal(await page.evaluate(()=>window.__calls.find(call=>call[0]==='createNote')[1].category),'Work/Briefs','Creation keeps an explicit native folder destination')
    await picker.getByRole('button',{name:'Link 1 note',exact:true}).click();await picker.waitFor({state:'detached'})
    await closeItem(page);await openItem(page,'Research notes revised')
    await page.getByRole('button',{name:'Expand note editor',exact:true}).click();await editor.getByRole('textbox',{name:'Note title',exact:true}).fill('Preserve failed draft')
    await page.evaluate(()=>window.__failNextNote=true);await editor.getByRole('button',{name:'Save note',exact:true}).click()
    await editor.getByText('This item changed on Nextcloud. Your draft is kept.',{exact:true}).waitFor()
    assert.equal(await editor.getByRole('textbox',{name:'Note title',exact:true}).inputValue(),'Preserve failed draft')
    assert.equal(await editor.getByRole('button',{name:'Review Nextcloud version',exact:true}).isEnabled(),true)
    assert.equal((await page.evaluate(()=>window.__calls)).some(call=>call[0]==='forbidden'),false)
    await context.close()
  }
  for(const mode of ['empty','missing','readonly','offline','api-missing','revoked']){
    const {context,page}=await fixture({width:384,height:854},mode)
    await openItem(page,'Research notes')
    if(mode!=='offline'){await waitCall(page,'readNoteTags');await page.locator('.note-tag-chip').filter({hasText:'Research'}).waitFor()}
    if(mode==='revoked'){
      assert.equal(await page.getByRole('button',{name:'Expand note editor',exact:true}).isEnabled(),true)
      await page.evaluate(()=>window.__revoke())
      await page.getByRole('button',{name:'Expand note editor',exact:true}).waitFor({state:'detached'})
    }
    assert.equal(await page.getByRole('button',{name:'Expand note editor',exact:true}).count(),0)
    assert.equal(await page.locator('.description-section').getByRole('button',{name:'Edit',exact:true}).count(),0)
    if(mode!=='api-missing')assert.equal(await page.getByRole('button',{name:'Edit note tags',exact:true}).isDisabled(),true)
    await closeItem(page);await openItem(page,'Review launch checklist')
    if(mode!=='api-missing')assert.equal(await page.getByRole('button',{name:'Edit dates',exact:true}).isDisabled(),true)
    if(mode==='readonly')assert.equal(await page.getByRole('button',{name:'Schedule in calendar',exact:true}).isEnabled(),true,'Read-only work can book a writable destination calendar')
    else if(mode!=='api-missing')assert.equal(await page.getByRole('button',{name:'Schedule in calendar',exact:true}).isDisabled(),true)
    assert.equal((await page.evaluate(()=>window.__calls)).some(call=>operations.includes(call[0])||call[0]==='forbidden'),false)
    await context.close()
  }
  assert.deepEqual(errors,[])
  console.log('Android native-edit UI passed: phone/tablet single native Tags surface, new tags and failed-tag retry across expanded/compact editing, category-free checklist/content saves with frozen folder baseline, Folder creation destination, rich/source drafts and Back, failed content retention, task/card/event/undated date saves, linked calendar booking, unsupported actions and readonly/offline/runtime capability gates. Isolated fixtures only; no live requests or builds.')
}finally{await browser.close()}
