import assert from 'node:assert/strict'
import test from 'node:test'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createViewPreferenceHandlers}=require('../electron/view-preferences.cjs')
const {OperationLanes}=require('../electron/operation-lanes.cjs')

test('Windows preferences select the current authorized client for each operation',async()=>{
  const calls=[];let client={account:'first'}
  const handlers=createViewPreferenceHandlers({
    getClient:()=>{if(!client)throw new Error('Connect first');return client},
    createClient:native=>({read:async()=>{calls.push(['read',native.account]);return {preferences:null,etag:null}},save:async input=>{calls.push(['save',native.account,input]);return {preferences:input.preferences,etag:'saved'}}}),
  })
  assert.deepEqual(await handlers.getViewPreferences(),{preferences:null,etag:null})
  client={account:'second'}
  const input={base:null,preferences:{format:'nextspace-view-preferences',version:1,scopes:{}},etag:null}
  assert.deepEqual(await handlers.saveViewPreferences(input),{preferences:input.preferences,etag:'saved'})
  assert.deepEqual(calls,[['read','first'],['save','second',input]])
  client=null
  await assert.rejects(handlers.getViewPreferences(),/Connect first/)
  await assert.rejects(handlers.saveViewPreferences(input),/Connect first/)
  assert.equal(calls.length,2)
})

test('preference network work does not block native edits and account changes fence it',async()=>{
  const lanes=new OperationLanes(),events=[]
  let release,current='first'
  const pending=lanes.run(async()=>{const account=current;events.push(`read:${account}`);await new Promise(resolve=>release=resolve);events.push(`done:${account}`)},{parallel:true})
  await Promise.resolve()
  await lanes.run(async()=>events.push('native edit'))
  const accountChange=lanes.run(async()=>{current='second';events.push('account changed')},{contextChange:true})
  const nextRead=lanes.run(async()=>events.push(`read:${current}`),{parallel:true})
  await Promise.resolve()
  assert.deepEqual(events,['read:first','native edit'])
  release();await Promise.all([pending,accountChange,nextRead])
  assert.deepEqual(events,['read:first','native edit','done:first','account changed','read:second'])
})
