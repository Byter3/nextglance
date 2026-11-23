import test from 'node:test'
import assert from 'node:assert/strict'
import {createWebController} from '../src/session-controller.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {splitWorkspace} from '@nextspace/nextcloud-client/planner-folder.mjs'

// Exercise the actual controller, portable native client and folder protocol.
// Only the HTTP boundary is fake: no application-service methods are replaced.
const origin='https://cloud.example.test',base='/cloud',serverUrl=origin+base
const sessionUrl=`${serverUrl}/apps/nextglance/session`
const user='example-user',generation='data-11111111-1111-4111-8111-111111111111'
const folder=`${base}/remote.php/dav/files/${user}/Workspace/Nextspace/`
const notePath=`${base}/index.php/apps/notes/api/v1/notes/12`
const xmlEscape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
const row=(href,properties)=>`<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const xml=rows=>new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${rows}</d:multistatus>`,{status:207,headers:{'Content-Type':'application/xml'}})
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}})
const ocs=data=>json({ocs:{meta:{status:'ok',statuscode:100},data}})

function httpFixture({withDeck=false}={}){
  const requests=[],unexpected=[],files=new Map();let version=1
  const workspace=createPlannerWorkspace();workspace.name='Example planning'
  const documents=splitWorkspace(workspace)
  const put=(path,document)=>files.set(path,{document:structuredClone(document),etag:`"file-${version++}"`})
  put(folder+'manifest.json',{format:'nextspace-planner-folder',version:1,generation,createdAt:'2026-11-14T10:00:00Z',required:[...documents.keys()],legacyHash:null})
  put(`${folder}${generation}/legacy-import.json`,{format:'nextspace-legacy-import',version:1,workspace:null})
  for(const [name,document] of documents)put(`${folder}${generation}/${name}`,document)
  let note={id:12,title:'Project brief',content:'Initial notes',category:'Projects',etag:'note-1',modified:1794640800,favorite:false,readonly:false}
  let card={id:7,stackId:3,title:'Review proposal',description:'Initial brief',type:'plain',owner:user,order:2,done:null,startdate:null,duedate:null,color:null,lastModified:10,labels:[],assignedUsers:[],dependentCards:[],permissions:{PERMISSION_EDIT:true}}
  const board={id:2,title:'Projects',color:'0082c9',permissions:{PERMISSION_EDIT:true},archived:false,deletedAt:0}
  let token='request-token-1'
  const fetch=async(url,options={})=>{
    const parsed=new URL(url),path=parsed.pathname,method=options.method||'GET',headers=new Headers(options.headers)
    requests.push({path,method,headers,body:options.body})
    assert.equal(parsed.origin,origin);assert.ok(path.startsWith(base+'/'))
    assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store')
    assert.equal(headers.has('Authorization'),false);assert.equal(headers.get('requesttoken'),token)
    if(url===sessionUrl)return json({appId:'nextglance',appVersion:'0.6.12',userId:user,displayName:'Example',serverUrl,basePath:base,sessionUrl,loginUrl:`${serverUrl}/login`,enabledApps:['tasks','calendar','deck','notes','collectives']})
    if(path===`${base}/ocs/v2.php/cloud/user`)return ocs({id:user})
    if(path===`${base}/ocs/v2.php/cloud/capabilities`)return ocs({capabilities:{notes:{api_version:['1.2']}}})
    if(path===`${base}/remote.php/dav/`&&method==='PROPFIND')return xml(row(path,`<d:current-user-principal><d:href>${base}/remote.php/dav/principals/users/${user}/</d:href></d:current-user-principal>`))
    if(path===`${base}/remote.php/dav/principals/users/${user}/`&&method==='PROPFIND')return xml(row(path,`<c:calendar-home-set><d:href>${base}/remote.php/dav/calendars/${user}/</d:href></c:calendar-home-set>`))
    if(path===`${base}/remote.php/dav/calendars/${user}/`&&method==='PROPFIND')return xml(row(path,'<d:resourcetype><d:collection/></d:resourcetype>'))
    const deckBase=`${base}/index.php/apps/deck/api/v1.0/boards`
    if(path===deckBase)return json(withDeck?[board]:[])
    if(withDeck&&path===`${deckBase}/2`)return json(board)
    if(withDeck&&path===`${deckBase}/2/stacks`)return json([{id:3,title:'Ready'},{id:4,title:'Doing'}].map(stack=>({...stack,cards:stack.id===card.stackId?[card]:[]})))
    const stackMatch=path.match(/\/deck\/api\/v1\.0\/boards\/2\/stacks\/([34])$/)
    if(withDeck&&stackMatch)return json({id:Number(stackMatch[1]),boardId:2})
    const cardMatch=path.match(/\/deck\/api\/v1\.0\/boards\/2\/stacks\/([34])\/cards\/7(\/reorder)?$/)
    if(withDeck&&cardMatch){
      if(method==='GET'){
        assert.equal(headers.get('Cache-Control'),'no-cache')
        return json(card,200,{ETag:`"card-${card.lastModified}"`})
      }
      assert.equal(method,'PUT');assert.equal(headers.get('If-Match'),`"card-${card.lastModified}"`)
      const input=JSON.parse(options.body)
      if(cardMatch[2]){
        const stackId=Number(cardMatch[1]);assert.deepEqual(input,{stackId,order:99999})
        card={...card,stackId,order:0,lastModified:card.lastModified+1}
        return json([{id:99,stackId},card])
      }
      assert.equal(Number(cardMatch[1]),card.stackId)
      card={...card,...input,lastModified:card.lastModified+1};return json(card)
    }
    if(path===`${base}/ocs/v2.php/apps/collectives/api/v1.0/collectives`)return ocs([])
    if(path===`${base}/index.php/apps/notes/api/v1/notes`&&method==='GET')return json([note],200,{'X-Notes-API-Versions':'1.2'})
    if(path===notePath){
      if(method==='GET')return json(note)
      if(method==='PUT'){
        if(headers.get('If-Match')!==`"${note.etag}"`)return json(note,412)
        note={...note,...JSON.parse(options.body),etag:`note-${version++}`};return json(note)
      }
    }
    if(path===`${base}/remote.php/dav/files/${user}/Workspace/planner.json`)return new Response(null,{status:404})
    if(path.startsWith(`${base}/remote.php/dav/files/${user}/Workspace`)){
      if(method==='MKCOL')return new Response(null,{status:201})
      if(method==='PROPFIND'){
        const file=files.get(path)
        if(file)return xml(row(path,`<d:getetag>${xmlEscape(file.etag)}</d:getetag><d:resourcetype/>`))
        const prefix=path.replace(/\/$/,'')+'/'
        const children=[...files].filter(([name])=>name.startsWith(prefix)&&!name.slice(prefix.length).includes('/'))
        return xml(row(path,'<d:resourcetype><d:collection/></d:resourcetype>')+children.map(([name,value])=>row(name,`<d:getetag>${xmlEscape(value.etag)}</d:getetag><d:resourcetype/>`)).join(''))
      }
      if(method==='GET'){
        const file=files.get(path);if(!file)return new Response(null,{status:404})
        if(headers.get('If-None-Match')===file.etag)return new Response(null,{status:304,headers:{ETag:file.etag}})
        return json(file.document,200,{ETag:file.etag})
      }
      if(method==='PUT'){
        const file=files.get(path)
        if(file?headers.get('If-Match')!==file.etag:headers.get('If-None-Match')!=='*')return new Response(null,{status:412})
        put(path,JSON.parse(options.body));return new Response(null,{status:204,headers:{ETag:files.get(path).etag}})
      }
    }
    unexpected.push(`${method} ${path}`);throw new Error(`Unexpected fixture request: ${method} ${path}`)
  }
  return {fetch,requests,unexpected,files,requestToken:()=>token,rotateToken(){token='request-token-2'},get note(){return note},changeNote(content){note={...note,content,etag:`note-${version++}`}},get card(){return card},changeCard(fields){card={...card,...fields,lastModified:card.lastModified+1}}}
}

