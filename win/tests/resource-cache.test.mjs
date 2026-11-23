import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {atomicWriteJson} from '@nextspace/nextcloud-node/workspace.mjs'
import {createResourceCache} from '../electron/resource-cache.mjs'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'
const serverUrl='https://cloud.example.test/nextcloud',collection=serverUrl+'/remote.php/dav/calendars/example/work/'
const hash=value=>createHash('sha256').update(value).digest('hex')
const entry=(name='one',extra={})=>{const body=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${name}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;return {version:1,kind:'dav',collection,href:collection+name+'.ics',etag:'"1"',body,bytes:Buffer.byteLength(body),...extra}}
async function fixture(t){const directory=await mkdtemp(path.join(tmpdir(),'nextglance-resources-'));t.after(()=>rm(directory,{recursive:true,force:true}));return {directory,open:(extra={})=>createResourceCache({directory,serverUrl,writeJson:atomicWriteJson,...extra})}}

test('durable source bodies and lightweight inventory reopen without another download',async t=>{
  const {directory,open}=await fixture(t),first=open(),one=entry(),two=entry('two')
  await first.put(one);await first.put(two);await first.flush();first.close()
  const reopened=open();assert.deepEqual(await reopened.list({kind:'dav',collection}),[{href:one.href,etag:one.etag},{href:two.href,etag:two.etag}])
  assert.deepEqual(await reopened.getMany([one,two,entry('missing')]),[one,two,null])
  const files=await readdir(path.join(directory,'dav',hash(collection)));assert.equal(files.length,3);assert.ok(files.every(name=>name==='index.json'||/^[a-f0-9]{64}\.json$/.test(name)))
  const other=createResourceCache({directory:path.join(directory,'other-account'),serverUrl,writeJson:atomicWriteJson});assert.equal(await other.get(one),null)
})
test('partial-pass body writes survive without the optional inventory index',async t=>{
  const {open}=await fixture(t),first=open(),one=entry();await first.put(one);first.close()
  const second=open();assert.deepEqual(await second.get(one),one);await second.flush()
  assert.deepEqual(await open().list({kind:'dav',collection}),[{href:one.href,etag:one.etag}])
})
test('Deck bodies have separate validated collection locators and survive DAV cleanup',async t=>{
  const {open}=await fixture(t),port=open(),collection=serverUrl+'/index.php/apps/deck/api/v1.0/boards/7',body='[{"id":1,"title":"To do","cards":[]}]'
  const card={version:1,kind:'deck',collection,href:collection+'/stacks',etag:'W/"cards"',body,bytes:Buffer.byteLength(body)}
  await port.put(card);await port.flush();await port.retainCollections({kind:'dav',collections:[]})
  assert.deepEqual(await open().get(card),card)
  await assert.rejects(port.put({...card,collection:serverUrl+'/index.php/apps/deck/api/v1.0/boards/../7'}),{code:'VALIDATION'})
})
test('corrupt and mismatched bodies are misses; untrusted locators never escape the account cache',async t=>{
  const {directory,open}=await fixture(t),port=open(),one=entry();await port.put(one);await port.flush()
  await writeFile(path.join(directory,'dav',hash(collection),hash(one.href)+'.json'),'invalid')
  assert.equal(await port.get(one),null)
  await assert.rejects(port.put(entry('weak',{etag:'W/"1"'})),{code:'VALIDATION'})
  await assert.rejects(port.get({...one,href:'https://other.example.test/secret'}),{code:'VALIDATION'})
  await assert.rejects(port.put({...one,bytes:1}),{code:'VALIDATION'})
  await assert.rejects(port.getMany(Array(251).fill(one)),{code:'VALIDATION'})
})
test('confirmed deletion, revoked collections and explicit denial clear only account-private resources',async t=>{
  const {directory,open}=await fixture(t),port=open(),one=entry(),two=entry('two');await port.put(one);await port.put(two)
  const other=entry('other',{collection:collection.replace('/work/','/other/'),href:collection.replace('/work/','/other/')+'other.ics'});await port.put(other)
  await writeFile(path.join(directory,'keep.txt'),'unrelated')
  await port.prune({kind:'dav',collection,hrefs:[two.href]});assert.equal(await port.get(one),null);assert.deepEqual(await port.get(two),two)
  await port.retainCollections({kind:'dav',collections:[collection]});assert.equal(await port.get(other),null)
  await port.remove(two);assert.equal(await port.get(two),null)
  await port.put(one);await port.flush();await port.clear();assert.equal(await port.get(one),null);assert.equal(await readFile(path.join(directory,'keep.txt'),'utf8'),'unrelated')
})
test('failed atomic replacement leaves previously acknowledged body reusable',async t=>{
  const {open}=await fixture(t),one=entry(),port=open();await port.put(one);await port.flush();port.close()
  const failing=open({writeJson:async()=>{throw Object.assign(Error('full'),{code:'ENOSPC'})}})
  await assert.rejects(failing.put({...one,etag:'"2"'}),{code:'ENOSPC'})
  assert.deepEqual(await open().get(one),one)
})
test('junctions cannot redirect private resource reads or writes outside their root',async t=>{
  const {directory,open}=await fixture(t),outside=path.join(directory,'outside'),root=path.join(directory,'cache');await mkdir(outside);await mkdir(root)
  await symlink(outside,path.join(root,'dav'),'junction')
  const port=open({directory:root})
  await assert.rejects(port.get(entry()),{code:'VALIDATION'});await assert.rejects(port.put(entry()),{code:'VALIDATION'})
  assert.deepEqual(await readdir(outside),[])
})

