import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {effectScope,reactive,nextTick}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')
import {useDateCanvas} from '../packages/ui/src/useDateCanvas.ts'

test('repeated rounded pinch frames position absolutely without accumulating scroll',()=>{
  const scope=effectScope(),input=reactive({anchor:'2026-11-12',visibleDays:14,dayWidth:80,scope:'all'})
  const canvas=scope.run(()=>useDateCanvas(()=>({...input}),()=>{}))
  try{
    for(let index=0;index<6;index++)canvas.position(39.5)
    assert.equal(canvas.scrollLeft.value,14*80+39.5)
    assert.equal(canvas.anchor.value,'2026-10-29')
  }finally{scope.stop()}
})

test('publishing a settled anchor preserves fractional scroll and buffered dates',async()=>{
  const scope=effectScope(),input=reactive({anchor:'2026-11-12',visibleDays:7,dayWidth:80,scope:'all'})
  const canvas=scope.run(()=>useDateCanvas(()=>({...input}),anchor=>{input.anchor=anchor}))
  try{
    canvas.pan(119.5);const before={...canvas.state.value};canvas.settle();await nextTick()
    assert.equal(input.anchor,'2026-11-13')
    assert.deepEqual(canvas.state.value,before)
    input.anchor='2026-12-01';await nextTick()
    assert.equal(canvas.anchor.value,'2026-11-24')
    assert.equal(canvas.scrollLeft.value,560)
  }finally{scope.stop()}
})
