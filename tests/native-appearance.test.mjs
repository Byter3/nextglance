import test from 'node:test';
import assert from 'node:assert/strict';
import ICAL from 'ical.js';
import {nativePermissionResponse} from './native-permission-fixtures.mjs';
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs';
import {itemColor, sourceColor, recordTags, tagColorKey} from '@nextspace/core/record-presentation.mjs';

const server = 'https://cloud.example.test';
const now = new Date('2026-11-10T12:00:00Z');
const ics = lines => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR', ''].join('\r\n');
const reply = (body, headers={}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status:200,headers});
function fixture(handler) {
  const calls = [];
  const client = new NextcloudClient({serverUrl:server,username:'fixture',appPassword:'fixture'}, {now:()=>now,fetch:async(url,options)=>{calls.push({url,...options});return nativePermissionResponse(url,options)||handler(url,options);}});
  return {client,calls};
}
const board = {id:'board',source:'deck',title:'Freelance',color:'#0082c9',stacks:[{id:'3',title:'Doing'}],labels:[{id:'1',title:'Later',color:'#ffee00'},{id:'2',title:'Urgent',color:'#ff0000'}]};
const card = {id:7,stackId:3,title:'Work',description:'Keep my checklist',type:'plain',owner:'fixture',order:1,lastModified:1794312000,done:'2026-11-09T12:00:00Z',startdate:'2026-11-09T09:00:00Z',duedate:'2026-11-12T10:00:00Z',color:'#223344',dependentCards:[8],labels:[{id:1,title:'Later',color:'FFEE00'}]};
const deckRecord = () => ({id:'card',source:'deck',collectionId:'board',color:'#223344',tags:['Later'],tagDetails:[{id:'1',title:'Later',color:'#ffee00'}],remote:{nativeId:7,boardId:2,stackId:3,snapshot:structuredClone(card)}});

test('native item colors and colored labels are read without replacing source colors', async()=>{
  const {client} = fixture(url => url.endsWith('/boards?details=true') ? reply([{id:2,title:'Freelance',color:'0082C9',labels:[{id:1,title:'Later',color:'FFEE00'},{id:2,title:'Urgent',color:'FF0000'}],permissions:{PERMISSION_EDIT:true}}]) : reply([{id:3,title:'Doing',cards:[card]}]));
  const result = await client.readDeck();
  assert.equal(result.collections[0].color,'#0082c9');
  assert.deepEqual(result.collections[0].labels,board.labels);
  assert.equal(result.records[0].color,'#223344');
  assert.deepEqual(result.records[0].tagDetails,[{id:'1',title:'Later',color:'#ffee00'}]);
  assert.deepEqual(result.records[0].nativeDependencies,[client.id('deck',8)]);
  assert.equal(result.records[0].nativeDependents,undefined);
  for (const source of ['tasks','calendar']) {
    const kind=source==='tasks'?'VTODO':'VEVENT';
    const raw=ics([`BEGIN:${kind}`,'UID:item','SUMMARY:Item','DTSTART:20261110T090000Z','COLOR:#12AB34','CATEGORIES:First,Second',`END:${kind}`]);
    const records=client.calendarRecords(raw,`${server}/item.ics`,'"v1"',{id:'list',source,color:'#ff0000'},new Date(0),new Date('2100-01-01'));
    assert.equal(records[0].color,'#12ab34');assert.deepEqual(records[0].tags,['First','Second']);
  }
});

test('Deck appearance edits native color and label assignments, preserving completion, dates and description', async()=>{
  let native = structuredClone(card);
  const {client,calls}=fixture((url,options)=>{
    if (options.method==='PUT' && url.endsWith('/removeLabel')) {native.labels=native.labels.filter(label=>label.id!==JSON.parse(options.body).labelId);return reply(native);}
    if (options.method==='PUT' && url.endsWith('/assignLabel')) {const id=JSON.parse(options.body).labelId;native.labels.push({...board.labels.find(label=>label.id===String(id)),id});return reply(native);}
    if (options.method==='PUT') {const body=JSON.parse(options.body);assert.equal(body.color,'00ff00','Deck native color has no leading hash');for(const key of ['done','description','duedate','startdate'])assert.equal(body[key],card[key]);native={...native,...body};return reply(native);}
    return reply(native,{ETag:'"v2"'});
  });
  const original=deckRecord();
  const result=await client.updateRecordAppearance({color:'#00ff00',tagIds:['2']},original,board);
  const saved=await client.savedRecord(original,board,result);
  assert.equal(saved.color,'#00ff00');assert.equal(saved.completed,true);assert.deepEqual(saved.tags,['Urgent']);assert.equal(saved.tagDetails[0].color,'#ff0000');
  assert.equal(calls.length,6);assert.equal(original.color,'#223344');assert.equal(original.remote.snapshot.color,'#223344');
  assert.equal(calls.filter(call=>call.url.endsWith('/assignLabel')).length,1);
});

