import test from 'node:test'
import assert from 'node:assert/strict'
import {applyReadDenials} from '../src/read-denials.mjs'

const server='https://cloud.example.test'
function saved(){return {records:[{id:'a',source:'deck',kind:'card',title:'A',collectionId:'one'},{id:'b',source:'deck',kind:'card',title:'B',collectionId:'two'}],collections:[{id:'one',source:'deck',remote:{nativeId:1}},{id:'two',source:'deck',remote:{nativeId:2}}],statuses:[{source:'deck',state:'connected'}],acknowledgedSequence:5}}
const denial={source:'deck',code:'PERMISSION',collection:server+'/index.php/apps/deck/api/v1.0/boards/1'}
test('a collection denial retains other boards and acknowledged watermark',()=>{
  const result=applyReadDenials(saved(),[denial],server)
  assert.deepEqual(result.records.map(value=>value.id),['b'])
  assert.deepEqual(result.collections.map(value=>value.id),['two'])
  assert.equal(result.acknowledgedSequence,5)
  assert.deepEqual(result.statuses[0].revokedCollectionIds,['one'])
})
test('public checkpoints without native collection locators cannot leak a denied preview',()=>{
  const value=saved();value.collections=value.collections.map(({remote,...item})=>item)
  assert.equal(applyReadDenials(value,[denial],server).records.length,0)
  assert.equal(saved().records.length,2,'the durable input is untouched')
})
test('malformed persisted denial is a recovery error, never an empty permission list',()=>{
  for(const invalid of [null,{},[{...denial,source:'invented'}],[{...denial,collection:'https://other.example.test/board'}]])assert.throws(()=>applyReadDenials(saved(),invalid,server),{code:'CACHE_UNREADABLE'})
})
