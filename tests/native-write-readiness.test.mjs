import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '../packages/nextcloud/src/nextcloud.mjs';
import {nativePermissionResponse} from './native-permission-fixtures.mjs';

const server='https://cloud.example.test',root=server+'/remote.php/dav/calendars/alex/work/';
const calendar={id:'work',source:'calendar',title:'Work',readonly:false,remote:{href:root}};
const input={title:'Review',start:'2026-11-20T09:00:00Z',end:'2026-11-20T10:00:00Z'};
const board={id:'deck-work',source:'deck',title:'Work',readonly:false,stacks:[{id:'3',title:'To do'}],remote:{nativeId:2}};
const json=value=>new Response(JSON.stringify(value));
function fixture(handler){const calls=[];const client=new NextcloudClient({serverUrl:server,username:'alex'},{authentication:'delegated',fetch:async(url,options)=>{calls.push({url,...options});return handler(url,options)}});return {client,calls};}

test('ordinary event creation validates one selected collection without scanning calendar bodies',async()=>{
  const {client,calls}=fixture((url,options)=>{
    if(options.method==='PROPFIND'){assert.equal(url,root);assert.equal(options.headers.Depth,'0');return nativePermissionResponse(url,options)}
    assert.equal(options.method,'PUT');assert.equal(options.headers['If-None-Match'],'*');return new Response(null,{status:201,headers:{ETag:'"created"'}});
  });
  const saved=await client.createEvent(input,calendar);
  assert.ok(saved.href.startsWith(root));assert.deepEqual(calls.map(call=>call.method),['PROPFIND','PUT']);
});

test('fresh missing, revoked or foreign DAV authority never reaches a create mutation',async()=>{
  for(const variant of ['denied','missing','foreign','readonly','wrong-component']){
    const {client,calls}=fixture(async(url,options)=>{
      assert.equal(options.method,'PROPFIND');
      if(variant==='denied')return new Response('',{status:403});
      let raw=await nativePermissionResponse(url,options).text();
      if(variant==='missing')raw='<d:multistatus xmlns:d="DAV:"/>';
      if(variant==='foreign')raw=raw.replace(root,server+'/remote.php/dav/calendars/alex/other/');
      if(variant==='readonly')raw=raw.replace('<d:write-content/>','<d:read/>');
      if(variant==='wrong-component')raw=raw.replace('<c:comp name="VEVENT"/>','');
      return new Response(raw,{status:207});
    });
    await assert.rejects(client.createEvent(input,calendar),error=>{
      assert.equal(error.code,'PERMISSION');
      assert.deepEqual(error.nativePermissionDenied,['denied','readonly'].includes(variant)?{source:'calendar',collectionId:calendar.id}:undefined);
      return true;
    });assert.equal(calls.length,1);
  }
  const unsafe=fixture(()=>assert.fail('Unsafe target must not send credentials'));
  await assert.rejects(unsafe.client.createEvent(input,{...calendar,remote:{href:'https://other.example.test/calendar/'}}),{code:'SECURITY'});
  assert.equal(unsafe.calls.length,0);
});

test('Deck creation verifies native board permission and chosen stack before POST',async()=>{
  for(const variant of ['revoked','unknown-permission','archived','moved-stack','deleted-stack','wrong-board']){
    const {client,calls}=fixture((url,options)=>{
      assert.ok(!options.method,'No mutation may follow failed authority');
      if(url.endsWith('/boards/2'))return json({id:variant==='wrong-board'?8:2,permissions:variant==='unknown-permission'?{}:{PERMISSION_EDIT:variant!=='revoked'},archived:variant==='archived'});
      assert.ok(url.endsWith('/boards/2/stacks/3'));
      return json({id:3,boardId:variant==='moved-stack'?9:2,deletedAt:variant==='deleted-stack'?123:0});
    });
    await assert.rejects(client.createCard({title:'Review',stackId:'3'},board),error=>{
      assert.equal(error.code,variant==='wrong-board'?'FORMAT':'PERMISSION');
      assert.deepEqual(error.nativePermissionDenied,['revoked','archived'].includes(variant)?{source:'deck',collectionId:board.id}:undefined);
      return true;
    });
    assert.equal(calls.length,['revoked','unknown-permission','archived','wrong-board'].includes(variant)?1:2);
  }
});