test('Deck rejects ignored colors/labels and read-only or stale writes instead of claiming success', async()=>{
  const {client,calls}=fixture(()=>reply(card));
  await assert.rejects(client.updateRecordAppearance({color:'#00ff00'},deckRecord(),board),/did not confirm/);
  await assert.rejects(client.updateRecordAppearance({tagIds:['2']},deckRecord(),board),/did not confirm/);
  const before=calls.length;
  await assert.rejects(client.updateRecordAppearance({color:'#00ff00'},{...deckRecord(),readonly:true},board),/read-only/);
  await assert.rejects(client.updateRecordAppearance({tagIds:['999']},deckRecord(),board),/Choose labels/);
  assert.equal(calls.length,before);
  const changed=deckRecord();changed.remote.snapshot.labels=[];
  await assert.rejects(client.updateRecordAppearance({tagIds:[]},changed,board),/labels changed/);
});

test('CalDAV color and tags round trip natively while preserving unrelated properties and escaped category names', async()=>{
  for(const source of ['tasks','calendar']) {
    const kind=source==='tasks'?'VTODO':'VEVENT';
    let native=ics([`BEGIN:${kind}`,'UID:item','SUMMARY:Keep title','DESCRIPTION:Keep text','DTSTART:20261110T090000Z',source==='tasks'?'DUE:20261111T100000Z':'DTEND:20261110T100000Z','COLOR:#223344','CATEGORIES:Old','X-KEEP:preserved',`END:${kind}`]);
    const {client,calls}=fixture((url,options)=>{
      assert.equal(url,`${server}/item.ics`);
      if(options.method==='PUT'){assert.equal(options.headers['If-Match'],'"v1"');native=options.body;return reply('',{ETag:'"v2"'});}
      return reply(native,{ETag:'"v2"'});
    });
    const collection={id:'list',source,color:'#ff0000'};
    let record=client.calendarRecords(native,`${server}/item.ics`,'"v1"',collection,new Date(0),new Date('2100-01-01'))[0];
    const saved=await client.updateRecordAppearance({color:'#55aa77',tags:['Client, partner','Design; art','Közös']},record,collection);
    record=await client.savedRecord(record,collection,saved);
    assert.equal(record.color,'#55aa77');assert.deepEqual(record.tags,['Client, partner','Design; art','Közös']);assert.equal(record.body,'Keep text');assert.match(record.remote.raw,/X-KEEP:preserved/);assert.equal(calls.length,2);
    const component=new ICAL.Component(ICAL.parse(saved.raw)).getFirstSubcomponent(kind.toLowerCase());
    assert.equal(component.getFirstPropertyValue('color'),'#55aa77');
  }
});

test('clearing CalDAV color/tags removes native overrides; unconfirmed server changes fail', async()=>{
  let raw=ics(['BEGIN:VTODO','UID:item','SUMMARY:Keep','COLOR:#223344','CATEGORIES:Old','END:VTODO']);
  const {client}=fixture((url,options)=>{if(options.method==='PUT'){raw=options.body;return reply('',{ETag:'"v2"'});}return reply(raw,{ETag:'"v2"'});});
  const collection={id:'list',source:'tasks'};
  const record=client.calendarRecords(raw,`${server}/item.ics`,'"v1"',collection,new Date(0),new Date('2100-01-01'))[0];
  const saved=await client.updateRecordAppearance({color:'',tags:[]},record,collection);
  assert.doesNotMatch(saved.raw,/COLOR:|CATEGORIES:/);
  const ignored=fixture(()=>reply(record.remote.raw,{ETag:'"v2"'}));
  await assert.rejects(ignored.client.updateRecordAppearance({color:'#00ff00'},record,collection),/did not confirm/);
  await assert.rejects(client.updateRecordAppearance({color:'red'},record,collection),/six-digit/);
});

