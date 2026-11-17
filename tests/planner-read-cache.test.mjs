import test from 'node:test'
import assert from 'node:assert/strict'
import {NextcloudClient} from '@nextspace/nextcloud-client'
import {FolderWorkspaceClient,splitWorkspace} from '@nextspace/nextcloud-client/planner-folder.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'

const SERVER='https://cloud.example.test',ROOT='/remote.php/dav/files/tester/Workspace/Nextspace',LEGACY='/remote.php/dav/files/tester/Workspace/planner.json'
const GENERATION='data-00000000-0000-4000-8000-000000000000'
const clone=value=>structuredClone(value)
const response=(body='',status=200,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers})
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const row=(path,etag,collection=false)=>`<d:response><d:href>${xml(path)}</d:href><d:propstat><d:prop><d:resourcetype>${collection?'<d:collection/>':''}</d:resourcetype>${etag?`<d:getetag>${xml(etag)}</d:getetag>`:''}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const dav=rows=>response(`<d:multistatus xmlns:d="DAV:">${rows}</d:multistatus>`,207)
function world(){
  const files=new Map(),calls=[],directories=new Set();let sequence=0
  const set=(path,document,etag=`"file-${++sequence}"`)=>{
    const body=JSON.stringify(document);files.set(path,{body,etag})
    for(let parent=path.slice(0,path.lastIndexOf('/'));parent;parent=parent.slice(0,parent.lastIndexOf('/')))directories.add(parent)
  }
  const api={files,calls,set,directories,before:null,davEtag:undefined,deny:false,putEtag:true}
  const makeClient=()=>{const client=new NextcloudClient({serverUrl:SERVER,username:'tester',appPassword:'fixture-only'},{fetch:async(url,options)=>{
    const path=new URL(url).pathname.replace(/\/$/,''),method=options.method||'GET';calls.push({path,method,headers:options.headers})
    await api.before?.(path,options)
    if(api.deny)return response('',403)
    const entry=files.get(path)
    if(method==='PROPFIND'){
      if(options.headers.Depth==='0')return entry?dav(row(path,api.davEtag===undefined?entry.etag:api.davEtag)):directories.has(path)?dav(row(path,'"directory"',true)):response('',404)
      if(!directories.has(path))return response('',404)
      const prefix=path+'/'
      return dav(row(path,'"directory"',true)+[...directories].filter(child=>child.startsWith(prefix)&&!child.slice(prefix.length).includes('/')).map(child=>row(child,'"directory"',true)).join('')+[...files].filter(([child])=>child.startsWith(prefix)&&!child.slice(prefix.length).includes('/')).map(([child,value])=>row(child,value.etag)).join(''))
    }
    if(method==='MKCOL'){if(directories.has(path))return response('',405);directories.add(path);return response('',201)}
    if(method==='PUT'){
      if(options.headers['If-None-Match']==='*'&&entry||options.headers['If-Match']&&options.headers['If-Match']!==entry?.etag)return response('',412)
      set(path,JSON.parse(options.body));return response('',201,api.putEtag?{ETag:files.get(path).etag}:{})
    }
    assert.equal(method,'GET')
    if(!entry)return response('',404)
    if(options.headers['If-Match']&&options.headers['If-Match']!==entry.etag)return response('',412)
    return response(entry.body,200,{ETag:entry.etag})
  }});client.discovered=true;return client}
  api.makeClient=makeClient;api.client=makeClient();return api
}

test('warm planner JSON reads verify fresh exact DAV revisions without redownloading bodies',async()=>{
  const f=world(),path=ROOT+'/manifest.json',document={value:'x'.repeat(2*1024*1024)};f.set(path,document)
  const first=await f.client.readPlannerFile('manifest.json');first.document.value='caller changed this'
  const second=await f.client.readPlannerFile('manifest.json')
  assert.deepEqual(second.document,document)
  assert.deepEqual(f.calls.map(call=>call.method),['GET','PROPFIND'])
  assert.equal(f.calls[1].headers.Depth,'0')
  f.set(path,{value:'new'})
  assert.deepEqual((await f.client.readPlannerFile('manifest.json')).document,{value:'new'})
  assert.deepEqual(f.calls.slice(-2).map(call=>call.method),['PROPFIND','GET'])
})

test('legacy import bodies reuse strong versions but weak or missing validators still read fully',async()=>{
  const f=world(),workspace=createPlannerWorkspace();f.set(LEGACY,workspace)
  await f.client.readWorkspace({requireVersion:false});await f.client.readWorkspace({requireVersion:false})
  assert.deepEqual(f.calls.map(call=>call.method),['GET','PROPFIND'])
  for(const etag of [null,'W/"weak"']){
    f.davEtag=etag
    assert.deepEqual((await f.client.readWorkspace({requireVersion:false})).workspace,workspace)
    assert.deepEqual(f.calls.slice(-2).map(call=>call.method),['PROPFIND','GET'])
  }
})

test('cached planner bodies cannot conceal removal, replacement directories or denied access',async()=>{
  for(const failure of ['missing','directory','denied']){
    const f=world(),path=ROOT+'/manifest.json';f.set(path,{value:'saved'});await f.client.readPlannerFile('manifest.json')
    if(failure==='denied')f.deny=true
    else{f.files.delete(path);if(failure==='directory')f.directories.add(path)}
    if(failure==='denied')await assert.rejects(f.client.readPlannerFile('manifest.json'),{code:'PERMISSION'})
    else if(failure==='missing')assert.deepEqual(await f.client.readPlannerFile('manifest.json'),{document:null,etag:null})
    else await assert.rejects(f.client.readPlannerFile('manifest.json'),{code:'FORMAT'})
    f.deny=false;f.directories.delete(path);f.set(path,{value:'restored'});assert.deepEqual((await f.client.readPlannerFile('manifest.json')).document,{value:'restored'})
  }
})

test('successful planner writes invalidate old cached bodies and retain required readback',async()=>{
  const f=world(),path=ROOT+'/manifest.json';f.set(path,{value:'before'});await f.client.readPlannerFile('manifest.json');f.putEtag=false
  const saved=await f.client.writePlannerFile('manifest.json',{value:'after'},f.files.get(path).etag)
  assert.equal(saved.etag,f.files.get(path).etag)
  const put=f.calls.findIndex(call=>call.method==='PUT')
  assert.equal(f.calls[put+1].method,'GET','readback cannot reuse a pre-write cache entry')
  assert.deepEqual((await f.client.readPlannerFile('manifest.json')).document,{value:'after'})
})

test('a write racing cached verification cannot return the old cached document',async()=>{
  const f=world(),path=ROOT+'/manifest.json';f.set(path,{value:'before'});await f.client.readPlannerFile('manifest.json')
  let release,entered
  const waiting=new Promise(resolve=>{entered=resolve}),blocked=new Promise(resolve=>{release=resolve})
  const properties=f.client.plannerDavProperties.bind(f.client)
  f.client.plannerDavProperties=async url=>{const previous=await properties(url);if(new URL(url).pathname===path){entered();await blocked}return previous}
  const reading=f.client.readPlannerFile('manifest.json');await waiting
  await f.client.writePlannerFile('manifest.json',{value:'after'},f.files.get(path).etag)
  release();assert.deepEqual((await reading).document,{value:'after'})
})

test('planner JSON cache is account-instance private and bounded by entry count and bytes',async()=>{
  const f=world();for(let i=0;i<33;i++){f.set(`${ROOT}/file-${i}.json`,{i});await f.client.readPlannerFile(`file-${i}.json`)}
  const before=f.calls.length;await f.client.readPlannerFile('file-0.json');assert.equal(f.calls[before].method,'GET','oldest of more than32 entries is evicted')
  await f.makeClient().readPlannerFile('file-32.json');assert.equal(f.calls.at(-1).method,'GET','another account/client instance has no inherited cache')
  const big={body:'x'.repeat(6*1024*1024)}
  for(let i=0;i<3;i++){f.set(`${ROOT}/big-${i}.json`,big);await f.client.readPlannerFile(`big-${i}.json`)}
  const start=f.calls.length;await f.client.readPlannerFile('big-0.json');assert.equal(f.calls[start].method,'GET','16MiB total bound evicts an earlier6MiB body')
})

function folderWorld(){
  const f=world(),workspace=createPlannerWorkspace(),documents=splitWorkspace(workspace)
  for(const [path,document] of documents)f.set(`${ROOT}/${GENERATION}/${path}`,document)
  f.set(LEGACY,workspace)
  f.set(`${ROOT}/${GENERATION}/legacy-import.json`,{format:'nextspace-legacy-import',version:1,workspace})
  f.set(ROOT+'/manifest.json',{format:'nextspace-planner-folder',version:1,generation:GENERATION,createdAt:'2026-01-01T00:00:00Z',required:[...documents.keys()],legacyHash:null})
  return Object.assign(f,{folder:new FolderWorkspaceClient(f.client),workspace})
}

test('real folder reader warm pass uses validators and probes only fresh existing child folders',async()=>{
  const f=folderWorld();await f.folder.readWorkspace();f.calls.length=0
  assert.deepEqual((await f.folder.readWorkspace()).workspace.identities,[])
  assert.equal(f.calls.filter(call=>call.method==='GET').length,0)
  const inventory=f.calls.filter(call=>call.method==='PROPFIND'&&call.headers.Depth==='1')
  assert.deepEqual(inventory.map(call=>call.path),[`${ROOT}/${GENERATION}`,`${ROOT}/${GENERATION}`])
  assert.equal(f.calls.length,5,'manifest/legacy/import validators plus two authoritative root inventories')
  f.workspace.relations.push({id:'fixture-link',type:'reference',fromId:'work',toId:'note'})
  const link=[...splitWorkspace(f.workspace)].find(([path])=>path.startsWith('links/'));f.set(`${ROOT}/${GENERATION}/${link[0]}`,link[1]);f.calls.length=0
  const next=await f.folder.readWorkspace();assert.equal(next.workspace.relations.length,1)
  assert.equal(f.calls.filter(call=>call.method==='PROPFIND'&&call.path.endsWith('/links')).length,2)
  assert.equal(f.calls.some(call=>['plans','properties','workflow','arrangements'].some(name=>call.path.endsWith('/'+name))),false)
})

test('fresh folder inventory changes still trigger a stable read and missing required files fail',async()=>{
  const f=folderWorld();let inventories=0
  f.before=(path,options)=>{
    if(path!==`${ROOT}/${GENERATION}`||options.headers.Depth!=='1'||++inventories!==2)return
    f.workspace.relations.push({id:'added-during-read',type:'reference',fromId:'work',toId:'note'})
    const link=[...splitWorkspace(f.workspace)].find(([name])=>name.startsWith('links/'));f.set(`${ROOT}/${GENERATION}/${link[0]}`,link[1])
  }
  assert.equal((await f.folder.readWorkspace()).workspace.relations[0].id,'added-during-read')
  assert.ok(inventories>=4)
  f.files.delete(`${ROOT}/${GENERATION}/identities.json`)
  await assert.rejects(f.folder.readWorkspace(),{code:'FOLDER_MISSING'})
})

test('cached legacy and import receipts still observe older-client changes and removal',async()=>{
  const f=folderWorld();await f.folder.readWorkspace();await f.folder.readWorkspace()
  const older=clone(f.workspace);older.properties['fixture-work']={estimate:45};f.set(LEGACY,older)
  const updated=await f.folder.readWorkspace();assert.equal(updated.migrate,true);assert.equal(updated.workspace.properties['fixture-work'].estimate,45)
  f.files.delete(`${ROOT}/${GENERATION}/legacy-import.json`)
  await assert.rejects(f.folder.readWorkspace(),{code:'FOLDER_MISSING'})
})
