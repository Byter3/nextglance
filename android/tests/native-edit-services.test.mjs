import {launchCheckpoint} from '../src/launch-cache.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {createPreviewHost} from '../dev/preview-host.mjs'
import {createMobileController, schedulingKey, cacheKey, sourceEditsKey, launchKey} from '../src/controller.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {reconcileIdentities} from '@nextspace/core/identity.mjs'
import {createSchedulingJournal,schedulingRequest,checkedSchedulingJournal} from '../src/scheduling.mjs'
import {sha256} from '@nextspace/nextcloud-client/runtime.mjs'
import {mergeEditedRefresh} from '../src/native-edits.mjs'

const base = 'https://fixture.invalid/nextcloud', dav = `${base}/remote.php/dav/`, principal = `${dav}principals/users/tester/`, home = `${dav}calendars/tester/`, calendar = `${home}work/`
const notes = `${base}/index.php/apps/notes/api/v1/notes`, cards = `${base}/index.php/apps/deck/api/v1.0/boards/1/stacks/2/cards/3`
const clone = value => structuredClone(value), tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return {promise, resolve} }
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const row = (href, props) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const multi = rows => new Response(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">${rows}</d:multistatus>`, {status:207})
const ics = lines => ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Fixture//EN',...lines,'END:VCALENDAR',''].join('\r\n')

async function fixture({isNative = false, metadataReady = true} = {}) {
  let time = 0, noteSequence = 1, fileSequence = 1, capabilities = {davReadMode:'report',nativeEdits:'notes-dates-scheduling'}
  const calls = [], cacheValues = new Map(), sources = new Map([[`${calendar}task.ics`, {etag:'"file-1"', body:ics(['BEGIN:VTODO','UID:task','SUMMARY:Work item','END:VTODO'])}]])
  const f = {
    calls, cacheValues, sources, cacheWrites:0, cacheKeys:[], reconciliations:0,
    note: {id:7,title:'Interview',content:'# Brief\n- [ ] Prepare',category:'Clients/Studio',etag:'note-1',favorite:true},
    card: {id:3,title:'Card',type:'plain',owner:'tester',description:'Keep body',order:7,stackId:2,lastModified:1,done:null,archived:false,color:'4488aa',ETag:'"card-1"',assignedUsers:[],labels:[],attachmentCount:0},
    attachments: [], labels: [], extraCards: [], exports: [], exportResult: {exported:true},
    tags: [{id:'8',title:'Managed',assignable:false,color:'#112233'}],
    failLinks:false, failJournal:false, failCache:false, loseCreate:false, beforeRead:null, beforeNotePut:null, noteReads:0,
  }
  const tagRows = () => f.tags.map(tag => row(`${dav}systemtags/${tag.id}`, `<oc:id>${tag.id}</oc:id><oc:display-name>${escape(tag.title)}</oc:display-name><oc:user-visible>true</oc:user-visible><oc:can-assign>${tag.assignable}</oc:can-assign><nc:color>${tag.color || '#4488aa'}</nc:color>`)).join('')
  const host = createPreviewHost({now:()=>time,newId:()=> 'fixture-flow',fetch:async (url,input)=>{
    calls.push({url,method:input.method||'GET',headers:clone(input.headers),body:input.body})
    if(f.denySourceAuth)return new Response(null,{status:401})
    if(url.endsWith('/login/v2'))return Response.json({login:`${base}/login/flow`,poll:{token:'fixture',endpoint:`${base}/login/v2/poll`}})
    if(url.endsWith('/login/v2/poll'))return Response.json({server:base,loginName:'tester',appPassword:'fixture'})
    if(url.includes('/cloud/user?'))return Response.json({ocs:{meta:{statuscode:200},data:{id:'tester'}}})
    if(url.includes('/cloud/capabilities?'))return Response.json({ocs:{meta:{statuscode:200},data:{capabilities:{}}}})
    const collectives=`${base}/ocs/v2.php/apps/collectives/api/v1.0/collectives`
    if(f.includePage&&url===`${collectives}?format=json`)return Response.json({ocs:{meta:{statuscode:200},data:[{id:1,name:'Team knowledge'}]}})
    if(f.includePage&&url===`${collectives}/1/pages?format=json`)return Response.json({ocs:{meta:{statuscode:200},data:[{id:2,title:'Guide',fileName:'Readme.md'}]}})
    if(f.includePage&&url===`${collectives}/1/pages/2?format=json`)return Response.json({ocs:{meta:{statuscode:200},data:{page:{id:2,collectivePath:'Collectives/Team',fileName:'Readme.md',filePath:''}}}})
    if(f.includePage&&url===`${dav}files/tester/Collectives/Team/diagram.png`)return new Response(f.assetBody||Uint8Array.from([137,80,78,71,13,10,26,10,0]),{headers:{'Content-Type':f.assetMime||'image/png'}})
    if(url===dav&&input.method==='SEARCH')return multi(row(`${dav}files/tester/Notes/brief.md`,'<oc:fileid>7</oc:fileid><d:displayname>brief.md</d:displayname>'))
    if(url===`${dav}files/tester/Notes`||url===`${dav}files/tester/Notes/brief.md`)return multi(row(`${dav}files/tester/Notes/brief.md`,'<oc:fileid>7</oc:fileid><d:displayname>brief.md</d:displayname>'))
    if(url===`${base}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`&&input.method==='POST'){f.attachments=[{id:4,type:'file',data:'brief.md',extendedData:{fileid:7,path:'/Notes/brief.md'}}];f.card={...f.card,lastModified:f.card.lastModified+1,attachmentCount:1};return Response.json({ocs:{meta:{statuscode:200},data:{id:4}}})}
    if(url.includes('/deck/api/v1.1/')&&url.includes('/attachments')){
      if(input.method==='DELETE'){f.attachments=[];f.card={...f.card,lastModified:f.card.lastModified+1,attachmentCount:0};return new Response(null,{status:204})}
      return Response.json(f.attachments)
    }
    if(url===dav)return multi(row(dav,`<d:current-user-principal><d:href>${principal}</d:href></d:current-user-principal>`))
    if(url===principal)return multi(row(principal,`<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>${f.scheduling?`<c:calendar-user-address-set><d:href>mailto:${f.scheduling.email}</d:href></c:calendar-user-address-set><c:schedule-outbox-URL><d:href>${home}outbox/</d:href></c:schedule-outbox-URL><d:displayname>Fixture owner</d:displayname>`:''}`))
    if(url===home+'outbox/')return multi(row(url,`<d:current-user-privilege-set>${f.scheduling?.send===false?'':'<d:privilege><c:schedule-send/></d:privilege>'}</d:current-user-privilege-set>`))
    if(url===home)return multi(row(calendar,`<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname>${f.scheduling?`<d:owner><d:href>${f.scheduling.owned===false?principal.replace('/tester/','/other/'):principal}</d:href></d:owner>`:''}<d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set><c:supported-calendar-component-set><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set>`))
    if(url===calendar && input.method==='REPORT') {
      const task=input.body.includes('name="VTODO"')
      return multi([...sources].filter(([,entry])=>entry.body.includes(task?'BEGIN:VTODO':'BEGIN:VEVENT')).map(([href,entry])=>row(href,`<d:getetag>${entry.etag}</d:getetag><c:calendar-data>${escape(entry.body)}</c:calendar-data>`)).join(''))
    }
    if(url===calendar&&input.method==='PROPFIND')return multi(row(calendar,'<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set><c:supported-calendar-component-set><c:comp name="VTODO"/><c:comp name="VEVENT"/></c:supported-calendar-component-set>'))
    if(url.startsWith(calendar)&&url.endsWith('.ics')) {
      const existing=sources.get(url)
      if(input.method==='DELETE'){if(new Headers(input.headers).get('If-Match')!==existing?.etag)return new Response(null,{status:412});sources.delete(url);return new Response(null,{status:204})}
      if(input.method==='PUT') {
        const headers=new Headers(input.headers)
        if(headers.get('If-None-Match')==='*' && existing || headers.has('If-Match') && headers.get('If-Match')!==existing?.etag)return new Response(null,{status:412})
        const etag=`"file-${++fileSequence}"`; sources.set(url,{body:input.body,etag})
        if(f.loseCreate&&headers.has('If-None-Match')){f.loseCreate=false;throw new Error('Lost response after native commit')}
        return new Response(null,{status:201,headers:{ETag:etag}})
      }
      if(f.failEventReads&&existing?.body.includes('BEGIN:VEVENT'))return new Response(null,{status:503})
      return existing?new Response(existing.body,{headers:{ETag:existing.etag,'Content-Type':'text/calendar'}}):new Response(null,{status:404})
    }
    if(url.startsWith(notes+'?')) {
      const data=clone(f.note)
      if(f.beforeRead)await f.beforeRead()
      return Response.json([data],{headers:{'X-Notes-API-Versions':'1.3'}})
    }
    if(url===notes && input.method==='POST') { f.note={...JSON.parse(input.body),id:9,etag:`note-${++noteSequence}`}; return Response.json(f.note) }
    if(url===notes+'/'+f.note.id) {
      if(input.method==='PUT') {
        if(f.denyNoteAuth)return new Response(null,{status:401})
        if(f.beforeNotePut)await f.beforeNotePut()
        if(new Headers(input.headers).get('If-Match')!==`"${f.note.etag}"`)return Response.json(f.note,{status:412})
        f.note={...f.note,...JSON.parse(input.body),etag:`note-${++noteSequence}`}
        return Response.json(f.note)
      }
      f.noteReads++;return Response.json(f.note)
    }
    if(url===`${dav}systemtags/` && input.method==='POST') {
      const value=JSON.parse(input.body);f.newTag={id:'9',title:value.name,assignable:true}
      return new Response(null,{status:201,headers:{'Content-Location':`${dav}systemtags/9`}})
    }
    if(url===`${dav}systemtags/9`)return multi(row(url,'<oc:id>9</oc:id><oc:display-name>'+escape(f.newTag.title)+'</oc:display-name><oc:user-visible>true</oc:user-visible><oc:can-assign>true</oc:can-assign>'))
    if(url===`${dav}systemtags-relations/files/7`)return multi(tagRows())
    if(url===`${dav}systemtags-relations/files/7/9`&&input.method==='PUT'){f.tags.push(f.newTag);return new Response(null,{status:201})}
    if(url===`${dav}systemtags-relations/files/7/9`&&input.method==='DELETE'){f.tags=f.tags.filter(tag=>tag.id!=='9');return new Response(null,{status:204})}
    if(url.endsWith('/deck/api/v1.0/boards?details=true'))return Response.json([{id:1,title:'Board',labels:f.labels,permissions:{PERMISSION_EDIT:!f.denyDeckEdit}}])
    if(url.endsWith('/deck/api/v1.0/boards/1'))return Response.json({id:1,title:'Board',labels:f.labels,permissions:{PERMISSION_EDIT:!f.denyDeckEdit}})
    if(url.endsWith('/deck/api/v1.0/boards/1/stacks'))return Response.json([{id:2,title:'Doing',cards:[f.card,...f.extraCards].filter(card=>card.stackId===2)},{id:6,title:'Done',cards:[f.card].filter(card=>card.stackId===6)}])
    if(url.endsWith('/deck/api/v1.0/boards/1/stacks/2'))return Response.json({id:2,boardId:1,title:'Doing'})
    if(url.endsWith('/deck/api/v1.0/boards/1/stacks/6'))return Response.json({id:6,boardId:1,title:'Done'})
    if(url.endsWith('/deck/api/v1.0/boards/1/labels')&&input.method==='POST'){const label={...JSON.parse(input.body),id:20,boardId:1};f.labels.push(label);return Response.json(label,{status:201})}
    const reorder = url.match(/\/deck\/api\/v1\.0\/boards\/1\/stacks\/(2|6)\/cards\/3\/reorder$/)
    if(reorder){
      // Deck's route destination takes precedence over the body. Its response
      // is the affected cards, not necessarily just the card being moved.
      f.card={...f.card,...JSON.parse(input.body),stackId:Number(reorder[1]),lastModified:f.card.lastModified+1,ETag:`"card-${f.card.lastModified+1}"`}
      return Response.json(f.reorderReadback?[]:[{...f.card,id:99,title:'Another affected card'},f.card])
    }
    if(url===`${cards}/assignLabel`||url===`${cards}/removeLabel`){const {labelId}=JSON.parse(input.body);f.card={...f.card,labels:f.card.labels.filter(label=>label.id!==labelId)};if(url.endsWith('assignLabel'))f.card.labels.push(f.labels.find(label=>label.id===labelId));return Response.json(f.card)}
    if(url===`${cards}/dependentCards/5`){f.card={...f.card,dependentCards:input.method==='DELETE'?[]:[5]};return Response.json(f.card)}
    if(url===cards.replace('/stacks/2/','/stacks/6/')){
      if(f.card.stackId!==6)return new Response(null,{status:404})
      if(input.method==='PUT')f.card={...f.card,...JSON.parse(input.body),lastModified:f.card.lastModified+1,ETag:`"card-${f.card.lastModified+1}"`}
      return Response.json(f.card,{headers:{ETag:f.card.ETag}})
    }
    if(url===cards.slice(0,-1)+'5')return Response.json(f.extraCards.find(card=>card.id===5))
    if(url===`${base}/ocs/v2.php/apps/related_resources/related/deck/1?format=json`)return Response.json({ocs:{meta:{statuscode:200},data:[{providerId:'files',itemId:'9',title:'Project brief',url:'/nextcloud/apps/files/?fileid=9'}]}})
    if(url===cards.slice(0,-2)&&input.method==='POST'){
      const value=JSON.parse(input.body)
      f.createdCard={...f.card,...value,id:4,stackId:2,lastModified:1,ETag:'"created-card-1"',assignedUsers:value.users.map(user=>({participant:{uid:user.id}}))}
      return Response.json(f.createdCard,{status:201})
    }
    if(url===cards.slice(0,-1)+'4')return f.failCardReadback?new Response(null,{status:503}):Response.json(f.createdCard)
    if(url===cards) {
      if(input.method==='PUT')f.card={...f.card,...JSON.parse(input.body),lastModified:f.card.lastModified+1,ETag:`"card-${f.card.lastModified+1}"`}
      return Response.json(f.card,{headers:{ETag:f.card.ETag}})
    }
    return new Response(null,{status:404})
  }})
  const flow=await host.command('beginLogin',{serverUrl:base});time=1800
  const authorized=await host.command('pollLogin',{flowId:flow.flowId})
  const native={getAccount:async()=>({...await host.command('getAccount'),capabilities}),request:args=>{if(f.transportFailure)throw Object.assign(new Error('Host authorization unavailable'),{code:f.transportFailure});return host.command('request',args)},disconnect:()=>host.command('disconnect')}
  const cache={load:async(key,validate)=>{const value=clone(cacheValues.get(key));return value&&validate?validate(value):value},save:async(key,value)=>{if(f.failCache || f.failJournal&&key===schedulingKey(authorized.account))throw new Error('Disk unavailable');f.cacheWrites++;f.cacheKeys.push(key);cacheValues.set(key,clone(value))},remove:async key=>cacheValues.delete(key)}
  function metadata({key,client}) {
    let saved=clone(cacheValues.get(key))||{workspace:createPlannerWorkspace(),revision:0,metadata:{ready:metadataReady},storage:{syncStatus:'synced'}}
    const save=()=>cacheValues.set(key,clone(saved))
    return {
      load:async()=>clone(saved),getState:()=>clone(saved),sync:async()=>{if(f.readMetadata)try{await client.readPlannerFile('manifest.json')}catch{/* Actual metadata service reports source failures as storage state. */}},
      saveWorkspace:async(workspace,revision)=>{if(f.failLinks)throw new Error('Link persistence failed');if(revision!==saved.revision)throw Object.assign(new Error('Revision'),{code:'REVISION_CONFLICT'});saved={...saved,workspace:clone(workspace),revision:revision+1};save()},
      reconcileRecords:async records=>{f.reconciliations++;const result=reconcileIdentities(saved.workspace,records);if(JSON.stringify(result.workspace)!==JSON.stringify(saved.workspace)){saved={...saved,workspace:result.workspace,revision:saved.revision+1};save()}return {...clone(saved),records:result.records,remap:result.remap}},
    }
  }
  f.create=()=>createMobileController({native,cache,makeMetadataStore:metadata,isNative,hostAvailable:true,openExternal:async()=>{},exportPlanner:async document=>{f.exports.push(JSON.parse(document));return f.exportResult}})
  f.api=f.create();f.state=await f.api.refresh();f.account=authorized.account
  f.close=()=>{f.api.dispose();host.close()};f.setCapabilities=value=>{capabilities=value};f.native=native
  f.record=kind=>f.state.records.find(record=>record.kind===kind)
  f.writes=()=>calls.filter(call=>['PUT','POST','DELETE'].includes(call.method)&&!call.url.includes('/login/'))
  f.request=()=>({requestId:'11111111-1111-4111-8111-111111111111',recordId:f.record('task').id,collectionId:f.state.collections.find(c=>c.source==='calendar').id,title:'Focused work',start:'2030-06-11T09:00:00Z',end:'2030-06-11T10:00:00Z',expectedRevision:f.state.revision})
  return f
}

test('notes expose only safe category and save acknowledged content/version without full refresh',async t=>{
  const f=await fixture();t.after(f.close);const note=f.record('note'),before=f.calls.filter(c=>c.url.startsWith(notes+'?')).length
  assert.deepEqual(note.remote,{category:'Clients/Studio'});assert.equal(note.identity,undefined)
  const tags=await f.api.readNoteTags({id:note.id});assert.equal(tags.tags[0].title,'Managed')
  const state=await f.api.updateNote({id:note.id,title:note.title,content:'## Updated',category:'Freelance',etag:note.etag,base:{title:note.title,content:note.body,category:note.remote.category}})
  const saved=state.records.find(r=>r.id===note.id)
  assert.equal(saved.body,'## Updated');assert.equal(saved.remote.category,'Freelance');assert.equal(saved.collectionTitle,'Freelance')
  assert.equal(saved.tagDetails[0].title,'Managed');assert.ok(state.collections.some(c=>c.id===saved.collectionId));assert.notEqual(saved.etag,note.etag)
  assert.equal(f.calls.filter(c=>c.url.startsWith(notes+'?')).length,before)
  assert.ok(f.writes().filter(c=>c.url===notes+'/7').every(c=>!Object.hasOwn(JSON.parse(c.body),'favorite')))
})

test('note independent edits merge and conflicting body stays unchanged until explicit review',async t=>{
  const f=await fixture();t.after(f.close);const note=f.record('note')
  f.note={...f.note,category:'Remote category',etag:'remote-2'}
  const state=await f.api.updateNote({id:note.id,title:note.title,content:'Local body',etag:note.etag,base:{title:note.title,content:note.body,category:note.remote.category}})
  assert.equal(state.records.find(r=>r.id===note.id).remote.category,'Remote category')
  f.note={...f.note,content:'Concurrent server body',etag:'remote-3'}
  const before=await f.api.getState()
  await assert.rejects(f.api.updateNote({id:note.id,title:note.title,content:'Other local body',etag:'note-2',base:{title:note.title,content:'Local body',category:'Remote category'}}),{code:'CONFLICT'})
  const latest=await f.api.readNote({id:note.id})
  assert.equal(latest.content,'Concurrent server body');assert.deepEqual(await f.api.getState(),before,'Review does not replace cached body or editor reference')
})

test('assigned tags load without catalog enumeration; inline create/remove preserves restricted tags',async t=>{
  const f=await fixture();t.after(f.close);const id=f.record('note').id
  await f.api.readNoteTags({id})
  const result=await f.api.setNoteTags({id,tagIds:[],newTags:['Freelance']})
  assert.deepEqual(result.tags.map(t=>t.title),['Managed','Freelance'])
  assert.deepEqual((await f.api.getState()).records.find(r=>r.id===id).tagDetails.map(t=>t.title),['Managed','Freelance'])
  await f.api.setNoteTags({id,tagIds:[],newTags:[]})
  assert.deepEqual(f.tags.map(t=>t.title),['Managed'])
  assert.ok(!f.calls.some(c=>c.url===`${dav}systemtags/`&&c.method==='PROPFIND'))
  assert.ok(f.calls.filter(c=>c.method==='DELETE').every(c=>c.url===`${dav}systemtags-relations/files/7/9`))
})

test('same-account write capability revocation keeps reads and blocks writes even when REPORT unchanged',async t=>{
  const f=await fixture();t.after(f.close)
  assert.ok(f.state.nativeOperations.includes('updateNote'))
  f.setCapabilities({davReadMode:'report'})
  const state=await f.api.refresh();assert.deepEqual(state.nativeOperations,[])
  const before=f.writes().length
  await assert.rejects(f.api.updateNote({id:f.record('note').id,title:'Test',content:'Blocked'}),/read-only/)
  assert.equal(f.writes().length,before);assert.ok((await f.api.readNoteTags({id:f.record('note').id})).tags.length)
})

test('native date updates preserve unrelated Deck fields and support undated Tasks',async t=>{
  const f=await fixture();t.after(f.close);const task=f.record('task'),card=f.record('card')
  let state=await f.api.updateRecordDates({id:task.id,start:'2030-06-11',due:'2030-06-12',etag:task.etag})
  assert.equal(state.records.find(r=>r.id===task.id).due,'2030-06-12')
  state=await f.api.updateRecordDates({id:card.id,start:'2030-06-11T08:00:00Z',due:'2030-06-12T17:00:00Z',etag:card.etag})
  assert.equal(state.records.find(r=>r.id===card.id).body,'Keep body');assert.equal(f.card.color,'4488aa');assert.equal(f.card.order,7)
  const before=f.writes().length
  await assert.rejects(f.api.updateRecordDates({id:card.id,start:'2030-06-11'}),/explicit|time|date/i)
  assert.equal(f.writes().length,before)
})

test('native edits invalidate identity reuse even when the saved identity registry stays unchanged',async t=>{
  const f=await fixture();t.after(f.close)
  await f.api.syncWorkspace();let before=f.reconciliations
  const task=f.record('task')
  let state=await f.api.updateRecordDates({id:task.id,start:'2030-06-11',due:'2030-06-12',etag:task.etag})
  assert.ok(f.reconciliations>before);assert.equal(state.records.find(record=>record.id===task.id).start,'2030-06-11')
  before=f.reconciliations
  await f.api.syncWorkspace();assert.equal(f.reconciliations,before)
  const note=state.records.find(record=>record.kind==='note')
  state=await f.api.updateNote({id:note.id,title:note.title,content:'Updated body',etag:note.etag})
  assert.ok(f.reconciliations>before);assert.equal(state.records.find(record=>record.id===note.id).body,'Updated body')
})

test('an older in-flight source refresh cannot overwrite an acknowledged note edit',async t=>{
  const f=await fixture();t.after(f.close);const note=f.record('note'),wait=deferred()
  f.beforeRead=()=>wait.promise
  const refresh=f.api.refresh();await tick();await tick()
  await f.api.updateNote({id:note.id,title:note.title,content:'Acknowledged while refreshing',etag:note.etag})
  wait.resolve();await refresh
  assert.equal((await f.api.getState()).records.find(r=>r.id===note.id).body,'Acknowledged while refreshing')
})

test('schedule survives a lost native response and restart without duplicate event or relation',async t=>{
  const f=await fixture();t.after(f.close);const input=f.request();f.loseCreate=true
  await assert.rejects(f.api.createLinkedEvent(input),/request is saved/)
  assert.equal([...f.sources].filter(([,v])=>v.body.includes('BEGIN:VEVENT')).length,1)
  assert.equal((await f.api.getState()).pendingSchedules[0].created,false)
  f.api.dispose();f.api=f.create();await f.api.refresh()
  const state=await f.api.createLinkedEvent(input)
  assert.equal(state.workspace.relations.filter(r=>r.type==='scheduled_during').length,1);assert.deepEqual(state.pendingSchedules,[])
  const calls=f.calls.length;await f.api.createLinkedEvent(input);assert.equal(f.calls.length,calls)
  assert.equal([...f.sources].filter(([,v])=>v.body.includes('BEGIN:VEVENT')).length,1)
  assert.ok(state.records.some(r=>r.kind==='event'&&r.start.startsWith('2030-06-11')),'New event outside agenda window is adopted directly')
})

test('a created event with failed metadata link retries by reading and preserves newer organization',async t=>{
  const f=await fixture();t.after(f.close);const input=f.request();f.failLinks=true
  await assert.rejects(f.api.createLinkedEvent(input),/request is saved/)
  assert.equal((await f.api.getState()).pendingSchedules[0].created,true)
  f.failLinks=false;const state=await f.api.getState();state.workspace.name='Newer organization';await f.api.saveWorkspace(state.workspace,state.revision)
  const before=f.calls.filter(c=>c.method==='PUT'&&c.url.endsWith('.ics')).length
  const saved=await f.api.createLinkedEvent(input)
  assert.equal(saved.workspace.name,'Newer organization');assert.equal(f.calls.filter(c=>c.method==='PUT'&&c.url.endsWith('.ics')).length,before)
  assert.equal(saved.workspace.relations.length,1)
})

test('failed journal persistence prevents native creation; changed retry details never create another booking',async t=>{
  const f=await fixture();t.after(f.close);const input=f.request(),before=f.writes().length;f.failJournal=true
  await assert.rejects(f.api.createLinkedEvent(input),/Disk unavailable/);assert.equal(f.writes().length,before)
  f.failJournal=false;f.failLinks=true;await assert.rejects(f.api.createLinkedEvent(input),/request is saved/)
  const count=f.writes().length
  await assert.rejects(f.api.createLinkedEvent({...input,title:'Different'}),/different details/);assert.equal(f.writes().length,count)
})

test('known-created event deletion is never recreated and malformed journal remains untouched',async t=>{
  const f=await fixture();t.after(f.close);const input=f.request();f.failLinks=true
  await assert.rejects(f.api.createLinkedEvent(input),/request is saved/)
  for(const [key,value] of f.sources)if(value.body.includes('BEGIN:VEVENT'))f.sources.delete(key)
  f.failLinks=false;const before=f.writes().length
  await assert.rejects(f.api.createLinkedEvent(input),/request is saved/);assert.equal(f.writes().length,before)
  const key=schedulingKey(f.account);f.cacheValues.set(key,{bad:'preserve'})
  f.api.dispose();f.api=f.create();await f.api.refresh()
  await assert.rejects(f.api.createLinkedEvent(input),/could not be read/);assert.deepEqual(f.cacheValues.get(key),{bad:'preserve'})
})

test('note create preserves chosen category and returns stable identity; malformed edits make no write',async t=>{
  const f=await fixture();t.after(f.close);const collection=f.state.collections.find(c=>c.source==='notes')
  const state=await f.api.createNote({title:'Created note',content:'Body',collectionId:collection.id,category:'Ignored'})
  assert.equal(f.note.category,'Clients/Studio');assert.ok(state.records.some(r=>r.id===state.createdRecordId&&r.title==='Created note'))
  const before=f.writes().length
  await assert.rejects(f.api.updateNote({id:state.createdRecordId,title:'Bad\0title',content:'Text'}),/missing or too long/)
  assert.equal(f.writes().length,before)
})

for(const action of ['read','assign'])test(`concurrent tag ${action} keeps new tags without pinning a stale body/version`,async t=>{
  const f=await fixture();t.after(f.close);const note=f.record('note'),wait=deferred(),entered=deferred()
  f.note={...f.note,content:'Fresh remote body',category:'Changed remotely',etag:'remote-fresh'}
  f.beforeRead=()=>{entered.resolve();return wait.promise}
  const refresh=f.api.refresh();await entered.promise
  if(action==='read')await f.api.readNoteTags({id:note.id})
  else await f.api.setNoteTags({id:note.id,tagIds:[],newTags:['Freelance']})
  wait.resolve();await refresh
  const current=(await f.api.getState()).records.find(r=>r.id===note.id)
  assert.equal(current.body,'Fresh remote body');assert.equal(current.etag,'remote-fresh');assert.equal(current.remote.category,'Changed remotely')
  assert.deepEqual(current.tagDetails.map(t=>t.title),action==='read'?['Managed']:['Managed','Freelance'])
})

test('unchanged assigned-tag reads do not write the source cache or revise organization',async t=>{
  const f=await fixture();t.after(f.close);const id=f.record('note').id
  await f.api.readNoteTags({id});const count=f.cacheWrites,before=await f.api.getState()
  await f.api.readNoteTags({id})
  assert.equal(f.cacheWrites,count);assert.deepEqual(await f.api.getState(),before)
})

test('genuine note read-only permission blocks saving but allows assigned tag display',async t=>{
  const f=await fixture();t.after(f.close);f.note.readonly=true;f.state=await f.api.refresh();const note=f.record('note')
  assert.equal(note.readonly,true);const count=f.writes().length
  await assert.rejects(f.api.updateNote({id:note.id,title:note.title,content:'Blocked'}),{code:'PERMISSION'})
  await assert.rejects(f.api.setNoteTags({id:note.id,tagIds:[],newTags:['Blocked']}),{code:'PERMISSION'})
  assert.equal((await f.api.readNoteTags({id:note.id})).tags.length,1);assert.equal(f.writes().length,count)
})

test('scheduling read-only source work edits only the writable destination and planner link',async t=>{
  const f=await fixture();t.after(f.close);f.card.permissions={PERMISSION_EDIT:false};f.state=await f.api.refresh()
  const card=f.record('card');assert.equal(card.readonly,true)
  const state=await f.api.createLinkedEvent({...f.request(),recordId:card.id})
  assert.ok(state.workspace.relations.some(r=>r.fromId===card.id));assert.ok(!f.calls.some(c=>c.method==='PUT'&&c.url===cards))
})

test('successful native note creation followed by local failure explicitly discourages duplicate creation',async t=>{
  const f=await fixture();t.after(f.close);f.failCache=true
  await assert.rejects(f.api.createNote({title:'Already created',content:'Body'}),error=>error.code==='CREATED_NOT_ADOPTED'&&/note was created/.test(error.message)&&/before creating another/.test(error.message))
  assert.equal(f.note.title,'Already created');assert.equal(f.calls.filter(c=>c.url===notes&&c.method==='POST').length,1)
})

test('confirmed native-write authorization revocation clears source cache and requires reconnect',async t=>{
  const f=await fixture();t.after(f.close);const note=f.record('note');f.denyNoteAuth=true
  await assert.rejects(f.api.updateNote({id:note.id,title:note.title,content:'Denied',etag:note.etag}),{code:'AUTH'})
  const state=await f.api.getState()
  assert.equal(state.connection.reconnectRequired,true);assert.deepEqual(state.records,[]);assert.deepEqual(state.nativeOperations,[])
  for(const value of f.cacheValues.values())if(value?.records)assert.equal(value.records.length,0)
})

test('actual reader session expiry cannot be swallowed into ordinary partial-source errors',async t=>{
  const f=await fixture();t.after(f.close);const before=clone(f.cacheValues),ids=f.state.records.map(r=>r.id)
  f.transportFailure='PREVIEW_SESSION_EXPIRED'
  const state=await f.api.refresh()
  assert.equal(state.connection.reconnectRequired,true);assert.match(state.connection.restoreError,/preview server restarted/)
  assert.deepEqual(state.records.map(r=>r.id),ids);assert.ok(state.records.every(r=>r.readonly))
  assert.deepEqual(f.cacheValues,before);assert.deepEqual(state.nativeOperations,[])
})

test('actual reader HTTP 401 requires authorization and purges revoked sources even when readAll resolves',async t=>{
  const f=await fixture();t.after(f.close);f.denySourceAuth=true
  const state=await f.api.refresh()
  assert.equal(state.connection.reconnectRequired,true);assert.deepEqual(state.records,[])
  assert.deepEqual(state.nativeOperations,[])
  for(const value of f.cacheValues.values())if(value?.records)assert.equal(value.records.length,0)
})

for(const code of ['PREVIEW_SESSION_EXPIRED','RECONNECT_REQUIRED'])test(`interrupted native note edit (${code}) keeps saved content and requires reconnect`,async t=>{
  const f=await fixture();t.after(f.close);const note=f.record('note'),before=clone(f.cacheValues),writes=f.writes().length
  f.transportFailure=code
  await assert.rejects(f.api.updateNote({id:note.id,title:note.title,content:'Unsaved draft',etag:note.etag}))
  const state=await f.api.getState()
  assert.equal(state.connection.reconnectRequired,true);assert.equal(state.records.find(r=>r.id===note.id).body,note.body)
  assert.deepEqual(f.cacheValues,before);assert.equal(f.writes().length,writes)
  await assert.rejects(f.api.readNote({id:note.id}),{code:'UNAVAILABLE'})
})

test('metadata service handling a session error cannot conceal the reconnect transition or purge pending planner data',async t=>{
  const f=await fixture();t.after(f.close);const state=await f.api.getState(),before=clone(f.cacheValues)
  f.readMetadata=true;f.transportFailure='PREVIEW_SESSION_EXPIRED'
  const result=await f.api.syncWorkspace()
  assert.equal(result.connection.reconnectRequired,true);assert.deepEqual(result.workspace,state.workspace)
  assert.deepEqual(f.cacheValues,before)
})

test('account transition waits for in-flight native mutation and never exposes its result in the new account',async t=>{
  const f=await fixture({isNative:true});t.after(f.close);const wait=deferred(),entered=deferred(),note=f.record('note')
  f.beforeNotePut=()=>{entered.resolve();return wait.promise}
  const update=f.api.updateNote({id:note.id,title:note.title,content:'Old account edit',etag:note.etag});await entered.promise
  let selected=false
  const other={name:'other',serverUrl:base,username:'other'}
  f.native.selectAccount=async()=>{selected=true;f.native.getAccount=async()=>({account:other,capabilities:{davReadMode:'report',nativeEdits:'notes-dates-scheduling'}});return f.native.getAccount()}
  const changing=f.api.selectAccount();await tick();assert.equal(selected,false)
  wait.resolve();await update;await changing
  const state=await f.api.getState();assert.equal(state.connection.username,'other');assert.ok(!state.records.some(r=>r.id===note.id))
})

test('pending scheduling identity remap accepts only equivalent work without changing its durable fingerprint',async()=>{
  const values=new Map();let revision=0,mapped=false,fail=true,creates=0
  let workspace={relations:[]}
  const work=()=>({id:mapped?'canonical':'old-id',source:'tasks',kind:'task'})
  const context={snapshot:()=>({workspace,revision}),state:()=>({workspace,revision}),resolve:id=>mapped&&id==='old-id'?'canonical':id,record:id=>['old-id','canonical'].includes(id)?work():null,
    collection:()=>({id:'calendar',source:'calendar',remote:{href:calendar}}),client:()=>({createEvent:async()=>{creates++;return {href:calendar+'event.ics',uid:'event',record:{id:'event'}}},readCreatedEvent:async()=>({id:'event'})}),adoptEvent:async record=>record,
    saveWorkspace:async value=>{if(fail)throw new Error('Save failed');workspace=value;revision++}}
  const journal=createSchedulingJournal({cache:{load:async key=>values.get(key),save:async(key,value)=>values.set(key,clone(value))},key:'fixture',context,newId:()=> 'relation'})
  const input={requestId:'11111111-1111-4111-8111-111111111111',recordId:'old-id',collectionId:'calendar',title:'Work',start:'2030-06-11T09:00:00Z',end:'2030-06-11T10:00:00Z',expectedRevision:0}
  await assert.rejects(journal.create(input),/request is saved/);const fingerprint=values.get('fixture').requests[0].digest
  mapped=true;fail=false
  await assert.rejects(journal.create({...input,recordId:'unrelated'}),/different details/)
  await journal.create({...input,recordId:'canonical'})
  assert.equal(creates,1);assert.equal(workspace.relations[0].fromId,'canonical');assert.equal(values.get('fixture').requests[0].digest,fingerprint)
})


for (const [kind, method] of [['task','setTaskCompleted'], ['card','setCardCompleted']]) test(`${kind} completion persists its native state and reopens without changing linked work`, async t => {
  const f=await fixture();t.after(f.close);const record=f.record(kind), other=f.record(kind==='task'?'card':'task')
  assert.ok(f.state.nativeOperations.includes(method))
  let state=await f.api[method]({id:record.id,completed:true})
  assert.equal(state.records.find(row=>row.id===record.id).completed,true)
  assert.equal(Boolean(state.records.find(row=>row.id===other.id).completed),false)
  if(kind==='task') {assert.match(f.sources.get(calendar+'task.ics').body,/STATUS:COMPLETED/);assert.match(f.sources.get(calendar+'task.ics').body,/PERCENT-COMPLETE:100/)}
  else {assert.ok(f.card.done);assert.equal(f.card.stackId,2);assert.equal(f.card.description,'Keep body')}
  f.api.dispose();f.api=f.create();await f.api.getState();state=await f.api.refresh()
  assert.equal(state.records.find(row=>row.id===record.id).completed,true)
  state=await f.api[method]({id:record.id,completed:false})
  assert.equal(state.records.find(row=>row.id===record.id).completed,false)
  if(kind==='task'){assert.match(f.sources.get(calendar+'task.ics').body,/STATUS:NEEDS-ACTION/);assert.doesNotMatch(f.sources.get(calendar+'task.ics').body,/^COMPLETED:/m)}
  else {assert.equal(f.card.done,null);assert.equal(f.card.stackId,2)}
})

test('completion rejects malformed booleans, wrong sources and unavailable capability before writes',async t=>{
  const f=await fixture();t.after(f.close);const task=f.record('task'),card=f.record('card'),before=f.writes().length
  for(const completed of [undefined,null,'true',1])await assert.rejects(f.api.setTaskCompleted({id:task.id,completed}),{code:'VALIDATION'})
  await assert.rejects(f.api.setTaskCompleted({id:card.id,completed:true}),{code:'UNAVAILABLE'})
  await assert.rejects(f.api.setCardCompleted({id:task.id,completed:true}),{code:'UNAVAILABLE'})
  f.setCapabilities({davReadMode:'report'});await f.api.refresh()
  await assert.rejects(f.api.setTaskCompleted({id:task.id,completed:true}),{code:'UNAVAILABLE'})
  assert.equal(f.writes().length,before)
})


test('single native edits and bookings persist a small overlay without rewriting the source archive',async t=>{
  const f=await fixture();t.after(f.close);const full=()=>f.cacheKeys.filter(key=>key===cacheKey(f.account)).length
  const initial=full(),task=f.record('task')
  await f.api.setTaskCompleted({id:task.id,completed:true})
  assert.equal(full(),initial);assert.equal(f.cacheValues.get(sourceEditsKey(f.account)).entries[0].record.completed,true)
  f.api.dispose();f.api=f.create();const restored=await f.api.getState()
  assert.equal(restored.records.find(row=>row.id===task.id).completed,true,'Durable edit restored before fresh native read')
  await f.api.refresh();f.state=await f.api.getState();const before=full()
  const input=f.request();const scheduled=await f.api.createLinkedEvent(input)
  assert.equal(full(),before,'Booking acknowledgment does not serialize all sources')
  assert.equal(scheduled.workspace.relations.filter(link=>link.type==='scheduled_during').length,1)
  assert.equal(f.cacheValues.get(schedulingKey(f.account)).requests[0].status,'linked')
  assert.ok(f.cacheValues.get(sourceEditsKey(f.account)).entries.some(entry=>entry.record.kind==='event'))
})

test('freshness-only refresh skips archive write but content and native permission changes persist',async t=>{
  const f=await fixture();t.after(f.close);const full=()=>f.cacheKeys.filter(key=>key===cacheKey(f.account)).length
  const initial=full();await f.api.refresh();assert.equal(full(),initial)
  f.note.content='New remote body';f.note.etag='changed';await f.api.refresh();assert.equal(full(),initial+1)
  f.note.readonly=true;await f.api.refresh();assert.equal(full(),initial+2)
})

test('corrupt nonmissing acknowledged overlay stays visible and blocks edits after otherwise successful refresh',async t=>{
  const f=await fixture();t.after(f.close);const key=sourceEditsKey(f.account)
  f.cacheValues.set(key,{bad:'preserve'});f.api.dispose();f.api=f.create();await f.api.getState()
  const state=await f.api.refresh();assert.deepEqual(state.nativeOperations,[]);assert.equal(state.storage.errorCode,'CACHE_UNREADABLE')
  const writes=f.writes().length;await assert.rejects(f.api.setTaskCompleted({id:f.record('task').id,completed:true}),{code:'CACHE_UNREADABLE'})
  assert.equal(f.writes().length,writes);assert.deepEqual(f.cacheValues.get(key),{bad:'preserve'})
})

for (const missing of [false,true]) test(`independent acknowledged edit recovery survives ${missing?'missing':'unreadable'} archive and cannot overwrite a later remote refresh`,async t=>{
  const f=await fixture();t.after(f.close);const note=f.record('note'),key=cacheKey(f.account)
  await f.api.updateNote({id:note.id,title:note.title,content:'Acknowledged edit',etag:note.etag})
  if(missing)f.cacheValues.delete(key)
  else f.cacheValues.set(key,{bad:'damaged source archive'})
  f.api.dispose();f.api=f.create()
  const recovered=await f.api.getState()
  assert.equal(recovered.records.find(record=>record.id===note.id).body,'Acknowledged edit')
  assert.equal(recovered.records.find(record=>record.id===note.id).readonly,true)
  if(!missing)assert.equal(recovered.storage.errorCode,'CACHE_UNREADABLE')
  f.note={...f.note,content:'Newer server change',etag:'server-after-edit'}
  await f.api.refresh()
  assert.equal(f.cacheValues.get(key).acknowledgedSequence,1)
  f.api.dispose();f.api=f.create()
  const restarted=await f.api.getState()
  assert.equal(restarted.records.find(record=>record.id===note.id).body,'Newer server change')
  assert.equal(f.cacheValues.get(sourceEditsKey(f.account)).entries[0].record.body,'Acknowledged edit','Covered overlay is retained for older archive fallback')
})

test('deleted booking stays absent after damaged archive and stale launch recovery; linked work is retained',async t=>{
  const f=await fixture();t.after(f.close)
  f.state=await f.api.createLinkedEvent(f.request());const event=f.state.records.find(r=>r.kind==='event'),task=f.record('task'),before=structuredClone(f.cacheValues)
  const next=await f.api.deleteEvent({id:event.id});assert.ok(!next.records.some(r=>r.id===event.id));assert.ok(next.records.some(r=>r.id===task.id))
  assert.ok(next.workspace.relations.some(link=>link.toId===event.id))
  const overlay=f.cacheValues.get(sourceEditsKey(f.account));assert.equal(overlay.entries.find(entry=>entry.record.id===event.id).deleted,true)
  const savedOverlay=structuredClone(overlay);f.api.dispose();f.cacheValues.clear();for(const pair of before)f.cacheValues.set(...pair);f.cacheValues.set(sourceEditsKey(f.account),savedOverlay);f.cacheValues.set(cacheKey(f.account),{broken:true});f.cacheValues.set(launchKey(f.account),launchCheckpoint(f.state,cacheKey(f.account)));f.native.getSavedAccount=async()=>({account:f.account});f.api=f.create()
  let restored=await f.api.getState();while(restored.deviceSync.restoring){await tick();restored=await f.api.getState()}assert.ok(!restored.records.some(r=>r.id===event.id));assert.ok(restored.records.some(r=>r.id===task.id))
})

test('native Deck note attachment is read back and preserves a fresh editable card baseline',async t=>{
  const f=await fixture();t.after(f.close);const card=f.record('card'),note=f.record('note')
  const attached=await f.api.attachDeckFile({id:card.id,noteId:note.id});assert.equal(attached.attachments.length,1)
  assert.ok(f.calls.some(call=>call.method==='SEARCH'));assert.ok(f.calls.some(call=>call.method==='POST'&&call.url.includes('/files_sharing/')))
  assert.deepEqual((await f.api.getState()).records.find(r=>r.id===card.id).attachmentFileIds,['7'])
  await f.api.setCardCompleted({id:card.id,completed:true})
  const detached=await f.api.removeDeckAttachment({id:card.id,attachmentId:'4'});assert.deepEqual(detached.attachments,[])
  await f.api.setCardCompleted({id:card.id,completed:false})
})

test('an event restored through XML REPORT can be deleted against unchanged CRLF GET data',async t=>{
  const f=await fixture();t.after(f.close)
  const start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString()
  f.state=await f.api.createLinkedEvent({...f.request(),start,end})
  const event=f.state.records.find(record=>record.kind==='event')
  f.state=await f.api.refresh();assert.ok(f.state.records.some(record=>record.id===event.id))
  const entry=[...f.sources].find(([,value])=>value.body.includes('BEGIN:VEVENT'))
  assert.ok(entry[1].body.includes('\r\n'),'GET fixture retains native CRLF bytes')
  const deleted=await f.api.deleteEvent({id:event.id})
  assert.ok(!deleted.records.some(record=>record.id===event.id));assert.ok(!f.sources.has(entry[0]))
  assert.equal(new Headers(f.calls.findLast(call=>call.url===entry[0]&&call.method==='DELETE').headers).get('If-Match'),entry[1].etag)
})
test('cancelling attachment picker preserves existing attachment list and performs no upload',async t=>{
  const f=await fixture();t.after(f.close);f.attachments=[{id:4,type:'file',data:'brief.md',extendedData:{fileid:7,path:'/Notes/brief.md'}}];f.native.chooseAttachment=async()=>({cancelled:true});f.native.uploadAttachment=()=>assert.fail('Unexpected upload')
  const result=await f.api.uploadDeckAttachment({id:f.record('card').id});assert.equal(result.cancelled,true);assert.equal(result.attachments.length,1)
})

test('native event details and reminders persist through booking, edits and restart without changing linked work',async t=>{
  const f=await fixture({isNative:true});t.after(f.close)
  const start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString(),workTitle=f.record('task').title
  f.state=await f.api.createLinkedEvent({...f.request(),title:'Visit',description:'Editable work reference',location:'Studio',reminders:[15],start,end})
  const event=f.state.records.find(record=>record.kind==='event')
  assert.ok(f.state.nativeOperations.includes('updateEvent'));assert.equal(event.location,'Studio');assert.deepEqual(event.reminders,[15])
  assert.equal(event.body,'Editable work reference');assert.equal(f.record('task').title,workTitle)
  const updated=await f.api.updateEvent({id:event.id,title:' Revised visit ',location:'Other room',description:'',reminders:[60,0]})
  const saved=updated.records.find(record=>record.id===event.id)
  assert.equal(saved.title,'Revised visit');assert.equal(saved.start,event.start);assert.equal(saved.end,event.end)
  assert.equal(saved.location,'Other room');assert.equal(saved.body,'');assert.deepEqual(saved.reminders,[0,60]);assert.equal(saved.unsupportedReminderCount,0)
  assert.ok(updated.workspace.relations.some(link=>link.toId===event.id));assert.equal(updated.records.find(record=>record.kind==='task').title,workTitle)
  const native=[...f.sources.values()].find(value=>value.body.includes('BEGIN:VEVENT')).body
  assert.match(native,/LOCATION:Other room/);assert.match(native,/BEGIN:VALARM/);assert.match(native,/ACTION:DISPLAY/)
  const beforeStale=f.writes().length;await assert.rejects(f.api.updateEvent({id:event.id,title:'Outdated draft',etag:event.etag}),{code:'CONFLICT'});assert.equal(f.writes().length,beforeStale)
  const writes=f.writes().length;await assert.rejects(f.api.updateEvent({id:event.id,reminders:[15,15]}),{code:'VALIDATION'});assert.equal(f.writes().length,writes)
  f.api.dispose();f.api=f.create();const restored=await f.api.getState(),cached=restored.records.find(record=>record.id===event.id)
  assert.equal(cached.title,'Revised visit');assert.equal(cached.location,'Other room');assert.deepEqual(cached.reminders,[0,60]);assert.equal(cached.readonly,true)
})

test('event detail conflicts and absent operation capability preserve the current record and never overwrite remotely',async t=>{
  const f=await fixture();t.after(f.close);f.state=await f.api.createLinkedEvent(f.request())
  const event=f.state.records.find(record=>record.kind==='event'),[href,remote]=[...f.sources].find(([,value])=>value.body.includes('BEGIN:VEVENT'))
  f.sources.set(href,{...remote,etag:'"changed-remotely"',body:remote.body.replace('SUMMARY:Focused work','SUMMARY:Remote revision')})
  await assert.rejects(f.api.updateEvent({id:event.id,title:'Local draft'}),{code:'CONFLICT'})
  assert.match(f.sources.get(href).body,/SUMMARY:Remote revision/);assert.equal((await f.api.getState()).records.find(record=>record.id===event.id).title,event.title)
  f.setCapabilities({davReadMode:'report'});await f.api.refresh();const before=f.writes().length
  await assert.rejects(f.api.updateEvent({id:event.id,title:'Blocked'}),{code:'UNAVAILABLE'});assert.equal(f.writes().length,before)
})

test('native task creation and exact Markdown/checklist edits are durable without full refresh',async t=>{
  const f=await fixture({isNative:true});t.after(f.close)
  const collectionId=f.state.collections.find(collection=>collection.source==='tasks').id
  const description='## Brief\n\n- [ ] Prepare draft\n- [x] Confirm scope\n\n**Preserve** whitespace  \n'
  const reads=f.calls.filter(call=>call.method==='REPORT').length
  const created=await f.api.createTask({title:' New task ',description,collectionId,start:'2030-06-11',due:'2030-06-12'})
  const task=created.records.find(record=>record.id===created.createdRecordId)
  assert.equal(task.title,'New task');assert.equal(task.body,description);assert.equal(task.start,'2030-06-11');assert.equal(task.due,'2030-06-12')
  const first=f.sources.get([...f.sources.keys()].find(href=>href!==(calendar+'task.ics')))
  assert.match(first.body,/STATUS:NEEDS-ACTION/)
  const changed=description.replace('- [ ] Prepare','- [x] Prepare')
  const updated=await f.api.updateDescription({id:task.id,description:changed,etag:task.etag})
  const saved=updated.records.find(record=>record.id===task.id)
  assert.equal(saved.body,changed);assert.equal(saved.completed,false);assert.notEqual(saved.etag,task.etag)
  assert.equal(f.calls.filter(call=>call.method==='REPORT').length,reads)
  assert.ok(f.cacheValues.get(sourceEditsKey(f.account)).entries.some(entry=>entry.record.id===task.id&&entry.record.body===changed))
  const before=f.writes().length
  await assert.rejects(f.api.updateDescription({id:task.id,description:'Stale editor',etag:task.etag}),{code:'CONFLICT'})
  assert.equal(f.writes().length,before)
  f.api.dispose();f.api=f.create();const restored=await f.api.getState()
  assert.equal(restored.records.find(record=>record.id===task.id).body,changed)
  assert.equal(restored.records.find(record=>record.id===task.id).readonly,true)
})

test('task Markdown operations reject invalid destinations, body limits and unsupported capability before writes',async t=>{
  const f=await fixture();t.after(f.close)
  const task=f.record('task'),card=f.record('card'),collectionId=f.state.collections.find(collection=>collection.source==='tasks').id
  const before=f.writes().length
  for(const change of [{title:''},{title:'x'.repeat(501)},{description:'x'.repeat(500001)},{description:'bad\0body'},{start:'invalid'},{requestId:''},{requestId:'not-a-uuid'},{requestId:'11111111-1111-9111-8111-111111111111'},{completed:'true'},{completed:1}])await assert.rejects(f.api.createTask({title:'Task',collectionId,...change}))
  await assert.rejects(f.api.createTask({title:'Task',collectionId:card.collectionId}),{code:'PERMISSION'})
  await assert.rejects(f.api.updateDescription({id:f.record('note').id,description:'Blocked'}),{code:'VALIDATION'})
  await assert.rejects(f.api.updateDescription({id:task.id,description:'bad\0body'}),{code:'VALIDATION'})
  assert.equal(f.writes().length,before)
  f.setCapabilities({davReadMode:'report'});await f.api.refresh()
  await assert.rejects(f.api.createTask({title:'Task',collectionId}),{code:'UNAVAILABLE'})
  await assert.rejects(f.api.updateDescription({id:task.id,description:'Blocked'}),{code:'UNAVAILABLE'})
  assert.equal(f.writes().length,before)
})

test('card task creation retains native request identity and initial completion across retry and restart',async t=>{
  const f=await fixture({isNative:true});t.after(f.close)
  const collectionId=f.state.collections.find(collection=>collection.source==='tasks').id
  const requestId='A1111111-1111-8111-8111-111111111111'
  const input={title:'Confirm delivery',description:'Created from the card checklist.',collectionId,requestId,completed:true}
  let state=await f.api.createTask(input)
  const task=state.records.find(record=>record.id===state.createdRecordId)
  assert.equal(task.completed,true);assert.equal(task.status,'COMPLETED')
  const href=calendar+requestId.toLowerCase()+'.ics'
  assert.match(f.sources.get(href).body,/X-NEXTSPACE-REQUEST:a1111111-1111-8111-8111-111111111111/i)
  assert.match(f.sources.get(href).body,/PERCENT-COMPLETE:100/)
  assert.match(f.sources.get(href).body,/COMPLETED:/)
  await f.api.updateDescription({id:task.id,description:'Updated independently in the native task.',etag:task.etag})
  f.api.dispose();f.api=f.create();await f.api.refresh()
  state=await f.api.createTask(input)
  const recovered=state.records.find(record=>record.id===state.createdRecordId)
  assert.equal(recovered.id,task.id);assert.equal(recovered.body,'Updated independently in the native task.');assert.equal(recovered.completed,true)
  assert.equal(state.records.filter(record=>record.source==='tasks'&&record.title==='Confirm delivery').length,1)
  assert.equal([...f.sources.keys()].filter(url=>url.endsWith(requestId.toLowerCase()+'.ics')).length,1)
  assert.ok(f.cacheValues.get(sourceEditsKey(f.account)).entries.some(entry=>entry.record.id===task.id&&entry.record.body===recovered.body))
})

test('an uncertain card-task response can retry the same request without creating another task',async t=>{
  const f=await fixture();t.after(f.close)
  const collectionId=f.state.collections.find(collection=>collection.source==='tasks').id
  const requestId='22222222-2222-8222-8222-222222222222'
  const input={title:'Prepare draft',collectionId,requestId,completed:false}
  f.loseCreate=true
  try { await f.api.createTask(input) } catch { /* A lost response may be recovered now or on the explicit retry. */ }
  const state=await f.api.createTask(input)
  const created=state.records.find(record=>record.id===state.createdRecordId)
  assert.equal(created.title,input.title);assert.equal(created.completed,false)
  assert.equal(state.records.filter(record=>record.source==='tasks'&&record.title===input.title).length,1)
  assert.equal([...f.sources.keys()].filter(url=>url.endsWith(requestId+'.ics')).length,1)
})

test('ordinary event creation uses native details and durable identity without a synthetic work link',async t=>{
  const f=await fixture();t.after(f.close)
  const collectionId=f.state.collections.find(collection=>collection.source==='calendar').id
  const state=await f.api.createEvent({collectionId,title:'Meeting',start:'2030-06-11T09:00:00Z',end:'2030-06-11T10:00:00Z',description:'## Agenda',location:'Studio',reminders:[15]})
  const event=state.records.find(record=>record.id===state.createdRecordId)
  assert.equal(event.title,'Meeting');assert.equal(event.location,'Studio');assert.equal(event.body,'## Agenda');assert.deepEqual(event.reminders,[15])
  assert.equal(state.workspace.relations.length,0)
  assert.ok(f.cacheValues.get(sourceEditsKey(f.account)).entries.some(entry=>entry.record.id===event.id))
})

test('scheduling attendees freeze in journal while absent legacy input retains its exact fingerprint',()=>{
  const input={requestId:'11111111-1111-4111-8111-111111111111',recordId:'work',collectionId:'calendar',title:'Work',start:'2030-06-11T09:00:00Z',end:'2030-06-11T10:00:00Z'}
  const old=schedulingRequest(input)
  assert.equal(Object.hasOwn(old.payload,'attendees'),false)
  const legacyDigest=sha256(JSON.stringify({recordId:'work',title:'Work',collectionId:'calendar',start:input.start,end:input.end,allDay:false,description:''}))
  assert.equal(sha256(JSON.stringify(old.payload)),legacyDigest)
  const current=schedulingRequest({...input,attendees:[{email:'guest@example.test',name:' Guest '}]})
  const journal={schemaVersion:1,requests:[{requestId:input.requestId,status:'pending',payload:current.payload,digest:sha256(JSON.stringify(current.payload))}]}
  assert.deepEqual(checkedSchedulingJournal(journal).requests[0].payload.attendees,[{email:'guest@example.test',name:'Guest'}])
  assert.throws(()=>schedulingRequest({...input,attendees:[{email:'GUEST@example.test'},{email:'guest@example.test'}]}),{code:'VALIDATION'})
})

test('organizer invitation booking and native deletion survive private recovery with participants intact',async t=>{
  const f=await fixture({isNative:true});t.after(f.close)
  f.scheduling={email:'owner@example.test'};f.state=await f.api.refresh()
  const collection=f.state.collections.find(row=>row.source==='calendar');assert.equal(collection.calendarScheduling.canInvite,true)
  f.state=await f.api.createLinkedEvent({...f.request(),start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),attendees:[{email:'guest@example.test',name:'Guest'}]})
  const event=f.state.records.find(row=>row.kind==='event')
  assert.equal(event.readonly,true,'generic invitation dragging remains protected')
  assert.equal(event.eventScheduling.role,'organizer');assert.equal(event.eventAccess.delete,true);assert.equal(event.eventAccess.editAttendees,true)
  assert.equal(event.eventScheduling.attendees[0].uri,'mailto:guest@example.test')
  assert.equal(event.eventScheduling.attendees[0].participation,'NEEDS-ACTION')
  const next=await f.api.updateEvent({id:event.id,etag:event.etag,title:'Revised invitation',attendees:[{email:'guest@example.test',name:'Guest'},{email:'second@example.test'}]})
  const saved=next.records.find(row=>row.id===event.id);assert.equal(saved.eventScheduling.attendees.length,2)
  await assert.rejects(f.api.updateDescription({id:event.id,description:'Bypass'}),{code:'VALIDATION'})
  f.cacheValues.set(launchKey(f.account),launchCheckpoint(next,cacheKey(f.account)))
  f.native.getSavedAccount=async()=>({account:f.account,capabilities:{davReadMode:'report',nativeEdits:'notes-dates-scheduling'}})
  f.api.dispose();f.api=f.create();const restored=await f.api.getState();assert.deepEqual(restored.records.find(row=>row.id===event.id).eventScheduling,saved.eventScheduling)
  assert.deepEqual(restored.records.find(row=>row.id===event.id).eventAccess,saved.eventAccess)
  assert.equal(restored.collections.find(row=>row.id===collection.id).calendarScheduling.canInvite,true)
  assert.deepEqual(restored.nativeOperations,[]);assert.equal(restored.records.find(row=>row.id===event.id).readonly,true)
  const beforeRestoreWrites=f.writes().length
  await assert.rejects(f.api.updateEvent({id:event.id,etag:saved.etag,title:'Cached authority must not authorize'}),{code:'UNAVAILABLE'})
  await assert.rejects(f.api.deleteEvent({id:event.id}),{code:'UNAVAILABLE'})
  assert.equal(f.writes().length,beforeRestoreWrites)
  await f.api.refresh()
  const deleted=await f.api.deleteEvent({id:event.id});assert.ok(!deleted.records.some(row=>row.id===event.id))
  assert.ok(deleted.workspace.relations.some(link=>link.toId===event.id))
})

