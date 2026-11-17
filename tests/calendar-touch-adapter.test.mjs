import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {usePlannerTouch} from '../packages/ui/src/usePlannerTouch.ts'
import {calendarTouchEligible,panCalendarVertical} from '../packages/ui/src/calendarTouchSurface.ts'
const {createRenderer,shallowRef}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')
if(typeof globalThis.requestAnimationFrame!=='function')globalThis.requestAnimationFrame=()=>0
if(typeof globalThis.cancelAnimationFrame!=='function')globalThis.cancelAnimationFrame=()=>{}

function fixture(t){
  t.mock.timers.enable({apis:['setTimeout','Date'],now:1000})
  const document=new EventTarget(),frames=new Map();let sequence=0,hook
  const saved=Object.fromEntries(['document','window','HTMLElement','Element'].map(key=>[key,globalThis[key]]))
  class Element{
    constructor(classes,parent,tag='DIV'){this.classes=new Set(classes.split(' '));this.parentElement=parent;this.tagName=tag;this.dataset={};this.captures=new Set();this.classList={toggle(){}};this.top=0;this.maxTop=500}
    closest(selector){return selector.split(',').some(part=>part.startsWith('.')?this.classes.has(part.slice(1)):part==='[data-planner-touch-surface]'?Object.hasOwn(this.dataset,'plannerTouchSurface'):part.toUpperCase()===this.tagName)?this:this.parentElement?.closest(selector)||null}
    contains(target){return target===this||Boolean(target?.parentElement&&this.contains(target.parentElement))}
    setPointerCapture(id){this.captures.add(id)}hasPointerCapture(id){return this.captures.has(id)}releasePointerCapture(id){this.captures.delete(id)}
    get scrollTop(){return this.top}set scrollTop(value){this.top=Math.max(0,Math.min(this.maxTop,value))}
  }
  Object.assign(globalThis,{document,window:{matchMedia:()=>({matches:true})},Element,HTMLElement:Element})
  t.mock.method(globalThis,'requestAnimationFrame',callback=>{frames.set(++sequence,callback);return sequence})
  t.mock.method(globalThis,'cancelAnimationFrame',id=>frames.delete(id))
  const root=new Element('calendar-view'),allDay=new Element('calendar-all-day-viewport',root),blank=new Element('calendar-all-day',allDay),item=new Element('all-day-event',blank,'BUTTON'),timed=new Element('calendar-times-scroll',root),track=new Element('calendar-day-track',timed)
  let vertical=allDay;const pans=[],pinches=[],edits=[]
  const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
  const app=renderer.createApp({setup(){hook=usePlannerTouch(shallowRef(root),{eligible:calendarTouchEligible,start:event=>{vertical=event.target.closest('.calendar-all-day-viewport')?allDay:timed},pan:(dx,dy)=>{panCalendarVertical(vertical,allDay,timed,dy);pans.push([dx,dy])},pinchStart:()=>pinches.push('start'),pinch:()=>pinches.push('change')});return()=>null}})
  app.mount({});t.after(()=>{app.unmount();Object.assign(globalThis,saved)})
  function event(type,target=blank,{id=1,x=100,y=100}={}){const value=new Event(type,{cancelable:true});for(const [name,data] of Object.entries({pointerType:'touch',pointerId:id,clientX:x,clientY:y,button:0,target,detail:1}))Object.defineProperty(value,name,{value:data});return value}
  const send=(type,target,point)=>{const value=event(type,target,point);document.dispatchEvent(value);return value}
  const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(performance.now()+16))}
  function editable(down){hook.edit(down,{target:item,eligible:()=>true,arm:()=>edits.push('arm'),move:()=>edits.push('move'),end:()=>edits.push('end'),cancel:()=>edits.push('cancel')})}
  return {hook,allDay,timed,blank,item,track,pans,pinches,edits,send,flush,editable,tick:ms=>t.mock.timers.tick(ms)}
}

test('blank all-day surface and read-only item start immediate two-axis navigation through actual touch adapter',t=>{
  const f=fixture(t)
  for(const target of [f.blank,f.item]){
    f.allDay.top=20;f.send('pointerdown',target);f.send('pointermove',target,{x:75,y:70});f.flush()
    assert.equal(f.hook.mode.value,'pan');assert.deepEqual(f.pans.at(-1),[-25,-30]);assert.equal(f.allDay.scrollTop,50)
    f.send('pointerup',target,{x:75,y:70});assert.equal(f.send('click',target).defaultPrevented,true)
    f.hook.cancel()
  }
})
test('empty all-day rows pass vertical travel into the timed hours rather than trapping it',t=>{
  const f=fixture(t);f.allDay.maxTop=0;f.timed.top=200
  f.send('pointerdown',f.blank);f.send('pointermove',f.blank,{x:80,y:60});f.flush()
  assert.equal(f.allDay.scrollTop,0);assert.equal(f.timed.scrollTop,240);assert.deepEqual(f.pans.at(-1),[-20,-40])
})
test('all-day editable item keeps tap, long press and second-finger pinch arbitration',t=>{
  const f=fixture(t)
  const down=f.send('pointerdown',f.item);f.editable(down);f.tick(100);f.send('pointerup',f.item)
  assert.equal(f.send('click',f.item).defaultPrevented,false);assert.deepEqual(f.edits,[])
  f.editable(f.send('pointerdown',f.item));f.tick(500);assert.deepEqual(f.edits,['arm'])
  f.send('pointerdown',f.blank,{id:2,x:200,y:100});assert.equal(f.hook.mode.value,'pinch');assert.ok(f.edits.includes('cancel'))
  f.send('pointermove',f.blank,{id:2,x:240,y:100});f.flush();assert.deepEqual(f.pinches,['start','change'])
  f.send('pointerup',f.blank,{id:2,x:240,y:100});f.send('pointerup',f.item);assert.ok(!f.edits.includes('end'))
})
