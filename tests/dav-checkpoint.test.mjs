import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import {nativePermissionResponse} from './native-permission-fixtures.mjs';
import {NextcloudClient} from '../packages/nextcloud/src/nextcloud.mjs';
import {checkedDavCheckpoint, davProjectionWindow} from '../packages/nextcloud/src/dav-checkpoint-policy.mjs';

const SERVER='https://fixture.invalid/nextcloud', ROOT=SERVER+'/remote.php/dav/calendars/tester/work/', ACCOUNT='fixture-account';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const row=(href,props)=>`<d:response><d:href>${escape(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const xml=rows=>`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}</d:multistatus>`;
const response=(body,status=200,headers={})=>new Response(status===204?null:body,{status,headers});
const ics=(uid,component='VTODO',extra='')=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:${component}\r\nUID:${uid}\r\nSUMMARY:${uid}\r\n${component==='VEVENT'?'DTSTART:20261113T090000Z\r\nDTEND:20261113T100000Z\r\n':''}${extra}END:${component}\r\nEND:VCALENDAR\r\n`;
function makeWorld() {
  const world={resources:[{name:'task.ics',body:ics('task'),etag:'"1"'},{name:'event.ics',body:ics('event','VEVENT'),etag:'"1"'}],token:{kind:'sync-token',value:'https://fixture.invalid/token/1'},readonly:false,title:'Work',now:new Date('2026-11-13T12:00:00Z'),entries:new Map(),inventoryStatus:207,available:true};
  const key=entry=>entry.href;
  world.reader=()=>{
    const stats={discovery:0,inventory:0,gets:[],bodies:0,lists:0,projections:[],puts:0};
    const port={get:async locator=>{stats.bodies++;return world.entries.get(key(locator))||null},getMany:async locators=>{stats.bodies+=locators.length;return locators.map(locator=>world.entries.get(key(locator))||null)},list:async()=>{stats.lists++;return [...world.entries.values()].map(({href,etag})=>({href,etag}))},put:async entry=>{stats.puts++;world.entries.set(key(entry),entry)},remove:async locator=>world.entries.delete(key(locator)),prune:async value=>{for(const href of world.entries.keys())if(!value.hrefs.includes(href))world.entries.delete(href)},retainCollections:async value=>{if(!value.collections.includes(ROOT))world.entries.clear()},clear:async()=>world.entries.clear()};
    const client=new NextcloudClient({serverUrl:SERVER,username:'tester'},{authentication:'delegated',accountKey:ACCOUNT,davReadMode:'propfind-get',resourceCache:port,now:()=>world.now,fetch:async(url,options)=>{
      if(options.method==='PROPFIND'&&options.headers.Depth==='0')return nativePermissionResponse(url,options);
      if(options.method==='PROPFIND'){stats.inventory++;return response(xml(row(ROOT,'<d:resourcetype><d:collection/></d:resourcetype>')+world.resources.map(resource=>row(ROOT+resource.name,`<d:resourcetype/><d:getetag>${escape(resource.etag)}</d:getetag>`)).join('')),world.inventoryStatus)}
      if(options.method==='PUT')return response('',204);
      if(options.method==='DELETE'){world.resources=world.resources.filter(resource=>ROOT+resource.name!==url);return response('',204)}
      stats.gets.push(url);const resource=world.resources.find(resource=>ROOT+resource.name===url);
      return resource?response(resource.body,200,{ETag:resource.etag}):response('',404);
    }});
    client.discovered=true;client.refreshCapabilities=async()=>false;
    client.discoverCalendars=async()=>{stats.discovery++;return world.available?[{href:ROOT,title:world.title,components:['VTODO','VEVENT'],readonly:world.readonly,...(world.token?{token:world.token}:{})}]:[]};
    const project=client.calendarRecordsCooperative.bind(client);
    client.calendarRecordsCooperative=async(...args)=>{stats.projections.push({href:args[1],source:args[3].source});return project(...args)};
    return {client,stats,read:options=>client.readAll({sources:['tasks','calendar'],...options}),prime:saved=>client.primeDavState({accountKey:ACCOUNT,records:saved.records,collections:saved.collections,checkpoint:saved.davCheckpoint})};
  };
  return world;
}

