import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeSyncSettings,validateSyncSettings,dueSyncSources,sourceSyncStale} from '@nextspace/core/sync-policy.mjs'
const now=Date.parse('2026-11-12T12:00:00Z')
const settings={caldavMinutes:15,deckMinutes:30,wifiOnly:false}
const status=(source,minutes,state='connected')=>({source,state,count:1,lastSyncedAt:new Date(now-minutes*60000).toISOString()})
test('preferences normalize legacy values but submitted settings reject invalid or extra fields',()=>{
  assert.deepEqual(normalizeSyncSettings({caldavMinutes:1,deckMinutes:0,wifiOnly:'false'}),{caldavMinutes:15,deckMinutes:0,wifiOnly:false})
  for(const bad of [null,[],{...settings,other:1},{...settings,deckMinutes:'30'},{...settings,wifiOnly:1}])assert.throws(()=>validateSyncSettings(bad),{code:'VALIDATION'})
  assert.deepEqual(validateSyncSettings(settings),settings)
})
test('due groups share a CalDAV scan and preserve independent Deck cadence',()=>{
  const statuses=[status('tasks',15),status('calendar',10),status('deck',20),status('notes',5),status('collectives',5)]
  assert.deepEqual(dueSyncSources(settings,statuses,{},now),['tasks','calendar'])
  assert.deepEqual(dueSyncSources(settings,statuses,{caldav:now-60000},now),[])
  assert.deepEqual(dueSyncSources({...settings,caldavMinutes:0},statuses,{},now),[])
  assert.deepEqual(dueSyncSources(settings,[],{},now,{includeOthers:false}),['tasks','calendar','deck'])
  const restored=[status('tasks',1,'unavailable'),status('calendar',1,'unavailable'),status('deck',1)]
  assert.deepEqual(dueSyncSources(settings,restored,{},now,{includeOthers:false}),['tasks','calendar'])
  assert.deepEqual(dueSyncSources(settings,restored,{caldav:now-1000},now,{includeOthers:false}),[])
})
test('freshness follows selected cadence rather than expiring after two minutes',()=>{
  assert.equal(sourceSyncStale([status('deck',20)],settings,now),false)
  assert.equal(sourceSyncStale([status('tasks',18)],settings,now),true)
  assert.equal(sourceSyncStale([status('deck',500)],{...settings,deckMinutes:0},now),false)
  assert.equal(sourceSyncStale([status('deck',0,'error')],settings,now),true)
  assert.equal(sourceSyncStale([status('deck',-1)],settings,now),true)
})
