import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {chromium} from 'playwright'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {mkdir} from 'node:fs/promises'
import {plannerFixture} from './fixtures.mjs'
import {statusSourceKey} from '@nextspace/core/status-mapping.mjs'
import {scopePreferenceStorageKey} from '@nextspace/core/scope-preferences.mjs'

test('phone/tablet dependency removal uses canonical native or planner ownership and exact capabilities',async()=>{
  const operations=['setDeckDependency','moveCard','setCardCompleted','updateTaskStatus','updateRecordAppearance','createDeckLabel']
  const fixture=plannerFixture()
  fixture.nativeOperations=operations;fixture.nativeWriteSources=['deck','tasks'];fixture.metadata={ready:true}
  fixture.statuses=fixture.statuses.map(status=>({...status,state:'error'}))
  fixture.workspace.planner.view='list';fixture.workspace.appearance.mode='dark'
  fixture.workspace.planner.scopeId='space-work'
  const todo=statusSourceKey('tasks','tasks-work','NEEDS-ACTION')
  fixture.workspace.planner.statusMapping={columns:[{id:'todo',title:'Global to do',color:'#448855'}],assignments:{[todo]:'todo'}}
  fixture.workspace.spaces[0].statusMapping={columns:[{id:'review',title:'Space review',color:'#123456'}],assignments:{[todo]:'review'}}
  const base=fixture.records.find(record=>record.id==='card-mine')
  fixture.records=[
    {...base,id:'prior',title:'Prepare draft',nativeDependencies:[],readonly:true},
    {...base,id:'middle',title:'Review draft',nativeDependencies:['prior']},
    {...base,id:'later',title:'Publish draft',nativeDependencies:['middle']},
    {...fixture.records.find(record=>record.id==='task-today'),id:'task-before',title:'Check details'},
    {...fixture.records.find(record=>record.id==='task-today'),id:'task-after',title:'File receipt',status:'IN-PROCESS'},
  ]
  fixture.workspace.relations=[
    {id:'mixed-before',fromId:'middle',toId:'task-before',type:'depends_on'},
    {id:'mixed-after',fromId:'task-after',toId:'middle',type:'depends_on'},
  ]
  fixture.workspace.plans=[]
  const entry=`import {mountNextspace} from '/src/index.ts'; mountNextspace(window.workspaceApi,'#app',{mobileHost:true,canMutateNative:false,nativeOperations:${JSON.stringify(operations)}})`
  const uiRequire=createRequire(new URL('../packages/ui/package.json',import.meta.url))
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),cacheDir:fileURLToPath(new URL('../.runtime/dependency15-vite',import.meta.url)),configFile:false,resolve:{alias:{vue:uiRequire.resolve('vue/dist/vue.runtime.esm-bundler.js')}},plugins:[vue(),{name:'dependency-fixture',resolveId:id=>id==='virtual:dependency-fixture'?'\0dependency-fixture':undefined,load:id=>id==='\0dependency-fixture'?entry:undefined}],appType:'custom',server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error',optimizeDeps:{noDiscovery:true,include:['vue',...Object.keys(uiRequire('./package.json').dependencies).filter(name=>!name.startsWith('@nextspace/'))]}})
  server.middlewares.use((req,res,next)=>{if(req.url==='/dependencies'){res.setHeader('Content-Type','text/html');res.end('<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><script type="module" src="/@id/__x00__dependency-fixture"></script></body></html>')}else next()})
  let browser
  try{
    await server.listen();browser=await chromium.launch({headless:true,channel:'msedge'})
    for(const viewport of [{width:480,height:920},{width:900,height:1200}]){
      const page=await browser.newPage({viewport,hasTouch:true});page.setDefaultTimeout(15000)
      const errors=[];page.on('pageerror',error=>errors.push(error.message))
      await page.addInitScript(({fixture,preferencesKey})=>{
        localStorage.setItem(preferencesKey,JSON.stringify({version:2,scopes:{'space-work':{view:'list',pages:{list:{assignment:'all'}}}}}))
        const state=structuredClone(fixture),read=async()=>structuredClone(state)
        window.__writes=[];window.__rejectNative=false;window.__rejectPlanner=false
        window.workspaceApi={getState:read,refresh:read,resumeSync:async()=>{},openExternal:async()=>{},
          saveWorkspace:async(workspace,revision)=>{
            if(window.__rejectPlanner){window.__rejectPlanner=false;throw Error('Fixture planner save unavailable')}
            if(revision!==state.revision)throw Error('Stale revision')
            state.workspace=structuredClone(workspace);state.revision++
            return {workspace:structuredClone(workspace),revision:state.revision,storage:structuredClone(state.storage)}
          },
          setDeckDependency:async input=>{
            window.__writes.push({operation:'setDeckDependency',...input})
            if(window.__rejectNative){window.__rejectNative=false;throw Error('Fixture Deck removal rejected')}
            const record=state.records.find(item=>item.id===input.fromId)
            record.nativeDependencies=input.remove?record.nativeDependencies.filter(id=>id!==input.toId):[...new Set([...record.nativeDependencies,input.toId])]
            return read()
          },
          moveCard:async input=>{window.__writes.push({operation:'moveCard',...input});const record=state.records.find(item=>item.id===input.id);record.stackId=input.stackId;return read()},
          setCardCompleted:read,
          updateTaskStatus:async input=>{window.__writes.push({operation:'updateTaskStatus',...input});state.records.find(item=>item.id===input.id).status=input.status;return read()},
          updateRecordAppearance:async input=>{window.__writes.push({operation:'updateRecordAppearance',...input});Object.assign(state.records.find(item=>item.id===input.id),input);return read()},
          createDeckLabel:async input=>{window.__writes.push({operation:'createDeckLabel',...input});const label={id:'17',title:input.title,color:input.color};state.collections.find(item=>item.id===input.collectionId).labels=[label];return {label}},
        }
      },{fixture,preferencesKey:scopePreferenceStorageKey(fixture.connection)})
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/dependencies`)
      const inspector=page.getByRole('complementary',{name:'Item details'})
      const open=async title=>{
        if(await inspector.count())await page.getByRole('button',{name:'Close item details',exact:true}).tap()
        await page.locator('.list-table-row').filter({hasText:title}).first().tap()
        await inspector.getByRole('heading',{name:title,exact:true}).waitFor()
      }
      const remove=title=>inspector.getByRole('button',{name:'Remove dependency '+title,exact:true})
      await open('Review draft')
      const badge=(direction,title)=>inspector.locator(`.dependency-group[data-direction="${direction}"] .dependency-tile`).filter({hasText:title}).locator('.dependency-status')
      const incoming=badge('incoming','Check details'),outgoing=badge('outgoing','File receipt')
      await incoming.waitFor();await outgoing.waitFor()
      assert.equal(await incoming.innerText(),'Space review')
      assert.equal(await incoming.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(18, 52, 86)')
      assert.equal(await incoming.evaluate(element=>getComputedStyle(element).color),'rgb(255, 255, 255)')
      assert.equal(await outgoing.innerText(),'Unmapped')
      assert.equal(await outgoing.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(139, 147, 159)')
      assert.equal(await badge('incoming','Prepare draft').count(),0)
      assert.equal(await remove('Prepare draft').isEnabled(),true,'Read-only prerequisite does not block writable dependent')
      assert.equal(await remove('Publish draft').isEnabled(),true)
      // A rejected native operation restores the real link and never creates a
      // planner-only substitute. The same touch retry uses the original IDs.
      await page.evaluate(()=>window.__rejectNative=true)
      await remove('Prepare draft').tap()
      const failure=inspector.getByRole('alert').filter({hasText:'Fixture Deck removal rejected'})
      await failure.waitFor()
      const evidence=new URL('../.runtime/release12-dependencies/',import.meta.url)
      await mkdir(evidence,{recursive:true})
      await page.screenshot({path:fileURLToPath(new URL(`dependency-${viewport.width}-retry.png`,evidence))})
      assert.equal(await remove('Prepare draft').count(),1)
      assert.equal(await inspector.getByRole('heading',{name:'Review draft',exact:true}).count(),1)
      await failure.getByRole('button',{name:'Retry change',exact:true}).tap()
      await remove('Prepare draft').waitFor({state:'detached'})
      await remove('Publish draft').tap()
      await remove('Publish draft').waitFor({state:'detached'})
      assert.deepEqual(await page.evaluate(()=>window.__writes.filter(item=>item.operation==='setDeckDependency').map(({operation,...input})=>input)),[
        {fromId:'middle',toId:'prior',remove:true},{fromId:'middle',toId:'prior',remove:true},{fromId:'later',toId:'middle',remove:true},
      ])
      assert.equal(await page.evaluate(async()=>{const state=await window.workspaceApi.getState();return state.workspace.relations.filter(edge=>edge.fromId==='later'||edge.toId==='prior').length}),0)
      await page.evaluate(()=>window.__rejectPlanner=true)
      await remove('Check details').tap()
      await inspector.getByRole('alert').filter({hasText:'Fixture planner save unavailable'}).waitFor()
      assert.equal(await remove('Check details').count(),1)
      await remove('Check details').tap();await remove('Check details').waitFor({state:'detached'})
      await remove('File receipt').tap();await remove('File receipt').waitFor({state:'detached'})
      assert.equal(await page.evaluate(async()=>(await window.workspaceApi.getState()).workspace.relations.length),0)
      assert.equal(await page.evaluate(()=>window.__writes.filter(item=>item.operation==='setDeckDependency').length),3,'Mixed task/card edges never call Deck')
      // Previously blanket-disabled status controls must use the exact operation.
      const stack=inspector.getByRole('combobox',{name:'Deck stack',exact:true})
      assert.equal(await stack.isEnabled(),true)
      await stack.tap();await page.getByRole('option',{name:'In progress',exact:true}).tap()
      await page.waitForFunction(()=>window.__writes.some(item=>item.operation==='moveCard'&&item.id==='middle'&&item.stackId==='stack-progress'))
      const appearance=inspector.getByRole('region',{name:'Item color and tags',exact:true})
      await appearance.getByRole('button',{name:'Choose tags',exact:true}).tap()
      const tags=appearance.getByRole('dialog',{name:'Choose tags',exact:true})
      await tags.getByLabel('Find or add a tag',{exact:true}).fill('Project')
      await tags.getByRole('button',{name:'Create tag “Project”',exact:true}).tap()
      await tags.getByRole('checkbox',{name:'Project',exact:true}).waitFor()
      await inspector.locator('.inspector-kind').tap()
      await tags.waitFor({state:'detached'})
      await page.waitForFunction(()=>window.__writes.some(item=>item.operation==='updateRecordAppearance'&&item.id==='middle'&&item.tagIds?.includes('17')))
      assert.equal(await page.evaluate(()=>window.__writes.filter(item=>item.operation==='createDeckLabel').length),1)
      await open('Publish draft');assert.equal(await remove('Review draft').count(),0,'Both endpoint inspectors reflect native deletion')
      await open('Review draft')
      await page.screenshot({path:fileURLToPath(new URL(`dependency-${viewport.width}-removed.png`,evidence))})
      for(const [title,direction] of [['Prepare draft','Waits for (incoming)'],['Publish draft','Needed by (outgoing)']]){
        await inspector.getByRole('button',{name:'Add dependency',exact:true}).tap()
        const dialog=page.getByRole('dialog',{name:'Add dependency',exact:true})
        await dialog.getByRole('radio',{name:direction,exact:false}).tap()
        await dialog.getByLabel('Find related work',{exact:true}).fill(title)
        const target=dialog.getByRole('radio',{name:title,exact:true})
        assert.equal(await target.isEnabled(),true)
        await target.tap();await dialog.getByRole('button',{name:'Add dependency',exact:true}).tap()
        await dialog.waitFor({state:'detached'});await remove(title).waitFor()
      }
      assert.deepEqual(await page.evaluate(()=>window.__writes.filter(item=>item.operation==='setDeckDependency').slice(-2).map(({operation,...input})=>input)),[
        {fromId:'middle',toId:'prior',remove:false},{fromId:'later',toId:'middle',remove:false},
      ])
      await open('Check details')
      const status=inspector.getByRole('combobox',{name:'Task status',exact:true})
      assert.equal(await status.isEnabled(),true)
      await status.tap();await page.getByRole('option',{name:'In progress',exact:true}).tap()
      await page.waitForFunction(()=>window.__writes.some(item=>item.operation==='updateTaskStatus'&&item.id==='task-before'&&item.status==='IN-PROCESS'))
      assert.deepEqual(errors,[])
      await page.close()
    }
  }finally{await browser?.close();await server.close()}
})
