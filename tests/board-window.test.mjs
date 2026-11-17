import test from 'node:test'
import assert from 'node:assert/strict'
import {boardStackLayout,boardStackWindow,boardAnchorAdjustment,boardEdgeScroll} from '../packages/core/src/board-window.mjs'

test('whole measured stacks clip with exclusive boundaries and retain logical order',()=>{
  const layout=boardStackLayout(['a','b','c','d'],{a:50,b:100,c:75,d:30},180,10)
  assert.equal(layout.totalHeight,285)
  assert.deepEqual(boardStackWindow(layout,{top:60,height:100,overscan:0}).map(row=>row.id),['b'])
  assert.deepEqual(boardStackWindow(layout,{top:170,height:75,overscan:0,retainIds:['d','a']}).map(row=>row.id),['a','c','d'])
})
test('unmeasured board is bounded without affecting full heights or empty columns',()=>{
  const layout=boardStackLayout(Array.from({length:2000},(_,i)=>String(i)))
  assert.equal(layout.totalHeight,375992)
  assert.equal(boardStackWindow(layout).length,6)
  assert.deepEqual(boardStackWindow(boardStackLayout([])),[])
  assert.deepEqual(boardStackWindow(layout,{top:500000,height:100,overscan:0,retainIds:['1']}).map(row=>row.id),['1'])
})
test('measurement correction anchors first visible stack and handles removed anchors',()=>{
  const before=boardStackLayout(['a','b','c'],{},100,10),after=boardStackLayout(['a','b','c'],{a:150},100,10)
  assert.equal(boardAnchorAdjustment(before,after,120),50)
  assert.equal(boardAnchorAdjustment(before,boardStackLayout(['a']),120),0)
})
test('drag auto-scroll runs only within bounded viewport edges',()=>{
  assert.equal(boardEdgeScroll(100,100,500),-16);assert.equal(boardEdgeScroll(500,100,500),16)
  assert.equal(boardEdgeScroll(300,100,500),0);assert.equal(boardEdgeScroll(99,100,500),0)
})
