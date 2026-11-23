import test from 'node:test'
import assert from 'node:assert/strict'
import {createWebController,WEB_NATIVE_OPERATIONS} from '../src/session-controller.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'

const serverUrl='https://cloud.example.test/cloud',sessionUrl=`${serverUrl}/apps/nextglance/session`
const uid='11111111-1111-4111-8111-111111111111'
const bootstrap={appId:'nextglance',appVersion:'0.6.12',userId:'example-user',displayName:'Example',serverUrl,basePath:'/cloud',sessionUrl,loginUrl:`${serverUrl}/login`,enabledApps:['tasks','calendar','deck','notes','collectives']}
const record={id:uid,source:'tasks',kind:'task',title:'Review draft',collectionId:'tasks-main',body:'Private description',readonly:false,completed:false,identity:{source:'tasks',key:'fixture-key'},remote:{raw:'private native data'}}
const collection={id:'tasks-main',source:'tasks',title:'Example tasks',readonly:false,remote:{href:`${serverUrl}/remote.php/dav/calendars/example-user/tasks/`}}
const statuses=['tasks','calendar','deck','notes','collectives'].map(source=>({source,state:'connected',count:source==='tasks'?1:0}))
const historyWindow={from:Date.parse('2001-01-01T00:00:00Z'),to:Date.parse('2001-02-01T00:00:00Z')}
const otherWindow={from:Date.parse('2002-01-01T00:00:00Z'),to:Date.parse('2002-02-01T00:00:00Z')}
const historyCalendar={id:'calendar-main',source:'calendar',title:'Studio bookings',readonly:false,remote:{href:`${serverUrl}/remote.php/dav/calendars/example-user/studio/`}}
const historyEvent=(title,date)=>({id:title,source:'calendar',kind:'event',title,collectionId:historyCalendar.id,readonly:false,etag:'one',start:date,end:date,identity:{source:'calendar',key:title},eventAccess:{editDetails:true,editReminders:true,editAttendees:false,respond:false,delete:true},remote:{href:historyCalendar.remote.href+title+'.ics',uid:title}})
const historyResult=(records,state='connected',extra={})=>({records,collections:[historyCalendar],statuses:[{source:'calendar',state,count:records.length,...extra}]})
const primaryHistoryResult=()=>({records:[record,historyEvent('Recent','2026-11-23T10:00:00Z')],collections:[collection,historyCalendar],statuses})
const historyNow=()=>new Date('2026-11-23T12:00:00Z')
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture({readError,writeError,beforeWrite,clientOverrides={},initialIdentities=[],bootstrapFor=()=>bootstrap,now}={}){
  let workspace=createPlannerWorkspace(),version=1,writeCalls=0
  workspace.identities=[{id:uid,source:'tasks',key:'fixture-key',aliases:[]},...initialIdentities]
  const native={readAll:async()=>({records:[record],collections:[collection],statuses}),savedRecord:async(previous,col,saved)=>({...previous,...saved}),setTaskCompleted:async input=>({completed:input.completed}),...clientOverrides}
  const options={now,origin:'https://cloud.example.test',sessionUrl,requestToken:()=> 'fixture-token',fetch:async()=>new Response(JSON.stringify(bootstrapFor()),{headers:{'Content-Type':'application/json'}}),createClient:()=>native,createFolder:()=>({readWorkspace:async()=>{if(readError)throw readError;return {workspace:structuredClone(workspace),etag:String(version)}},writeWorkspace:async(next,etag)=>{writeCalls++;await beforeWrite?.(next,writeCalls);if(writeError)throw writeError;if(etag!==String(version))throw Object.assign(new Error('changed'),{code:'CONFLICT'});workspace=structuredClone(next);return {workspace,etag:String(++version)}}})}
  const api=createWebController(options)
  return {api,native,options,get writes(){return writeCalls},get cloud(){return workspace},changeCloud(fn){workspace=fn(structuredClone(workspace));version++}}
}

test('ordinary source reads leave planner metadata alone and explicit references retain their projected IDs',async()=>{
  const event={...historyEvent('Studio planning','2026-11-23T10:00:00Z'),identity:{source:'calendar',key:'0123456789abcdef:calendar:studio-event',locator:'https://cloud.example.test/private.ics'}}
  const task={...record,id:'native-task-row',identity:{source:'tasks',key:'0123456789abcdef:tasks:studio-task',locator:'https://cloud.example.test/private-task.ics',aliases:['old-task']}}
  const f=fixture({clientOverrides:{readAll:async()=>{const value=historyResult([event]);return {records:[...value.records,task],collections:[...value.collections,collection],statuses:[...value.statuses,...statuses.filter(item=>item.source==='tasks')]}}}})
  await f.api.getState();const current=await f.api.refresh()
  const projected=current.records.find(item=>item.source==='calendar'), projectedTask=current.records.find(item=>item.source==='tasks')
  assert.match(projected.id,/^native-[a-f0-9]{64}$/);assert.equal(projected.identity,undefined)
  assert.deepEqual(projectedTask.identity,{source:'tasks',key:task.identity.key});assert.equal(f.writes,0)
  const workspace=structuredClone(current.workspace)
  workspace.relations.push({id:'studio-work-session',type:'scheduled_during',fromId:projectedTask.id,toId:projected.id})
  const saved=await f.api.saveWorkspace(workspace,current.revision)
  assert.equal(f.writes,1);assert.deepEqual(saved.workspace.relations,workspace.relations)
  assert.ok(saved.workspace.identities.some(entry=>entry.id===projected.id&&entry.key===event.identity.key))
  assert.ok(saved.workspace.identities.some(entry=>entry.id===projectedTask.id&&entry.key===task.identity.key));f.api.dispose()
})

