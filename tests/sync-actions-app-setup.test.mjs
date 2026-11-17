import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {readFile} from 'node:fs/promises'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createEmptyState} from '@nextspace/core/planner.mjs'
const {createRenderer,nextTick,effect,stop,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual App supports native attachment capabilities, guarded event deletion and quiet sync details',async()=>{
  const originals=new Map(),frames=new Map(),scrolls=[];let frameId=0,app
  const set=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true})}
  const noop=()=>{},media={matches:false,addEventListener:noop,removeEventListener:noop}
  set('window',{innerWidth:900,matchMedia:()=>media,addEventListener:noop,removeEventListener:noop,confirm:()=>false})
  set('document',{hidden:false,visibilityState:'visible',addEventListener:noop,removeEventListener:noop,querySelector:selector=>selector.startsWith('.settings-')||selector==='.planner-storage-settings'?{scrollIntoView:()=>scrolls.push(selector)}:null,getElementById:()=>null,documentElement:{dataset:{},style:{setProperty:noop,removeProperty:noop}}})
  set('navigator',{onLine:true});set('localStorage',{getItem:()=>null,setItem:noop});set('getComputedStyle',()=>({getPropertyValue:()=>'#171717'}));set('ResizeObserver',class{observe(){}disconnect(){}})
  set('HTMLElement',class{})
  set('requestAnimationFrame',fn=>{frames.set(++frameId,fn);return frameId});set('cancelAnimationFrame',id=>frames.delete(id))
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const host=createEmptyState();host.connection={connected:true,serverUrl:'https://cloud.example.test',username:'fixture'}
    host.statuses=['calendar','deck','notes','tasks'].map(source=>({source,state:'connected',count:1}))
    host.collections=[{id:'calendar',source:'calendar',title:'Work calendar'},{id:'deck',source:'deck',title:'Work board',stacks:[{id:'1',title:'To do'}]},{id:'notes',source:'notes',title:'Notes'},{id:'tasks',source:'tasks',title:'Tasks'}]
    host.records=[{id:'event',source:'calendar',kind:'event',collectionId:'calendar',title:'Project review',start:'2026-11-13T10:00:00Z',end:'2026-11-13T11:00:00Z',etag:'"v1"'},{id:'card',source:'deck',kind:'card',collectionId:'deck',title:'Prepare review'},{id:'note',source:'notes',kind:'note',collectionId:'notes',title:'Review brief',fileId:'42'}]
    host.workspace.relations=[{id:'booking',type:'scheduled_during',fromId:'card',toId:'event'}]
    host.nativeOperations=['attachDeckFile','removeDeckAttachment','uploadDeckAttachment','listFiles','readDeckAttachments','deleteEvent','updateEvent','respondToEvent','createTask','createCard','updateDescription']
    const calls=[];let failDelete=false,failAttach=false
    const api={getState:async()=>structuredClone(host),resumeSync:async()=>{},listFiles:async()=>({path:'/',files:[]}),readDeckAttachments:async()=>({attachments:[]}),removeDeckAttachment:async()=>({attachments:[]}),uploadDeckAttachment:async()=>({attachments:[],cancelled:true}),attachDeckFile:async input=>{calls.push(['attach',input]);if(failAttach)throw new Error('Permission changed');host.records.find(item=>item.id==='card').attachmentFileIds=['42'];return {attachments:[{id:'a',fileId:'42'}]}},deleteEvent:async input=>{calls.push(['delete',input]);if(failDelete)throw new Error('This event changed on Nextcloud');host.records=host.records.filter(item=>item.id!==input.id);return structuredClone(host)}}
    let failEventEdit=false
    api.updateEvent=async input=>{calls.push(['edit',input]);if(failEventEdit)throw new Error('Event version changed');const record=host.records.find(item=>item.id===input.id);for(const key of ['title','location','reminders'])if(key in input)record[key]=input[key];if('description' in input)record.body=input.description;return structuredClone(host)}
    api.respondToEvent=async input=>{calls.push(['respond',input]);const record=host.records.find(item=>item.id===input.id);record.eventScheduling.attendees[0].participation=input.participation;return structuredClone(host)}
    api.createTask=async input=>{calls.push(['createTask',input]);host.records.push({id:'new-task',kind:'task',source:'tasks',collectionId:'tasks',title:input.title,body:input.description});return structuredClone(host)}
    api.createCard=async input=>{calls.push(['createCard',input]);host.records.push({id:'new-card',kind:'card',source:'deck',collectionId:input.collectionId,title:input.title,body:input.description});return {...structuredClone(host),createdRecordId:'new-card'}}
    api.updateDescription=async input=>{calls.push(['description',input]);host.records.find(item=>item.id===input.id).body=input.description;return structuredClone(host)}
    const {default:App}=await server.ssrLoadModule('/src/App.vue')
    const renderer=createRenderer({createElement:type=>({type,children:[]}),createText:text=>({text}),createComment:text=>({text}),setText:noop,setElementText:noop,parentNode:()=>null,nextSibling:()=>null,patchProp:noop,insert:noop,remove:noop})
    app=renderer.createApp({...App,render:()=>null,ssrRender:undefined},{api,canMutateNative:false,nativeOperations:host.nativeOperations})
    app.provide(ssrContextKey,{modules:new Set()});const setup=app.mount({}).$.setupState
    await new Promise(resolve=>setTimeout(resolve,0));await nextTick()
    const card=()=>setup.state.records.find(record=>record.id==='card'),event=()=>setup.state.records.find(record=>record.id==='event')
    for(const operation of ['attachDeckFile','removeDeckAttachment','uploadDeckAttachment'])assert.equal(setup.canAttachDeck(card(),operation),true)
    assert.equal(setup.sourceWritable('deck'),false,'unsupported broad native writes stay disabled')
    setup.state.nativeOperations=['deleteEvent'];assert.equal(setup.canAttachDeck(card()),false)
    setup.state.nativeOperations=host.nativeOperations;setup.state.collections[1].readonly=true;assert.equal(setup.canAttachDeck(card()),false);setup.state.collections[1].readonly=false
    setup.panelRecordId='card';failAttach=true;await setup.addNotes(['note']);assert.match(setup.error,/Permission changed/);assert.equal(setup.state.workspace.relations.length,1,'failed attachment never creates a custom fallback')
    failAttach=false;await setup.addNotes(['note']);assert.deepEqual(card().attachmentFileIds,['42']);assert.equal(setup.saveError,'','native attachment with no obsolete custom relation does not schedule a planner write')
    assert.equal(setup.canEditEvent(event()),true);setup.selectedId='event';await setup.openEventEditor();assert.equal(setup.modal,'edit-event');failEventEdit=true
    await setup.saveEvent({id:'event',etag:'"v1"',location:'Studio'});assert.equal(setup.modal,'edit-event');assert.match(setup.error,/version changed/);assert.equal(event().location,undefined)
    setup.discardSourceEdit('event');failEventEdit=false;await setup.saveEvent({id:'event',etag:'"v1"',location:'Studio',reminders:[]});assert.equal(event().location,'Studio');assert.deepEqual(event().reminders,[]);assert.equal(event().start,'2026-11-13T10:00:00Z');assert.equal(calls.filter(([kind])=>kind==='edit')[1][1].etag,'"v1"');assert.equal(setup.modal,null)
    setup.state.nativeOperations=[];assert.match(setup.eventActionReason(event(),'updateEvent'),/temporarily unavailable/);setup.state.nativeOperations=host.nativeOperations
    setup.state.connection.connected=false;assert.match(setup.eventActionReason(event(),'deleteEvent'),/Connect/);setup.state.connection.connected=true
    assert.ok(setup.captureKinds.includes('task'));assert.ok(setup.captureKinds.includes('card'));await setup.capture({type:'task',title:'Checklist task',collectionId:'tasks',content:'## Checklist\n- [ ] First\n- [x] Second'});assert.equal(calls.find(([kind])=>kind==='createTask')[1].description,'## Checklist\n- [ ] First\n- [x] Second');assert.equal(setup.canEditContent,true)
    setup.state.statuses.find(status=>status.source==='deck').state='error';assert.equal(setup.sourceWritable('deck','createCard'),false)
    setup.state.nativeWriteSources=['deck'];assert.equal(setup.sourceWritable('deck','createCard'),true);assert.equal(setup.sourceAvailable('deck'),false,'read status remains partial')
    setup.state.nativeWriteSources=[];assert.equal(setup.sourceWritable('deck','createCard'),false)
    delete setup.state.nativeWriteSources;setup.state.statuses.find(status=>status.source==='deck').state='connected'
    await setup.openBoardCapture('deck');await nextTick();assert.equal(setup.captureType,'card');assert.equal(setup.captureDestinations.card,'deck');assert.equal(setup.modal,'capture');setup.modal=null
    setup.selectedId='card';assert.equal(setup.canEditContent,true,'exact description capability enables native Deck editing');setup.selectedId='event'
    const invitation={readonly:true,eventAccess:{editDetails:false,editReminders:true,editAttendees:false,respond:true,delete:false,reason:'not-organizer'},eventScheduling:{role:'attendee',organizer:{uri:'mailto:owner@example.test'},ownAttendeeUri:'mailto:guest@example.test',attendees:[{uri:'mailto:guest@example.test',participation:'NEEDS-ACTION'}]}}
    Object.assign(host.records.find(item=>item.id==='event'),structuredClone(invitation));Object.assign(event(),structuredClone(invitation));assert.equal(setup.canEditEvent(event()),true);assert.equal(setup.canDeleteEvent(event()),false);assert.match(setup.eventActionReason(event(),'deleteEvent'),/organizer/)
    setup.editContent();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(setup.modal,'edit-event','event description edit uses unified event editor');setup.modal=null
    assert.equal(setup.selectedId,'event');assert.equal(setup.canRespondEvent(event()),true);await setup.respondEvent('TENTATIVE');assert.equal(setup.error,'');assert.deepEqual(calls.find(([kind])=>kind==='respond')[1],{id:'event',etag:'"v1"',participation:'TENTATIVE'});assert.equal(event().eventScheduling.attendees[0].participation,'TENTATIVE')
    for(const row of [event(),host.records.find(item=>item.id==='event')]){delete row.eventAccess;delete row.eventScheduling;row.readonly=false}
    assert.equal(setup.canDeleteEvent(event()),true);setup.state.statuses[0].state='error';assert.equal(setup.canDeleteEvent(event()),false);assert.equal(setup.canEditEvent(event()),false);assert.match(setup.eventActionReason(event(),'deleteEvent'),/Refresh Calendar/);setup.state.statuses[0].state='connected'
    await setup.requestDeleteEvent(event());assert.equal(setup.modal,'delete-event');assert.equal(calls.filter(([kind])=>kind==='delete').length,0,'request only opens confirmation')
    setup.closeModal();assert.ok(event(),'cancel preserves the event')
    await setup.requestDeleteEvent(event());event().title='Updated review';assert.equal(setup.deleteEventChanged,true);await setup.confirmDeleteEvent();assert.equal(calls.filter(([kind])=>kind==='delete').length,0,'changed confirmation cannot delete hidden new details')
    await setup.requestDeleteEvent(event());failDelete=true;await setup.confirmDeleteEvent();assert.ok(event());assert.equal(setup.modal,'delete-event');assert.match(setup.error,/changed on Nextcloud/)
    failDelete=false;await setup.confirmDeleteEvent();assert.equal(event(),undefined);assert.ok(card());assert.equal(setup.state.workspace.relations[0].toId,'event','linked work and unresolved metadata stay intact')
    setup.state.storage={...setup.state.storage,syncStatus:'error',errorCode:'TIMEOUT'}
    assert.equal(setup.connectionNoticePresentation,'indicator');setup.syncing=true;await setup.openSyncDetails();assert.equal(setup.modal,'settings');assert.equal(setup.settingsContentReady,false);assert.deepEqual(scrolls,[])
    await nextTick();const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(0));await new Promise(resolve=>setTimeout(resolve,0));await nextTick()
    assert.equal(setup.settingsContentReady,true);assert.equal(setup.calendarColorsOpen,false);assert.deepEqual(scrolls,['.planner-storage-settings'])
    setup.state.storage.errorCode='CACHE_WRITE';assert.equal(setup.connectionNoticePresentation,'banner');setup.syncing=false;setup.closeModal()
    await setup.openSyncDetails();setup.closeModal();await nextTick();const obsolete=[...frames.values()];frames.clear();obsolete.forEach(fn=>fn(0));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(setup.settingsContentReady,false,'closing cancels deferred settings mount')
    let projections=0;const observing=effect(()=>{setup.model;projections++})
    for(let i=0;i<30;i++)setup.state.connection={...setup.state.connection,restoreError:`Progress ${i}`}
    assert.equal(projections,1,'connection-only progress does not rebuild the planner projection')
    setup.state.collections=[...setup.state.collections,{id:'new',source:'deck',title:'New source'}];assert.equal(projections,2,'source collection changes still invalidate mapping projections');stop(observing)
    const template=await readFile(new URL('../packages/ui/src/App.vue',import.meta.url),'utf8')
    assert.match(template,/v-if="selected.kind==='event'" class="button danger" :disabled="!canDeleteEvent/);assert.match(template,/event-delete-reason/);assert.match(template,/<EventSummary/);
    assert.match(template,/<SyncNotice v-if="connectionNotice&&connectionNoticePresentation==='banner'"/)
    assert.match(template,/class="icon-button sync-button"[^>]*@click="openSyncDetails"/)
    assert.doesNotMatch(template.match(/<button class="icon-button sync-button"[^>]+>/)[0],/:disabled=/)
    assert.match(template,/<template v-if="calendarColorsOpen">/)
  }finally{app?.unmount();await server.close();for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}}
})
