import test from 'node:test'
import assert from 'node:assert/strict'
import {sourceConnectionLabel} from '@nextspace/core/source-refresh.mjs'
import {restoreSourceStatuses} from '@nextspace/core/cached-sources.mjs'
import {sourceSyncStale} from '@nextspace/core/sync-policy.mjs'

const connection={connected:false,serverUrl:'https://cloud.example.test',username:'fixture'}
const saved=restoreSourceStatuses([{source:'tasks',state:'connected',count:2,lastSyncedAt:'2026-11-22T10:00:00Z'}],[{source:'tasks'}])
test('saved data has an access-check label while actual disconnection and reauthorization remain explicit',()=>{
  assert.equal(sourceConnectionLabel(connection,{statuses:saved}),'Saved data · checking access')
  assert.equal(sourceConnectionLabel(connection,{statuses:saved,networkOnline:false,itemCount:1}),'Offline · saved items')
  assert.equal(sourceConnectionLabel({...connection,reconnectRequired:true},{statuses:saved}),'Sign-in required')
})
test('historical success does not suppress staleness after the interval or a clock reversal',()=>{
  assert.equal(sourceSyncStale(saved,{},Date.parse('2026-11-22T10:01:00Z')),false)
  assert.equal(sourceSyncStale(saved,{},Date.parse('2026-11-22T11:03:00Z')),true)
  assert.equal(sourceSyncStale(saved,{},Date.parse('2026-11-22T09:59:00Z')),true)
})
