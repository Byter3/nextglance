import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {atomicWriteJson} from '@nextspace/nextcloud-node/workspace.mjs'
import {readCalendarHistory,saveCalendarHistory,SourceHistorySession} from '../electron/calendar-history.mjs'
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}

test('Windows history defaults to All and stores independent validated per-account choices',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'nextglance-history-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const first=path.join(root,'first'),second=path.join(root,'second');await mkdir(first);await mkdir(second)
  assert.equal(await readCalendarHistory(first),null)
  for(const days of [0,30,36500,null]){await saveCalendarHistory(first,days,{writeJson:atomicWriteJson});assert.equal(await readCalendarHistory(first),days);assert.equal(await readCalendarHistory(second),null)}
  for(const days of [-1,36501,1.5,'30',undefined])await assert.rejects(saveCalendarHistory(first,days,{writeJson:()=>assert.fail('invalid value persisted')}),{code:'VALIDATION'})
  for(const value of ['broken',JSON.stringify({version:2,days:30}),JSON.stringify({version:1,days:-1})]){await writeFile(path.join(first,'calendar-history.json'),value);assert.equal(await readCalendarHistory(first),null)}
})
test('a failed preference save preserves the current ticket; successful change invalidates it',async()=>{
  const session=new SourceHistorySession(14),old=session.ticket()
  await assert.rejects(session.set(null,async()=>{throw Error('disk full')}),/disk full/)
  assert.equal(old.current(),true);assert.equal(session.days,14)
  const current=await session.set(null,async days=>days)
  assert.equal(old.current(),false);assert.equal(current.current(),true);assert.equal(session.days,null)
  session.close();assert.equal(current.current(),false)
  await assert.rejects(session.set(0,()=>assert.fail('closed session persisted')),{code:'CANCELLED'})
})
test('settings and short publication serialize while slow reads remain cancelable',async()=>{
  const session=new SourceHistorySession(14),started=deferred(),release=deferred(),events=[]
  const publish=session.publish(async()=>{events.push('commit:start');started.resolve();await release.promise;events.push('commit:end')})
  await started.promise
  const first=session.set(30,async value=>{events.push('save:30');return value})
  const last=session.set(null,async value=>{events.push('save:all');return value})
  assert.deepEqual(events,['commit:start']);release.resolve();await publish
  const [firstTicket,lastTicket]=await Promise.all([first,last])
  assert.equal(firstTicket.current(),false);assert.equal(lastTicket.current(),true)
  assert.deepEqual(events,['commit:start','commit:end','save:30','save:all'])
})
