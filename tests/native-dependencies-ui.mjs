/** Native Deck interoperability uses an isolated, persistent mock server; never a live account. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState} from '@nextspace/core/planner.mjs'

const initial=createEmptyState()
initial.mode='live';initial.connection={connected:true,username:'tester',serverUrl:'https://fixture.invalid'}
initial.workspace.planner.view='list';initial.workspace.appearance.mode='dark'
initial.collections=[{id:'deck',source:'deck',title:'Studio board',stacks:[{id:'todo',title:'To do'}]},{id:'tasks',source:'tasks',title:'Studio tasks'}]
const card=(id,title,extra={})=>({id,title,kind:'card',source:'deck',collectionId:'deck',collectionTitle:'Studio board',stackId:'todo',status:'To do',readonly:false,completed:false,assigneeIds:['tester'],assignmentCount:1,assignmentKnown:true,start:'2026-11-03',due:'2026-11-06',nativeDependencies:[],...extra})
initial.records=[
  card('cut','Edit opening sequence',{nativeDependencies:['assets']}),
  card('assets','Collect assets'),
  card('sound','Record sound'),
  card('delivery','Deliver final cut'),
  card('story','Draw storyboard'),
  card('locked','Locked client card',{readonly:true}),
  card('legacy','Migrated edit'),
  card('legacy-prerequisite','Migrated prerequisite'),
  card('website','Project move n update',{nativeDependencies:['storm']}),
  card('blueprints','Rebuid ProjectBlueprints',{nativeDependencies:['website']}),
  card('storm','Publish release notes'),
  card('render','Render project preview',{nativeDependencies:['blueprints']}),
  {id:'estimate',title:'Approve estimate',kind:'task',source:'tasks',collectionId:'tasks',collectionTitle:'Studio tasks',readonly:false,completed:false,due:'2026-11-05'},
]
initial.workspace.relations=[{id:'legacy-card-link',type:'depends_on',fromId:'legacy',toId:'legacy-prerequisite'}]
initial.statuses=initial.statuses.map(status=>({...status,state:'connected',count:initial.records.filter(record=>record.source===status.source).length}))
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1652,height:1050},timezoneId:'Europe/Budapest'})
const checks=[],errors=[]
page.setDefaultTimeout(15000)
page.on('pageerror',error=>errors.push(error.message))
await page.addInitScript(data=>{
  const clone=value=>structuredClone(value),key='native-dependency-server'
  let state=JSON.parse(sessionStorage.getItem(key)||'null')||clone(data)
  window.__dependencyCalls=[];window.__rejectDependency=false;window.__holdDependency=false;window.__loseMigrationAck=true
  const persist=()=>sessionStorage.setItem(key,JSON.stringify(state))
  const read=async()=>clone(state)
  window.workspaceApi={getState:read,refresh:read,saveWorkspace:async(workspace,revision)=>{
    if(revision!==state.revision)throw Error('Stale dependency fixture')
    state.workspace=clone(workspace);state.revision++;persist()
    return {workspace:clone(workspace),revision:state.revision,storage:clone(state.storage)}
  },setDeckDependency:async input=>{
    window.__dependencyCalls.push(clone(input))
    if(window.__rejectDependency){window.__rejectDependency=false;throw Error('Fixture Deck rejected dependency')}
    if(window.__holdDependency)await new Promise(resolve=>window.__releaseDependency=resolve)
    const dependent=state.records.find(record=>record.id===input.fromId),prerequisite=state.records.find(record=>record.id===input.toId)
    if(!dependent||!prerequisite||dependent.source!=='deck'||prerequisite.source!=='deck')throw Error('Choose two Deck cards')
    if(dependent.readonly)throw Error('Read-only Deck card')
    dependent.nativeDependencies=input.remove?(dependent.nativeDependencies||[]).filter(id=>id!==prerequisite.id):[...new Set([...(dependent.nativeDependencies||[]),prerequisite.id])]
    persist()
    if(input.fromId==='legacy'&&window.__loseMigrationAck){window.__loseMigrationAck=false;throw Error('Fixture lost migration acknowledgement')}
    return read()
  },updateRecordDates:read,updateDescription:read,openExternal:async()=>{},readPage:async()=>({body:''}),syncWorkspace:read,exportWorkspace:async()=>({exported:true})}
},initial)
const details=()=>page.getByRole('complementary',{name:'Item details'})
const dialog=()=>page.getByRole('dialog',{name:'Add dependency',exact:true})
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const calls=()=>page.evaluate(()=>window.__dependencyCalls)
async function waitBackend(predicate,message){
  const deadline=Date.now()+15000
  do{
    const snapshot=await backend()
    if(predicate(snapshot)===true)return snapshot
    await new Promise(resolve=>setTimeout(resolve,50))
  }while(Date.now()<deadline)
  assert.fail(message)
}
async function openRecord(title){
  if(await details().count())await page.getByRole('button',{name:'Close item details',exact:true}).click()
  await page.getByRole('tab',{name:'List',exact:true}).click()
  await page.locator('.list-table-row').filter({hasText:title}).first().click()
  await details().getByRole('heading',{name:title,exact:true}).waitFor()
}
async function pick(title,direction='incoming'){
  await details().getByRole('button',{name:'Add dependency',exact:true}).click()
  await dialog().getByRole('radio',{name:direction==='incoming'?'Waits for (incoming)':'Needed by (outgoing)',exact:false}).check()
  await dialog().getByLabel('Find related work',{exact:true}).fill(title)
  await dialog().getByRole('radio',{name:title,exact:true}).check()
}
async function waitNative(fromId,toId,present=true){return waitBackend(state=>Boolean(state.records.find(record=>record.id===fromId)?.nativeDependencies?.includes(toId))===present,`Native dependency ${fromId} -> ${toId} did not become ${present?'present':'absent'}`)}
async function assertInspectorDirections(title,waitsFor,neededBy){
  await openRecord(title)
  const section=details().getByRole('region',{name:'Dependencies',exact:true})
  const incoming=section.locator('[data-direction="incoming"]'),outgoing=section.locator('[data-direction="outgoing"]')
  assert.deepEqual(await incoming.locator('.dependency-open strong').allTextContents(),waitsFor,`${title}: incoming column must contain only its prerequisites`)
  assert.deepEqual(await outgoing.locator('.dependency-open strong').allTextContents(),neededBy,`${title}: outgoing column must contain only work waiting for it`)
  const boxes=await Promise.all([incoming.boundingBox(),outgoing.boundingBox()])
  assert.ok(boxes[0]&&boxes[1]&&Math.abs(boxes[0].y-boxes[1].y)<2&&boxes[1].x>=boxes[0].x+boxes[0].width-2,'Incoming and outgoing columns appear side by side')
  assert.equal(await section.evaluate(element=>{
    const description=[...element.parentElement.querySelectorAll('h3')].find(heading=>heading.textContent==='Description')
    return Boolean(description&&(element.compareDocumentPosition(description)&Node.DOCUMENT_POSITION_FOLLOWING))
  }),true,'Dependencies must appear before Description')
}
function assertNoLocalCards(state){assert.equal(state.workspace.relations.filter(edge=>edge.type==='depends_on'&&state.records.find(record=>record.id===edge.fromId)?.source==='deck'&&state.records.find(record=>record.id===edge.toId)?.source==='deck').length,0,'Card dependencies must not be saved only in planner metadata')}
try{
  await page.goto('http://127.0.0.1:5173')
  const migrationFailure=page.getByRole('alert').filter({hasText:'Fixture lost migration acknowledgement'})
  await migrationFailure.waitFor()
  assert.equal((await backend()).workspace.relations.some(edge=>edge.id==='legacy-card-link'),true,'Unacknowledged migration preserves the original planner dependency')
  await waitNative('legacy','legacy-prerequisite')
  await migrationFailure.getByRole('button',{name:'Retry edit',exact:true}).click()
  await migrationFailure.waitFor({state:'hidden'})
  await waitBackend(state=>!state.workspace.relations.some(edge=>edge.id==='legacy-card-link'),'Acknowledged migration did not remove the planner duplicate')
  assert.deepEqual((await backend()).records.find(record=>record.id==='legacy').nativeDependencies,['legacy-prerequisite'],'Retry after lost acknowledgement must remain idempotent')
  await openRecord('Migrated edit')
  assert.equal(await details().locator('.dependencies-section .inspector-linked-row').filter({hasText:'Migrated prerequisite'}).getByText('From Deck',{exact:true}).count(),1)
  checks.push('Existing card dependencies migrate to Deck; a lost acknowledgement retains the old link until an idempotent retry succeeds')
  await assertInspectorDirections('Project move n update',['Publish release notes'],['Rebuid ProjectBlueprints'])
  await assertInspectorDirections('Rebuid ProjectBlueprints',['Project move n update'],['Render project preview'])
  await page.screenshot({path:'artifacts/native-dependencies-user-chain.png'})
  checks.push('The synthetic Project dependency chain has separate incoming and outgoing columns before Description')
  await openRecord('Edit opening sequence')
  assert.equal(await details().getByRole('region',{name:'Linked in Deck',exact:true}).count(),0)
  const assets=details().locator('.dependencies-section .inspector-linked-row').filter({hasText:'Collect assets'})
  assert.equal(await assets.getByText('From Deck',{exact:true}).count(),1)
  assert.ok(await assets.getByRole('button',{name:'Remove dependency Collect assets',exact:true}).isEnabled())
  await assets.getByRole('button',{name:'Remove dependency Collect assets',exact:true}).click()
  await waitNative('cut','assets',false)
  assert.deepEqual((await calls()).at(-1),{fromId:'cut',toId:'assets',remove:true})
  assertNoLocalCards(await backend())
  checks.push('Native Deck dependencies use the common Dependencies section and can be removed through Deck')

  await page.evaluate(()=>window.__holdDependency=true)
  await pick('Record sound')
  await dialog().getByRole('button',{name:'Add dependency',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  assert.equal(await details().locator('.dependencies-section .inspector-linked-row').filter({hasText:'Record sound'}).count(),1,'Optimistic dependency appears while Deck is saving')
  assert.equal((await backend()).records.find(record=>record.id==='cut').nativeDependencies.includes('sound'),false)
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}),true)
  await page.evaluate(()=>{window.__holdDependency=false;window.__releaseDependency()})
  await waitNative('cut','sound')
  const incoming=(await calls()).at(-1)
  assert.equal(incoming.fromId,'cut');assert.equal(incoming.toId,'sound');assert.equal(Boolean(incoming.remove),false)
  await pick('Deliver final cut','outgoing')
  await dialog().getByRole('button',{name:'Add dependency',exact:true}).click()
  await dialog().waitFor({state:'hidden'});await waitNative('delivery','cut')
  const outgoing=(await calls()).at(-1)
  assert.equal(outgoing.fromId,'delivery');assert.equal(outgoing.toId,'cut')
  assertNoLocalCards(await backend())
  checks.push('Incoming and outgoing picker choices write the correct native Deck direction without planner-only duplicates')

  const beforeMixed=(await calls()).length
  await pick('Approve estimate')
  await dialog().getByRole('button',{name:'Add dependency',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  await waitBackend(state=>state.workspace.relations.some(edge=>edge.type==='depends_on'&&edge.fromId==='cut'&&edge.toId==='estimate'),'Mixed-source dependency was not saved in planner metadata')
  assert.equal((await calls()).length,beforeMixed)
  checks.push('A task-to-card dependency remains planner metadata because Deck cannot store a CalDAV task')

  await page.reload();await openRecord('Edit opening sequence')
  const nativeRows=details().locator('.dependencies-section .inspector-linked-row').filter({hasText:/Record sound|Deliver final cut/})
  assert.equal(await nativeRows.count(),2)
  assert.equal(await nativeRows.getByText('From Deck',{exact:true}).count(),2)
  await page.screenshot({path:'artifacts/native-dependencies-inspector.png'})
  checks.push('Native dependencies survive reload and render from the server response in both directions')

  await page.evaluate(()=>window.__rejectDependency=true)
  await pick('Collect assets')
  await dialog().getByRole('button',{name:'Add dependency',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  const failed=page.getByRole('alert').filter({hasText:'Fixture Deck rejected dependency'})
  await failed.waitFor()
  await waitNative('cut','assets',false)
  assertNoLocalCards(await backend())
  assert.equal(await details().locator('.dependencies-section .inspector-linked-row').filter({hasText:'Collect assets'}).count(),0,'Rejected optimistic dependency rolls back')
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}),true,'Failed native work must remain protected')
  await failed.getByRole('button',{name:'Retry edit',exact:true}).click()
  await waitNative('cut','assets')
  await failed.waitFor({state:'hidden'})
  checks.push('Rejected native saves roll back, retain a protected retry, and never fall back to a planner-only card link')

  await details().getByRole('button',{name:'Add dependency',exact:true}).click()
  await dialog().getByLabel('Find related work',{exact:true}).fill('Locked client card')
  assert.equal(await dialog().getByRole('radio',{name:'Locked client card',exact:true}).isEnabled(),true,'A prerequisite only needs read access; the editable selected card owns the relation')
  await dialog().getByRole('radio',{name:'Needed by (outgoing)',exact:false}).check()
  assert.equal(await dialog().getByRole('radio',{name:'Locked client card',exact:true}).isDisabled(),true,'An outgoing dependent owns its native Deck relation and must be writable')
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
  checks.push('Native Deck permissions require an editable dependent but permit a readable prerequisite')

  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  await page.getByRole('tab',{name:'Timeline',exact:true}).click()
  await page.getByLabel('Timeline range').selectOption('7')
  await page.getByLabel('Choose calendar date').fill('2026-11-02');await page.getByLabel('Choose calendar date').dispatchEvent('change')
  const connector=page.locator('.timeline-chart-row[data-record-id="assets"] .timeline-connector')
  const target=page.locator('.timeline-row-label[data-record-id="story"]')
  await connector.scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded()
  const fromBox=await connector.boundingBox(),toBox=await target.boundingBox()
  await page.mouse.move(fromBox.x+fromBox.width/2,fromBox.y+fromBox.height/2);await page.mouse.down()
  await page.mouse.move(toBox.x+80,toBox.y+toBox.height/2,{steps:12});await page.mouse.up()
  await waitNative('story','assets')
  assert.equal((await calls()).at(-1).fromId,'story');assert.equal((await calls()).at(-1).toId,'assets')
  assertNoLocalCards(await backend())
  assert.equal(await page.locator('.deck-link-path').count(),0)
  assert.ok(await page.locator('.dependency-path').count()>=3)
  checks.push('Dragging a timeline connector writes the successor’s native dependency and renders a standard dependency arrow')

  assert.deepEqual(errors,[])
  await writeFile('artifacts/native-dependencies-ui.json',JSON.stringify({passed:checks.length,checks,errors},null,2))
  console.log(JSON.stringify({passed:checks.length,checks},null,2))
}catch(error){await page.screenshot({path:'artifacts/native-dependencies-failure.png',fullPage:true});throw error}finally{await browser.close()}