const pageFilters={assignment:'all',includeUnassigned:false,unassignedBoardIds:[],hiddenCollectionIds:[],showCompleted:false,query:'',attention:'all',listKind:'all',statusIds:[]}
const preferencePage=(base,scope,page,changes)=>{
  const value=structuredClone(base)
  value.scopes[scope]||={pages:{}}
  value.scopes[scope].pages[page]={...pageFilters,...value.scopes[scope].pages[page],...changes}
  return value
}

test('real Web sessions share filters outside the planner generation and merge independent page edits',async t=>{
  const fixture=httpFixture(),options={origin,sessionUrl,fetch:fixture.fetch,requestToken:fixture.requestToken}
  const first=createWebController(options),second=createWebController(options)
  t.after(()=>{first.dispose();second.dispose()})
  const before=structuredClone([...fixture.files]),a=await first.getViewPreferences(),b=await second.getViewPreferences()
  assert.deepEqual(a,{preferences:{format:'nextspace-view-preferences',version:1,scopes:{}},etag:null})
  assert.deepEqual(b,a)
  const board=preferencePage(a.preferences,'all','board',{statusIds:['ready'],showCompleted:true})
  const saved=await first.saveViewPreferences({base:a.preferences,preferences:board,etag:a.etag})
  assert.deepEqual(saved.preferences,board);assert.match(saved.etag,/^".+"$/)
  const calendar=preferencePage(b.preferences,'all','calendar',{hiddenCollectionIds:['calendar-private']})
  const merged=await second.saveViewPreferences({base:b.preferences,preferences:calendar,etag:b.etag})
  assert.deepEqual(merged.preferences.scopes.all.pages.board,board.scopes.all.pages.board)
  assert.deepEqual(merged.preferences.scopes.all.pages.calendar,calendar.scopes.all.pages.calendar)
  assert.deepEqual((await first.getViewPreferences()).preferences,merged.preferences)
  const path=folder+'view-preferences.json'
  assert.deepEqual(fixture.files.get(path).document,merged.preferences)
  for(const [name,value] of before)assert.deepEqual(fixture.files.get(name),value,'Filter changes must preserve every organization/protocol document')
  const writes=fixture.requests.filter(request=>request.method==='PUT')
  assert.ok(writes.length>=2)
  assert.ok(writes.every(request=>request.path===path))
  assert.equal(writes[0].headers.get('If-None-Match'),'*')
  assert.ok(writes.some(request=>request.headers.get('If-Match')===saved.etag))
  assert.deepEqual(fixture.unexpected,[])
})

