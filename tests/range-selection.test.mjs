import test from 'node:test'
import assert from 'node:assert/strict'
import {creationSelection} from '@nextspace/core/range-selection.mjs'

test('all-day selections include every touched day and return an exclusive end',()=>{
  const forward=creationSelection('2026-11-02',.2,2.8,{dragged:true})
  const backward=creationSelection('2026-11-02',2.8,.2,{dragged:true})
  assert.deepEqual(forward.range,{start:'2026-11-02',end:'2026-11-05',allDay:true,origin:'calendar'})
  assert.deepEqual(backward,forward)
})
test('calendar clicks propose an hour and drags snap both ends to quarter hours',()=>{
  assert.deepEqual(creationSelection('2026-11-02',9.1/24,9.1/24,{timed:true}).range,{start:'2026-11-02T09:00',end:'2026-11-02T10:00',allDay:false,origin:'calendar'})
  const result=creationSelection('2026-11-02',11.4/24,9.1/24,{timed:true,dragged:true})
  assert.equal(result.range.start,'2026-11-02T09:00');assert.equal(result.range.end,'2026-11-02T11:30')
})
test('selections clamp to the visible interval and retain positive duration',()=>{
  const last=creationSelection('2026-11-02',9,9,{timed:true,daysCount:1})
  assert.equal(last.range.start,'2026-11-02T23:45');assert.equal(last.range.end,'2026-11-03T00:00')
  assert.equal(creationSelection('2026-11-02',-2,-1,{daysCount:1}).range.end,'2026-11-03')
  assert.equal(creationSelection('2026-11-02',.5,.5,{timed:true,dragged:true}).range.end,'2026-11-02T12:15')
  assert.equal(creationSelection('2026-11-02',.999,1.001).range.end,'2026-11-03','Tiny pointer jitter does not extend a click into a second day')
})
test('cross-day timed ranges and timeline row context survive projection',()=>{
  const selected=creationSelection('2026-10-24',.5,2.5,{daysCount:3,timed:true,dragged:true,origin:'timeline',recordId:'card-one'})
  assert.deepEqual(selected.range,{start:'2026-10-24T12:00',end:'2026-10-26T12:00',allDay:false,origin:'timeline',recordId:'card-one'})
})
