import test from 'node:test'
import assert from 'node:assert/strict'
import {createSlotCache} from '../src/cache.mjs'
import {compactSourceCache, checkedSourceCache, sourceCacheFingerprint, sourceCacheValidator} from '../src/foundation.mjs'

const key='b'.repeat(64)
const saved = () => ({version:1,accountKey:key,acknowledgedSequence:7,records:[{id:'fixture-task',source:'tasks',kind:'task',title:'Fixture task',collectionId:'tasks',remote:{href:'https://cloud.example.test/remote.php/dav/calendars/user/work/task.ics',raw:'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'}}],collections:[{id:'tasks',source:'tasks',title:'Tasks'}],statuses:[{source:'tasks',state:'connected',count:1,lastSyncedAt:'2026-11-14T10:00:00Z'}]})

test('validated compact and expanded cache compute the same change identity including acknowledged watermark',()=>{
  const original=saved(), compact=compactSourceCache(original), hydrated=checkedSourceCache(compact,key)
  assert.equal(sourceCacheFingerprint(compact),sourceCacheFingerprint(hydrated))
  assert.equal(sourceCacheFingerprint(original),sourceCacheFingerprint(hydrated))
  assert.equal(sourceCacheFingerprint({...compact,statuses:compact.statuses.map(status=>({...status,lastSyncedAt:'2026-11-14T11:00:00Z'}))}),sourceCacheFingerprint(compact))
  assert.notEqual(sourceCacheFingerprint({...compact,acknowledgedSequence:8}),sourceCacheFingerprint(compact))
  assert.notEqual(sourceCacheFingerprint({...compact,records:compact.records.map(record=>({...record,title:'Changed'}))}),sourceCacheFingerprint(compact))
})

test('fingerprint observer sees only the successfully selected cache candidate, never invalid newer or check-only saves',async()=>{
  const compact=compactSourceCache(saved()), bad=structuredClone(compact);bad.records[0].remote.rawRef=100
  const files=new Map([[`cache/${key}.0.json`,JSON.stringify({version:1,generation:1,value:compact})],[`cache/${key}.1.json`,JSON.stringify({version:1,generation:2,value:bad})]])
  const cache=createSlotCache({size:async path=>files.has(path)?Buffer.byteLength(files.get(path)):null,read:async path=>files.get(path)??null,write:async(path,value)=>files.set(path,value),remove:async path=>files.delete(path)})
  const observed=[]
  const restored=await cache.load(key,sourceCacheValidator(key,undefined,value=>observed.push(sourceCacheFingerprint(value))))
  assert.equal(observed.length,1)
  assert.equal(observed[0],sourceCacheFingerprint(restored))
  await cache.save(key,compact)
  assert.equal(observed.length,1,'Save validates but does not hydrate or recertify restored authority')
})
