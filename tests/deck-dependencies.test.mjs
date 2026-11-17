import test from 'node:test'
import assert from 'node:assert/strict'
import {deckDependencyPair, deckDependencyProblem, pendingDeckDependencies} from '@nextspace/core/deck-dependencies.mjs'

const records = [
  {id:'dependent',source:'deck',kind:'card',collectionId:'one',readonly:false},
  {id:'prerequisite',source:'deck',kind:'card',collectionId:'two',readonly:true},
  {id:'task',source:'tasks',kind:'task'},
]
const edge = {id:'legacy',fromId:'dependent',toId:'prerequisite',type:'depends_on'}

test('Deck dependency edit permission belongs to the dependent owning dependentCards', () => {
  assert.equal(deckDependencyProblem(records,edge),'')
  assert.match(deckDependencyProblem(records,{fromId:'prerequisite',toId:'dependent'}),/card that waits for this work is read only/)
  assert.match(deckDependencyProblem(records,edge,false),/Connect and refresh Deck/)
})

test('Deck migration keeps directed legacy card edges without converting generic or cross-app links', () => {
  const workspace={relations:[edge,{...edge,id:'mixed',toId:'task'},{...edge,id:'generic',type:'related'},{...edge,id:'missing',toId:'unavailable'}]}
  assert.deepEqual(pendingDeckDependencies(workspace,records),[edge])
  assert.equal(workspace.relations.length,4)
  assert.equal(deckDependencyPair(records,{fromId:'dependent',toId:'task'}),null)
  assert.match(deckDependencyProblem(records,{fromId:'dependent',toId:'missing'}),/Both Deck cards must be loaded/)
})
