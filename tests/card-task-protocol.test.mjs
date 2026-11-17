import test from 'node:test'
import assert from 'node:assert/strict'
import ICAL from 'ical.js'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'
import {nativePermissionResponse} from './native-permission-fixtures.mjs'
const serverUrl='https://cloud.example.test',requestId='12345678-abcd-8123-8123-123456789abc'
const collection={id:'task-list',source:'tasks',remote:{href:`${serverUrl}/remote.php/dav/calendars/demo/tasks/`}}
function fixture(){let body='',writes=0,gets=0;const client=new NextcloudClient({serverUrl,username:'demo',appPassword:'fixture-password'},{fetch:async(url,options)=>{
  const permission=nativePermissionResponse(url,options);if(permission)return permission
  if(options.method==='PUT'){writes++;assert.equal(options.headers['If-None-Match'],'*');assert.ok(url.endsWith(`${requestId}.ics`));if(body)return new Response('',{status:412});body=options.body;return new Response('',{status:201,headers:{ETag:'"one"'}})}
  gets++;return new Response(body,{headers:{ETag:'"two"'}})
}});return {client,get body(){return body},set body(value){body=value},get writes(){return writes},get gets(){return gets}}}
test('conditional native task retry preserves edited content and completion with same UID',async()=>{
  const f=fixture(),input={title:'Prepare cut',completed:true,requestId}
  const created=await f.client.createTask(input,collection);assert.equal(created.uid,requestId)
  const calendar=new ICAL.Component(ICAL.parse(f.body)),task=calendar.getFirstSubcomponent('vtodo');assert.equal(task.getFirstPropertyValue('status'),'COMPLETED');assert.equal(task.getFirstPropertyValue('percent-complete'),100);assert.ok(task.getFirstPropertyValue('completed'))
  task.updatePropertyWithValue('summary','Changed in Tasks');task.updatePropertyWithValue('status','IN-PROCESS');task.updatePropertyWithValue('percent-complete',30);task.removeAllProperties('completed');f.body=calendar.toString()
  const retried=await f.client.createTask(input,collection);assert.equal(retried.reused,true);assert.equal(retried.record.title,'Changed in Tasks');assert.equal(retried.record.completed,false);assert.equal(f.writes,2);assert.equal(f.gets,1)
})
test('same resource with wrong marker or mixed native contents is never reused or overwritten',async()=>{
  const f=fixture();await f.client.createTask({title:'Review',requestId},collection)
  const calendar=new ICAL.Component(ICAL.parse(f.body));calendar.getFirstSubcomponent('vtodo').removeAllProperties('x-nextspace-request');f.body=calendar.toString();const before=f.body
  await assert.rejects(f.client.createTask({title:'Review',requestId},collection),{code:'CONFLICT'});assert.equal(f.body,before)
})
test('bad task options/title/date fail before network writes',async()=>{
  const f=fixture()
  for(const input of [{requestId:'wrong'},{completed:1},{title:'x'.repeat(501)},{due:'2026-02-30'}])await assert.rejects(f.client.createTask({title:'Review',...input},collection),{code:'VALIDATION'})
  assert.equal(f.writes,0);assert.equal(f.gets,0)
})
