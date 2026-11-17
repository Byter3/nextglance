import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs';

const SERVER='https://fixture.invalid',ROOT='/remote.php/dav/files/tester/Workspace/Nextspace';
const reply=(body='',status=200,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers});
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const entry=(path,etag='"v1"',collection=false)=>`<d:response><d:href>${escape(path)}</d:href><d:propstat><d:prop><d:resourcetype>${collection?'<d:collection/>':''}</d:resourcetype>${etag?`<d:getetag>${escape(etag)}</d:getetag>`:''}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const dav=rows=>reply(`<d:multistatus xmlns:d="DAV:">${rows}</d:multistatus>`,207,{'Content-Type':'application/xml'});
function fixture(handler){
  const calls=[];
  const client=new NextcloudClient({serverUrl:SERVER,username:'tester',appPassword:'fixture-only'},{fetch:async(url,options)=>{calls.push({url,...options});return handler(new URL(url).pathname,options)}});
  client.discovered=true;
  return {client,calls};
}
const document={format:'fixture',value:{one:1,two:2}};
const workspace={schemaVersion:2,spaces:[],projects:[],relations:[]};

test('planner folder lists only immediate safe children and uses canonical DAV versions',async()=>{
  const {client,calls}=fixture((path,options)=>{
    assert.equal(options.method,'PROPFIND');assert.equal(options.headers.Depth,'1');
    return dav(entry(ROOT,'"root"',true)+entry(`${ROOT}/manifest.json`,'"manifest"')+entry(`${ROOT}/data-example`,'"dir"',true));
  });
  assert.deepEqual(await client.listPlannerFiles(),{exists:true,files:[{path:'manifest.json',etag:'"manifest"',collection:false},{path:'data-example',etag:'"dir"',collection:true}]});
  assert.equal(calls.length,1);
});

test('planner folder distinguishes missing directories from incomplete or unsafe listings',async()=>{
  assert.deepEqual(await fixture(()=>reply('',404)).client.listPlannerFiles(),{exists:false,files:[]});
  for(const [body,code] of [[entry(`${ROOT}/manifest.json`),'FORMAT'],[entry(ROOT,'"r"',true)+entry('/outside.json'),'SECURITY'],[entry(ROOT,'"r"',true)+entry(`${ROOT}/links%2Fsecret.json`),'SECURITY'],[entry(ROOT,'"r"',true)+entry(`${ROOT}/x.json`)+entry(`${ROOT}/x.json`),'FORMAT'],[entry(ROOT,'"r"',true)+entry('https://evil.invalid/x.json'),'SECURITY']]){
    await assert.rejects(fixture(()=>dav(body)).client.listPlannerFiles(),{code});
  }
});

test('planner file paths cannot escape the fixed metadata root',async()=>{
  const {client,calls}=fixture(()=>assert.fail('Unsafe paths must be rejected before requests'));
  for(const path of ['../planner.json','/absolute.json','data-x/../x.json','data-x%2fsecret/x.json','data-x\\x.json','https://evil.invalid/x.json','x.txt','a//x.json']){
    await assert.rejects(client.readPlannerFile(path),{code:'VALIDATION'});
    await assert.rejects(client.writePlannerFile(path,document),{code:'VALIDATION'});
  }
  assert.equal(calls.length,0);
});

test('planner file creation is conditional and parent creation is cached',async()=>{
  const {client,calls}=fixture((path,options)=>{
    if(options.method==='MKCOL')return reply('',201);
    assert.equal(options.method,'PUT');assert.equal(options.headers['If-None-Match'],'*');assert.equal(options.headers['If-Match'],undefined);
    return reply('',201,{ETag:'"saved"'});
  });
  assert.deepEqual(await client.writePlannerFile('data-a/links/a.json',document),{etag:'"saved"'});
  await client.writePlannerFile('data-a/links/b.json',document);
  assert.equal(calls.filter(call=>call.method==='MKCOL').length,4);
  assert.equal(calls.filter(call=>call.method==='PUT').length,2);
  assert.ok(calls.every(call=>!['DELETE','MOVE'].includes(call.method)));
});

test('planner updates retain strong ETags exactly and refuse weak or wildcard writes',async()=>{
  const {client,calls}=fixture((path,options)=>options.method==='MKCOL'?reply('',201):(assert.equal(options.headers['If-Match'],'"exact-version"'),reply('',200,{ETag:'"next"'})));
  for(const etag of ['W/"weak"','*','unquoted','"one", "two"'])await assert.rejects(client.writePlannerFile('manifest.json',document,etag),{code:'ETAG_UNAVAILABLE'});
  assert.equal(calls.length,0);
  assert.deepEqual(await client.writePlannerFile('manifest.json',document,'"exact-version"'),{etag:'"next"'});
});

test('weak GET versions recover through conditional DAV-checked body reads',async()=>{
  const {client,calls}=fixture((path,options)=>{
    if(options.method==='PROPFIND')return dav(entry(path,'"canonical"'));
    assert.equal(options.headers['Accept-Encoding'],'identity');
    if(calls.filter(call=>!call.method).length===2)assert.equal(options.headers['If-Match'],'"canonical"');
    return reply(document,200,{ETag:'W/"proxy"'});
  });
  assert.deepEqual(await client.readPlannerFile('data-a/settings.json'),{document,etag:'"canonical"'});
  assert.equal(calls.filter(call=>call.method==='PROPFIND').length,2);
  assert.equal(calls.filter(call=>!call.method).length,2);
});

test('compressed GET representation ETags are not reused as file overwrite versions',async()=>{
  const {client}=fixture((path,options)=>options.method==='PROPFIND'?dav(entry(path,'"file"')):reply(document,200,{ETag:'"file-gzip"','Content-Encoding':'gzip'}));
  assert.equal((await client.readPlannerFile('manifest.json')).etag,'"file"');
});

test('DAV version recovery retries a concurrent change without pairing an old body with a new version',async()=>{
  let reads=0,properties=0;
  const {client}=fixture((path,options)=>{
    if(options.method==='PROPFIND'){properties++;return dav(entry(path,properties===1?'"old"':'"new"'))}
    reads++;return reply({generation:reads===3?'new':'old'},200,{ETag:'W/"proxy"'});
  });
  assert.deepEqual(await client.readPlannerFile('manifest.json'),{document:{generation:'new'},etag:'"new"'});
  assert.equal(reads,3);assert.equal(properties,4);
});

test('unavailable versions produce an explicit diagnostic instead of a false concurrent-edit conflict',async()=>{
  const {client}=fixture((path,options)=>options.method==='PROPFIND'?dav(entry(path,null)):reply(workspace));
  assert.deepEqual(await client.readPlannerFile('manifest.json'),{document:workspace,etag:null});
  await assert.rejects(client.readWorkspace(),{code:'ETAG_UNAVAILABLE'});
});

test('legacy read-only import accepts missing or weak versions without writing or probing DAV',async()=>{
  for(const etag of [null,'W/"proxy"']){
    const {client,calls}=fixture((path,options)=>{assert.equal(options.method,undefined);return reply(workspace,200,etag?{ETag:etag}:{})});
    assert.deepEqual(await client.readWorkspace({requireVersion:false}),{workspace,etag:null});
    assert.equal(calls.length,1);
  }
});

test('planner conditional conflicts never fall back to unconditional writes',async()=>{
  const {client,calls}=fixture((path,options)=>options.method==='MKCOL'?reply('',201):reply('',412));
  await assert.rejects(client.writePlannerFile('manifest.json',document,'"old"'),{code:'CONFLICT',status:412});
  assert.equal(calls.filter(call=>call.method==='PUT').length,1);
  assert.equal(calls.find(call=>call.method==='PUT').headers['If-Match'],'"old"');
});

test('missing PUT ETags require matching readback and a usable file version',async()=>{
  const {client}=fixture((path,options)=>{
    if(options.method==='MKCOL')return reply('',201);
    if(options.method==='PUT')return reply('',201);
    if(options.method==='PROPFIND')return dav(entry(path,'"saved"'));
    return reply({value:{two:2,one:1},format:'fixture'},200,{ETag:'W/"proxy"'});
  });
  assert.deepEqual(await client.writePlannerFile('manifest.json',document),{etag:'"saved"'});
  const changed=fixture((path,options)=>options.method==='MKCOL'?reply('',201):options.method==='PUT'?reply('',201):reply({changed:true},200,{ETag:'"other"'}));
  await assert.rejects(changed.client.writePlannerFile('manifest.json',document),{code:'CONFLICT',status:412});
  const versionless=fixture((path,options)=>options.method==='MKCOL'?reply('',201):options.method==='PUT'?reply('',201):options.method==='PROPFIND'?dav(entry(path,null)):reply(document));
  await assert.rejects(versionless.client.writePlannerFile('manifest.json',document),{code:'ETAG_UNAVAILABLE'});
});

test('existing planner parents are verified as directories and creation errors stay distinct from edit races',async()=>{
  const {client}=fixture((path,options)=>options.method==='MKCOL'?reply('',405):options.method==='PROPFIND'?dav(entry(path,'"dir"',true)):reply('',201,{ETag:'"saved"'}));
  await client.writePlannerFile('manifest.json',document);
  const file=fixture((path,options)=>options.method==='MKCOL'?reply('',405):dav(entry(path,'"file"',false)));
  await assert.rejects(file.client.writePlannerFile('manifest.json',document),{code:'STORAGE_LAYOUT'});
  await assert.rejects(fixture(()=>reply('',409)).client.writePlannerFile('manifest.json',document),{code:'STORAGE_LAYOUT',status:409});
});

test('removed cached parents are retried once while preserving the exact conditional PUT',async()=>{
  let writes=0;
  const {client,calls}=fixture((path,options)=>{
    if(options.method==='MKCOL')return reply('',201);
    if(++writes===2)return reply('',409);
    return reply('',201,{ETag:'"saved"'});
  });
  await client.writePlannerFile('data-a/settings.json',document);
  await client.writePlannerFile('data-a/settings.json',document,'"saved"');
  assert.equal(writes,3);
  assert.equal(calls.filter(call=>call.method==='MKCOL').length,6);
  assert.deepEqual(calls.filter(call=>call.method==='PUT').slice(1).map(call=>call.headers['If-Match']),['"saved"','"saved"']);
});