test('Web historical navigation reads only Calendar, coalesces coverage and bounds retained ranges',async()=>{
  const requests=[];const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>{requests.push(input);return input.sources?historyResult([historyEvent(input.calendarWindow.from===historyWindow.from?'Older':'Other','2001-01-12T10:00:00Z')]):primaryHistoryResult()}}})
  await f.api.getState();await f.api.refresh();const baseReads=requests.length
  await f.api.readCalendarWindow({from:Date.parse('2026-11-20T00:00:00Z'),to:Date.parse('2026-11-28T00:00:00Z')});assert.equal(requests.length,baseReads)
  let state=await f.api.readCalendarWindow(historyWindow)
  assert.deepEqual(requests.at(-1).sources,['calendar']);assert.deepEqual(requests.at(-1).calendarWindow,historyWindow)
  assert.deepEqual(state.records.map(row=>row.title).sort(),['Older','Recent','Review draft']);const id=state.records.find(row=>row.title==='Recent').id
  await f.api.readCalendarWindow({from:historyWindow.from+86400000,to:historyWindow.to-86400000});assert.equal(requests.length,baseReads+1)
  state=await f.api.readCalendarWindow(otherWindow);assert.deepEqual(state.records.map(row=>row.title).sort(),['Other','Recent','Review draft'])
  state=await f.api.readCalendarWindow({from:Date.parse('2026-11-20T00:00:00Z'),to:Date.parse('2026-11-28T00:00:00Z')})
  assert.deepEqual(state.records.map(row=>row.title).sort(),['Recent','Review draft']);assert.equal(state.records.find(row=>row.title==='Recent').id,id)
  assert.equal(state.records.find(row=>row.title==='Review draft').id,uid);f.api.dispose()
})

test('Web rejects oversized or invalid historical requests before reading sources',async()=>{
  let reads=0;const f=fixture({clientOverrides:{readAll:async()=>{reads++;return primaryHistoryResult()}}})
  for(const input of [{from:0,to:121*86400000},{from:4,to:3},{from:'0',to:4}])await assert.rejects(f.api.readCalendarWindow(input),{code:'VALIDATION'})
  assert.equal(reads,0);f.api.dispose()
})

test('an unrelated native denial cannot retain an obsolete historical Calendar range',async()=>{
  const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>!input.sources?primaryHistoryResult():historyResult([historyEvent('Older','2001-01-12T10:00:00Z')]),setTaskCompleted:async()=>{throw Object.assign(new Error('Destination read only'),{code:'PERMISSION',nativePermissionDenied:{source:'tasks',collectionId:collection.id}})}}})
  await f.api.getState();await f.api.refresh();await f.api.readCalendarWindow(historyWindow)
  await assert.rejects(f.api.setTaskCompleted({id:uid,completed:true}),{code:'PERMISSION'})
  const state=await f.api.readCalendarWindow({from:Date.parse('2026-11-20T00:00:00Z'),to:Date.parse('2026-11-28T00:00:00Z')})
  assert.ok(state.records.some(row=>row.title==='Recent'));assert.ok(!state.records.some(row=>row.title==='Older'));assert.equal(state.nativeWriteSources.includes('calendar'),true);f.api.dispose()
})

test('rapid historical navigation abandons the obsolete result and keeps only the latest range',async()=>{
  let finish,rangeReads=0;const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>{if(!input.sources)return primaryHistoryResult();if(++rangeReads===1)return new Promise(resolve=>{finish=resolve});return historyResult([historyEvent('Latest','2002-01-12T10:00:00Z')])}}})
  await f.api.getState();await f.api.refresh();const first=f.api.readCalendarWindow(historyWindow);while(!finish)await tick()
  const latest=f.api.readCalendarWindow(otherWindow);finish(historyResult([historyEvent('Obsolete','2001-01-12T10:00:00Z')]))
  await first;const state=await latest;assert.equal(rangeReads,2);assert.ok(state.records.some(row=>row.title==='Latest'));assert.ok(!state.records.some(row=>row.title==='Obsolete'));f.api.dispose()
})

test('partial history stays retryable and does not replace unrelated source status',async()=>{
  let rangeReads=0;const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>!input.sources?primaryHistoryResult():historyResult([historyEvent('Older','2001-01-12T10:00:00Z')],++rangeReads===1?'error':'connected')}})
  await f.api.getState();await f.api.refresh();let state=await f.api.readCalendarWindow(historyWindow)
  assert.equal(state.statuses.find(value=>value.source==='calendar').state,'error');assert.equal(state.statuses.find(value=>value.source==='tasks').state,'connected')
  state=await f.api.readCalendarWindow(historyWindow);assert.equal(rangeReads,2);assert.equal(state.statuses.find(value=>value.source==='calendar').state,'connected');f.api.dispose()
})

