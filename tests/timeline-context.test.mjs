import test from 'node:test'
import assert from 'node:assert/strict'
import {visibleSpanLabel,timelinePointLabel,timelineBandRuns,collapsedTimelineSpans} from '@nextspace/core/timeline-context.mjs'

test('real span label follows the visible cutoff without escaping its item or viewport',()=>{
  assert.deepEqual(visibleSpanLabel({start:10,end:210,viewportStart:80,viewportEnd:180}),{offset:74,width:92})
  assert.deepEqual(visibleSpanLabel({start:100,end:150,viewportStart:80,viewportEnd:180}),{offset:4,width:42})
  assert.deepEqual(visibleSpanLabel({start:10,end:12,viewportStart:0,viewportEnd:100}),{offset:1,width:0})
  assert.equal(visibleSpanLabel({start:10,end:80,viewportStart:80,viewportEnd:180}),null)
  assert.equal(visibleSpanLabel({start:180,end:210,viewportStart:80,viewportEnd:180}),null)
  assert.equal(visibleSpanLabel({start:NaN,end:210,viewportStart:80,viewportEnd:180}),null)
})
test('point titles use available plot space and never appear for invisible dates',()=>{
  assert.deepEqual(timelinePointLabel({point:100,viewportStart:80,viewportEnd:300}),{offset:14,width:186})
  assert.deepEqual(timelinePointLabel({point:290,viewportStart:80,viewportEnd:300}),{offset:-210,width:196})
  assert.equal(timelinePointLabel({point:79,viewportStart:80,viewportEnd:300}),null)
  assert.equal(timelinePointLabel({point:300,viewportStart:80,viewportEnd:300}),null)
})
test('calendar bands use contiguous group rows and keep category precedence',()=>{
  const space={id:'studio'}, category={id:'editing'}
  const runs=timelineBandRuns([
    {spaceId:space.id},{spaceId:space.id,categoryId:category.id},{spaceId:space.id,categoryId:category.id},
    {spaceId:'other',categoryId:'review'},{spaceId:space.id,categoryId:category.id},
  ])
  assert.deepEqual(runs({space,category}),[{start:1,end:3},{start:4,end:5}])
  assert.deepEqual(runs({space}),[{start:0,end:3},{start:4,end:5}])
  assert.deepEqual(runs({}),[{start:0,end:5}])
  assert.deepEqual(runs({space,category:{id:'unavailable'}}),[])
  assert.deepEqual(timelineBandRuns([])({space,category}),[{start:0,end:4}])
})
test('collapsed group previews contain only filtered unique descendant work with actual schedules',()=>{
  const a={id:'a',kind:'card',start:'2026-11-01',due:'2026-11-15'},b={id:'b',kind:'task',due:'2026-11-12'},c={id:'c',kind:'task',start:'2026-11-12',due:'2026-11-14'},d={id:'d',kind:'task',title:'Undated'},e={id:'e',kind:'card',due:'2026-10-01'}
  const group={records:[a,b,d],children:[{records:[b,c,e,{id:'event',kind:'event',start:'2026-11-12',end:'2026-11-13'}],children:[]}]},before=structuredClone(group)
  const result=collapsedTimelineSpans(group,new Date(2026,10,10),7)
  assert.deepEqual(result.spans.map(({record,start,end,point,lane})=>({id:record.id,start,end,point,lane})),[
    {id:'a',start:0,end:6,point:false,lane:0},
    {id:'c',start:2,end:5,point:false,lane:1},
    {id:'b',start:2.5,end:2.5,point:true,lane:2},
  ])
  assert.equal(result.lanes,3);assert.deepEqual(group,before)
  assert.deepEqual(collapsedTimelineSpans({records:[d,e],children:[]},new Date(2026,10,10),7),{spans:[],lanes:1})
})
test('nonoverlapping schedules share a lane and input order cannot change lane assignment',()=>{
  const records=[{id:'b',kind:'task',start:'2026-11-12',due:'2026-11-13'},{id:'a',kind:'task',start:'2026-11-10',due:'2026-11-11'}]
  const first=collapsedTimelineSpans({records,children:[]},new Date(2026,10,10),7)
  assert.deepEqual(first,collapsedTimelineSpans({records:records.toReversed(),children:[]},new Date(2026,10,10),7))
  assert.equal(first.lanes,1)
})
