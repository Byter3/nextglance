import assert from 'node:assert/strict'
import {test} from 'node:test'
import {connectionEntry,isConnectionAuthorized} from '../packages/core/src/auth-entry.mjs'

const account={connected:false,serverUrl:'https://fixture.invalid',username:'fixture'}
test('Android startup reconnect prompt needs a saved unauthorized account, not unhealthy sources',()=>{
  assert.equal(connectionEntry({connection:{...account,reconnectRequired:true},mobileHost:true,initialStartup:true}).promptReconnect,true)
  assert.equal(connectionEntry({connection:{...account,recoveryOnly:true},mobileHost:true,initialStartup:true}).promptReconnect,true)
  assert.equal(connectionEntry({connection:account,mobileHost:true,initialStartup:true}).promptReconnect,false)
  assert.equal(connectionEntry({connection:{connected:false},mobileHost:true,initialStartup:true}).promptReconnect,false)
})
test('runtime authorization loss and Windows startup never force a dialog',()=>{
  for(const mobileHost of [false,true])assert.equal(connectionEntry({connection:{...account,reconnectRequired:true},mobileHost}).promptReconnect,false)
  assert.equal(connectionEntry({connection:{...account,reconnectRequired:true},initialStartup:true}).promptReconnect,false)
})
test('Files is primary only for native Android; browser/Windows labels are stable',()=>{
  assert.deepEqual(connectionEntry({mobileHost:true,nativeFilesAvailable:true}),{promptReconnect:false,primary:'files',browserLabel:'Sign in using browser'})
  for(const input of [{},{mobileHost:true},{nativeFilesAvailable:true}])assert.deepEqual(connectionEntry(input),{promptReconnect:false,primary:'browser',browserLabel:'Sign in with Nextcloud'})
})
test('authorization confirmation admits an authorized partial source load, never reconnect/recovery/disconnected',()=>{
  assert.equal(isConnectionAuthorized(account),true)
  assert.equal(isConnectionAuthorized({...account,connected:true}),true)
  for(const input of [undefined,null,{connected:false},{...account,reconnectRequired:true},{...account,connected:true,recoveryOnly:true}])assert.equal(isConnectionAuthorized(input),false)
})
