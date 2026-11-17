import test from 'node:test'
import assert from 'node:assert/strict'
import {touchGestureState,reduceTouchGesture,touchTimelineZoom,touchHourZoom,touchPinchAxes,touchCalendarDateZoom} from '../packages/core/src/touch-gestures.mjs'
const event=(type,id=1,x=0,y=0,now=0)=>({type,id,x,y,now})
const start=()=>reduceTouchGesture(touchGestureState(),event('down')).state
test('a short tap and stationary hold are distinct from diagonal navigation',()=>{
  assert.deepEqual(reduceTouchGesture(start(),event('up')).effects,[{type:'tap',point:{id:1,x:0,y:0}}])
  assert.equal(reduceTouchGesture(start(),event('move',1,8,0)).state.mode,'pending')
  const pan=reduceTouchGesture(start(),event('move',1,20,30))
  assert.equal(pan.state.mode,'pan');assert.deepEqual(pan.effects[0],{type:'pan',dx:20,dy:30})
  assert.equal(reduceTouchGesture(pan.state,{type:'hold',eligible:true,now:1000}).state.mode,'pan')
})
test('only stationary eligible items arm at 500ms; cancellation emits no commit',()=>{
  assert.equal(reduceTouchGesture(start(),{type:'hold',eligible:true,now:499}).state.mode,'pending')
  assert.equal(reduceTouchGesture(start(),{type:'hold',eligible:false,now:500}).state.mode,'pending')
  const armed=reduceTouchGesture(start(),{type:'hold',eligible:true,now:500})
  assert.equal(armed.state.mode,'armed-edit');assert.deepEqual(armed.effects,[{type:'arm'}])
  assert.deepEqual(reduceTouchGesture(armed.state,{type:'cancel'}),{state:touchGestureState(),effects:[{type:'cancelEdit'},{type:'suppressClick'}]})
})
test('a second finger cancels an edit and pinches; remaining and third fingers cannot mutate',()=>{
  const armed=reduceTouchGesture(start(),{type:'hold',eligible:true,now:500}).state
  const second=reduceTouchGesture(armed,event('down',2,100,0,510))
  assert.equal(second.state.mode,'pinch');assert.equal(second.effects[0].type,'cancelEdit')
  const spread=reduceTouchGesture(second.state,event('move',2,200,0,520))
  assert.deepEqual(spread.effects[0],{type:'pinch',scale:2,center:{x:100,y:0},axes:{xScale:2,yScale:1,xActive:true,yActive:false}})
  const remaining=reduceTouchGesture(spread.state,event('up',2,200,0,530)).state
  assert.equal(remaining.mode,'suppressed')
  assert.deepEqual(reduceTouchGesture(remaining,event('move',1,10,10,540)).effects,[])
  assert.equal(reduceTouchGesture(second.state,event('down',3,50,50)).state.mode,'suppressed')
  assert.equal(reduceTouchGesture(remaining,event('up')).state.mode,'idle')
})
test('pinch calculations preserve focal time and clamp existing axis ranges',()=>{
  assert.deepEqual(touchHourZoom({height:48,scrollTop:336,startY:120,centerY:120,scale:2,viewportHeight:400}),{height:96,scrollTop:792})
  assert.equal(touchHourZoom({height:48,scrollTop:0,startY:0,centerY:0,scale:10,viewportHeight:400}).height,144)
  assert.equal(touchHourZoom({height:48,scrollTop:0,startY:0,centerY:0,scale:.1,viewportHeight:400}).height,24)
  assert.deepEqual(touchTimelineZoom({anchor:'2026-11-02',days:14,scale:2,dayAtCenter:7,centerPixel:350,viewportWidth:700}),{anchor:'2026-11-06',days:7,scrollLeft:0})
  assert.equal(touchTimelineZoom({anchor:'2026-11-02',days:14,scale:.01,dayAtCenter:0,centerPixel:0,viewportWidth:700}).days,90)
})

test('crossing touch slop retains the pending distance instead of losing small movements',()=>{
  const pending=reduceTouchGesture(start(),event('move',1,5,0,20)).state
  const pan=reduceTouchGesture(pending,event('move',1,10,0,40))
  assert.deepEqual(pan.effects[0],{type:'pan',dx:10,dy:0})
  assert.deepEqual(reduceTouchGesture(pan.state,event('move',1,15,0,60)).effects[0],{type:'pan',dx:5,dy:0})
})

test('independent pinch axes ignore aligned fingers and slop, then retain fixed-start scale',()=>{
  assert.deepEqual(touchPinchAxes({x:100,y:10},{x:108,y:100}),{xScale:1,yScale:1,xActive:false,yActive:false})
  const active=touchPinchAxes({x:100,y:100},{x:150,y:70})
  assert.deepEqual(active,{xScale:1.5,yScale:.7,xActive:true,yActive:true})
  assert.deepEqual(touchPinchAxes({x:100,y:100},{x:105,y:100},active),{xScale:1.05,yScale:1,xActive:true,yActive:true})
  assert.deepEqual(touchPinchAxes({x:10,y:100},{x:200,y:200}),{xScale:1,yScale:2,xActive:false,yActive:true})
})

test('calendar horizontal density preserves fractional focal date and bounds visible days',()=>{
  const input={anchor:'2026-11-01',dayWidth:100,scale:2,dayAtCenter:10.25,centerPixel:150,viewportWidth:700}
  assert.deepEqual(touchCalendarDateZoom(input),{anchor:'2026-11-10',dayWidth:200,visibleDays:4,scrollLeft:100})
  assert.deepEqual(touchCalendarDateZoom(input),touchCalendarDateZoom(input),'repeating a frame is idempotent')
  const wide=touchCalendarDateZoom({...input,scale:.001,viewportWidth:1440})
  assert.equal(wide.dayWidth,16);assert.equal(wide.visibleDays,90)
  assert.equal(touchCalendarDateZoom({...input,scale:100}).dayWidth,1440)
  const nearMidnight=touchCalendarDateZoom({...input,anchor:'2026-03-28',dayAtCenter:1.25,centerPixel:50})
  assert.equal(nearMidnight.anchor,'2026-03-29')
})

test('Overview calendar density uses its actual visible range and preserves fractional focal date',()=>{
  const input={anchor:'2026-11-01',days:2.5,scale:2,dayAtCenter:10.25,centerPixel:100,viewportWidth:200,continuous:true}
  assert.deepEqual(touchTimelineZoom(input),{anchor:'2026-11-10',days:1,scrollLeft:150})
  assert.equal(touchTimelineZoom({...input,scale:.001}).days,90)
})
