import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createDateWheel,horizontalWheelDelta,horizontalScrollLimit} from '@nextspace/core/date-wheel.mjs'
test('horizontal intent ignores vertical jitter and zoom, supports Shift and wheel units',()=>{
  assert.equal(horizontalWheelDelta({deltaX:2,deltaY:20}),0)
  assert.equal(horizontalWheelDelta({deltaX:20,deltaY:2}),20)
  assert.equal(horizontalWheelDelta({deltaX:20,ctrlKey:true}),0)
  assert.equal(horizontalWheelDelta({deltaY:-3,shiftKey:true,deltaMode:1}),-48)
  assert.equal(horizontalWheelDelta({deltaX:1,deltaMode:2},640),640)
})
test('small trackpad deltas accumulate instead of being discarded by a throttle',()=>{
  const wheel=createDateWheel();let days=0
  for(let i=0;i<40;i++)days+=wheel.consume(2.5,{dayWidth:100,now:i*5}).days
  assert.equal(days,1)
  assert.equal(wheel.consume(-100,{dayWidth:100,now:210}).days,-1)
})
test('real overflow scrolls first; residual motion pans at either edge',()=>{
  const wheel=createDateWheel()
  assert.deepEqual(wheel.consume(80,{scrollLeft:0,maxScroll:300,dayWidth:40,now:0}),{scrollLeft:80,days:0})
  assert.deepEqual(wheel.consume(100,{scrollLeft:280,maxScroll:300,dayWidth:40,now:10}),{scrollLeft:300,days:2})
  assert.deepEqual(wheel.consume(-80,{scrollLeft:20,maxScroll:300,dayWidth:40,now:20}),{scrollLeft:0,days:-1})
})
test('gesture pauses and direction reversal discard stale fractional travel',()=>{
  const wheel=createDateWheel()
  wheel.consume(90,{dayWidth:100,now:0})
  assert.equal(wheel.consume(20,{dayWidth:100,now:300}).days,0)
  assert.equal(wheel.consume(-90,{dayWidth:100,now:310}).days,0)
  assert.equal(wheel.consume(-10,{dayWidth:100,now:320}).days,-1)
})

test('attainable scrollbar limit is measured without leaving the scroll position changed',()=>{
  let left=90
  const element={scrollWidth:1260,get scrollLeft(){return left},set scrollLeft(value){left=Math.max(0,Math.min(780,value))}}
  assert.equal(horizontalScrollLimit(element),780)
  assert.equal(element.scrollLeft,90)
})
