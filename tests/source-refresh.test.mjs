import test from 'node:test'
import assert from 'node:assert/strict'
import {canRefreshSources,sourceConnectionLabel,sourceRefreshFeedback} from '@nextspace/core/source-refresh.mjs'

const restored={connected:false,serverUrl:'https://fixture.invalid',username:'fixture'}

test('a restored authorized account refreshes before its cached sources are verified',()=>{
  assert.equal(canRefreshSources(restored),true)
  assert.equal(canRefreshSources({...restored,connected:true}),true)
  assert.equal(canRefreshSources({...restored,restoreError:'The previous request timed out.'}),true)
})

test('missing, revoked and recovery-only accounts never start source requests',()=>{
  for(const connection of [undefined,null,{connected:false},{connected:false,serverUrl:restored.serverUrl},{connected:false,username:restored.username},{...restored,reconnectRequired:true},{...restored,recoveryOnly:true},{...restored,connected:true,reconnectRequired:true}])
    assert.equal(canRefreshSources(connection),false)
})

test('offline, account handoff and concurrent refresh guards remain effective',()=>{
  for(const options of [{networkOnline:false},{busy:true},{refreshing:true},{loginWaiting:true}])
    assert.equal(canRefreshSources(restored,options),false)
})

test('authorized cold and failed source reads have freshness labels instead of offline or sign-in claims',()=>{
  assert.equal(sourceConnectionLabel(restored),'Source check needed')
  assert.equal(sourceConnectionLabel(restored,{refreshing:true}),'Refreshing sources…')
  assert.equal(sourceConnectionLabel(restored,{sourceErrors:true}),'Source refresh incomplete')
  assert.equal(sourceConnectionLabel({...restored,connected:true}),'Nextcloud connected')
})

test('connection labels distinguish missing authorization from actual offline state',()=>{
  assert.equal(sourceConnectionLabel(undefined),'Not connected')
  assert.equal(sourceConnectionLabel({...restored,reconnectRequired:true}),'Sign-in required')
  assert.equal(sourceConnectionLabel({...restored,recoveryOnly:true}),'Sign-in required')
  assert.equal(sourceConnectionLabel(restored,{networkOnline:false}),'Offline · no items available')
  assert.equal(sourceConnectionLabel({...restored,connected:true},{networkOnline:false,itemCount:2}),'Offline · saved items')
})

test('an empty failed source cannot claim cached records or use a stale status count',()=>{
  assert.deepEqual(sourceRefreshFeedback({statuses:[{source:'calendar',state:'error',count:250,message:'DAV safety limit reached.'}],records:[]}),[
    {source:'calendar',count:0,message:'DAV safety limit reached.',summary:'No items from this source are currently available.'},
  ])
})

test('partial reads describe retained records truthfully and keep source diagnostics',()=>{
  const snapshot={statuses:[
    {source:'tasks',state:'error',count:0,message:'Task list could not refresh.'},
    {source:'calendar',state:'error',count:99,message:'DAV safety limit reached.'},
    {source:'notes',state:'connected',count:1},
  ],records:[{source:'tasks',id:'old-task'},{source:'tasks',id:'fresh-task'},{source:'notes',id:'note'}]}
  const before=structuredClone(snapshot)
  assert.deepEqual(sourceRefreshFeedback(snapshot),[
    {source:'tasks',count:2,message:'Task list could not refresh.',summary:'2 loaded/retained items may be incomplete or out of date.'},
    {source:'calendar',count:0,message:'DAV safety limit reached.',summary:'No items from this source are currently available.'},
  ])
  assert.deepEqual(snapshot,before)
})

test('a newly downloaded subset does not imply pre-existing cache',()=>{
  assert.deepEqual(sourceRefreshFeedback({statuses:[{source:'calendar',state:'error',count:1}],records:[{source:'calendar',id:'new-event'}]}),[
    {source:'calendar',count:1,message:undefined,summary:'1 loaded/retained item may be incomplete or out of date.'},
  ])
  assert.deepEqual(sourceRefreshFeedback(),[])
})
