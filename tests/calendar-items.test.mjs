import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarItem, calendarAllDayLayout, calendarTimedItems, calendarDaySummary } from '@nextspace/core/calendar-items.mjs'
process.env.TZ = 'Europe/Budapest'
const work = extra => ({id: 'work', kind: 'task', source: 'tasks', title: 'Native work', ...extra})
const day = value => new Date(`${value}T00:00:00`)

test('timed native tasks and Deck cards use their real bounds; point deadlines invent no duration', () => {
  for (const kind of ['task', 'card']) {
    const item = calendarItem(work({kind, start: '2026-11-02T09:00:00+01:00', due: '2026-11-02T11:00:00+01:00'}))
    assert.equal(item.allDay, false); assert.equal(item.point, false)
    assert.equal(item.end - item.start, 7200000)
    const due = calendarItem(work({kind, due: '2026-11-02T11:00:00+01:00'}))
    assert.equal(due.allDay, false); assert.equal(due.label, 'Due'); assert.equal(due.start, due.end)
    const start = calendarItem(work({kind, start: '2026-11-02T09:00:00+01:00'}))
    assert.equal(start.label, 'Starts'); assert.equal(start.start, start.end)
  }
})

test('multi-day and date-only work belongs at the top, including the due day', () => {
  for (const dates of [
    {start: '2026-11-02', due: '2026-11-04'},
    {start: '2026-11-02T14:00:00+01:00', due: '2026-11-04T10:00:00+01:00'},
  ]) {
    const item = calendarItem(work(dates))
    assert.equal(item.allDay, true)
    assert.equal(item.start, +day('2026-11-02')); assert.equal(item.end, +day('2026-11-05'))
  }
  const due = calendarItem(work({due: '2026-11-03'}))
  assert.equal(due.label, 'Due'); assert.equal(due.start, +day('2026-11-03')); assert.equal(due.end, +day('2026-11-04'))
  assert.equal(calendarItem(work({})), null)
  assert.equal(calendarItem(work({kind: 'note', due: '2026-11-03'})), null)
})

test('all-day events retain exclusive ends and local work days survive daylight saving', () => {
  const item = calendarItem({id: 'event', kind: 'event', title: 'Trip', start: '2026-10-24', end: '2026-10-26', allDay: true})
  assert.equal(item.end, +day('2026-10-26'))
  const workItem = calendarItem(work({due: '2026-10-25'}))
  assert.equal(workItem.end - workItem.start, 25 * 3600000)
  const layout = calendarAllDayLayout([item, workItem], [day('2026-10-24'), day('2026-10-25'), day('2026-10-26')])
  assert.equal(layout.items.find(item => item.id === 'event').last, 2)
  assert.equal(layout.items.find(item => item.id === 'work').last, 2)
})

test('multi-day segments stay in one lane and reuse rows only when dates do not overlap', () => {
  const items = [
    calendarItem(work({id: 'span', title: 'Span', start: '2026-10-30', due: '2026-11-03'})),
    calendarItem(work({id: 'one', title: 'One', due: '2026-11-02'})),
    calendarItem(work({id: 'two', title: 'Two', due: '2026-11-03'})),
    calendarItem(work({id: 'three', title: 'Three', due: '2026-11-04'})),
  ]
  const layout = calendarAllDayLayout(items, [day('2026-11-02'), day('2026-11-03'), day('2026-11-04')])
  assert.equal(layout.lanes, 2)
  assert.equal(layout.items[0].first, 0); assert.equal(layout.items[0].last, 2)
  assert.equal(layout.items.find(item => item.id === 'one').lane, layout.items.find(item => item.id === 'two').lane)
  assert.equal(layout.items.find(item => item.id === 'three').lane, 0)
})

test('native intervals and exact duplicate plans render once while distinct sessions stay visible', () => {
  const record = work({start: '2026-11-02T09:00:00+01:00', due: '2026-11-02T11:00:00+01:00'})
  const items = calendarTimedItems([record], [
    {id: 'same', recordId: record.id, start: record.start, end: record.due},
    {id: 'session', recordId: record.id, start: '2026-11-02T13:00:00+01:00', end: '2026-11-02T14:00:00+01:00'},
    {id: 'foreign', recordId: 'missing', start: record.start, end: record.due},
  ])
  assert.deepEqual(items.map(item => item.id), ['work', 'session'])
  assert.equal(items[1].planned, true)
})

test('day summary counts intersecting native events and open deadlines without counting work spans as bookings', () => {
  const records = [
    {id:'past',kind:'event',start:'2026-10-31',end:'2026-11-02',allDay:true},
    {id:'trip',kind:'event',start:'2026-11-01',end:'2026-11-04',allDay:true},
    {id:'meeting',kind:'event',start:'2026-11-02T09:00:00+01:00',end:'2026-11-02T10:00:00+01:00'},
    work({id:'due',due:'2026-11-02'}),
    work({id:'card',kind:'card',start:'2026-11-01',due:'2026-11-02T23:59:00+01:00'}),
    work({id:'span',start:'2026-11-01',due:'2026-11-05'}),
    work({id:'done',due:'2026-11-02',completed:true}),
    work({id:'cancelled',due:'2026-11-02',status:'CANCELLED'}),
    work({id:'undated'}),
  ]
  assert.deepEqual(calendarDaySummary(records,day('2026-11-02')),{events:2,due:2})
  assert.deepEqual(calendarDaySummary(records,day('2026-11-04')),{events:0,due:0})
})