test('attendee responses and personal reminders are native while detail/delete and stale authority stay protected',async t=>{
  const f=await fixture();t.after(f.close);f.scheduling={email:'guest@example.test'}
  const start=new Date(Date.now()+3600000).toISOString().replaceAll(/[-:]/g,'').replace('.000','').replace(/\.\d{3}/,'')
  const end=new Date(Date.now()+7200000).toISOString().replaceAll(/[-:]/g,'').replace('.000','').replace(/\.\d{3}/,'')
  f.sources.set(calendar+'invitation.ics',{etag:'"invite-1"',body:ics(['BEGIN:VEVENT','UID:invitation','SUMMARY:Invitation',`DTSTART:${start}`,`DTEND:${end}`,'SEQUENCE:4','ORGANIZER:mailto:owner@example.test','ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@example.test','ATTENDEE;PARTSTAT=ACCEPTED:mailto:second@example.test','END:VEVENT'])})
  f.state=await f.api.refresh();const event=f.state.records.find(row=>row.kind==='event')
  assert.equal(event.eventScheduling.role,'attendee');assert.equal(event.readonly,true);assert.equal(event.eventAccess.respond,true);assert.equal(event.eventAccess.editDetails,false)
  const before=f.writes().length
  await assert.rejects(f.api.deleteEvent({id:event.id}),{code:'PERMISSION'})
  await assert.rejects(f.api.updateEvent({id:event.id,title:'Not owner',etag:event.etag}),{code:'PERMISSION'})
  assert.equal(f.writes().length,before)
  const next=await f.api.respondToEvent({id:event.id,etag:event.etag,participation:'TENTATIVE'})
  const answered=next.records.find(row=>row.id===event.id);assert.equal(answered.eventScheduling.attendees[0].participation,'TENTATIVE');assert.equal(answered.eventScheduling.attendees[0].rsvp,false)
  assert.match(f.sources.get(calendar+'invitation.ics').body,/SEQUENCE:4/);assert.equal(answered.eventScheduling.attendees[1].participation,'ACCEPTED')
  const reminder=await f.api.updateEvent({id:event.id,etag:answered.etag,reminders:[30]});assert.deepEqual(reminder.records.find(row=>row.id===event.id).reminders,[30])
  const count=f.writes().length;f.scheduling.email='other@example.test'
  await assert.rejects(f.api.respondToEvent({id:event.id,etag:reminder.records.find(row=>row.id===event.id).etag,participation:'ACCEPTED'}),{code:'PERMISSION'})
  assert.equal(f.writes().length,count,'fresh identity revalidation forbids cached-authority writes')
})

