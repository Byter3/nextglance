// Reproducible synthetic host work, not phone latency or storage throughput.
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {createSlotCache} from '../src/cache.mjs'
import {compactSourceCache, checkedSourceCache, sourceCacheValidator} from '../src/foundation.mjs'

const key='a'.repeat(64), count=2274
const source={accountKey:key,records:Array.from({length:count},(_,index)=>({
  id:`fixture-${index}`,source:'tasks',kind:'task',title:`Fixture ${index}`,body:'Checklist '.repeat(20),
  remote:{href:`https://benchmark.invalid/remote.php/dav/calendars/user/work/${Math.floor(index/24)}.ics`,raw:`BEGIN:VCALENDAR\n${'x'.repeat(16*1024)}\nEND:VCALENDAR`},
})),collections:[],statuses:[]}
async function run(fullHydration) {
  const values=new Map(), timings=[];let hydrations=0,checks=0
  const files={size:async path=>values.has(path)?Buffer.byteLength(values.get(path)):null,read:async path=>values.get(path)??null,write:async(path,text)=>values.set(path,text),remove:async path=>values.delete(path)}
  const cache=createSlotCache(files), current=sourceCacheValidator(key), check=current.check,hydrate=current.hydrate
  current.check=value=>{checks++;return check(value)};current.hydrate=value=>{hydrations++;return hydrate(value)}
  const legacy=value=>{checks++;hydrations++;return checkedSourceCache(value,key)}
  await cache.load(key,fullHydration?legacy:current)
  await cache.save(key,compactSourceCache(source));await cache.save(key,compactSourceCache(source))
  checks=0;hydrations=0
  for(let pass=0;pass<10;pass++){
    const started=performance.now()
    const snapshot=compactSourceCache(source)
    await cache.save(key,snapshot)
    timings.push(performance.now()-started)
  }
  assert.equal(checks,20);assert.equal(hydrations,fullHydration?20:0)
  const text=[...values.values()].map(JSON.parse).sort((a,b)=>b.generation-a.generation)[0]
  assert.deepEqual(checkedSourceCache(text.value,key).records,source.records)
  timings.sort((a,b)=>a-b)
  return {medianMs:+timings[5].toFixed(2),p95Ms:+timings[9].toFixed(2),semanticChecks:checks,fullHydrations:hydrations,bytes:Buffer.byteLength(JSON.stringify(text)),value:text}
}
const old=await run(true), next=await run(false)
assert.deepEqual(next.value,old.value)
delete old.value;delete next.value
console.log(JSON.stringify({fixtureRecords:count,iterations:10,previousFullHydrationValidator:old,checkOnlyValidator:next,identicalSerializedContract:true,evidence:'Desktop Node synthetic prepare + two-slot persistence; both use fresh disk checks. Not physical Android timing. Baseline retains the former full validator; compact preparation is identical in both runs.'},null,2))
