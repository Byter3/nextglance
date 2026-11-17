/** Disconnected Windows shell and durable metadata. Never opens the user profile. */
import assert from 'node:assert/strict'
import {_electron as electron} from 'playwright'
import {mkdir, readFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const cwd = path.resolve(import.meta.dirname, '..')
const productName = require('../win/package.json').build.productName
const dataDir = path.join(cwd, '.runtime', `desktop-planner-${Date.now()}`)
assert.ok(path.resolve(dataDir).startsWith(`${path.resolve(cwd, '.runtime')}${path.sep}`))
const packaged = process.argv.includes('--packaged')
await mkdir(path.join(cwd, 'artifacts'), {recursive: true})
const env = {...process.env, NEXTSPACE_DATA_DIR: dataDir, NEXTSPACE_TEST_MODE: '1'}
delete env.ELECTRON_RUN_AS_NODE; delete env.NEXTSPACE_DEV_URL
const launch = () => electron.launch({executablePath: packaged ? path.join(cwd, 'win', 'release', 'win-unpacked', `${productName}.exe`) : require('electron'), args: packaged ? [] : [path.join(cwd, 'win')], cwd, env, timeout: 45000})
let app, passed = false
const errors = []
try {
  app = await launch()
  let page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.workspaceApi))
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  let state = await page.evaluate(() => window.workspaceApi.getState())
  assert.equal(state.connection.connected, false)
  assert.equal(state.workspace.schemaVersion, 2)
  assert.equal(state.records.length, 0, 'Disconnected app must not show invented records')
  assert.equal(state.collections.length, 0)
  assert.ok(!state.workspace.dashboards, 'Retired dashboards are not present')
  const sourceWrites = await page.evaluate(async () => {
    if (typeof window.workspaceApi.deleteEvent !== 'function') throw new Error('Calendar deletion capability is missing from the packaged bridge')
    const attempts = [() => window.workspaceApi.createNote({title: 'Never saved', content: ''}), () => window.workspaceApi.createTask({title: 'Never saved', collectionId: 'missing'}), () => window.workspaceApi.syncWorkspace(), () => window.workspaceApi.deleteEvent({id: 'missing'})]
    return Promise.all(attempts.map(async fn => {try {await fn(); return false} catch {return true}}))
  })
  assert.deepEqual(sourceWrites, [true, true, true, true])
  const workspace = structuredClone(state.workspace)
  const categorySources = ['unavailable-personal-calendar', 'unavailable-personal-deck', 'unavailable-personal-tasks']
  const category = {id: 'desktop-category', spaceId: 'desktop-space', name: 'Desktop source category', color: '#229966', collectionIds: categorySources}
  workspace.spaces.push({id: 'desktop-space', name: 'Desktop persistence check', color: '#7b2cbf', collectionIds: [...categorySources]})
  workspace.categories = [...(workspace.categories || []), category]
  workspace.projects.push({id: 'desktop-project', spaceId: 'desktop-space', categoryId: category.id, name: 'A project', collectionIds: [], recordIds: ['unavailable-task']})
  workspace.relations.push({id: 'desktop-link', type: 'reference', fromId: 'unavailable-task', toId: 'unavailable-note'})
  workspace.planner.view = 'timeline'
  workspace.planner.scopeId = 'desktop-space'
  workspace.appearance.mode = 'dark'
  const saved = await page.evaluate(({workspace, revision}) => window.workspaceApi.saveWorkspace(workspace, revision), {workspace, revision: state.revision})
  assert.equal(saved.revision, state.revision + 1)
  const stale = await page.evaluate(async ({workspace, revision}) => {try {await window.workspaceApi.saveWorkspace(workspace, revision); return ''} catch (error) {return error.message}}, {workspace: state.workspace, revision: state.revision})
  assert.match(stale, /changed since/)
  const file = JSON.parse(await readFile(saved.storage.localPath, 'utf8'))
  assert.equal(file.workspace.spaces[0].name, 'Desktop persistence check')
  assert.deepEqual(file.workspace.categories, [category], 'Category source IDs persist without needing those sources online')
  assert.equal(file.workspace.projects[0].categoryId, category.id)
  assert.equal(file.workspace.relations[0].type, 'reference')
  assert.ok(saved.storage.localPath.endsWith('planner.json'))
  assert.equal(JSON.stringify(file).includes('appPassword'), false)
  const insecure = await page.evaluate(async () => {try {await window.workspaceApi.connect({serverUrl: 'http://insecure.invalid', username: 'never-send', appPassword: 'never-send'}); return false} catch {return true}})
  assert.equal(insecure, true)
  await app.close(); app = await launch(); page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.workspaceApi))
  state = await page.evaluate(() => window.workspaceApi.getState())
  assert.equal(state.workspace.spaces[0].id, 'desktop-space')
  assert.equal(state.workspace.projects[0].recordIds[0], 'unavailable-task')
  assert.deepEqual(state.workspace.categories, [category], 'Restart restores the exact category and source identity mapping')
  assert.deepEqual(state.workspace.spaces[0].collectionIds, categorySources)
  assert.equal(state.workspace.projects[0].categoryId, category.id, 'Project remains nested in its saved category')
  assert.equal(state.workspace.relations[0].toId, 'unavailable-note')
  assert.equal(state.workspace.planner.view, 'timeline')
  assert.equal(state.workspace.appearance.mode, 'dark')
  assert.equal(state.records.length, 0)
  await page.getByRole('button', {name: 'Open navigation', exact: true}).click()
  await page.getByRole('complementary', {name: 'Navigation'}).locator('.space-nav').filter({hasText: 'Desktop persistence check'}).waitFor()
  await page.getByRole('complementary', {name: 'Navigation'}).getByRole('button', {name: /Desktop source category/}).waitFor()
  assert.deepEqual(errors, [])
  passed = true
  console.log(JSON.stringify({result: 'PASS', packaged, checks: ['sandboxed renderer', 'no sample fallback', 'disconnected write guards', 'schema 2 persistence including category sources and project membership', 'stale revision guard', 'insecure URL rejected', 'restart including category navigation', 'no renderer errors']}, null, 2))
} finally {if (app) await app.close(); if (passed) await rm(dataDir, {recursive: true, force: true})}
