import test from 'node:test';
import assert from 'node:assert/strict';
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs';

const server = 'https://cloud.example.test';
const reply = (body, status = 200, headers = {}) => new Response([204,205,304].includes(status) ? null : typeof body === 'string' ? body : JSON.stringify(body), {status,headers});
const ocs = data => ({ocs:{meta:{statuscode:200},data}});
const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const resource = (href, props) => `<d:response><d:href>${xml(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const wrap = contents => `<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">${contents}</d:multistatus>`;
const file = (path, id, directory=false) => resource(`/remote.php/dav/files/alex${path}`, `<oc:fileid>${id}</oc:fileid><d:displayname>${xml(path.split('/').at(-1))}</d:displayname><d:resourcetype>${directory?'<d:collection/>':''}</d:resourcetype><d:getcontentlength>20</d:getcontentlength><d:getcontenttype>text/markdown</d:getcontenttype>`);
const tag = ({id,title,assignable=true,color}) => resource(`/remote.php/dav/systemtags/${id}`, `<oc:id>${id}</oc:id><oc:display-name>${xml(title)}</oc:display-name><oc:user-visible>true</oc:user-visible><oc:can-assign>${assignable}</oc:can-assign>${color?`<nc:color>${color}</nc:color>`:''}`);
const card = {id:'card',source:'deck',remote:{nativeId:7,boardId:2,stackId:3,lastModified:1,snapshot:{attachmentCount:1}}};
const note = {id:'note',source:'notes',remote:{nativeId:137,category:'Old category'},etag:'old'};
const attachment = {id:20,type:'file',data:'Renamed note.md',cardId:7,extendedData:{fileid:137,path:'/Notes/New/Renamed note.md',filesize:20,mimetype:'text/markdown'}};
function fixture(handler,options={}) {
  const calls=[];
  const client=new NextcloudClient({serverUrl:server,username:'alex',appPassword:'test-secret'},{...options,fetch:async(url,options)=>{calls.push({url,...options});return handler(new URL(url),options);}});
  return {client,calls};
}

test('Files picker is scoped to authenticated files and rejects path traversal before a request', async()=>{
  const {client,calls}=fixture((url,options)=>{assert.equal(options.method,'PROPFIND');assert.equal(options.headers.Depth,'1');return reply(wrap(file('/Notes',12,true)+file('/Notes/Brief & plan.md',137)),207)});
  const result=await client.listFiles({path:'/Notes'});
  assert.equal(result.path,'/Notes');assert.equal(result.files.length,1);assert.equal(result.files[0].path,'/Notes/Brief & plan.md');assert.equal(result.files[0].directory,false);
  for(const path of ['/../private','https://attacker.test','Notes/../../private','C:\\local.txt','//other','/Notes/./draft','/Notes/\0'])await assert.rejects(client.listFiles({path}),{code:'VALIDATION'});
  assert.equal(calls.length,1);
});

test('Files authorization resolves renamed notes by immutable ID inside the configured Notes subtree without SEARCH',async()=>{
  const {client,calls}=fixture((url,options)=>{
    if(url.pathname.endsWith('/settings'))return reply({notesPath:'Journal'});
    assert.equal(options.method,'PROPFIND');assert.equal(options.headers.Depth,'1');
    if(url.pathname.endsWith('/Journal'))return reply(wrap(file('/Journal',10,true)+file('/Journal/Project',11,true)+file('/Journal/Unrelated.md',99)),207);
    assert.ok(url.pathname.endsWith('/Journal/Project'));
    return reply(wrap(file('/Journal/Project',11,true)+file('/Journal/Project/Renamed.md',137)),207);
  },{fileLookupMode:'notes-propfind'});
  assert.equal((await client.findFileById(137)).path,'/Journal/Project/Renamed.md');
  assert.equal(calls.length,3);assert.ok(calls.every(call=>call.method==='PROPFIND'||call.url.endsWith('/settings')));
});

test('Notes fallback rejects missing, ambiguous, denied or unsafe roots and never guesses by title',async()=>{
  for(const settings of [{},{notesPath:''},{notesPath:'/'},{notesPath:'../Secret'},{notesPath:'https://other.example.test'}]){
    const {client,calls}=fixture(()=>reply(settings),{fileLookupMode:'notes-propfind'});await assert.rejects(client.findFileById(137));assert.equal(calls.length,1);
  }
  for(const rows of [file('/Notes',10,true)+file('/Notes/Same title.md',99),file('/Notes',10,true)+file('/Notes/One.md',137)+file('/Notes/Two.md',137),file('/Notes',10,true)+file('/Elsewhere/Hidden.md',137),file('/Notes',10,true)+'<d:response><d:href>/remote.php/dav/files/alex/Notes/Denied</d:href><d:status>HTTP/1.1 403 Forbidden</d:status></d:response>']){
    const {client,calls}=fixture(url=>url.pathname.endsWith('/settings')?reply({notesPath:'Notes'}):reply(wrap(rows),207),{fileLookupMode:'notes-propfind'});
    await assert.rejects(client.findFileById(137));assert.ok(calls.every(call=>!['SEARCH','POST'].includes(call.method)));
  }
});