test('acknowledged event deletion invalidates a warm checkpoint and disposable body cache before the next read',async()=>{
  const world=makeWorld(),reader=world.reader(),before=await reader.read();
  const event=before.records.find(record=>record.source==='calendar'),collection=before.collections.find(item=>item.id===event.collectionId);
  assert.equal(reader.client.davCheckpoint().collections.length,1);assert.ok(world.entries.has(event.remote.href));
  assert.deepEqual(await reader.client.deleteEvent({id:event.id},event,collection),{deleted:true});
  assert.equal(reader.client.davCheckpoint().collections.length,0);assert.equal(world.entries.has(event.remote.href),false);
  const after=await reader.read();assert.equal(after.records.some(record=>record.source==='calendar'),false);assert.equal(reader.stats.inventory,2);
});

test('complete same-day warm and restarted readers check discovery but skip inventory, bodies and projection',async()=>{
  const parse=ICAL.parse;let parseCount=0;ICAL.parse=(...args)=>{parseCount++;return parse(...args)};
  try {
  const world=makeWorld(), first=world.reader(), cold=await first.read();
  assert.ok(cold.statuses.every(status=>status.state==='connected'));assert.equal(cold.davCheckpoint.collections.length,1);
  assert.equal(first.stats.inventory,1);assert.equal(first.stats.gets.length,2);assert.equal(first.stats.projections.length,4);
  assert.equal(parseCount,2,'each raw file is parsed once across the two source projections');
  const same=await first.read();assert.deepEqual(same.records,cold.records);assert.equal(first.stats.discovery,2);assert.equal(first.stats.inventory,1);assert.equal(first.stats.projections.length,4);
  const restarted=world.reader();assert.equal(restarted.prime({...cold,records:cold.records.map(record=>({...record,id:'canonical:'+record.id}))}),true);
  world.now=new Date('2026-11-13T23:59:59Z');world.title='Renamed collection';
  const warm=await restarted.read();assert.equal(warm.records.length,2);assert.ok(warm.records.every(record=>record.collectionTitle===world.title));
  assert.deepEqual(restarted.stats,{discovery:1,inventory:0,gets:[],bodies:0,lists:0,projections:[],puts:0});
  assert.equal(parseCount,2,'neither same-client nor restarted warm reads parse a calendar document');
  } finally {ICAL.parse=parse}
});

test('legacy projection hints reproject cached raw events into current details without losing records or redownloading',async()=>{
  const world=makeWorld();
  world.resources[1].body=ics('event','VEVENT','LOCATION:Studio\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\n');
  const first=await world.reader().read();assert.equal(first.davCheckpoint.projectionVersion,3);
  const legacy={...first,davCheckpoint:{...first.davCheckpoint,projectionVersion:1},records:first.records.map(record=>{const copy={...record};delete copy.location;delete copy.reminders;delete copy.unsupportedReminderCount;return copy})};
  const restarted=world.reader();assert.equal(restarted.prime(legacy),false);
  assert.equal(legacy.records.length,2);
  const fresh=await restarted.read(),event=fresh.records.find(record=>record.source==='calendar');
  assert.equal(event.location,'Studio');assert.deepEqual(event.reminders,[15]);assert.equal(event.unsupportedReminderCount,0);
  assert.equal(restarted.stats.gets.length,0);assert.equal(restarted.stats.inventory,1);assert.ok(restarted.stats.projections.length>0);
  assert.equal(fresh.davCheckpoint.projectionVersion,3);
});