test('acknowledged invitation readback warning remains visible after durable linked booking',async t=>{
  const f=await fixture();t.after(f.close);f.scheduling={email:'owner@example.test'};f.state=await f.api.refresh();f.failEventReads=true
  const input={...f.request(),attendees:[{email:'guest@example.test'}]}
  const result=await f.api.createLinkedEvent(input),event=result.records.find(row=>row.kind==='event')
  assert.ok(result.creationWarning);assert.equal(event.readonly,true);assert.equal(event.eventAccess.editDetails,false)
  assert.ok(result.workspace.relations.some(link=>link.toId===event.id))
  assert.equal(f.cacheValues.get(schedulingKey(f.account)).requests[0].status,'linked')
  const before=f.writes().length;await f.api.createLinkedEvent(input);assert.equal(f.writes().length,before)
})


test('Deck description writes preserve native card fields, conflict checks and durable acknowledgement',async t=>{
 const f=await fixture({isNative:true});t.after(f.close);const card=f.record('card'),before=structuredClone(f.card)
 const description='## Native checklist\n- [x] Prepare\n- [ ] Review'
 const result=await f.api.updateDescription({id:card.id,description,etag:card.etag})
 assert.equal(result.records.find(item=>item.id===card.id).body,description)
 for(const field of ['title','owner','order','color','done','archived'])assert.equal(f.card[field],before[field])
 assert.ok(f.cacheValues.get(sourceEditsKey(f.account)).entries.some(entry=>entry.record.id===card.id&&entry.record.body===description))
 const count=f.writes().length
 await assert.rejects(f.api.updateDescription({id:card.id,description:'Stale',etag:card.etag}),{code:'CONFLICT'})
 f.denyDeckEdit=true
 await assert.rejects(f.api.updateDescription({id:card.id,description:'Denied'}),{code:'PERMISSION'})
 assert.equal(f.writes().length,count)
})