test('a thrown history timeout leaves recent data usable and retries without another full sync',async()=>{
  let rangeReads=0,allReads=0;const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>{if(!input.sources){allReads++;return primaryHistoryResult()}if(++rangeReads===1)throw Object.assign(new Error('History timed out'),{code:'TIMEOUT'});return historyResult([historyEvent('Recovered','2001-01-12T10:00:00Z')])}}})
  await f.api.getState();await f.api.refresh();const before=allReads;let state=await f.api.readCalendarWindow(historyWindow)
  assert.equal(f.api.getHostState().phase,'ready');assert.equal(state.statuses.find(value=>value.source==='calendar').errorCode,'TIMEOUT');assert.ok(state.records.some(row=>row.title==='Recent'))
  state=await f.api.readCalendarWindow(historyWindow);assert.equal(rangeReads,2);assert.equal(allReads,before);assert.ok(state.records.some(row=>row.title==='Recovered'));f.api.dispose()
})

test('a full refresh serializes against history and reloads the currently requested additional range',async()=>{
  let finish,rangeReads=0,activeReads=0,maximumReads=0
  const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>{activeReads++;maximumReads=Math.max(maximumReads,activeReads);try{if(!input.sources)return primaryHistoryResult();if(++rangeReads===1)return await new Promise(resolve=>{finish=resolve});return historyResult([historyEvent('After refresh','2001-01-12T10:00:00Z')])}finally{activeReads--}}}})
  await f.api.getState();await f.api.refresh();const range=f.api.readCalendarWindow(historyWindow);while(!finish)await tick()
  const refresh=f.api.refresh();await tick();assert.equal(maximumReads,1);finish(historyResult([historyEvent('Obsolete range','2001-01-12T10:00:00Z')]))
  await refresh;await range;const state=await f.api.readCalendarWindow(historyWindow)
  assert.equal(maximumReads,1);assert.equal(rangeReads,2);assert.ok(state.records.some(row=>row.title==='After refresh'));assert.ok(!state.records.some(row=>row.title==='Obsolete range'));f.api.dispose()
})

test('a changed recent event during history projection keeps its acknowledged edit and stable identity',async()=>{
  let finish;const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>!input.sources?primaryHistoryResult():new Promise(resolve=>{finish=resolve}),updateEvent:async input=>({title:input.title,etag:'two'})}})
  await f.api.getState();let state=await f.api.refresh();const id=state.records.find(row=>row.title==='Recent').id
  const range=f.api.readCalendarWindow(historyWindow);while(!finish)await tick();await f.api.updateEvent({id,title:'Edited recent',etag:'one'})
  finish(historyResult([historyEvent('Older','2001-01-12T10:00:00Z')]))
  state=await range;assert.equal(state.records.find(row=>row.id===id).title,'Edited recent');assert.equal(state.records.find(row=>row.id===id).etag,'two')
  state=await f.api.readCalendarWindow({from:Date.parse('2026-11-20T00:00:00Z'),to:Date.parse('2026-11-28T00:00:00Z')});assert.equal(state.records.find(row=>row.id===id).title,'Edited recent');f.api.dispose()
})

test('a stale range resource cannot remove a newer edit from the retained recent snapshot',async()=>{
  let finish;const older=historyEvent('Older','2001-01-12T10:00:00Z')
  const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>!input.sources?{...primaryHistoryResult(),records:[record,older]}:new Promise(resolve=>{finish=resolve}),updateEvent:async input=>({title:input.title,start:input.start,end:input.end,etag:'new'})}})
  await f.api.getState();let state=await f.api.refresh();const id=state.records.find(row=>row.title==='Older').id
  const range=f.api.readCalendarWindow(historyWindow);while(!finish)await tick()
  await f.api.updateEvent({id,title:'Moved booking',start:'2026-11-23T09:00:00Z',end:'2026-11-23T10:00:00Z',etag:'one'})
  finish(historyResult([older]));state=await range;assert.equal(state.records.find(row=>row.id===id).title,'Moved booking')
  // Changing range drops only range-owned rows, even before its replacement request returns.
  finish=undefined;const back=f.api.readCalendarWindow({from:Date.parse('2026-11-20T00:00:00Z'),to:Date.parse('2026-11-28T00:00:00Z')});while(!finish)await tick()
  state=await f.api.getState();assert.equal(state.records.find(row=>row.id===id)?.title,'Moved booking')
  finish(historyResult([{...older,title:'Moved booking',start:'2026-11-23T09:00:00Z',end:'2026-11-23T10:00:00Z',etag:'new'}]));await back
  f.api.dispose()
})

