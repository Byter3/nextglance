import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createEmptyState} from '@nextspace/core/planner.mjs'
const {createRenderer,nextTick,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual App completion honors narrow mobile operations without enabling other status edits',async()=>{
  const originals=new Map(),frames=new Map();let frameId=0,app
  const set=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true})}
  const noop=()=>{},media={matches:false,addEventListener:noop,removeEventListener:noop}
  set('window',{innerWidth:900,matchMedia:()=>media,addEventListener:noop,removeEventListener:noop,confirm:()=>false})
  set('document',{hidden:false,visibilityState:'visible',addEventListener:noop,removeEventListener:noop,querySelector:()=>null,getElementById:()=>null,documentElement:{dataset:{},style:{setProperty:noop,removeProperty:noop}}})
  set('navigator',{onLine:true});set('localStorage',{getItem:()=>null,setItem:noop});set('getComputedStyle',()=>({getPropertyValue:()=>'#171717'}));set('ResizeObserver',class{observe(){}disconnect(){}})
  set('requestAnimationFrame',fn=>{frames.set(++frameId,fn);return frameId});set('cancelAnimationFrame',id=>frames.delete(id))
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const initial=createEmptyState()
    initial.connection={connected:true,serverUrl:'https://cloud.example.test',username:'test-user'}
    initial.statuses=[{source:'tasks',state:'connected',count:1},{source:'deck',state:'connected',count:1}]
    initial.collections=[{id:'tasks',source:'tasks',title:'Work tasks'},{id:'deck',source:'deck',title:'Work board'}]
    initial.records=[{id:'task',kind:'task',source:'tasks',collectionId:'tasks',title:'Review draft',status:'NEEDS-ACTION'},{id:'card',kind:'card',source:'deck',collectionId:'deck',title:'Prepare brief'}]
    initial.nativeOperations=['setTaskCompleted','setCardCompleted']
    const calls=[]
    const acknowledge=(operation,input)=>{calls.push([operation,input]);const record=initial.records.find(r=>r.id===input.id);record.completed=input.completed;if(record.kind==='task')record.status=input.completed?'COMPLETED':'NEEDS-ACTION';return Promise.resolve(structuredClone(initial))}
    const api={getState:async()=>structuredClone(initial),resumeSync:async()=>{},setTaskCompleted:input=>acknowledge('task',input),setCardCompleted:input=>acknowledge('card',input),updateTaskStatus:async()=>{throw new Error('Unsupported operation must not be invoked')}}
    const {default:App}=await server.ssrLoadModule('/src/App.vue')
    const renderer=createRenderer({createElement:type=>({type,children:[]}),createText:text=>({text}),createComment:text=>({text}),setText:noop,setElementText:noop,parentNode:()=>null,nextSibling:()=>null,patchProp:noop,insert:noop,remove:noop})
    app=renderer.createApp({...App,render:()=>null,ssrRender:undefined},{api,canMutateNative:false,nativeOperations:['setTaskCompleted','setCardCompleted']})
    app.provide(ssrContextKey,{modules:new Set()});const setup=app.mount({}).$.setupState
    await new Promise(resolve=>setTimeout(resolve,0));await nextTick()
    const task=()=>setup.state.records.find(r=>r.id==='task'),card=()=>setup.state.records.find(r=>r.id==='card')
    assert.equal(setup.canComplete(task()),true);assert.equal(setup.canComplete(card()),true);assert.equal(setup.canChangeTaskStatus(task()),false)
    await setup.complete(task());await setup.complete(card());assert.deepEqual(calls,[['task',{id:'task',completed:true}],['card',{id:'card',completed:true}]])
    assert.equal(task().completed,true);assert.equal(card().completed,true)
    setup.state.nativeOperations=[];assert.equal(setup.canComplete(task()),false);assert.equal(setup.canComplete(card()),false)
    setup.state.nativeOperations=['setTaskCompleted'];assert.equal(setup.canComplete(task()),true);assert.equal(setup.canComplete(card()),false)
    setup.state.collections[0].readonly=true;assert.equal(setup.canComplete(task()),false);setup.state.collections[0].readonly=false
    task().readonly=true;assert.equal(setup.canComplete(task()),false);task().readonly=false
    setup.state.statuses[0].state='error';assert.equal(setup.canComplete(task()),false);setup.state.statuses[0].state='connected'
    setup.state.connection.connected=false;assert.equal(setup.canComplete(task()),false);setup.state.connection.connected=true
    delete api.setTaskCompleted;assert.equal(setup.canComplete(task()),false)
    await setup.complete(task());assert.equal(calls.length,2,'disabled actions never reach a native method')
  }finally{app?.unmount();await server.close();for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}}
})
