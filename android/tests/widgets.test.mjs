import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {normalizeWidgetConfig} from '@nextspace/core/widgets.mjs'
import {createWidgetPublisher,resolveWidgetAction} from '../src/widgets.mjs'

const options={accountKey:'fixture',now:Date.parse('2026-11-23T12:00:00Z'),timeZone:'UTC',locale:'en'}
const config=extra=>normalizeWidgetConfig({widgetId:1,accountKey:options.accountKey,page:'list',...extra})
function fixture(){return {...createEmptyState(),records:[{id:'task',source:'tasks',kind:'task',collectionId:'tasks',title:'Prepare notes',due:'2026-11-23'}],collections:[{id:'tasks',source:'tasks',title:'Example tasks'}]}}
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
const timers=()=>({pending:new Map(),setTimeout(fn){const id={};this.pending.set(id,fn);return id},clearTimeout(id){this.pending.delete(id)}})

test('saved state coalesces into bounded widget publication and forwards the native revision token',async()=>{
 const state=fixture(),hostCalls=[],clock=timers()
 const publisher=createWidgetPublisher({host:{state:async value=>{hostCalls.push(value);return {configs:[config()],revision:7,publicationToken:'exact-read-generation'}},publish:async value=>hostCalls.push(value)},current:()=>({state,accountKey:'fixture',sourceRevision:'saved-source',acknowledgedEditWatermark:4,isCurrent:()=>true}),now:()=>options.now,timers:clock})
 publisher.schedule();publisher.schedule();assert.equal(clock.pending.size,1)
 await publisher.flush();const published=hostCalls[1]
 assert.equal(hostCalls.length,2);assert.equal(published.publicationToken,'exact-read-generation');assert.equal(published.revision,7)
 assert.equal(published.snapshots[0].rows.find(row=>row.type==='item').recordId,'task');assert.equal(published.snapshots[0].acknowledgedEditWatermark,4)
 publisher.close()
})

test('late account, source or metadata changes invalidate publication before native commit',async()=>{
 for(const cause of ['account','source','metadata']){
  const wait=deferred(),published=[];let current=true
  const publisher=createWidgetPublisher({host:{state:()=>wait.promise,publish:async value=>published.push(value)},current:()=>({state:fixture(),accountKey:'fixture',isCurrent:()=>current}),now:()=>options.now,timers:timers()})
  publisher.schedule();const operation=publisher.flush();current=false;wait.resolve({configs:[config()],revision:1,publicationToken:cause});await operation
  assert.deepEqual(published,[],cause);publisher.close()
 }
})

test('a newer native denial fence hides rows before foreground memory catches up',async()=>{
 const state=fixture(),published=[]
 state.connection={serverUrl:'https://cloud.example.test',username:'fixture'}
 const publisher=createWidgetPublisher({host:{state:async()=>({configs:[config()],revision:1,publicationToken:'with-denial',readDenials:[{source:'tasks',code:'PERMISSION',collection:null}]}),publish:async value=>published.push(value)},current:()=>({state,accountKey:'fixture',isCurrent:()=>true}),now:()=>options.now,timers:timers()})
 publisher.schedule();await publisher.flush();publisher.close()
 assert.equal(published[0].snapshots[0].rows.some(row=>row.type==='item'),false);assert.equal(published[0].catalog.sources.length,0)
 assert.equal(state.records.length,1,'denial projection does not mutate the controller state')
})

test('disposable snapshot failures never reject the saved source operation and disposed publishers stop',async()=>{
 const clock=timers(),publisher=createWidgetPublisher({host:{state:async()=>{throw new Error('Native store unavailable')}},current:()=>({state:fixture(),accountKey:'fixture',isCurrent:()=>true}),timers:clock})
 publisher.schedule();await publisher.flush();publisher.schedule();publisher.close();assert.equal(clock.pending.size,0,'closing the publisher removes queued work')
 for(const fn of clock.pending.values())await fn()
})

test('launch actions retain only validated exact IDs and reject foreign, stale or removed rows',()=>{
 const state=fixture(),saved=config(),base={widgetId:1,accountKey:'fixture',generation:saved.generation,action:'item',recordId:'task'}
 const result=resolveWidgetAction({action:{...base,unexpected:'discard me'},config:saved},state,options)
 assert.deepEqual(result.action,base)
 for(const action of [{...base,accountKey:'other'},{...base,generation:2},{...base,recordId:'removed'}])assert.throws(()=>resolveWidgetAction({action,config:saved},state,options),{code:'WIDGET_UNAVAILABLE'})
 assert.throws(()=>resolveWidgetAction({action:base,config:{...saved,scopeId:'removed'}},state,options),{code:'WIDGET_UNAVAILABLE'})
 assert.throws(()=>resolveWidgetAction({action:base,config:saved,readDenials:[{source:'tasks',code:'PERMISSION',collection:null}]},state,options),{code:'WIDGET_UNAVAILABLE'})
 assert.throws(()=>resolveWidgetAction({error:'This widget was deleted.'},state,options),{code:'WIDGET_UNAVAILABLE'})
 assert.equal(resolveWidgetAction({action:null},state,options),null)
})

test('create intent applies eligible configured type and destination without changing saved planner filters',()=>{
 const state=fixture(),before=structuredClone(state),saved=config({sourceMode:'selected',collectionIds:['tasks'],creationDefaults:{task:{collectionId:'tasks'}}})
 const action={widgetId:1,accountKey:'fixture',generation:saved.generation,action:'create',kind:'task'}
 assert.equal(resolveWidgetAction({action,config:saved},state,options).action.kind,'task');assert.deepEqual(state,before)
 assert.throws(()=>resolveWidgetAction({action:{...action,kind:'event'},config:saved},state,options),{code:'WIDGET_UNAVAILABLE'})
 const staleDefault=resolveWidgetAction({action,config:{...saved,creationDefaults:{task:{collectionId:'outside'}}}},state,options)
 assert.equal(staleDefault.action.collectionId,undefined,'launcher input never grants an unvalidated write destination')
})
