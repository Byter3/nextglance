import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createEmptyState} from '@nextspace/core/planner.mjs'
const {createRenderer,nextTick,effect,stop,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual App coalesces supplied snapshots and protects drafts, account and direct native acknowledgements',async()=>{
  const originals=new Map(),frames=new Map();let frameId=0
  const set=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true})}
  const noop=()=>{},media={matches:false,addEventListener:noop,removeEventListener:noop}
  set('window',{innerWidth:900,matchMedia:()=>media,addEventListener:noop,removeEventListener:noop,confirm:()=>false})
  set('document',{hidden:false,addEventListener:noop,removeEventListener:noop,querySelector:()=>null,getElementById:()=>null,documentElement:{dataset:{},style:{setProperty:noop,removeProperty:noop}}})
  set('navigator',{onLine:true});set('localStorage',{getItem:()=>null,setItem:noop});set('getComputedStyle',()=>({getPropertyValue:()=>'#171717'}))
  set('ResizeObserver',class{observe(){}disconnect(){}});set('requestAnimationFrame',fn=>{frames.set(++frameId,fn);return frameId});set('cancelAnimationFrame',id=>frames.delete(id))
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  let app
  try{
    let host=createEmptyState(),reads=0,notify
    host.connection={connected:true,serverUrl:'https://cloud.example.test',username:'fixture'}
    host.records=Array.from({length:2000},(_,i)=>({id:`task-${i}`,kind:'task',source:'tasks',collectionId:'tasks',title:`Task ${i}`,body:'Fixture content'}))
    const api={getState:async()=>{reads++;return structuredClone(host)},resumeSync:async()=>{}}
    const {default:App}=await server.ssrLoadModule('/src/App.vue')
    const renderer=createRenderer({createElement:type=>({type}),createText:text=>({text}),createComment:text=>({text}),setText:noop,setElementText:noop,parentNode:()=>null,nextSibling:()=>null,patchProp:noop,insert:noop,remove:noop})
    app=renderer.createApp({...App,render:()=>null,ssrRender:undefined},{api,subscribe:callback=>{notify=callback;return noop}});app.provide(ssrContextKey,{modules:new Set()})
    const setup=app.mount({}).$.setupState,settle=async()=>{await new Promise(resolve=>setTimeout(resolve,20));await nextTick()}
    await settle();assert.equal(reads,1)
    let publications=0;const observing=effect(()=>{setup.state;publications++})
    const start=performance.now()
    for(let i=0;i<100;i++){const incoming=structuredClone(host);incoming.records[0].title=`Remote ${i}`;notify(incoming)}
    await settle()
    assert.equal(setup.state.records[0].title,'Remote 99');assert.equal(publications,2);assert.equal(reads,1)
    const burstElapsed=performance.now()-start
    host=structuredClone(host);host.records[0].title='Remote next';notify(structuredClone(host));await settle()
    assert.equal(setup.state.records[0].title,'Remote next','drain uses last adopted baseline, not old enqueue baseline')
    const branch=setup.state.records;const statusOnly=structuredClone(host);statusOnly.storage.message='Background check';notify(statusOnly);await settle()
    assert.equal(setup.state.records,branch,'unchanged records keep their Vue branch')
    setup.state.records[1].title='Local draft';const incoming=structuredClone(host);incoming.records[1].title='Conflicting remote';notify(incoming);await settle()
    assert.equal(setup.state.records[1].title,'Local draft')
    const foreign=structuredClone(host);foreign.connection.username='another-fixture';foreign.records[0].title='Wrong account';notify(foreign);await settle();assert.equal(setup.state.records[0].title,'Remote next')
    host.records[0].title='Saved with no queued notification'
    await setup.saveSourceEdit('task-0',{title:host.records[0].title},async()=>structuredClone(host));await settle()
    assert.equal(reads,1)
    host.records[0].title='New remote after acknowledgement';notify(structuredClone(host));await settle()
    assert.equal(setup.state.records[0].title,'New remote after acknowledgement','acknowledged edits must not look like perpetual local drafts')
    assert.equal(setup.state.records[1].title,'Local draft','advancing one record baseline preserves another unsaved draft')
    setup.busy=true
    const older=structuredClone(host);older.records[0].title='Before native edit';notify(older)
    host.records[0].title='Acknowledged edit'
    await setup.saveSourceEdit('task-0',{title:'Acknowledged edit'},async()=>structuredClone(host))
    setup.busy=false;await settle()
    assert.equal(reads,2,'one refresh only for ambiguous queued/native acknowledgement ordering')
    assert.equal(setup.state.records[0].title,'Acknowledged edit')
    const denied=structuredClone(host);denied.records=[];denied.statuses=[{source:'tasks',state:'error',count:0,permissionDenied:true}];notify(denied);await settle()
    assert.equal(setup.state.records.length,0,'revocation still removes even locally edited source rows')
    stop(observing)
    console.log(`Fixture: 100 supplied 2,000-record notifications -> 1 adoption; ${burstElapsed.toFixed(1)} ms including fixture clones/timer; no redundant getState.`)
  }finally{app?.unmount();await server.close();for(const [name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}}
})
