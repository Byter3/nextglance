import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {useListReorder} from '../packages/ui/src/useListReorder.ts'
const {createRenderer,shallowRef,ref,nextTick}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

function fixture(t,options={}){
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000})
  const document=new EventTarget(),frames=new Map();let sequence=0
  t.mock.method(globalThis,'requestAnimationFrame',callback=>{frames.set(++sequence,callback);return sequence},{})
  t.mock.method(globalThis,'cancelAnimationFrame',id=>frames.delete(id),{})
  const oldDocument=globalThis.document;globalThis.document=document
  const captures=new Set(),handle={setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)}
  const items=['a','b','c','other'].map((id,index)=>({id,group:id==='other'?'other':'rows',element:{getBoundingClientRect:()=>({top:index*40,bottom:index*40+40,left:0,right:100})}}))
  const allowed=ref(true),commits=[],pans=[];let hook
  const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
  const app=renderer.createApp({setup(){hook=useListReorder(shallowRef({scrollLeft:0,scrollTop:0}),{canReorder:()=>allowed.value,items:()=>items,commit:intent=>commits.push(intent),pan:(dx,dy)=>pans.push([dx,dy]),...options});return()=>null}})
  app.mount({});t.after(()=>{app.unmount();globalThis.document=oldDocument})
  const event=(type,{pointerType='mouse',pointerId=1,isPrimary=true,x=5,y=10,key='',altKey=false,detail=1}={})=>{const value=new Event(type,{cancelable:true});for(const [name,data] of Object.entries({pointerType,pointerId,isPrimary,clientX:x,clientY:y,button:0,currentTarget:handle,key,altKey,detail}))Object.defineProperty(value,name,{value:data,configurable:true});return value}
  const begin=(options={})=>hook.begin(event('pointerdown',options),'a','rows')
  const send=(type,options={})=>document.dispatchEvent(event(type,options))
  return {hook,commits,pans,allowed,captures,items,begin,send,event,tick:ms=>t.mock.timers.tick(ms),flush:()=>{const batch=[...frames.values()];frames.clear();batch.forEach(callback=>callback(0))}}
}

// The adapter is mounted in Vue's lightweight custom renderer: no browser, UI
// asset build, network or real account is involved in these pointer contracts.
if(typeof globalThis.requestAnimationFrame!=='function')globalThis.requestAnimationFrame=()=>0
if(typeof globalThis.cancelAnimationFrame!=='function')globalThis.cancelAnimationFrame=()=>{}

test('mouse click and stationary touch hold never create a manual order',t=>{
  const f=fixture(t);f.begin();f.send('pointerup');assert.deepEqual(f.commits,[])
  f.begin({pointerType:'touch'});f.tick(500);assert.equal(f.hook.active.value,true);f.send('pointerup',{pointerType:'touch'});assert.deepEqual(f.commits,[])
})

test('normal body clicks and touch taps retain their target and are not suppressed',t=>{
  const f=fixture(t)
  for(const pointerType of ['mouse','touch']){
    const down=f.event('pointerdown',{pointerType});f.hook.begin(down,'a','rows')
    assert.equal(down.defaultPrevented,false);assert.equal(f.captures.size,0,'Pending input must not retarget a nested open button')
    f.tick(100);f.send('pointerup',{pointerType});const click=f.event('click');f.hook.captureClick(click)
    assert.equal(click.defaultPrevented,false);assert.deepEqual(f.commits,[])
  }
})

test('actual drags and early touch pans suppress their click but the next normal tap opens',t=>{
  const f=fixture(t)
  for(const pointerType of ['mouse','touch']){
    f.begin({pointerType});f.send('pointermove',{pointerType,y:90});f.send('pointerup',{pointerType,y:90})
    const click=f.event('click');f.hook.captureClick(click);assert.equal(click.defaultPrevented,true)
    f.begin({pointerType});f.send('pointerup',{pointerType});const tap=f.event('click');f.hook.captureClick(tap);assert.equal(tap.defaultPrevented,false)
  }
})
test('movement commits once on release and only within sibling bounds',t=>{
  const f=fixture(t);f.begin();f.send('pointermove',{y:90});assert.deepEqual(f.commits,[]);f.send('pointerup',{y:90});f.send('pointerup',{y:90})
  assert.deepEqual(f.commits,[{id:'a',targetId:'c',group:'rows',placement:'before'}])
  f.begin();f.send('pointermove',{y:150});f.send('pointerup',{y:150});assert.equal(f.commits.length,1)
  f.begin();f.send('pointermove',{x:150,y:90});f.send('pointerup',{x:150,y:90});assert.equal(f.commits.length,1)
})

