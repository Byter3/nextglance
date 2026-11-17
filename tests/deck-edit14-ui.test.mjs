import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {mkdir} from 'node:fs/promises'
import {plannerFixture} from './fixtures.mjs'

test('native Deck creation works during partial refresh and tablet inspector stays above Board layers',async()=>{
  const operations=['createCard','updateDescription'],fixture=plannerFixture()
  fixture.nativeOperations=operations;fixture.nativeWriteSources=['deck'];fixture.metadata={ready:true}
  fixture.statuses=fixture.statuses.map(status=>({...status,state:'error'}))
  fixture.workspace.planner.view='board';fixture.workspace.appearance.mode='dark'
  const entry=`import {mountNextspace} from '/src/index.ts'; mountNextspace(window.workspaceApi,'#app',{mobileHost:true,canMutateNative:false,nativeOperations:${JSON.stringify(operations)}})`
  const uiRequire=createRequire(new URL('../packages/ui/package.json',import.meta.url))
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),cacheDir:fileURLToPath(new URL('../.runtime/edit14-vite',import.meta.url)),configFile:false,resolve:{alias:{vue:uiRequire.resolve('vue/dist/vue.runtime.esm-bundler.js')}},plugins:[vue(),{name:'deck-edit-fixture',resolveId:id=>id==='virtual:deck-edit-fixture'?'\0deck-edit-fixture':undefined,load:id=>id==='\0deck-edit-fixture'?entry:undefined}],appType:'custom',server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error',optimizeDeps:{noDiscovery:true,include:['vue',...Object.keys(uiRequire('./package.json').dependencies).filter(name=>!name.startsWith('@nextspace/'))]}})
  server.middlewares.use((req,res,next)=>{if(req.url==='/edit14'){res.setHeader('Content-Type','text/html');res.end('<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/__x00__deck-edit-fixture"></script></body></html>')}else next()})
  let browser
  try{
    await server.listen();browser=await chromium.launch({headless:true,channel:'msedge'})
    const page=await browser.newPage({viewport:{width:900,height:1200},hasTouch:true})
    page.setDefaultTimeout(15000)
    const errors=[];page.on('pageerror',error=>errors.push(error.message))
    await page.addInitScript(({fixture})=>{
      const state=structuredClone(fixture);window.__writes=[]
      const read=async()=>structuredClone(state)
      window.workspaceApi={getState:read,refresh:read,openExternal:async()=>{},resumeSync:async()=>{},
        updateDescription:async input=>{window.__writes.push(input);state.records.find(item=>item.id===input.id).body=input.description;return read()},
        createCard:async input=>{window.__writes.push(input);const record={id:'created-fixture-card',source:'deck',kind:'card',collectionId:input.collectionId,stackId:input.stackId,title:input.title,body:input.description,assigneeIds:['fixture-user'],assignmentKnown:true,assignmentCount:1};state.records.push(record);return {...await read(),createdRecordId:record.id}},
      }
    },{fixture})
    const port=server.httpServer.address().port
    await page.goto(`http://127.0.0.1:${port}/edit14`)
    await page.locator('.board-view').waitFor()
    await page.getByRole('button',{name:'New item',exact:true}).click()
    await page.getByLabel('Item type',{exact:true}).selectOption('card')
    assert.equal(await page.getByLabel('Item type',{exact:true}).inputValue(),'card')
    await page.getByRole('button',{name:'Cancel',exact:true}).click()
    await page.locator('.page-options-toggle').click()
    await page.getByRole('combobox',{name:'Board source',exact:true}).selectOption('deck-work')
    await page.getByRole('button',{name:'Create card',exact:true}).click()
    await page.getByLabel('Item type',{exact:true}).waitFor()
    assert.equal(await page.getByRole('combobox',{name:'Deck board',exact:true}).inputValue(),'deck-work')
    await page.getByLabel('Title',{exact:true}).fill('Fixture assignment')
    await page.locator('.create-item-form').getByRole('button',{name:'Create card',exact:true}).click()
    await page.locator('.inspector').waitFor()
    assert.equal(await page.evaluate(()=>window.__writes.filter(input=>input.title==='Fixture assignment').length),1)
    assert.equal(await page.locator('.inspector h2').first().innerText(),'Fixture assignment')
    assert.equal(await page.locator('.inspector .description-section').getByRole('button',{name:'Edit',exact:true}).isEnabled(),true)
    // Close the page-options overlay if still open, then verify the actual
    // rendered inspector intercepts clicks wherever its surface overlaps cards.
    if(await page.locator('.page-controls.open').count())await page.locator('.page-options-heading button').click()
    const layers=await page.evaluate(()=>{
      const inspector=document.querySelector('.inspector'),body=document.querySelector('.workspace-body'),box=inspector.getBoundingClientRect()
      const samples=[.2,.5,.8].map(fraction=>document.elementFromPoint(box.left+40,box.top+box.height*fraction))
      const close=inspector.querySelector('[aria-label="Close item details"]'),closeBox=close.getBoundingClientRect()
      const closeHit=document.elementFromPoint(closeBox.left+closeBox.width/2,closeBox.top+closeBox.height/2)?.closest('button')
      return {position:getComputedStyle(inspector).position,isolation:getComputedStyle(body).isolation,hits:samples.map(element=>Boolean(element?.closest('.inspector'))),closeHit:closeHit?.getAttribute('aria-label')}
    })
    assert.equal(layers.position,'fixed');assert.equal(layers.isolation,'isolate');assert.deepEqual(layers.hits,[true,true,true])
    assert.equal(layers.closeHit,'Close item details')
    await mkdir(new URL('../.runtime',import.meta.url),{recursive:true})
    await page.screenshot({path:fileURLToPath(new URL('../.runtime/edit14-tablet-inspector.png',import.meta.url))})
    await page.locator('.inspector .description-section').getByRole('button',{name:'Edit',exact:true}).click()
    assert.equal(await page.locator('.inspector .note-editor').count(),1)
    await page.locator('.inspector .note-editor').getByRole('tab',{name:'Markdown',exact:true}).click()
    await page.locator('.inspector .note-editor').getByRole('textbox',{name:'Markdown',exact:true}).fill('- [ ] Review the fixture')
    await page.locator('.inspector .note-editor').getByRole('button',{name:'Save description',exact:true}).click()
    await page.locator('.inspector .note-editor').waitFor({state:'detached'})
    assert.equal(await page.evaluate(()=>window.__writes.find(input=>input.id==='created-fixture-card')?.description),'- [ ] Review the fixture')
    await page.getByRole('button',{name:'Close item details',exact:true}).click()
    await page.locator('.inspector').waitFor({state:'detached'})
    assert.deepEqual(errors,[])
  }finally{await browser?.close();await server.close()}
})
