import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {readFile} from 'node:fs/promises'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createEmptyState} from '@nextspace/core/planner.mjs'
const {createRenderer,nextTick,effect,stop,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual App setup defers auxiliary reads and rejects obsolete account/selection responses',async()=>{
  // Compile the real setup and lifecycle; an inert renderer avoids browser,
  // HTTP listener and native account access. Render gating is checked below.
  const originals=new Map(),frames=new Map(),styles=new Map();let frameId=0
  const set=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true})}
  const noop=()=>{},media={matches:false,addEventListener:noop,removeEventListener:noop}
  set('window',{innerWidth:900,matchMedia:()=>media,addEventListener:noop,removeEventListener:noop,confirm:()=>false})
  set('document',{hidden:false,visibilityState:'visible',addEventListener:noop,removeEventListener:noop,querySelector:()=>null,getElementById:()=>null,documentElement:{dataset:{},style:{setProperty:(key,value)=>styles.set(key,value),removeProperty:key=>styles.delete(key)}}})
  set('navigator',{onLine:true});set('localStorage',{getItem:()=>null,setItem:noop})
  set('getComputedStyle',()=>({getPropertyValue:()=>'#171717'}))
  set('ResizeObserver',class{observe(){}disconnect(){}})
  set('requestAnimationFrame',fn=>{frames.set(++frameId,fn);return frameId});set('cancelAnimationFrame',id=>frames.delete(id))
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  let app
  try{
    const initial=createEmptyState()
    initial.connection={connected:true,serverUrl:'https://cloud.example.test',username:'test-user'}
    initial.statuses=[{source:'notes',state:'connected',count:2},{source:'collectives',state:'connected',count:2}]
    initial.records=['first','second'].map(id=>({id,kind:'note',source:'notes',collectionId:'notes',title:'Fixture note',body:'Private fixture text',tags:['Review'],tagDetails:[{id:'tag',title:'Review'}]}))
    initial.records.push(...['page-first','page-second'].map(id=>({id,kind:'page',source:'collectives',collectionId:'pages',title:'Fixture page'})))
    const reads=[],pending=[],pageReads=[],pagePending=[]
    const api={getState:async()=>structuredClone(initial),resumeSync:async()=>{},readNoteTags:input=>{reads.push(input.id);return new Promise(resolve=>pending.push(resolve))},readPage:input=>{pageReads.push(input.id);return new Promise(resolve=>pagePending.push(resolve))}}
    const {default:App}=await server.ssrLoadModule('/src/App.vue')
    const renderer=createRenderer({createElement:type=>({type,children:[]}),createText:text=>({text}),createComment:text=>({text}),setText:noop,setElementText:noop,parentNode:()=>null,nextSibling:()=>null,patchProp:noop,insert:noop,remove:noop})
    app=renderer.createApp({...App,render:()=>null,ssrRender:undefined},{api})
    app.provide(ssrContextKey,{modules:new Set()})
    const vm=app.mount({}),setup=vm.$.setupState
    await new Promise(resolve=>setTimeout(resolve,0));await nextTick()
    assert.equal(setup.state.records.length,4)
    const advance=async()=>{await nextTick();const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(0));await new Promise(resolve=>setTimeout(resolve,0));await nextTick()}
    await setup.openRecord(setup.state.records[0]);assert.equal(setup.inspectorContentReady,false);assert.deepEqual(reads,[])
    await setup.openRecord(setup.state.records[1]);await advance()
    assert.equal(setup.inspectorContentReady,true);assert.deepEqual(reads,['second'])
    assert.equal(setup.inspectorOrganizationOpen,false)
    let projections=0;const observe=effect(()=>{setup.state.records[1].tags;setup.state.records[1].tagDetails;projections++})
    pending.shift()({tags:[{id:'tag',title:'Review'}]});await nextTick();await Promise.resolve()
    assert.equal(projections,1,'equal note metadata must not invalidate source projections');stop(observe)
    await setup.openRecord(setup.state.records[0]);await advance();assert.deepEqual(reads,['second','first'])
    const oldReply=pending.shift();setup.state.connection.username='another-test-user'
    oldReply({tags:[{id:'late',title:'Obsolete'}]});await nextTick();await Promise.resolve()
    assert.deepEqual([...setup.state.records[0].tags],['Review'])
    assert.equal(setup.inspectorContentReady,false)
    await setup.closeInspector();await advance();assert.deepEqual(reads,['second','first'])
    await setup.openRecord(setup.state.records[2]);assert.deepEqual(pageReads,[])
    await setup.openRecord(setup.state.records[3]);await advance();assert.deepEqual(pageReads,['page-second'])
    await setup.closeInspector();pagePending.shift()({body:'Obsolete page response'});await nextTick();await Promise.resolve()
    assert.equal(setup.pageBody,'','closed page response must not repopulate the inspector')
    await setup.openRecord(setup.state.records[1]);app.unmount();app=undefined;await advance()
    assert.deepEqual(reads,['second','first'],'disposal cancels pending native reads')
    const source=await readFile(new URL('../packages/ui/src/App.vue',import.meta.url),'utf8')
    assert.match(source,/<section v-if="inspectorContentReady\|\|editingNote" class="inspector-section description-section"/)
    assert.match(source,/<NativeResourcesPanel v-if="inspectorContentReady&&/)
    assert.match(source,/<template v-if="inspectorOrganizationOpen">/)
  }finally{
    app?.unmount();await server.close()
    for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}
  }
})
