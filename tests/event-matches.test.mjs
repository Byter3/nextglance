import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeMatchTitle, suggestEventMatches} from '@nextspace/core/event-matches.mjs'

const work=(id,title,extra={})=>({id,title,source:'tasks',kind:'task',collectionId:'personal-tasks',collectionTitle:'Personal',...extra})
const event=(id,title,start='2026-11-18T19:00:00+01:00',extra={})=>({id,title,source:'calendar',kind:'event',start,end:'2026-11-18T19:30:00+01:00',collectionId:'personal-calendar',collectionTitle:'Personal calendar',...extra})

test('the Aster example recommends the same-day booking despite different parenthetical deadline notes',()=>{
  const records=[work('subscription','Cancel Aster subscription (within 30 days - deadline Nov 25)',{due:'2026-11-18'}),event('booking','Cancel Aster subscription (deadline Nov 25)')]
  const before=structuredClone(records),matches=suggestEventMatches(records)
  assert.equal(matches.length,1)
  assert.deepEqual([matches[0].fromId,matches[0].toId],['subscription','booking'])
  assert.equal(matches[0].recommended,true)
  assert.equal(matches[0].dateDistanceDays,0)
  assert.ok(matches[0].reasons.includes('Same title without extra notes'))
  assert.deepEqual(records,before,'Suggestion generation must never edit source records')
})

test('Unicode, accents, punctuation and time-prefix variations still find distinctive multilingual work',()=>{
  assert.equal(normalizeMatchTitle('FOTÓZÁS — Pózok, Strand!'),'fotozas pozok strand')
  const matches=suggestEventMatches([work('photo','Fotózás – Pózok Strand',{due:'2026-11-18'}),event('photo-booking','19:00–19:30 Fotózás: pózok, strand!')])
  assert.equal(matches.length,1);assert.equal(matches[0].recommended,true)
  assert.equal(suggestEventMatches([work('blueprint','ProjectBlueprints'),event('session','ProjectBlueprints')]).length,1)
})

test('names must carry useful evidence; matching dates alone, generic titles and mismatched invoice IDs never suffice',()=>{
  for(const title of ['Meeting','Review','Work session','Call','Reminder','To do'])assert.deepEqual(suggestEventMatches([work('work',title,{due:'2026-11-18'}),event('booking',title)]),[],title)
  assert.deepEqual(suggestEventMatches([work('work','Cancel Aster subscription',{due:'2026-11-18'}),event('booking','Buy garden furniture')]),[])
  assert.deepEqual(suggestEventMatches([work('invoice','Pay ExampleCo invoice 2026-123451',{due:'2026-11-18'}),event('booking','Pay ExampleCo invoice 2026-123452')]),[])
  assert.deepEqual(suggestEventMatches([work('work','Cancel Aster subscription',{due:'2026-11-18'}),event('booking','Cancel Birch subscription')]),[])
})

test('small spelling and conjunction differences produce reviewable suggestions for distinctive names',()=>{
  const [typo]=suggestEventMatches([work('work','Rebuid ProjectBlueprints',{due:'2026-11-18'}),event('booking','Rebuild ProjectBlueprints')])
  assert.ok(typo);assert.ok(typo.titleSimilarity<1)
  const [conjunction]=suggestEventMatches([work('work','Project move n update',{due:'2026-11-18'}),event('booking','Project move and update')])
  assert.ok(conjunction)
})

test('dates strengthen matching names without inventing work dates or hiding exact far-apart matches',()=>{
  const records=[work('book','Prepare client delivery'),event('session','Prepare client delivery')]
  const [undated]=suggestEventMatches(records)
  assert.equal(undated.recommended,true);assert.equal(undated.dateDistanceDays,null)
  assert.ok(undated.reasons.includes('Work item has no dates'))
  const [far]=suggestEventMatches([{...records[0],due:'2026-09-01'},records[1]])
  assert.equal(far.recommended,false);assert.ok(far.dateDistanceDays>30);assert.ok(far.warnings.includes('Dates are far apart'))
  const [range]=suggestEventMatches([{...records[0],start:'2026-11-15',due:'2026-11-21'},records[1]])
  assert.equal(range.recommended,true);assert.ok(range.reasons.includes('Event falls within work dates'))
})