test('historical completion cannot resurrect deletion or undo a concurrent task edit',async()=>{
  let finish,rangeReads=0,deleted=false;const older=historyEvent('Older','2001-01-12T10:00:00Z')
  const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>!input.sources?primaryHistoryResult():++rangeReads===1?historyResult([older],'error'):rangeReads===2?new Promise(resolve=>{finish=resolve}):historyResult(deleted?[]:[older]),deleteEvent:async()=>{deleted=true;return {deleted:true}}}})
  await f.api.getState();await f.api.refresh();let state=await f.api.readCalendarWindow(historyWindow);const id=state.records.find(value=>value.title==='Older').id
  const retry=f.api.readCalendarWindow(historyWindow);while(!finish)await tick()
  await f.api.deleteEvent({id});await f.api.setTaskCompleted({id:uid,completed:true});finish(historyResult([older]))
  state=await retry;assert.ok(!state.records.some(value=>value.title==='Older'));assert.equal(state.records.filter(value=>value.id===uid).length,1);assert.equal(state.records.find(value=>value.id===uid).completed,true)
  await f.api.refresh();state=await f.api.readCalendarWindow(historyWindow);assert.ok(!state.records.some(value=>value.title==='Older'));f.api.dispose()
})

test('historical source denial clears Calendar ranges without hiding tasks',async()=>{
  const f=fixture({now:historyNow,clientOverrides:{readAll:async input=>!input.sources?primaryHistoryResult():{records:[],collections:[],statuses:[{source:'calendar',state:'error',permissionDenied:true}]}}})
  await f.api.getState();await f.api.refresh();const state=await f.api.readCalendarWindow(historyWindow)
  assert.deepEqual(state.records.map(row=>row.title),['Review draft']);assert.ok(!state.nativeWriteSources.includes('calendar'));assert.ok(state.nativeWriteSources.includes('tasks'));f.api.dispose()
})

