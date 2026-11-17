import test from 'node:test'
import assert from 'node:assert/strict'
import {calendarPeriod,calendarPeriodDays,shiftCalendarAnchor,calendarMonthWeeks,monthGridZoom,normalizeCalendarMode} from '@nextspace/core/calendar-period.mjs'
import {captureScopePreferences,parseScopePreferences,saveScopePreferences,scopePreferencesFor,applyScopePreferences} from '@nextspace/core/scope-preferences.mjs'
import {calendarMoveEdit} from '@nextspace/core/calendar-edit.mjs'

test('periods preserve local dates in positive and negative time zones across DST',()=>{
  const original=process.env.TZ
  try{for(const zone of ['Europe/Budapest','America/Los_Angeles']){
    process.env.TZ=zone
    for(const date of ['2026-03-29','2026-10-25','2026-03-08','2026-11-01']){
      const period=calendarPeriod(date,'week'),days=calendarPeriodDays(period)
      assert.equal(days.length,7);assert.equal(days[0].getHours(),0)
      assert.equal(`${days[0].getFullYear()}-${String(days[0].getMonth()+1).padStart(2,'0')}-${String(days[0].getDate()).padStart(2,'0')}`,date)
      assert.equal(shiftCalendarAnchor(date,'day',1),calendarPeriod(date,'day').end)
      assert.ok(days.every(day=>day.getHours()===0))
    }
  }}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original}
})

test('month coverage includes exactly four, five or six Monday-first weeks',()=>{
  for(const [anchor,count,start,end] of [['2021-02-17',28,'2021-02-01','2021-03-01'],['2024-02-29',35,'2024-01-29','2024-03-04'],['2026-11-12',42,'2026-10-26','2026-12-07']]){
    const period=calendarPeriod(anchor,'month'),days=calendarPeriodDays(period)
    assert.equal(period.dayCount,count);assert.equal(period.gridStart,start);assert.equal(period.gridEnd,end)
    assert.equal(days[0].getDay(),1);assert.equal(days.at(-1).getDay(),0)
  }
  assert.equal(normalizeCalendarMode('bad'),'week');assert.equal(shiftCalendarAnchor('2024-01-31','month',1),'2024-02-29')
  assert.equal(shiftCalendarAnchor('2026-03-31','month',-1),'2026-02-28')
  assert.throws(()=>calendarPeriod('2026-02-30','month'),/Invalid calendar date/)
})

test('weekly segments retain exclusive event ends and inclusive work due dates',()=>{
  const records=[
    {id:'trip',kind:'event',source:'calendar',title:'Trip',start:'2026-11-01',end:'2026-11-04',allDay:true},
    {id:'work',kind:'card',source:'deck',title:'Work',start:'2026-11-01',due:'2026-11-04'},
  ]
  const weeks=calendarMonthWeeks(records,[],'2026-11-12')
  const first=weeks[0].items,second=weeks[1].items
  assert.deepEqual(first.map(item=>[item.id,item.first,item.last,item.continuesAfter]),[['trip',6,7,true],['work',6,7,true]])
  assert.deepEqual(second.map(item=>[item.id,item.first,item.last,item.continuesBefore]),[['work',0,3,true],['trip',0,2,true]])
  assert.equal(weeks.flatMap(week=>week.items).length,4)
})

test('month keeps timed point dates, midnight exclusivity, and native/session deduplication',()=>{
  const original=process.env.TZ;process.env.TZ='Europe/Budapest'
  try{
    const records=[
      {id:'point',kind:'task',source:'tasks',title:'Point',due:'2026-11-03T11:00:00+01:00'},
      {id:'meeting',kind:'event',source:'calendar',title:'Meeting',start:'2026-11-03T22:00:00+01:00',end:'2026-11-04T00:00:00+01:00'},
      {id:'undated',kind:'task',source:'tasks',title:'Undated'},
    ]
    const weeks=calendarMonthWeeks(records,[{id:'duplicate',recordId:'meeting',start:records[1].start,end:records[1].end},{id:'session',recordId:'point',start:'2026-11-04T09:00:00+01:00',end:'2026-11-04T10:00:00+01:00'}],'2026-11-12')
    const items=weeks[1].items
    assert.deepEqual(items.map(item=>item.id).sort(),['meeting','point','session'])
    for(const id of ['meeting','point']){const item=items.find(item=>item.id===id);assert.equal(item.first,1);assert.equal(item.last,2);assert.equal(item.allDay,false)}
    assert.equal(items.find(item=>item.id==='point').start,items.find(item=>item.id==='point').end)
    assert.equal(items.find(item=>item.id==='session').planned,true)
  }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original}
})

test('month move uses native helper to preserve start wall time and elapsed duration over DST',()=>{
  const original=process.env.TZ;process.env.TZ='Europe/Budapest'
  try{
    const record={id:'event',kind:'event',start:'2026-10-24T09:00:00+02:00',end:'2026-10-24T11:00:00+02:00'}
    const moved=calendarMoveEdit(record,1)
    assert.equal(new Date(moved.start).getHours(),9)
    assert.equal(+new Date(moved.end)-+new Date(moved.start),2*3600000)
    assert.equal(moved.start,'2026-10-25T08:00:00.000Z')
  }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original}
})

test('calendar mode survives local scope storage without entering shared planner fields',()=>{
  let store=parseScopePreferences(null)
  const overview=captureScopePreferences({view:'calendar'},{calendarMode:'month'}),work=captureScopePreferences({view:'calendar'},{calendarMode:'day'})
  store=saveScopePreferences(saveScopePreferences(store,'all',overview),'work',work)
  const restarted=parseScopePreferences(JSON.stringify(store))
  assert.equal(scopePreferencesFor(restarted,'all').calendarMode,'month');assert.equal(scopePreferencesFor(restarted,'work').calendarMode,'day')
  assert.equal(scopePreferencesFor(restarted,'new').calendarMode,'week')
  assert.equal(Object.hasOwn(applyScopePreferences({},'work',work),'calendarMode'),false)
  assert.equal(captureScopePreferences({}, {calendarMode:'unexpected'}).calendarMode,'week')
  assert.equal(captureScopePreferences().calendarMode,'week')
})

test('month density clamps both dimensions and rejects nonpositive scales',()=>{
  assert.deepEqual(monthGridZoom(100,126,4),{dayWidth:220,weekHeight:300})
  assert.deepEqual(monthGridZoom(100,126,.1),{dayWidth:70,weekHeight:100})
  assert.deepEqual(monthGridZoom(100,126,0),{dayWidth:100,weekHeight:126})
})
