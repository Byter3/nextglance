import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {usePinnedItemLabels} from '../packages/ui/src/usePinnedItemLabels.ts'
const {createRenderer}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')
if(typeof globalThis.requestAnimationFrame!=='function')globalThis.requestAnimationFrame=()=>0
if(typeof globalThis.cancelAnimationFrame!=='function')globalThis.cancelAnimationFrame=()=>{}

test('scrolling pins labels with cached item geometry and one frame, without rescanning items',t=>{
  let next=0,reads=0,queries=0,hook,geometryChecks=0;const frames=new Map(),styles=new Map()
  const isFinite=Number.isFinite;t.mock.method(Number,'isFinite',value=>{geometryChecks++;return isFinite(value)})
  t.mock.method(globalThis,'requestAnimationFrame',callback=>{frames.set(++next,callback);return next})
  t.mock.method(globalThis,'cancelAnimationFrame',id=>frames.delete(id))
  const viewport={scrollLeft:0,clientWidth:200,getBoundingClientRect:()=>({left:0}),querySelectorAll:()=>{queries++;return [element]}}
  const element={clientLeft:3,matches:()=>false,style:{setProperty:(name,value)=>styles.set(name,value)},getBoundingClientRect:()=>{reads++;return {left:50-viewport.scrollLeft,right:350-viewport.scrollLeft}}}
  const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
  const app=renderer.createApp({setup(){hook=usePinnedItemLabels(()=>[{viewport,selector:'.item',gutter:40}]);return()=>null}})
  app.mount({});t.after(()=>app.unmount())
  const flush=()=>{const values=[...frames.values()];frames.clear();values.forEach(callback=>callback())}
  hook.update();hook.update();assert.equal(frames.size,1);flush()
  assert.equal(styles.get('--label-offset'),'4px');assert.equal(reads,1);assert.equal(queries,1)
  const initialGeometryChecks=geometryChecks
  hook.update();flush();assert.equal(geometryChecks,initialGeometryChecks,'Vertical-only scroll does not run any item geometry calculation')
  viewport.scrollLeft=90;hook.update();flush()
  assert.equal(styles.get('--label-offset'),'81px');assert.equal(styles.get('--label-width'),'152px')
  assert.equal(styles.get('--source-edge-visible'),'1');assert.equal(styles.get('--source-edge-offset'),'77px')
  assert.equal(reads,1,'No item bounding rectangle is read per scroll pixel');assert.equal(queries,1)
  const afterHorizontal=geometryChecks;assert.ok(afterHorizontal>initialGeometryChecks)
  hook.update();flush();assert.equal(geometryChecks,afterHorizontal)
  viewport.clientWidth=220;hook.update();flush();assert.equal(reads,2,'Changing viewport width refreshes cached geometry')
  hook.invalidate();flush();assert.equal(reads,3);assert.equal(queries,3)
  viewport.scrollLeft=400;hook.update();flush();assert.equal(styles.get('--label-width'),'0px')
})
