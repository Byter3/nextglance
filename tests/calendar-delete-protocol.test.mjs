import test from 'node:test';
import assert from 'node:assert/strict';
import {nativePermissionResponse} from './native-permission-fixtures.mjs';
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs';
import {calendarContentEquivalent} from '@nextspace/nextcloud-client/calendar-representation.mjs';

const server='https://cloud.example.test', href=server+'/remote.php/dav/calendars/alex/work/booking.ics';
const document=(properties='',siblings='')=>['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:booking-1','DTSTART:20261120T100000Z','DTEND:20261120T110000Z','SUMMARY:Planning',properties,'END:VEVENT',siblings,'END:VCALENDAR',''].filter(value=>value!=='').join('\r\n');
const collection={id:'calendar-work',source:'calendar',remote:{href:server+'/remote.php/dav/calendars/alex/work/'}};
const record=(raw=document())=>({id:'event-1',source:'calendar',kind:'event',collectionId:collection.id,etag:'"original"',remote:{href,uid:'booking-1',raw}});
const reply=(body='',status=200,headers={})=>new Response([204,304].includes(status)?null:body,{status,headers});
const memberRow=(url,properties, status='200 OK')=>`<d:response><d:href>${url}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat></d:response>`;
const davProperties=(rows)=>reply(`<d:multistatus xmlns:d="DAV:">${rows}</d:multistatus>`,207);
const etagProperty=value=>`<d:getetag>${value}</d:getetag>`;
function fixture(handler){const calls=[];return{calls,client:new NextcloudClient({serverUrl:server,username:'alex',appPassword:'fixture'},{fetch:async(url,options)=>{calls.push({url,...options});return nativePermissionResponse(url,options)||handler(url,options,calls.filter(call=>call.method!=='PROPFIND').length)}})}}

