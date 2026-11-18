import test from 'node:test'
import assert from 'node:assert/strict'
import {NextcloudClient} from '../packages/nextcloud/src/nextcloud.mjs'
import {mergeDavDelta,davSyncCollectionBody,davMultigetBody} from '../packages/nextcloud/src/dav-delta-policy.mjs'
import {checkCalendarQuery} from '../packages/nextcloud/src/dav-query-policy.mjs'

const SERVER='https://fixture.invalid/nextcloud',ROOT=SERVER+'/remote.php/dav/calendars/tester/work/'
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const row=(href,props)=>`<d:response><d:href>${escape(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const wrap=(rows,token='')=>`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}${token?`<d:sync-token>${escape(token)}</d:sync-token>`:''}</d:multistatus>`
const ics=uid=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:${uid}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`
function world(){
  const state={items:new Map([['one.ics',{body:ics('one'),etag:'"1"'}],['gone.ics',{body:ics('gone'),etag:'"1"'}]]),token:'token:1',delta:null,deltaStatus:207,multigetStatus:207,calls:[],malformed:false}
  // REPORT delta/multiget scanning is an explicit cache-backed opt-in.
  const entries=new Map(),resourceCache={
    get:async({href})=>structuredClone(entries.get(href)||null),
    put:async entry=>entries.set(entry.href,structuredClone(entry)),
    remove:async({href})=>entries.delete(href),
    prune:async({collection,hrefs})=>{for(const [href,entry] of entries)if(entry.collection===collection&&!hrefs.includes(href))entries.delete(href)},
    retainCollections:async({collections})=>{for(const [href,entry] of entries)if(!collections.includes(entry.collection))entries.delete(href)},
    clear:async()=>entries.clear(),
  }
  const client=new NextcloudClient({serverUrl:SERVER,username:'tester'},{authentication:'delegated',accountKey:'fixture',resourceCache,now:()=>new Date('2026-11-17T12:00:00Z'),fetch:async(url,input)=>{
    state.calls.push({url,...input})
    if(input.method==='PROPFIND')return new Response(wrap(row(ROOT,'<d:resourcetype><d:collection/></d:resourcetype>')+[...state.items].map(([name,value])=>row(ROOT+name,`<d:getetag>${escape(value.etag)}</d:getetag>`)).join('')),{status:207})
    if(input.method==='REPORT'&&input.body.includes('sync-collection'))return new Response(state.delta??wrap('',state.token),{status:state.deltaStatus})
    if(input.method==='REPORT'&&input.body.includes('calendar-multiget')){
      const names=[...state.items.keys()].filter(name=>input.body.includes(new URL(ROOT+name).pathname))
      const rows=names.map(name=>{const value=state.items.get(name);return row(ROOT+name,`<d:getetag>${escape(value.etag)}</d:getetag><c:calendar-data>${escape(value.body)}</c:calendar-data>`)}).join('')
      return new Response(wrap(state.malformed?'':rows),{status:state.multigetStatus})
    }
    const value=state.items.get(url.slice(ROOT.length));return new Response(value?.body||'',{status:value?200:404,headers:{ETag:value?.etag||'"missing"'}})
  }})
  const read=()=>client.readDav('tasks',[{href:ROOT,title:'Work',components:['VTODO'],readonly:false,token:{kind:'sync-token',value:state.token}}])
  return {state,client,read}
}

test('delta membership is atomic, bounded, validator checked and collection confined',()=>{
  const input={serverUrl:SERVER,collection:ROOT,baseline:[{href:ROOT+'a.ics',etag:'"1"'},{href:ROOT+'b.ics',etag:'"1"'}],rows:[{href:ROOT+'a.ics',etag:'"2"',status:200},{href:ROOT+'b.ics',status:404},{href:ROOT+'c.ics',etag:'"1"',status:200}],token:'token:2'}
  assert.deepEqual(mergeDavDelta(input),{resources:[{href:ROOT+'a.ics',etag:'"2"'},{href:ROOT+'c.ics',etag:'"1"'}],changed:[ROOT+'a.ics',ROOT+'c.ics'],deleted:[ROOT+'b.ics'],token:{kind:'sync-token',value:'token:2'}})
  for(const rows of [[{href:ROOT+'a.ics',status:500}], [{href:ROOT+'a.ics',status:200,etag:'W/"1"'}], [input.rows[0],input.rows[0]], [{href:ROOT+'../other/item.ics',status:404}], [{href:'https://other.invalid/a.ics',status:404}]])assert.throws(()=>mergeDavDelta({...input,rows}))
  assert.equal(input.baseline.length,2)
})