test('real Windows connector reprojects cached history after restart and fetches only changed resources',async t=>{
  const {open}=await fixture(t),account='fixture-account',now=()=>new Date('2026-11-23T12:00:00Z')
  const calendarEvent=(uid,stamp,extra='')=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${uid}\r\nDTSTART:${stamp}T090000Z\r\nDTEND:${stamp}T100000Z\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`
  const world={token:'https://cloud.example.test/token/1',resources:[{name:'old.ics',etag:'"1"',body:calendarEvent('Historical event','20200102')},{name:'current.ics',etag:'"1"',body:calendarEvent('Current event','20261123')},{name:'series.ics',etag:'"1"',body:calendarEvent('Historical series','20200201','RRULE:FREQ=DAILY;COUNT=3\r\n')}]}
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
  const row=(href,props)=>`<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
  const reader=()=>{
    const port=open(),stats={gets:0,inventory:0},client=new NextcloudClient({serverUrl,username:'example',appPassword:'fixture-only'},{resourceCache:port,accountKey:account,now,fetch:async(url,options)=>{
      if(options.method==='REPORT'&&options.body.includes('calendar-multiget')){const requested=world.resources.filter(item=>options.body.includes('/'+item.name+'</'));stats.gets+=requested.length;return new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${requested.map(item=>row(collection+item.name,`<d:getetag>${escape(item.etag)}</d:getetag><c:calendar-data>${escape(item.body)}</c:calendar-data>`)).join('')}</d:multistatus>`,{status:207})}
      if(options.method==='REPORT')return new Response('',{status:501})
      if(options.method==='PROPFIND'){stats.inventory++;return new Response(`<d:multistatus xmlns:d="DAV:">${row(collection,'<d:resourcetype><d:collection/></d:resourcetype>')+world.resources.map(item=>row(collection+item.name,`<d:resourcetype/><d:getetag>${escape(item.etag)}</d:getetag>`)).join('')}</d:multistatus>`,{status:207})}
      stats.gets++;const item=world.resources.find(value=>collection+value.name===url);return new Response(item?.body||'',{status:item?200:404,headers:item?{ETag:item.etag}:{}})
    }})
    client.discovered=true;client.refreshCapabilities=async()=>false;client.discoverCalendars=async()=>[{href:collection,title:'Fixture Calendar',readonly:false,components:['VEVENT'],token:{kind:'sync-token',value:world.token}}]
    return {client,port,stats,read:calendarHistoryDays=>client.readAll({sources:['calendar'],calendarHistoryDays})}
  }
  const first=reader(),recent=await first.read(14);assert.equal(recent.statuses[0].state,'connected',JSON.stringify(recent.statuses));assert.equal(recent.records.length,1);assert.equal(first.stats.gets,3);await first.port.flush();first.port.close()
  const expanded=reader();assert.equal(expanded.client.primeDavState({accountKey:account,records:recent.records,collections:recent.collections,checkpoint:recent.davCheckpoint}),true)
  const all=await expanded.read(null);assert.equal(all.statuses[0].state,'connected');assert.equal(all.records.length,5);assert.equal(expanded.stats.gets,0);assert.equal(expanded.stats.inventory,0);await expanded.port.flush();expanded.port.close()
  const restarted=reader();assert.equal(restarted.client.primeDavState({accountKey:account,records:all.records,collections:all.collections,checkpoint:all.davCheckpoint}),true)
  assert.equal((await restarted.read(null)).records.length,5);assert.deepEqual(restarted.stats,{gets:0,inventory:0})
  world.token='https://cloud.example.test/token/2';world.resources=world.resources.filter(item=>item.name!=='old.ics');world.resources[0]={...world.resources[0],etag:'"2"',body:calendarEvent('Updated event','20261123')}
  const changed=await restarted.read(null);assert.equal(changed.records.length,4);assert.equal(changed.records.some(item=>item.title==='Updated event'),true);assert.deepEqual(restarted.stats,{gets:1,inventory:1})
})