test('ordinary timed and all-day events use fresh conditional reads and one conditional DELETE',async()=>{
  for(const raw of [document(),document().replace('DTSTART:20261120T100000Z','DTSTART;VALUE=DATE:20261120').replace('DTEND:20261120T110000Z','DTEND;VALUE=DATE:20261122'),document('', 'BEGIN:VTIMEZONE\r\nTZID:Etc/UTC\r\nEND:VTIMEZONE')]){
    const {client,calls}=fixture((url,options)=>{
      assert.equal(url,href);
      assert.equal(options.headers['If-Match'],'"original"');
      if(options.method==='DELETE')return reply('',204);
      assert.equal(options.headers['Accept-Encoding'],'identity');
      assert.equal(options.headers['Cache-Control'],'no-cache');
      return reply(raw,200,{ETag:'"original"'});
    });
    assert.deepEqual(await client.deleteEvent({id:'event-1'},record(raw),collection),{deleted:true});
    assert.equal(calls.length,3);assert.equal(calls[2].method,'DELETE');
  }
});
test('conditional GET also verifies a delegated response without exposed ETag headers',async()=>{
  const {client}=fixture((url,options)=>options.method==='DELETE'?reply('',204):reply(document()));
  assert.deepEqual(await client.deleteEvent({id:'event-1'},record(),collection),{deleted:true});
});
test('a proxy GET representation tag uses an exact DAV revision lookup and the original DELETE precondition',async()=>{
  for(const deletionStatus of [204,412]){
    const {client,calls}=fixture((url,options)=>{
      assert.equal(url,href);
      if(options.method==='PROPFIND'){
        assert.equal(options.headers.Depth,'0');
        assert.equal(options.headers['Cache-Control'],'no-cache');
        assert.match(options.body,/<d:getetag\/>/);
        return davProperties(memberRow(new URL(href).pathname,etagProperty('"original"')));
      }
      assert.equal(options.headers['If-Match'],'"original"');
      if(options.method==='DELETE')return reply('',deletionStatus);
      return reply(document(),200,{ETag:'"representation-tag"'});
    });
    const deleted=client.deleteEvent({id:'event-1'},record(),collection);
    if(deletionStatus===204)assert.deepEqual(await deleted,{deleted:true});
    else await assert.rejects(deleted,{code:'CONFLICT'});
    assert.deepEqual(calls.map(call=>call.method||'GET'),['PROPFIND','GET','PROPFIND','DELETE']);
  }
});
test('missing, weak, denied or ambiguous member evidence cannot resolve a GET tag mismatch',async()=>{
  const current=etagProperty('"original"');
  const cases=[
    [memberRow(href,etagProperty('"version-two"')),'CONFLICT'],
    [memberRow(href,etagProperty('W/"original"')),'CONFLICT'],
    [memberRow(href,''),'CONFLICT'],
    [memberRow(href,current,'404 Not Found'),'CONFLICT'],
    [memberRow(href.replace('booking.ics','other.ics'),current),'CONFLICT'],
    [memberRow(href,current).repeat(2),'CONFLICT'],
    [memberRow(href,current.repeat(2)),'FORMAT'],
    [memberRow(href,current,'403 Forbidden'),'PERMISSION'],
  ];
  for(const [properties,code] of cases){
    const {client,calls}=fixture((url,options)=>options.method==='PROPFIND'?davProperties(properties):reply(document(),200,{ETag:'"proxy"'}));
    await assert.rejects(client.deleteEvent({id:'event-1'},record(),collection),{code});
    assert.deepEqual(calls.map(call=>call.method||'GET'),['PROPFIND','GET','PROPFIND']);
  }
});
test('real REPORT XML baseline permits an unchanged CRLF GET using the original validator',async()=>{
  const raw=document('DESCRIPTION:Review & plan\r\nX-PRIVATE-FIELD:preserve')+'\r\n';
  const escaped=raw.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const report=`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>"original"</d:getetag><c:calendar-data>${escaped}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  const calls=[];
  const client=new NextcloudClient({serverUrl:server,username:'alex',appPassword:'fixture'},{now:()=>new Date('2026-11-13T12:00:00Z'),fetch:async(url,options)=>{
    calls.push({url,...options});
    const authority=nativePermissionResponse(url,options);if(authority)return authority;
    if(options.method==='REPORT')return reply(report);
    assert.equal(options.headers['If-Match'],'"original"');
    return options.method==='DELETE'?reply('',204):reply(raw,200,{ETag:'"original"'});
  }});
  const loaded=await client.readDav('calendar',[{href:collection.remote.href,title:'Work',components:['VEVENT'],readonly:false}]);
  assert.equal(loaded.records.length,1);
  assert.notEqual(loaded.records[0].remote.raw,raw);
  assert.equal(loaded.records[0].remote.raw.includes('\r\n'),false);
  assert.deepEqual(await client.deleteEvent({id:loaded.records[0].id},loaded.records[0],loaded.collections[0]),{deleted:true});
  assert.deepEqual(calls.map(call=>call.method||'GET'),['REPORT','PROPFIND','GET','DELETE']);
});
test('equivalent line folding and a terminal delimiter work with and without delegated ETag headers',async()=>{
  const baseline=document('DESCRIPTION:First line\\nSecond line\r\nX-LABEL:Város planning');
  const fresh=baseline.replace('First line\\nSecond line','First line\\nSec\r\n ond line').replace('Város planning','Város \r\n\tplanning')+'\r\n';
  for(const headers of [{ETag:'"original"'},{}]){
    const {client,calls}=fixture((url,options)=>options.method==='DELETE'?reply('',204):reply(fresh,200,headers));
    assert.deepEqual(await client.deleteEvent({id:'event-1'},record(baseline),collection),{deleted:true});
    assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
    assert.equal(calls[1].headers['If-Match'],'"original"');
  }
});
test('content-line comparison preserves unknown fields, duplicates, parameters, timezone data and whitespace',async()=>{
  const baseline=document('DESCRIPTION:Keep  two spaces\r\nX-VALUE;X-PARAM=one:alpha\r\nX-VALUE:beta','BEGIN:VTIMEZONE\r\nTZID:Etc/UTC\r\nEND:VTIMEZONE');
  const changed=[
    baseline.replace('Keep  two','Keep two'),
    baseline.replace('X-PARAM=one','X-PARAM=two'),
    baseline.replace('X-VALUE:beta','X-VALUE:gamma'),
    baseline.replace('TZID:Etc/UTC','TZID:Etc/GMT'),
    baseline.replace('SUMMARY:Planning','SUMMARY:planning'),
    baseline.replace('SUMMARY:Planning\r\nDESCRIPTION:Keep  two spaces','DESCRIPTION:Keep  two spaces\r\nSUMMARY:Planning'),
    baseline+'\r\n\r\n',
  ];
  for(const raw of changed){
    assert.equal(calendarContentEquivalent(baseline,raw),false);
    const {client,calls}=fixture(()=>reply(raw,200,{ETag:'"original"'}));
    await assert.rejects(client.deleteEvent({id:'event-1'},record(baseline),collection),{code:'CONFLICT'});
    assert.equal(calls.length,2);
  }
  assert.equal(calendarContentEquivalent(undefined,undefined),false);
  assert.equal(calendarContentEquivalent('X:ab','X:a\n  b'),false);
  assert.equal(calendarContentEquivalent('X:ab','X:a\r b'),false);
  const changedValidator=fixture((url,options)=>options.method==='PROPFIND'?davProperties(memberRow(href,etagProperty('"new"'))):reply(baseline.replaceAll('\r\n','\n'),200,{ETag:'"new"'}));
  await assert.rejects(changedValidator.client.deleteEvent({id:'event-1'},record(baseline),collection),{code:'CONFLICT'});
  assert.equal(changedValidator.calls.length,3);
});
test('complex and mixed resources fail locally before any network or whole-resource deletion',async()=>{
  const {client,calls}=fixture(()=>{throw Error('Unexpected request')});
  const raws=['RRULE:FREQ=DAILY','RDATE:20261121T100000Z','EXDATE:20261121T100000Z','RECURRENCE-ID:20261120T100000Z'].map(value=>document(value));
  raws.push(document().replace('VERSION:2.0','VERSION:2.0\r\nMETHOD:REQUEST'),document('', 'BEGIN:VTODO\r\nUID:task-1\r\nEND:VTODO'),document('', 'BEGIN:VEVENT\r\nUID:event-2\r\nEND:VEVENT'));
  for(const raw of raws)await assert.rejects(client.deleteEvent({id:'event-1'},record(raw),collection),{code:'VALIDATION'});
  assert.equal(calls.length,0);
});
test('invalid identities, unsafe locators and missing or weak baselines never send a DELETE',async()=>{
  const {client,calls}=fixture(()=>{throw Error('Unexpected request')});
  for(const changed of [{readonly:true},{source:'tasks'},{etag:undefined},{etag:'W/"original"'},{remote:{...record().remote,href:'https://other.example.test/private.ics'}},{remote:{...record().remote,href:collection.remote.href+'nested/booking.ics'}},{remote:{...record().remote,uid:'other'}}])await assert.rejects(client.deleteEvent({id:'event-1'},{...record(),...changed},collection));
  await assert.rejects(client.deleteEvent({id:'different'},record(),collection));
  await assert.rejects(client.deleteEvent({id:'event-1'},record(),{...collection,readonly:true}));
  assert.equal(calls.length,0);
});
test('changed baseline, conditional conflict and permission loss preserve the event without retry',async()=>{
  for(const result of [reply(document('DESCRIPTION:Changed'),200,{ETag:'"proxy"'}),reply('',412),reply('',403)]){
    const {client,calls}=fixture(()=>result);
    await assert.rejects(client.deleteEvent({id:'event-1'},record(),collection));assert.equal(calls.length,2);
  }
  for(const status of [403,412,500]){const{client,calls}=fixture((url,options)=>options.method==='DELETE'?reply('',status):reply(document()));await assert.rejects(client.deleteEvent({id:'event-1'},record(),collection));assert.equal(calls.filter(call=>call.method==='DELETE').length,1)}
});
test('verified absence is success, but asynchronous acceptance and transport uncertainty are not',async()=>{
  const missing=fixture(()=>reply('',404));assert.deepEqual(await missing.client.deleteEvent({id:'event-1'},record(),collection),{deleted:true});assert.equal(missing.calls.length,2);
  for(const status of [202,404]){
    const absent=fixture((url,options,index)=>index===1?reply(document()):options.method==='DELETE'?reply('',status):reply('',404));
    assert.deepEqual(await absent.client.deleteEvent({id:'event-1'},record(),collection),{deleted:true});assert.equal(absent.calls.length,4);
  }
  const accepted=fixture((url,options)=>options.method==='DELETE'?reply('',202):reply(document()));await assert.rejects(accepted.client.deleteEvent({id:'event-1'},record(),collection),{code:'UNAVAILABLE'});
  const uncertain=fixture((url,options)=>{if(options.method==='DELETE')throw Error('Disconnected');return reply(document())});await assert.rejects(uncertain.client.deleteEvent({id:'event-1'},record(),collection),{code:'NETWORK'});assert.equal(uncertain.calls.length,3);
});

test('disposable cache storage failure cannot erase an acknowledged native deletion',async()=>{
  let removes=0;
  const resourceCache={get:async()=>null,put:async()=>{},remove:async()=>{removes++;throw Error('Disk unavailable')},prune:async()=>{},retainCollections:async()=>{},clear:async()=>{}};
  const client=new NextcloudClient({serverUrl:server,username:'alex',appPassword:'fixture'},{resourceCache,fetch:async(url,options)=>nativePermissionResponse(url,options)||(options.method==='DELETE'?reply('',204):reply(document()))});
  assert.deepEqual(await client.deleteEvent({id:'event-1'},record(),collection),{deleted:true});assert.equal(removes,1);
});
