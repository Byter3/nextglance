import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {useUiDiagnostics} from '../packages/ui/src/useUiDiagnostics.ts'
import {createPerformanceDiagnostics} from '../packages/core/src/performance-diagnostics.mjs'
const {createRenderer,nextTick}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('UI diagnostics only samples during recording, aggregates scroll/frame stalls and excludes background intervals',async t=>{
  const saved=Object.fromEntries(['window','document','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]))
  const frames=new Map();let clock=0,id=0,hook
  const window=new EventTarget(),document=new EventTarget();document.hidden=false
  Object.assign(globalThis,{window,document,requestAnimationFrame:fn=>{frames.set(++id,fn);return id},cancelAnimationFrame:key=>frames.delete(key)})
  t.mock.method(performance,'now',()=>clock)
  t.mock.method(globalThis,'setInterval',()=>{throw new Error('Diagnostics must not install an idle polling loop')})
  const recorder=createPerformanceDiagnostics({now:()=>clock,platform:'android',appVersion:'0.6.4'}),api={getDiagnostics:()=>recorder.summary(),recordDiagnostic:event=>recorder.record(event)}
  const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
  const app=renderer.createApp({setup(){hook=useUiDiagnostics(api);return()=>null}});app.mount({})
  t.after(()=>{app.unmount();Object.assign(globalThis,saved)})
  const tick=time=>{clock=time;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(time))}
  assert.equal(frames.size,0)
  recorder.start();window.dispatchEvent(new Event('nextspace:diagnostics'))
  document.dispatchEvent(new Event('scroll'));document.dispatchEvent(new Event('scroll'))
  tick(16);tick(32);tick(1100)
  let events=JSON.parse(recorder.read()).events
  assert.equal(events.find(event=>event.stage==='frame').maxDelayMs,1068)
  assert.equal(events.find(event=>event.stage==='frame').count,1)
  assert.equal(events.find(event=>event.stage==='scroll').count,2)
  hook.markIntent('page');clock=1150;hook.measure('page','calendar');await nextTick();tick(1166)
  assert.equal(JSON.parse(recorder.read()).events.filter(event=>event.stage==='page').length,0)
  tick(1182)
  assert.equal(JSON.parse(recorder.read()).events.at(-1).page,'calendar')
  assert.equal(JSON.parse(recorder.read()).events.at(-1).durationMs,82)
  const cancelIntent=hook.markIntent('panel');clock=1300;cancelIntent()
  hook.measure('panel','settings');await nextTick();tick(1316);tick(1332)
  assert.equal(JSON.parse(recorder.read()).events.at(-1).durationMs,32)
  hook.markIntent('panel');hook.measure('panel','calendar');await nextTick();tick(1348)
  document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,0)
  clock=100000;document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));tick(100016);tick(100032);tick(101016)
  events=JSON.parse(recorder.read()).events;assert.ok(events.filter(event=>event.stage==='frame').every(event=>event.maxDelayMs<2000))
  assert.equal(events.filter(event=>event.stage==='panel'&&event.page==='calendar').length,0)
  recorder.stop();window.dispatchEvent(new Event('nextspace:diagnostics'));assert.equal(frames.size,0)
  hook.markIntent('page');hook.measure('page','board');await nextTick();assert.equal(frames.size,0)
  recorder.start();window.dispatchEvent(new Event('nextspace:diagnostics'));assert.ok(frames.size>0)
  recorder.stop();tick(clock+16);assert.equal(frames.size,0,'automatic stop cancels active sampling without an idle timer')
})
