import test from 'node:test'
import assert from 'node:assert/strict'
import { relationPickerEligibility, relationPickerIntent } from '@nextspace/core/relation-picker.mjs'

const records = [{id:'card',kind:'card'}, {id:'task',kind:'task'}, {id:'other',kind:'task'}, {id:'note',kind:'note'}, {id:'page',kind:'page'}, {id:'event',kind:'event'}]
const item = id => records.find(record => record.id === id)
const eligibility = (target, mode='dependency', direction='incoming', edges=[]) => relationPickerEligibility(item('card'), item(target), mode, direction, edges, records)

test('dependency picker maps incoming and outgoing work order to stored depends_on direction', () => {
  assert.deepEqual(relationPickerIntent('card','task','dependency','incoming'),{fromId:'card',toId:'task',type:'depends_on'})
  assert.deepEqual(relationPickerIntent('card','task','dependency','outgoing'),{fromId:'task',toId:'card',type:'depends_on'})
})
test('dependency picker rejects self, notes and events but accepts work', () => {
  assert.equal(eligibility('task').ok,true)
  for (const id of ['card','note','page','event']) assert.equal(eligibility(id).ok,false)
})
test('dependency picker validates duplicate and multi-step cycle in the chosen direction', () => {
  const edges = [{type:'depends_on',fromId:'card',toId:'task'},{type:'depends_on',fromId:'task',toId:'other'}]
  assert.match(eligibility('task','dependency','incoming',edges).message,/Already linked/)
  assert.match(eligibility('other','dependency','outgoing',edges).message,/cycle/)
  assert.equal(eligibility('other','dependency','incoming',edges).ok,true)
})
test('reference picker accepts Notes and Collective pages and detects reversed existing reference', () => {
  assert.equal(eligibility('note','note').ok,true)
  assert.equal(eligibility('page','note').ok,true)
  assert.equal(eligibility('task','note').ok,false)
  assert.equal(eligibility('note','note','incoming',[{type:'reference',fromId:'note',toId:'card'}]).ok,false)
  assert.deepEqual(relationPickerIntent('card','note','note'),{fromId:'card',toId:'note',type:'reference'})
})
test('generic relation is not mistaken for a dependency and rejects reversed duplicate', () => {
  const edges = [{type:'related',fromId:'task',toId:'card',native:true}]
  assert.equal(eligibility('task','dependency','incoming',edges).ok,true)
  assert.equal(eligibility('task','related','incoming',edges).ok,false)
})
test('work for event preserves event role and restricts destination to calendar events', () => {
  assert.deepEqual(relationPickerIntent('card','event','event-work','incoming','follow_up'),{fromId:'card',toId:'event',type:'for_event',role:'follow_up'})
  assert.equal(eligibility('event','event-work').ok,true)
  assert.equal(eligibility('task','event-work').ok,false)
})
