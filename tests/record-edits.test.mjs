import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createRecordEdits} from '@nextspace/core/record-edits.mjs'
const deferred = () => {let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no});return {promise,resolve,reject}}
test('failed queue reports every retained field so a new content draft cannot erase a failed date change',async()=>{
  let record={id:'a',body:'Original',due:'2026-11-02'},failedPatches
  const request=deferred()
  const edits=createRecordEdits({read:()=>record,write:(_,next)=>record=next,failed:(_,error,patches)=>failedPatches=patches})
  const date=edits.enqueue('a',{due:'2026-11-06'},()=>request.promise)
  const body=edits.enqueue('a',{body:'Draft'},async previous=>({...previous,body:'Draft'}))
  request.reject(Error('Offline'));await Promise.all([date,body])
  assert.deepEqual(failedPatches,[{due:'2026-11-06'},{body:'Draft'}])
  failedPatches[0].due='mutated callback value'
  assert.equal(record.due,'2026-11-02')
})
function fixture() {
  const records = new Map([['a',{id:'a',body:'- [ ] A\n- [ ] B',due:'2026-11-02',etag:'v1'}],['b',{id:'b',due:'2026-11-03',etag:'b1'}]])
  const errors=[], counts=[]
  const edits=createRecordEdits({read:id=>records.get(id),write:(id,value)=>records.set(id,value),failed:(id,error)=>errors.push({id,error}),changed:n=>counts.push(n)})
  return {records,edits,errors,counts}
}
test('rapid checklist edits render before the network and use the preceding acknowledged ETag',async()=>{
  const {records,edits}=fixture(), first=deferred(),second=deferred(),seen=[]
  const a=edits.enqueue('a',{body:'- [x] A\n- [ ] B'},record=>{seen.push(record.etag);return first.promise})
  const b=edits.enqueue('a',{body:'- [x] A\n- [x] B'},record=>{seen.push(record.etag);return second.promise})
  assert.equal(records.get('a').body,'- [x] A\n- [x] B');assert.deepEqual(seen,['v1'])
  first.resolve({...records.get('a'),body:'- [x] A\n- [ ] B',etag:'v2'});await a
  assert.equal(records.get('a').body,'- [x] A\n- [x] B');assert.deepEqual(seen,['v1','v2'])
  second.resolve({...records.get('a'),etag:'v3'});await b
  assert.equal(records.get('a').etag,'v3')
})
test('date and body edits preserve pending fields and unrelated items through out-of-order responses',async()=>{
  const {records,edits}=fixture(),a=deferred(),b=deferred(),body=deferred()
  const one=edits.enqueue('a',{due:'2026-11-04'},()=>a.promise)
  const two=edits.enqueue('b',{due:'2026-11-05'},()=>b.promise)
  const three=edits.enqueue('a',{body:'Changed'},()=>body.promise)
  b.resolve({...records.get('b'),etag:'b2'});await two
  assert.equal(records.get('a').due,'2026-11-04');assert.equal(records.get('a').body,'Changed')
  a.resolve({id:'a',due:'2026-11-04',body:'Old',etag:'v2'});await one
  assert.equal(records.get('a').body,'Changed');assert.equal(records.get('b').due,'2026-11-05')
  body.resolve({...records.get('a'),etag:'v3'});await three;await edits.idle()
})
test('failed writes restore acknowledged data, preserve a retry draft, and release the idle barrier',async()=>{
  const {records,edits,errors,counts}=fixture(),request=deferred();let attempts=0
  const save=async record=>{if(!attempts++)return request.promise;return {...record,due:'2026-11-08',etag:'v2'}}
  const one=edits.enqueue('a',{due:'2026-11-08'},save)
  const two=edits.enqueue('a',{body:'New body'},async record=>({...record,body:'New body',etag:'v3'}))
  let idle=false;const barrier=edits.idle().then(()=>idle=true)
  assert.equal(idle,false)
  request.reject(new Error('Offline'));assert.equal(await one,false);assert.equal(await two,false);await barrier
  assert.equal(records.get('a').due,'2026-11-02');assert.equal(errors.length,1);assert.equal(counts.at(-1),0)
  assert.equal(await edits.retry('a'),true);assert.equal(records.get('a').due,'2026-11-08');assert.equal(records.get('a').body,'New body')
})
test('a new edit supersedes a failed retry draft instead of allowing stale replay',async()=>{
  const {records,edits}=fixture()
  await edits.enqueue('a',{due:'2026-11-07'},async()=>{throw new Error('Rejected')})
  await edits.enqueue('a',{due:'2026-11-09'},async record=>({...record,due:'2026-11-09'}))
  assert.equal(await edits.retry('a'),false);assert.equal(records.get('a').due,'2026-11-09')
})
