import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { configureProfile } from '../electron/profile.cjs'

function fixture() {
  const appData = path.resolve('fixture-profile', 'AppData', 'Roaming')
  const calls = []
  let name = 'NextGlance'
  const paths = new Map()
  const app = {
    getPath: key => key === 'appData' ? appData : paths.get(key) || path.join(appData, name),
    setPath: (key, value) => { calls.push(['path', key, value]); paths.set(key, value) },
    setName: value => { calls.push(['name', value]); name = value },
  }
  const createDirectory = (directory, options) => calls.push(['mkdir', directory, options])
  return { app, appData, calls, createDirectory }
}

test('NextGlance keeps the historical account and Chromium profile despite the new product name', () => {
  const { app, appData, calls, createDirectory } = fixture()
  const legacyDirectory = path.join(appData, 'Nextspace')
  configureProfile(app, { explicitDataDirectory: '', createDirectory })
  assert.equal(app.getPath('userData'), legacyDirectory)
  assert.equal(app.getPath('sessionData'), legacyDirectory)
  assert.deepEqual(calls, [
    ['mkdir', legacyDirectory, { recursive: true, mode: 0o700 }],
    ['path', 'userData', legacyDirectory],
    ['path', 'sessionData', legacyDirectory],
    ['name', 'NextGlance'],
  ])
})

test('an explicit fixture profile isolates account storage and Chromium preferences from the normal profile', () => {
  const { app, appData, calls, createDirectory } = fixture()
  const directory = path.resolve('fixture-profile', 'isolated')
  assert.equal(configureProfile(app, { explicitDataDirectory: directory, createDirectory }), directory)
  assert.equal(app.getPath('userData'), directory)
  assert.equal(app.getPath('sessionData'), directory)
  assert.ok(calls.every(call => !call.includes(path.join(appData, 'Nextspace'))))
})

test('relative profile overrides fail before changing paths or creating a directory', () => {
  const { app, calls, createDirectory } = fixture()
  assert.throws(() => configureProfile(app, { explicitDataDirectory: 'relative-profile', createDirectory }), /must be an absolute directory path/)
  assert.deepEqual(calls, [])
})

test('an inaccessible profile fails without falling back to a new account directory', () => {
  const { app, calls } = fixture()
  assert.throws(() => configureProfile(app, {
    explicitDataDirectory: '',
    createDirectory: () => { throw new Error('fixture access denied') },
  }), /fixture access denied/)
  assert.deepEqual(calls, [])
})
