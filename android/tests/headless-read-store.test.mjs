import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {prepareHeadlessReadStore} from '../src/headless-read-store.mjs'
import {headlessBundle} from '../scripts/headless-bundle.mjs'
import {cacheKey,launchKey,sourceEditsKey} from '../src/account-cache-keys.mjs'
import {checkedLaunchCheckpoint} from '../src/launch-cache.mjs'
import {checkedSourceCache} from '../src/foundation.mjs'

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
