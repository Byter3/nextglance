import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import {nativePermissionResponse} from './native-permission-fixtures.mjs';
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs';
import {normalizeEventDetails,normalizeEventReminders,linkedEventDescription,newEventDetails} from '@nextspace/core/event-details.mjs';

const server='https://cloud.example.test', href=server+'/remote.php/dav/calendars/alex/work/event.ics';
const collection={id:'calendar-work',source:'calendar',title:'Work',remote:{href:server+'/remote.php/dav/calendars/alex/work/'}};
const alarm=(minutes,extra='')=>`BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT${minutes}M\r\nDESCRIPTION:Original reminder\r\n${extra}END:VALARM\r\n`;
const document=(alarms='',extra='')=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:event-1\r\nSUMMARY:Original\r\nDESCRIPTION:Keep description\r\nLOCATION:Room A\r\nDTSTART;TZID=Europe/Budapest:20261120T100000\r\nDURATION:PT1H\r\nX-CUSTOM:keep\r\n${extra}${alarms}END:VEVENT\r\nEND:VCALENDAR\r\n`;
const event=raw=>new ICAL.Component(ICAL.parse(raw)).getFirstSubcomponent('vevent');
function fixture(raw=document()) {
  const state={raw,calls:[],readStatus:200,readRaw:undefined};
  const client=new NextcloudClient({serverUrl:server,username:'alex',appPassword:'fixture'},{now:()=>new Date('2026-11-13T12:00:00Z'),fetch:async(url,options)=>{
    state.calls.push({url,...options});
    const authority=nativePermissionResponse(url,options);if(authority)return authority;
    if(options.method==='PUT'){state.raw=options.body;return new Response(null,{status:204,headers:{ETag:'"updated"'}})}
    return new Response(state.readRaw??state.raw,{status:state.readStatus,headers:{ETag:'"updated"'}});
  }});
  const parse=body=>client.calendarRecords(body,href,'"original"',collection,new Date('2026-11-01'),new Date('2026-12-01'))[0];
  return {client,state,record:parse(raw),parse};
}

test('event details share bounded validation and creation defaults without changing omitted legacy fields',()=>{
  assert.deepEqual(normalizeEventDetails({title:'  Planning ',location:'',description:'',reminders:[30,0,15]},{requireTitle:true}),{title:'Planning',location:'',description:'',reminders:[0,15,30]});
  assert.deepEqual(normalizeEventDetails({}),{});
  for(const value of [null,15,[15,15],[-1],[1.5],[40321],[0,1,2,3,4,5],['15'],new Array(1)])assert.throws(()=>normalizeEventReminders(value),TypeError);
  for(const input of [{title:''},{title:'x'.repeat(501)},{location:'x'.repeat(2001)},{description:'x'.repeat(500001)},{title:'bad\0text'},{location:null}])assert.throws(()=>normalizeEventDetails(input),TypeError);
  const record={title:'Plan delivery',source:'deck',collectionTitle:'Studio',url:'https://cloud.example.test/apps/deck/board/1/card/2'};
  assert.equal(linkedEventDescription(record),'Scheduled work: Plan delivery\nSource: Studio\nhttps://cloud.example.test/apps/deck/board/1/card/2');
  assert.equal(linkedEventDescription({...record,collectionTitle:'',url:'https://user:secret@cloud.example.test'}),'Scheduled work: Plan delivery\nSource: Deck');
  for(const url of ['javascript:alert(1)','/relative','not a url'])assert.equal(linkedEventDescription({...record,url}).split('\n').length,2);
  assert.deepEqual(newEventDetails(),{title:'',location:'',description:'',reminders:[15]});
  const first=newEventDetails(record);first.reminders.push(30);assert.deepEqual(newEventDetails(record).reminders,[15]);
});

test('native event creation roundtrips location and DISPLAY reminders, without an implicit legacy alarm',async()=>{
  for(const reminders of [undefined,[],[0,15,40320]]){
    const {client,state}=fixture();
    const saved=await client.createEvent({title:'Custom title',location:'Studio, upstairs',description:'Linked work',start:'2026-11-20T10:00:00Z',end:'2026-11-20T11:00:00Z',...(reminders!==undefined?{reminders}:{})},collection);
    const projected=await client.createdRecord('calendar',saved,collection);
    assert.equal(projected.title,'Custom title');assert.equal(projected.location,'Studio, upstairs');assert.equal(projected.body,'Linked work');
    assert.deepEqual(projected.reminders,reminders||[]);assert.equal(projected.unsupportedReminderCount,0);
    assert.equal(state.calls[1].headers['If-None-Match'],'*');
    for(const item of event(saved.raw).getAllSubcomponents('valarm'))assert.equal(item.getFirstPropertyValue('description'),'Custom title');
  }
});

test('details-only writes preserve dates/duration/native properties and untouched alarms, then use targeted readback',async()=>{
  const raw=document(alarm(15,'X-PRIVATE:preserve\r\n')+alarm(30));
  const {client,state,record}=fixture(raw),before=event(raw);
  const saved=await client.updateEvent({id:record.id,etag:record.etag,title:' New title ',location:'',description:''},record);
  const after=event(saved.raw);
  assert.equal(after.getFirstPropertyValue('summary'),'New title');assert.equal(after.getFirstProperty('location'),null);assert.equal(after.getFirstProperty('description'),null);
  for(const name of ['dtstart','duration','x-custom'])assert.deepEqual(after.getFirstProperty(name).toJSON(),before.getFirstProperty(name).toJSON());
  assert.deepEqual(after.getAllSubcomponents('valarm').map(value=>value.toJSON()),before.getAllSubcomponents('valarm').map(value=>value.toJSON()));
  assert.deepEqual(state.calls.map(value=>value.method||'GET'),['PROPFIND','PUT','GET']);assert.equal(state.calls[1].headers['If-Match'],'"original"');assert.equal(state.calls[2].headers['If-Match'],'"updated"');
});

test('explicit reminders preserve nonbasic native alarms and offsets beyond the five-editable limit',async()=>{
  const unsupported=[alarm(60,'X-CUSTOM:keep\r\n'),alarm(70).replace('ACTION:DISPLAY','ACTION:AUDIO'),alarm(80).replace('ACTION:DISPLAY','ACTION:EMAIL'),alarm(90).replace('TRIGGER:-PT90M','TRIGGER;RELATED=END:-PT90M'),alarm(100).replace('TRIGGER:-PT100M','TRIGGER;VALUE=DATE-TIME:20261120T080000Z'),alarm(110,'REPEAT:2\r\nDURATION:PT5M\r\n')];
  const raw=document([1,2,3,4,5,6].map(value=>alarm(value)).join('')+unsupported.join(''));
  const {client,record}=fixture(raw);
  assert.deepEqual(record.reminders,[1,2,3,4,5]);assert.equal(record.unsupportedReminderCount,7);
  const saved=await client.updateEvent({reminders:[]},record),after=event(saved.raw);
  assert.equal(after.getAllSubcomponents('valarm').length,7);
  const expected=event(document(alarm(6)+unsupported.join(''))).getAllSubcomponents('valarm').map(value=>value.toJSON());
  assert.deepEqual(after.getAllSubcomponents('valarm').map(value=>value.toJSON()),expected);
});

test('retained reminder offsets preserve their descriptions while new offsets use the event title',async()=>{
  const {client,record}=fixture(document(alarm(15)+alarm(30)));
  const saved=await client.updateEvent({title:'Changed',reminders:[0,30]},record);
  const alarms=event(saved.raw).getAllSubcomponents('valarm');
  assert.equal(alarms.find(value=>value.getFirstPropertyValue('trigger').toSeconds()===-1800).getFirstPropertyValue('description'),'Original reminder');
  assert.equal(alarms.find(value=>value.getFirstPropertyValue('trigger').toSeconds()===0).getFirstPropertyValue('description'),'Changed');
});

test('invalid details, incomplete dates, stale captured ETags and complex resources never write',async()=>{
  const {client,state,record}=fixture();
  for(const input of [{},{allDay:true},{start:'2026-11-20'},{end:'2026-11-21'},{reminders:[15,15]},{location:null},{title:'x',etag:'"old"'}])await assert.rejects(client.updateEvent(input,record));
  for(const raw of [document('', 'RRULE:FREQ=DAILY\r\n'),document('', 'ORGANIZER:mailto:alex@example.test\r\n'),document().replace('END:VCALENDAR','BEGIN:VTODO\r\nUID:task\r\nEND:VTODO\r\nEND:VCALENDAR')])await assert.rejects(client.updateEvent({title:'New'},{...record,remote:{...record.remote,raw}}));
  await assert.rejects(client.updateEvent({title:'New'},{...record,etag:'W/"original"'}));assert.equal(state.calls.length,0);
});

test('failed or foreign readback reports an acknowledged save without replaying its mutation',async()=>{
  for(const variant of ['failure','foreign']){
    const {client,state,record}=fixture();
    if(variant==='failure')state.readStatus=503;else state.readRaw=document().replace('UID:event-1','UID:other');
    await assert.rejects(client.updateEvent({title:'New'},record),{code:'UNAVAILABLE',message:'Event was saved but could not be verified. Refresh before retrying.'});
    assert.deepEqual(state.calls.map(value=>value.method||'GET'),['PROPFIND','PUT','GET']);assert.equal(record.title,'Original');
  }
});