test('Deck creation uses current board and stack, preserves Markdown and acknowledgement without a source scan',async t=>{
 const f=await fixture({isNative:true});t.after(f.close);const collectionId=f.record('card').collectionId
 const input={title:' New assignment ',description:'## Scope\n- [ ] First step',collectionId,stackId:'2',assignToMe:true,start:'2030-06-11',due:'2030-06-12'}
 const scans=f.calls.filter(call=>call.url.endsWith('/boards?details=true')).length
 const state=await f.api.createCard(input),record=state.records.find(item=>item.id===state.createdRecordId)
 assert.equal(record.title,'New assignment');assert.equal(record.body,input.description);assert.equal(record.stackId,'2');assert.deepEqual(record.assigneeIds,['tester']);assert.equal(state.creationWarning,undefined)
 assert.equal(f.calls.filter(call=>call.url.endsWith('/boards?details=true')).length,scans)
 assert.ok(f.cacheValues.get(sourceEditsKey(f.account)).entries.some(entry=>entry.record.id===record.id))
 const creates=f.writes().filter(call=>call.method==='POST').length
 for(const change of [{title:'x'.repeat(256)},{stackId:'99'},{assignToMe:'yes'},{description:'bad\0text'},{start:'2030-06-13',due:'2030-06-11'}])await assert.rejects(f.api.createCard({...input,...change}))
 f.denyDeckEdit=true;await assert.rejects(f.api.createCard(input),{code:'PERMISSION'})
 assert.equal(f.writes().filter(call=>call.method==='POST').length,creates)
})