test('competing task/card matches across different sources are shown unchecked for explicit review',()=>{
  const records=[work('task','Prepare client delivery',{due:'2026-11-18'}),work('card','Prepare client delivery',{kind:'card',source:'deck',collectionId:'freelance-deck',due:'2026-11-18'}),event('booking','Prepare client delivery')]
  const matches=suggestEventMatches(records)
  assert.equal(matches.length,2)
  assert.ok(matches.every(match=>match.ambiguous&&!match.recommended&&match.warnings.includes('Several work items match this event')))
  const [scoped]=suggestEventMatches([records[0],records[2]])
  assert.equal(scoped.recommended,true,'Caller-provided scope determines which candidates are scanned')
})

test('several distinct bookings can link to one dated work item; undated repeated titles require review',()=>{
  const records=[work('work','Prepare client delivery',{start:'2026-11-17',due:'2026-11-20'}),event('first','Prepare client delivery'),event('second','Prepare client delivery','2026-11-19T19:00:00+01:00',{end:'2026-11-19T20:00:00+01:00'})]
  assert.ok(suggestEventMatches(records).every(match=>match.recommended&&!match.ambiguous))
  const undated=suggestEventMatches([work('work','Prepare client delivery'),...records.slice(1)])
  assert.equal(undated.length,2);assert.ok(undated.every(match=>match.ambiguous&&!match.recommended))
})

test('existing links in either direction and duplicate source rows do not produce duplicate suggestions',()=>{
  const a=work('work','Prepare client delivery',{due:'2026-11-18'}),b=event('booking','Prepare client delivery')
  assert.equal(suggestEventMatches([a,a,b,b]).length,1)
  for(const type of ['scheduled_during','for_event','related'])for(const reversed of [false,true])assert.deepEqual(suggestEventMatches([a,b],[{id:'existing',type,fromId:reversed?b.id:a.id,toId:reversed?a.id:b.id}]),[])
  const [review]=suggestEventMatches([a,b],[{id:'other',type:'scheduled_during',fromId:'other-hidden-work',toId:b.id}])
  assert.equal(review.recommended,false);assert.ok(review.warnings.includes('Event is already linked to other work'))
})

test('different client notes and completed work are not preselected; cancelled or undated calendar events are excluded',()=>{
  const [client]=suggestEventMatches([work('work','Prepare client delivery (Client 1)',{due:'2026-11-18'}),event('booking','Prepare client delivery (Client 2)')])
  assert.equal(client.recommended,false);assert.ok(client.warnings.includes('Extra title notes differ'))
  const [done]=suggestEventMatches([work('work','Prepare client delivery',{completed:true,due:'2026-11-18'}),event('booking','Prepare client delivery')])
  assert.equal(done.recommended,false)
  assert.deepEqual(suggestEventMatches([work('work','Prepare client delivery'),event('booking','Prepare client delivery',undefined,{start:undefined})]),[])
  assert.deepEqual(suggestEventMatches([work('work','Prepare client delivery'),event('booking','Prepare client delivery',undefined,{status:'CANCELLED'})]),[])
})

test('all-day event ends remain exclusive when comparing work deadlines',()=>{
  const records=[work('work','Prepare client delivery',{due:'2026-11-19'}),event('booking','Prepare client delivery','2026-11-18',{end:'2026-11-19',allDay:true})]
  const [match]=suggestEventMatches(records)
  assert.equal(match.dateDistanceDays,1)
  assert.ok(match.reasons.includes('Dates are 1 day apart'))
})
