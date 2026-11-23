import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {prepareHeadlessReadStore} from '../src/headless-read-store.mjs'
import {headlessBundle} from '../scripts/headless-bundle.mjs'
import {cacheKey,launchKey,metadataKey,sourceEditsKey,syncSettingsKey} from '../src/account-cache-keys.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {checkedLaunchCheckpoint} from '../src/launch-cache.mjs'
import {checkedSourceCache} from '../src/foundation.mjs'
import {normalizeWidgetConfig} from '@nextspace/core/widgets.mjs'

const account={name:'fixture',username:'fixture',serverUrl:'https://cloud.example.test'},key=cacheKey(account)
const envelope=value=>JSON.stringify({version:1,generation:1,value})
const slot=value=>`cache/${value}.0.json`
function input(){return {account,kind:'deck',now:Date.parse('2026-11-17T12:00:00Z'),seed:'11111111-1111-4111-8111-111111111111',files:{[slot(key)]:envelope({version:1,accountKey:key,records:[],collections:[],statuses:[],acknowledgedSequence:3})},snapshot:{replies:[{method:'GET',url:account.serverUrl+'/index.php/apps/deck/api/v1.0/boards?details=true',status:200,headers:{},body:JSON.stringify([{id:12,title:'Example board',permissions:{PERMISSION_EDIT:true}}])},{method:'GET',url:account.serverUrl+'/index.php/apps/deck/api/v1.0/boards/12/stacks',status:200,headers:{etag:'"stacks"'},body:JSON.stringify([{id:22,title:'To do',cards:[{id:32,stackId:22,title:'Example assignment',description:'Example description',type:'plain',order:0,done:false,archived:false,labels:[],assignedUsers:[],attachments:[]}]}])}],resources:[]}}}
test('headless actual shared Deck projection creates readable archive and read-only launch without an Activity',async()=>{
  const result=await prepareHeadlessReadStore(input())
  assert.equal(result.complete,true);assert.equal(result.acknowledgedSequence,3)
  const archiveWrite=result.writes.find(write=>write.path===`cache/${key}.1.json`)
  const archive=checkedSourceCache(JSON.parse(archiveWrite.text).value,key,account.serverUrl)
  assert.equal(archive.records[0].title,'Example assignment');assert.equal(archive.records[0].remote.nativeId,32)
  const launchWrite=result.writes.find(write=>write.path===slot(launchKey(account)))
  const launch=checkedLaunchCheckpoint(JSON.parse(launchWrite.text).value,key)
  assert.equal(launch.state.records[0].title,'Example assignment');assert.equal(launch.state.records[0].readonly,true)
  assert.equal(result.writes.some(write=>write.path.includes(sourceEditsKey(account))),false)
})

