// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const require=createRequire(new URL('../../packages/nextcloud/package.json',import.meta.url))
const {XMLParser,XMLValidator}=require('fast-xml-parser')

const root=fileURLToPath(new URL('../../',import.meta.url))
const bundled=fileURLToPath(new URL('../../.runtime/php-web/php.exe',import.meta.url))
const php=process.env.PHP_BINARY||(existsSync(bundled)?bundled:'php')
const available=spawnSync(php,['--version'],{encoding:'utf8'}).status===0

test('Nextcloud PHP shell, authenticated session and escaped template', {skip:available?false:'Set PHP_BINARY to a PHP 8.2+ executable to run native host fixtures.'},()=>{
  const result=spawnSync(php,['web/tests/php-host.php'],{cwd:root,encoding:'utf8'})
  assert.equal(result.status,0,result.stdout+result.stderr)
  assert.match(result.stdout,/fixtures passed/)
})

test('PHP host files pass native syntax checks', {skip:available?false:'PHP runtime is unavailable.'},()=>{
  for(const path of ['appinfo/routes.php','lib/AppInfo/Application.php','lib/Controller/PageController.php','lib/Controller/SessionController.php','templates/main.php','tests/php-host.php']) {
    const result=spawnSync(php,['-l',`web/${path}`],{cwd:root,encoding:'utf8'})
    assert.equal(result.status,0,path+'\n'+result.stdout+result.stderr)
  }
})

test('Nextcloud metadata targets the approved app and integrations remain optional',()=>{
  const text=readFileSync(new URL('../appinfo/info.xml',import.meta.url),'utf8')
  assert.equal(XMLValidator.validate(text),true)
  const {info}=new XMLParser({ignoreAttributes:false}).parse(text)
  assert.equal(info.id,'nextglance')
  assert.equal(info.name,'NextGlance')
  assert.equal(info.namespace,'Nextglance')
  assert.equal(info.licence,'AGPL-3.0-or-later')
  assert.deepEqual(info.dependencies.nextcloud,{'@_min-version':'34','@_max-version':'35'})
  assert.deepEqual(info.dependencies.php,{'@_min-version':'8.2','@_max-version':'8.5'})
  assert.equal(info.navigations.navigation.route,'nextglance.page.index')
  assert.equal(info.dependencies.app,undefined)
  assert.match(readFileSync(new URL('../img/app.svg',import.meta.url),'utf8'),/<svg\b/)
})