test('session expiry fences a delayed historical result and removes all private ranges',async()=>{
  let finish,switched=false,last;const f=fixture({now:historyNow,bootstrapFor:()=>({...bootstrap,userId:switched?'other-user':'example-user'}),clientOverrides:{readAll:async input=>!input.sources?primaryHistoryResult():new Promise(resolve=>{finish=resolve})}})
  f.api.subscribe(state=>last=state);await f.api.getState();await f.api.refresh();const pending=f.api.readCalendarWindow(historyWindow);while(!finish)await tick()
  switched=true;await assert.rejects(f.api.setTaskCompleted({id:uid,completed:true}),{code:'AUTH'});finish(historyResult([historyEvent('Old session','2001-01-12T10:00:00Z')]))
  await assert.rejects(pending,{code:'CANCELLED'});assert.equal(last.records.length,0);assert.equal(f.api.getHostState().phase,'expired');f.api.dispose()
})
test('authenticated initialization reads remote organization and refreshes actual source records',async()=>{
  const f=fixture();await f.api.getState();const state=await f.api.refresh()
  assert.equal(f.api.getHostState().phase,'ready');assert.equal(state.connection.username,'example-user');assert.equal(state.records[0].title,'Review draft');assert.equal(state.records[0].remote,undefined);assert.equal(state.collections[0].remote,undefined)
  assert.ok(state.nativeWriteSources.includes('tasks'));assert.ok(state.nativeOperations.includes('setTaskCompleted'));assert.equal(state.nativeOperations.includes('createLinkedEvent'),false);assert.equal(state.nativeOperations.includes('uploadDeckAttachment'),false);f.api.dispose()
})
test('an unreadable planner never initializes an empty replacement or loads private sources',async()=>{
  let reads=0;const f=fixture({readError:Object.assign(new Error('Unreadable remote metadata'),{code:'FORMAT'}),clientOverrides:{readAll:async()=>{reads++;throw new Error('must not read')}}})
  await assert.rejects(f.api.getState(),{code:'FORMAT'});assert.equal(f.writes,0);assert.equal(reads,0);assert.equal(f.api.getHostState().phase,'error');f.api.dispose()
})
test('organization changes are acknowledged only after cloud write and revisions reject stale editors',async()=>{
  const f=fixture();await f.api.getState();let state=await f.api.refresh();const next=structuredClone(state.workspace);next.name='Shared plan'
  const saved=await f.api.saveWorkspace(next,state.revision);assert.equal(f.cloud.name,'Shared plan');assert.equal(saved.storage.syncStatus,'synced')
  await assert.rejects(f.api.saveWorkspace(next,state.revision),{code:'CONFLICT'});f.api.dispose()
})
test('independent concurrent metadata changes merge through the real shared three-way rule',async()=>{
  const f=fixture();await f.api.getState();const state=await f.api.refresh();const next=structuredClone(state.workspace);next.name='Changed name'
  f.changeCloud(workspace=>({...workspace,appearance:{...workspace.appearance,mode:'dark'}}))
  const saved=await f.api.saveWorkspace(next,state.revision);assert.equal(saved.workspace.name,'Changed name');assert.equal(saved.workspace.appearance.mode,'dark');assert.equal(f.writes,2);f.api.dispose()
})
test('conflicting remote changes remain untouched and are not silently retried as overwrites',async()=>{
  const f=fixture();await f.api.getState();const state=await f.api.refresh();const next=structuredClone(state.workspace);next.name='Local choice';f.changeCloud(workspace=>({...workspace,name:'Remote choice'}))
  await assert.rejects(f.api.saveWorkspace(next,state.revision),{code:'CONFLICT'});assert.equal(f.cloud.name,'Remote choice');assert.equal(f.writes,1);f.api.dispose()
})
test('native completion is immediate after acknowledgement and does not perform a whole-source refresh',async()=>{
  let reads=0,writes=0;const f=fixture({clientOverrides:{readAll:async()=>{reads++;return {records:[record],collections:[collection],statuses}},setTaskCompleted:async input=>{writes++;return {completed:input.completed}}}})
  await f.api.getState();await f.api.refresh();const before=reads;const state=await f.api.setTaskCompleted({id:uid,completed:true});assert.equal(state.records[0].completed,true);assert.equal(reads,before);assert.equal(writes,1);f.api.dispose()
})
test('offline retains visible records but forbids writes and creates no queued cloud change',async()=>{
  let writes=0;const f=fixture({clientOverrides:{setTaskCompleted:async()=>{writes++;return {completed:true}}}});await f.api.getState();await f.api.refresh();await f.api.setOnline(false)
  const state=await f.api.getState();assert.equal(state.records.length,1);assert.equal(state.records[0].readonly,true);assert.deepEqual(state.nativeOperations,[])
  await assert.rejects(f.api.setTaskCompleted({id:uid,completed:true}),{code:'OFFLINE'});assert.equal(writes,0);f.api.dispose()
})
test('account switch clears private data and prevents the original-account mutation',async()=>{
  let switched=false,writes=0;const f=fixture({bootstrapFor:()=>({...bootstrap,userId:switched?'other-user':'example-user'}),clientOverrides:{setTaskCompleted:async()=>{writes++;return {completed:true}}}})
  let last;f.api.subscribe(state=>last=state);await f.api.getState();await f.api.refresh();switched=true
  await assert.rejects(f.api.setTaskCompleted({id:uid,completed:true}),{code:'AUTH'});assert.equal(f.api.getHostState().phase,'expired');assert.equal(last.records.length,0);assert.equal(last.workspace.spaces.length,0);assert.equal(writes,0);f.api.dispose()
})
test('partial refresh retains earlier visible records; an explicit revocation removes them',async()=>{
  const f=fixture();await f.api.getState();await f.api.refresh();f.native.readAll=async()=>({records:[],collections:[],statuses:[{source:'tasks',state:'error',message:'Network interrupted'}]})
  assert.equal((await f.api.refresh()).records.length,1)
  f.native.readAll=async()=>({records:[],collections:[],statuses:[{source:'tasks',state:'error',permissionDenied:true}]})
  const denied=await f.api.refresh();assert.equal(denied.records.length,0);assert.equal(denied.nativeWriteSources.includes('tasks'),false);f.api.dispose()
})
test('a slow source scan cannot undo an acknowledged native edit',async()=>{
  const f=fixture();await f.api.getState();await f.api.refresh();let finish
  f.native.readAll=()=>new Promise(resolve=>{finish=resolve});const refreshing=f.api.refresh();while(!finish)await new Promise(resolve=>setImmediate(resolve))
  await f.api.setTaskCompleted({id:uid,completed:true});finish({records:[record],collections:[collection],statuses});assert.equal((await refreshing).records[0].completed,true);f.api.dispose()
})
test('planner refresh uses the same server folder and completes without recursive queue deadlock',async()=>{
  const f=fixture();await f.api.getState();await f.api.refresh();f.changeCloud(workspace=>({...workspace,name:'Other device name'}));assert.equal((await f.api.syncWorkspace()).workspace.name,'Other device name');f.api.dispose()
})
test('all advertised write operations exist and scheduling without durable journal stays withheld',()=>{
  const f=fixture();for(const operation of WEB_NATIVE_OPERATIONS)assert.equal(typeof f.api[operation],'function',operation);assert.equal(f.api.createLinkedEvent,undefined);f.api.dispose()
})
test('production factory constructs the actual delegated portable client with its complete runtime',async()=>{
  const f=fixture(),api=createWebController({...f.options,createClient:undefined})
  const state=await api.getState();assert.equal(state.connection.connected,true);api.dispose();f.api.dispose()
})
test('Notes can create their first native note and adopt its category for later edits',async()=>{
  let creates=0,updates=0
  const note={id:'native-note-12',source:'notes',kind:'note',collectionId:'notes-default',collectionTitle:'Uncategorized (default)',title:'New note',body:'Initial',readonly:false,etag:'v1',identity:{source:'notes',key:'note-12'},remote:{nativeId:12,category:''}}
  const f=fixture({clientOverrides:{readAll:async()=>({records:[],collections:[],statuses}),createNote:async()=>{creates++;return {record:note}},createdRecord:async(source,saved)=>saved.record,updateNote:async input=>{updates++;return {body:input.content,etag:'v2'}}}})
  await f.api.getState();await f.api.refresh();const created=await f.api.createNote({title:'New note',content:'Initial'});assert.ok(created.createdRecordId);assert.ok(created.collections.some(value=>value.id==='notes-default'))
  const updated=await f.api.updateNote({id:created.createdRecordId,title:'New note',content:'Changed'});assert.equal(updated.records[0].body,'Changed');assert.equal(creates,1);assert.equal(updates,1);f.api.dispose()
})
test('invitation-specific edit and delete permissions work even when generic event readonly is true',async()=>{
  const event={...record,source:'calendar',kind:'event',collectionId:'calendar-main',readonly:true,eventAccess:{editDetails:false,editReminders:true,editAttendees:false,respond:true,delete:true},identity:{source:'calendar',key:'event-1'}}
  const calendar={...collection,id:'calendar-main',source:'calendar'};let updates=0,deletes=0,responses=0
  const f=fixture({clientOverrides:{readAll:async()=>({records:[event],collections:[calendar],statuses}),updateEvent:async input=>{updates++;return {reminders:input.reminders}},respondToEvent:async()=>{responses++;return {}},deleteEvent:async()=>{deletes++;return {deleted:true}}}})
  await f.api.getState();const state=await f.api.refresh(),id=state.records[0].id
  await f.api.updateEvent({id,reminders:[15]});await f.api.respondToEvent({id,etag:'version',participation:'ACCEPTED'});assert.equal((await f.api.deleteEvent({id})).records.length,0);assert.deepEqual([updates,responses,deletes],[1,1,1]);f.api.dispose()
})
test('native Deck attachment projection exposes file identities and refreshes the changed card validator',async()=>{
  const card={...record,source:'deck',kind:'card',collectionId:'board',identity:{source:'deck',key:'card-1'},etag:'before'},board={...collection,id:'board',source:'deck'}
  const f=fixture({clientOverrides:{readAll:async()=>({records:[card],collections:[board],statuses}),attachDeckFile:async()=>({attachments:[{id:'attachment',fileId:'18',type:'file'}]}),savedRecord:async before=>({...before,etag:'after'})}})
  await f.api.getState();const state=await f.api.refresh();await f.api.attachDeckFile({id:state.records[0].id,path:'/Notes/Brief.md'});const result=await f.api.getState();assert.deepEqual(result.records[0].attachmentFileIds,['18']);assert.equal(result.records[0].etag,'after');assert.equal('attachments' in result.records[0],false);assert.ok(result.nativeOperations.includes('listFiles'));assert.ok(result.nativeOperations.includes('readDeckAttachments'));f.api.dispose()
})
test('late optional note tags preserve a newer source body and never resurrect a revoked source',async()=>{
  const note={...record,source:'notes',kind:'note',collectionId:'notes',identity:{source:'notes',key:'note-1'}},notes={...collection,id:'notes',source:'notes'}
  let finish
  const f=fixture({clientOverrides:{readAll:async()=>({records:[note],collections:[notes],statuses}),readNoteTags:()=>new Promise(resolve=>{finish=resolve})}})
  await f.api.getState();let state=await f.api.refresh();const id=state.records[0].id,pending=f.api.readNoteTags({id});while(!finish)await new Promise(resolve=>setImmediate(resolve))
  f.native.readAll=async()=>({records:[{...note,body:'New source body',etag:'new'}],collections:[notes],statuses});await f.api.refresh();finish({tags:[{id:'1',title:'Review',assignable:true}],availableTags:[]});await pending
  state=await f.api.getState();assert.equal(state.records[0].body,'New source body');assert.equal(state.records[0].etag,'new')
  finish=undefined;const revoked=f.api.readNoteTags({id});while(!finish)await new Promise(resolve=>setImmediate(resolve));f.native.readAll=async()=>({records:[],collections:[],statuses:[{source:'notes',state:'error',permissionDenied:true}]});await f.api.refresh();finish({tags:[],availableTags:[]});await assert.rejects(revoked,{code:'PERMISSION'});assert.equal((await f.api.getState()).records.length,0);f.api.dispose()
})
test('a native create concurrent with an earlier planner save persists its canonical identity before acknowledging',async()=>{
  let finishWrite,created=false
  const added={...record,id:'created-native',title:'Second task',identity:{source:'tasks',key:'second-task'}}
  const f=fixture({beforeWrite:async(next,count)=>{if(count===1)await new Promise(resolve=>{finishWrite=resolve})},clientOverrides:{createTask:async()=>{created=true;return {record:added}},createdRecord:async(source,saved)=>saved.record}})
  await f.api.getState();const state=await f.api.refresh(),next=structuredClone(state.workspace);next.name='Updated planner'
  const save=f.api.saveWorkspace(next,state.revision);while(!finishWrite)await new Promise(resolve=>setImmediate(resolve))
  const create=f.api.createTask({title:'Second task',collectionId:collection.id});while(!created)await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));finishWrite();await save
  const result=await create;assert.equal(f.cloud.name,'Updated planner');assert.ok(f.cloud.identities.some(identity=>identity.id===result.createdRecordId&&identity.key==='second-task'));assert.equal(result.storage.syncStatus,'synced');f.api.dispose()
})
test('targeted server permission denial fences an older discovery and preserves unrelated writable destinations',async()=>{
  const calendar={...collection,id:'calendar-main',source:'calendar'},deck={id:'board',source:'deck',title:'Other work',readonly:false}
  const sourceRecords=[record,{...record,id:'calendar-native',source:'calendar',kind:'event',collectionId:calendar.id,identity:{source:'calendar',key:'calendar-event'}}]
  const f=fixture({clientOverrides:{readAll:async()=>({records:sourceRecords,collections:[collection,calendar,deck],statuses}),setTaskCompleted:async()=>{throw Object.assign(new Error('Destination read only'),{code:'PERMISSION',nativePermissionDenied:{source:'tasks',collectionId:collection.id}})}}})
  await f.api.getState();await f.api.refresh();let finish,publish
  f.native.readAll=({onCollections})=>new Promise(resolve=>{finish=resolve;publish=onCollections});const refresh=f.api.refresh();while(!finish)await new Promise(resolve=>setImmediate(resolve))
  await assert.rejects(f.api.setTaskCompleted({id:uid,completed:true}),{code:'PERMISSION'});publish({collections:[collection,calendar],sources:['tasks','calendar']});finish({records:sourceRecords,collections:[collection,calendar,deck],statuses});const state=await refresh
  assert.equal(state.collections.find(value=>value.id===collection.id).readonly,true);assert.equal(state.collections.find(value=>value.id===calendar.id).readonly,true);assert.equal(state.nativeWriteSources.includes('tasks'),false);assert.equal(state.nativeWriteSources.includes('calendar'),false);assert.equal(state.nativeWriteSources.includes('deck'),true);assert.equal(state.records.find(value=>value.id===uid).readonly,true);f.api.dispose()
})
test('unreachable session disables capabilities even while the browser still reports online, then safely recovers',async()=>{
  let unreachable=false,writes=0,last
  const f=fixture({clientOverrides:{setTaskCompleted:async input=>{writes++;return {completed:input.completed}}}}),api=createWebController({...f.options,online:()=>true,fetch:async(...args)=>{if(unreachable)throw new TypeError('Failed to fetch');return f.options.fetch(...args)}})
  api.subscribe(state=>{last=state});await api.getState();await api.refresh();unreachable=true
  await assert.rejects(api.setTaskCompleted({id:uid,completed:true}),{code:'NETWORK'});assert.equal(api.getHostState().phase,'offline');assert.deepEqual(last.nativeOperations,[]);assert.deepEqual(last.nativeWriteSources,[]);assert.equal(last.records[0].readonly,true);assert.equal(writes,0)
  unreachable=false;await api.retryConnection();assert.equal(api.getHostState().phase,'ready');await api.setTaskCompleted({id:uid,completed:true});assert.equal(writes,1);api.dispose();f.api.dispose()
})

