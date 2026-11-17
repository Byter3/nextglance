import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const {createRenderer,nextTick,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual Board keyboard reaches and reorders a card outside its initial mounted window',async()=>{
  const names=['document','window','HTMLElement','Element','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'],saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]))
  class Element{closest(){return null}}
  const frames=new Map();let seq=0
  Object.assign(globalThis,{document:new EventTarget(),window:new EventTarget(),Element,HTMLElement:Element,ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq},cancelAnimationFrame:id=>frames.delete(id)})
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  let app
  try{
    const {default:Board}=await server.ssrLoadModule('/src/PlannerBoard.vue'),records=Array.from({length:100},(_,i)=>({id:`card-${i}`,kind:'card',source:'deck',collectionId:'board',title:`Card ${String(i).padStart(3,'0')}`,status:'To do'})),changes=[]
    const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
    app=renderer.createApp({...Board,render:()=>null,ssrRender:undefined},{records,collections:[],relations:[],workflow:{},scopeId:'all',colorFor:()=>'#123456',onReorder:intent=>changes.push(intent)});app.provide(ssrContextKey,{modules:new Set()})
    const setup=app.mount({}).$.setupState,column=setup.columns[0],event={target:new Element(),key:'End',altKey:false,preventDefault(){},stopPropagation(){}}
    assert.equal(setup.renderedColumns[0].rows.length,6)
    setup.cardKeydown(event,records[0],column.id);await nextTick()
    assert.equal(setup.focused,'card-99');assert.ok(setup.renderedColumns[0].rows.some(row=>row.record.id==='card-99'))
    setup.cardKeydown({...event,key:'ArrowUp',altKey:true},records[99],column.id);await nextTick()
    assert.equal(changes.length,1);assert.equal(changes[0].ids.length,100)
    assert.deepEqual(changes[0].ids.slice(-2),['card-99','card-98'])
  }finally{app?.unmount();await server.close();for(const [name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}}
})