test('changed token inventories once and only new/changed resources are downloaded and projected',async()=>{
  const world=makeWorld(), old=await world.reader().read();world.token.value+='changed';
  world.resources[0]={name:'task.ics',body:ics('edited'),etag:'"2"'};
  world.resources.push({name:'new.ics',body:ics('new'),etag:'"1"'});
  const fresh=world.reader();assert.equal(fresh.prime(old),true);const result=await fresh.read();
  assert.equal(fresh.stats.inventory,1);assert.deepEqual(fresh.stats.gets.sort(),[ROOT+'new.ics',ROOT+'task.ics']);assert.equal(fresh.stats.bodies,2);assert.equal(fresh.stats.projections.length,4);assert.ok(result.records.some(record=>record.title==='event'));
  world.resources=world.resources.filter(resource=>resource.name!=='event.ics');world.token.value+='deleted';
  const next=await fresh.read();assert.equal(next.records.length,2);assert.equal(world.entries.has(ROOT+'event.ics'),false);assert.equal(fresh.stats.projections.length,4);
});

test('missing token requires fresh inventory but exact resource baselines can be reused',async()=>{
  const world=makeWorld(), old=await world.reader().read();world.token=null;
  const next=world.reader();assert.equal(next.prime(old),true);const result=await next.read();
  assert.equal(next.stats.inventory,1);assert.equal(next.stats.bodies,0);assert.equal(next.stats.projections.length,0);assert.equal(result.davCheckpoint.collections.length,0);
});

test('day rollover reprojects events without downloading unchanged bodies, while task baselines are reused',async()=>{
  const world=makeWorld(), old=await world.reader().read();world.now=new Date('2026-11-14T00:00:00Z');
  const next=world.reader();next.prime(old);const result=await next.read();
  assert.equal(next.stats.inventory,0);assert.equal(next.stats.gets.length,0);assert.equal(next.stats.projections.length,2);assert.ok(next.stats.projections.every(row=>row.source==='calendar'));
  assert.deepEqual({from:result.davCheckpoint.collections[0].from,to:result.davCheckpoint.collections[0].to},davProjectionWindow(world.now.getTime()));
});

test('fresh readonly changes reproject without broadening intrinsic complex-item restrictions',async()=>{
  const world=makeWorld();world.resources[1].body=ics('series','VEVENT','RRULE:FREQ=DAILY;COUNT=2\r\n');
  const old=await world.reader().read();world.readonly=true;
  const next=world.reader();next.prime(old);const readOnly=await next.read();assert.ok(readOnly.records.every(record=>record.readonly));assert.equal(next.stats.projections.length,4);
  world.readonly=false;const writable=await next.read();assert.equal(writable.records.find(record=>record.source==='tasks').readonly,false);assert.ok(writable.records.filter(record=>record.source==='calendar').every(record=>record.readonly));
});

test('removed and denied collections erase checkpoint and resource baselines',async()=>{
  for(const removed of [true,false]){const world=makeWorld(),reader=world.reader();await reader.read();if(removed)world.available=false;else{world.token.value+='changed';world.inventoryStatus=403}const result=await reader.read();assert.equal(result.davCheckpoint.collections.length,0);assert.equal(world.entries.size,0);assert.equal(result.records.length,0)}
});

test('an interrupted changed collection cannot export its old complete checkpoint',async()=>{
  const world=makeWorld(),reader=world.reader();await reader.read();world.token.value+='changed';world.resources[0].etag='"2"';
  reader.client.calendarRecordsCooperative=async()=>{throw Object.assign(new Error('cancel fixture'),{code:'CANCELLED'})};
  await assert.rejects(reader.read(),{code:'CANCELLED'});assert.equal(reader.client.davCheckpoint().collections.length,0);
});

test('missing/changed durable validators are visited before a cached prefix after a fresh process',async()=>{
  const world=makeWorld();world.resources=Array.from({length:20},(_,i)=>({name:String(i).padStart(2,'0')+'.ics',body:ics(String(i)),etag:'"1"'}));
  await world.reader().read();for(const href of [...world.entries.keys()].slice(-3))world.entries.delete(href);
  const next=world.reader();let count=0;const project=next.client.calendarRecordsCooperative.bind(next.client);
  next.client.calendarRecordsCooperative=async(...args)=>{if(++count>8)throw Object.assign(new Error('stop'),{code:'CANCELLED'});return project(...args)};
  await assert.rejects(next.read(),{code:'CANCELLED'});assert.equal(next.stats.gets.length,3);assert.ok(next.stats.gets.every(href=>/1[789]\.ics$/.test(href)));
});

