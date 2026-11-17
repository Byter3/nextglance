import test from 'node:test'
import assert from 'node:assert/strict'
import {calendarViewportDays,visibleAllDayLayout,calendarAllDaySize} from '../packages/core/src/calendar-sizing.mjs'

test('viewport dates exclude the sticky gutter and include partially visible dates',()=>{
  const base={scrollLeft:700,viewportWidth:540,gutter:40,dayWidth:100,days:90}
  assert.deepEqual(calendarViewportDays(base),{first:7,last:12})
  assert.deepEqual(calendarViewportDays({...base,scrollLeft:701}),{first:7,last:13})
  assert.deepEqual(calendarViewportDays({...base,scrollLeft:8990}),{first:89,last:90})
  assert.deepEqual(calendarViewportDays({...base,scrollLeft:701,viewportWidth:0}),{first:7,last:7})
  assert.deepEqual(calendarViewportDays({...base,dayWidth:0}),{first:0,last:0})
})

test('offscreen buffered items do not allocate lanes; visible spans keep native coordinates',()=>{
  const item=(id,first,last,lane=99)=>({id,first,last,lane,record:{title:id,color:'#123456'}})
  const source=[...Array.from({length:80},(_,i)=>item(`offscreen-${i}`,20,25)),item('span',0,10),item('one',8,9),item('two',9,12),item('boundary',12,15)]
  const before=structuredClone(source),result=visibleAllDayLayout(source,7,12)
  assert.equal(result.lanes,2)
  assert.deepEqual(result.items.map(({id,first,last,lane})=>({id,first,last,lane})),[
    {id:'span',first:0,last:10,lane:0},{id:'one',first:8,last:9,lane:1},{id:'two',first:9,last:12,lane:1},
  ])
  assert.equal(result.items[0].record,source[80].record)
  assert.deepEqual(source,before)
  assert.deepEqual(visibleAllDayLayout(source,12,12),{items:[],lanes:0})
})

test('automatic all-day allocation follows actual rows and reserves timed hours',()=>{
  assert.equal(calendarAllDaySize({lanes:0,availableHeight:500}).height,24)
  assert.equal(calendarAllDaySize({lanes:1,availableHeight:500}).height,34)
  assert.equal(calendarAllDaySize({lanes:3,availableHeight:500}).height,96)
  assert.equal(calendarAllDaySize({lanes:50,availableHeight:500}).height,180)
  assert.equal(calendarAllDaySize({lanes:50,availableHeight:300}).height,120)
  assert.equal(calendarAllDaySize({lanes:50,availableHeight:160}).height,40)
  assert.equal(calendarAllDaySize({lanes:50,availableHeight:100}).height,24)
})

test('manual allocation clamps after viewport changes and invalid values restore auto',()=>{
  const size=calendarAllDaySize({lanes:1,availableHeight:500,manualHeight:999})
  assert.equal(size.height,320);assert.equal(size.automatic,false)
  assert.equal(calendarAllDaySize({lanes:1,availableHeight:300,manualHeight:320}).height,180)
  assert.equal(calendarAllDaySize({lanes:1,availableHeight:500,manualHeight:-10}).height,24)
  assert.equal(calendarAllDaySize({lanes:1,availableHeight:500,manualHeight:NaN}).height,34)
  assert.equal(calendarAllDaySize({lanes:0,availableHeight:NaN}).height,24)
})
