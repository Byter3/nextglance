import test from 'node:test'
import assert from 'node:assert/strict'
import {createDateCanvas,panDateCanvas,dateCanvasAnchor,touchCoastStep} from '../packages/core/src/date-canvas.mjs'
import {timelineOffset} from '../packages/core/src/timeline.mjs'

test('fractional panning preserves the same date through forward and backward rebases',()=>{
  const initial=createDateCanvas({anchor:'2026-11-12',visibleDays:7,dayWidth:85})
  let state=initial,total=0
  for(const delta of [17.25,400.5,800,-1800.75,50000.25,-49800.5]){
    total+=delta;state=panDateCanvas(state,delta)
    assert.equal(state.renderDays,21)
    const dateDistance=timelineOffset(state.anchor,new Date(initial.anchor+'T00:00:00'))
    assert.ok(Math.abs(dateDistance*85+state.scrollLeft-initial.scrollLeft-total)<.00001)
    assert.ok(state.scrollLeft>=0)
  }
})
test('buffer is bounded at every scale; settling does not snap to a week',()=>{
  for(const days of [1,2,7,14,90,999]){
    const state=createDateCanvas({anchor:'2026-11-12',visibleDays:days,dayWidth:80})
    assert.ok(state.renderDays<=270)
    assert.ok(state.paddingDays>=7)
    assert.equal(dateCanvasAnchor(panDateCanvas(state,80.5)),'2026-11-13')
    assert.equal(dateCanvasAnchor(panDateCanvas(state,-.5)),'2026-11-11')
  }
})
test('coast is frame-rate independent, capped, finite and disabled by reduced motion',()=>{
  const one=touchCoastStep({vx:9,vy:-9,dt:32})
  const first=touchCoastStep({vx:9,vy:-9,dt:16})
  const second=touchCoastStep({vx:first.vx,vy:first.vy,elapsed:first.elapsed,dt:16})
  assert.ok(Math.abs(one.dx-first.dx-second.dx)<1e-10)
  assert.ok(Math.abs(one.dy-first.dy-second.dy)<1e-10)
  assert.ok(one.dx<80&&one.dy>-80)
  assert.equal(touchCoastStep({vx:2,vy:0,elapsed:590,dt:40}).elapsed,600)
  assert.equal(touchCoastStep({vx:2,vy:0,elapsed:590,dt:40}).done,true)
  assert.deepEqual(touchCoastStep({vx:2,vy:0,dt:16,reducedMotion:true}),{dx:0,dy:0,vx:0,vy:0,elapsed:0,done:true})
})
