import test from 'node:test'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {timelineFloatingProjection,timelineFloatingPreview} from '@nextspace/core/timeline-presentation.mjs'
import {timelineEvents} from '@nextspace/core/timeline.mjs'
import {captureScopePreferences,parseScopePreferences,saveScopePreferences,scopePreferencesFor,applyScopePreferences} from '@nextspace/core/scope-preferences.mjs'
const event=(id,patch={})=>({id,start:1,end:2,left:100,width:180,lane:0,overflow:false,...patch})
const viewport={scrollLeft:0,viewportWidth:600,dayWidth:100,scrollTop:100}

test('floating move/resize ghosts use proposed intervals without removing captured native chips',()=>{
  const entries=[event('meeting')],before=timelineFloatingProjection(entries,viewport)
  assert.deepEqual(timelineFloatingPreview({start:2,end:4},viewport),{left:200,width:200})
  assert.deepEqual(timelineFloatingPreview({start:-1,end:1},viewport),{left:0,width:100})
  assert.deepEqual(timelineFloatingPreview({start:5,end:8},viewport),{left:500,width:100})
  assert.equal(timelineFloatingPreview({start:8,end:9},viewport),null)
  assert.equal(timelineFloatingPreview({start:3,end:2},viewport),null)
  assert.deepEqual(timelineFloatingPreview({start:1,end:1},viewport),{left:100,width:4})
  assert.deepEqual(timelineFloatingProjection(entries,viewport),before)
  assert.equal(entries[0].start,1);assert.equal(entries[0].end,2)
})

test('floating context crosses each original lane independently and returns when scrolling back',()=>{
  const entries=[event('a'),event('b',{lane:1}),event('c',{lane:2})]
  assert.deepEqual(timelineFloatingProjection(entries,{...viewport,scrollTop:61}).items,[])
  assert.deepEqual(timelineFloatingProjection(entries,{...viewport,scrollTop:62}).items.map(item=>item.id),['a'])
  assert.deepEqual(timelineFloatingProjection(entries,{...viewport,scrollTop:94}).items.map(item=>item.id),['a','b'])
  assert.deepEqual(timelineFloatingProjection(entries,{...viewport,scrollTop:126}).items.map(item=>item.id),['a','b','c'])
})
test('only real intervals in the fractional visible date window float; point right edge is exclusive',()=>{
  const entries=[event('ending',{end:1.5}),event('starting',{start:3.5,end:4}),event('point',{start:1.5,end:1.5}),event('inside',{start:1.4,end:1.6,left:0}),event('buffer',{start:10,end:11,left:150})]
  assert.deepEqual(timelineFloatingProjection(entries,{...viewport,scrollLeft:150,viewportWidth:200}).items.map(item=>item.id),['point','inside'])
})
test('clipping preserves visible chip width and caps crowded overlay at three rows',()=>{
  const result=timelineFloatingProjection([event('a'),event('b'),event('c'),event('d'),event('overflow',{overflow:true,lane:-1})],{...viewport,scrollLeft:100,viewportWidth:100})
  assert.equal(result.height,96);assert.deepEqual(result.overflowIds,['d'])
  assert.ok(result.items.every(item=>item.left===0&&item.width===100))
  assert.equal(timelineFloatingProjection([event('x')],{...viewport,dayWidth:0}).height,0)
})
test('floating preference is exact boolean, account/scope-local and absent from cloud planner',()=>{
  let store=parseScopePreferences(null)
  const chosen=captureScopePreferences({}, {timelineFloatingEvents:true})
  store=saveScopePreferences(store,'work',chosen)
  const reopened=parseScopePreferences(JSON.stringify(store))
  assert.equal(scopePreferencesFor(reopened,'work').timelineFloatingEvents,true)
  assert.equal(scopePreferencesFor(reopened,'other').timelineFloatingEvents,false)
  assert.equal(captureScopePreferences({}, {timelineFloatingEvents:'true'}).timelineFloatingEvents,false)
  assert.equal(Object.hasOwn(applyScopePreferences({},'work',chosen),'timelineFloatingEvents'),false)
})
test('floating projection stays isolated from a realistic 2,200-record library',t=>{
  const library=[...Array.from({length:2040},(_,index)=>({id:`work-${index}`,kind:'task',title:`Work ${index}`})),...Array.from({length:160},(_,index)=>({id:`event-${index}`,kind:'event',title:`Meeting ${index}`,start:new Date(Date.UTC(2026,10,1,8+index*3)).toISOString(),end:new Date(Date.UTC(2026,10,1,9+index*3)).toISOString()}))]
  const prepared=timelineEvents(library,new Date(2026,10,1),42,4200)
  const events=prepared.entries.map(item=>({id:item.record.id,start:item.range.start,end:item.range.end,left:item.labelLeft,width:item.labelWidth,lane:item.lane,overflow:item.overflow}))
  const before=performance.now()
  for(let index=0;index<500;index++)timelineFloatingProjection(events,{...viewport,scrollLeft:index*2,scrollTop:200})
  t.diagnostic(`500 pure projections / ${events.length} prepared event entries: ${(performance.now()-before).toFixed(2)} ms; the ${library.length}-record library is prepared once, not scanned per projection.`)
  assert.equal(library.length,2200);assert.equal(events.length,160)
})
