/** Test-only browser bridge. The shipping app has no fixture/demo mode. */
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir} from 'node:fs/promises'
import {plannerFixture} from './fixtures.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
await mkdir('artifacts', {recursive: true})
const browser = await chromium.launch({headless: true, channel: 'msedge'})
const context = await browser.newContext({viewport: {width: 1500, height: 980}, colorScheme: 'dark'})
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const fixture = plannerFixture()
// Sanitized palette values verified against Nextcloud, with a transparent test
// pixel in place of the user's private wallpaper. No live account is accessed.
const themePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
fixture.theme = {
  name: 'Fixture Cloud', color: '#04455a', textColor: '#ffffff', mode: 'light',
  backgroundColor: '#002745', backgroundTextColor: '#ffffff', backgroundDataUrl: themePng,
  light: {surfaceColor: '#ffffff', textColor: '#222222', mutedColor: '#6b6b6b', hoverColor: '#f5f5f5', borderColor: '#ededed', primaryColor: '#04455a', primaryTextColor: '#ffffff', primaryLightColor: '#e5ecee', primaryLightTextColor: '#011b24'},
  darkPalette: {surfaceColor: '#171717', textColor: '#ebebeb', mutedColor: '#999999', hoverColor: '#212121', borderColor: '#292929', primaryColor: '#0491f2', primaryTextColor: '#000000', primaryLightColor: '#15232c', primaryLightTextColor: '#9ab4bd'},
}
fixture.workspace.appearance.mode = 'system'
fixture.records.push({...fixture.records.find(r => r.id === 'task-today'), id: 'task-timed', title: 'Timed deadline fixture', due: '2026-11-05T15:30:00Z'})
fixture.records.push({...fixture.records.find(r => r.id === 'task-today'), id: 'task-done', title: 'Already completed task', completed:true, status:'COMPLETED'})
fixture.records.push({...fixture.records.find(r => r.id === 'task-overdue'), id: 'task-cancelled', title: 'Cancelled source task', completed:false, status:'CANCELLED'})
Object.assign(fixture.records.find(r => r.id === 'card-mine'), {stackId:'stack-review',status:'Review'})
fixture.records.find(r => r.id === 'task-today').status='IN-PROCESS'
await page.addInitScript(initial => {
  const clone = value => structuredClone(value)
  let state = clone(initial)
  const saved = sessionStorage.getItem('planner-ui-fixture')
  if (saved) state = JSON.parse(saved)
  const log = []
  const remember = () => sessionStorage.setItem('planner-ui-fixture', JSON.stringify(state))
  const update = (method, fn) => async input => {log.push({method, input}); fn(input); remember(); return clone(state)}
  window.__fixtureWrites = log
  window.__setFixtureTheme = theme => {if (theme) state.theme = clone(theme); else delete state.theme; remember()}
  window.workspaceApi = {
    getState: async () => clone(state), refresh: async () => clone(state),
    saveWorkspace: async (workspace, revision) => {if (revision !== state.revision) throw new Error('Stale fixture revision'); state.workspace = clone(workspace); state.revision++; remember(); return {workspace: clone(workspace), revision: state.revision, storage: state.storage}},
    setTaskCompleted: update('setTaskCompleted', input => Object.assign(state.records.find(r => r.id === input.id), {completed: input.completed,status:input.completed?'COMPLETED':'NEEDS-ACTION'})),
    setCardCompleted: update('setCardCompleted', input => Object.assign(state.records.find(r => r.id === input.id), {completed: input.completed})),
    setTaskDue: update('setTaskDue', input => Object.assign(state.records.find(r => r.id === input.id), {due: input.due})),
    updateRecordDates: update('updateRecordDates', input => {const record=state.records.find(r=>r.id===input.id);for(const key of ['start','due','end','allDay'])if(Object.hasOwn(input,key)){if(input[key]===undefined||input[key]==='')delete record[key];else record[key]=input[key]}}),
    updateEvent: update('updateEvent', input => Object.assign(state.records.find(r => r.id === input.id), {start: input.start, end: input.end, allDay: input.allDay})),
    updateNote: update('updateNote', input => Object.assign(state.records.find(r => r.id === input.id), {title: input.title, body: input.content, etag: 'updated'})),
    createTask: update('createTask', input => state.records.push({id: 'created-task', source: 'tasks', kind: 'task', title: input.title, due: input.due, collectionId: input.collectionId, completed: false})),
    createNote: update('createNote', input => state.records.push({id: 'created-note', source: 'notes', kind: 'note', title: input.title, body: input.content, collectionId: 'notes', etag: 'created'})),
    createEvent: update('createEvent', input => state.records.push({id: 'created-event', source: 'calendar', kind: 'event', title: input.title, start: input.start, end: input.end, allDay: input.allDay, collectionId: input.collectionId})),
    moveCard: update('moveCard', input => {const record = state.records.find(r => r.id === input.id); record.stackId = input.stackId; record.status = state.collections.find(c => c.id === record.collectionId).stacks.find(s => s.id === input.stackId).title}),
    syncWorkspace: async () => {state.storage.syncStatus = 'synced'; remember(); return clone(state)},
    exportWorkspace: async () => ({exported: true}),
    openExternal: async url => {log.push({method: 'openExternal', url})},
    readPage: async () => ({body: '# Test page'}),
    beginLogin: async () => {throw new Error('Fixture does not authenticate')},
    pollLogin: async () => ({pending: true}), cancelLogin: async () => clone(state),
    disconnect: async () => {state.connection.connected = false; remember(); return clone(state)},
  }
}, fixture)
const checked = []
const backend = () => page.evaluate(() => window.workspaceApi.getState())
const settled = async () => {await page.waitForFunction(() => !document.querySelector('.saving-indicator')); await page.waitForTimeout(120)}
const tab = name => page.getByRole('tab', {name, exact: true}).click()
const openNavigation = async () => {
  const opener = page.getByRole('button', {name: 'Open navigation', exact: true})
  if (await opener.isVisible() && !await page.locator('.planner-app').evaluate(app => app.classList.contains('sidebar-open'))) await opener.click()
}
const overview = async () => {await openNavigation(); await page.locator('.app-sidebar').getByRole('button', {name: /My overview/}).click()}
const openSettings = async () => {await openNavigation(); await page.locator('.app-sidebar').getByRole('button', {name: /Settings/}).click()}
const details = () => page.getByRole('complementary', {name: 'Item details'})
const moreConnections = async () => {
  const options = details().locator('details.inspector-options')
  if (!await options.evaluate(element => element.open)) await options.locator(':scope > summary').click()
}
const checkThemeContrast = async () => {
  const ratios = await page.getByRole('tab', {name: 'Overview', exact: true}).evaluate(tab => {
    const luminance = value => {
      const channels = value.startsWith('#') ? value.slice(1).match(/.{2}/g).map(n => parseInt(n, 16)) : value.match(/[\d.]+/g).slice(0, 3).map(Number)
      const [r, g, b] = channels.map(n => {n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4})
      return .2126 * r + .7152 * g + .0722 * b
    }
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)
    const root = getComputedStyle(document.documentElement), button = getComputedStyle(document.querySelector('.topbar-actions .button.primary')), activeTab = getComputedStyle(tab)
    const tabBackground = activeTab.backgroundColor === 'rgba(0, 0, 0, 0)' ? root.getPropertyValue('--canvas').trim() : activeTab.backgroundColor
    return {link: contrast(activeTab.color, tabBackground), button: contrast(button.color, button.backgroundColor)}
  })
  assert.ok(ratios.link >= 4.5 && ratios.button >= 4.5, JSON.stringify(ratios))
}
const checkNativePalette = async mode => {
  await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, mode)
  const palette = fixture.theme[mode === 'dark' ? 'darkPalette' : 'light']
  const expected = {'--surface':palette.surfaceColor,'--canvas':palette.surfaceColor,'--sidebar':palette.surfaceColor,'--text':palette.textColor,'--muted':palette.mutedColor,'--hover':palette.hoverColor,'--border':palette.borderColor,'--primary':palette.primaryColor,'--on-primary':palette.primaryTextColor,'--primary-soft':palette.primaryLightColor,'--primary-soft-text':palette.primaryLightTextColor}
  const actual = await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, document.documentElement.style.getPropertyValue(key).trim()])), Object.keys(expected))
  assert.deepEqual(actual, expected, `The ${mode} palette preserves native Nextcloud values`)
  const background = await page.evaluate(() => ({image:getComputedStyle(document.body).backgroundImage, color:document.documentElement.style.getPropertyValue('--cloud-background'), text:document.documentElement.style.getPropertyValue('--cloud-foreground')}))
  assert.equal(background.image, `url("${themePng}")`)
  assert.equal(background.color, fixture.theme.backgroundColor)
  assert.equal(background.text, fixture.theme.backgroundTextColor)
}
const replaceTheme = async theme => {
  await page.evaluate(theme => window.__setFixtureTheme(theme), theme)
  await page.getByRole('button', {name:'Refresh Nextcloud sources', exact:true}).click()
  await settled()
}
try {
  await page.goto('http://127.0.0.1:5173')
  await page.getByRole('heading', {name: 'My overview', exact: true}).waitFor()
  await page.getByRole('button', {name: 'Refresh Nextcloud sources', exact: true}).waitFor({state: 'visible'})
  await checkNativePalette('light') // The server's light choice overrides the test OS's dark preference.
  await checkThemeContrast()
  await openSettings()
  const appearance = page.getByRole('group', {name:'Color mode'})
  assert.match(await appearance.getByRole('button', {name:'Follow Nextcloud', exact:true}).getAttribute('class'), /active/)
  await appearance.getByRole('button', {name:'Dark', exact:true}).click()
  await checkNativePalette('dark')
  await appearance.getByRole('button', {name:'Follow Nextcloud', exact:true}).click()
  await checkNativePalette('light')
  await settled()
  assert.equal((await backend()).workspace.appearance.mode, 'system')
  await page.getByRole('button', {name:'Close dialog', exact:true}).click()
  await replaceTheme({...fixture.theme, mode:'dark'})
  await checkNativePalette('dark')
  await openSettings()
  await appearance.getByRole('button', {name:'Light', exact:true}).click()
  await checkNativePalette('light')
  await appearance.getByRole('button', {name:'Follow Nextcloud', exact:true}).click()
  await checkNativePalette('dark')
  await page.getByRole('button', {name:'Close dialog', exact:true}).click()
  await replaceTheme(undefined)
  const clearedTheme = await page.evaluate(() => ({image:getComputedStyle(document.body).backgroundImage, surface:document.documentElement.style.getPropertyValue('--surface'), muted:document.documentElement.style.getPropertyValue('--muted'), soft:document.documentElement.style.getPropertyValue('--primary-soft'), color:document.documentElement.style.getPropertyValue('--cloud-background')}))
  assert.deepEqual(clearedTheme, {image:'none', surface:'', muted:'', soft:'', color:'#0082c9'}, 'Removing a theme clears its wallpaper and palette overrides')
  await replaceTheme(fixture.theme)
  await checkNativePalette('light')
  checked.push('personal Nextcloud palettes and wallpaper, Follow Nextcloud mode, local Light/Dark overrides, and clearing stale theme values')
  await page.screenshot({path: 'artifacts/planner-overview.png', fullPage: true})
  await tab('List')
  assert.equal(await page.locator('.list-table-row').filter({hasText: 'Book accommodation'}).count(), 0)
  assert.equal(await page.locator('.list-table-row').filter({hasText: 'Plan the weekend'}).count(), 1)
  assert.equal(await page.locator('.list-table-row').filter({hasText: 'Dinner together'}).count(), 1)
  await page.getByRole('button', {name: 'Filters', exact: true}).click()
  await page.getByLabel('Include unassigned Deck cards').check()
  assert.equal(await page.locator('.list-table-row').filter({hasText: 'Prepare project archive'}).count(), 1)
  assert.equal(await page.locator('.list-table-row').filter({hasText: 'Team production planning'}).count(), 0)
  await page.getByLabel('Include unassigned Deck cards').uncheck()
  await page.getByRole('button', {name: 'Filters', exact: true}).click()
  checked.push('my assignment filter, shared events, explicit unassigned, group-only exclusion')

  await page.locator('.list-table-row').filter({hasText: 'Plan the weekend'}).click()
  await details().getByRole('heading', {name: 'Plan the weekend', exact: true}).waitFor()
  assert.equal(await details().getByRole('button', {name: /^Book accommodation/}).count(), 1)
  await tab('Timeline')
  await details().getByRole('heading', {name: 'Plan the weekend', exact: true}).waitFor()
  await tab('Calendar')
  await details().getByRole('heading', {name: 'Plan the weekend', exact: true}).waitFor()
  await details().getByRole('button', {name: 'Close item details'}).click()
  await page.screenshot({path: 'artifacts/planner-calendar.png', fullPage: true})
  checked.push('shared inspector survives view switches; hidden dependencies remain context')

  await openNavigation()
  await page.locator('.app-sidebar').getByRole('button', {name: 'Create Space', exact: true}).click()
  let dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.equal(await page.locator('.planner-app').evaluate(app => app.classList.contains('sidebar-open')), false, 'Opening a grouping form closes navigation so the drawer cannot cover the new Space')
  await dialog.getByLabel('Name', {exact: true}).fill('Studio planning')
  await dialog.getByLabel('Include Calendar: Freelance calendar', {exact: true}).check()
  await dialog.getByLabel('Include Deck board: Freelance board', {exact: true}).check()
  await dialog.getByRole('button', {name: 'Create Space', exact: true}).click()
  await page.getByRole('heading', {name: 'Studio planning', exact: true}).waitFor()
  await settled()
  let snapshot = await backend()
  const createdSpace = snapshot.workspace.spaces.find(s => s.name === 'Studio planning')
  assert.deepEqual(createdSpace.collectionIds.sort(), ['calendar-work', 'deck-work'])
  validateWorkspace(snapshot.workspace)
  await page.getByRole('button', {name: 'Project', exact: true}).first().click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name', {exact: true}).fill('Pilot delivery')
  await dialog.getByLabel('Client film', {exact: true}).check()
  await dialog.getByRole('button', {name: 'Create project', exact: true}).click()
  await page.getByRole('heading', {name: 'Pilot delivery', exact: true}).waitFor()
  await tab('List')
  assert.equal(await page.locator('.list-table-row').filter({hasText: 'Deliver the final cut'}).count(), 1)
  assert.equal(await page.locator('.list-table-row').filter({hasText: 'Client review'}).count(), 1)
  assert.equal(await page.locator('.list-table-row').filter({hasText: 'Another client meeting'}).count(), 0)
  checked.push('create Space and child project from sources; associated event without calendar over-inclusion')

  await overview(); await tab('List')
  await page.locator('.list-table-row').filter({hasText: 'Prepare review notes'}).click()
  await moreConnections()
  await details().locator('details.planner-block-options > summary').click()
  await details().getByRole('button', {name: 'Add planner block', exact: true}).click()
  dialog = page.getByRole('dialog', {name: 'Plan a work session'})
  await dialog.getByRole('button', {name: 'Save work session', exact: true}).click()
  await settled()
  snapshot = await backend()
  assert.equal(snapshot.workspace.plans.filter(p => p.recordId === 'task-today').length, 2)
  assert.equal(snapshot.records.find(r => r.id === 'task-today').due, fixture.records.find(r => r.id === 'task-today').due)
  assert.equal((await page.evaluate(() => window.__fixtureWrites)).length, 0)
  await details().getByRole('button', {name: 'Add dependency', exact: true}).click()
  dialog = page.getByRole('dialog', {name: 'Add dependency', exact: true})
  await dialog.getByRole('radio', {name: /Waits for \(incoming\)/}).check()
  await dialog.getByLabel('Find related work', {exact: true}).fill('opening')
  await dialog.getByRole('radio', {name: 'Edit the opening sequence', exact: true}).check()
  await dialog.getByRole('button', {name: 'Add dependency', exact: true}).click()
  await dialog.waitFor({state:'hidden'})
  await settled()
  snapshot = await backend()
  assert.ok(snapshot.workspace.relations.some(r => r.fromId === 'task-today' && r.toId === 'card-mine' && r.type === 'depends_on'))
  await tab('Timeline')
  await page.getByRole('button', {name: 'Filters', exact: true}).click()
  await page.getByRole('button', {name: 'Everyone', exact: true}).click()
  await page.getByRole('button', {name: 'Filters', exact: true}).click()
  await page.screenshot({path: 'artifacts/planner-timeline.png', fullPage: true})
  checked.push('work session persists without changing native dates; typed relationship persists')

  await details().getByRole('button', {name: 'Close item details'}).click()
  await tab('Board')
  assert.equal(await page.getByLabel('Board source', {exact: true}).inputValue(), '')
  assert.ok(await page.locator('.board-column').filter({has:page.getByRole('heading',{name:'Review',exact:true})}).getByText('Edit the opening sequence',{exact:true}).isVisible())
  assert.ok(await page.locator('.board-column').filter({has:page.getByRole('heading',{name:'In progress',exact:true})}).getByText('Prepare review notes',{exact:true}).isVisible())
  assert.equal(await page.getByLabel('Move Prepare review notes', {exact:true}).count(), 0)
  assert.equal(await page.getByText('Already completed task',{exact:true}).count(), 0)
  assert.equal(await page.getByText('Cancelled source task',{exact:true}).count(), 0)
  await page.getByRole('button', {name: 'Filters', exact: true}).click()
  await page.getByLabel(/Show completed/).check()
  await page.getByRole('button', {name: 'Filters', exact: true}).click()
  const doneColumn=page.locator('.board-column').filter({has:page.getByRole('heading',{name:'Done',exact:true})})
  assert.ok(await doneColumn.getByText('Already completed task',{exact:true}).isVisible())
  assert.ok(await doneColumn.getByText('Completed delivery',{exact:true}).isVisible())
  assert.ok(await page.locator('.board-column').filter({has:page.getByRole('heading',{name:'Cancelled',exact:true})}).getByText('Cancelled source task',{exact:true}).isVisible())
  await page.screenshot({path:'artifacts/planner-board.png',fullPage:true})
  checked.push('combined board defaults to native statuses and keeps completed tasks/cards in Done')
  await page.getByText('Cancelled source task',{exact:true}).click()
  await details().getByRole('button',{name:'Reopen',exact:true}).click()
  await details().getByRole('button',{name:'Mark done',exact:true}).waitFor()
  assert.equal((await backend()).records.find(r=>r.id==='task-cancelled').status,'NEEDS-ACTION')
  await details().getByRole('button',{name:'Close item details'}).click()
  checked.push('cancelled task is labelled separately and Reopen clears its closed status')
  await page.getByRole('button', {name: 'Filters', exact: true}).click()
  await page.getByLabel(/Show completed/).uncheck()
  await page.getByRole('button', {name: 'Filters', exact: true}).click()
  await page.getByLabel('Board source', {exact: true}).selectOption('__planning__')
  await page.locator('.board-card').filter({hasText:'Prepare review notes'}).hover()
  await page.getByLabel('Move Prepare review notes', {exact: true}).selectOption('doing')
  await settled()
  snapshot = await backend()
  assert.equal(snapshot.workspace.planner.workflow['task-today'], 'doing')
  assert.equal(snapshot.records.find(r => r.id === 'task-today').completed, false)
  await page.getByLabel('Board source', {exact: true}).selectOption('deck-work')
  await page.locator('.board-card').filter({hasText:'Edit the opening sequence'}).hover()
  await page.getByLabel('Move Edit the opening sequence', {exact: true}).selectOption('stack-progress')
  await page.waitForFunction(() => window.__fixtureWrites.some(w => w.method === 'moveCard'))
  checked.push('personal workflow stays separate from completion; native stack movement routes to Deck')

  await tab('List')
  await page.getByLabel('Search this view', {exact: true}).fill('Client brief')
  await page.locator('.list-table-row').filter({hasText: 'Client brief'}).click()
  assert.equal(await details().locator('.markdown-content script').count(), 0)
  assert.equal(await page.evaluate(() => window.fixtureXss), undefined)
  await details().getByRole('button', {name: 'Edit', exact: true}).click()
  await details().getByRole('tab', {name: 'Markdown', exact: true}).click()
  await details().getByLabel('Markdown', {exact: true}).fill('# Updated brief\n\nSaved through Notes.')
  await details().getByRole('button', {name: 'Save note', exact: true}).click()
  await details().locator('.markdown-content h1').filter({hasText: 'Updated brief'}).waitFor()
  checked.push('Notes editing and sanitized Markdown')
  await details().getByRole('button', {name: 'Close item details'}).click()
  await page.getByRole('button', {name: 'Clear search', exact: true}).click()
  await page.getByRole('button', {name: 'New item', exact: true}).click()
  dialog = page.getByRole('dialog', {name: 'New item'})
  await dialog.getByLabel('Title', {exact: true}).fill('Capture from planner')
  await dialog.getByLabel('Task list', {exact: true}).selectOption('tasks-work')
  await dialog.getByRole('button', {name: 'Create task', exact: true}).click()
  await page.locator('.list-table-row').filter({hasText: 'Capture from planner'}).waitFor()
  checked.push('native task capture')

  await page.locator('.list-table-row').filter({hasText: 'Timed deadline fixture'}).click()
  await details().getByRole('button', {name: 'Edit dates', exact: true}).click()
  dialog = page.getByRole('dialog', {name: 'Plan dates', exact: true})
  await dialog.locator('.dates-precise > summary').click()
  assert.equal(await dialog.getByLabel('Deadline date', {exact: true}).getAttribute('type'), 'datetime-local')
  const expectedLocal = await page.evaluate(() => {const d = new Date('2026-11-05T15:30:00Z'); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`})
  assert.equal(await dialog.getByLabel('Deadline date', {exact: true}).inputValue(), expectedLocal)
  assert.equal(await dialog.getByRole('button', {name: 'Save dates', exact: true}).isDisabled(),true,'Unchanged dates do not trigger a native write')
  const expectedStart = await page.evaluate(() => {const d = new Date('2026-11-05T14:30:00Z'); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`})
  await dialog.getByLabel('Start date', {exact: true}).fill(expectedStart)
  await dialog.getByRole('button', {name: 'Save dates', exact: true}).click()
  await dialog.waitFor({state:'hidden'})
  await page.waitForFunction(() => window.__fixtureWrites.some(w => w.method === 'updateRecordDates'))
  assert.equal(new Date((await backend()).records.find(r => r.id === 'task-timed').due).toISOString(), '2026-11-05T15:30:00.000Z')
  assert.equal(new Date((await backend()).records.find(r => r.id === 'task-timed').start).toISOString(), '2026-11-05T14:30:00.000Z')
  await details().getByRole('button', {name: 'Close item details'}).click()
  checked.push('timed task deadline editor preserves local display and native timestamp')

  await settled(); snapshot = await backend(); validateWorkspace(snapshot.workspace)
  const createdId = snapshot.workspace.spaces.find(s => s.name === 'Studio planning').id
  await page.reload()
  await page.getByRole('heading', {name: 'My overview', exact: true}).waitFor()
  assert.ok((await backend()).workspace.spaces.some(s => s.id === createdId))
  await openSettings()
  await page.getByRole('button', {name: 'Dark', exact: true}).click()
  await page.getByRole('button', {name: 'Close dialog', exact: true}).click()
  await tab('Overview')
  await page.screenshot({path: 'artifacts/planner-dark.png', fullPage: true})
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  await checkNativePalette('dark')
  await checkThemeContrast()
  checked.push('metadata survives reload and dark theme')
  checked.push('native Nextcloud palettes keep readable selected tabs and primary buttons in light and dark modes')
  await page.setViewportSize({width: 430, height: 900})
  await page.getByRole('button', {name: 'Open navigation', exact: true}).click()
  await page.getByRole('button', {name: 'Close navigation', exact: true}).click()
  await page.waitForFunction(() => !document.querySelector('.planner-app.sidebar-open'))
  await page.waitForTimeout(250)
  await page.screenshot({path: 'artifacts/planner-narrow.png', fullPage: true})
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'No page-level horizontal overflow at narrow width')
  checked.push('narrow layout and navigation')

  const emptyContext = await browser.newContext({viewport: {width: 1200, height: 850}})
  const empty = await emptyContext.newPage()
  await empty.goto('http://127.0.0.1:5173')
  await empty.getByRole('heading', {name: /Your life has different parts/}).waitFor()
  assert.equal(await empty.locator('.item-row').count(), 0)
  assert.equal(await empty.locator('.spaces-nav .space-nav').count(), 0)
  await emptyContext.close()
  checked.push('unconnected browser is empty, no fixture fallback')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({result: 'PASS', checks: checked}, null, 2))
} catch (error) {
  await page.screenshot({path: 'artifacts/planner-ui-failure.png', fullPage: true}).catch(() => {})
  console.error(JSON.stringify({checksPassed: checked, rendererErrors: errors}, null, 2))
  throw error
} finally {await browser.close()}
