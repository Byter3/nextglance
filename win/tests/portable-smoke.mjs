/** Launch the actual portable wrapper with a private test profile; never uses a real account. */
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '../..')
const {version, build: {productName}} = require('../package.json')
const executablePath = path.join(root, 'win', 'release', `${productName}-${version}-Windows.exe`)
const runtimeRoot = path.join(root, '.runtime')
const dataDir = path.join(runtimeRoot, `portable-smoke-${Date.now()}`)
assert.ok(dataDir.startsWith(`${runtimeRoot}${path.sep}`))
await mkdir(dataDir, {recursive:true})
const env = {...process.env, NEXTSPACE_DATA_DIR:dataDir}
delete env.ELECTRON_RUN_AS_NODE
delete env.NEXTSPACE_DEV_URL
delete env.NEXTSPACE_TEST_MODE
// The NSIS wrapper does not forward the Electron inspector's stderr. Discover
// Chromium through a temporary loopback port instead of Electron.launch().
const portServer=createServer()
await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve))
const port=portServer.address().port
await new Promise(resolve=>portServer.close(resolve))
let browser, child, launchError, passed = false, output=''
try {
  child=spawn(executablePath,[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
  child.once('error',error=>{launchError=error})
  child.stdout.on('data',data=>{output=(output+data).slice(-4000)})
  child.stderr.on('data',data=>{output=(output+data).slice(-4000)})
  let endpoint
  const deadline=Date.now()+90_000
  while(Date.now()<deadline){
    if(launchError)throw launchError
    try{const reply=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(700)});if(reply.ok){endpoint=(await reply.json()).webSocketDebuggerUrl;break}}catch{}
    if(child.exitCode!==null)throw new Error(`Portable wrapper exited ${child.exitCode}: ${output}`)
    await delay(300)
  }
  assert.ok(endpoint,`Portable debugger did not start: ${output}`)
  browser=await chromium.connectOverCDP(endpoint)
  const context=browser.contexts()[0]
  const page=context.pages()[0]||await context.waitForEvent('page')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => Boolean(window.workspaceApi))
  const state = await page.evaluate(() => window.workspaceApi.getState())
  assert.equal(state.connection.connected, false)
  assert.equal(state.records.length, 0)
  assert.equal(state.collections.length, 0)
  assert.equal(state.workspace.schemaVersion, 2)
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.match(await page.title(),new RegExp(productName))
  assert.ok(path.resolve(state.storage.localPath).startsWith(`${dataDir}${path.sep}`))
  await page.getByRole('button', {name:'Open navigation', exact:true}).click()
  await page.getByRole('complementary', {name:'Navigation'}).waitFor()
  assert.deepEqual(errors, [])
  passed = true
} finally {
  if(browser){const session=await browser.newBrowserCDPSession();await Promise.race([session.send('Browser.close').catch(()=>{}),delay(2000)]);await Promise.race([browser.close().catch(()=>{}),delay(2000)])}
  if(child?.pid&&child.exitCode===null){
    await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(8000)])
    if(child.exitCode===null)await new Promise(resolve=>spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).once('exit',resolve))
  }
  if(passed) await rm(dataDir, {recursive:true, force:true})
}
console.log(JSON.stringify({result:'PASS', artifact:path.relative(root, executablePath), checks:['portable extraction and startup', 'correct product title', 'isolated private profile', 'disconnected empty state', 'schema 2', 'sandboxed renderer', 'navigation', 'no renderer errors']}, null, 2))