test('small movement within the same position does not create a manual order',t=>{
  const f=fixture(t);f.begin();f.send('pointermove',{y:18});f.send('pointerup',{y:18});assert.deepEqual(f.commits,[])
})
test('touch movement before long press scrolls and never becomes a reorder',t=>{
  const f=fixture(t);f.begin({pointerType:'touch'});f.tick(100);f.send('pointermove',{pointerType:'touch',y:25});f.tick(600);f.send('pointermove',{pointerType:'touch',y:90});f.send('pointerup',{pointerType:'touch',y:90})
  assert.equal(f.hook.active.value,false);assert.ok(f.pans.length);assert.deepEqual(f.commits,[])
})
test('touch can reorder after 500 ms and no earlier',t=>{
  const f=fixture(t);f.begin({pointerType:'touch'});f.tick(499);assert.equal(f.hook.active.value,false);f.tick(1);assert.equal(f.hook.active.value,true);f.send('pointermove',{pointerType:'touch',y:90});f.send('pointerup',{pointerType:'touch',y:90});assert.equal(f.commits.length,1)
})
test('Escape, pointer cancellation, second finger and permission loss cancel',async t=>{
  const f=fixture(t)
  for(const type of ['keydown','pointercancel','pointerdown']){f.begin();f.send('pointermove',{y:90});f.send(type,type==='keydown'?{key:'Escape'}:type==='pointerdown'?{pointerId:2}:{});f.send('pointerup',{y:90});assert.deepEqual(f.commits,[])}
  f.begin();f.send('pointermove',{y:90});f.allowed.value=false;await nextTick();f.send('pointerup',{y:90});assert.deepEqual(f.commits,[]);assert.equal(f.hook.active.value,false)
})

test('second touch cannot restart reorder from another handle while primary touch is down',t=>{
  const f=fixture(t);f.begin({pointerType:'touch'});f.tick(500);assert.equal(f.hook.active.value,true)
  const second={pointerType:'touch',pointerId:2,isPrimary:false,y:90}
  f.send('pointerdown',second);f.hook.begin(f.event('pointerdown',second),'c','rows');f.tick(500)
  f.send('pointermove',{...second,y:10});f.send('pointerup',{...second,y:10});f.send('pointerup',{pointerType:'touch'})
  assert.equal(f.hook.active.value,false);assert.deepEqual(f.commits,[])
})

test('external drop is validated once on release, clears hover and never also reorders',t=>{
  const moves=[],drops=[]
  const f=fixture(t,{onMoveOther:point=>{moves.push(point);return Boolean(point&&point.x>100)},onDropOther:point=>{drops.push(point);return point.x>100}})
  f.begin();f.send('pointermove',{x:150,y:90});assert.equal(f.hook.marker.value,null);assert.deepEqual(drops,[])
  f.send('pointerup',{x:150,y:90});f.send('pointerup',{x:150,y:90})
  assert.deepEqual(drops,[{id:'a',sourceGroup:'rows',x:150,y:90}]);assert.deepEqual(f.commits,[]);assert.equal(moves.at(-1),null)
})

test('external drop never runs for taps, early pans, cancelled or removed targets',t=>{
  const drops=[],f=fixture(t,{onMoveOther:()=>true,onDropOther:point=>{drops.push(point);return true}})
  f.begin();f.send('pointerup')
  f.begin({pointerType:'touch'});f.send('pointermove',{pointerType:'touch',x:150,y:90});f.send('pointerup',{pointerType:'touch',x:150,y:90})
  f.begin();f.send('pointermove',{x:150,y:90});f.send('pointercancel');f.send('pointerup',{x:150,y:90})
  f.begin();f.send('pointermove',{x:150,y:90});f.items.shift();f.send('pointerup',{x:150,y:90})
  assert.deepEqual(drops,[]);assert.deepEqual(f.commits,[])
})
test('Alt arrows move only to an adjacent sibling; other keys do not mutate',t=>{
  const f=fixture(t);f.hook.keydown(f.event('keydown',{key:'ArrowDown',altKey:true}),'a','rows');f.hook.keydown(f.event('keydown',{key:'ArrowUp',altKey:true}),'a','rows');f.hook.keydown(f.event('keydown',{key:'ArrowDown'}),'a','rows')
  assert.deepEqual(f.commits,[{id:'a',targetId:'b',placement:'after',group:'rows'}])
})


test('drag presentation receives frame-coalesced pointer coordinates and always clears on cancellation',t=>{
  const visuals=[],f=fixture(t,{onVisual:point=>visuals.push(point)})
  f.begin({pointerType:'touch'});f.tick(500)
  assert.equal(visuals.at(-1).x,5);assert.equal(visuals.at(-1).startY,10)
  f.send('pointermove',{pointerType:'touch',x:60,y:90});f.send('pointermove',{pointerType:'touch',x:70,y:92})
  const before=visuals.length;f.flush();assert.equal(visuals.length,before+1);assert.equal(visuals.at(-1).x,70)
  const marker=f.hook.marker.value
  f.send('pointermove',{pointerType:'touch',x:71,y:93});f.flush()
  assert.equal(f.hook.marker.value,marker,'An unchanged insertion target must not trigger a Board render per pointer frame')
  f.send('pointercancel',{pointerType:'touch'});assert.equal(visuals.at(-1),null);assert.deepEqual(f.commits,[])
})
