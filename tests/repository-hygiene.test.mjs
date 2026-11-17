import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {inspectSourceFile, inspectRepository} from '../scripts/check-repository.mjs'

const scan = (name, content) => inspectSourceFile(name, Buffer.from(content))
test('source guard rejects private/generated files and reports no content', () => {
  for (const name of ['.runtime/profile/state.json', 'win/release/app.exe', '.env.local', 'android/android/local.properties', 'account.encrypted.json', 'calendar.sqlite', 'android/android/capacitor.settings.gradle']) {
    const result = scan(name, 'private test content')
    assert.equal(result[0]?.rule, 'private-or-generated-path', name)
    assert.ok(!JSON.stringify(result).includes('private test content'))
  }
  assert.deepEqual(scan('.env.example', 'NEXTGLANCE_EXAMPLE=true'), [])
})
test('source guard detects key/token/home-path and diagnostics leaks', () => {
  const secret = ['ghp_', 'a'.repeat(32)].join('')
  const key = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')
  const home = ['C:', 'Users', 'fixture-person', 'private.json'].join('\\')
  for (const [value, rule] of [[secret, 'provider-token'], [key, 'private-key'], [home, 'personal-home-path']]) {
    const result = scan('example.txt', `first line\n${value}`)
    assert.equal(result[0]?.rule, rule)
    assert.equal(result[0]?.line, 2)
    assert.ok(!JSON.stringify(result).includes(value))
  }
  assert.equal(scan('report.json', JSON.stringify({format: 'nextglance-diagnostics'}))[0]?.rule, 'diagnostics-export')
  assert.deepEqual(scan('tests/fixture.mjs', "const url = 'https://cloud.example.test/remote.php/dav/principals/users/alex/'"), [])
})
test('staged inspection sees an indexed leak despite a clean working-tree edit', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nextglance-git-fixture-'))
  const git = args => execFileSync('git', args, {cwd: root, stdio: 'pipe'})
  try {
    git(['init', '--quiet'])
    writeFileSync(path.join(root, 'fixture.txt'), ['ghp_', 'b'.repeat(32)].join(''))
    git(['add', '--', 'fixture.txt'])
    writeFileSync(path.join(root, 'fixture.txt'), 'Clean working-tree content')
    assert.deepEqual(inspectRepository(root).findings, [])
    assert.equal(inspectRepository(root, true).findings[0]?.rule, 'provider-token')
    git(['add', '--', 'fixture.txt'])
    assert.deepEqual(inspectRepository(root, true).findings, [])
  } finally {
    // Only the exact directory returned by mkdtempSync is removed.
    rmSync(root, {recursive: true, force: true})
  }
})
