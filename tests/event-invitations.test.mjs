import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs';
import {normalizeEventAttendees,normalizeEventParticipation} from '@nextspace/core/event-scheduling.mjs';
import {eventEditOperation,eventDeleteOperation,eventRespondOperation} from '@nextspace/core/native-operations.mjs';

const server='https://cloud.example.test', principal=server+'/remote.php/dav/principals/users/alex/',home=server+'/remote.php/dav/calendars/alex/',root=home+'work/',href=root+'event.ics';
const xml=(url,properties)=>`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${url}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
const document=(extra='')=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:event-1\r\nSUMMARY:Planning\r\nLOCATION:Room A\r\nDTSTART:20261120T100000Z\r\nDTEND:20261120T110000Z\r\nSEQUENCE:7\r\nX-KEEP:native\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;
const invited='ORGANIZER;CN=Alex:mailto:alex@example.test\r\nATTENDEE;CN=Bea;PARTSTAT=ACCEPTED;RSVP=FALSE;X-KEEP=yes:mailto:bea@example.test\r\n';
const event=raw=>new ICAL.Component(ICAL.parse(raw)).getFirstSubcomponent('vevent');
function world(raw=document(invited)){
  const state={raw,etag:'"one"',email:'alex@example.test',owner:principal,invite:true,reply:true,write:true,calls:[],readFail:false,deleted:false,omitHeaders:false};
  const client=new NextcloudClient({serverUrl:server,username:'alex',appPassword:'fixture'},{now:()=>new Date('2026-11-13T12:00:00Z'),fetch:async(url,options)=>{
    state.calls.push({url,...options});const method=options.method||'GET';
    if(method==='PROPFIND'){
      if(url===server+'/remote.php/dav/')return new Response(xml(url,`<d:current-user-principal><d:href>${principal}</d:href></d:current-user-principal>`),{status:207});
      if(url===principal)return new Response(xml(url,`<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set><c:calendar-user-address-set><d:href>mailto:${state.email}</d:href></c:calendar-user-address-set><c:schedule-outbox-URL><d:href>${home}outbox/</d:href></c:schedule-outbox-URL><d:displayname>Alex</d:displayname>`),{status:207});
      if(url===home+'outbox/')return new Response(xml(url,`<d:current-user-privilege-set>${state.invite?'<d:privilege><c:schedule-send-invite/></d:privilege>':''}${state.reply?'<d:privilege><c:schedule-send-reply/></d:privilege>':''}</d:current-user-privilege-set>`),{status:207});
      if(url===home)return new Response(xml(root,`<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><d:owner><d:href>${state.owner}</d:href></d:owner><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set>${state.write?'<d:privilege><d:write/></d:privilege>':''}</d:current-user-privilege-set><d:sync-token>same-token</d:sync-token>`),{status:207});
      return new Response(xml(root,'<d:resourcetype><d:collection/></d:resourcetype>').replace('</d:multistatus>',xml(href,`<d:resourcetype/><d:getetag>${state.etag.replaceAll('"','&quot;')}</d:getetag>`).split('<d:response>')[1].replace(/^/,'<d:response>')),{status:207});
    }
    if(method==='PUT'){assert.equal(options.headers['x-nc-scheduling'],undefined);assert.equal(options.headers['Schedule-Reply'],undefined);state.raw=options.body;state.etag='"two"';state.deleted=false;return new Response(null,{status:204,headers:state.omitHeaders?{}:{ETag:state.etag}});}
    if(method==='DELETE'){state.deleted=true;return new Response(null,{status:204});}
    if(state.readFail)return new Response('',{status:503});
    return new Response(state.deleted?'':state.raw,{status:state.deleted?404:200,headers:state.omitHeaders?{}:{ETag:state.etag}});
  }});
  const collection={id:client.id('calendar',root),source:'calendar',title:'Work',remote:{href:root}};
  const parse=(raw=state.raw,c=collection)=>client.calendarRecords(raw,href,state.etag,c,new Date('2026-11-01'),new Date('2026-12-01'))[0];
  return {state,client,collection,parse,async discovered(){const [c]=await client.discoverCalendars();return {...collection,calendarScheduling:{canInvite:c.scheduling.canInvite,organizer:c.scheduling.organizer},remote:{href:root,scheduling:c.scheduling}}}};
}

test('native attendee validation rejects controls, duplicate addresses and unknown shapes',()=>{
  assert.deepEqual(normalizeEventAttendees([{email:' Bea@example.test ',name:' Bea '}]),[{email:'Bea@example.test',name:'Bea'}]);
  for(const input of [[{email:'a@example.test\r\n'}],[{email:'a@example.test'},{email:'A@example.test'}],[{email:'a@example.test',participation:'ACCEPTED'}],[{email:'a@@b'}],[{email:'á@example.test'}],new Array(1)])assert.throws(()=>normalizeEventAttendees(input));
  assert.equal(normalizeEventParticipation('TENTATIVE'),'TENTATIVE');assert.throws(()=>normalizeEventParticipation('NEEDS-ACTION'));
});

test('actual DAV discovery verifies principal addresses, owner and outbox privileges',async()=>{
  const w=world(),[calendar]=await w.client.discoverCalendars();
  assert.equal(calendar.scheduling.canInvite,true);assert.equal(calendar.scheduling.canRespond,true);assert.deepEqual(calendar.scheduling.addresses,['alex@example.test']);
  assert.ok(w.state.calls.find(call=>call.url===principal).body.includes('calendar-user-address-set'));
  assert.ok(w.state.calls.find(call=>call.url===home).body.includes('<d:owner/>'));
  w.state.owner=principal.replace('alex','other');const [shared]=await w.client.discoverCalendars();assert.equal(shared.scheduling.canInvite,false);assert.equal(shared.scheduling.reason,'not-calendar-owner');
});

test('saved event metadata remains readable while operation gates distinguish organizer and attendee',async()=>{
  const w=world(),collection=await w.discovered(),record=w.parse(undefined,collection);
  assert.equal(record.location,'Room A');assert.equal(record.readonly,true);assert.equal(record.eventScheduling.role,'organizer');assert.equal(record.eventAccess.editAttendees,true);
  assert.equal(eventEditOperation(record,[collection]),'updateEvent');assert.equal(eventDeleteOperation(record,[collection]),'deleteEvent');assert.equal(eventRespondOperation(record,[collection]),null);
  w.state.email='bea@example.test';const attendeeCollection=await w.discovered(),attendee=w.parse(undefined,attendeeCollection);
  assert.equal(attendee.eventAccess.editDetails,false);assert.equal(attendee.eventAccess.editReminders,true);assert.equal(eventRespondOperation(attendee,[attendeeCollection]),'respondToEvent');assert.equal(eventDeleteOperation(attendee,[attendeeCollection]),null);
  const recurring=w.parse(document(invited+'RRULE:FREQ=DAILY\r\n'),attendeeCollection);assert.equal(recurring.eventAccess.reason,'recurring');assert.equal(recurring.location,'Room A');
});

test('native invitation creation uses verified organizer, pending recipients and authoritative readback',async()=>{
  const w=world(document()),saved=await w.client.createEvent({title:'Review',start:'2026-11-20T10:00:00Z',end:'2026-11-20T11:00:00Z',attendees:[{email:'bea@example.test',name:'Bea'}]},w.collection);
  const native=event(w.state.raw),guest=native.getFirstProperty('attendee');
  assert.equal(native.getFirstPropertyValue('organizer'),'mailto:alex@example.test');assert.equal(guest.getParameter('partstat'),'NEEDS-ACTION');assert.equal(guest.getParameter('rsvp'),'TRUE');assert.equal(saved.record.eventAccess.editAttendees,true);assert.equal(saved.verifiedCollection.id,w.collection.id);
  assert.equal(w.state.calls.filter(call=>call.method==='PUT').length,1);
});

test('acknowledged invitation create retains its identity and warning if readback fails',async()=>{
  const w=world(document());w.state.readFail=true;
  const saved=await w.client.createEvent({title:'Review',start:'2026-11-20T10:00:00Z',end:'2026-11-20T11:00:00Z',attendees:[{email:'bea@example.test'}]},w.collection);
  assert.ok(saved.href&&saved.uid);assert.equal(saved.record.readonly,true);assert.equal(saved.record.eventAccess.editDetails,false);assert.match(saved.warning,/created/);assert.match(saved.record.creationWarning,/do not create it again/);
  assert.equal(w.state.calls.filter(call=>call.method==='PUT').length,1);
});

test('organizer attendee edits preserve retained responses and custom native properties',async()=>{
  const w=world(),record=w.parse();
  const saved=await w.client.updateEvent({id:record.id,etag:record.etag,location:'Room B',attendees:[{email:'bea@example.test',name:'New display ignored'},{email:'casey@example.test'}]},record,w.collection);
  const native=event(saved.raw),guests=native.getAllProperties('attendee');
  assert.equal(guests[0].getParameter('partstat'),'ACCEPTED');assert.equal(guests[0].getParameter('x-keep'),'yes');assert.equal(guests[0].getParameter('cn'),'Bea');assert.equal(guests[1].getParameter('partstat'),'NEEDS-ACTION');assert.equal(native.getFirstPropertyValue('sequence'),8);assert.equal(native.getFirstPropertyValue('x-keep'),'native');
  const committed=await w.client.savedRecord(record,w.collection,saved);assert.equal(committed.eventAccess.editDetails,true);
  assert.deepEqual(w.state.calls.filter(call=>call.method!=='PROPFIND').map(call=>call.method||'GET'),['GET','PUT','GET']);
});

test('clearing guests preserves a native organizer self-attendee unchanged',async()=>{
  const self='ATTENDEE;PARTSTAT=ACCEPTED;ROLE=CHAIR;X-SELF=keep:mailto:alex@example.test\r\n';
  const w=world(document(invited+self)),record=w.parse();
  const saved=await w.client.updateEvent({id:record.id,etag:record.etag,attendees:[]},record,w.collection);
  const guests=event(saved.raw).getAllProperties('attendee');assert.equal(guests.length,1);
  assert.deepEqual(guests[0].toJSON(),event(document(self)).getFirstProperty('attendee').toJSON());
});

test('unsupported native scheduling and malformed participants never reach a write',async()=>{
  for(const extra of [invited+'ATTENDEE:mailto:BEA@example.test\r\n',invited.replace('mailto:alex@example.test','https://example.test/principal'),invited.replace('PARTSTAT=ACCEPTED','SCHEDULE-AGENT=CLIENT;PARTSTAT=ACCEPTED'),'ATTENDEE:mailto:bea@example.test\r\n']){
    const w=world(document(extra)),record=w.parse();await assert.rejects(w.client.updateEvent({id:record.id,etag:record.etag,title:'Changed'},record,w.collection),{code:'VALIDATION'});assert.equal(w.state.calls.length,0);
  }
});

test('attendee RSVP and reminder-only edits preserve organizer fields and sequence',async()=>{
  const w=world();w.state.email='bea@example.test';const record=w.parse();
  const saved=await w.client.respondToEvent({id:record.id,etag:record.etag,participation:'TENTATIVE'},record,w.collection),native=event(saved.raw);
  assert.equal(native.getFirstPropertyValue('sequence'),7);assert.equal(native.getFirstProperty('attendee').getParameter('partstat'),'TENTATIVE');assert.equal(native.getFirstProperty('attendee').getParameter('rsvp'),'FALSE');assert.equal(native.getFirstPropertyValue('organizer'),'mailto:alex@example.test');assert.equal(native.getFirstPropertyValue('location'),'Room A');
  const next=await w.client.savedRecord(record,w.collection,saved),reminder=await w.client.updateEvent({id:next.id,etag:next.etag,reminders:[15]},next,w.collection);
  assert.equal(event(reminder.raw).getFirstPropertyValue('sequence'),7);assert.equal(event(reminder.raw).getAllSubcomponents('valarm').length,1);
  const latest=await w.client.savedRecord(next,w.collection,reminder);await assert.rejects(w.client.updateEvent({id:latest.id,etag:latest.etag,title:'Forbidden'},latest,w.collection),{code:'PERMISSION'});
  await assert.rejects(w.client.deleteEvent({id:latest.id},latest,w.collection),{code:'PERMISSION'});
});

test('fresh privilege loss, owner change and stale ETags block invitation mutations',async()=>{
  for(const change of [{invite:false},{owner:principal.replace('alex','other')},{email:'nobody@example.test'},{write:false}]){
    const w=world(),old=await w.discovered(),record=w.parse(undefined,old);Object.assign(w.state,change);
    await assert.rejects(w.client.updateEvent({id:record.id,etag:record.etag,title:'Changed'},record,old));assert.equal(w.state.calls.filter(call=>call.method==='PUT').length,0);
  }
  const w=world(),record=w.parse();w.state.etag='"changed"';await assert.rejects(w.client.respondToEvent({id:record.id,etag:record.etag,participation:'ACCEPTED'},record,w.collection),{code:'CONFLICT'});
  assert.equal(w.state.calls.filter(call=>call.method==='PUT').length,0);
});

test('Files transport without response ETags keeps original conditional writes and readback protected',async()=>{
  const w=world(),record=w.parse();w.state.omitHeaders=true;
  const saved=await w.client.updateEvent({id:record.id,etag:record.etag,title:'Changed'},record,w.collection);
  assert.equal(w.state.calls.find(call=>call.method==='PUT').headers['If-Match'],'"one"');assert.equal(saved.etag,undefined);
  const committed=await w.client.savedRecord(record,w.collection,saved);assert.equal(committed.readonly,true);assert.equal(committed.eventAccess.editDetails,false);assert.equal(committed.eventAccess.reason,'missing-validator');
});

test('an empty guest patch cannot bypass unknown organizer authority',async()=>{
  const w=world(document('ORGANIZER:mailto:other@example.test\r\n')),record=w.parse();
  await assert.rejects(w.client.updateEvent({id:record.id,etag:record.etag,attendees:[]},record,w.collection),{code:'PERMISSION'});
  assert.equal(w.state.calls.filter(call=>call.method==='PUT').length,0);
});

test('organizer native deletion uses conditional DELETE; invitations are never simulated locally',async()=>{
  const w=world(),record=w.parse();assert.deepEqual(await w.client.deleteEvent({id:record.id},record,w.collection),{deleted:true});
  const removed=w.state.calls.filter(call=>call.method==='DELETE');assert.equal(removed.length,1);assert.equal(removed[0].headers['If-Match'],'"one"');assert.equal(removed[0].headers['x-nc-scheduling'],undefined);
});

test('warm unchanged-token projection recomputes participant authority without parsing unchanged bodies',async()=>{
  const w=world();w.client.discovered=true;w.client.refreshCapabilities=async()=>false;
  const cache=new Map(),port={get:async q=>cache.get(q.href)||null,put:async q=>cache.set(q.href,q),remove:async q=>cache.delete(q.href),prune:async()=>{},retainCollections:async()=>{},clear:async()=>{}};
  // A separate reader uses the real DAV discovery and durable cache scan.
  const transport=w.client.request.bind(w.client);
  const client=new NextcloudClient({serverUrl:server,username:'alex',appPassword:'fixture'},{accountKey:'fixture',davReadMode:'propfind-get',resourceCache:port,now:()=>new Date('2026-11-13'),fetch:async(url,options)=>{const response=await transport(url,options);return new Response(response.body,{status:response.status,headers:response.headers})}});
  client.discovered=true;client.refreshCapabilities=async()=>false;
  const first=await client.readAll({sources:['calendar']});assert.ok(first.records.length,JSON.stringify(first.statuses));assert.equal(first.records[0].eventAccess.editAttendees,true);
  w.state.invite=false;w.state.calls=[];const next=await client.readAll({sources:['calendar']});assert.equal(next.records[0].eventAccess.editAttendees,false);assert.equal(next.collections[0].calendarScheduling.canInvite,false);
  assert.equal(w.state.calls.filter(call=>!call.method||call.method==='GET').length,0);
});