test('native calendar writes invalidate the complete checkpoint before acknowledgement returns',async()=>{
  const world=makeWorld(),reader=world.reader();await reader.read();assert.equal(reader.client.davCheckpoint().collections.length,1);
  await reader.client.request(ROOT+'task.ics',{method:'PUT',body:ics('edited')});assert.equal(reader.client.davCheckpoint().collections.length,0);
});

test('checkpoint validation rejects incompatible account, incomplete row references and unsafe empty collections independently of records',async()=>{
  const world=makeWorld(),saved=await world.reader().read();
  const check=(value,records=saved.records)=>checkedDavCheckpoint(value,{accountKey:ACCOUNT,serverUrl:SERVER,records,collections:saved.collections});
  assert.ok(check(saved.davCheckpoint));
  for(const mutate of [value=>value.accountKey='other',value=>value.collections[0].resources[0].etag='W/"1"',value=>value.collections[0].resources[0].taskKeys.push('missing'),value=>value.collections[0].resources.find(row=>row.taskKeys.length).taskKeys=[],value=>{value.collections[0].href='https://other.invalid/remote.php/dav/calendars/tester/work/';value.collections[0].resources=[]}]){const value=structuredClone(saved.davCheckpoint);mutate(value);assert.equal(check(value),null)}
  assert.equal(check(saved.davCheckpoint,saved.records.slice(1)),null);
  const invalid=world.reader();assert.equal(invalid.prime({...saved,records:[]}),false);await invalid.read();assert.equal(invalid.stats.inventory,1);assert.equal(invalid.stats.projections.length,4);
});

test('parse failures and incomplete inventories cannot create complete checkpoints',async()=>{
  const world=makeWorld();world.resources.push({name:'broken.ics',body:'broken native calendar',etag:'"1"'});
  const reader=world.reader(),partial=await reader.read();assert.ok(partial.statuses.every(status=>status.state==='error'));assert.equal(partial.davCheckpoint.collections.length,0);assert.equal(partial.records.length,2);
  world.resources.pop();const full=await reader.read();assert.equal(full.davCheckpoint.collections.length,1);
  world.token.value+='changed';world.inventoryStatus=503;const failed=await reader.read();assert.equal(failed.davCheckpoint.collections.length,0);assert.ok(failed.statuses.every(status=>status.state==='error'));
});

test('a tasks-only checkpoint cannot certify event projections it did not read',async()=>{
  const world=makeWorld(),first=world.reader(),tasks=await first.read({sources:['tasks']});assert.deepEqual(tasks.davCheckpoint.collections[0].components,['VTODO']);
  const next=world.reader();assert.equal(next.prime(tasks),true);const full=await next.read();assert.equal(next.stats.inventory,1);assert.equal(next.stats.gets.length,0);assert.ok(next.stats.projections.every(row=>row.source==='calendar'));assert.deepEqual(full.statuses.map(status=>status.count),[1,1]);
});

test('a successful native write during projection prevents a stale checkpoint from being committed',async()=>{
  const world=makeWorld(),reader=world.reader();let mutated=false;const original=reader.client.calendarRecordsCooperative.bind(reader.client);
  reader.client.calendarRecordsCooperative=async(...args)=>{if(!mutated){mutated=true;await reader.client.request(ROOT+'task.ics',{method:'PUT',body:ics('edited')})}return original(...args)};
  const result=await reader.read();assert.equal(result.davCheckpoint.collections.length,0);
});