test('real Web filter conflicts and malformed data never replace the shared file with defaults',async t=>{
  const fixture=httpFixture(),api=createWebController({origin,sessionUrl,fetch:fixture.fetch,requestToken:fixture.requestToken})
  t.after(()=>api.dispose())
  const initial=await api.getViewPreferences(),seed=preferencePage(initial.preferences,'all','board',{query:'draft'})
  const baseline=await api.saveViewPreferences({base:initial.preferences,preferences:seed,etag:initial.etag})
  const path=folder+'view-preferences.json',remote=preferencePage(seed,'all','board',{query:'review'})
  fixture.files.set(path,{document:remote,etag:'"remote-change"'})
  await assert.rejects(api.saveViewPreferences({base:baseline.preferences,preferences:preferencePage(seed,'all','board',{query:'publish'}),etag:baseline.etag}),{code:'PREFERENCES_CONFLICT'})
  assert.deepEqual(fixture.files.get(path).document,remote)
  fixture.files.set(path,{document:{format:'unsupported',version:1,scopes:{}},etag:'"malformed"'})
  const before=fixture.requests.filter(request=>request.method==='PUT').length
  await assert.rejects(api.getViewPreferences(),{code:'PREFERENCES_FORMAT'})
  assert.equal(fixture.requests.filter(request=>request.method==='PUT').length,before)
  assert.deepEqual(fixture.files.get(path).document,{format:'unsupported',version:1,scopes:{}})
  assert.equal((await api.refresh()).storage.syncStatus,'synced')
  assert.equal(api.getHostState().phase,'ready')
})

