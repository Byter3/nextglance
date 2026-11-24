import test from 'node:test'
import assert from 'node:assert/strict'
import {syncNotice,syncNoticePresentation} from '@nextspace/core/sync-notice.mjs'
const connection={connected:true,serverUrl:'https://fixture.invalid',username:'fixture'}
const failure=(source,errorCode)=>({source,state:'error',count:1947,errorCode,message:'Detailed connector diagnostic'})

test('progress alone is not an error, offline state or an authorization diagnosis',()=>{
  assert.equal(syncNotice({connection,refreshing:true}),null)
  assert.equal(syncNotice({connection:{...connection,connected:false,restoreError:'Refreshing sources…'},refreshing:true}),null)
  assert.equal(syncNotice({connection}),null)
  assert.equal(syncNotice(),null)
})
test('an incomplete calendar scan remains distinguishable from an authentication failure',()=>{
  const result=syncNotice({connection,statuses:[failure('tasks','LIMIT'),failure('calendar','LIMIT')]})
  assert.equal(result.message,'Tasks and Calendar are incomplete: scan limit reached.')
  assert.equal(result.action,'retry-sources')
  assert.equal(result.message.includes('1947'),false)
  assert.equal(syncNotice({connection,statuses:[failure('calendar','AUTH')]}).action,'reconnect')
})
test('a running retry retains known source failures without adding generic duplicate errors',()=>{
  const result=syncNotice({connection,refreshing:true,statuses:[failure('calendar','TIMEOUT')]})
  assert.equal(result.message,'Calendar refresh timed out. Retrying…')
  assert.equal(result.action,null)
  assert.equal(syncNotice({connection,statuses:[failure('calendar','CANCELLED')]}),null)
})
test('planner conflicts take priority over source warnings and offer review, not blind retry',()=>{
  const result=syncNotice({connection,storage:{syncStatus:'conflict',errorCode:'FOLDER_CONFLICT'},statuses:[failure('calendar','LIMIT'),failure('tasks','FILES_TRANSPORT')]})
  assert.equal(result.kind,'planner')
  assert.equal(result.action,'details')
  assert.equal(result.message,'Planner sync has a conflict. Local changes are preserved.')
})
test('unknown errors remain neutral; access and local storage errors require review',()=>{
  assert.equal(syncNotice({connection,statuses:[failure('deck','UNKNOWN')]}).message,'Deck could not fully refresh.')
  const storage={syncStatus:'error',errorCode:'UNRECOGNIZED',message:'arbitrary server response'}
  assert.equal(syncNotice({connection,storage}).message,'Planner sync needs attention. Local changes are preserved.')
  assert.equal(syncNotice({connection,storage:{...storage,errorCode:'PERMISSION'}}).action,'details')
  assert.equal(syncNotice({connection,storage:{...storage,errorCode:'CACHE_WRITE',errorStage:'local-cache'}}).message,'Local planner storage needs attention.')
})
test('disconnected transport and missing authorization have different available actions',()=>{
  assert.equal(syncNotice({connection,networkOnline:false}).action,null)
  assert.equal(syncNotice({connection:{...connection,reconnectRequired:true}}).action,'reconnect')
  assert.equal(syncNotice({connection:{...connection,connected:false}}).action,'retry-sources')
  assert.equal(syncNotice({connection,networkOnline:false,statuses:[failure('notes','NETWORK')]}).action,null)
})
test('recoverable retries stay in the indicator while actionable recovery remains prominent',()=>{
  assert.equal(syncNoticePresentation(null),'none')
  for(const errorCode of ['NETWORK','TIMEOUT','LIMIT','UNKNOWN']){
    assert.equal(syncNoticePresentation(syncNotice({connection,statuses:[failure('calendar',errorCode)]})),'indicator')
    assert.equal(syncNoticePresentation(syncNotice({connection,storage:{syncStatus:'error',errorCode},syncing:true})),'indicator')
  }
  assert.equal(syncNoticePresentation(syncNotice({connection,networkOnline:false})),'indicator')
  assert.equal(syncNoticePresentation(syncNotice({connection:{...connection,connected:false}})),'indicator')
  for(const errorCode of ['PERMISSION','AUTH','CACHE_WRITE'])assert.equal(syncNoticePresentation(syncNotice({connection,statuses:[failure('calendar','NETWORK'),failure('deck',errorCode)],storage:{syncStatus:'error',errorCode:'TIMEOUT'}})),'banner')
  assert.equal(syncNoticePresentation(syncNotice({connection,statuses:[{...failure('notes','UNKNOWN'),errorStage:'local-cache'}]})),'banner')
  assert.equal(syncNoticePresentation(syncNotice({connection,storage:{syncStatus:'conflict'}})),'banner')
})
