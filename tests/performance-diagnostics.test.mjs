import test from 'node:test'
import assert from 'node:assert/strict'
import {createPerformanceDiagnostics, sanitizeDiagnosticInput} from '../packages/core/src/performance-diagnostics.mjs'
test('diagnostics is off by default and only whitelisted scalar measurements enter JSON', () => {
  let now = 100
  const log = createPerformanceDiagnostics({now:()=>now, platform:'android', appVersion:'0.6.4'})
  log.record({kind:'source',count:99}); assert.equal(log.summary().eventCount,0)
  log.start(); now += 25
  log.record({kind:'request',method:'GET',status:200,durationMs:10,bytes:123,success:true,code:'https://secret.invalid',title:'private title',url:'https://secret.invalid',body:'private body',headers:{Authorization:'token'},source:'private-name'})
  const report=JSON.parse(log.read()); assert.deepEqual(report.events,[{atMs:25,kind:'request',method:'GET',durationMs:10,bytes:123,status:200,success:true}])
  assert.ok(!log.read().includes('private')); assert.ok(!log.read().includes('secret'))
  assert.equal(sanitizeDiagnosticInput({kind:'made-up'}),null)
  assert.deepEqual(sanitizeDiagnosticInput({kind:'cache',bytes:Infinity,count:-1,durationMs:NaN}),{kind:'cache'})
})
test('diagnostics caps duration and ring events; stop and backwards clocks cannot change previous timing', () => {
  let now=0;const log=createPerformanceDiagnostics({now:()=>now});log.start()
  for(let i=0;i<5007;i++) {now++;log.record({kind:'cache',count:i})}
  assert.equal(log.summary().eventCount,5000);assert.equal(log.summary().dropped,7)
  now=1;log.record({kind:'ui',stage:'frame'});assert.equal(JSON.parse(log.read()).events.at(-1).atMs,5007)
  now=700000; assert.equal(log.summary().recording,false); assert.equal(log.summary().stopReason,'duration')
  assert.equal(log.summary().elapsedMs,600000); log.record({kind:'source'});assert.equal(log.summary().eventCount,5000)
  log.clear();assert.equal(log.summary().eventCount,0);log.start();now+=20;log.stop('background');assert.equal(log.summary().stopReason,'background')
  now+=200;assert.equal(log.summary().elapsedMs,20)
})
test('application metadata is constrained and exported copies cannot mutate retained events', () => {
  const log=createPerformanceDiagnostics({platform:'private model name',appVersion:'account-name'});log.start();log.record({kind:'source',code:'TIMEOUT'})
  const first=JSON.parse(log.read());first.events[0].kind='private';assert.equal(JSON.parse(log.read()).events[0].kind,'source')
  assert.equal(first.platform,'unknown');assert.equal(first.appVersion,'Development');log.stop();assert.equal(log.summary().stopReason,'manual')
})

test('worker event adapter preserves event time without accepting private fields or altering recording bounds', () => {
  let now=100
  const log=createPerformanceDiagnostics({now:()=>now})
  log.recordAt({kind:'restore',stage:'worker-ready'},0)
  assert.equal(log.summary().eventCount,0)
  log.start();now=200
  log.record({kind:'ui',stage:'panel',atMs:1})
  log.recordAt({kind:'restore',stage:'first-checkpoint',title:'private',body:'private'},20)
  log.recordAt({kind:'restore',stage:'full-restore'},20)
  log.recordAt({kind:'ui',stage:'publication'},1000)
  log.recordAt({kind:'restore',stage:'worker-ready'},-10)
  log.recordAt({kind:'ui',stage:'publication'},NaN)
  log.recordAt({kind:'ui',stage:'publication'},Infinity)
  const events=JSON.parse(log.read()).events
  assert.deepEqual(events.map(event=>[event.stage,event.atMs]),[['worker-ready',0],['first-checkpoint',20],['full-restore',20],['panel',100],['publication',100]])
  assert.ok(!log.read().includes('private'))
  assert.equal(log.summary().elapsedMs,100)
  log.stop();log.recordAt({kind:'restore',stage:'worker-ready'},10)
  assert.equal(log.summary().eventCount,5)
  log.clear();log.recordAt({kind:'restore',stage:'worker-ready'},0)
  assert.equal(log.summary().eventCount,0)
})

test('forwarded worker events share the same finite recording and event-count cap', () => {
  let now=0
  const log=createPerformanceDiagnostics({now:()=>now})
  log.start();now=100
  for(let i=0;i<5005;i++)log.recordAt({kind:'cache',count:i},i%100)
  assert.equal(log.summary().eventCount,5000)
  assert.equal(log.summary().dropped,5)
  const events=JSON.parse(log.read()).events
  assert.ok(events.every((event,index)=>index===0||event.atMs>=events[index-1].atMs))
  now=600001;log.recordAt({kind:'source',stage:'finish'},1)
  assert.equal(log.summary().stopReason,'duration')
  assert.equal(log.summary().eventCount,5000)
})

test('transport overflow accounting is bounded and cannot change a stopped recording', () => {
  const log=createPerformanceDiagnostics({now:()=>0})
  log.recordDropped(7);assert.equal(log.summary().dropped,0)
  log.start();log.recordDropped(3);log.recordDropped(5000)
  for(const value of [-1,0.5,5001,NaN,Infinity,'2',Number.MAX_SAFE_INTEGER+1])log.recordDropped(value)
  assert.equal(log.summary().dropped,5003)
  assert.equal(log.summary().eventCount,0)
  log.stop();log.recordDropped(2);assert.equal(log.summary().dropped,5003)
  log.clear();log.recordDropped(2);assert.equal(log.summary().dropped,0)
})