test('Deck acknowledged creation keeps its identity when optional readback fails',async t=>{
 const f=await fixture();t.after(f.close);f.failCardReadback=true
 const state=await f.api.createCard({title:'Saved assignment',collectionId:f.record('card').collectionId,stackId:'2'})
 assert.ok(state.createdRecordId);assert.match(state.creationWarning,/do not create it again/i)
 assert.equal(state.records.find(item=>item.id===state.createdRecordId).readonly,true)
 assert.equal(f.writes().filter(call=>call.method==='POST').length,1)
})

test('native dependency add/remove preserves direction and durable state without changing other card fields',async t=>{
 const f=await fixture({isNative:true});t.after(f.close)
 f.card.dependentCards=[];f.extraCards=[{...f.card,id:5,title:'Prerequisite',dependentCards:[]}];f.state=await f.api.refresh()
 const from=f.record('card'),to=f.state.records.find(record=>record.title==='Prerequisite')
 const before=structuredClone(f.card)
 let state=await f.api.setDeckDependency({fromId:from.id,toId:to.id})
 assert.deepEqual(f.card.dependentCards,[5]);assert.ok(state.records.find(record=>record.id===from.id).nativeDependencies.length===1)
 state=await f.api.setDeckDependency({fromId:from.id,toId:to.id,remove:true})
 assert.deepEqual(f.card.dependentCards,[]);assert.equal(state.records.find(record=>record.id===from.id).nativeDependencies.length,0)
 for(const field of ['title','description','done','stackId'])assert.equal(f.card[field],before[field])
 const writes=f.writes();assert.deepEqual(writes.map(call=>call.method),['POST','DELETE']);assert.ok(writes.every(call=>call.url.endsWith('/cards/3/dependentCards/5')))
 assert.ok(f.cacheValues.get(sourceEditsKey(f.account)).entries.some(entry=>entry.record.id===from.id&&entry.record.nativeDependencies.length===0))
 await assert.rejects(f.api.setDeckDependency({fromId:from.id,toId:from.id}),{code:'VALIDATION'})
 await assert.rejects(f.api.setDeckDependency({fromId:from.id,toId:to.id,remove:'yes'}),{code:'VALIDATION'})
 f.denyDeckEdit=true;await assert.rejects(f.api.setDeckDependency({fromId:from.id,toId:to.id}),{code:'PERMISSION'})
 assert.equal(f.writes().length,writes.length)
})

