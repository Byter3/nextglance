import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {createLaunchHints} from '../src/launch-hints.mjs'

test('launch hint is color-only, account-qualified and cleared on replacement/disconnect', () => {
  const values = new Map(), storage = {getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)}
  const hints = createLaunchHints(storage), key = 'a'.repeat(64)
  hints.save(key, {name: 'Private title', color: '#446688', mode: 'dark', logoUrl: 'https://example.test/logo', backgroundUrl: 'https://example.test/private', backgroundColor: '#17252d'})
  assert.deepEqual(hints.initial(), {color: '#446688', backgroundColor: '#17252d', mode: 'dark'})
  assert.equal(hints.read('b'.repeat(64)), undefined)
  assert.ok(![...values.values()][0].includes('Private'))
  hints.clear(key); assert.equal(hints.initial(), undefined)
  assert.doesNotThrow(() => createLaunchHints({getItem: () => {throw new Error('Blocked')}}).read(key))
})


test('pre-module appearance bootstrap applies bounded colors without loading app code or trusting CSS URLs', () => {
  const script = readFileSync(new URL('../public/launch-appearance.js', import.meta.url), 'utf8')
  assert.ok(!script.includes('import '))
  const run = value => {
    const styles = new Map(), root = {dataset: {}, style: {setProperty: (key, value) => styles.set(key, value)}}
    runInNewContext(script, {localStorage: {getItem: () => value}, matchMedia: () => ({matches: false}), document: {documentElement: root}})
    return {root, styles}
  }
  const valid = JSON.stringify({version: 1, accountKey: 'a'.repeat(64), theme: {mode: 'dark', color: '#446688', backgroundColor: '#17252d'}})
  const normal = run(valid)
  assert.equal(normal.styles.get('--cloud-background'), '#17252d'); assert.equal(normal.root.dataset.theme, 'dark')
  assert.equal(normal.root.style.backgroundColor, 'var(--cloud-background)')
  for (const invalid of ['{bad', 'x'.repeat(8193), JSON.stringify({version: 1, accountKey: 'bad', theme: {color: '#ffffff'}})]) assert.equal(run(invalid).styles.size, 0)
  const unsafe = run(JSON.stringify({version: 1, accountKey: 'a'.repeat(64), theme: {color: 'url(https://example.test)', backgroundColor: 'red; opacity:0', darkPalette: {surfaceColor: 'expression(1)'}}}))
  assert.equal(unsafe.styles.size, 0)
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.ok(html.indexOf('launch-appearance.js') < html.indexOf('/src/main.ts'))
})
