/** Shared reference UI in isolated browser contexts. No live account writes. */
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createEmptyState, createPlannerWorkspace} from '@nextspace/core/planner.mjs'

const baseUrl=process.env.ANDROID_PREVIEW_URL||'http://127.0.0.1:5174'
const refreshOnly=process.argv.includes('--refresh-only')
const output=path.resolve(import.meta.dirname,'../../artifacts/android-reference')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const errors=[]
const viewports=[{width:384,height:854},{width:800,height:1280},{width:1280,height:800}]
const workspace=createPlannerWorkspace()
workspace.spaces=[{id:'space-a',name:'Daily life',color:'#3483c6',collectionIds:['tasks-1','calendar-1','deck-1','notes-1']}]
const records=[
  {id:'task-1',source:'tasks',kind:'task',title:'Review launch checklist',body:'A source description.\n\n- [ ] Review accessibility',collectionId:'tasks-1',collectionTitle:'Work tasks',start:'2026-11-11',due:'2026-11-12',status:'IN-PROCESS',url:'https://cloud.example.test/apps/tasks/'},
  {id:'event-1',source:'calendar',kind:'event',title:'Team review',collectionId:'calendar-1',collectionTitle:'Team calendar',start:'2026-11-12T10:00:00',end:'2026-11-12T11:00:00'},
  {id:'card-1',source:'deck',kind:'card',title:'Prepare release notes',collectionId:'deck-1',collectionTitle:'Product board',stackId:'review',assignmentKnown:true,assigneeIds:['fixture'],body:'- [ ] Review notes',start:'2026-11-11',due:'2026-11-13'},
  {id:'card-2',source:'deck',kind:'card',title:'Publish release notes',collectionId:'deck-1',collectionTitle:'Product board',stackId:'review',assignmentKnown:true,assigneeIds:['fixture'],start:'2026-11-12',due:'2026-11-14'},
  {id:'note-1',source:'notes',kind:'note',title:'Research notes',body:'# Research\n\nA **formatted** note.',collectionId:'notes-1',collectionTitle:'Notes'},
]
const live={...createEmptyState(),mode:'live',workspace,records,revision:0,
  connection:{connected:true,serverUrl:'https://cloud.example.test',username:'fixture'},
  collections:[{id:'tasks-1',source:'tasks',title:'Work tasks',color:'#226688'},{id:'calendar-1',source:'calendar',title:'Team calendar',color:'#bb5533'},{id:'deck-1',source:'deck',title:'Product board',color:'#7755aa',stacks:[{id:'review',title:'Review'}]},{id:'notes-1',source:'notes',title:'Notes'}],
  statuses:['tasks','calendar','deck','notes','collectives'].map(source=>({source,state:'connected',count:records.filter(record=>record.source===source).length})),
  storage:{syncStatus:'synced'},metadata:{ready:true},deviceState:{},
}
const disconnected={...createEmptyState(),metadata:{ready:false},deviceState:{}}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Phone/tablet root must not overflow')}
async function screenshot(page,name){await page.screenshot({path:path.join(output,name+'.png'),fullPage:true})}
async function installFixture(context,isNative=false,options={}){
  await context.addInitScript(({live,disconnected,isNative,options})=>{
    let state=structuredClone(options.initialState||disconnected),listener
    const calls=[]
    const snapshot=()=>structuredClone(state)
    const forbidden=async()=>{calls.push('unsupported-native-write');throw new Error('Unsupported native mutation')}
    window.__calls=calls
    window.__snapshot=snapshot
    window.__emit=()=>{state.workspace.spaces.push({id:'space-b',name:'Background Space',color:'#557733',collectionIds:[]});state.revision++;listener?.(snapshot())}
    window.__fixture={isNative,
      getState:async()=>snapshot(),refresh:async()=>{calls.push('refresh');if(options.deferRefresh)await new Promise(resolve=>{window.__releaseRefresh=resolve});if(options.refreshedState)state=structuredClone(options.refreshedState);return snapshot()},syncWorkspace:async()=>snapshot(),
      beginLogin:async serverUrl=>{calls.push(['beginLogin',serverUrl]);return {flowId:'fixture-flow',loginUrl:'https://cloud.example.test/login'}},
      pollLogin:async flowId=>{calls.push(['pollLogin',flowId]);state=structuredClone(live);return {pending:false,state:snapshot()}},
      cancelLogin:async()=>snapshot(),disconnect:async()=>{state=structuredClone(disconnected);return snapshot()},
      selectAccount:async()=>{calls.push('selectAccount');state=structuredClone(live);return snapshot()},
      subscribe:fn=>{listener=fn;return()=>{listener=undefined}},
      saveWorkspace:async(workspace,revision)=>{assertRevision(revision);state.workspace=structuredClone(workspace);state.revision++;return {workspace:structuredClone(workspace),revision:state.revision,storage:state.storage}},
      openExternal:async url=>{calls.push(['openExternal',url])},readPage:async()=>({body:''}),
      createTask:forbidden,setTaskCompleted:forbidden,exportWorkspace:forbidden,
    }
    function assertRevision(value){if(value!==state.revision)throw new Error('Revision changed')}
  },{live,disconnected,isNative,options})
  await context.route('**/src/adapter.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const createAndroidApi=()=>window.__fixture'}))
}
try{
  if(!refreshOnly){
  for(const viewport of viewports){
    const context=await browser.newContext({viewport})
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(baseUrl)
    await page.getByRole('heading',{name:'Your life has different parts. See how they fit together.'}).waitFor()
    assert.equal(await page.locator('.foundation-app,.android-app,.mobile-item').count(),0)
    assert.equal(await page.getByRole('tab').count(),5)
    await noOverflow(page)
    await screenshot(page,`disconnected-${viewport.width}`)
    await page.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).click()
    await page.getByRole('textbox',{name:'Server URL'}).fill('https://cloud.example.test')
    assert.equal(await page.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).last().isEnabled(),true)
    assert.equal(await page.locator('input[type=password]').count(),0)
    assert.equal(await page.getByText('Saved account · offline',{exact:true}).count(),0)
    assert.equal(await page.getByRole('button',{name:'Continue with Nextcloud Files'}).count(),0)
    await noOverflow(page)
    await screenshot(page,`connection-${viewport.width}`)
    if(viewport.width===384){
      assert.deepEqual(await page.evaluate(async()=>{
        const {createBrowserCacheFiles}=await import('/src/browser-host.mjs')
        const {createSlotCache}=await import('/src/cache.mjs')
        const first=createSlotCache(createBrowserCacheFiles()),keyA='a'.repeat(64),keyB='b'.repeat(64)
        await first.save(keyA,{value:'account A'});await first.save(keyB,{value:'account B'})
        const restarted=createSlotCache(createBrowserCacheFiles())
        const values=[await restarted.load(keyA),await restarted.load(keyB)]
        await restarted.remove(keyA);values.push(await restarted.load(keyA),await restarted.load(keyB))
        return values
      }),[{value:'account A'},{value:'account B'},null,{value:'account B'}])
    }
    await context.close()
  }
  for(const viewport of [viewports[0],viewports[1]]){
    const context=await browser.newContext({viewport})
    await installFixture(context)
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(baseUrl)
    await page.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).click()
    await page.getByRole('textbox',{name:'Server URL'}).fill('https://cloud.example.test')
    await page.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).last().click()
    await page.locator('.overview-split').waitFor()
    await page.getByLabel('Choose calendar date').fill('2026-11-11')
    if(viewport.width<760){
      const geometry=await page.locator('.timeline-days>div').first().boundingBox()
      assert.ok(geometry.width>=64,'Phone dates must remain readable through horizontal overflow')
      await page.locator('.timeline-scroll').evaluate(element=>{element.scrollLeft=120;element.dispatchEvent(new Event('scroll'))})
      await page.waitForFunction(()=>{
        const timeline=document.querySelector('.timeline-scroll'),calendar=document.querySelector('.calendar-times-scroll'),allDay=document.querySelector('.calendar-all-day-viewport')
        return timeline.scrollLeft>0&&Math.abs(timeline.scrollLeft-calendar.scrollLeft)<2&&Math.abs(timeline.scrollLeft-allDay.scrollLeft)<2
      })
      await page.locator('.timeline-scroll').evaluate(element=>{element.scrollLeft=0;element.dispatchEvent(new Event('scroll'))})
    }
    assert.equal(await page.getByRole('button',{name:'New item',exact:true}).count(),0)
    await noOverflow(page);await screenshot(page,`fixture-overview-${viewport.width}`)
    if(viewport.width===800){
      const dragLink=async(fromId,toId,allowed)=>{
        const connector=await page.locator(`.timeline-chart-row[data-record-id="${fromId}"] .timeline-connector`).boundingBox()
        const target=page.locator(`.timeline-row-label[data-record-id="${toId}"]`),bounds=await target.boundingBox()
        await page.mouse.move(connector.x+connector.width/2,connector.y+connector.height/2)
        await page.mouse.down();await page.mouse.move(bounds.x+80,bounds.y+bounds.height/2,{steps:8})
        assert.equal(await target.evaluate(element=>element.classList.contains('link-drop-target')),allowed)
        await page.mouse.up()
      }
      await dragLink('card-1','card-2',false)
      assert.equal(await page.evaluate(()=>window.__snapshot().workspace.relations.length),0)
      await dragLink('task-1','card-1',true)
      await page.waitForFunction(()=>window.__snapshot().workspace.relations.some(edge=>edge.fromId==='card-1'&&edge.toId==='task-1'))
    }
    for(const name of ['Calendar','Timeline','Board','List']){
      await page.getByRole('tab',{name,exact:true}).click()
      assert.equal(await page.getByRole('tab',{name,exact:true}).getAttribute('aria-selected'),'true')
      await noOverflow(page)
    }
    await page.locator('.list-table-row').filter({hasText:'Review launch checklist'}).click()
    await page.locator('.inspector').waitFor()
    assert.equal(await page.getByRole('button',{name:'Mark done',exact:true}).isDisabled(),true)
    assert.equal(await page.getByRole('button',{name:'Edit dates',exact:true}).isDisabled(),true)
    assert.equal(await page.locator('.description-section').getByRole('button',{name:'Edit',exact:true}).count(),0)
    assert.equal(await page.getByText('Source editing is not available on this device yet.',{exact:false}).count(),1)
    if(viewport.width<760)assert.equal(Math.round((await page.locator('.inspector').boundingBox()).width),viewport.width)
    await screenshot(page,`fixture-details-${viewport.width}`)
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nextspace:back',{cancelable:true})))
    await page.locator('.inspector').waitFor({state:'detached'})
    await page.evaluate(()=>window.__emit())
    await page.getByRole('button',{name:'Open navigation'}).click()
    await page.getByRole('button',{name:'Background Space'}).waitFor()
    assert.equal((await page.evaluate(()=>window.__calls)).includes('unsupported-native-write'),false)
    await context.close()
  }
  {
    const context=await browser.newContext({viewport:viewports[0]})
    await installFixture(context,true)
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(baseUrl)
    await page.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).click()
    await page.getByRole('button',{name:'Continue with Nextcloud Files',exact:true}).click()
    await page.locator('.overview-split').waitFor()
    assert.ok((await page.evaluate(()=>window.__calls)).includes('selectAccount'))
    await context.close()
  }
  }
  {
    const context=await browser.newContext({viewport:viewports[0]})
    const restored={...structuredClone(live),connection:{...live.connection,connected:false},records:[],statuses:live.statuses.map(status=>({...status,state:'unavailable',count:0}))}
    const partial={...structuredClone(live),records:records.filter(record=>record.source!=='calendar'),statuses:live.statuses.map(status=>['tasks','calendar'].includes(status.source)?{...status,state:'error',count:250,message:`${status.source}: DAV fallback safety limit reached.`}:status)}
    await installFixture(context,false,{initialState:restored,refreshedState:partial,deferRefresh:true})
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(baseUrl)
    await page.waitForFunction(()=>window.__calls.includes('refresh'))
    await page.locator('.source-load-panel').waitFor()
    assert.equal(await page.locator('.source-load-panel h2').innerText(),'Checking your Nextcloud sources…')
    assert.equal((await page.locator('.source-summary strong').textContent()).trim(),'Refreshing sources…')
    assert.equal(await page.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).count(),0)
    assert.equal(await page.locator('.sync-button').getAttribute('data-sync-state'),'syncing')
    await screenshot(page,'fixture-cold-refresh-384')
    await page.evaluate(()=>window.__releaseRefresh())
    const warning=page.locator('.source-refresh-warning')
    await warning.waitFor()
    assert.equal(await warning.innerText(),'Tasks could not fully refresh. 1 loaded/retained item may be incomplete or out of date. Calendar could not fully refresh. No items from this source are currently available.\nDetails')
    assert.equal(await page.getByText('Available cached items remain visible.',{exact:false}).count(),0)
    assert.equal(await page.getByText('Showing cached data',{exact:true}).count(),0)
    assert.equal(await page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).isEnabled(),true)
    await screenshot(page,'fixture-partial-refresh-384')
    await warning.getByRole('button',{name:'Details',exact:true}).click()
    assert.equal(await page.getByText('tasks: DAV fallback safety limit reached.',{exact:true}).count(),1)
    assert.equal(await page.getByText('calendar: DAV fallback safety limit reached.',{exact:true}).count(),1)
    await page.getByRole('button',{name:'Close dialog',exact:true}).click()
    await page.getByRole('tab',{name:'List',exact:true}).click()
    await page.locator('.list-table-row').filter({hasText:'Research notes'}).click()
    await page.locator('.inspector').waitFor()
    assert.equal(await page.locator('.native-readonly-hint').innerText(),'Source editing is not available on this device yet. Open the item in Nextcloud to make changes.')
    assert.equal(await page.locator('.description-section').getByRole('button',{name:'Edit',exact:true}).count(),0)
    assert.equal((await page.evaluate(()=>window.__calls)).includes('unsupported-native-write'),false)
    await context.close()
  }
  {
    const context=await browser.newContext({viewport:viewports[0]})
    const empty={...structuredClone(live),records:[],collections:[],connection:{...live.connection,connected:false},statuses:live.statuses.map(status=>({...status,state:'error',count:250,message:'Request failed before any source items loaded.'}))}
    await installFixture(context,false,{initialState:empty})
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(baseUrl)
    await page.locator('.source-refresh-warning').waitFor()
    assert.equal((await page.locator('.source-refresh-warning').innerText()).includes('cached'),false)
    assert.equal((await page.locator('.source-refresh-warning').innerText()).match(/No items from this source are currently available\./g).length,5)
    assert.equal(await page.locator('.source-load-panel h2').innerText(),'No source items are available yet.')
    assert.equal(await page.locator('.source-load-panel').getByRole('button',{name:'Refresh sources',exact:true}).isEnabled(),true)
    assert.equal((await page.locator('.source-summary strong').textContent()).trim(),'Source refresh incomplete')
    assert.equal(await page.getByRole('button',{name:'Sign in with Nextcloud',exact:true}).count(),0)
    assert.equal(await page.locator('.sync-button').getAttribute('data-sync-state'),'stale')
    const initialCalls=await page.evaluate(()=>window.__calls.filter(call=>call==='refresh').length)
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(count=>window.__calls.filter(call=>call==='refresh').length>count,initialCalls)
    await screenshot(page,'fixture-empty-refresh-384')
    await context.close()
  }
  for(const blocked of ['missing','reconnect','recovery','offline']){
    const context=await browser.newContext({viewport:viewports[0]})
    const initialState=blocked==='missing'?disconnected:{...structuredClone(live),connection:{...live.connection,connected:false,...(blocked==='reconnect'?{reconnectRequired:true}:blocked==='recovery'?{recoveryOnly:true}:{})}}
    if(blocked==='offline')await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{get:()=>false}))
    await installFixture(context,false,{initialState})
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(baseUrl)
    await page.getByRole('tab',{name:'List',exact:true}).waitFor()
    await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('nextspace:resume'))})
    assert.equal((await page.evaluate(()=>window.__calls)).includes('refresh'),false,`${blocked} must not request source refresh`)
    assert.equal(await page.getByRole('button',{name:'Refresh Nextcloud sources',exact:true}).isDisabled(),true)
    assert.equal((await page.locator('.source-summary strong').textContent()).trim(),blocked==='missing'?'Not connected':blocked==='offline'?'Offline · saved items':'Sign-in required')
    await context.close()
  }
  assert.deepEqual(errors,[])
  console.log('Shared Android planner: '+(refreshOnly?'': '3 real disconnected layouts; 2 isolated login/five-view/detail/subscription flows; native Files option; account-separated IndexedDB; aligned phone date scrolling; ')+'restored-account background refresh; partial/empty feedback and diagnostics; Notes capability explanation; missing/reconnect/recovery/offline request guards passed. No live writes or builds.')
}finally{await browser.close()}
