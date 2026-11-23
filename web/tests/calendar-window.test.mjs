import test from 'node:test'
import assert from 'node:assert/strict'
import {mergeCalendarWindow,coversWindow} from '../src/calendar-window.mjs'

const window={from:Date.parse('2001-01-01T00:00:00Z'),to:Date.parse('2001-02-01T00:00:00Z')}
const collection={id:'calendar',source:'calendar',title:'Studio',readonly:false}
const event=(id,date,etag='one',href=id)=>({id,source:'calendar',kind:'event',title:id,collectionId:'calendar',start:date,end:date,etag,identity:{source:'calendar',key:id},remote:{href}})
const result=(records,status={state:'connected'})=>({records,collections:[collection],statuses:[{source:'calendar',count:records.length,...status}]})

test('bounded history replaces the previous extra range and preserves the recent primary rows',()=>{
  const recent=result([event('recent','2026-11-23T09:00:00Z')]),previous={window:{from:window.from-86400000,to:window.from},snapshot:result([event('old','2000-12-31T09:00:00Z')])}
  const merged=mergeCalendarWindow(recent,previous,result([event('history','2001-01-12T09:00:00Z')]),window)
  assert.deepEqual(merged.snapshot.records.map(row=>row.id),['recent','history']);assert.equal(merged.additional.complete,true)
  assert.equal(coversWindow(window,{from:window.from+1,to:window.to-1}),true)
})
test('partial ranges retain same-window rows but never certify complete coverage',()=>{
  const row=event('history','2001-01-12T09:00:00Z'),recent=result([]),previous={window,snapshot:result([row])}
  const failed=mergeCalendarWindow(recent,previous,result([],{state:'error',errorCode:'TIMEOUT'}),window)
  assert.deepEqual(failed.snapshot.records,[row]);assert.equal(failed.additional.complete,false)
  const retried=mergeCalendarWindow(recent,failed.additional,result([]),window)
  assert.deepEqual(retried.snapshot.records,[]);assert.equal(retried.additional.complete,true)
})
test('changed recurrence resources invalidate stale recent occurrences without mixing revisions',()=>{
  const recent=result([event('recent-repeat','2026-11-23T09:00:00Z','old','series.ics'),event('other','2026-11-24T09:00:00Z')])
  const merged=mergeCalendarWindow(recent,null,result([event('old-repeat','2001-01-12T09:00:00Z','new','series.ics')]),window)
  assert.equal(merged.invalidateRecent,true);assert.deepEqual(merged.snapshot.records.map(row=>row.id),['other','old-repeat'])
})
test('successful overlap removes missing events and leaves unrelated recent dates intact',()=>{
  const recent=result([event('removed','2001-01-12T09:00:00Z'),event('outside','2026-11-23T09:00:00Z')])
  const merged=mergeCalendarWindow(recent,null,result([]),window)
  assert.deepEqual(merged.snapshot.records.map(row=>row.id),['outside'])
})
test('denial and confirmed missing calendars remove every retained range',()=>{
  const recent=result([event('recent','2026-11-23T09:00:00Z')]),previous={window,snapshot:result([event('old','2001-01-12T09:00:00Z')])}
  for(const incoming of [{records:[],collections:[],statuses:[{source:'calendar',state:'error',permissionDenied:true}]},{records:[],collections:[],statuses:[{source:'calendar',state:'connected'}]}]){
    const merged=mergeCalendarWindow(recent,previous,incoming,window)
    assert.deepEqual(merged.snapshot.records,[]);assert.deepEqual(merged.snapshot.collections,[]);assert.equal(merged.invalidateRecent,true)
  }
})
