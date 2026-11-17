import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {useAllDayResize} from '../packages/ui/src/useAllDayResize.ts'
import {calendarAllDaySize} from '../packages/core/src/calendar-sizing.mjs'
const {createRenderer}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

function fixture(t){
  const document=new EventTarget(),previous=globalThis.document;globalThis.document=document
  const captured=new Set(),target={closest:()=>null,focus(){},setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)}
  let hook,starts=0
  const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
  const app=renderer.createApp({setup(){hook=useAllDayResize(()=>calendarAllDaySize({lanes:3,availableHeight:400,manualHeight:hook?.manualHeight.value}),()=>starts++);return()=>null}})
  app.mount({});t.after(()=>{app.unmount();globalThis.document=previous})
  const event=(type,{y=100,pointerId=1,isPrimary=true,key='',nested=false}={})=>{const value=new Event(type,{cancelable:true});for(const [name,data]of Object.entries({pointerId,isPrimary,clientY:y,button:0,key,currentTarget:target,target:nested?{closest:()=>({})}:target}))Object.defineProperty(value,name,{value:data,configurable:true});return value}
  return {hook,captured,event,get starts(){return starts},begin:opts=>hook.begin(event('pointerdown',opts)),send:(type,opts)=>document.dispatchEvent(event(type,opts)),unmount:()=>app.unmount()}
}

test('mouse or touch pointer resize commits on release and clamps in the pure bounds',t=>{
  const f=fixture(t);f.begin();assert.equal(f.hook.active.value,true);assert.equal(f.starts,1)
  f.send('pointermove',{y:120});assert.equal(f.hook.manualHeight.value,116)
  f.send('pointermove',{y:900});assert.equal(f.hook.manualHeight.value,280)
  f.send('pointerup',{y:200});assert.equal(f.hook.manualHeight.value,196)
  assert.equal(f.hook.active.value,false);assert.equal(f.captured.size,0)
  f.send('pointermove',{y:500});assert.equal(f.hook.manualHeight.value,196)
})

test('Escape, pointer cancellation and second finger restore the previous allocation',t=>{
  const f=fixture(t)
  for(const type of ['keydown','pointercancel','pointerdown']){
    f.begin();f.send('pointermove',{y:140});assert.equal(f.hook.manualHeight.value,136)
    f.send(type,type==='keydown'?{key:'Escape'}:type==='pointerdown'?{pointerId:2}:{});
    assert.equal(f.hook.manualHeight.value,null);assert.equal(f.hook.active.value,false)
    f.send('pointerup',{y:200});assert.equal(f.hook.manualHeight.value,null)
  }
  f.hook.keyboard(f.event('keydown',{key:'ArrowDown'}));f.begin();f.send('pointermove',{y:140});f.send('pointercancel');assert.equal(f.hook.manualHeight.value,112)
})

test('keyboard step, reset and nonprimary/nested controls do not start a competing resize',t=>{
  const f=fixture(t);f.hook.keyboard(f.event('keydown',{key:'ArrowDown'}));assert.equal(f.hook.manualHeight.value,112)
  f.hook.keyboard(f.event('keydown',{key:'ArrowUp'}));assert.equal(f.hook.manualHeight.value,96)
  f.hook.keyboard(f.event('keydown',{key:'Home'}));assert.equal(f.hook.manualHeight.value,null)
  f.begin({nested:true});f.begin({isPrimary:false});assert.equal(f.hook.active.value,false)
  f.begin();f.send('pointermove',{y:150});f.hook.reset();assert.equal(f.hook.manualHeight.value,null);assert.equal(f.captured.size,0)
})

test('unmount cancels transient resize and removes document listeners',t=>{
  const f=fixture(t);f.begin();f.send('pointermove',{y:150});f.unmount();f.send('pointerup',{y:300});assert.equal(f.hook.manualHeight.value,null);assert.equal(f.captured.size,0)
})