test('background projection replaces cached provenance only for successfully refreshed source families',async()=>{
  const fixture=input(),archive=JSON.parse(fixture.files[slot(key)]).value,oldStamp='2026-11-17T10:00:00Z'
  archive.statuses=[{source:'deck',state:'connected',count:0,cached:true,lastSyncedAt:oldStamp},{source:'notes',state:'connected',count:0,cached:true,lastSyncedAt:oldStamp}]
  fixture.files[slot(key)]=envelope(archive)
  const result=await prepareHeadlessReadStore(fixture)
  assert.equal(result.complete,true)
  const saved=checkedSourceCache(JSON.parse(result.writes.find(write=>write.path===`cache/${key}.1.json`).text).value,key,account.serverUrl)
  const deck=saved.statuses.find(status=>status.source==='deck'),notes=saved.statuses.find(status=>status.source==='notes')
  assert.equal(deck.cached,undefined);assert.equal(deck.state,'connected');assert.equal(deck.lastSyncedAt,'2026-11-17T12:00:00.000Z')
  assert.equal(notes.cached,true);assert.equal(notes.lastSyncedAt,oldStamp)
  const launch=checkedLaunchCheckpoint(JSON.parse(result.writes.find(write=>write.path===slot(launchKey(account))).text).value,key)
  assert.ok(launch.state.statuses.every(status=>status.cached===true))
  assert.ok(launch.state.records.every(record=>record.readonly))
})
test('missing source replies or damaged acknowledged edits never publish a partial generation',async()=>{
  const missing=input();missing.snapshot.replies.pop()
  assert.deepEqual((await prepareHeadlessReadStore(missing)).writes,[])
  const damaged=input();damaged.files[slot(sourceEditsKey(account))]='broken'
  await assert.rejects(prepareHeadlessReadStore(damaged),{code:'CACHE_UNREADABLE'})
})
test('background denial rotates both read slots and preserves durable edits and organization',async()=>{
  const fixture=input(),first=await prepareHeadlessReadStore(fixture)
  for(const write of first.writes)fixture.files[write.path]=write.text
  fixture.denial={code:'PERMISSION',collection:account.serverUrl+'/index.php/apps/deck/api/v1.0/boards/12'}
  const result=await prepareHeadlessReadStore(fixture)
  assert.equal(result.denied,true);assert.equal(result.writes.length,4)
  for(const write of result.writes.filter(write=>write.path.startsWith(`cache/${key}.`))){const saved=checkedSourceCache(JSON.parse(write.text).value,key,account.serverUrl);assert.equal(saved.records.length,0);assert.equal(saved.collections.length,0);assert.equal(saved.acknowledgedSequence,3);assert.equal(saved.statuses.find(status=>status.source==='deck').errorCode,'PERMISSION')}
  assert.equal(result.writes.some(write=>write.path.includes(sourceEditsKey(account))),false)
})
test('packaged portable runtime executes real projection without browser or Node globals',async()=>{
  const context=vm.createContext({})
  vm.runInContext(await headlessBundle(),context)
  context.fixture=JSON.stringify(input())
  const result=JSON.parse(await vm.runInContext('nextglanceBackground(JSON.parse(fixture)).then(JSON.stringify)',context))
  assert.equal(result.complete,true);assert.ok(result.writes.length>=2)
  assert.equal(typeof context.fetch,'undefined');assert.equal(typeof context.document,'undefined')
})

test('widget-only configuration reads durable native state without network, source projection or cache writes',async()=>{
  const fixture=input(),first=await prepareHeadlessReadStore(fixture)
  for(const write of first.writes)fixture.files[write.path]=write.text
  fixture.kind='widgets';fixture.widgetConfigs=[normalizeWidgetConfig({widgetId:3,accountKey:key,page:'board'})];fixture.configRevision=9;fixture.timeZone='UTC';fixture.locale='en'
  const result=await prepareHeadlessReadStore(fixture,{project:()=>{throw new Error('No source work permitted')}})
  assert.equal(result.complete,true);assert.deepEqual(result.writes,[]);assert.equal(result.configRevision,9)
  assert.equal(result.widgetCatalog.accountKey,key);assert.equal(result.widgetSnapshots[0].rows.find(row=>row.type==='item').title,'Example assignment')
  assert.equal(result.widgetSnapshots[0].acknowledgedEditWatermark,3)
})

test('confirmed background access denial removes widget contents with the native read generation',async()=>{
  const fixture=input(),first=await prepareHeadlessReadStore(fixture)
  for(const write of first.writes)fixture.files[write.path]=write.text
  fixture.widgetConfigs=[normalizeWidgetConfig({widgetId:3,accountKey:key,page:'board'})];fixture.configRevision=9
  fixture.denial={code:'PERMISSION',collection:account.serverUrl+'/index.php/apps/deck/api/v1.0/boards/12'}
  const result=await prepareHeadlessReadStore(fixture)
  assert.equal(result.denied,true);assert.equal(result.widgetSnapshots[0].rows.some(row=>row.type==='item'),false)
  assert.equal(result.widgetCatalog.sources.some(source=>source.source==='deck'),false)
})