test('real Web session move adopts destination and native revision before the next edit and move',async t=>{
  const fixture=httpFixture({withDeck:true}),api=createWebController({origin,sessionUrl,fetch:fixture.fetch,requestToken:fixture.requestToken})
  t.after(()=>api.dispose())
  await api.getState();const loaded=await api.refresh(),card=loaded.records.find(item=>item.source==='deck')
  assert.ok(card);assert.equal(card.stackId,'3')
  let state=await api.moveCard({id:card.id,stackId:'4'}),current=state.records.find(item=>item.id===card.id)
  assert.equal(current.stackId,'4');assert.equal(current.status,'Doing');assert.equal(current.etag,'"card-11"')
  state=await api.updateDescription({id:card.id,description:'Edited after native move',etag:current.etag})
  assert.equal(state.records.find(item=>item.id===card.id).body,'Edited after native move')
  state=await api.moveCard({id:card.id,stackId:'3'})
  current=state.records.find(item=>item.id===card.id)
  assert.equal(current.stackId,'3');assert.equal(current.status,'Ready');assert.equal(fixture.card.stackId,3)
  assert.equal(fixture.card.description,'Edited after native move')
  const writes=()=>fixture.requests.filter(request=>request.method==='PUT'&&request.path.includes('/cards/7'))
  assert.equal(writes().length,3)
  fixture.changeCard({description:'Someone else edited this'})
  await assert.rejects(api.moveCard({id:card.id,stackId:'4'}),{code:'CONFLICT'})
  assert.equal(writes().length,3);assert.equal(fixture.card.description,'Someone else edited this')
  assert.deepEqual(fixture.unexpected,[])
})

test('real session clients read folder/native data, save a conditional note and persist custom metadata',async t=>{
  const fixture=httpFixture(),api=createWebController({origin,sessionUrl,fetch:fixture.fetch,requestToken:fixture.requestToken})
  t.after(()=>api.dispose())
  const opening=await api.getState();assert.equal(opening.workspace.name,'Example planning')
  const loaded=await api.refresh()
  assert.equal(api.getHostState().phase,'ready')
  assert.deepEqual(loaded.statuses.map(value=>[value.source,value.state]).sort(),['calendar','collectives','deck','notes','tasks'].map(source=>[source,'connected']))
  assert.equal(loaded.records.length,1)
  const note=loaded.records[0]
  assert.equal(note.title,'Project brief');assert.equal(note.body,'Initial notes');assert.equal(note.readonly,false);assert.deepEqual(note.remote,{category:'Projects'})
  assert.ok(loaded.nativeOperations.includes('updateNote'));assert.ok(loaded.nativeWriteSources.includes('notes'))
  fixture.rotateToken()
  const saved=await api.updateNote({id:note.id,title:'Updated brief',content:'- [ ] Review proposal',etag:note.etag})
  assert.equal(fixture.note.content,'- [ ] Review proposal')
  assert.equal(saved.records[0].body,'- [ ] Review proposal')
  assert.equal(saved.records[0].id,note.id)
  const nativePut=fixture.requests.find(request=>request.path===notePath&&request.method==='PUT')
  assert.equal(nativePut.headers.get('If-Match'),'"note-1"')
  assert.deepEqual(JSON.parse(nativePut.body),{title:'Updated brief',content:'- [ ] Review proposal'})
  const beforeInvalid=fixture.requests.filter(request=>request.method==='PUT').length
  await assert.rejects(api.updateNote({id:note.id,title:'',content:'invalid'}),{code:'VALIDATION'})
  assert.equal(fixture.requests.filter(request=>request.method==='PUT').length,beforeInvalid)
  fixture.changeNote('Edited elsewhere')
  await assert.rejects(api.updateNote({id:note.id,title:'Updated brief',content:'Concurrent local edit'}),{code:'CONFLICT'})
  assert.equal(fixture.note.content,'Edited elsewhere')
  const current=await api.getState(),next=structuredClone(current.workspace);next.name='Renamed planning'
  const meta=await api.saveWorkspace(next,current.revision)
  assert.equal(meta.storage.syncStatus,'synced')
  assert.equal(fixture.files.get(`${folder}${generation}/core.json`).document.value.name,'Renamed planning')
  const metadataPut=fixture.requests.findLast(request=>request.path.endsWith('/core.json')&&request.method==='PUT')
  assert.match(metadataPut.headers.get('If-Match'),/^"file-\d+"$/)
  const identities=fixture.files.get(`${folder}${generation}/identities.json`).document.value.identities
  assert.deepEqual(identities, [], 'Reading and editing a native note and renaming the workspace require no planner identity registration')
  assert.equal((await api.syncWorkspace()).workspace.name,'Renamed planning')
  assert.deepEqual(fixture.unexpected,[])
})