const taskRequestId='22222222-2222-8222-8222-222222222222'
const parentCardId='44444444-4444-4444-8444-444444444444'
const taskReceipt={version:1,requestId:taskRequestId,collectionId:collection.id,title:'Prepare review',description:'- [ ] Check the brief',completed:true}
function cardTaskFixture(options={}){
  const card={id:parentCardId,source:'deck',kind:'card',title:'Example delivery',collectionId:'deck-main',readonly:false,identity:{source:'deck',key:'board:1/card:2'}}
  return fixture({...options,initialIdentities:[{id:parentCardId,source:'deck',key:card.identity.key}],clientOverrides:{readAll:async()=>({records:[record,card],collections:[collection,{id:'deck-main',source:'deck',title:'Example board',readonly:false}],statuses}),...options.clientOverrides}})
}

test('task creation forwards shared retry/completion options and reuses the existing canonical native identity',async t=>{
  const received=[]
  const reused={...record,title:'Edited in Tasks after creation',completed:false,etag:'fresh-native-version'}
  const f=fixture({clientOverrides:{createTask:async(input,destination)=>{received.push({input,destination});return {record:reused,reused:true}},createdRecord:async(source,saved)=>saved.record}})
  t.after(()=>f.api.dispose())
  await f.api.getState();await f.api.refresh()
  const input={title:taskReceipt.title,collectionId:collection.id,description:taskReceipt.description,requestId:taskRequestId,completed:true}
  const first=await f.api.createTask(input),second=await f.api.createTask(input)
  assert.deepEqual(received.map(value=>value.input),[input,input]);assert.equal(received[0].destination.id,collection.id)
  assert.equal(first.createdRecordId,uid);assert.equal(second.createdRecordId,uid)
  assert.equal(second.records.length,1);assert.equal(second.records[0].title,reused.title)
  assert.equal(second.records[0].completed,false);assert.equal(second.records[0].etag,'fresh-native-version')
  assert.equal(f.cloud.identities.filter(identity=>identity.key===record.identity.key).length,1)
})

