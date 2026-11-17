/** Automatic sync through a paused browser clock and independent fixture cloud.
 * No credentials, user profile, or real Nextcloud requests are used. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixed=new Date('2026-11-10T08:00:00Z')
const fixture=plannerFixture(fixed)
fixture.workspace.planner.view='list'
fixture.workspace.appearance.mode='dark'
fixture.workspace.relations=[]
fixture.storage={syncStatus:'local',localPath:'fixture-only/planner.json',remotePath:'fixture-only/cloud/planner.json'}
Object.assign(fixture.records.find(record=>record.id==='task-today'),{body:'# Original description\n\nKeep this source text.',etag:'source-1'})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1652,height:1100},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(12000)
const errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>{const url=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(url.hostname)?route.continue():route.abort()})
await page.clock.install({time:fixed})
// Pause before loading the app, so its 1200 ms debounce starts at a fixed time.
await page.clock.pauseAt(new Date(+fixed+60000))
await page.addInitScript(initial=>{
  const clone=value=>structuredClone(value)
  const state=clone(initial)
  let remoteWorkspace=clone(initial.workspace),localDirty=false,releaseSource
  const remoteQueue=[]
  const control=window.__syncTest={syncCalls:[],localSaves:[],sourceWrites:[],holdSource:false,failSource:false,failSync:false,conflictSync:false,
    queueRemote(patch){const next=clone(remoteQueue.at(-1)||remoteWorkspace);if(patch.spaceName)next.spaces.find(space=>space.id==='space-work').name=patch.spaceName;if(patch.property)next.properties['remote-test']={value:patch.property};remoteQueue.push(next)},
    releaseSource(){control.holdSource=false;if(releaseSource){const resolve=releaseSource;releaseSource=undefined;resolve()}},
    snapshot(){return {state:clone(state),remoteWorkspace:clone(remoteWorkspace),remoteQueued:remoteQueue.length,syncCalls:clone(control.syncCalls),localSaves:clone(control.localSaves),sourceWrites:clone(control.sourceWrites)}},
  }
  const read=async()=>clone(state)
  window.workspaceApi={getState:read,refresh:read,openExternal:async()=>{},readPage:async()=>({body:''}),exportWorkspace:async()=>({exported:true}),
    saveWorkspace:async(workspace,revision)=>{
      if(revision!==state.revision)throw Error('Stale fixture local revision')
      state.workspace=clone(workspace);state.revision++;localDirty=true
      state.storage={...state.storage,syncStatus:'pending',message:undefined}
      control.localSaves.push({at:Date.now(),revision:state.revision,workspace:clone(workspace)})
      return {workspace:clone(workspace),revision:state.revision,storage:clone(state.storage)}
    },
    syncWorkspace:async()=>{
      const call={at:Date.now(),direction:'noop'};control.syncCalls.push(call)
      if(control.failSync){control.failSync=false;call.direction='error';throw Error('Fixture cloud unavailable; local changes are preserved')}
      if(control.conflictSync){control.conflictSync=false;call.direction='conflict';state.storage={...state.storage,syncStatus:'conflict',message:'Fixture conflict needs review; both copies are preserved'};return read()}
      if(localDirty){assertNoQueuedRemote();remoteWorkspace=clone(state.workspace);localDirty=false;call.direction='push'}
      if(remoteQueue.length){remoteWorkspace=remoteQueue.shift();state.workspace=clone(remoteWorkspace);state.revision++;call.direction='pull'}
      state.storage={...state.storage,syncStatus:'synced',message:undefined,lastSyncedAt:new Date().toISOString()}
      return read()
    },
    updateDescription:async input=>{
      const record=state.records.find(record=>record.id===input.id)
      if(!record||record.readonly||input.etag!==record.etag)throw Error('Invalid fixture native edit')
      control.sourceWrites.push(clone(input))
      if(control.holdSource)await new Promise(resolve=>releaseSource=resolve)
      if(control.failSource){control.failSource=false;throw Error('Fixture source write failed; retry or discard the edit')}
      record.body=input.description;record.etag=`source-${control.sourceWrites.length+1}`
      return read()
    },
  }
  function assertNoQueuedRemote(){if(remoteQueue.length)throw Error('Fixture deliberately does not merge simultaneous metadata edits; settle local settings before queuing a remote workspace')}
},fixture)

const snapshot=()=>page.evaluate(()=>window.__syncTest.snapshot())
const cloudCount=async()=>(await snapshot()).syncCalls.length
const settle=async()=>{await page.evaluate(()=>Promise.resolve());await page.evaluate(()=>Promise.resolve())}
const tick=async milliseconds=>{await page.clock.runFor(milliseconds);await settle()}
const sidebarStatus=()=>page.locator('.sidebar-save>span').first()
const inspector=()=>page.getByRole('complementary',{name:'Item details'})
const description=()=>inspector().locator('.description-section')
const editor=()=>description().locator('.markdown-editor')
const textarea=()=>editor().getByLabel('Markdown',{exact:true})
const sourceFailure=()=>page.locator('.source-edit-error')
const remoteName=async()=>(await snapshot()).state.workspace.spaces.find(space=>space.id==='space-work').name
const queue=patch=>page.evaluate(patch=>window.__syncTest.queueRemote(patch),patch)
async function click(locator){await locator.click({force:true});await settle()}
async function beginDescription(){await click(description().getByRole('button',{name:'Edit',exact:true}));await click(editor().getByRole('tab',{name:'Markdown',exact:true}))}
async function cancelDescription(){page.once('dialog',dialog=>dialog.accept());await click(description().getByRole('button',{name:'Cancel',exact:true}))}

try{
  await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173')
  await page.locator('.list-view').waitFor();await settle()
  assert.equal(await cloudCount(),0)
  assert.equal(await sidebarStatus().textContent(),'Waiting to sync')
  await tick(1199);assert.equal(await cloudCount(),0,'Startup sync waits for the full idle debounce')
  await tick(1);assert.equal(await cloudCount(),1)
  assert.equal(await sidebarStatus().textContent(),'Synced to Nextcloud')
  await tick(10000);assert.equal(await cloudCount(),1,'A synced no-op response does not schedule a sync loop')
  checks.push('Startup waits 1200 ms, reports cloud sync accurately, and does not loop on no-op responses')

  const beforeBatch=await cloudCount(),savedBefore=(await snapshot()).localSaves.length
  await click(page.getByRole('tab',{name:'Board',exact:true}));await tick(400)
  await click(page.getByRole('tab',{name:'Timeline',exact:true}));await tick(400)
  await click(page.getByRole('tab',{name:'List',exact:true}));await tick(1199)
  assert.equal((await snapshot()).localSaves.length,savedBefore+3,'Each local edit is saved immediately')
  assert.equal(await cloudCount(),beforeBatch,'Changing settings resets the pending cloud debounce')
  assert.equal(await sidebarStatus().textContent(),'Waiting to sync')
  await tick(1);assert.equal(await cloudCount(),beforeBatch+1)
  assert.equal((await snapshot()).remoteWorkspace.planner.view,'list')
  assert.equal((await snapshot()).syncCalls.at(-1).direction,'push')
  checks.push('Several settings edits save locally immediately and produce one debounced cloud push')

  await queue({spaceName:'Freelance from another PC',property:'minute poll'})
  const beforePull=await cloudCount();await tick(60000)
  assert.ok(await cloudCount()>beforePull,'The minute poll calls the cloud while idle')
  assert.equal(await remoteName(),'Freelance from another PC')
  assert.equal(await page.locator('.space-nav').filter({hasText:'Freelance from another PC'}).count(),1)
  assert.equal((await snapshot()).state.workspace.properties['remote-test'].value,'minute poll')
  // Drain at most one debounce caused by adopting a new local revision. A
  // subsequent no-op must keep the revision stable and stop re-scheduling.
  await tick(5000);const quietCount=await cloudCount();await tick(5000)
  assert.equal(await cloudCount(),quietCount)
  checks.push('Minute polling adopts independent remote metadata and updates the visible Space without runaway no-op requests')

  await page.getByLabel('Search this view',{exact:true}).fill('Prepare review notes')
  await click(page.locator('.list-table-row').filter({hasText:'Prepare review notes'}))
  await beginDescription();await textarea().fill('# Unsaved description\n\nKeep my exact draft.')
  await queue({spaceName:'Deferred during description',property:'dirty editor'})
  const beforeDirty=await cloudCount();await tick(60000)
  assert.equal(await cloudCount(),beforeDirty,'An open dirty description blocks polling and scheduled sync')
  assert.equal(await textarea().inputValue(),'# Unsaved description\n\nKeep my exact draft.')
  assert.equal(await remoteName(),'Freelance from another PC')
  assert.equal((await snapshot()).remoteQueued,1)
  await cancelDescription();await tick(1300)
  assert.equal(await remoteName(),'Deferred during description')
  assert.equal((await snapshot()).state.records.find(record=>record.id==='task-today').body,'# Original description\n\nKeep this source text.')
  await tick(2500)
  checks.push('Dirty description drafts block cloud adoption; cancelling preserves native text and resumes the deferred pull')

  await beginDescription();await textarea().fill('# Retry this source draft')
  await page.evaluate(()=>window.__syncTest.holdSource=true)
  await click(description().getByRole('button',{name:'Save description',exact:true}))
  assert.equal(await page.locator('.source-save-status').count(),1)
  await queue({spaceName:'Deferred until source retry',property:'failed edit lock'})
  const beforeHeld=await cloudCount();await tick(60000)
  assert.equal(await cloudCount(),beforeHeld,'In-flight native edits block cloud replacement')
  await page.evaluate(()=>{window.__syncTest.failSource=true;window.__syncTest.releaseSource()});await settle()
  assert.equal(await sourceFailure().count(),1)
  assert.equal(await textarea().inputValue(),'# Retry this source draft')
  await cancelDescription()
  const beforeFailure=await cloudCount();await tick(60000)
  assert.equal(await cloudCount(),beforeFailure,'A failed native edit continues to block automatic sync after its editor closes')
  await click(page.getByRole('button',{name:'Sync planner',exact:true}))
  assert.equal(await cloudCount(),beforeFailure,'Manual sync also respects unresolved native edits')
  await click(sourceFailure().getByRole('button',{name:'Retry edit',exact:true}))
  assert.equal(await sourceFailure().count(),0)
  assert.equal((await snapshot()).state.records.find(record=>record.id==='task-today').body,'# Retry this source draft')
  await tick(1300);assert.equal(await remoteName(),'Deferred until source retry');await tick(2500)
  checks.push('In-flight and failed native edits lock cloud adoption until an explicit successful source retry')

  await queue({spaceName:'Recovered cloud workspace',property:'retry'})
  await page.evaluate(()=>window.__syncTest.failSync=true)
  await click(page.getByRole('button',{name:'Sync planner',exact:true}))
  assert.equal(await sidebarStatus().textContent(),'Sync needs attention')
  const warning=page.locator('.warning-notice').filter({hasText:'Fixture cloud unavailable'})
  assert.equal(await warning.count(),1)
  assert.equal((await snapshot()).remoteQueued,1)
  assert.equal(await remoteName(),'Deferred until source retry')
  await page.screenshot({path:'artifacts/automatic-sync-warning.png',fullPage:true})
  await click(warning.getByRole('button',{name:'Retry sync',exact:true}))
  assert.equal(await remoteName(),'Recovered cloud workspace')
  assert.equal(await sidebarStatus().textContent(),'Synced to Nextcloud')
  assert.equal(await warning.count(),0)
  await tick(2500)
  checks.push('Cloud failure is visible in the sidebar and warning banner; Retry sync adopts the queued workspace without losing local data')

  await queue({spaceName:'After reviewed conflict',property:'conflict retry'})
  await page.evaluate(()=>window.__syncTest.conflictSync=true)
  await click(page.getByRole('button',{name:'Sync planner',exact:true}))
  assert.equal(await sidebarStatus().textContent(),'Sync conflict')
  const beforeConflict=await cloudCount();await tick(120000)
  assert.equal(await cloudCount(),beforeConflict,'Conflict state stops background retries instead of overwriting either copy')
  const conflict=page.locator('.warning-notice').filter({hasText:'Fixture conflict needs review'})
  await click(conflict.getByRole('button',{name:'Retry sync',exact:true}))
  assert.equal(await remoteName(),'After reviewed conflict')
  assert.equal(await sidebarStatus().textContent(),'Synced to Nextcloud')
  checks.push('Conflicts pause background requests and remain recoverable through the explicit retry action')
  assert.deepEqual(errors,[])
  const report={passed:checks.length,checks,rendererErrors:errors,counts:{cloud:(await snapshot()).syncCalls.length,localSaves:(await snapshot()).localSaves.length,nativeWrites:(await snapshot()).sourceWrites.length}}
  await writeFile('artifacts/automatic-sync-ui-results.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
}finally{await browser.close()}