test('Notes fallback bounds directories, depth and entries even when an early matching file exists',async()=>{
  for(const limit of ['directories','depth','entries']){
    const {client,calls}=fixture(url=>{
      if(url.pathname.endsWith('/settings'))return reply({notesPath:'Notes'});
      const path=decodeURIComponent(url.pathname.slice('/remote.php/dav/files/alex'.length));
      const rows=file(path,10,true)+(limit==='directories'?Array.from({length:256},(_,i)=>file('/Notes/Folder'+i,100+i,true)).join(''):limit==='entries'?Array.from({length:10000},(_,i)=>file('/Notes/Entry'+i,100+i)).join(''):file(path+'/Deeper',11,true))+file(path+'/Early.md',137);
      return reply(wrap(rows),207);
    },{fileLookupMode:'notes-propfind'});
    await assert.rejects(client.findFileById(137),{code:'LIMIT'});assert.ok(calls.length<=18);
  }
});

test('a Notes-propfind attachment still creates and verifies the native Deck share',async()=>{
  let attached=false;
  const {client,calls}=fixture((url,options)=>{
    if(url.pathname.endsWith('/cards/7'))return reply({id:7,stackId:3,permissions:{PERMISSION_EDIT:true}});
    if(url.pathname.endsWith('/settings'))return reply({notesPath:'Notes'});
    if(options.method==='PROPFIND')return reply(wrap(file('/Notes',10,true)+file('/Notes/Brief.md',137)),207);
    if(url.pathname.endsWith('/attachments'))return reply(attached?[attachment]:[]);
    if(url.pathname.endsWith('/shares')){assert.deepEqual(JSON.parse(options.body),{path:'/Notes/Brief.md',shareType:12,shareWith:'7',permissions:1});attached=true;return reply(ocs({id:20}),201)}
    throw Error('Unexpected request');
  },{fileLookupMode:'notes-propfind'});
  assert.equal((await client.attachDeckFile({note},card)).attachments[0].fileId,'137');assert.equal(calls.some(call=>call.method==='SEARCH'),false);
});

test('Attaching a renamed note resolves its stable file id and creates only a native read-only Deck share', async()=>{
  let attached=false;
  const {client,calls}=fixture((url,options)=>{
    if(options.method==='SEARCH'){assert.match(options.body,/<oc:fileid\/>/);assert.match(options.body,/<d:literal>137<\/d:literal>/);assert.doesNotMatch(options.body,/Old category/);return reply(wrap(file('/Notes/New/Renamed note.md',137)),207)}
    if(url.pathname.endsWith('/attachments'))return reply(attached?[attachment]:[]);
    if(url.pathname.endsWith('/cards/7'))return reply({id:7,stackId:3,permissions:{PERMISSION_EDIT:true}});
    if(url.pathname.endsWith('/shares')){assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{path:'/Notes/New/Renamed note.md',shareType:12,shareWith:'7',permissions:1});attached=true;return reply(ocs({id:20}),201)}
    throw Error(`Unexpected request ${url}`);
  });
  assert.equal((await client.attachDeckFile({note},card)).attachments[0].fileId,'137');
  await client.attachDeckFile({note},card);
  assert.equal(calls.filter(call=>call.method==='POST').length,1,'Retry reuses the existing native share');
  assert.ok(calls.filter(call=>call.url.endsWith('/attachments')).every(call=>call.url.includes('/api/v1.1/')));
});

test('Attachment removal detaches the native file share, never the file or a legacy upload', async()=>{
  let attached=true;
  const {client,calls}=fixture((url,options)=>{
    if(url.pathname.endsWith('/cards/7'))return reply({id:7,stackId:3});
    if(url.pathname.endsWith('/attachments/20')){assert.equal(options.method,'DELETE');assert.equal(url.searchParams.get('type'),'file');attached=false;return reply('',204)}
    if(url.pathname.endsWith('/attachments'))return reply(attached?[attachment]:[]);
    throw Error('Unexpected request');
  });
  assert.deepEqual(await client.removeDeckAttachment({attachmentId:'20'},card),{attachments:[]});
  assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
  assert.ok(!calls.some(call=>call.method==='DELETE'&&call.url.includes('/dav/files/')));
  const legacy=fixture(url=>url.pathname.endsWith('/cards/7')?reply({id:7,stackId:3}):reply([{id:9,type:'deck_file',data:'legacy.txt'}]));
  await assert.rejects(legacy.client.removeDeckAttachment({attachmentId:'9'},card),/legacy attachment/);
  assert.ok(!legacy.calls.some(call=>call.method==='DELETE'));
});

