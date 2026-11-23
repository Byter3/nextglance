import test from 'node:test'
import assert from 'node:assert/strict'
import {widgetCalendarClock,widgetCalendarGrid} from '@nextspace/core/widget-calendar.mjs'

const options={today:'2026-11-23',timeZone:'Europe/Budapest',locale:'en-GB',mode:'week',collections:[]}
const event=(id,start,end,extra={})=>({id,title:id,kind:'event',source:'calendar',collectionId:'cal',start,end,...extra})

test('zoned clock finds actual 23/25-hour boundaries without changing ambient timezone',()=>{
  const before=process.env.TZ,clock=widgetCalendarClock('Europe/Budapest')
  const spring=clock.parse('2026-03-29'),fall=clock.parse('2026-10-25')
  assert.equal(spring.toISOString(),'2026-03-28T23:00:00.000Z');assert.equal(+clock.tomorrow(spring)-spring,23*3600000)
  assert.equal(fall.toISOString(),'2026-10-24T22:00:00.000Z');assert.equal(+clock.tomorrow(fall)-fall,25*3600000)
  assert.equal(clock.minute(new Date('2026-03-29T01:30:00Z')),210)
  assert.equal(Number.isFinite(+clock.parse('2026-02-30')),false);assert.equal(process.env.TZ,before)
})

test('week grid splits midnight, preserves overlaps, and treats all-day event ends as exclusive',()=>{
  const records=[event('overnight','2026-11-23T22:30:00Z','2026-11-24T01:00:00Z'),event('overlap','2026-11-24T00:00:00Z','2026-11-24T00:30:00Z'),event('conference','2026-11-23','2026-11-25',{allDay:true}),{id:'due',title:'Delivery',kind:'task',source:'tasks',due:'2026-11-25'}]
  const before=structuredClone(records),grid=widgetCalendarGrid(records,[],options)
  assert.deepEqual(grid.days.map(day=>day.date),['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27','2026-11-28','2026-11-29'])
  assert.deepEqual(grid.timed.map(({recordId,dayIndex,startMinute,endMinute,lane,laneCount})=>({recordId,dayIndex,startMinute,endMinute,lane,laneCount})),[
    {recordId:'overnight',dayIndex:0,startMinute:1410,endMinute:1440,lane:0,laneCount:1},
    {recordId:'overnight',dayIndex:1,startMinute:0,endMinute:120,lane:0,laneCount:2},
    {recordId:'overlap',dayIndex:1,startMinute:60,endMinute:90,lane:1,laneCount:2}])
  assert.deepEqual(grid.allDay.map(({recordId,startDay,endDay,lane})=>({recordId,startDay,endDay,lane})),[{recordId:'conference',startDay:0,endDay:2,lane:0},{recordId:'due',startDay:2,endDay:3,lane:0}])
  assert.equal(grid.hourStart,0);assert.equal(grid.hourEnd,24);assert.deepEqual(records,before)
})

test('repeated-hour intervals retain real records and render a marker instead of an invented duration',()=>{
  const record=event('fold','2026-10-25T00:50:00Z','2026-10-25T01:10:00Z')
  const grid=widgetCalendarGrid([record],[],{...options,today:'2026-10-25',mode:'day'})
  assert.deepEqual(grid.timed.map(({startMinute,endMinute,point})=>({startMinute,endMinute,point})),[{startMinute:170,endMinute:170,point:true}])
  assert.equal(record.end,'2026-10-25T01:10:00Z')
})

test('native work and genuine plan sessions share the regular calendar duplicate rules',()=>{
  const record={id:'work',title:'Prepare release',kind:'task',source:'tasks',start:'2026-11-23T09:00:00Z',due:'2026-11-23T10:00:00Z'}
  const plans=[{id:'same',recordId:'work',start:record.start,end:record.due},{id:'extra',recordId:'work',start:'2026-11-24T13:00:00Z',end:'2026-11-24T14:00:00Z'},{id:'foreign',recordId:'excluded',start:'2026-11-23T13:00:00Z',end:'2026-11-23T15:00:00Z'}]
  const grid=widgetCalendarGrid([record],plans,options)
  assert.deepEqual(grid.timed.map(({id,planned})=>({id,planned})),[{id:'work',planned:false},{id:'extra',planned:true}])
  assert.equal(grid.hourStart,8);assert.equal(grid.hourEnd,18)
})

test('empty calendar retains rolling local dates and a compact useful hour range',()=>{
  const grid=widgetCalendarGrid([],[],{...options,mode:'day'})
  assert.equal(grid.days.length,1);assert.equal(grid.days[0].today,true);assert.equal(grid.hourStart,8);assert.equal(grid.hourEnd,18)
  assert.equal(grid.timed.length,0);assert.equal(grid.allDayLanes,0)
})
