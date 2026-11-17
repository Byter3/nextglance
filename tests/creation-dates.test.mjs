import assert from 'node:assert/strict'
import test from 'node:test'
import {creationDateInputs,creationDatePayload,creationRangeFromInputs,convertCreationDateMode,shiftCreationDay} from '@nextspace/core/creation-dates.mjs'

test('same selected day creates an inclusive work deadline and an exclusive event end',()=>{
  const range={start:'2026-11-02',end:'2026-11-03',allDay:true}
  assert.deepEqual(creationDatePayload('event',creationDateInputs(range,'event')),{start:'2026-11-02',end:'2026-11-03',allDay:true})
  assert.deepEqual(creationDatePayload('task',creationDateInputs(range,'task')),{due:'2026-11-02'})
  assert.deepEqual(creationDatePayload('card',creationDateInputs(range,'card')),{start:'2026-11-02',due:'2026-11-02'})
})

test('multi-day selection retains every selected day for tasks, cards and events',()=>{
  const range={start:'2026-10-31',end:'2026-11-04',allDay:true}
  assert.equal(creationDateInputs(range,'event').end,'2026-11-04')
  assert.equal(creationDateInputs(range,'task').end,'2026-11-03')
  assert.equal(creationDateInputs(range,'card').end,'2026-11-03')
})

test('timed selection preserves both instants in creation payloads',()=>{
  const range={start:'2026-11-03T09:15:00+01:00',end:'2026-11-03T11:45:00+01:00',allDay:false}
  const event=creationDatePayload('event',creationDateInputs(range,'event'))
  assert.equal(+new Date(event.start),+new Date(range.start));assert.equal(+new Date(event.end),+new Date(range.end))
  const card=creationDatePayload('card',creationDateInputs(range,'card'))
  assert.equal(card.start,event.start);assert.equal(card.due,event.end)
})

test('all-day toggle preserves multi-day coverage and restores original timed fields',()=>{
  const timed={start:'2026-11-02T13:15',end:'2026-11-04T16:45',allDay:false}
  const allDay=convertCreationDateMode(timed,true,'event')
  assert.deepEqual(allDay,{start:'2026-11-02',end:'2026-11-05',allDay:true})
  assert.deepEqual(convertCreationDateMode(allDay,false,'event',timed),timed)
  assert.deepEqual(convertCreationDateMode({...allDay,end:'2026-11-06'},false,'event',timed),{start:'2026-11-02T09:00',end:'2026-11-05T10:00',allDay:false})
})

test('midnight event end does not gain another all-day date',()=>{
  assert.deepEqual(convertCreationDateMode({start:'2026-11-02T13:00',end:'2026-11-04T00:00',allDay:false},true,'event'),{start:'2026-11-02',end:'2026-11-04',allDay:true})
})

test('default event becomes one valid all-day event when toggled',()=>{
  const draft=creationDateInputs(undefined,'event',new Date(2026,10,2))
  assert.deepEqual(creationDatePayload('event',convertCreationDateMode(draft,true,'event')),{start:'2026-11-02',end:'2026-11-03',allDay:true})
})

test('due-only work stays due-only when toggling date mode',()=>{
  const draft={start:'',end:'2026-11-04T16:45',allDay:false}
  const allDay=convertCreationDateMode(draft,true,'task')
  assert.deepEqual(allDay,{start:'',end:'2026-11-04',allDay:true})
  assert.deepEqual(creationDatePayload('task',allDay),{due:'2026-11-04'})
  assert.deepEqual(convertCreationDateMode(allDay,false,'task',draft),draft)
})

test('invalid date ranges are rejected while optional work dates and notes stay valid',()=>{
  assert.throws(()=>creationDatePayload('event',{start:'2026-11-02',end:'2026-11-02',allDay:true}),/end after/)
  assert.throws(()=>creationDatePayload('task',{start:'2026-11-03',end:'2026-11-02',allDay:true}),/after its start/)
  assert.throws(()=>creationDatePayload('task',{start:'2026-11-02',end:'2026-11-02',allDay:true}),/leave Start empty/)
  assert.throws(()=>creationDatePayload('card',{start:'2026-02-31',end:'',allDay:true}),/valid dates/)
  assert.deepEqual(creationDatePayload('task',{start:'',end:'',allDay:true}),{})
  assert.deepEqual(creationDatePayload('note',{start:'invalid',end:'invalid',allDay:false}),{})
})

test('day arithmetic uses local calendar days over DST transitions',()=>{
  assert.equal(shiftCreationDay('2026-03-28',2),'2026-03-30')
  assert.equal(shiftCreationDay('2026-10-24',2),'2026-10-26')
})

test('changing item type preserves edited coverage with inclusive work and exclusive event bounds',()=>{
  const range=creationRangeFromInputs('task',{start:'2026-11-02',end:'2026-11-05',allDay:true})
  assert.deepEqual(creationDateInputs(range,'event'),{start:'2026-11-02',end:'2026-11-06',allDay:true})
  assert.deepEqual(creationDateInputs(range,'card'),{start:'2026-11-02',end:'2026-11-05',allDay:true})
  const oneDay=creationRangeFromInputs('task',{start:'',end:'2026-11-02',allDay:true})
  assert.deepEqual(creationDateInputs(oneDay,'event'),{start:'2026-11-02',end:'2026-11-03',allDay:true})
  const timed={start:'2026-11-03T10:15',end:'2026-11-05T11:45',allDay:false}
  assert.deepEqual(creationDateInputs(creationRangeFromInputs('event',timed),'card'),timed)
})