test('large verified warm collections use bulk adoption without per-resource projection/accounting jobs',async t=>{
  const world=makeWorld();world.resources=Array.from({length:1000},(_,i)=>({name:`task-${i}.ics`,body:ics(String(i)),etag:'"1"'}));
  const saved=await world.reader().read(),reader=world.reader();const seedStart=performance.now();reader.prime(saved);const seedMs=performance.now()-seedStart;
  const events=[];const warmStart=performance.now();const result=await reader.read({onProgress:event=>events.push(event)});const warmMs=performance.now()-warmStart;
  assert.equal(result.records.length,1000);assert.equal(reader.stats.bodies,0);assert.equal(reader.stats.projections.length,0);assert.equal(reader.stats.gets.length,0);assert.equal(reader.stats.inventory,0);assert.equal(reader.stats.lists,0);
  assert.ok(events.length<=3,'warm reuse does not publish one event per cached resource');
  t.diagnostic(JSON.stringify({fixtureResources:1000,seedMs:Math.round(seedMs),warmMs:Math.round(warmMs),bodyReads:reader.stats.bodies,projections:reader.stats.projections.length}));
});

test('4,000 resource Files SSO collection reuses unaffected projections after a write and inventory after rollover',async t=>{
  const world=makeWorld();world.resources=Array.from({length:4000},(_,i)=>({name:`task-${i}.ics`,body:ics(String(i)),etag:'"1"'}));
  const reader=world.reader();await reader.read();
  const before={inventory:reader.stats.inventory,gets:reader.stats.gets.length,projections:reader.stats.projections.length,bodies:reader.stats.bodies};
  await reader.client.request(ROOT+'task-3999.ics',{method:'PUT',headers:{'If-Match':'"1"'},body:ics('changed')});
  assert.equal(reader.client.davCheckpoint().collections.length,0,'acknowledged write immediately removes certification');
  world.resources[3999]={...world.resources[3999],body:ics('changed'),etag:'"2"'};
  // Deliberately keep the fixture token unchanged: stale hints must never
  // suppress the fresh resource inventory after an acknowledged mutation.
  const encode=TextEncoder.prototype.encode;let rawEncodes=0,unchangedRawEncodes=0,metadataEncodes=0;
  TextEncoder.prototype.encode=function(value){
    if(typeof value==='string'&&value.startsWith('BEGIN:VCALENDAR')){rawEncodes++;if(!value.includes('SUMMARY:changed\r\n'))unchangedRawEncodes++;}
    if(typeof value==='string'&&value.startsWith('{')&&value.includes('"source":"tasks"')&&value.includes('"remote":')&&!value.includes('"raw":'))metadataEncodes++;
    return encode.call(this,value);
  };
  const start=performance.now();let result;
  try{result=await reader.read();}finally{TextEncoder.prototype.encode=encode;}
  assert.equal(result.records.length,4000);assert.equal(result.records.find(record=>record.remote.href===ROOT+'task-3999.ics').title,'changed');
  assert.equal(reader.stats.inventory-before.inventory,1);assert.equal(reader.stats.gets.length-before.gets,1);
  assert.equal(reader.stats.projections.length-before.projections,2,'one changed resource projected for two sources');
  assert.equal(reader.stats.bodies-before.bodies,1,'unchanged resource bodies never cross the cache bridge');
  assert.equal(unchangedRawEncodes,0,'unchanged raw documents are not re-encoded for accounting');
  assert.equal(metadataEncodes,1,'only the changed task is measured; rebuilding its checkpoint reuses that accounting');
  const mutationMs=Math.round(performance.now()-start),rolloverBefore={inventory:reader.stats.inventory,gets:reader.stats.gets.length,projections:reader.stats.projections.length};
  world.now=new Date('2026-11-14T12:00:00Z');await reader.read();
  assert.equal(reader.stats.inventory,rolloverBefore.inventory,'fresh unchanged token certifies membership on day rollover');
  assert.equal(reader.stats.gets.length,rolloverBefore.gets,'day rollover uses validated local bodies');
  const projections=reader.stats.projections.slice(rolloverBefore.projections);
  assert.equal(projections.length,4000);assert.ok(projections.every(value=>value.source==='calendar'),'task projections survive event horizon change');
  t.diagnostic(JSON.stringify({fixtureResources:4000,mutationMs,inventoryRequests:1,changedBodyDownloads:1,unchangedBodyReads:0,changedResourceProjections:2,rawEncodes,unchangedRawEncodes,metadataEncodes,rolloverInventoryRequests:0,rolloverDownloads:0}));
});

