/** Suggested links use isolated fixture metadata only; no native or live account writes. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState} from '@nextspace/core/planner.mjs'

const initial=createEmptyState()
initial.mode='live';initial.connection={connected:true,username:'tester',serverUrl:'https://fixture.invalid'}
initial.workspace.appearance.mode='dark';initial.workspace.planner.view='list'
initial.workspace.planner.scopeId='freelance';initial.workspace.planner.hiddenCollectionIds=['calendar']
initial.collections=[{id:'tasks',source:'tasks',title:'Personal tasks',color:'#9f72bd'},{id:'deck',source:'deck',title:'Freelance board',color:'#277fa3',stacks:[{id:'todo',title:'To do'}]},{id:'calendar',source:'calendar',title:'Personal calendar',color:'#9f72bd'}]
const work=(id,title,day,extra={})=>({id,title,source:'tasks',kind:'task',collectionId:'tasks',collectionTitle:'Personal tasks',status:'NEEDS-ACTION',due:`2026-11-${day}`,completed:false,readonly:false,...extra})
const event=(id,title,day)=>({id,title,source:'calendar',kind:'event',collectionId:'calendar',collectionTitle:'Personal calendar',start:`2026-11-${day}T19:00:00+01:00`,end:`2026-11-${day}T19:30:00+01:00`,readonly:false})
initial.records=[
  work('subscription','Cancel Aster subscription (within 30 days - deadline Nov 25)','18'),event('subscription-event','Cancel Aster subscription (deadline Nov 25)','18'),
  work('invoice','Pay electricity invoice 2026-123','20'),event('invoice-event','Pay electricity invoice 2026-123','20'),
  work('client-task','Prepare client delivery','22'),work('client-card','Prepare client delivery','22',{source:'deck',kind:'card',collectionId:'deck',collectionTitle:'Freelance board',stackId:'todo',assigneeIds:['someone-else'],assignmentKnown:true,assignmentCount:1}),event('client-event','Prepare client delivery','22'),
  work('garden','Book garden installation','23'),event('garden-event','Book garden installation','23'),
]
initial.workspace.relations=[{id:'already',type:'scheduled_during',fromId:'garden',toId:'garden-event'}]
initial.statuses=initial.statuses.map(status=>({...status,state:'connected',count:initial.records.filter(item=>item.source===status.source).length}))
initial.workspace.spaces=[{id:'personal',name:'Personal',color:'#9f72bd',collectionIds:['tasks','calendar']},{id:'freelance',name:'Freelance',color:'#277fa3',collectionIds:['deck']}]
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1652,height:1100},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(15000)
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)?route.continue():route.abort()})
await page.addInitScript(data=>{
  const clone=value=>structuredClone(value),key='event-matches-fixture'
  let state=JSON.parse(sessionStorage.getItem(key)||'null')||clone(data)
  window.__metadataWrites=[];window.__nativeWrites=0;window.__rejectLinkSave=false
  const read=async()=>clone(state)
  const native=async()=>{window.__nativeWrites++;throw Error('Suggested links must never write native source data')}
  window.workspaceApi={getState:read,refresh:read,syncWorkspace:read,saveWorkspace:async(workspace,revision)=>{
    if(window.__rejectLinkSave){window.__rejectLinkSave=false;throw Error('Fixture metadata save failed; suggestions preserved')}
    if(revision!==state.revision)throw Error('Stale fixture revision')
    state.workspace=clone(workspace);state.revision++;window.__metadataWrites.push(clone(workspace));sessionStorage.setItem(key,JSON.stringify(state));return {workspace:clone(workspace),revision:state.revision,storage:clone(state.storage)}
  },createEvent:native,createLinkedEvent:native,updateEvent:native,updateDescription:native,setTaskCompleted:native,setCardCompleted:native,setDeckDependency:native,openExternal:async()=>{},readPage:async()=>({body:''}),exportWorkspace:async()=>({exported:true})}
},initial)
const dialog=()=>page.getByRole('dialog',{name:'Find matching events',exact:true})
const row=(workId,eventId)=>dialog().locator(`.match-row[data-work-id="${workId}"][data-event-id="${eventId}"]`)
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
async function until(predicate,message){const end=Date.now()+15000;while(Date.now()<end){if(predicate(await backend()))return;await new Promise(resolve=>setTimeout(resolve,50))}assert.fail(message)}
async function open(){await page.locator('.topbar-actions').getByRole('button',{name:'Find matching events',exact:true}).click();await dialog().getByRole('heading',{name:'Find matching events',exact:true}).waitFor()}
try{
  await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173')
  await page.getByRole('heading',{name:'Freelance',exact:true}).waitFor()
  await page.getByLabel('Search this view',{exact:true}).fill('Aster')
  await open()
  assert.equal(await dialog().locator('.match-row').count(),4)
  assert.equal(await dialog().getByRole('checkbox').count(),4)
  assert.equal(await row('subscription','subscription-event').getByRole('checkbox').isChecked(),true)
  assert.equal(await row('invoice','invoice-event').getByRole('checkbox').isChecked(),true,'An out-of-Space task and hidden calendar must remain eligible despite the main search')
  assert.equal(await row('client-task','client-event').getByRole('checkbox').isChecked(),false)
  assert.equal(await row('client-card','client-event').getByRole('checkbox').isChecked(),false)
  assert.match(await row('client-task','client-event').textContent(),/Several work items match this event/)
  assert.match(await dialog().locator('.match-scope').textContent(),/All loaded sources/)
  assert.match(await dialog().locator('.match-scope').textContent(),/filters do not limit this scan/)
  assert.equal(await page.evaluate(()=>window.__metadataWrites.length),0)
  assert.equal(await page.evaluate(()=>window.__nativeWrites),0)
  checks.push('Global app-bar scan includes out-of-Space tasks, hidden calendars and cards assigned to others despite view filters and text search; only unambiguous recommendations start selected, with no writes')

  await dialog().getByRole('button',{name:'Clear selection',exact:true}).click()
  assert.equal(await dialog().getByRole('button',{name:'Link selected (0)',exact:true}).isDisabled(),true)
  await dialog().getByRole('button',{name:'Select recommended (2)',exact:true}).click()
  await row('invoice','invoice-event').getByRole('checkbox').uncheck()
  await dialog().getByLabel('Search suggested links',{exact:true}).fill('electricity')
  assert.equal(await dialog().locator('.match-row').count(),1)
  await dialog().getByLabel('Search suggested links',{exact:true}).fill('')
  let guarded=false
  page.once('dialog',async prompt=>{guarded=true;await prompt.dismiss()})
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(guarded,true);assert.equal(await dialog().isVisible(),true)
  await page.screenshot({path:'artifacts/event-match-review.png'})
  await dialog().getByRole('button',{name:'Link selected (1)',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  await until(state=>state.workspace.relations.some(edge=>edge.type==='scheduled_during'&&edge.fromId==='subscription'&&edge.toId==='subscription-event'),'Approved Aster pair must persist')
  assert.equal((await backend()).workspace.relations.some(edge=>edge.fromId==='invoice'),false)
  assert.deepEqual((await backend()).records,initial.records)
  assert.equal(await page.evaluate(()=>window.__nativeWrites),0)
  checks.push('Checkbox review, search and clear/recommended selection work; confirm saves only approved links and preserves every source record/date')

  await open()
  assert.equal(await row('subscription','subscription-event').count(),0,'Existing associations must not be suggested again')
  await row('client-task','client-event').getByRole('checkbox').check()
  await page.evaluate(()=>window.__rejectLinkSave=true)
  await dialog().getByRole('button',{name:'Link selected (2)',exact:true}).click()
  await dialog().getByRole('alert').filter({hasText:'Fixture metadata save failed'}).first().waitFor()
  assert.equal(await dialog().locator('.match-row').count(),3,'Failed save keeps the reviewed snapshot')
  assert.equal(await row('client-task','client-event').getByRole('checkbox').isChecked(),true)
  assert.equal((await backend()).workspace.relations.some(edge=>edge.fromId==='client-task'),false)
  await row('invoice','invoice-event').getByRole('checkbox').uncheck()
  await dialog().getByRole('button',{name:'Link selected (1)',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  const saved=(await backend()).workspace.relations
  assert.equal(saved.filter(edge=>edge.fromId==='invoice'&&edge.toId==='invoice-event').length,0,'Deselecting a failed pair must exclude it from the retry snapshot')
  assert.equal(saved.filter(edge=>edge.fromId==='client-task'&&edge.toId==='client-event').length,1)
  assert.equal(saved.filter(edge=>edge.fromId==='client-card'&&edge.toId==='client-event').length,0)
  assert.equal(saved.filter(edge=>edge.id==='already').length,1,'Rolling back a failed attempt must preserve preexisting links')
  assert.equal(await page.evaluate(()=>window.__nativeWrites),0)
  checks.push('A failed save preserves the dialog; deselecting a pair before retry saves only the current selection and preserves preexisting links')

  await open()
  assert.equal(await row('invoice','invoice-event').getByRole('checkbox').isChecked(),true)
  await page.evaluate(()=>window.__rejectLinkSave=true)
  await dialog().getByRole('button',{name:'Link selected (1)',exact:true}).click()
  await dialog().getByRole('alert').filter({hasText:'Fixture metadata save failed'}).first().waitFor()
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  const writesBeforeRetry=await page.evaluate(()=>window.__metadataWrites.length)
  await page.getByRole('button',{name:'Retry save',exact:true}).click()
  await page.waitForFunction(count=>window.__metadataWrites.length>count,writesBeforeRetry)
  const afterCancel=(await backend()).workspace.relations
  assert.equal(afterCancel.some(edge=>edge.fromId==='invoice'),false,'Cancelling a failed confirmation must not leak its pairs into global Retry save')
  assert.deepEqual(afterCancel,saved,'Cancelled failed pairs must not change any previously persisted relation')
  assert.deepEqual((await backend()).records,initial.records)
  assert.equal(await page.evaluate(()=>window.__nativeWrites),0)
  checks.push('Cancelling after a failed confirmation leaves no pending associations for global Retry save and preserves all existing metadata and source records')

  await open()
  assert.equal(await row('invoice','invoice-event').getByRole('checkbox').isChecked(),true,'Cancelled failed pair remains available for a fresh review')
  await dialog().getByRole('button',{name:'Link selected (1)',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  assert.equal((await backend()).workspace.relations.filter(edge=>edge.fromId==='invoice'&&edge.toId==='invoice-event').length,1)

  await page.reload();await page.getByLabel('Search this view',{exact:true}).fill('')
  await open()
  assert.equal(await row('invoice','invoice-event').count(),0)
  assert.equal(await row('client-task','client-event').count(),0)
  assert.equal(await row('client-card','client-event').getByRole('checkbox').isChecked(),false)
  assert.match(await row('client-card','client-event').textContent(),/already linked to other work/)
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  assert.deepEqual(errors,[])
  checks.push('Accepted links survive reload, disappear from suggestions, and any competing remaining pair requires explicit review')
  await writeFile('artifacts/event-matches-ui-results.json',JSON.stringify({passed:checks.length,checks,rendererErrors:errors},null,2))
  console.log(JSON.stringify({passed:checks.length,checks,rendererErrors:errors},null,2))
}finally{await browser.close()}
