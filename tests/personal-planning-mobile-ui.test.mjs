import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {plannerFixture} from './fixtures.mjs'
import {NATIVE_OPERATIONS} from '../android/src/native-edits.mjs'

test('Android-capability App keeps personal columns, work blocks and related links metadata-only',async()=>{
  const fixture=plannerFixture(new Date('2030-04-08T08:00:00Z'))
  fixture.nativeOperations=[...NATIVE_OPERATIONS];fixture.nativeWriteSources=['deck','tasks','calendar'];fixture.metadata={ready:true}
  fixture.workspace.planner.view='list';fixture.workspace.planner.workflow={}
  fixture.workspace.plans=[];fixture.workspace.relations=[];fixture.workspace.projects=[]
  fixture.records=fixture.records.filter(record=>['card-mine','task-today'].includes(record.id))
  const entry=`import {mountNextspace} from '/src/index.ts'; mountNextspace(window.workspaceApi,'#app',{mobileHost:true,canMutateNative:false,nativeOperations:${JSON.stringify(NATIVE_OPERATIONS)}})`
  const uiRequire=createRequire(new URL('../packages/ui/package.json',import.meta.url))
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),cacheDir:fileURLToPath(new URL('../.runtime/personal-planning-vite',import.meta.url)),configFile:false,resolve:{alias:{vue:uiRequire.resolve('vue/dist/vue.runtime.esm-bundler.js')}},plugins:[vue(),{name:'personal-planning-fixture',resolveId:id=>id==='virtual:personal-planning-fixture'?'\0personal-planning-fixture':undefined,load:id=>id==='\0personal-planning-fixture'?entry:undefined}],appType:'custom',server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error',optimizeDeps:{noDiscovery:true,include:['vue',...Object.keys(uiRequire('./package.json').dependencies).filter(name=>!name.startsWith('@nextspace/'))]}})
  server.middlewares.use((req,res,next)=>{if(req.url==='/personal-planning'){res.setHeader('Content-Type','text/html');res.end('<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/__x00__personal-planning-fixture"></script></body></html>')}else next()})
  let browser
  try{
    await server.listen();browser=await chromium.launch({headless:true,channel:'msedge'})
    for(const viewport of [{width:480,height:920},{width:900,height:1200}]){
      const page=await browser.newPage({viewport,hasTouch:true,timezoneId:'UTC'});page.setDefaultTimeout(15000)
      const errors=[];page.on('pageerror',error=>errors.push(error.message))
      await page.addInitScript(({fixture,operations})=>{
        const state=structuredClone(fixture),read=async()=>structuredClone(state)
        window.__metadataWrites=[];window.__nativeWrites=[]
        const blocked=operation=>async input=>{window.__nativeWrites.push({operation,input});throw Error('Unexpected native mutation '+operation)}
        window.workspaceApi={...Object.fromEntries(operations.map(operation=>[operation,blocked(operation)])),getState:read,refresh:read,resumeSync:async()=>{},openExternal:async()=>{},readDeckAttachments:async()=>({attachments:[]}),listFiles:async()=>({files:[]}),
          saveWorkspace:async(workspace,revision)=>{
            if(revision!==state.revision)throw Error('Stale fixture revision')
            state.workspace=structuredClone(workspace);state.revision++
            window.__metadataWrites.push(structuredClone(workspace))
            return {workspace:structuredClone(workspace),revision:state.revision,storage:structuredClone(state.storage)}
          },
        }
      },{fixture,operations:NATIVE_OPERATIONS})
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/personal-planning`)
      const inspector=page.getByRole('complementary',{name:'Item details'})
      await page.locator('.list-table-row').filter({hasText:'Edit the opening sequence'}).first().tap()
      await inspector.getByRole('heading',{name:'Edit the opening sequence',exact:true}).waitFor()
      await inspector.getByText('Organization & personal planning',{exact:true}).tap()
      const column=inspector.getByLabel('Personal planning column',{exact:true})
      assert.equal(await column.isEnabled(),true)
      await column.selectOption('planned')
      await page.waitForFunction(()=>window.__metadataWrites.at(-1)?.planner.workflow['card-mine']==='planned')
      await column.selectOption('doing')
      await page.waitForFunction(()=>window.__metadataWrites.at(-1)?.planner.workflow['card-mine']==='doing')

      await inspector.locator('.planner-block-options > summary').tap()
      await inspector.getByRole('button',{name:'Add planner block',exact:true}).tap()
      const plan=page.getByRole('dialog',{name:'Plan a work session',exact:true})
      await plan.getByLabel('Start',{exact:true}).fill('2030-04-08T09:00')
      await plan.getByLabel('End',{exact:true}).fill('2030-04-08T10:00')
      await plan.getByRole('button',{name:'Save work session',exact:true}).tap()
      await plan.waitFor({state:'detached'})
      await page.waitForFunction(()=>window.__metadataWrites.at(-1)?.plans.length===1)
      const saved=await page.evaluate(()=>window.__metadataWrites.at(-1).plans[0])
      assert.deepEqual({...saved,id:'generated'},{id:'generated',recordId:'card-mine',start:'2030-04-08T09:00:00.000Z',end:'2030-04-08T10:00:00.000Z'})
      assert.ok(saved.id)
      await inspector.locator('.plan-row > button').first().tap()
      await plan.getByLabel('Start',{exact:true}).fill('2030-04-08T10:30')
      await plan.getByLabel('End',{exact:true}).fill('2030-04-08T11:45')
      await plan.getByRole('button',{name:'Save work session',exact:true}).tap()
      await plan.waitFor({state:'detached'})
      await page.waitForFunction(()=>window.__metadataWrites.at(-1)?.plans[0]?.end==='2030-04-08T11:45:00.000Z')
      assert.deepEqual(await page.evaluate(()=>window.__metadataWrites.at(-1).plans),[{...saved,start:'2030-04-08T10:30:00.000Z',end:'2030-04-08T11:45:00.000Z'}])
      await inspector.getByRole('button',{name:/^Remove work session on /}).tap()
      await page.waitForFunction(()=>window.__metadataWrites.at(-1)?.plans.length===0)

      await inspector.getByRole('button',{name:'Link another item',exact:true}).tap()
      const relation=page.getByRole('dialog',{name:'Link related item',exact:true})
      await relation.getByLabel('Connection type',{exact:true}).selectOption('related')
      await relation.getByLabel('Find related work',{exact:true}).fill('Prepare review notes')
      await relation.getByRole('radio',{name:'Prepare review notes',exact:true}).tap()
      await relation.getByRole('button',{name:'Link item',exact:true}).tap()
      await relation.waitFor({state:'detached'})
      await page.waitForFunction(()=>window.__metadataWrites.at(-1)?.relations.some(edge=>edge.fromId==='card-mine'&&edge.toId==='task-today'&&edge.type==='related'))
      const links=inspector.getByRole('region',{name:'Other linked items',exact:true})
      await links.getByText('Prepare review notes',{exact:true}).waitFor()
      await links.getByRole('button',{name:'Remove connection',exact:true}).tap()
      await page.waitForFunction(()=>window.__metadataWrites.at(-1)?.relations.length===0)
      assert.deepEqual(await page.evaluate(()=>window.__nativeWrites),[],'Personal planning must never mutate native records')
      assert.deepEqual(await page.evaluate(async()=>(await window.workspaceApi.getState()).records),fixture.records,'Status, deadline, body and native links remain unchanged')
      assert.equal(await page.evaluate(()=>window.__metadataWrites.at(-1).planner.workflow['card-mine']),'doing')
      assert.deepEqual(errors,[])
      await page.close()
    }
  }finally{await browser?.close();await server.close()}
})
