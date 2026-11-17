import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createPerformanceDiagnostics} from '../packages/core/src/performance-diagnostics.mjs'
const {createRenderer,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual diagnostics controls start, stop, copy sanitized text, save and expose manual clipboard fallback',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  const previous=globalThis.window;globalThis.window=new EventTarget()
  let app
  try{
    const {default:Panel}=await server.ssrLoadModule('/src/DiagnosticsPanel.vue')
    const recorder=createPerformanceDiagnostics({now:()=>10,platform:'android',appVersion:'0.6.4',canSaveFile:true});let copied='',saved='',bindings
    const api={startDiagnostics:recorder.start,stopDiagnostics:recorder.stop,getDiagnostics:recorder.summary,clearDiagnostics:recorder.clear,readDiagnostics:recorder.read,copyDiagnostics:async()=>{copied=recorder.read();return {copied:true}},saveDiagnostics:async()=>{saved=recorder.read();return {saved:true}}}
    const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
    app=renderer.createApp({setup(){bindings=Panel.setup({api},{expose(){}});return()=>null}});app.provide(ssrContextKey,{});app.mount({})
    bindings.start();assert.equal(recorder.summary().recording,true)
    recorder.record({kind:'source',source:'calendar',stage:'error',code:'TIMEOUT',secret:'must not export'})
    bindings.stop();assert.equal(recorder.summary().recording,false)
    await bindings.copy();assert.equal(bindings.message.value,'Log copied.');assert.doesNotMatch(copied,/must not export/)
    await bindings.save();assert.equal(bindings.message.value,'Log saved.');assert.equal(copied,saved)
    api.copyDiagnostics=async()=>({copied:false});await bindings.copy();assert.equal(bindings.fallback.value,recorder.read());assert.match(bindings.message.value,/Select and copy/)
    api.saveDiagnostics=async()=>({saved:false,cancelled:true});await bindings.save();assert.equal(bindings.message.value,'')
    bindings.clear();assert.equal(recorder.summary().eventCount,0);assert.equal(bindings.fallback.value,'')
  }finally{app?.unmount();globalThis.window=previous;await server.close()}
})

test('diagnostics panel has no idle polling and cancels its active clock on host stop or unmount',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  const previous=globalThis.window,oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;let app
  globalThis.window=new EventTarget()
  try{
    const {default:Panel}=await server.ssrLoadModule('/src/DiagnosticsPanel.vue')
    const pending=new Map();let serial=0,recording=false,reads=0
    globalThis.setTimeout=callback=>{pending.set(++serial,callback);return serial}
    globalThis.clearTimeout=id=>pending.delete(id)
    const api={getDiagnostics(){reads++;return {recording,eventCount:0,elapsedMs:0}},startDiagnostics(){recording=true;return api.getDiagnostics()},stopDiagnostics(){recording=false;return api.getDiagnostics()}}
    let bindings
    const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
    app=renderer.createApp({setup(){bindings=Panel.setup({api},{expose(){}});return()=>null}});app.provide(ssrContextKey,{});app.mount({})
    assert.equal(reads,1);assert.equal(pending.size,0,'stopped settings do not maintain an idle polling timer')
    bindings.start();assert.equal(pending.size,1)
    const [id,tick]=[...pending][0];pending.delete(id);tick();assert.equal(pending.size,1,'only one active recording timer is scheduled')
    recording=false;window.dispatchEvent(new Event('nextspace:diagnostics'));assert.equal(pending.size,0,'host automatic/background stop cancels immediately')
    bindings.start();assert.equal(pending.size,1);app.unmount();app=undefined;assert.equal(pending.size,0)
    const before=reads;window.dispatchEvent(new Event('nextspace:diagnostics'));assert.equal(reads,before,'unmounted panel detaches its listener')
  }finally{app?.unmount();globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;globalThis.window=previous;await server.close()}
})
