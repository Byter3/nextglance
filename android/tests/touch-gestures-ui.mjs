/** Real Chromium touch input against the actual Android entry and isolated data.
 * No PointerEvent synthesis, device emulator, live account or asset build. */
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createEmptyState, createPlannerWorkspace} from '@nextspace/core/planner.mjs'

const root = path.resolve(import.meta.dirname, '..')
const output = path.resolve(root, '../artifacts/android-touch')
await mkdir(output, {recursive: true})
let server, browser
const checks = [], errors = []
const workspace = createPlannerWorkspace()
const records = [
  ...Array.from({length: 26}, (_, index) => ({id: `task-${index}`, source: 'tasks', kind: 'task', title: `Touch task ${String(index).padStart(2, '0')}`, collectionId: 'tasks', collectionTitle: 'Work tasks', start: '2026-11-16', due: '2026-11-18', status: 'NEEDS-ACTION', completed: false, readonly: index === 1, etag: '"task-v1"'})),
  {id: 'event', source: 'calendar', kind: 'event', title: 'Editable appointment', collectionId: 'calendar', collectionTitle: 'Work calendar', start: '2026-11-16T10:00:00Z', end: '2026-11-16T11:00:00Z', readonly: false, etag: '"event-v1"'},
  {id: 'readonly-event', source: 'calendar', kind: 'event', title: 'Read-only appointment', collectionId: 'calendar', collectionTitle: 'Work calendar', start: '2026-11-16T12:00:00Z', end: '2026-11-16T13:00:00Z', readonly: true, etag: '"readonly-v1"'},
]
const live = {...createEmptyState(), mode: 'live', workspace, records, revision: 0, nativeOperations: ['updateRecordDates'],
  connection: {connected: true, serverUrl: 'https://fixture.invalid', username: 'fixture'},
  collections: [{id: 'tasks', source: 'tasks', title: 'Work tasks', color: '#277cbd'}, {id: 'calendar', source: 'calendar', title: 'Work calendar', color: '#31856d'}],
  statuses: ['tasks', 'calendar', 'deck', 'notes', 'collectives'].map(source => ({source, state: 'connected', count: records.filter(record => record.source === source).length})),
  storage: {syncStatus: 'synced'}, metadata: {ready: true}, deviceState: {},
}
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const writes = page => page.evaluate(() => window.__writes)
const record = (page, id) => page.evaluate(id => window.__snapshot().records.find(record => record.id === id), id)
const hourHeight = page => page.locator('.calendar-view').evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--calendar-hour-height')))
const scrollState = locator => locator.evaluate(element => ({left: element.scrollLeft, top: element.scrollTop, max: element.scrollWidth - element.clientWidth}))
async function date(page, value = '2026-11-16') { await page.getByLabel('Choose calendar date').fill(value); await page.getByLabel('Choose calendar date').dispatchEvent('change'); await frame(page) }
async function point(locator, rx = .5, ry = .5) {
  const p = await locator.evaluate((element, {rx, ry}) => {
    const b = element.getBoundingClientRect()
    let left = Math.max(0, b.left), right = Math.min(innerWidth, b.right), top = Math.max(0, b.top), bottom = Math.min(innerHeight, b.bottom)
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), clip = parent.getBoundingClientRect()
      if (/(auto|hidden|scroll|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right) }
      if (/(auto|hidden|scroll|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom) }
    }
    return {x: left + (right - left) * rx, y: top + (bottom - top) * ry, visible: right > left && bottom > top}
  }, {rx, ry})
  assert.equal(p.visible, true, 'Gesture target has a visible clipped area')
  return {x: p.x, y: p.y}
}
async function visiblePoint(page, locator) {
  await locator.scrollIntoViewIfNeeded(); await frame(page)
  return point(locator)
}
async function aligned(page) {
  await page.waitForFunction(() => {
    const top = [...document.querySelectorAll('.overview-split .timeline-days>div')], bottom = [...document.querySelectorAll('.overview-split .calendar-day-track')]
    return top.length > 0 && top.length === bottom.length && top.every((element, index) => { const a = element.getBoundingClientRect(), b = bottom[index].getBoundingClientRect(); return Math.abs(a.left - b.left) < 1.1 && Math.abs(a.width - b.width) < 1.1 })
  })
}
function touch(cdp, page) {
  const points = new Map()
  const send = async type => { await cdp.send('Input.dispatchTouchEvent', {type, touchPoints: [...points].map(([id, p]) => ({id, ...p, radiusX: 2, radiusY: 2, force: .7}))}); await frame(page) }
  return {
    down: async (id, p) => { points.set(id, p); await send('touchStart') },
    move: async updates => { for (const [id, p] of updates) points.set(id, p); await send('touchMove') },
    up: async id => { points.delete(id); await send('touchEnd') },
    cancel: async () => { points.clear(); await send('touchCancel') },
    tap: async p => { points.set(1, p); await send('touchStart'); points.clear(); await send('touchEnd') },
    swipe: async (p, dx, dy) => {
      points.set(1, p); await send('touchStart')
      for (let step = 1; step <= 6; step++) { points.set(1, {x: p.x + dx * step / 6, y: p.y + dy * step / 6}); await send('touchMove') }
      points.clear(); await send('touchEnd')
    },
    pinch: async (p, start = 45, end = 80, vertical = false) => {
      const pair = distance => [[1, {x: p.x - (vertical ? 0 : distance), y: p.y - (vertical ? distance : 0)}], [2, {x: p.x + (vertical ? 0 : distance), y: p.y + (vertical ? distance : 0)}]]
      for (const [id, pos] of pair(start)) { points.set(id, pos); await send('touchStart') }
      for (let step = 1; step <= 6; step++) { for (const [id, pos] of pair(start + (end - start) * step / 6)) points.set(id, pos); await send('touchMove') }
      points.clear(); await send('touchEnd')
    },
  }
}
async function fixture(viewport, fullCapture = false) {
  const context = await browser.newContext({viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1, timezoneId: 'UTC'})
  await context.addInitScript(({live, fullCapture}) => {
    let state = structuredClone(live), listener
    if (fullCapture) delete state.nativeOperations
    const read = async () => structuredClone(state)
    window.__writes = []; window.__snapshot = () => structuredClone(state)
    window.__revoke = () => { state.nativeOperations = []; listener?.(structuredClone(state)) }
    window.__fixture = {isNative: true, getState: read, refresh: read, syncWorkspace: read, subscribe: fn => { listener = fn; return () => { listener = undefined } }, openExternal: async () => {},
      updateRecordDates: async input => { window.__writes.push(structuredClone(input)); const item = state.records.find(record => record.id === input.id); for (const key of ['start', 'due', 'end', 'allDay']) if (key in input) item[key] = input[key] || undefined; item.etag = '"saved-' + window.__writes.length + '"'; return read() },
      saveWorkspace: async (workspace, revision) => { if (revision !== state.revision) throw new Error('Stale fixture revision'); state.workspace = structuredClone(workspace); state.revision++; return {workspace: structuredClone(workspace), revision: state.revision, storage: state.storage} },
      createEvent: async () => { throw new Error('Test must not submit creation') }, createTask: async () => { throw new Error('Test must not submit creation') },
    }
  }, {live, fullCapture})
  await context.route('**/src/adapter.ts*', route => route.fulfill({contentType: 'application/javascript', body: 'export const createAndroidApi=()=>window.__fixture'}))
  if (fullCapture) await context.route('**/src/main.ts*', route => route.fulfill({contentType: 'application/javascript', body: 'import {mountNextspace} from "/@fs/' + path.resolve(root, '../packages/ui/src/index.ts').replaceAll('\\', '/') + '"; mountNextspace(window.__fixture,"#app",{nativeConnection:true,canMutateNative:true,mobileHost:true});'}))
  await context.route('**/__nextglance/**', route => { errors.push('Unexpected preview host request'); return route.abort() })
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  await page.goto(baseUrl); await page.locator('.overview-split').waitFor(); await date(page)
  const cdp = await context.newCDPSession(page)
  return {context, page, input: touch(cdp, page)}
}
let baseUrl = process.env.ANDROID_PREVIEW_URL
try {
  if (!baseUrl) { server = await createServer({root, configFile: false, plugins: [vue()], resolve: {dedupe: ['vue']}, server: {host: '127.0.0.1', port: 0, strictPort: false, hmr: false, fs: {allow: [path.resolve(root, '..')]}}}); await server.listen(); baseUrl = server.resolvedUrls.local[0] }
  browser = await chromium.launch({headless: true, channel: 'msedge'})
  for (const viewport of [{width: 1280, height: 900}, {width: 430, height: 932}]) {
    const {context, page, input} = await fixture(viewport), label = `${viewport.width}px`
    try {
      const timeline = page.locator('.timeline-scroll'), hours = page.locator('.calendar-times-scroll')
      await timeline.evaluate(element => { element.scrollTop = 20 })
      const before = await scrollState(timeline), oldDate = await page.getByLabel('Choose calendar date').inputValue()
      const overviewDayWidth = await page.locator('.timeline-days>div').first().evaluate(element => element.getBoundingClientRect().width)
      await input.swipe(await point(timeline, .82, .7), -Math.max(100, overviewDayWidth * 1.4), -65)
      const after = await scrollState(timeline)
      assert.ok(after.top > before.top + 20, `${label}: vertical timeline movement stays in its pane`)
      assert.ok(after.left > before.left + 10 || await page.getByLabel('Choose calendar date').inputValue() !== oldDate, `${label}: horizontal movement pans dates or real overflow`)
      await aligned(page); assert.equal((await writes(page)).length, 0)
      assert.equal(await page.locator('.inspector,.modal').count(), 0)
      checks.push(`${label}: real one-finger diagonal Overview pan keeps dates aligned and does not edit/open`)

      await page.getByLabel('Timeline range').selectOption('14'); await date(page); await timeline.evaluate(element => { element.scrollTop = 0 }); await frame(page)
      const focal = await point(timeline, .78, .65)
      const timelineDateAt = () => page.locator('.timeline-days>div').first().evaluate((element, x) => { const b = element.getBoundingClientRect(); return Date.parse(document.querySelector('.timeline-view').dataset.renderAnchor) / 86400000 + (x - b.left) / b.width }, focal.x)
      const beforeDay = await timelineDateAt(), beforeHours = await hourHeight(page)
      await input.pinch(focal, 30, viewport.width < 600 ? 58 : 85)
      assert.ok(Number(await page.getByLabel('Timeline range').inputValue()) < 14, `${label}: upper pinch changes the shared day range`)
      assert.ok(Math.abs(await timelineDateAt() - beforeDay) <= 1.1, `${label}: pinch preserves centroid date within date rounding`)
      assert.equal(await hourHeight(page), beforeHours); await aligned(page)
      assert.equal((await writes(page)).length, 0)
      checks.push(`${label}: Overview date pinch anchors the centroid and leaves hour scale untouched`)

      const overviewDays = await page.getByLabel('Timeline range').inputValue()
      await hours.evaluate(element => { element.scrollTop = 300 }); await frame(page)
      await input.pinch(await point(hours, .78, .5), 20, 40, true)
      assert.ok(await hourHeight(page) > beforeHours)
      assert.equal(await page.getByLabel('Timeline range').inputValue(), overviewDays)
      await aligned(page); assert.equal((await writes(page)).length, 0)
      checks.push(`${label}: lower Overview pinch changes only hour scale and preserves the shared date axis`)

      await page.getByRole('tab', {name: 'Calendar', exact: true}).click(); await date(page)
      await page.emulateMedia({reducedMotion:'reduce'})
      const canvasDateAt=()=>hours.evaluate(view=>{const first=view.querySelector('.calendar-day-track'),box=first.getBoundingClientRect();return Date.parse(first.dataset.day)/86400000+(view.getBoundingClientRect().left+53-box.left)/box.width})
      const canvasStart=await canvasDateAt(),widthForPan=await page.locator('.calendar-day-track').first().evaluate(element=>element.getBoundingClientRect().width)
      await input.swipe(await point(hours,.72,.6),-widthForPan*.35,0);await wait(220);await frame(page)
      assert.ok(Math.abs((await canvasDateAt())-canvasStart-.35)<.03,`${label}: partial-day pan stays fractional after release instead of paging a week`)
      const afterPartial=await canvasDateAt()
      for(let index=0;index<8;index++)await input.swipe(await point(hours,.72,.6),-120,0)
      await wait(220);await frame(page)
      assert.ok(Math.abs((await canvasDateAt())-afterPartial-960/widthForPan)<.08,`${label}: repeated pan crosses buffer edges without changing dates under the pointer`)
      assert.equal(await page.locator('.calendar-day-track').count(),21,'Standalone Calendar retains a bounded three-week strip')
      const horizontal=await page.locator('.calendar-heading-viewport,.calendar-all-day-viewport,.calendar-times-scroll').evaluateAll(elements=>elements.map(element=>element.scrollLeft))
      assert.ok(Math.max(...horizontal)-Math.min(...horizontal)<1,'Calendar headings, all-day spans and hours share one offset')
      assert.equal(await page.locator('.calendar-day-track').first().evaluate(element=>getComputedStyle(element).userSelect),'none')
      assert.equal((await writes(page)).length,0)
      checks.push(`${label}: fractional Calendar date pan survives release/rebase with aligned headers, bounded columns and no text selection`)
      await page.emulateMedia({reducedMotion:'no-preference'});await date(page)
      await hours.evaluate(element => { element.scrollTop = 350 }); await frame(page)
      const calendarMain = page.locator('.calendar-main')
      const calBefore = await scrollState(hours), calBeforeLeft = (await scrollState(hours)).left, calDate = await page.getByLabel('Choose calendar date').inputValue()
      const calendarDayWidth = await page.locator('.calendar-day-track').first().evaluate(element => element.getBoundingClientRect().width)
      await input.swipe(await point(hours, .7, .6), -Math.max(100, calendarDayWidth * 1.4), -70)
      const calAfter = await scrollState(hours)
      assert.ok(calAfter.top > calBefore.top + 20, `${label}: calendar vertical pan works`)
      assert.ok((await scrollState(hours)).left > calBeforeLeft + 10 || await page.getByLabel('Choose calendar date').inputValue() !== calDate, `${label}: calendar horizontal pan works`)
      await date(page); await calendarMain.evaluate(element => { element.scrollLeft = 0 }); await hours.evaluate(element => { element.scrollTop = 350 }); await frame(page)
      const center = await point(hours, .65, .5)
      const timeAt = () => hours.evaluate((element, y) => (element.scrollTop + y - element.getBoundingClientRect().top) / Number.parseFloat(getComputedStyle(element.closest('.calendar-view')).getPropertyValue('--calendar-hour-height')), center.y)
      const oldHour = await hourHeight(page), oldTime = await timeAt()
      await input.pinch(center, 30, 65, true)
      const zoomed = await hourHeight(page)
      assert.ok(zoomed > oldHour && zoomed <= 144 && zoomed >= 24)
      assert.ok(Math.abs(await timeAt() - oldTime) < .15, `${label}: calendar pinch retains time under centroid`)
      assert.equal((await writes(page)).length, 0)
      checks.push(`${label}: Calendar supports diagonal pan and focal hour-height pinch without writes`)

      await input.tap(await point(hours, .9, .8))
      assert.equal(await page.locator('.modal').count(), 0, 'Touch creation respects the Android host capability gate')

      await page.locator('.calendar-scale-control').click(); await date(page)
      const event = page.locator('.calendar-event[data-record-id="event"]'), readOnly = page.locator('.calendar-event[data-record-id="readonly-event"]')
      await input.tap(await visiblePoint(page, event.locator('svg').first())); await page.locator('.inspector').waitFor()
      await page.getByRole('button', {name: 'Close item details', exact: true}).click()
      await input.swipe(await visiblePoint(page, event), 20, -55)
      assert.equal((await writes(page)).length, 0, 'A short swipe over an editable item is panning')
      assert.equal(await page.locator('.inspector,.modal').count(), 0)
      const readonlyPoint = await visiblePoint(page, readOnly)
      await input.down(1, readonlyPoint); await wait(570); await input.move([[1, {x: readonlyPoint.x, y: readonlyPoint.y - 40}]]); await input.up(1)
      assert.equal((await writes(page)).length, 0, 'Read-only items cannot arm a native move')

      let p = await visiblePoint(page, event), original = await record(page, 'event')
      await input.down(1, p); await wait(570); await input.up(1)
      assert.equal((await writes(page)).length, 0, 'A stationary armed hold does not save unchanged dates')
      if (await page.locator('.inspector').count()) await page.getByRole('button', {name: 'Close item details', exact: true}).click()
      p = await visiblePoint(page, event)
      await input.down(1, p); await wait(570)
      assert.equal(await page.locator('.touch-edit-armed').count(), 1, 'A deliberate hold has visible edit feedback')
      await input.move([[1, {x: p.x, y: p.y + 48}]]); await input.up(1)
      await page.waitForFunction(() => window.__writes.length === 1)
      assert.equal(+new Date((await record(page, 'event')).start) - +new Date(original.start), 3600000)
      assert.equal(+new Date((await record(page, 'event')).end) - +new Date((await record(page, 'event')).start), 3600000)
      assert.equal(await page.locator('.inspector,.modal').count(), 0)
      await input.tap(await visiblePoint(page, event.locator('strong').first())); await page.locator('.inspector').waitFor()
      await page.getByRole('button', {name: 'Close item details', exact: true}).click()
      checks.push(`${label}: nested icon/text taps open even immediately after a move; short swipes/read-only/stationary holds do not edit; deliberate hold moves once`)

      p = await visiblePoint(page, event)
      await input.down(1, p); await wait(570); await input.move([[1, {x: p.x, y: p.y + 24}]]); await input.cancel()
      assert.equal((await writes(page)).length, 1, 'Pointer cancellation discards an armed edit')
      p = await visiblePoint(page, event)
      await input.down(1, p); await wait(570); await input.move([[1, {x: p.x, y: p.y + 24}]]); await input.down(2, {x: p.x + 40, y: p.y + 30})
      await input.up(1); await input.move([[2, {x: p.x + 40, y: p.y - 40}]]); await input.up(2)
      assert.equal((await writes(page)).length, 1, 'Second touch cancels editing; one remaining finger cannot resume it')
      assert.equal(await page.locator('.inspector,.modal').count(), 0)
      p = await visiblePoint(page, event)
      await input.down(1, p); await input.down(2, {x: p.x + 35, y: p.y + 35}); await input.down(3, {x: p.x + 65, y: p.y - 25})
      await input.up(1); await input.up(2); await input.move([[3, {x: p.x + 65, y: p.y + 45}]]); await input.up(3)
      assert.equal((await writes(page)).length, 1, 'Third finger cannot revive an edit after other touches lift')
      await input.tap(await visiblePoint(page, event)); await page.locator('.inspector').waitFor(); await page.getByRole('button', {name: 'Close item details', exact: true}).click()
      checks.push(`${label}: real touchcancel, second-finger interruption and third-finger suppression discard previews; subsequent tap still opens`)
      await page.screenshot({path: path.join(output, `calendar-${viewport.width}.png`)})

      await page.getByRole('tab', {name: 'Timeline', exact: true}).click(); await page.getByLabel('Timeline range').selectOption('7'); await date(page)
      const bar = page.locator('.timeline-chart-row[data-record-id="task-0"] .timeline-bar')
      p = await visiblePoint(page, bar); const taskBefore = await record(page, 'task-0')
      const dayWidth = await page.locator('.timeline-days>div').first().evaluate(element => element.getBoundingClientRect().width)
      await input.down(1, p); await wait(570); await input.move([[1, {x: p.x + dayWidth, y: p.y}]]); await input.up(1)
      await page.waitForFunction(() => window.__writes.length === 2)
      assert.equal(Date.parse((await record(page, 'task-0')).start) - Date.parse(taskBefore.start), 86400000)
      assert.equal(Date.parse((await record(page, 'task-0')).due) - Date.parse(taskBefore.due), 86400000)
      checks.push(`${label}: standalone Timeline deliberate hold moves task range natively with duration preserved`)
      const resizeBefore = await record(page, 'task-0')
      p = await visiblePoint(page, bar.locator('.timeline-resize-handle.end'))
      await input.down(1, p); await wait(570); await input.move([[1, {x: p.x + dayWidth, y: p.y}]]); await input.up(1)
      await page.waitForFunction(() => window.__writes.length === 3)
      assert.equal((await record(page, 'task-0')).start, resizeBefore.start)
      assert.equal(Date.parse((await record(page, 'task-0')).due) - Date.parse(resizeBefore.due), 86400000)
      checks.push(`${label}: Timeline boundary-handle hold resizes only the due endpoint`)
      p = await visiblePoint(page, bar)
      await input.down(1, p); await wait(570); await input.move([[1, {x: p.x + dayWidth / 2, y: p.y}]])
      await page.evaluate(() => window.__revoke()); await frame(page); await input.up(1)
      assert.equal((await writes(page)).length, 3, 'Runtime write capability loss cancels a pending touch edit')
      checks.push(`${label}: native permission loss cancels the armed Timeline edit`)
      await page.screenshot({path: path.join(output, `timeline-${viewport.width}.png`)})
    } catch (error) { await page.screenshot({path: path.join(output, `failure-${viewport.width}.png`), fullPage: true}); throw error }
    finally { await context.close() }
  }

  // Android's production host deliberately gates general creation. This
  // additional mount tests the shared permitted flow without changing that gate.
  const {context, page, input} = await fixture({width: 1000, height: 900}, true)
  try {
    await page.getByRole('tab', {name: 'Calendar', exact: true}).click(); await date(page)
    const hours = page.locator('.calendar-times-scroll')
    await hours.evaluate(element => { element.scrollTop = 8 * 48 }); await frame(page)
    const p = await page.locator('.calendar-day-track[data-day="2026-11-18"]').evaluate(element => { const b = element.getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + 9 * 48} })
    await input.tap(p); await page.getByRole('dialog').waitFor()
    assert.ok(await page.locator('.modal input[type="datetime-local"]').count() >= 2)
    const values = await page.locator('.modal input[type="datetime-local"]').evaluateAll(inputs => inputs.map(input => input.value))
    assert.ok(values.every(value => value.startsWith('2026-11-18T')))
    assert.equal((await writes(page)).length, 0)
    checks.push('Permitted shared Calendar blank-grid tap opens contextual creation with selected date/time; no write before confirmation')
  } finally { await context.close() }
  assert.deepEqual(errors, [])
  await writeFile(path.join(output, 'results.json'), JSON.stringify({checks, rendererErrors: errors}, null, 2))
  console.log(JSON.stringify({passed: checks.length, checks, rendererErrors: errors}, null, 2))
} finally { await browser?.close(); await server?.close() }
