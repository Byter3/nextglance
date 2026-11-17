/** Actual Electron preload → IPC → native DAV; isolated profile and loopback fixtures only. */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {rm} from 'node:fs/promises'
import path from 'node:path'
import {_electron as electron} from 'playwright'
import ICAL from 'ical.js'

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..')
const runtime=path.join(root,'.runtime'),profile=path.join(runtime,`task-creation-ipc-${randomUUID()}`)
assert.ok(profile.startsWith(runtime+path.sep))
const user='fixture-user',home=`/remote.php/dav/calendars/${user}/`,taskList=home+'tasks/'
const metadataRoot=`/remote.php/dav/files/${user}/Workspace`,plannerRoot=metadataRoot+'/Nextspace'
const directories=new Set([metadataRoot]),files=new Map(),tasks=new Map(),requests=[],failures=[]
let fileVersion=0,app,page,serverUrl,loseNextTaskResponse=false
const xmlEscape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const row=(href,props)=>`<d:response><d:href>${xmlEscape(href)}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const xml=value=>`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${value}</d:multistatus>`
const privileges='<d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>'
const collectionProps='<d:displayname>Example tasks</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>'+privileges
const ocs=data=>({ocs:{meta:{status:'ok',statuscode:200},data}})
const send=(res,body='',status=200,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(status===204?undefined:typeof body==='string'?body:JSON.stringify(body))}
const sendXml=(res,body)=>send(res,xml(body),207,{'Content-Type':'application/xml'})
const server=createServer(async(req,res)=>{
  try{
    const route=new URL(req.url,'http://localhost').pathname,method=req.method
    if(route==='/fixture')return send(res,'<!doctype html><meta charset="utf-8"><title>Task IPC fixture</title><p>Isolated host fixture</p>',200,{'Content-Type':'text/html'})
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    const body=Buffer.concat(chunks).toString('utf8');requests.push({route,method,body,headers:req.headers})
    assert.equal(req.headers.authorization,`Basic ${Buffer.from('fixture-login:fixture-password').toString('base64')}`)
    if(route.endsWith('/cloud/user'))return send(res,ocs({id:user}))
    if(route.endsWith('/cloud/capabilities'))return send(res,ocs({capabilities:{}}))
    if(route===metadataRoot+'/planner.json')return send(res,'',404)
    if(route===metadataRoot||route===plannerRoot||route.startsWith(plannerRoot+'/')){
      const location=route.replace(/\/$/,''),stored=files.get(location),etag=stored?`"file-${stored.version}"`:null
      if(method==='MKCOL'){directories.add(location);return send(res,'',201)}
      if(method==='PROPFIND'){
        if(!stored&&!directories.has(location))return send(res,'',404)
        const props=(name,file)=>row(name+(file?'':'/'),file?`<d:getetag>"file-${file.version}"</d:getetag><d:resourcetype/>`:'<d:resourcetype><d:collection/></d:resourcetype>')
        const child=name=>name.startsWith(location+'/')&&!name.slice(location.length+1).includes('/')
        const children=req.headers.depth==='0'?'':[...directories].filter(child).map(name=>props(name)).join('')+[...files].filter(([name])=>child(name)).map(([name,file])=>props(name,file)).join('')
        return sendXml(res,props(location,stored)+children)
      }
      if(method==='GET'){
        if(!stored)return send(res,'',404)
        if(req.headers['if-none-match']===etag)return send(res,'',304,{ETag:etag})
        return send(res,stored.raw,200,{ETag:etag})
      }
      if(method==='PUT'){
        if(stored?req.headers['if-match']!==etag:req.headers['if-none-match']!=='*')return send(res,'',412)
        JSON.parse(body);files.set(location,{raw:body,version:++fileVersion});return send(res,'',stored?204:201,{ETag:`"file-${fileVersion}"`})
      }
    }
    if(method==='PROPFIND'){
      if(route==='/remote.php/dav/')return sendXml(res,row(route,`<d:current-user-principal><d:href>/remote.php/dav/principals/users/${user}/</d:href></d:current-user-principal>`))
      if(route===`/remote.php/dav/principals/users/${user}/`)return sendXml(res,row(route,`<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`))
      if(route===home||route===taskList)return sendXml(res,row(taskList,collectionProps))
    }
    if(method==='REPORT'&&route===taskList)return sendXml(res,[...tasks].map(([href,value])=>row(href,`<d:getetag>"task-${value.version}"</d:getetag><c:calendar-data>${xmlEscape(value.raw)}</c:calendar-data>`)).join(''))
    if(route.startsWith(taskList)&&route.endsWith('.ics')){
      const existing=tasks.get(route),etag=existing?`"task-${existing.version}"`:null
      if(method==='GET')return send(res,existing?.raw||'',existing?200:404,existing?{ETag:etag,'Content-Type':'text/calendar'}:{})
      if(method==='PUT'){
        if(existing?req.headers['if-match']!==etag:req.headers['if-none-match']!=='*')return send(res,'',412)
        new ICAL.Component(ICAL.parse(body));const version=(existing?.version||0)+1
        tasks.set(route,{raw:body,version})
        if(loseNextTaskResponse){loseNextTaskResponse=false;res.destroy();return}
        return send(res,'',existing?204:201,{ETag:`"task-${version}"`})
      }
    }
    if(['PUT','POST','DELETE','MKCOL'].includes(method))throw new Error(`Unexpected mutation ${method} ${route}`)
    return send(res,'',404)
  }catch(error){failures.push(error.message);if(!res.headersSent)res.writeHead(500);res.end('Fixture failure')}
})
server.listen(0,'127.0.0.1');await once(server,'listening');serverUrl=`http://127.0.0.1:${server.address().port}`
const env={...process.env,NEXTSPACE_DATA_DIR:profile,NEXTSPACE_TEST_MODE:'1',NEXTSPACE_DEV_URL:serverUrl+'/fixture'}
delete env.ELECTRON_RUN_AS_NODE
const errors=[]
async function launch(){
  app=await electron.launch({executablePath:require('electron'),args:[path.join(root,'win')],cwd:root,env,timeout:45000})
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message))
  await page.waitForFunction(()=>Boolean(window.workspaceApi),null,{timeout:30000})
}
const invoke=(method,...args)=>page.evaluate(({method,args})=>window.workspaceApi[method](...args),{method,args})
const nativePuts=()=>requests.filter(value=>value.method==='PUT'&&value.route.startsWith(taskList))
try{
  await launch()
  let state=await invoke('connect',{serverUrl,username:'fixture-login',appPassword:'fixture-password'})
  assert.equal(state.statuses.find(source=>source.source==='tasks').state,'connected')
  const collection=state.collections.find(value=>value.source==='tasks');assert.ok(collection&&!collection.readonly)
  const requestId='A2222222-2222-8222-8222-222222222222',lower=requestId.toLowerCase()
  const input={title:'Review checklist',collectionId:collection.id,description:'- [ ] Inspect draft',requestId,completed:true,start:'2026-11-14',due:'2026-11-16'}
  state=await invoke('createTask',input);const firstId=state.createdRecordId,location=taskList+lower+'.ics'
  assert.ok(firstId);assert.equal(tasks.size,1);assert.equal(state.records.find(value=>value.id===firstId).completed,true)
  const component=new ICAL.Component(ICAL.parse(tasks.get(location).raw)),todo=component.getFirstSubcomponent('vtodo')
  assert.equal(todo.getFirstPropertyValue('uid'),lower);assert.equal(todo.getFirstPropertyValue('x-nextspace-request'),lower)
  assert.equal(todo.getFirstPropertyValue('status'),'COMPLETED');assert.equal(todo.getFirstPropertyValue('percent-complete'),100);assert.ok(todo.getFirstPropertyValue('completed'))
  assert.equal(nativePuts()[0].headers['if-none-match'],'*')
  const beforeInvalid=nativePuts().length
  for(const extra of [{requestId:'not-a-uuid'},{completed:'true'},{completed:null}])await assert.rejects(invoke('createTask',{...input,...extra}))
  assert.equal(nativePuts().length,beforeInvalid)
  // A later native edit belongs to Tasks, not to the original create request.
  todo.updatePropertyWithValue('summary','Reviewed and renamed natively');todo.updatePropertyWithValue('status','IN-PROCESS');todo.updatePropertyWithValue('percent-complete',40);todo.removeAllProperties('completed')
  tasks.set(location,{raw:component.toString(),version:2})
  state=await invoke('createTask',input)
  assert.equal(state.createdRecordId,firstId);assert.equal(tasks.size,1);assert.equal(tasks.get(location).version,2)
  assert.equal(state.records.filter(value=>value.source==='tasks').length,1);assert.equal(state.statuses.find(value=>value.source==='tasks').count,1)
  assert.equal(state.records.find(value=>value.id===firstId).title,'Reviewed and renamed natively');assert.equal(state.records.find(value=>value.id===firstId).completed,false)
  await app.close();app=undefined;await launch();await invoke('refresh')
  state=await invoke('createTask',input);assert.equal(state.createdRecordId,firstId);assert.equal(tasks.size,1);assert.equal(state.statuses.find(value=>value.source==='tasks').count,1)
  const lost={title:'Recover uncertain delivery',collectionId:collection.id,requestId:'33333333-3333-8333-8333-333333333333',completed:false}
  loseNextTaskResponse=true;await assert.rejects(invoke('createTask',lost));assert.equal(tasks.size,2)
  state=await invoke('createTask',lost);assert.equal(tasks.size,2);assert.equal(state.records.filter(value=>value.source==='tasks').length,2)
  assert.equal(state.records.find(value=>value.id===state.createdRecordId).completed,false);assert.equal(state.statuses.find(value=>value.source==='tasks').count,2)
  assert.deepEqual(failures,[]);assert.deepEqual(errors,[])
  console.log('PASS: actual Windows preload/IPC validates task retry options, creates completed native VTODOs, reuses one task after native edits/restart, keeps canonical IDs/counts, and recovers a lost PUT response. No UI build or live account used.')
}finally{
  await app?.close().catch(()=>{})
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  assert.ok(path.resolve(profile).startsWith(path.resolve(runtime)+path.sep))
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{})
}
