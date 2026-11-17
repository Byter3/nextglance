import test from 'node:test'
import assert from 'node:assert/strict'
import {projectHeadlessSources} from '../packages/nextcloud/src/headless-projection.mjs'
import {createPlannerWorkspace} from '../packages/core/src/planner.mjs'
import {validateWorkspace} from '../packages/core/src/planner-schema.mjs'

const SERVER='https://fixture.invalid/nextcloud',DAV=SERVER+'/remote.php/dav/',PRINCIPAL=DAV+'principals/users/tester/',HOME=DAV+'calendars/tester/',ROOT=HOME+'work/'
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const row=(href,props)=>`<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const wrap=body=>`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`
const reply=(url,body)=>({method:'PROPFIND',url,status:207,headers:{},body:wrap(body)})
const ics=(id,component='VTODO')=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:${component}\r\nUID:${id}\r\nSUMMARY:${id}\r\n${component==='VEVENT'?'DTSTART:20261117T100000Z\r\nDTEND:20261117T110000Z\r\nLOCATION:Example room\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\n':''}END:${component}\r\nEND:VCALENDAR\r\n`
function input(){
  const resources=['task','event'].map((name,index)=>{const body=ics(name,index?'VEVENT':'VTODO');return {version:1,kind:'dav',collection:ROOT,href:ROOT+name+'.ics',etag:'"1"',body,bytes:Buffer.byteLength(body)}})
  return {account:{serverUrl:SERVER,username:'tester',accountKey:'fixture'},previous:{records:[],collections:[],statuses:[]},workspace:createPlannerWorkspace(),sources:['tasks','calendar'],now:Date.parse('2026-11-17T12:00:00Z'),snapshot:{resources,replies:[
    reply(DAV,row(DAV,`<d:current-user-principal><d:href>${PRINCIPAL}</d:href></d:current-user-principal>`)),
    reply(PRINCIPAL,row(PRINCIPAL,`<c:calendar-home-set><d:href>${HOME}</d:href></c:calendar-home-set>`)),
    reply(HOME,row(ROOT,'<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Example calendar</d:displayname><d:sync-token>token:1</d:sync-token><c:supported-calendar-component-set><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write-content/></d:privilege></d:current-user-privilege-set>')),
    reply(ROOT,row(ROOT,'<d:resourcetype><d:collection/></d:resourcetype>')+resources.map(resource=>row(resource.href,`<d:getetag>${escape(resource.etag)}</d:getetag>`)).join('')),
  ]}}
}

test('background projection uses real DAV discovery, Tasks/Calendar parsers and identities without network',async()=>{
  const value=input();let ids=0
  const first=await projectHeadlessSources({...value,makeId:()=>`00000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`})
  assert.equal(first.complete,true);assert.equal(first.records.length,2);assert.equal(first.collections.length,2);assert.ok(first.statuses.every(status=>status.state==='connected'))
  const event=first.records.find(item=>item.source==='calendar');assert.equal(event.location,'Example room');assert.deepEqual(event.reminders,[15]);assert.equal(event.remote.raw,value.snapshot.resources[1].body)
  assert.equal(first.workspace.identities.length,2);validateWorkspace(first.workspace)
  assert.equal(first.davCheckpoint.collections.length,1)
  const warm=await projectHeadlessSources({...value,previous:first,workspace:first.workspace,snapshot:{replies:value.snapshot.replies.slice(0,3),resources:[]},makeId:()=>{throw new Error('Warm identities must be reused')}})
  assert.equal(warm.complete,true);assert.deepEqual(warm.records.map(item=>item.id),first.records.map(item=>item.id));assert.equal(warm.records.length,2)
})

test('host-owned reconciliation returns actual normalized records without allocating identities twice',async()=>{
  const value=input(),result=await projectHeadlessSources({...value,reconcile:false,makeId:()=>{throw new Error('Host owns IDs')}})
  assert.equal(result.complete,true);assert.equal(result.records.length,2);assert.deepEqual(result.workspace,value.workspace);assert.deepEqual(result.recordIdAliases,{})
})

test('missing inventory/body or failed source keeps previous complete generation and exposes failed attempt',async()=>{
  const value=input(),first=await projectHeadlessSources({...value,reconcile:false})
  for(const snapshot of [{...value.snapshot,replies:value.snapshot.replies.slice(0,3)}, {...value.snapshot,resources:value.snapshot.resources.slice(0,1)}]){
    const result=await projectHeadlessSources({...value,previous:{...first,davCheckpoint:undefined},snapshot,reconcile:false})
    assert.equal(result.complete,false);assert.deepEqual(result.records,first.records);assert.deepEqual(result.statuses,first.statuses);assert.ok(result.attemptStatuses.some(status=>status.state==='error'))
  }
})

test('background projection is account confined, bounded, read-only and cancellation fenced',async()=>{
  for(const mutation of [value=>value.snapshot.replies[0].url='https://other.invalid/remote.php/dav/',value=>value.snapshot.replies[0].method='PUT',value=>value.snapshot.resources[0].bytes++,value=>value.previous.accountKey='other']){
    const value=input();mutation(value);await assert.rejects(projectHeadlessSources(value))
  }
  await assert.rejects(projectHeadlessSources({...input(),isActive:()=>false}),{code:'CANCELLED'})
})