test('native task status and Deck stack changes are separate from completion and preserve acknowledged state',async t=>{
 const f=await fixture({isNative:true});t.after(f.close);const task=f.record('task'),card=f.record('card')
 for(const status of ['IN-PROCESS','CANCELLED','COMPLETED','NEEDS-ACTION']){
   const state=await f.api.updateTaskStatus({id:task.id,status});assert.equal(state.records.find(record=>record.id===task.id).status,status)
 }
 await assert.rejects(f.api.updateTaskStatus({id:task.id,status:'Doing'}),{code:'VALIDATION'})
 const state=await f.api.moveCard({id:card.id,stackId:'6'}),moved=state.records.find(record=>record.id===card.id)
 assert.equal(moved.stackId,'6');assert.equal(moved.completed,false);assert.equal(f.card.done,null)
 assert.ok(f.cacheValues.get(sourceEditsKey(f.account)).entries.some(entry=>entry.record.id===card.id&&entry.record.stackId==='6'))
 await assert.rejects(f.api.moveCard({id:card.id,stackId:'99'}),{code:'VALIDATION'})
})

test('Deck destination reorder adopts its verified revision before the next edit and survives restart',async t=>{
 const f=await fixture({isNative:true});t.after(f.close);const card=f.record('card')
 const inventories=f.calls.filter(call=>call.url.endsWith('/boards/1/stacks')).length
 let state=await f.api.moveCard({id:card.id,stackId:'6'})
 let moved=state.records.find(record=>record.id===card.id)
 assert.equal(moved.stackId,'6');assert.equal(moved.status,'Done');assert.equal(moved.completed,false)
 const move=f.writes().find(call=>call.url.endsWith('/reorder'))
 assert.equal(move.url,cards.replace('/stacks/2/','/stacks/6/')+'/reorder')
 assert.deepEqual(JSON.parse(move.body),{stackId:6,order:99999})
 const acknowledged=f.cacheValues.get(sourceEditsKey(f.account)).entries.find(entry=>entry.record.id===card.id).record
 assert.equal(acknowledged.remote.stackId,6);assert.equal(acknowledged.remote.snapshot.stackId,6)
 assert.equal(acknowledged.remote.lastModified,f.card.lastModified)
 assert.equal(acknowledged.remote.snapshot.lastModified,f.card.lastModified)
 assert.equal(acknowledged.etag,f.card.ETag)
 assert.match(acknowledged.identity.locator,/\/stacks\/6\/cards\/3$/)
 state=await f.api.updateDescription({id:card.id,description:'Edited after moving'})
 moved=state.records.find(record=>record.id===card.id)
 assert.equal(moved.body,'Edited after moving');assert.equal(moved.stackId,'6')
 assert.equal(f.writes().at(-1).url,cards.replace('/stacks/2/','/stacks/6/'))
 assert.equal(f.calls.filter(call=>call.url.endsWith('/boards/1/stacks')).length,inventories)
 for(const read of f.calls.filter(call=>call.method==='GET'&&(call.url===cards||call.url===cards.replace('/stacks/2/','/stacks/6/'))).slice(-3))assert.equal(new Headers(read.headers).get('Cache-Control'),'no-cache')
 f.api.dispose();f.api=f.create();state=await f.api.getState()
 const restored=state.records.find(record=>record.id===card.id)
 assert.equal(restored.stackId,'6');assert.equal(restored.body,'Edited after moving')
 await assert.rejects(f.api.moveCard({id:card.id,stackId:'2'}),{code:'UNAVAILABLE'})
 await f.api.refresh()
 f.reorderReadback=true
 state=await f.api.moveCard({id:card.id,stackId:'2'})
 assert.equal(state.records.find(record=>record.id===card.id).stackId,'2')
 assert.equal(state.records.find(record=>record.id===card.id).body,'Edited after moving')
})

