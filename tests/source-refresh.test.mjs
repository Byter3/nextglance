import test from 'node:test'
import assert from 'node:assert/strict'
import {canRefreshSources,sourceConnectionLabel,sourceRefreshFeedback} from '@nextspace/core/source-refresh.mjs'
import {reconcileCache} from '../win/electron/security.cjs'

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

test('Windows failed refresh retains the last complete refresh date without granting editing',()=>{
  const stamp='2026-11-17T09:00:00.000Z'
  const before={records:[{id:'saved-task',source:'tasks',collectionId:'task-list'}],collections:[{id:'task-list',source:'tasks'}],statuses:[{source:'tasks',state:'connected',lastSyncedAt:stamp,count:1}]}
  const failure={records:[],collections:[],statuses:[{source:'tasks',state:'error',errorCode:'TIMEOUT',errorStage:'source-read',message:'Refresh timed out.',lastSyncedAt:'2026-11-18T09:00:00.000Z',count:0}]}
  const original=structuredClone(failure)
  const failed=reconcileCache(before,failure,['tasks'])
  assert.equal(failed.cache.statuses[0].lastSyncedAt,stamp)
  assert.equal(failed.cache.statuses[0].state,'error')
  assert.equal(failed.cache.statuses[0].errorCode,'TIMEOUT')
  assert.equal(failed.successful.has('tasks'),false)
  assert.equal(failed.cache.records[0].id,'saved-task')
  assert.deepEqual(failure,original,'Reconciliation must not change the incoming response')
  const retried=reconcileCache(failed.cache,failure,['tasks'])
  assert.equal(retried.cache.statuses[0].lastSyncedAt,stamp)
  const success=reconcileCache(retried.cache,{records:[],collections:[],statuses:[{source:'tasks',state:'connected',lastSyncedAt:'2026-11-18T10:00:00.000Z',count:0}]},['tasks'])
  assert.equal(success.cache.statuses[0].lastSyncedAt,'2026-11-18T10:00:00.000Z')
  assert.equal(success.successful.has('tasks'),true)
})

test('Windows never invents last-success dates or retains denied-source content',()=>{
  for(const lastSyncedAt of [undefined,'not-a-date']){
    const before={records:[],collections:[],statuses:[{source:'calendar',state:'error',lastSyncedAt}]}
    const result=reconcileCache(before,{records:[],collections:[],statuses:[{source:'calendar',state:'error',errorCode:'NETWORK',lastSyncedAt:'2026-11-18T09:00:00.000Z'}]},['calendar'])
    assert.equal(result.cache.statuses[0].lastSyncedAt,undefined)
    assert.equal(result.successful.size,0)
  }
  const before={records:[{id:'event',source:'calendar',collectionId:'calendar'}],collections:[{id:'calendar',source:'calendar'}],statuses:[{source:'calendar',state:'connected',lastSyncedAt:'2026-11-17T09:00:00.000Z'}]}
  const denied=reconcileCache(before,{records:[],collections:[],statuses:[{source:'calendar',state:'error',permissionDenied:true,errorCode:'AUTH'}]},['calendar'])
  assert.equal(denied.cache.statuses[0].lastSyncedAt,undefined)
  assert.equal(denied.cache.records.length,0)
  assert.equal(denied.cache.collections.length,0)
  assert.equal(denied.purgeBackup,true)
  assert.equal(denied.successful.size,0)
})