for (const denied of [false,true]) test(`widget presentation failure cannot veto ${denied?'denied':'successful'} source publication`,async()=>{
  const fixture=input(),first=await prepareHeadlessReadStore(fixture)
  for(const write of first.writes)fixture.files[write.path]=write.text
  fixture.widgetConfigs=[normalizeWidgetConfig({widgetId:3,accountKey:key,page:'calendar'})];fixture.configRevision=9;fixture.timeZone='Invalid/Fixture'
  if(denied)fixture.denial={code:'PERMISSION',collection:account.serverUrl+'/index.php/apps/deck/api/v1.0/boards/12'}
  const result=await prepareHeadlessReadStore(fixture)
  assert.equal(result.complete,true);assert.equal(result.acknowledgedSequence,3)
  assert.equal(result.widgetCatalog,undefined);assert.equal(result.widgetSnapshots,undefined);assert.equal(result.configRevision,undefined)
  assert.equal(result.writes.length,denied?4:2)
  for(const write of result.writes){
    if(write.path.startsWith(`cache/${key}.`)){
      const saved=checkedSourceCache(JSON.parse(write.text).value,key,account.serverUrl)
      assert.equal(saved.records.length,denied?0:1)
      assert.equal(saved.statuses.find(status=>status.source==='deck').state,denied?'error':'connected')
    } else {
      const launch=checkedLaunchCheckpoint(JSON.parse(write.text).value,key)
      assert.equal(launch.state.records.length,denied?0:1)
      assert.ok(launch.state.records.every(record=>record.readonly))
    }
  }
})

test('a direct widget-only presentation failure remains an explicit failure',async()=>{
  const fixture=input();fixture.kind='widgets';fixture.widgetConfigs=[normalizeWidgetConfig({widgetId:3,accountKey:key,page:'calendar'})];fixture.configRevision=9;fixture.timeZone='Invalid/Fixture'
  await assert.rejects(prepareHeadlessReadStore(fixture),RangeError)
})