test('Deck moves preserve true conflicts and permission failures without writing or forging acknowledgement',async t=>{
 const f=await fixture({isNative:true});t.after(f.close);const card=f.record('card'),original=clone(f.card)
 f.card={...f.card,description:'Changed in native Deck',lastModified:2}
 await assert.rejects(f.api.moveCard({id:card.id,stackId:'6'}),{code:'CONFLICT'})
 assert.equal(f.writes().length,0);assert.equal((await f.api.getState()).records.find(record=>record.id===card.id).stackId,'2')
 assert.equal(f.card.description,'Changed in native Deck')
 f.card=original;f.denyDeckEdit=true
 await assert.rejects(f.api.moveCard({id:card.id,stackId:'6'}),{code:'PERMISSION'})
 assert.equal(f.writes().length,0)
 assert.equal(f.cacheValues.get(sourceEditsKey(f.account))?.entries?.length||0,0)
})

test('native Deck label creation and appearance match task categories/colors and recover across restart',async t=>{
 const f=await fixture({isNative:true});t.after(f.close);const card=f.record('card'),task=f.record('task')
 const created=await f.api.createDeckLabel({collectionId:card.collectionId,title:'Project',color:'#4488aa'})
 assert.equal(created.label.title,'Project');assert.equal(created.state.collections.find(collection=>collection.id===card.collectionId).labels[0].id,'20')
 const again=await f.api.createDeckLabel({collectionId:card.collectionId,title:'project'});assert.equal(again.label.id,'20')
 assert.equal(f.writes().filter(call=>call.url.endsWith('/labels')).length,1)
 let state=await f.api.updateRecordAppearance({id:card.id,color:'#cc7788',tagIds:['20']})
 assert.equal(state.records.find(record=>record.id===card.id).color,'#cc7788');assert.deepEqual(state.records.find(record=>record.id===card.id).tags,['Project'])
 state=await f.api.updateRecordAppearance({id:task.id,color:'#334455',tags:['Project','Review']})
 assert.equal(state.records.find(record=>record.id===task.id).color,'#334455');assert.deepEqual(state.records.find(record=>record.id===task.id).tags,['Project','Review'])
 await assert.rejects(f.api.updateRecordAppearance({id:card.id,tags:['Wrong representation']}),{code:'VALIDATION'})
 await assert.rejects(f.api.updateRecordAppearance({id:task.id,tagIds:['20']}),{code:'VALIDATION'})
 const restarted=f.create();t.after(()=>restarted.dispose());const restored=await restarted.getState()
 assert.ok(restored.collections.find(collection=>collection.id===card.collectionId).labels.some(label=>label.id==='20'))
})

