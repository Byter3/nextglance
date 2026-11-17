import test from 'node:test'
import assert from 'node:assert/strict'
import {calendarMoveEdit,calendarPlanMove} from '@nextspace/core/calendar-edit.mjs'

test('all-day moves preserve exclusive event ends and inclusive work deadlines',()=>{
  assert.deepEqual(calendarMoveEdit({id:'e',kind:'event',start:'2026-11-02',end:'2026-11-05',allDay:true,etag:'v2'},2,90),{id:'e',etag:'v2',start:'2026-11-04',end:'2026-11-07',allDay:true})
  assert.deepEqual(calendarMoveEdit({id:'c',kind:'card',start:'2026-11-02',due:'2026-11-05'},-1),{id:'c',start:'2026-11-01',due:'2026-11-04'})
  assert.deepEqual(calendarMoveEdit({id:'t',kind:'task',due:'2026-11-03'},1),{id:'t',due:'2026-11-04'})
  assert.deepEqual(calendarMoveEdit({id:'t',kind:'task',start:'2026-11-03'},1),{id:'t',start:'2026-11-04'})
  assert.equal(calendarMoveEdit({id:'t',kind:'task',due:'2026-11-03'},0,60),null,'Date-only deadlines cannot gain an invented hour')
})

test('timed work moves snap minutes and retain duration without inventing missing fields',()=>{
  const task={id:'t',kind:'task',start:'2026-11-02T10:00:00Z',due:'2026-11-02T12:30:00Z'}
  assert.deepEqual(calendarMoveEdit(task,1,22),{id:'t',start:'2026-11-03T10:15:00.000Z',due:'2026-11-03T12:45:00.000Z'})
  assert.deepEqual(calendarMoveEdit({id:'point',kind:'task',due:task.due},0,-30),{id:'point',due:'2026-11-02T12:00:00.000Z'})
  const instant=calendarMoveEdit({id:'instant',kind:'event',start:task.start,end:task.start},0,15)
  assert.equal(instant.start,'2026-11-02T10:15:00.000Z');assert.equal(instant.end,undefined)
})

test('a day plus a negative hour moves local dates first across daylight saving changes',()=>{
  const first=new Date(2026,9,24,12),end=new Date(+first+2*3600000)
  const edit=calendarMoveEdit({id:'dst',kind:'event',start:first.toISOString(),end:end.toISOString()},1,-60)
  const shifted=new Date(edit.start)
  assert.equal(shifted.getDate(),25);assert.equal(shifted.getHours(),11)
  assert.equal(+new Date(edit.end)-+shifted,2*3600000)
  const work=calendarMoveEdit({id:'task-dst',kind:'task',start:first.toISOString(),due:end.toISOString()},1,-60)
  assert.equal(work.start,edit.start);assert.equal(work.due,edit.end)
})

test('planner sessions move their own metadata identity and never edit the underlying task',()=>{
  const plan={id:'p',recordId:'t',start:'2026-11-02T09:00:00Z',end:'2026-11-02T11:00:00Z'}
  assert.deepEqual(calendarPlanMove(plan,2,30),{id:'p',start:'2026-11-04T09:30:00.000Z',end:'2026-11-04T11:30:00.000Z'})
})

test('clicks, invalid dates and invalid movement proposals produce no edits',()=>{
  const record={id:'t',kind:'task',due:'2026-11-03'}
  assert.equal(calendarMoveEdit(record,0,0),null)
  assert.equal(calendarMoveEdit(record,NaN,0),null)
  assert.equal(calendarMoveEdit(record,1,Infinity),null)
  assert.equal(calendarMoveEdit({...record,due:'broken'},1),null)
  assert.equal(calendarMoveEdit({id:'n',kind:'note'},1),null)
})
