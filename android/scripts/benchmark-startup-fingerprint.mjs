// Synthetic desktop Node cache preparation only; not device launch latency.
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {compactSourceCache,checkedSourceCache,sourceCacheFingerprint} from '../src/foundation.mjs'

const key='c'.repeat(64), count=7000
const value={accountKey:key,acknowledgedSequence:3,records:Array.from({length:count},(_,index)=>({id:`fixture-${index}`,source:'tasks',kind:'task',title:`Fixture task ${index}`,collectionId:'tasks',remote:{href:`https://cloud.example.test/remote.php/dav/calendars/user/tasks/${Math.floor(index/20)}.ics`,raw:`BEGIN:VCALENDAR\r\n${'x'.repeat(8192)}\r\nEND:VCALENDAR\r\n`}})),collections:[{id:'tasks',source:'tasks',title:'Tasks'}],statuses:[{source:'tasks',state:'connected',count,lastSyncedAt:'2026-11-14T10:00:00Z'}]}
const compact=compactSourceCache(value), restored=checkedSourceCache(compact,key)
const measure=operation=>{const samples=[];let hash;for(let i=0;i<12;i++){const start=performance.now();hash=operation();samples.push(performance.now()-start)}samples.sort((a,b)=>a-b);return {hash,medianMs:+samples[6].toFixed(2),p95Ms:+samples[11].toFixed(2)}}
const prior=measure(()=>sourceCacheFingerprint(restored)),current=measure(()=>sourceCacheFingerprint(compact))
assert.equal(prior.hash,current.hash)
delete prior.hash;delete current.hash
console.log(JSON.stringify({fixtureRecords:count,compactBytes:Buffer.byteLength(JSON.stringify(compact)),previousRecompactThenHash:prior,validatedCompactHash:current,equalFingerprint:true,evidence:'Desktop Node, synthetic fixture, fingerprint preparation only. JSON/semantic/account validation and native document hydration remain unchanged. This is not physical Android startup timing.'},null,2))
