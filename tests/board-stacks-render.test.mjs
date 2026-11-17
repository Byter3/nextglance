import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const require=createRequire(new URL('../packages/ui/package.json',import.meta.url))
const {createSSRApp,h}=require('vue'),{renderToString}=require('vue/server-renderer')

test('actual Board renders directional linked tasks once, expands selection and respects filtered input',async()=>{
  // Targeted component compilation/render only: no HTTP listener, browser,
  // full UI bundle, account, server connection or native mutation.
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const {default:Board}=await server.ssrLoadModule('/src/PlannerBoard.vue')
    const records=[{id:'deck',kind:'card',source:'deck',collectionId:'board',title:'Primary assignment',stackId:'todo',status:'To do'},
      {id:'input',kind:'task',source:'tasks',collectionId:'tasks',title:'Finished preparation',completed:true,status:'COMPLETED'},
      {id:'output',kind:'task',source:'tasks',collectionId:'tasks',title:'After delivery',status:'NEEDS-ACTION'}]
    const props={records,collections:[{id:'board',source:'deck',title:'Board',stacks:[{id:'todo',title:'To do'},{id:'empty',title:'Empty status'}]},{id:'tasks',source:'tasks',title:'Tasks'}],relations:[{id:'a',type:'depends_on',fromId:'deck',toId:'input'},{id:'b',type:'depends_on',fromId:'output',toId:'deck'}],workflow:{},scopeId:'all',groupTasks:true,selectedId:'deck',colorFor:()=>'#123456',sourceColorFor:()=>'#abcdef'}
    const render=overrides=>renderToString(createSSRApp({render:()=>h(Board,{...props,...overrides})}))
    const html=await render({})
    for(const title of ['Primary assignment','Finished preparation','After delivery'])assert.equal((html.match(new RegExp('>'+title+'<','g'))||[]).length,1,title+' must render once')
    assert.ok(html.indexOf('data-task-id="input"')<html.indexOf('data-record-id="deck"'))
    assert.ok(html.indexOf('data-task-id="output"')>html.indexOf('data-record-id="deck"'))
    const inputButton=html.match(/<button[^>]*data-task-id="input"[^>]*>/)?.[0]||''
    assert.match(inputButton,/class="[^"]*\bcompleted\b[^"]*"/)
    assert.match(inputButton,/class="[^"]*\bboard-task-layer\b[^"]*"/)
    assert.match(inputButton,/class="[^"]*\blinked\b[^"]*"/)
    assert.doesNotMatch(inputButton,/class="[^"]*\bprimary\b[^"]*"/)
    const parentCard=html.match(/<article[^>]*data-record-id="deck"[^>]*>/)?.[0]||''
    assert.match(parentCard,/class="[^"]*\bprimary\b[^"]*"/)
    assert.doesNotMatch(parentCard,/class="[^"]*\blinked\b[^"]*"/)
    assert.doesNotMatch(html,/board-order-handle|board-order-controls|grip-vertical/)
    assert.match(html,/aria-keyshortcuts="ArrowUp ArrowDown Home End Alt\+ArrowUp Alt\+ArrowDown"/)
    assert.match(html,/board-task-layers incoming expanded/)
    assert.match(html,/board-task-layers outgoing expanded/)
    assert.match(html,/Empty status/)
    const filtered=await render({records:records.filter(record=>!record.completed)})
    assert.doesNotMatch(filtered,/Finished preparation/)
    const ungrouped=await render({groupTasks:false})
    assert.doesNotMatch(ungrouped,/data-task-id=/)
    assert.match(ungrouped,/data-record-id="input"/)
    const childSelected=await render({selectedId:'input'})
    const selectedTask=childSelected.match(/<button[^>]*data-task-id="input"[^>]*>/)?.[0]||''
    assert.match(selectedTask,/class="[^"]*\bprimary\b[^"]*"/)
    assert.doesNotMatch(selectedTask,/class="[^"]*\blinked\b[^"]*"/)
  }finally{await server.close()}
})