test('stale acceleration hints never certify partial, invalid-token or revoked collections',async()=>{
  for(const variant of ['invalid-token','interrupted','revoked']){
    const world=makeWorld(),reader=world.reader();await reader.read();
    await reader.client.request(ROOT+'task.ics',{method:'PUT',body:ics('changed')});
    assert.equal(reader.client.davCheckpoint().collections.length,0);
    if(variant==='invalid-token'){
      world.token={kind:'sync-token',value:'invalid\nvalue'};await reader.read();
      assert.equal(reader.stats.inventory,2);assert.equal(reader.client.davCheckpoint().collections.length,0);
    }else if(variant==='interrupted'){
      world.inventoryStatus=503;const result=await reader.read();
      assert.ok(result.statuses.every(status=>status.state==='error'));assert.equal(reader.client.davCheckpoint().collections.length,0);
    }else{
      world.available=false;const result=await reader.read();assert.equal(result.records.length,0);assert.equal(world.entries.size,0);
      world.available=true;world.token.value+='returned';const before=reader.stats.projections.length;await reader.read();
      assert.equal(reader.stats.projections.length-before,4,'removed collection hints cannot restore old authority/projections');
    }
  }
});

test('fresh collection authority publishes before resource scanning, including empty discovery, without asserting freshness',async()=>{
  const world=makeWorld(),reader=world.reader(),order=[],original=reader.client.readDav.bind(reader.client);
  reader.client.readDav=async(...args)=>{assert.equal(order[0],'collections');order.push('scan');return original(...args)};
  const result=await reader.read({onCollections:value=>{assert.deepEqual(value.sources,['tasks','calendar']);assert.equal(value.collections.length,2);assert.ok(value.collections.every(collection=>collection.remote.href===ROOT&&!collection.readonly));assert.equal(value.statuses,undefined);order.push('collections')},onSource:()=>order.push('source')});
  assert.ok(result.statuses.every(status=>status.state==='connected'));
  world.available=false;let empty;await reader.read({onCollections:value=>{empty=value;order.unshift('collections')}});assert.deepEqual(empty.collections,[]);
  const denied=world.reader();denied.client.discoverCalendars=async()=>{throw Object.assign(Error('Access revoked'),{code:'PERMISSION'})};
  let notified=false;const failure=await denied.read({onCollections:()=>{notified=true}});assert.equal(notified,false);assert.ok(failure.statuses.every(status=>status.permissionDenied));
});

test('cached collection inventories share the same aggregate resource bound with fresh inventories',async()=>{
  const now=new Date('2026-11-13T12:00:00Z'),window=davProjectionWindow(now.getTime()),token={kind:'ctag',value:'1'};
  const roots=Array.from({length:5},(_,i)=>ROOT.replace('/work/',`/cached-${i}/`));
  const client=new NextcloudClient({serverUrl:SERVER,username:'tester'},{accountKey:ACCOUNT,authentication:'delegated',davReadMode:'propfind-get',now:()=>now,fetch:async(url,options)=>options.method==='PROPFIND'?response(xml(row(ROOT,'<d:resourcetype><d:collection/></d:resourcetype>')+row(ROOT+'fresh.ics','<d:resourcetype/><d:getetag>&quot;1&quot;</d:getetag>')),207):response(ics('new'),200,{ETag:'"1"'})});
  const collections=roots.map(href=>({id:client.id('tasks',href),source:'tasks',title:'Cached',readonly:false,remote:{href}}));
  const checkpoint={version:1,projectionVersion:3,accountKey:ACCOUNT,collections:roots.map(href=>({href,token,readonly:false,components:['VTODO'],...window,resources:Array.from({length:10000},(_,i)=>({href:href+i+'.ics',etag:'"1"',taskKeys:[],eventKeys:[]}))}))};
  assert.equal(client.primeDavState({accountKey:ACCOUNT,records:[],collections,checkpoint}),true);
  client.discovered=true;client.refreshCapabilities=async()=>false;client.discoverCalendars=async()=>[ROOT,...roots].map(href=>({href,title:'Cached',readonly:false,components:['VTODO'],token}));
  const result=await client.readAll({sources:['tasks']});assert.equal(result.statuses[0].state,'error');assert.equal(result.statuses[0].errorCode,'LIMIT');assert.match(result.statuses[0].message,/50,000 resources/);
});

