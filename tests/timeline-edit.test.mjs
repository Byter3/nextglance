import test from 'node:test'
import assert from 'node:assert/strict'
import {shiftTimelineDate,timelineDateEdit,timelinePlanEdit,zoomTimelineRange} from '@nextspace/core/timeline-edit.mjs'

test('calendar-day timeline moves preserve date types, bounds and the drag revision',()=>{
  assert.equal(shiftTimelineDate('2026-10-31',2),'2026-11-02')
  const item={id:'t',kind:'task',start:'2026-11-02',due:'2026-11-05',etag:'v2'}
  assert.deepEqual(timelineDateEdit(item,'move',2),{id:'t',etag:'v2',start:'2026-11-04',due:'2026-11-07'})
  assert.deepEqual(timelineDateEdit({id:'t',kind:'task',due:'2026-11-02'},'move',1),{id:'t',due:'2026-11-03'})
  assert.deepEqual(timelineDateEdit({id:'t',kind:'task',start:'2026-11-02'},'move',1),{id:'t',start:'2026-11-03'})
  assert.equal(timelineDateEdit(item,'start',3),null,'VTODO due must remain strictly later')
  assert.equal(timelineDateEdit(item,'end',-3),null)
  assert.equal(timelineDateEdit(item,'move',0),null,'Clicking is not an edit')
})
test('undated placement creates a due marker without a fabricated start',()=>{
  assert.deepEqual(timelineDateEdit({id:'t',kind:'task'},'place',0,'2026-11-03'),{id:'t',due:'2026-11-03'})
  const card=timelineDateEdit({id:'c',kind:'card'},'place',0,'2026-11-03')
  assert.equal(card.start,undefined)
  assert.equal(new Date(card.due).getHours(),23)
  assert.equal(new Date(card.due).getMinutes(),59)
})
test('moving calendar events and planner sessions retains their timed duration',()=>{
  const event={id:'e',kind:'event',start:'2026-10-24T22:30:00Z',end:'2026-10-25T02:30:00Z',allDay:false}
  const edit=timelineDateEdit(event,'move',1)
  assert.equal(+new Date(edit.end)-+new Date(edit.start),14400000)
  assert.equal(edit.allDay,false)
  const instant=timelineDateEdit({id:'instant',kind:'event',start:event.start,end:event.start},'move',1)
  assert.ok(instant.start)
  assert.equal(instant.end,undefined,'An implicit instant must not acquire an explicit zero-duration DTEND')
  const precise=timelineDateEdit(event,'move',1/96)
  assert.equal(+new Date(precise.start)-+new Date(event.start),15*60000)
  assert.equal(+new Date(precise.end)-+new Date(precise.start),14400000)
  const plan=timelinePlanEdit(event,'end',1)
  assert.equal(plan.start,event.start)
  assert.ok(+new Date(plan.end)>+new Date(event.end))
  const allDay=timelineDateEdit({id:'e',kind:'event',start:'2026-11-02',end:'2026-11-04',allDay:true},'move',2)
  assert.deepEqual(allDay,{id:'e',start:'2026-11-04',end:'2026-11-06',allDay:true})
})
test('range zoom changes visible start/end and keeps the pointer day within rounding distance',()=>{
  const zoom=zoomTimelineRange('2026-11-02',14,-100,.25,3.5)
  assert.ok(zoom.days<14)
  const preserved=(+new Date(`${zoom.anchor}T00:00:00Z`)-+new Date('2026-11-02T00:00:00Z'))/86400000+zoom.days*.25
  assert.ok(Math.abs(preserved-3.5)<=.5)
  assert.equal(zoomTimelineRange('2026-11-02',1,-200).days,1)
  assert.equal(zoomTimelineRange('2026-11-02',90,200).days,90)
  assert.ok(zoomTimelineRange('2026-11-02',14,100).days>14)
})