test('Permission denial, missing file identity and folders cannot produce a Deck share', async()=>{
  const readonly=fixture(()=>reply({id:7,stackId:3,permissions:{PERMISSION_EDIT:false}}));
  await assert.rejects(readonly.client.attachDeckFile({note},card),{code:'PERMISSION'});assert.equal(readonly.calls.length,1);
  const folder=fixture(url=>url.pathname.endsWith('/cards/7')?reply({id:7,stackId:3}):reply(wrap(file('/Notes',2,true)),207));
  await assert.rejects(folder.client.attachDeckFile({path:'/Notes'},card),/Choose a file/);assert.ok(!folder.calls.some(call=>call.method==='POST'));
  const absent=fixture(url=>url.pathname.endsWith('/cards/7')?reply({id:7,stackId:3}):reply(wrap(''),207));
  await assert.rejects(absent.client.attachDeckFile({note},card),/could not be found/);assert.ok(!absent.calls.some(call=>call.method==='POST'));
});

test('Deck upload uses native multipart file API with no renderer-selected local path', async()=>{
  const {client,calls}=fixture((url,options)=>{
    if(url.pathname.endsWith('/cards/7'))return reply({id:7,stackId:3});
    if(options.method==='POST'){assert.ok(options.body instanceof FormData);assert.equal(options.body.get('type'),'file');assert.equal(options.body.get('data'),'brief.md');assert.equal(options.body.get('file').name,'brief.md');assert.equal(options.headers['Content-Type'],undefined);return reply(attachment)}
    return reply([attachment]);
  });
  await client.uploadDeckAttachment({name:'brief.md',bytes:Buffer.from('# Brief')},card);
  await assert.rejects(client.uploadDeckAttachment({name:'../unsafe.txt',bytes:Buffer.alloc(1)},card),{code:'VALIDATION'});
  await assert.rejects(client.uploadDeckAttachment({name:'big.bin',bytes:Buffer.alloc(20*1024*1024+1)},card),{code:'VALIDATION'});
  assert.equal(calls.filter(call=>call.method==='POST').length,1);
});

test('Native system tags preserve restricted tags and change only requested assignments',async()=>{
  const tags=[{id:'1',title:'Old'},{id:'2',title:'Managed',assignable:false},{id:'3',title:'Client',color:'aabbcc'}];
  const assigned=new Set(['1','2']);
  const {client,calls}=fixture((url,options)=>{
    if(options.method==='PROPFIND')return reply(wrap((url.pathname.includes('systemtags-relations')?tags.filter(tag=>assigned.has(tag.id)):tags).map(tag).join('')),207);
    if(options.method==='POST'){const body=JSON.parse(options.body);assert.deepEqual(body,{name:'Project brief',userVisible:true,userAssignable:true});tags.push({id:'4',title:body.name});return reply('',201)}
    const id=url.pathname.split('/').at(-1);if(options.method==='PUT')assigned.add(id);else if(options.method==='DELETE')assigned.delete(id);else throw Error('Unexpected request');return reply('',204);
  });
  const result=await client.setNoteTags({tagIds:['3'],newTags:['Project brief']},note);
  assert.deepEqual(result.tags.map(tag=>tag.id),['2','3','4']);assert.equal(result.tags.find(tag=>tag.id==='3').color,'#aabbcc');
  assert.equal(result.tags.find(tag=>tag.id==='2').assignable,false);
  assert.ok(!calls.some(call=>call.method==='DELETE'&&call.url.endsWith('/2')));
  assert.ok(calls.filter(call=>call.method==='DELETE').every(call=>call.url.includes('/systemtags-relations/files/137/')));
});

test('Unknown and unassignable native system tags fail before mutation',async()=>{
  const {client,calls}=fixture(url=>reply(wrap(url.pathname.includes('systemtags-relations')?'':tag({id:'2',title:'Managed',assignable:false})),207));
  await assert.rejects(client.setNoteTags({tagIds:['2']},note),{code:'PERMISSION'});
  await assert.rejects(client.setNoteTags({tagIds:['1000']},note),{code:'PERMISSION'});
  assert.ok(calls.every(call=>call.method==='PROPFIND'));
});