test('discovery reads supported change tokens through the real PROPFIND property parser',async()=>{
  const calls=[];const client=new NextcloudClient({serverUrl:SERVER,username:'tester'},{authentication:'delegated',fetch:async(url,options)=>{calls.push(options.body);if(calls.length===1)return response(xml(row(SERVER+'/remote.php/dav/','<d:current-user-principal><d:href>/nextcloud/remote.php/dav/principals/users/tester/</d:href></d:current-user-principal>')),207);if(calls.length===2)return response(xml(row(url,'<c:calendar-home-set><d:href>/nextcloud/remote.php/dav/calendars/tester/</d:href></c:calendar-home-set>')),207);return response(xml(row(ROOT,'<d:displayname>Work</d:displayname><d:resourcetype><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set><d:sync-token>https://fixture.invalid/token/1</d:sync-token>')),207)}});
  const calendars=await client.discoverCalendars();assert.deepEqual(calendars[0].token,{kind:'sync-token',value:'https://fixture.invalid/token/1'});assert.match(calls[2],/<d:sync-token\/>/);assert.match(calls[2],/<cs:getctag\/>/);
});


test('a renamed collection remeasures changed metadata but reuses exact raw document accounting',async()=>{
  const world=makeWorld(),reader=world.reader();await reader.read();world.title='Renamed example calendar';
  const encode=TextEncoder.prototype.encode;let rawEncodes=0,metadataEncodes=0;
  TextEncoder.prototype.encode=function(value){
    if(typeof value==='string'&&value.startsWith('BEGIN:VCALENDAR'))rawEncodes++;
    if(typeof value==='string'&&value.startsWith('{')&&value.includes('"remote":')&&value.includes('"collectionTitle":')&&!value.includes('"raw":'))metadataEncodes++;
    return encode.call(this,value);
  };
  let result;try{result=await reader.read();}finally{TextEncoder.prototype.encode=encode;}
  assert.ok(result.records.every(record=>record.collectionTitle===world.title));
  assert.equal(rawEncodes,0);assert.equal(metadataEncodes,2);
  assert.equal(reader.stats.inventory,1);assert.equal(reader.stats.gets.length,2);
});


test('caller mutations cannot certify stale accounting or replace native data in a warm checkpoint',async()=>{
  for(const mutate of [record=>{record.title='Untrusted local title';record.body='x'.repeat(34*1024*1024)},record=>record.remote.raw=ics('not-on-server'),record=>record.etag='"caller-version"',record=>record.tags.push('caller-only')]){
    const world=makeWorld(),reader=world.reader(),first=await reader.read();
    const task=first.records.find(record=>record.source==='tasks'),expected=structuredClone(task);mutate(task);
    const result=await reader.read(),fresh=result.records.find(record=>record.source==='tasks');
    assert.ok(result.statuses.every(status=>status.state==='connected'));
    assert.deepEqual(fresh,expected,'only the actual native version is adopted');
    assert.equal(fresh.remote.raw,ics('task'));assert.equal(fresh.etag,'"1"');assert.ok(!fresh.tags.includes('caller-only'));
    assert.equal(reader.stats.inventory,2,'mutated public data invalidates the acceleration baseline');
    assert.equal(reader.stats.gets.length,2,'verified raw cache can restore the native rows without another download');
  }
});