test('related resources uses shared safe native recommendations',async t=>{
 const f=await fixture({isNative:true});t.after(f.close)
 const result=await f.api.readRelatedResources({id:f.record('card').id})
 assert.equal(result.available,true);assert.equal(result.resources[0].title,'Project brief');assert.match(result.resources[0].url,/^https:\/\/fixture\.invalid\/nextcloud\//)
})

test('planner export uses the restored metadata snapshot without private source or account data or cloud writes',async t=>{
 const f=await fixture({isNative:true});t.after(f.close);const before=f.writes().length,state=await f.api.getState()
 assert.deepEqual(await f.api.exportWorkspace(),{exported:true});assert.deepEqual(f.exports[0],state.workspace)
 for(const key of ['records','collections','connection','account','nativeOperations'])assert.equal(Object.hasOwn(f.exports[0],key),false)
 f.exportResult={exported:false};assert.deepEqual(await f.api.exportWorkspace(),{exported:false});assert.equal(f.writes().length,before)
})

test('planner export refuses uninitialized cloud metadata instead of exporting an empty replacement',async t=>{
 const f=await fixture({isNative:true,metadataReady:false});t.after(f.close)
 await assert.rejects(f.api.exportWorkspace(),{code:'METADATA_NOT_READY'});assert.equal(f.exports.length,0)
})

test('Collective image reader loads only a raster inside the selected page collective',async t=>{
 const f=await fixture({isNative:true});t.after(f.close);f.includePage=true;f.state=await f.api.refresh();const page=f.record('page')
 const result=await f.api.readPageAsset({id:page.id,path:'diagram.png'});assert.match(result.dataUrl,/^data:image\/png;base64,/)
 for(const path of ['../../private.png','https://outside.example/image.png','/another/image.png'])await assert.rejects(f.api.readPageAsset({id:page.id,path}),{code:'SECURITY'})
 await assert.rejects(f.api.readPageAsset({id:f.record('card').id,path:'diagram.png'}),{code:'UNAVAILABLE'})
 f.assetMime='image/svg+xml';await assert.rejects(f.api.readPageAsset({id:page.id,path:'diagram.png'}),{code:'FORMAT'})
 f.assetMime='image/png';f.assetBody=new Uint8Array(4*1024*1024+1);await assert.rejects(f.api.readPageAsset({id:page.id,path:'diagram.png'}),{code:'LIMIT'})
 delete f.assetBody;f.denySourceAuth=true;await assert.rejects(f.api.readPageAsset({id:page.id,path:'diagram.png'}),{code:'AUTH'})
 assert.equal((await f.api.getState()).connection.reconnectRequired,true)
})

test('a late source read retains acknowledged board labels without freezing newer card data or revoked boards',()=>{
 const board={id:'board',source:'deck',title:'Board',labels:[{id:'20',title:'Project',color:'#4488aa'}]},record={id:'card',source:'deck',kind:'card',title:'Old title',collectionId:'board'}
 const state={records:[record],collections:[board],statuses:[{source:'deck',state:'connected',count:1}]}
 const incoming={records:[{...record,title:'Remote title'}],collections:[{...board,labels:[]}],statuses:[{source:'deck',state:'connected',count:1}]}
 const merge=value=>mergeEditedRefresh(state,value,new Map(),new Map(),new Map(),new Map(),['deck'],new Map(),new Map([['board',1]]))
 const result=merge(incoming);assert.equal(result.records[0].title,'Remote title');assert.equal(result.collections[0].labels[0].id,'20')
 const revoked=merge({...incoming,collections:[],records:[],statuses:[{source:'deck',state:'error',count:0,permissionDenied:true}]})
 assert.equal(revoked.collections.length,0);assert.equal(revoked.records.length,0)
})