test('invalid task retry or completion options never reach the native creation port',async t=>{
  let calls=0
  const f=fixture({clientOverrides:{createTask:async()=>{calls++;throw new Error('must not create')}}})
  t.after(()=>f.api.dispose());await f.api.getState();await f.api.refresh()
  for(const extra of [{requestId:'not-a-uuid'},{completed:'true'},{completed:null}])await assert.rejects(f.api.createTask({title:'Review',collectionId:collection.id,...extra}))
  assert.equal(calls,0)
})

test('server reservation survives native success followed by identity sync failure and later link recovery',async t=>{
  let denyIdentity=false,calls=0
  const created={...record,id:'native-created-task',title:taskReceipt.title,completed:true,identity:{source:'tasks',key:'created-task-key'},etag:'created-v1'}
  const f=cardTaskFixture({beforeWrite:async next=>{if(denyIdentity&&next.identities.some(identity=>identity.key===created.identity.key))throw Object.assign(new Error('Temporary connection failure'),{code:'NETWORK'})},clientOverrides:{createTask:async input=>{calls++;assert.equal(input.requestId,taskRequestId);assert.deepEqual(f.cloud.properties[parentCardId].cardTasks[`manual-${taskRequestId}`],taskReceipt);return {record:created,reused:calls>1}},createdRecord:async(source,saved)=>saved.record}})
  t.after(()=>f.api.dispose());await f.api.getState();const before=await f.api.refresh()
  const reserved=structuredClone(before.workspace);reserved.properties[parentCardId]={cardTasks:{[`manual-${taskRequestId}`]:taskReceipt}}
  const saved=await f.api.saveWorkspace(reserved,before.revision);assert.equal(saved.storage.syncStatus,'synced')
  assert.equal((await f.api.syncWorkspace()).storage.syncStatus,'synced')
  denyIdentity=true
  const nativeResult=await f.api.createTask({...taskReceipt,requestId:taskRequestId})
  assert.equal(calls,1);assert.ok(nativeResult.createdRecordId);assert.equal(nativeResult.storage.syncStatus,'error');assert.match(nativeResult.creationWarning,/Created in Nextcloud/)
  assert.ok(nativeResult.records.some(item=>item.id===nativeResult.createdRecordId));assert.deepEqual(f.cloud.properties[parentCardId],reserved.properties[parentCardId])
  assert.equal(f.cloud.identities.some(identity=>identity.key===created.identity.key),false)
  denyIdentity=false
  const recovered=await f.api.syncWorkspace();assert.equal(recovered.storage.syncStatus,'synced')
  assert.ok(f.cloud.identities.some(identity=>identity.id===nativeResult.createdRecordId&&identity.key===created.identity.key))
  const linked=structuredClone(recovered.workspace)
  linked.properties[parentCardId].cardTasks[`manual-${taskRequestId}`].taskIdentityKey=created.identity.key
  linked.relations.push({id:'33333333-3333-4333-8333-333333333333',type:'depends_on',fromId:parentCardId,toId:nativeResult.createdRecordId})
  const result=await f.api.saveWorkspace(linked,recovered.revision);assert.equal(result.storage.syncStatus,'synced')
  assert.equal(f.cloud.relations.length,1);assert.equal(f.cloud.properties[parentCardId].cardTasks[`manual-${taskRequestId}`].taskIdentityKey,created.identity.key)
  assert.equal(calls,1)
})

