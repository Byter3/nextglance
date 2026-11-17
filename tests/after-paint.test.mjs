import test from 'node:test'
import assert from 'node:assert/strict'
import {createAfterPaint} from '../packages/ui/src/after-paint.mjs'

function fixture(){
  let id=0
  const render=[],frames=new Map(),timers=new Map(),cancelled=[]
  const work=createAfterPaint({afterRender:fn=>render.push(fn),requestFrame:fn=>{frames.set(++id,fn);return id},cancelFrame:id=>{cancelled.push(['frame',id]);frames.delete(id)},schedule:fn=>{timers.set(++id,fn);return id},cancelScheduled:id=>{cancelled.push(['timer',id]);timers.delete(id)}})
  const flush=queue=>{const callbacks=Array.isArray(queue)?queue.splice(0):[...queue.values()];if(!Array.isArray(queue))queue.clear();for(const fn of callbacks)fn()}
  return {work,render,frames,timers,cancelled,flush}
}

test('auxiliary inspector work waits until render, frame and a new task',()=>{
  const f=fixture(),calls=[];f.work.run(()=>calls.push('native-read'))
  assert.equal(f.frames.size,0);assert.deepEqual(calls,[])
  f.flush(f.render);assert.equal(f.frames.size,1);assert.deepEqual(calls,[])
  f.flush(f.frames);assert.equal(f.timers.size,1);assert.deepEqual(calls,[])
  f.flush(f.timers);assert.deepEqual(calls,['native-read'])
  assert.equal(f.frames.size,0);assert.equal(f.timers.size,0)
})
test('selection or account replacement cancels work in each queued phase',()=>{
  for(const phase of ['render','frame','timer']){
    const f=fixture(),calls=[];f.work.run(()=>calls.push('old'))
    if(phase!=='render')f.flush(f.render)
    if(phase==='timer')f.flush(f.frames)
    f.work.run(()=>calls.push('new'))
    f.flush(f.render);f.flush(f.frames);f.flush(f.timers)
    assert.deepEqual(calls,['new'],phase)
  }
})
test('close cancels native launch even if an already queued callback is delivered late',()=>{
  const f=fixture(),calls=[];f.work.run(()=>calls.push('old'));f.flush(f.render);f.flush(f.frames)
  const late=[...f.timers.values()][0];f.work.cancel();late();assert.deepEqual(calls,[])
  assert.equal(f.timers.size,0)
})
test('disposal cancels pending callbacks and forbids any subsequent launch',()=>{
  const f=fixture(),calls=[];f.work.run(()=>calls.push('old'));f.flush(f.render)
  const late=[...f.frames.values()][0];f.work.dispose();late();f.work.run(()=>calls.push('new'))
  f.flush(f.render);f.flush(f.frames);f.flush(f.timers);assert.deepEqual(calls,[])
  assert.equal(f.frames.size,0);assert.equal(f.timers.size,0)
})