test('REPORT capability admits only valid bounded delta and multiget roots',()=>{
  const headers={'content-type':'application/xml'}
  checkCalendarQuery(headers,davSyncCollectionBody('token:a&b'))
  checkCalendarQuery(headers,davMultigetBody(SERVER,ROOT,[ROOT+'a.ics',ROOT+'b.ics']))
  for(const body of [davSyncCollectionBody('a').replace('>1<','>infinite<'),davMultigetBody(SERVER,ROOT,[ROOT+'a.ics']).replace('</c:calendar-multiget>','<d:href>/extra</d:href><d:href>/extra</d:href></c:calendar-multiget>')])assert.throws(()=>checkCalendarQuery(headers,body),{code:'VALIDATION'})
})

test('REPORT reader batches bodies, skips unchanged collections, and applies changed/deleted delta without full inventory',async()=>{
  const {state,client,read}=world(),first=await read()
  assert.equal(first.records.length,2);assert.equal(first.warning,undefined)
  assert.equal(state.calls.filter(call=>call.body?.includes('calendar-multiget')).length,1)
  assert.equal(state.calls.filter(call=>!call.method).length,0)
  assert.equal(client.davCheckpoint().collections.length,1)
  state.calls.length=0;assert.equal((await read()).records.length,2);assert.equal(state.calls.length,0)
  state.items.set('one.ics',{body:ics('edited'),etag:'"2"'});state.items.delete('gone.ics');state.token='token:2'
  state.delta=wrap(row(ROOT+'one.ics','<d:getetag>&quot;2&quot;</d:getetag>')+`<d:response><d:href>${ROOT}gone.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`,state.token)
  const changed=await read();assert.equal(changed.warning,undefined);assert.deepEqual(changed.records.map(item=>item.title),['edited'])
  assert.deepEqual(state.calls.map(call=>call.method),['REPORT','REPORT']);assert.ok(state.calls.every(call=>call.priority==='low'))
  assert.equal(client.davCheckpoint().collections[0].token.value,'token:2')
  await client.request(ROOT+'one.ics');assert.equal(state.calls.at(-1).priority,'high')
})

test('expired tokens and unsupported REPORT safely fall back; permission denial never does',async()=>{
  for(const status of [403,405]){
    const {state,read}=world();await read();state.calls.length=0;state.token='token:2';state.deltaStatus=status
    state.delta='<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>'
    assert.equal((await read()).warning,undefined);assert.ok(state.calls.some(call=>call.method==='PROPFIND'))
  }
  const {state,read,client}=world();await read();state.calls.length=0;state.token='token:2';state.deltaStatus=403;state.delta='<d:error xmlns:d="DAV:"><d:need-privileges/></d:error>'
  const denied=await read();assert.ok(denied.warning);assert.equal(denied.records.length,0);assert.equal(state.calls.length,1);assert.equal(client.davCheckpoint().collections.length,0)
})

test('incomplete deltas and multiget replies cannot advance a checkpoint',async()=>{
  const {state,read,client}=world();await read();state.token='token:2';state.delta=wrap(row(ROOT+'one.ics','<d:getetag>&quot;2&quot;</d:getetag>'))
  await assert.rejects(read(),{code:'FORMAT'});assert.equal(client.davCheckpoint().collections.length,0)
  const broken=world();broken.state.malformed=true;assert.ok((await broken.read()).warning);assert.equal(broken.client.davCheckpoint().collections.length,0)
})

test('unsupported multiget retries bounded individual reads and retains complete result',async()=>{
  const {state,read}=world();state.multigetStatus=405
  const result=await read();assert.equal(result.warning,undefined);assert.equal(result.records.length,2);assert.equal(state.calls.filter(call=>!call.method).length,2)
})