test('complete Deck authority publishes before stack content and omits removed boards and uncertified stacks',async()=>{
  let boards=[{id:2,title:'Work',permissions:{PERMISSION_EDIT:true}},{id:3,title:'Readonly',permissions:{PERMISSION_EDIT:false}},{id:4,title:'Archived',archived:true,permissions:{PERMISSION_EDIT:true}}];
  const notifications=[];
  const {client}=fixture(url=>{
    if(url.endsWith('/boards?details=true'))return json(boards);
    assert.equal(notifications.length,1,'board permissions publish before a stack scan');
    assert.ok(url.endsWith('/stacks'));return json([]);
  });
  client.discovered=true;client.refreshCapabilities=async()=>false;
  const result=await client.readAll({sources:['deck'],onCollections:value=>notifications.push(value)});
  assert.deepEqual(notifications[0].sources,['deck']);assert.equal(notifications[0].collections.length,2);
  assert.equal(notifications[0].collections[0].readonly,false);assert.equal(notifications[0].collections[1].readonly,true);
  assert.ok(notifications[0].collections.every(collection=>!Object.hasOwn(collection,'stacks')));
  assert.equal(result.statuses[0].state,'connected');
  boards=[];notifications.length=0;await client.readAll({sources:['deck'],onCollections:value=>notifications.push(value)});
  assert.deepEqual(notifications,[{sources:['deck'],collections:[]}],'successful absence revokes old board membership');
});

test('Deck description uses card authority when explicit, otherwise checks current board permission',async()=>{
  const snapshot={id:7,stackId:3,title:'Work',description:'Original',type:'plain',owner:'alex',order:1,lastModified:123,done:null,startdate:null,duedate:null,color:null};
  const record={id:'card',source:'deck',collectionId:board.id,readonly:false,remote:{nativeId:7,boardId:2,stackId:3,snapshot}};
  for(const permission of [true,undefined]){
    const {client,calls}=fixture((url,options)=>{
      if(url.endsWith('/boards/2'))return json({id:2,permissions:{PERMISSION_EDIT:true}});
      if(options.method==='PUT')return json({...snapshot,...JSON.parse(options.body)});
      return new Response(JSON.stringify({...snapshot,...(permission?{permissions:{PERMISSION_EDIT:true}}:{})}),{headers:{ETag:'"fresh"'}});
    });
    const result=await client.updateDescription({description:'- [x] Reviewed'},record);
    assert.equal(result.description,'- [x] Reviewed');assert.equal(calls.length,permission?2:3);
    assert.equal(calls.at(-1).headers['If-Match'],'"fresh"');
  }
  const denied=fixture(url=>json(url.endsWith('/boards/2')?{id:2,permissions:{PERMISSION_EDIT:false}}:snapshot));
  await assert.rejects(denied.client.updateDescription({description:'New'},record),error=>{
    assert.equal(error.code,'PERMISSION');assert.deepEqual(error.nativePermissionDenied,{source:'deck',collectionId:record.collectionId});return true;
  });
  assert.ok(denied.calls.every(call=>call.method!=='PUT'));
});

test('permission loss evidence is scoped to exact current destination responses, never local restrictions',async()=>{
  const denied=fixture(()=>new Response('',{status:403}));
  await assert.rejects(denied.client.createCard({title:'Review',stackId:'3'},board),error=>{
    assert.deepEqual(error.nativePermissionDenied,{source:'deck',collectionId:board.id});return true;
  });
  const local=fixture(()=>assert.fail('Local restrictions do not issue a request'));
  await assert.rejects(local.client.createCard({title:'Review',stackId:'3'},{...board,readonly:true}),error=>{
    assert.equal(error.code,'VALIDATION');assert.equal(error.nativePermissionDenied,undefined);return true;
  });
  await assert.rejects(local.client.updateDescription({description:'New'},{id:'card',source:'deck',readonly:true}),error=>{
    assert.equal(error.nativePermissionDenied,undefined);return true;
  });
  const unknown=fixture(()=>new Response('',{status:503}));
  await assert.rejects(unknown.client.createEvent(input,calendar),error=>{
    assert.equal(error.code,'NEXTCLOUD');assert.equal(error.nativePermissionDenied,undefined);return true;
  });
});
