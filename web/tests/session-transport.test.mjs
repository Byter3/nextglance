import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionTransport} from '../src/session-transport.mjs'
import {NextcloudClient} from '@nextspace/nextcloud-client'

const origin='https://cloud.example.test', serverUrl=`${origin}/cloud`, sessionUrl=`${serverUrl}/index.php/apps/nextglance/session`
const bootstrap={appId:'nextglance',appVersion:'0.6.12',userId:'fixture-user',displayName:'Example user',serverUrl,basePath:'/cloud',sessionUrl,loginUrl:`${serverUrl}/login`,enabledApps:['deck','notes']}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})
function fixture(handler=()=>json({ok:true})){const calls=[],expired=[];const transport=createSessionTransport({origin,sessionUrl,requestToken:()=> 'fixture-csrf',fetch:async(url,options)=>{calls.push({url,...options});return url===sessionUrl?json(bootstrap):handler(url,options)},onExpired:message=>expired.push(message)});return {transport,calls,expired}}

test('all API calls use the installation path, session cookies and fresh CSRF token',async()=>{
  const {transport,calls}=fixture();await transport.verify()
  await transport.fetch(`${serverUrl}/remote.php/dav/calendars/fixture-user/default/`,{method:'REPORT',headers:{'Content-Type':'application/xml'},body:'<query/>'})
  assert.equal(calls.length,2)
  for(const call of calls){assert.equal(call.credentials,'same-origin');assert.equal(call.redirect,'manual');assert.equal(call.cache,'no-store');assert.equal(call.headers.get('requesttoken'),'fixture-csrf');assert.equal(call.headers.has('Authorization'),false)}
  transport.dispose()
})
test('cross-origin, escaped/base-path, unsupported API and authorization header requests are rejected before fetch',async()=>{
  const {transport,calls}=fixture();await transport.verify()
  for(const url of ['https://elsewhere.example.test/remote.php/dav/','https://cloud.example.test/remote.php/dav/','https://cloud.example.test/cloud/../remote.php/dav/',`${serverUrl}/remote.php/dav/%2e%2e/secret`,`${serverUrl}/remote.php/dav/a%2fb`,`${serverUrl}/index.php/settings/admin`,`${serverUrl}/index.php/apps/mail/api/messages`])await assert.rejects(transport.fetch(url),{code:'SECURITY'})
  await assert.rejects(transport.fetch(`${serverUrl}/remote.php/dav/`,{headers:{Authorization:'Basic ignored'}}),{code:'SECURITY'})
  assert.equal(calls.length,1);transport.dispose()
})
for(const status of [401,302])test(`native HTTP ${status} hides the session and blocks further requests`,async()=>{
  const {transport,expired}=fixture(()=>new Response(null,{status}));await transport.verify()
  await assert.rejects(transport.fetch(`${serverUrl}/remote.php/dav/`),{code:'AUTH'})
  assert.equal(expired.length,1);await assert.rejects(transport.fetch(`${serverUrl}/remote.php/dav/`),{code:'AUTH'});transport.dispose()
})
for(const status of [403,412])test(`session HTTP ${status} requires reauthentication/token recovery`,async()=>{
  let expired=false
  const transport=createSessionTransport({origin,sessionUrl,requestToken:()=> 'fixture-csrf',fetch:async()=>new Response(null,{status}),onExpired:()=>{expired=true}})
  await assert.rejects(transport.verify(),{code:'AUTH'});assert.equal(expired,true);transport.dispose()
})
test('login HTML is never mistaken for a source response',async()=>{
  const {transport,expired}=fixture(()=>new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}}));await transport.verify()
  await assert.rejects(transport.fetch(`${serverUrl}/index.php/apps/notes/api/v1/notes`),{code:'AUTH'});assert.equal(expired.length,1);transport.dispose()
})
test('native 403 and 412 remain permission/concurrency responses, not forced logout',async()=>{
  for(const status of [403,412]){const {transport,expired}=fixture(()=>json({error:'fixture'},status));await transport.verify();assert.equal((await transport.fetch(`${serverUrl}/remote.php/dav/`)).status,status);assert.equal(expired.length,0);transport.dispose()}
})
test('304 validators preserve the authenticated session and empty response body',async()=>{
  const {transport,expired}=fixture(()=>new Response(null,{status:304,headers:{ETag:'"unchanged"'}}));await transport.verify()
  const response=await transport.fetch(`${serverUrl}/remote.php/dav/files/fixture-user/Workspace/Nextspace/manifest.json`,{headers:{'If-None-Match':'"unchanged"'}})
  assert.equal(response.status,304);assert.equal(await response.text(),'');assert.equal(expired.length,0);transport.dispose()
})
test('actual portable task completion preserves unknown calendar fields and uses conditional DAV writes',async()=>{
  const raw=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VTODO','UID:task-example','SUMMARY:Review draft','STATUS:NEEDS-ACTION','X-KEEP:original','END:VTODO','END:VCALENDAR',''].join('\r\n')
  const {transport,calls}=fixture(()=>new Response(null,{status:204,headers:{ETag:'"task-2"'}}));await transport.verify()
  const client=new NextcloudClient({serverUrl,username:bootstrap.userId,accountUser:bootstrap.userId},{authentication:'delegated',fetch:transport.fetch})
  const saved=await client.setTaskCompleted({completed:true},{source:'tasks',etag:'"task-1"',remote:{raw,href:`${serverUrl}/remote.php/dav/calendars/fixture-user/tasks/task.ics`,uid:'task-example'}})
  assert.equal(saved.etag,'"task-2"');assert.equal(calls[1].method,'PUT');assert.equal(calls[1].headers.get('If-Match'),'"task-1"');assert.match(calls[1].body,/STATUS:COMPLETED/);assert.match(calls[1].body,/PERCENT-COMPLETE:100/);assert.match(calls[1].body,/X-KEEP:original/);transport.dispose()
})
test('a different authenticated account fences pending work',async()=>{
  let changed=false,expired=false
  const transport=createSessionTransport({origin,sessionUrl,requestToken:()=> 'token',fetch:async()=>json({...bootstrap,userId:changed?'another-user':bootstrap.userId}),onExpired:()=>{expired=true}})
  await transport.verify();changed=true;await assert.rejects(transport.verify(),{code:'AUTH'});assert.equal(expired,true);transport.dispose()
})
test('offline transport never queues a mutation and transfer budgets are enforced',async()=>{
  let online=true,calls=0
  const transport=createSessionTransport({origin,sessionUrl,requestToken:()=> 'token',online:()=>online,fetch:async(url)=>{calls++;return url===sessionUrl?json(bootstrap):new Response('oversized')}})
  await transport.verify();await assert.rejects(transport.fetch(`${serverUrl}/remote.php/dav/`,{maxResponseBytes:2}),{code:'LIMIT'})
  online=false;await assert.rejects(transport.fetch(`${serverUrl}/remote.php/dav/`,{method:'PUT',body:'data'}),{code:'OFFLINE'});assert.equal(calls,2);transport.dispose()
})
test('actual portable Notes writes retain If-Match and native payload through cookie transport',async()=>{
  const {transport,calls}=fixture((url,options)=>{assert.equal(url,`${serverUrl}/index.php/apps/notes/api/v1/notes/12`);return json({id:12,title:'Review',content:'Updated **notes**',category:'',etag:'revision-2'})})
  await transport.verify()
  const client=new NextcloudClient({serverUrl,username:bootstrap.userId,accountUser:bootstrap.userId},{authentication:'delegated',fetch:transport.fetch})
  const saved=await client.updateNote({title:'Review',content:'Updated **notes**',etag:'revision-1'},{id:'note',source:'notes',title:'Review',body:'Old notes',etag:'revision-1',remote:{nativeId:12,category:''}})
  assert.equal(saved.etag,'revision-2');assert.equal(calls[1].headers.get('If-Match'),'"revision-1"');assert.deepEqual(JSON.parse(calls[1].body),{title:'Review',content:'Updated **notes**'});transport.dispose()
})
