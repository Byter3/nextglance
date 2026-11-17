import test from 'node:test'
import assert from 'node:assert/strict'
import {reconcileIdentities} from '@nextspace/core/identity.mjs'
import {allRelations, createPlannerWorkspace} from '@nextspace/core/planner.mjs'

test('native Deck prerequisites keep their direction across durable identity resolution and partial refreshes', () => {
  let sequence = 0
  const id = () => `durable-${++sequence}`
  const dependent = {id:'deck:7',source:'deck',kind:'card',identity:{source:'deck',key:'server:card:7',aliases:['deck:7']},nativeDependencies:['deck:8','deck:8','unavailable:9']}
  const prerequisite = {id:'deck:8',source:'deck',kind:'card',identity:{source:'deck',key:'server:card:8',aliases:['deck:8']}}
  const first = reconcileIdentities(createPlannerWorkspace(),[dependent,prerequisite],id)
  assert.deepEqual(first.records[0].nativeDependencies,['durable-2','unavailable:9'])
  assert.deepEqual(allRelations(first.workspace,first.records).map(edge=>[edge.fromId,edge.toId]),[
    ['durable-1','durable-2'],['durable-1','unavailable:9'],
  ])
  const refreshed = reconcileIdentities(first.workspace,[{...dependent,id:'new-connector-7'}],id)
  assert.equal(refreshed.records[0].id,'durable-1')
  assert.deepEqual(refreshed.records[0].nativeDependencies,['durable-2','unavailable:9'],'A prerequisite not included in this partial refresh still resolves through its identity registry')
  assert.deepEqual(dependent.nativeDependencies,['deck:8','deck:8','unavailable:9'],'Input cache is not mutated')
})

test('legacy Deck dependency cache aliases are resolved before compatibility normalization', () => {
  let sequence = 0
  const next = reconcileIdentities(createPlannerWorkspace(),[
    {id:'old-owner',source:'deck',nativeRelatedIds:['old-child']},
    {id:'old-child',source:'deck'},
  ],()=>`id-${++sequence}`)
  assert.deepEqual(next.records[0].nativeRelatedIds,['id-2'])
  assert.deepEqual(allRelations(next.workspace,next.records).map(edge=>[edge.type,edge.fromId,edge.toId]),[['depends_on','id-1','id-2']])
})