function calendarInput(history){
  const fixture=input();fixture.kind='dav'
  const base=account.serverUrl+'/remote.php/dav/',principal=base+'principals/users/fixture/',home=base+'calendars/fixture/',collection=home+'example/'
  const row=(href,body)=>`<d:response><d:href>${href}</d:href><d:propstat><d:prop>${body}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
  const reply=(url,body)=>({method:'PROPFIND',url,status:207,headers:{},body:`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`})
  const properties='<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Example calendar</d:displayname><d:sync-token>token:1</d:sync-token><c:supported-calendar-component-set><c:comp name="VEVENT"/><c:comp name="VTODO"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write-content/></d:privilege></d:current-user-privilege-set>'
  const event='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:historic-review\r\nSUMMARY:Historic review\r\nDTSTART:20200115T100000Z\r\nDTEND:20200115T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
  fixture.snapshot={resources:[{version:1,kind:'dav',collection,href:collection+'old.ics',etag:'"1"',body:event,bytes:Buffer.byteLength(event)}],replies:[reply(base,row(base,`<d:current-user-principal><d:href>${principal}</d:href></d:current-user-principal>`)),reply(principal,row(principal,`<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`)),reply(home,row(collection,properties)),reply(collection,row(collection,'<d:resourcetype><d:collection/></d:resourcetype>')+row(collection+'old.ics','<d:getetag>&quot;1&quot;</d:getetag>'))]}
  if(history!==undefined)fixture.files[slot(syncSettingsKey(account))]=envelope({caldavMinutes:60,deckMinutes:60,wifiOnly:false,calendarHistoryDays:history})
  return fixture
}

for(const history of [undefined,null,0,36500])test(`headless Calendar reads the same saved history ${history} and never writes its preferences`,async()=>{
  const fixture=calendarInput(history),result=await prepareHeadlessReadStore(fixture)
  assert.equal(result.complete,true)
  const saved=checkedSourceCache(JSON.parse(result.writes.find(write=>write.path===`cache/${key}.1.json`).text).value,key,account.serverUrl)
  assert.equal(saved.records.filter(row=>row.source==='calendar').length,history===0?0:1)
  assert.equal(saved.calendarHistoryDays,history??null)
  assert.equal(result.writes.some(write=>write.path.includes(syncSettingsKey(account))),false)
})

test('widening headless history reuses the same raw calendar body and expands prior empty projections',async()=>{
  const fixture=calendarInput(14),first=await prepareHeadlessReadStore(fixture)
  assert.equal(first.complete,true)
  for(const write of first.writes)fixture.files[write.path]=write.text
  fixture.files[slot(syncSettingsKey(account))]=envelope({caldavMinutes:60,deckMinutes:60,wifiOnly:false,calendarHistoryDays:null})
  fixture.snapshot.replies.pop() // The unchanged collection token avoids a new resource inventory.
  const expanded=await prepareHeadlessReadStore(fixture);assert.equal(expanded.complete,true)
  const saved=expanded.writes.map(write=>JSON.parse(write.text).value).find(value=>value.records)
  assert.equal(saved.calendarHistoryDays,null);assert.equal(saved.records.length,1);assert.equal(saved.records[0].title,'Historic review')
})

test('background rejects a corrupt history preference slot instead of certifying the wrong policy',async()=>{
  const fixture=calendarInput(30);fixture.files[slot(syncSettingsKey(account))]='broken'
  await assert.rejects(prepareHeadlessReadStore(fixture),{code:'CACHE_UNREADABLE'})
})

for (const portable of [true,false]) test(`headless large history preserves complete source publication with ${portable?'portable':'oversized legacy'} metadata identities`,async()=>{
  const fixture=input(), workspace=createPlannerWorkspace(), plannerKey=metadataKey(account)
  fixture.files[slot(plannerKey)]=envelope({version:1,accountKey:plannerKey,ready:true,revision:0,workspace,baseline:workspace,remoteExists:true,checkpoint:null,etag:null,deviceState:{},status:'synced',message:'Fixture'})
  const records=Array.from({length:2_800},(_,index)=>({id:`fixture-${index}`,source:'calendar',kind:'event',title:`Historic fixture ${index}`,identity:{source:'calendar',key:`${portable?'0123456789abcdef:calendar:':'legacy:'}${index}`,locator:`https://cloud.example.test/${'x'.repeat(3_000)}/${index}`}}))
  records.push({id:'new-task',source:'tasks',kind:'task',title:'New fictional task',identity:{source:'tasks',key:'0123456789abcdef:tasks:new'}})
  fixture.kind='dav'
  const result=await prepareHeadlessReadStore(fixture,{project:async()=>({complete:true,records,collections:[],statuses:[{source:'tasks',state:'connected',count:1},{source:'calendar',state:'connected',count:2_800}]})})
  assert.equal(result.complete,true)
  const archive=checkedSourceCache(JSON.parse(result.writes.find(write=>write.path===`cache/${key}.1.json`).text).value,key,account.serverUrl)
  assert.equal(archive.records.length,2_801)
  assert.equal(archive.records.at(-1).title,'New fictional task')
  assert.equal(archive.calendarHistoryDays,null)
  assert.equal(archive.statuses.find(row=>row.source==='tasks').state,'connected')
  const metadataWrite=result.writes.find(write=>write.path.includes(plannerKey))
  if (portable) assert.equal(metadataWrite,undefined,'Uncustomized history makes no planner write')
  else {
    const planner=JSON.parse(metadataWrite.text).value
    assert.deepEqual(planner.workspace,workspace)
    assert.equal(planner.status,'error')
    assert.equal(planner.errorStage,'local-cache')
  }
})