test('conflicting server reservations reject the losing metadata save before native creation',async t=>{
  let calls=0
  const f=cardTaskFixture({clientOverrides:{createTask:async()=>{calls++;throw new Error('must not create')}}})
  t.after(()=>f.api.dispose());await f.api.getState();const before=await f.api.refresh()
  const local=structuredClone(before.workspace);local.properties[parentCardId]={cardTasks:{[`manual-${taskRequestId}`]:taskReceipt}}
  f.changeCloud(workspace=>({...workspace,properties:{[parentCardId]:{cardTasks:{[`manual-${taskRequestId}`]:{...taskReceipt,title:'Other immutable reservation'}}}}}))
  await assert.rejects(f.api.saveWorkspace(local,before.revision),{code:'CONFLICT'})
  assert.equal(f.cloud.properties[parentCardId].cardTasks[`manual-${taskRequestId}`].title,'Other immutable reservation');assert.equal(calls,0)
})

test('account change after a reservation prevents the subsequent task creation',async t=>{
  let switched=false,calls=0
  const f=cardTaskFixture({bootstrapFor:()=>({...bootstrap,userId:switched?'second-user':bootstrap.userId}),clientOverrides:{createTask:async()=>{calls++;throw new Error('must not create')}}})
  t.after(()=>f.api.dispose());await f.api.getState();const before=await f.api.refresh()
  const reserved=structuredClone(before.workspace);reserved.properties[parentCardId]={cardTasks:{[`manual-${taskRequestId}`]:taskReceipt}}
  await f.api.saveWorkspace(reserved,before.revision);switched=true
  await assert.rejects(f.api.createTask({...taskReceipt,requestId:taskRequestId}),{code:'AUTH'})
  assert.equal(calls,0);assert.equal(f.api.getHostState().phase,'expired');assert.deepEqual(f.cloud.properties[parentCardId],reserved.properties[parentCardId])
})

test('session expiry fences a late native create acknowledgement without publishing private task data',async t=>{
  let switched=false,finishCreate,last
  const f=fixture({bootstrapFor:()=>({...bootstrap,userId:switched?'second-user':bootstrap.userId}),clientOverrides:{createTask:()=>new Promise(resolve=>{finishCreate=resolve}),createdRecord:async(source,saved)=>saved.record}})
  t.after(()=>f.api.dispose());f.api.subscribe(value=>{last=value});await f.api.getState();await f.api.refresh()
  const pending=f.api.createTask({title:'Review',collectionId:collection.id,requestId:taskRequestId,completed:false})
  while(!finishCreate)await new Promise(resolve=>setImmediate(resolve))
  switched=true;await assert.rejects(f.api.syncWorkspace(),{code:'AUTH'})
  finishCreate({record:{...record,title:'Late private native result'}})
  await assert.rejects(pending,{code:'CANCELLED'});assert.equal(last.records.length,0);assert.equal(last.workspace.identities.length,0)
})
