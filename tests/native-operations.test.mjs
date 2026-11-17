import test from 'node:test'
import assert from 'node:assert/strict'
import {canUseNativeOperation,canWriteNativeSource,completionOperation,eventDeleteOperation,deckAttachmentOperation} from '../packages/core/src/native-operations.mjs'

test('delete and attachment eligibility require the matching loaded writable native collection',()=>{
  const event={id:'event',kind:'event',source:'calendar',collectionId:'calendar'},card={id:'card',kind:'card',source:'deck',collectionId:'board'}
  const collections=[{id:'calendar',source:'calendar'},{id:'board',source:'deck'}]
  assert.equal(eventDeleteOperation(event,collections),'deleteEvent')
  for(const operation of ['attachDeckFile','removeDeckAttachment','uploadDeckAttachment'])assert.equal(deckAttachmentOperation(card,collections,operation),operation)
  assert.equal(eventDeleteOperation(event,[]),null);assert.equal(deckAttachmentOperation(card,[]),null)
  assert.equal(eventDeleteOperation({...event,readonly:true},collections),null);assert.equal(deckAttachmentOperation({...card,readonly:true},collections),null)
  assert.equal(eventDeleteOperation(event,[{...collections[0],readonly:true}]),null);assert.equal(deckAttachmentOperation(card,[{...collections[1],readonly:true}]),null)
  assert.equal(eventDeleteOperation({...event,source:'deck'},collections),null);assert.equal(deckAttachmentOperation({...card,source:'calendar'},collections),null)
  assert.equal(deckAttachmentOperation(card,collections,'deleteEvent'),null)
})

const operation='updateNote'
test('completion selects the matching native operation and respects collection permissions',()=>{
  const task={id:'task',kind:'task',source:'tasks',collectionId:'work'},card={id:'card',kind:'card',source:'deck',collectionId:'board'}
  assert.equal(completionOperation(task),'setTaskCompleted')
  assert.equal(completionOperation(card),'setCardCompleted')
  assert.equal(completionOperation({...task,readonly:true}),null)
  assert.equal(completionOperation({...card,readonly:true}),null)
  assert.equal(completionOperation(task,[{id:'work',source:'tasks',readonly:true}]),null)
  assert.equal(completionOperation(card,[{id:'board',source:'deck',readonly:true}]),null)
  assert.equal(completionOperation(task,[{id:'work',source:'deck',readonly:true}]),'setTaskCompleted')
  assert.equal(completionOperation({...task,source:'calendar'}),null)
  assert.equal(completionOperation({...card,kind:'event'}),null)
})
test('reference hosts retain implemented native operations and honor the global read-only flag',()=>{
  assert.equal(canUseNativeOperation({operation,implemented:true}),true)
  assert.equal(canUseNativeOperation({operation,implemented:false}),false)
  assert.equal(canUseNativeOperation({operation,implemented:true,canMutateNative:false}),false)
})
test('scoped hosts require both an explicit implementation allowlist and runtime authorization',()=>{
  const scoped={operation,implemented:true,canMutateNative:false,hostOperations:[operation]}
  assert.equal(canUseNativeOperation({...scoped,runtimeOperations:[operation]}),true)
  assert.equal(canUseNativeOperation(scoped),false)
  assert.equal(canUseNativeOperation({...scoped,runtimeOperations:[]}),false)
  assert.equal(canUseNativeOperation({...scoped,runtimeOperations:['createLinkedEvent']}),false)
  assert.equal(canUseNativeOperation({...scoped,hostOperations:[],runtimeOperations:[operation]}),false)
  assert.equal(canUseNativeOperation({...scoped,implemented:false,runtimeOperations:[operation]}),false)
})
test('runtime restrictions cannot be overridden by a reference host or malformed capabilities',()=>{
  assert.equal(canUseNativeOperation({operation,implemented:true,runtimeOperations:[]}),false)
  assert.equal(canUseNativeOperation({operation,implemented:true,runtimeOperations:[operation]}),true)
  for(const runtimeOperations of [null,{},operation])assert.equal(canUseNativeOperation({operation,implemented:true,runtimeOperations}),false)
  assert.equal(canUseNativeOperation({operation,implemented:true,hostOperations:null,runtimeOperations:[operation]}),false)
  assert.equal(canUseNativeOperation(),false)
})


test('fresh write readiness is independent of bulk freshness but never restored or inferred',()=>{
 const base={source:'deck',connected:true,online:true,statuses:[{source:'deck',state:'error'}]}
 assert.equal(canWriteNativeSource(base),false)
 assert.equal(canWriteNativeSource({...base,nativeWriteSources:['deck']}),true)
 assert.equal(canWriteNativeSource({...base,nativeWriteSources:[],statuses:[{source:'deck',state:'connected'}]}),false)
 assert.equal(canWriteNativeSource({...base,statuses:[{source:'deck',state:'connected'}]}),true)
 for(const override of [{connected:false},{online:false},{busy:true},{loginWaiting:true},{nativeWriteSources:[]},{nativeWriteSources:['tasks']},{nativeWriteSources:null},{statuses:[{source:'deck',state:'connected',permissionDenied:true}]}])assert.equal(canWriteNativeSource({...base,nativeWriteSources:['deck'],...override}),false)
})
