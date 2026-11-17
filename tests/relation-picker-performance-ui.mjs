/** Actual shared picker, large fictional graph, bounded DOM and live mutation checks. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import {chromium} from 'playwright'
const fsUrl=path=>'/@fs/'+fileURLToPath(new URL(path,import.meta.url)).replaceAll('\\','/')
const server=await createServer({configFile:fileURLToPath(new URL('../win/vite.config.ts',import.meta.url)),server:{host:'127.0.0.1',port:0},logLevel:'error'})
let browser
try{
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
  browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:600,height:900},hasTouch:true}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/picker-perf',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><link rel="stylesheet" href="${fsUrl('../packages/ui/src/style.css')}"><main id="app" style="padding:8px"></main><script type="module">
  import {createApp,h,reactive,nextTick} from '/node_modules/.vite/deps/vue.js';import Picker from '${fsUrl('../packages/ui/src/RelationPicker.vue')}';
  const record={id:'card',kind:'card',source:'deck',title:'Product release'},records=[record,...Array.from({length:4000},(_,i)=>({id:'task-'+i,kind:'task',source:'tasks',title:'Task '+String(i).padStart(4,'0'),collectionTitle:'Project tasks'}))];
  const state=window.fixture=reactive({records,relations:Array.from({length:3999},(_,i)=>({id:'r'+i,type:'depends_on',fromId:'task-'+i,toId:'task-'+(i+1)}))});
  window.settle=()=>nextTick().then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));window.intents=[];
  const start=performance.now();createApp({setup(){return()=>h(Picker,{record,records:state.records,relations:state.relations,mode:'dependency',onAdd:intent=>window.intents.push(intent)})}}).mount('#app');await window.settle();window.mountMs=performance.now()-start;
  </script>`}))
  await page.goto(origin+'/picker-perf');await page.waitForFunction(()=>window.mountMs!==undefined)
  const initial=await page.evaluate(()=>({mountMs:window.mountMs,rows:document.querySelectorAll('.relation-option').length,totalText:document.querySelector('.relation-result-count').textContent}))
  assert.ok(initial.rows<=18);assert.match(initial.totalText,/4000|4,000/)
  const search=page.getByPlaceholder('Search tasks and cards…')
  await search.fill('Task 3999');await page.getByText('Task 3999',{exact:true}).click();await page.getByRole('button',{name:'Add dependency',exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>window.intents),[{fromId:'card',toId:'task-3999',type:'depends_on'}])
  await page.evaluate(()=>window.fixture.relations.push({id:'new',type:'depends_on',fromId:'task-3999',toId:'card'}))
  await page.waitForFunction(()=>document.querySelector('.relation-unavailable-reason')?.textContent.includes('cycle'))
  assert.equal(await page.getByRole('button',{name:'Add dependency',exact:true}).isDisabled(),true)
  await search.fill('');await page.locator('.relation-results').click({position:{x:8,y:8}});await page.keyboard.press('End')
  assert.ok(await page.locator('.relation-option').count()<=18)
  await page.evaluate(()=>window.fixture.records.push({id:'fresh',kind:'task',source:'tasks',title:'Newly synced work'}));await search.fill('Newly synced work');await page.getByText('Newly synced work',{exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'Add dependency',exact:true}).isEnabled(),true)
  assert.deepEqual(errors,[])
  await mkdir('.runtime/nov17-ui-audit',{recursive:true});await writeFile('.runtime/nov17-ui-audit/picker-optimized.json',JSON.stringify(initial,null,2));console.log(JSON.stringify(initial))
}finally{await browser?.close();await server.close()}
