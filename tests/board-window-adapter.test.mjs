import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {useBoardWindow} from '../packages/ui/src/useBoardWindow.ts'
const {createRenderer,shallowRef,nextTick}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual Board viewport adapter scrolls, measures whole stacks, preserves anchor and stops drag work',async()=>{
  const keys=['HTMLElement','document','window','getComputedStyle','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'],saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),frames=new Map();let seq=0,hook,observer
  class Element {dataset={};parentElement=null;scrollTop=0;scrollLeft=0;clientHeight=500;clientWidth=300;getBoundingClientRect(){return {top:100,bottom:600,left:0,right:300,height:500}}querySelector(){return null}querySelectorAll(){return []}}
  const scroll=new Element(),cards=new Element(),horizontal=new Element(),root=new Element(),row=new Element();root.parentElement=scroll
  cards.dataset.windowColumn='todo';cards.getBoundingClientRect=()=>({top:200-scroll.scrollTop,bottom:400000-scroll.scrollTop,left:0,right:300,height:399800})
  root.querySelectorAll=()=>[cards];root.querySelector=selector=>selector==='.board-column'?{clientWidth:300}:horizontal
  const doc=new EventTarget(),win=new EventTarget();doc.scrollingElement=scroll;win.innerHeight=500
  Object.assign(globalThis,{HTMLElement:Element,document:doc,window:win,getComputedStyle:()=>({overflowY:'auto'}),ResizeObserver:class{constructor(callback){observer=callback}observe(){}unobserve(){}disconnect(){}},requestAnimationFrame:callback=>{frames.set(++seq,callback);return seq},cancelAnimationFrame:id=>frames.delete(id)})
  const cols=shallowRef([{id:'todo',records:Array.from({length:2000},(_,i)=>({id:String(i)}))}]),retained=shallowRef([])
  const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
  const app=renderer.createApp({setup(){hook=useBoardWindow(shallowRef(root),cols,retained);return()=>null}})
  const tick=async()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(0));await nextTick()}
  try{
    app.mount({});await tick();assert.ok(hook.windows.value.get('todo').length<8)
    scroll.scrollTop=2200;doc.dispatchEvent(new Event('scroll'));await tick()
    assert.ok(hook.windows.value.get('todo')[0].index>0)
    retained.value=['0'];await nextTick();assert.equal(hook.windows.value.get('todo')[0].id,'0')
    row.dataset.orderId='0';row.getBoundingClientRect=()=>({height:280});hook.rowRef('0',row)
    await tick();assert.equal(scroll.scrollTop,2300,'growth above viewport preserves the visible anchor')
    await tick();assert.equal(hook.layouts.value.get('todo').items[0].height,280)
    let focused=false;row.querySelector=()=>({focus:()=>focused=true})
    await hook.reveal('todo','0');assert.equal(scroll.scrollTop,100);assert.equal(focused,true)
    hook.drag({x:150,y:599});await tick();assert.ok(scroll.scrollTop>100)
    hook.drag(null);await tick();assert.equal(frames.size,0,'no animation loop remains after drag ends')
    app.unmount();row.getBoundingClientRect=()=>({height:500});observer([{target:row}]);assert.equal(frames.size,0)
  }finally{app.unmount();for(const [key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
})