test('Native note category writes use conditional Notes API and retain file identity and loaded system tags',async()=>{
  const {client}=fixture((url,options)=>{
    if(options.method==='PROPFIND')return reply(wrap(tag({id:'3',title:'Client'})),207);
    assert.equal(options.headers['If-Match'],'"old"');assert.equal(JSON.parse(options.body).category,'New/Client');
    return reply({id:137,title:'Brief',content:'# Text',category:'New/Client',etag:'new'});
  });
  await client.readNoteTags(note);
  const saved=await client.updateNote({title:'Brief',content:'# Text',category:'New/Client'},note);
  const record=await client.savedRecord(note,{source:'notes'},saved);
  assert.equal(record.fileId,'137');assert.equal(record.collectionTitle,'New/Client');assert.equal(record.tagDetails[0].title,'Client');
});

test('Related resources uses native board/file recommendations and filters unsafe result URLs',async()=>{
  const {client,calls}=fixture(()=>reply(ocs([{providerId:'files',itemId:'137',title:'Notes',subtitle:'Files',url:'/index.php/f/137'},{title:'Unsafe',url:'https://attacker.test/private'},{title:'Script',url:'javascript:alert(1)'}])));
  assert.deepEqual(await client.readRelatedResources(card),{available:true,resources:[{providerId:'files',itemId:'137',title:'Notes',subtitle:'Files',url:`${server}/index.php/f/137`}]});
  await client.readRelatedResources(note);
  assert.ok(calls[0].url.includes('/related/deck/2?'));assert.ok(calls[1].url.includes('/related/files/137?'));
  assert.deepEqual(await client.readRelatedResources({source:'tasks'}),{available:false,resources:[]});
  const unavailable=fixture(()=>reply('',404));assert.deepEqual(await unavailable.client.readRelatedResources(card),{available:false,resources:[]});
});

test('Deck refresh hydrates note file identities only when attachments exist and caches unchanged cards briefly',async()=>{
  let attachmentReads=0;
  const {client}=fixture(url=>{
    if(url.pathname.endsWith('/boards'))return reply([{id:2,title:'Work',permissions:{PERMISSION_EDIT:true}}]);
    if(url.pathname.endsWith('/stacks'))return reply([{id:3,title:'Doing',cards:[{id:7,title:'Has note',lastModified:1,attachmentCount:1},{id:8,title:'Empty',lastModified:1,attachmentCount:0}]}]);
    attachmentReads++;return reply([attachment]);
  });
  const first=await client.readDeck();assert.deepEqual(first.records[0].attachmentFileIds,['137']);assert.deepEqual(first.records[1].attachmentFileIds,[]);
  await client.readDeck();assert.equal(attachmentReads,1);
});

test('A late attachment read cannot replace a newer attachment snapshot',async()=>{
  let release,first=true;
  const held=new Promise(resolve=>release=resolve);
  const {client}=fixture(async()=>{if(first){first=false;await held;return reply([])}return reply([attachment])});
  const stale=client.readDeckAttachments(card);
  assert.equal((await client.readDeckAttachments(card)).attachments.length,1);
  release();assert.equal((await stale).attachments.length,1);
});

test('A late tag read cannot replace newer native tag assignments',async()=>{
  let release,first=true;
  const held=new Promise(resolve=>release=resolve);
  const {client}=fixture(async url=>{if(url.pathname.includes('systemtags-relations')&&first){first=false;await held;return reply(wrap(''),207)}return reply(wrap(tag({id:'3',title:'Current'})),207)});
  const stale=client.readNoteTags(note);
  assert.equal((await client.readNoteTags(note)).tags[0].title,'Current');release();
  assert.equal((await stale).tags[0].title,'Current');
});

test('Unavailable optional native metadata reports stale data without disabling source editing',async()=>{
  const {client}=fixture(url=>{
    if(url.pathname.endsWith('/notes'))return reply([{id:137,title:'A note',content:'Text',etag:'version'}]);
    if(url.pathname.endsWith('/boards'))return reply([{id:2,title:'Work',permissions:{PERMISSION_EDIT:true}}]);
    if(url.pathname.endsWith('/stacks'))return reply([{id:3,title:'Doing',cards:[{id:7,title:'Has note',attachmentCount:1}]}]);
    return reply('',503);
  });
  client.primeFileMetadata([{...note,fileTags:[{id:'3',title:'Cached',assignable:true}]}]);
  const notes=await client.readNotes();assert.equal(notes.metadataStale,true);assert.equal(notes.warning,undefined);assert.equal(notes.records[0].fileTags[0].title,'Cached');
  const deck=await client.readDeck();assert.equal(deck.metadataStale,true);assert.equal(deck.warning,undefined);assert.equal(deck.records[0].attachmentFileIds,undefined);assert.equal(deck.records[0].readonly,false);
});
