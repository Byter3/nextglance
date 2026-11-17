import test from 'node:test'
import assert from 'node:assert/strict'
import {linkedNavigation} from '../packages/core/src/linked-navigation.mjs'
const records=[{id:'task',kind:'task',due:'2026-11-17'},{id:'card',kind:'card'},{id:'event',kind:'event',start:'2026-11-18T14:00:00Z'}]
const intent=(recordId,currentView='overview',extra={})=>linkedNavigation({recordId,records,visibleIds:records.map(item=>item.id),currentView,...extra})
test('linked navigation stays in a time view and has explicit Board/List destinations',()=>{
  for(const view of ['overview','calendar','timeline'])assert.deepEqual(intent('task',view),{ok:true,view,date:'2026-11-17',unscheduled:false})
  for(const view of ['board','list']){assert.equal(intent('task',view).ok,false);assert.deepEqual(intent('event',view,{destination:'calendar'}),{ok:true,view:'calendar',date:'2026-11-18T14:00:00Z',unscheduled:false})}
})
test('missing and filtered links explain the problem without changing anything',()=>{
  const before=JSON.stringify(records)
  assert.match(intent('missing').message,/not loaded/)
  assert.match(intent('task','timeline',{visibleIds:[]}).message,/filters/)
  assert.equal(JSON.stringify(records),before)
})
test('undated work reveals its row or unscheduled section without inventing a date',()=>{
  assert.deepEqual(intent('card','calendar'),{ok:true,view:'calendar',unscheduled:true})
  assert.deepEqual(intent('card','timeline'),{ok:true,view:'timeline',unscheduled:true})
})
