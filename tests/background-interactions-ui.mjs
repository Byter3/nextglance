/** UI concurrency checks against isolated, deliberately delayed bridge replies. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'

const fixed=new Date('2026-11-11T08:00:00Z'),fixture=plannerFixture(fixed)
Object.assign(fixture.workspace.planner,{view:'list',assignment:'all',showCompleted:false,showCompletedByView:{}})
fixture.workspace.appearance.mode='dark';fixture.workspace.relations=[]
fixture.workspace.identities=[{id:'task-today',source:'tasks',key:'tasks:fixture-today'}]
fixture.storage={syncStatus:'synced',lastSyncedAt:fixed.toISOString(),localPath:'fixture/planner.json',remotePath:'fixture/Nextspace/'}
Object.assign(fixture.records.find(record=>record.id==='task-today'),{status:'NEEDS-ACTION',percentComplete:0})
Object.assign(fixture.records.find(record=>record.id==='card-mine'),{body:'Initial Deck description.',etag:'deck-v1'})
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1680,height:1100},timezoneId:'Europe/Budapest'})
page.setDefaultTimeout(15000)
const checks=[],errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
await page.clock.install({time:fixed});await page.clock.pauseAt(new Date(+fixed+60000))
await page.addInitScript(initial=>{
  const clone=value=>structuredClone(value),key='background-interactions-fixture'
  const state=JSON.parse(sessionStorage.getItem(key)||'null')||clone(initial)
  const persist=()=>sessionStorage.setItem(key,JSON.stringify(state))
  const control=window.__background={holdSync:false,holdRefresh:false,holdNative:false,holdSave:false,failSync:false,failRefresh:false,failNative:false,failSave:false,staleNextSave:false,remapTaskOnSync:false,heldSync:null,heldRefresh:null,heldNative:null,heldSave:null,saves:[],writes:[],reads:0,syncCalls:0,refreshCalls:0,remoteDeckDescription:null,
    snapshot(){return {state:clone(state),saves:clone(control.saves),writes:clone(control.writes),reads:control.reads,syncCalls:control.syncCalls,refreshCalls:control.refreshCalls,heldSync:Boolean(control.heldSync),heldRefresh:Boolean(control.heldRefresh),heldNative:Boolean(control.heldNative),heldSave:Boolean(control.heldSave)}},
    setConnected(value){state.connection.connected=value;persist()},
    release(kind){const name=`held${kind}`;if(!control[name])throw Error(`No held ${kind} operation`);const release=control[name];control[name]=null;release()},
  }
  const read=async()=>{control.reads++;return clone(state)}
  const stamp=()=>{state.storage={...state.storage,syncStatus:'synced',message:undefined,lastSyncedAt:new Date().toISOString()};persist()}
  function remoteProperty(name){state.workspace.properties[name]={value:'retained remote data'};state.workspace.spaces.find(space=>space.id==='space-work').name=name;state.revision++;persist()}
  function canonicalizeTask(){
    const old='task-today',canonical='task-today-cloud'
    state.records.find(record=>record.id===old).id=canonical
    state.workspace.identities.find(identity=>identity.id===old).id=canonical
    state.recordIdAliases={...state.recordIdAliases,[old]:canonical}
    for(const plan of state.workspace.plans)if(plan.recordId===old)plan.recordId=canonical
    for(const edge of state.workspace.relations){if(edge.fromId===old)edge.fromId=canonical;if(edge.toId===old)edge.toId=canonical}
    if(state.workspace.properties[old]){state.workspace.properties[canonical]=state.workspace.properties[old];delete state.workspace.properties[old]}
    state.revision++;persist()
  }
  async function sync(){
    control.syncCalls++
    if(control.failSync){control.failSync=false;throw Error('Fixture cloud temporarily unavailable')}
    const before=clone(state),revision=state.revision
    if(control.holdSync){
      await new Promise(resolve=>control.heldSync=resolve)
      control.holdSync=false;remoteProperty('Remote sync change')
      if(control.remapTaskOnSync){control.remapTaskOnSync=false;canonicalizeTask()}
      state.storage={...state.storage,syncStatus:state.revision===revision+1?'synced':'pending'};persist()
      // Deliberately return a snapshot from before concurrent local edits.
      before.workspace.properties['Remote sync change']={value:'retained remote data'}
      before.workspace.spaces.find(space=>space.id==='space-work').name='Remote sync change'
      before.revision=revision+1;before.storage={...before.storage,syncStatus:'synced'}
      return before
    }
    stamp();return read()
  }
  async function refresh(){
    control.refreshCalls++
    const before=clone(state)
    if(control.holdRefresh){await new Promise(resolve=>control.heldRefresh=resolve);control.holdRefresh=false;return before}
    for(const status of state.statuses){status.state='connected';status.lastSyncedAt=new Date().toISOString()}
    if(control.remoteDeckDescription!==null){const card=state.records.find(record=>record.id==='card-mine');card.body=control.remoteDeckDescription;card.etag=`deck-v${control.refreshCalls}`;control.remoteDeckDescription=null}
    if(control.failRefresh){control.failRefresh=false;const status=state.statuses.find(item=>item.source==='calendar');status.state='error';status.message='Fixture calendar refresh failed'}
    persist();return read()
  }
  async function taskStatus(input){
    const record=state.records.find(item=>item.id===(state.recordIdAliases?.[input.id]||input.id))
    if(input.etag!==undefined&&input.etag!==record.etag)throw Error('Fixture native version changed')
    control.writes.push(clone(input))
    if(control.holdNative)await new Promise(resolve=>control.heldNative=resolve)
    if(control.failNative){control.failNative=false;throw Error('Fixture native edit failed')}
    const percent=record.percentComplete||0
    record.status=input.status;record.completed=input.status==='COMPLETED'
    record.percentComplete=record.completed?100:input.status==='IN-PROCESS'?Math.max(1,Math.min(99,percent)):input.status==='NEEDS-ACTION'?Math.min(99,percent):percent
    record.etag=`task-v${control.writes.length+1}`;persist();return read()
  }
  window.workspaceApi={getState:read,refresh,syncWorkspace:sync,readPage:async()=>({body:''}),openExternal:async()=>{},exportWorkspace:async()=>({exported:true}),updateTaskStatus:taskStatus,
    setTaskCompleted:input=>taskStatus({...input,status:input.completed?'COMPLETED':'NEEDS-ACTION'}),
    saveWorkspace:async(workspace,revision)=>{
      if(control.holdSave)await new Promise(resolve=>control.heldSave=resolve)
      if(control.failSave){control.failSave=false;throw Error('Fixture local planner save failed')}
      if(control.staleNextSave){control.staleNextSave=false;remoteProperty('Remote save-race change')}
      if(revision!==state.revision)throw Object.assign(Error('This workspace changed since you opened it. Reload the latest workspace before saving. Your newer saved version is intact.'),{code:'REVISION_CONFLICT'})
      state.workspace=clone(workspace);state.revision++;state.storage={...state.storage,syncStatus:'pending'};persist()
      control.saves.push({revision:state.revision,workspace:clone(workspace)})
      return {workspace:clone(state.workspace),revision:state.revision,storage:clone(state.storage)}
    },
  }
},fixture)

const snapshot=()=>page.evaluate(()=>window.__background.snapshot())
const settle=async()=>{await page.evaluate(()=>Promise.resolve());await page.evaluate(()=>Promise.resolve())}
const button=()=>page.getByRole('button',{name:'Show done',exact:true})
const topbar=()=>page.locator('.app-topbar')
const cloud=()=>topbar().locator('.sync-button')
const refresh=()=>topbar().getByRole('button',{name:'Refresh Nextcloud sources',exact:true})
const details=()=>page.getByRole('complementary',{name:'Item details',exact:true})
const status=()=>details().getByLabel('Task status',{exact:true})
async function chooseStatus(value){await status().click();await page.locator(`.status-select-option[data-value="${value}"]`).click()}
const taskRow=()=>page.locator('.list-table-row').filter({hasText:'Prepare review notes'})
const release=kind=>page.evaluate(kind=>window.__background.release(kind),kind)
async function click(locator){await locator.click({force:true});await settle()}
async function until(predicate,message){const end=Date.now()+15000;while(Date.now()<end){if(predicate(await snapshot()))return;await new Promise(resolve=>setTimeout(resolve,25))}assert.fail(message)}
async function view(label){await click(page.getByRole('tab',{name:label,exact:true}));await until(value=>value.state.workspace.planner.view===label.toLowerCase(),`Save ${label} view`)}
async function showDone(value){if((await button().getAttribute('aria-pressed'))!==String(value))await click(button());await until(data=>(data.state.workspace.planner.showCompletedByView?.[data.state.workspace.planner.view]??data.state.workspace.planner.showCompleted)===value,`Save Show done=${value}`);assert.equal(await button().getAttribute('aria-pressed'),String(value))}
async function cloudState(expected){const end=Date.now()+15000;while(Date.now()<end){if(await cloud().getAttribute('data-sync-state')===expected)return;await new Promise(resolve=>setTimeout(resolve,25))}assert.equal(await cloud().getAttribute('data-sync-state'),expected)}
async function openTask(){if(await details().count())return;await taskRow().click();await status().waitFor()}
async function sourceSaved(value){await until(data=>data.state.records.find(record=>record.id===(data.state.recordIdAliases?.['task-today']||'task-today')).status===value,`Native status ${value} must save`);await settle()}
async function closeDetails(){if(await details().count())await click(details().getByRole('button',{name:'Close item details',exact:true}))}
async function syncNow(){await click(cloud());await cloudState('synced')}
async function settingsDialog(){
  await closeDetails()
  const navigation=topbar().getByRole('button',{name:'Open navigation',exact:true})
  if(await navigation.isVisible())await click(navigation)
  await click(page.locator('.sidebar-settings'))
  const dialog=page.getByRole('dialog',{name:'Settings and connection',exact:true})
  await dialog.waitFor();return dialog
}

try{
  await page.goto(process.env.NEXTSPACE_TEST_URL||'http://127.0.0.1:5173');await page.locator('.list-view').waitFor();await settle()
  const matching=topbar().getByRole('button',{name:'Find matching events',exact:true})
  assert.equal((await matching.textContent()).trim(),'','Matching events is icon-only')
  assert.ok(await matching.getAttribute('title'));assert.ok(await matching.locator('svg').count())
  await cloudState('synced');assert.equal(await cloud().locator('.cloud-check').count(),1)
  checks.push('Global matching action is an accessible icon with a tooltip, and a checked cloud identifies a current healthy connection')

  const choices={Overview:true,Calendar:true,Timeline:false,Board:true,List:false}
  for(const [label,value] of Object.entries(choices)){await view(label);await showDone(!value);await showDone(value)}
  for(const [label,value] of Object.entries(choices)){await view(label);assert.equal(await button().getAttribute('aria-pressed'),String(value),`${label} restores its choice`)}
  await page.reload();await button().waitFor();await settle()
  for(const [label,value] of Object.entries(choices)){await view(label);assert.equal(await button().getAttribute('aria-pressed'),String(value),`${label} restores after reload`)}
  await view('List');await showDone(true);await openTask();await chooseStatus('COMPLETED');await sourceSaved('COMPLETED')
  assert.equal(await taskRow().count(),1,'Completing a task keeps it in the list when Show done is enabled')
  await showDone(false);assert.equal(await taskRow().count(),0)
  await showDone(true);assert.equal(await taskRow().count(),1)
  await chooseStatus('NEEDS-ACTION');await sourceSaved('NEEDS-ACTION');await closeDetails()
  await page.getByLabel('Search this view',{exact:true}).fill('Prepare review notes')
  await click(page.getByRole('button',{name:'Filters',exact:true}))
  await click(page.getByRole('button',{name:'Reset',exact:true}))
  assert.equal(await button().getAttribute('aria-pressed'),'true','Resetting filters preserves the remembered layout preference')
  if(await page.locator('.filter-popover').count())await click(page.getByRole('button',{name:'Filters',exact:true}))
  checks.push('All five layouts remember independent done visibility through navigation and reload; completion stays visible when enabled and filter reset preserves the choice')

  await openTask();await syncNow()
  await page.evaluate(()=>window.__background.holdSync=true);await click(cloud())
  await until(value=>value.heldSync,'Cloud sync should be held');await cloudState('syncing')
  assert.equal(await topbar().locator('.sync-activity-icon.spinning').count(),1)
  assert.equal(await button().isEnabled(),true);assert.equal(await status().isEnabled(),true)
  await view('Board');await showDone(false)
  await chooseStatus('IN-PROCESS');await sourceSaved('IN-PROCESS')
  assert.equal(await status().getAttribute('data-value'),'IN-PROCESS')
  await release('Sync');await settle()
  await until(value=>!value.heldSync&&value.state.workspace.properties['Remote sync change'],'Remote metadata commits on completion')
  assert.equal(await page.getByRole('tab',{name:'Board',exact:true}).getAttribute('aria-selected'),'true')
  assert.equal(await button().getAttribute('aria-pressed'),'false')
  assert.equal(await status().getAttribute('data-value'),'IN-PROCESS','A stale sync response cannot revert a newer native edit')
  await page.locator('.space-nav').filter({hasText:'Remote sync change'}).waitFor({state:'attached'})
  assert.equal((await snapshot()).state.workspace.properties['Remote sync change'].value,'retained remote data')
  await syncNow()
  checks.push('Metadata sync stays in the background: navigation, remembered filters and native edits continue; stale completion cannot erase newer edits or independent remote metadata')

  await page.evaluate(()=>{window.__background.holdRefresh=true;window.__background.holdNative=true})
  await click(refresh());await until(value=>value.heldRefresh,'Native refresh should be held');await cloudState('syncing')
  await view('List');await showDone(true)
  await chooseStatus('CANCELLED');await until(value=>value.heldNative,'Native task write should be held')
  assert.equal(await status().getAttribute('data-value'),'CANCELLED','Native status changes optimistically during refresh')
  await release('Refresh');await settle()
  assert.equal(await status().getAttribute('data-value'),'CANCELLED','Refresh must preserve the pending native edit')
  assert.equal(await button().getAttribute('aria-pressed'),'true')
  assert.equal(await topbar().locator('.sync-activity-icon.spinning').count(),1,'Native write keeps the small activity icon spinning')
  await page.evaluate(()=>window.__background.holdNative=false);await release('Native');await sourceSaved('CANCELLED')
  await syncNow();await closeDetails()
  checks.push('Native refresh stays interactive and preserves pending task edits, while one compact icon indicates refresh and write activity')

  await page.evaluate(()=>window.__background.staleNextSave=true)
  await showDone(false)
  assert.equal((await snapshot()).state.workspace.properties['Remote save-race change'].value,'retained remote data')
  assert.equal((await snapshot()).saves.at(-1).workspace.spaces.find(space=>space.id==='space-work').name,'Remote save-race change')
  assert.equal(await page.getByRole('button',{name:'Retry save',exact:true}).count(),0,'A safe revision rebase should finish automatically')
  await page.locator('.space-nav').filter({hasText:'Remote save-race change'}).waitFor({state:'attached'})
  await syncNow()
  checks.push('A background revision change rebases and saves the local preference without overwriting independent remote properties or forcing a manual retry')

  const settings=await settingsDialog()
  assert.equal((await snapshot()).state.workspace.appearance.mode,'dark')
  await page.evaluate(()=>window.__background.failSave=true)
  await click(settings.getByRole('button',{name:'Light',exact:true}))
  await page.getByRole('button',{name:'Retry save',exact:true}).waitFor({state:'attached'})
  assert.equal((await snapshot()).state.workspace.appearance.mode,'dark','The failed appearance edit is not acknowledged')
  assert.equal(await settings.getByRole('button',{name:'Light',exact:true}).getAttribute('class'),'active','Failed appearance draft remains visible')
  await click(settings.getByRole('button',{name:'Close dialog',exact:true}))
  await click(page.getByRole('button',{name:'Retry save',exact:true}))
  await until(value=>value.state.workspace.appearance.mode==='light','Retry must save the retained shared appearance edit rather than reverting to the old baseline')
  assert.equal(await page.getByRole('button',{name:'Retry save',exact:true}).count(),0)

  const queuedSettings=await settingsDialog()
  await page.evaluate(()=>{window.__background.holdSave=true;window.__background.failSave=true})
  await click(queuedSettings.getByRole('button',{name:'Dark',exact:true}))
  await until(value=>value.heldSave,'The first shared edit is held before its failed acknowledgment')
  await click(queuedSettings.getByRole('button',{name:'Close dialog',exact:true}))
  const queuedVisibility=await button().getAttribute('aria-pressed')!=='true'
  await click(button())
  await page.evaluate(()=>window.__background.holdSave=false);await release('Save')
  await until(value=>value.state.workspace.appearance.mode==='dark'&&value.state.workspace.planner.showCompletedByView.list===queuedVisibility,'A later queued save must retain the first failed shared edit as well as the later visibility change')
  assert.equal(await page.getByRole('button',{name:'Retry save',exact:true}).count(),0)
  await syncNow()
  checks.push('Failed metadata saves retain their shared-field intent on Retry and through a later queued save; an unsaved draft never becomes its own merge baseline')

  await page.evaluate(()=>window.__background.failSync=true);await click(cloud());await cloudState('error')
  assert.equal(await cloud().locator('.cloud-check').count(),0,'Failed metadata sync cannot claim everything is current')
  await syncNow()
  await page.evaluate(()=>window.__background.failRefresh=true);await click(refresh());await cloudState('stale')
  assert.equal(await cloud().locator('.cloud-check').count(),0,'A failed calendar refresh cannot claim everything is current')
  await click(refresh());await cloudState('synced')
  await showDone(true);await openTask()
  await page.evaluate(()=>window.__background.failNative=true);await chooseStatus('IN-PROCESS')
  await page.locator('.source-edit-error').waitFor();await cloudState('error')
  assert.equal(await cloud().locator('.cloud-check').count(),0)
  await click(page.getByRole('button',{name:'Retry edit',exact:true}));await sourceSaved('IN-PROCESS');await syncNow()
  checks.push('Metadata/native-write failures show error and unsuccessful calendar refresh shows stale; none claim a checked cloud until retry succeeds')

  await closeDetails();await view('List');await syncNow()
  await click(page.locator('.list-table-row').filter({hasText:'Edit the opening sequence'}))
  assert.match(await details().locator('.description-section').textContent(),/Initial Deck description/)
  const beforePoll=await snapshot()
  await page.evaluate(()=>window.__background.remoteDeckDescription='Deck description changed on another device.')
  await page.clock.runFor(60000);await settle()
  await until(value=>value.refreshCalls>beforePoll.refreshCalls&&value.syncCalls>beforePoll.syncCalls,'The minute poll must check both native sources and custom metadata')
  await until(value=>value.state.records.find(record=>record.id==='card-mine').body==='Deck description changed on another device.','Periodic native refresh must fetch the changed Deck card')
  assert.match(await details().locator('.description-section').textContent(),/Deck description changed on another device/,'Loaded Deck descriptions update without a manual refresh')
  await cloudState('synced')
  assert.match(await cloud().getAttribute('title'),/last|updated|checked|refresh/i,'Cloud tooltip explains freshness')
  assert.match(await cloud().getAttribute('title'),/\d{1,2}[:.]\d{2}/,'Cloud tooltip includes the last successful refresh time')
  checks.push('Minute polling checks native sources and custom metadata, updates an open Deck description, and exposes the successful refresh time in the cloud tooltip')

  await closeDetails();await page.evaluate(()=>window.__background.setConnected(false));await page.reload();await button().waitFor();await cloudState('offline')
  assert.equal(await cloud().locator('.cloud-check').count(),0)
  assert.equal(await cloud().isDisabled(),true)
  assert.match(await cloud().getAttribute('title'),/offline|not connected/i)
  assert.equal(await page.locator('.list-table-row').filter({hasText:'Edit the opening sequence'}).count(),1,'Cached Deck work remains visible offline')
  await page.evaluate(()=>window.__background.setConnected(true));await page.reload();await button().waitFor();await cloudState('synced')
  checks.push('Offline state is distinct from stale/syncing/current and keeps cached source content available')

  await view('List');await showDone(true);await openTask()
  await chooseStatus('NEEDS-ACTION');await sourceSaved('NEEDS-ACTION');await syncNow()
  await page.evaluate(()=>{window.__background.holdSync=true;window.__background.remapTaskOnSync=true})
  await click(cloud());await until(value=>value.heldSync,'Hold sync before canonical identity adoption')
  await page.evaluate(()=>window.__background.holdNative=true)
  await chooseStatus('IN-PROCESS');await until(value=>value.heldNative,'Hold the native edit under the old UUID')
  await release('Sync')
  await until(value=>value.state.recordIdAliases?.['task-today']==='task-today-cloud','Sync should align the local UUID to the cloud identity')
  await settle()
  assert.equal(await status().getAttribute('data-value'),'IN-PROCESS','The selected inspector and optimistic status survive canonical ID adoption')
  assert.equal(await taskRow().count(),1,'The old and cloud UUID must not produce duplicate task rows')
  await page.evaluate(()=>window.__background.holdNative=false);await release('Native');await sourceSaved('IN-PROCESS')
  assert.equal(await page.locator('.source-edit-error').count(),0,'A native acknowledgment under the canonical ID must resolve the original save queue')
  await chooseStatus('COMPLETED');await sourceSaved('COMPLETED')
  assert.equal((await snapshot()).writes.at(-1).id,'task-today-cloud','The next inspector edit targets the canonical ID')
  assert.equal(await status().getAttribute('data-value'),'COMPLETED');assert.equal(await taskRow().count(),1)
  assert.equal((await snapshot()).state.records.filter(record=>['task-today','task-today-cloud'].includes(record.id)).length,1)
  await syncNow()
  checks.push('Canonical UUID adoption during a held native edit keeps one task, preserves its inspector and optimistic draft, accepts the remapped acknowledgment, and uses the canonical ID for subsequent edits')

  await page.screenshot({path:'artifacts/background-interactions.png'})
  assert.deepEqual(errors,[])
  const report={passed:checks.length,checks,rendererErrors:errors}
  await writeFile('artifacts/background-interactions-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(error){await page.screenshot({path:'artifacts/background-interactions-failure.png',fullPage:true});throw error}finally{await browser.close()}
