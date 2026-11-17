import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createEmptyState } from '@nextspace/core/planner.mjs'

const state = createEmptyState()
state.mode = 'live'; state.connection = {connected: true, username: 'fixture-user', serverUrl: 'https://fixture.invalid'}
state.workspace.appearance.mode = 'dark'
state.collections = ['calendar', 'tasks', 'deck'].map(source => ({id: source, source, title: `Fixture ${source}`, color: source === 'deck' ? '#7c75e5' : '#328bc2', readonly: false}))
const record = (id, kind, extra) => ({id, kind, source: kind === 'card' ? 'deck' : kind === 'task' ? 'tasks' : 'calendar', collectionId: kind === 'card' ? 'deck' : kind === 'task' ? 'tasks' : 'calendar', collectionTitle: kind === 'card' ? 'Deck' : 'Calendar', title: id, readonly: false, assigneeIds: ['fixture-user'], assignmentKnown: true, ...extra})
state.records = [
  ...[1, 2, 3].map(index => record(`All-day event ${index}`, 'event', {start: '2026-11-02', end: '2026-11-03', allDay: true})),
  record('Multi-day Deck delivery', 'card', {start: '2026-11-02T09:00:00+01:00', due: '2026-11-04T17:00:00+01:00'}),
  record('Timed task', 'task', {start: '2026-11-02T10:00:00+01:00', due: '2026-11-02T12:00:00+01:00'}),
  record('Timed card', 'card', {start: '2026-11-03T09:00:00+01:00', due: '2026-11-03T11:00:00+01:00'}),
  record('Timed deadline', 'task', {due: '2026-11-04T10:00:00+01:00'}),
  record('Date-only deadline', 'task', {due: '2026-11-04'}),
  record('Overlapping meeting', 'event', {start: '2026-11-02T10:00:00+01:00', end: '2026-11-02T11:00:00+01:00'}),
  record('Undated work', 'task', {}),
]
state.workspace.plans = [{id: 'identical-session', recordId: 'Timed task', start: '2026-11-02T10:00:00+01:00', end: '2026-11-02T12:00:00+01:00'}]
state.statuses = state.statuses.map(status => ({...status, state: 'connected'}))
await mkdir('artifacts', {recursive: true})
const browser = await chromium.launch({channel: 'msedge', headless: true})
const context = await browser.newContext({viewport: {width: 1652, height: 1050}, timezoneId: 'Europe/Budapest'})
const page = await context.newPage(), errors = [], checks = []
page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000)
await page.addInitScript(initial => {
  const read=async()=>structuredClone(initial)
  window.workspaceApi = {getState:read,refresh:read,openExternal:async()=>{},saveWorkspace:async(workspace)=>{initial.workspace=structuredClone(workspace);initial.revision++;return {workspace:structuredClone(workspace),revision:initial.revision,storage:initial.storage}}}
}, state)
try {
  await page.goto('http://127.0.0.1:5173')
  await page.locator('.overview-split').waitFor()
  await page.getByLabel('Choose calendar date').fill('2026-11-02')
  await page.getByLabel('Choose calendar date').dispatchEvent('change')
  const calendar = page.locator('.overview-split .calendar-view')
  const top = calendar.locator('.calendar-all-day-viewport')
  const geometry = await top.evaluate(el => ({height: el.clientHeight, scrollHeight: el.scrollHeight, nested: [...el.querySelectorAll('.all-day-cell')].some(cell => cell.scrollHeight > cell.clientHeight + 1)}))
  assert.ok(geometry.height >= 145 && geometry.height <= 176, JSON.stringify(geometry))
  assert.ok(geometry.scrollHeight <= geometry.height + 1 && !geometry.nested, 'Four simultaneous all-day items should fit without a scrollbar')
  checks.push('Three all-day events plus a multi-day Deck card fit with 30px rows and no nested scrolling')
  assert.equal(await calendar.locator('.calendar-event[data-record-id="Timed task"]').count(), 1)
  assert.equal(await calendar.locator('.calendar-event[data-record-id="Timed card"]').count(), 1)
  assert.equal(await calendar.locator('.calendar-event[data-record-id="Timed deadline"]').count(), 1)
  assert.equal(await calendar.locator('.all-day-event[data-record-id="Multi-day Deck delivery"]').count(), 1)
  assert.equal(await calendar.locator('.calendar-event[data-record-id="Multi-day Deck delivery"]').count(), 0)
  assert.equal(await calendar.locator('.all-day-event[data-record-id="Date-only deadline"]').getAttribute('data-first-day'), '2026-11-04')
  assert.equal(await calendar.locator('.all-day-event[data-record-id="All-day event 1"]').getAttribute('data-last-day'), '2026-11-02')
  checks.push('Native tasks and Deck cards use hour slots or inclusive multi-day strips; event end stays exclusive and duplicate session is suppressed')
  const span = await calendar.locator('.all-day-event[data-record-id="Multi-day Deck delivery"]').boundingBox()
  const firstCell=await calendar.locator('.all-day-cell').nth(0).boundingBox(),lastCell=await calendar.locator('.all-day-cell').nth(2).boundingBox()
  assert.ok(Math.abs(span.x-firstCell.x-4)<1 && Math.abs(span.x+span.width-lastCell.x-lastCell.width+4)<1,'One box spans the complete three-day interval')
  assert.equal(await calendar.locator('.all-day-event[data-record-id="Multi-day Deck delivery"] .all-day-title').count(),1,'A multi-day title is rendered exactly once')
  const timedTask = calendar.locator('.calendar-event[data-record-id="Timed task"]'), meeting = calendar.locator('.calendar-event[data-record-id="Overlapping meeting"]')
  const taskBox = await timedTask.boundingBox(), meetingBox = await meeting.boundingBox()
  assert.ok(taskBox.x + taskBox.width <= meetingBox.x + 1 || meetingBox.x + meetingBox.width <= taskBox.x + 1)
  checks.push('Multi-day work is one continuous box with one label and overlapping timed work/events have separate lanes')
  const summary=calendar.locator('.calendar-day-summary')
  assert.equal(await summary.getAttribute('data-day'),'2026-11-02')
  assert.deepEqual(await summary.locator('.day-summary-counts b').allTextContents(),['4','1'])
  await calendar.locator('.all-day-event[data-record-id="Multi-day Deck delivery"]').click()
  await page.waitForFunction(()=>document.querySelector('.calendar-day-summary')?.getAttribute('data-day')==='2026-11-04')
  assert.deepEqual(await summary.locator('.day-summary-counts b').allTextContents(),['0','3'])
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  checks.push('Previously empty Overview gutter summarizes the focused day from real events and open deadlines')
  await page.screenshot({path: 'artifacts/calendar-work-overview.png', fullPage: true})
  await page.getByRole('tab', {name: 'Calendar', exact: true}).click()
  const standalone = page.getByRole('region', {name: 'Week calendar'})
  assert.equal(await standalone.locator('.all-day-event[data-record-id="Multi-day Deck delivery"]').count(),1)
  assert.equal(await standalone.locator('.calendar-event[data-record-kind="task"]').count(), 2)
  assert.equal(await standalone.locator('.calendar-event[data-record-kind="card"]').count(), 1)
  assert.equal(await standalone.locator('.tray-item').count(), 1)
  await standalone.locator('.calendar-event[data-record-id="Timed card"]').click()
  await page.getByRole('complementary', {name: 'Item details'}).waitFor()
  assert.match(await page.getByRole('complementary', {name: 'Item details'}).innerText(), /Timed card/)
  checks.push('Standalone Calendar shows work too, opens its source details, and keeps only genuinely undated work in the tray')
  await page.getByRole('button',{name:'Close item details',exact:true}).click()
  await page.setViewportSize({width:650,height:900})
  const main=standalone.locator('.calendar-main')
  assert.ok(await main.evaluate(element=>element.scrollWidth>element.clientWidth+1))
  await main.hover();await page.mouse.wheel(120,0)
  await page.waitForFunction(()=>document.querySelector('.calendar-main').scrollLeft>0)
  const aligned=await standalone.evaluate(element=>{
    const header=element.querySelector('.calendar-day-heading').getBoundingClientRect(),cell=element.querySelector('.all-day-cell').getBoundingClientRect()
    return Math.abs(header.x-cell.x)<1
  })
  assert.ok(aligned,'Standalone horizontal scrolling keeps the date heading and spanning strip aligned')
  checks.push('Narrow standalone Calendar scrolls dates with horizontal touchpad input without a separate all-day horizontal scroller')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({result: 'PASS', checks}, null, 2))
} catch (error) {
  await page.screenshot({path: 'artifacts/calendar-work-failure.png', fullPage: true})
  console.error(JSON.stringify({result: 'FAIL', checks, errors, error: String(error)}, null, 2)); throw error
} finally {await context.close(); await browser.close()}