test('native task status mapping keeps completion and progress internally consistent', async()=>{
  const {client}=fixture((url,options)=>reply('',{ETag:'"v2"'}));
  const raw=ics(['BEGIN:VTODO','UID:item','SUMMARY:Keep','STATUS:COMPLETED','PERCENT-COMPLETE:100','COMPLETED:20261109T100000Z','X-KEEP:preserved','END:VTODO']);
  const collection={id:'list',source:'tasks'};
  const record=client.calendarRecords(raw,`${server}/item.ics`,'"v1"',collection,new Date(0),new Date('2100-01-01'))[0];
  for(const status of ['NEEDS-ACTION','IN-PROCESS','CANCELLED','COMPLETED']){
    const saved=await client.updateTaskStatus({status},record);
    const todo=new ICAL.Component(ICAL.parse(saved.raw)).getFirstSubcomponent('vtodo');
    assert.equal(todo.getFirstPropertyValue('status'),status);assert.equal(todo.hasProperty('completed'),status==='COMPLETED');assert.equal(todo.getFirstPropertyValue('percent-complete'),['COMPLETED','CANCELLED'].includes(status)?100:99);assert.match(saved.raw,/X-KEEP:preserved/);
    const reread=client.calendarRecords(saved.raw,`${server}/item.ics`,saved.etag,collection,new Date(0),new Date('2100-01-01'))[0];
    assert.equal(reread.status,status);assert.equal(reread.completed,status==='COMPLETED','Cancelled remains cancelled even at 100% progress');
  }
  await assert.rejects(client.updateTaskStatus({status:'TODO'},record),/native task status/);
  await assert.rejects(client.updateTaskStatus({status:'COMPLETED',etag:'"stale"'},record),/version changed/);
});

test('native task status changes preserve partial progress across waiting, cancellation and reopening', async()=>{
  let native=ics(['BEGIN:VTODO','UID:progress','SUMMARY:Partly finished','STATUS:IN-PROCESS','PERCENT-COMPLETE:40','DESCRIPTION:Keep my work','DUE:20261120T100000Z','X-KEEP:preserved','END:VTODO']);
  let version=1;
  const {client,calls}=fixture((url,options)=>{
    assert.equal(options.method,'PUT');assert.equal(options.headers['If-Match'],`"v${version}"`);
    native=options.body;return reply('',{ETag:`"v${++version}"`});
  });
  const collection={id:'list',source:'tasks'};
  let record=client.calendarRecords(native,`${server}/progress.ics`,'"v1"',collection,new Date(0),new Date('2100-01-01'))[0];
  for(const [status,percent] of [['NEEDS-ACTION',40],['CANCELLED',40],['IN-PROCESS',40],['COMPLETED',100],['IN-PROCESS',99],['NEEDS-ACTION',99]]){
    const saved=await client.updateTaskStatus({status,etag:record.etag},record);
    record=client.calendarRecords(saved.raw,`${server}/progress.ics`,saved.etag,collection,new Date(0),new Date('2100-01-01'))[0];
    assert.equal(record.status,status);assert.equal(record.percentComplete,percent);assert.equal(record.completed,status==='COMPLETED');
    assert.equal(record.body,'Keep my work');assert.match(saved.raw,/X-KEEP:preserved/);assert.match(saved.raw,/DUE:20261120T100000Z/);
  }
  assert.equal(calls.length,6);
});

test('starting an untouched task writes nonzero native progress without inventing completion', async()=>{
  const {client}=fixture(()=>reply('',{ETag:'"v2"'}));
  const collection={id:'list',source:'tasks'};
  const raw=ics(['BEGIN:VTODO','UID:start','SUMMARY:Start work','STATUS:NEEDS-ACTION','END:VTODO']);
  const record=client.calendarRecords(raw,`${server}/start.ics`,'"v1"',collection,new Date(0),new Date('2100-01-01'))[0];
  const saved=await client.updateTaskStatus({status:'IN-PROCESS'},record);
  const todo=new ICAL.Component(ICAL.parse(saved.raw)).getFirstSubcomponent('vtodo');
  assert.equal(todo.getFirstPropertyValue('percent-complete'),1);assert.equal(todo.hasProperty('completed'),false);
});

test('source and item colors remain distinct; task tag colors use source-scoped synced metadata',()=>{
  const record={id:'task',source:'tasks',collectionId:'list',color:'#123456',tags:['Later']};
  const collections=[{id:'list',color:'#0082c9'}];
  const workspace={properties:{'tag-colors':{[tagColorKey('list','Later')]:'#ffee00',[tagColorKey('other','Later')]:'#ff0000'}}};
  assert.equal(sourceColor(record,collections),'#0082c9');assert.equal(itemColor(record,collections),'#123456');
  assert.equal(itemColor({...record,color:''},collections),'#0082c9');assert.equal(recordTags(record,workspace)[0].color,'#ffee00');
  assert.equal(recordTags({...record,source:'deck',tagDetails:[{id:'8',title:'Later',color:'#55cc77'}]},workspace)[0].color,'#55cc77');
  assert.equal(itemColor({...record,color:'url(https://bad)'},collections),'#0082c9');
});
