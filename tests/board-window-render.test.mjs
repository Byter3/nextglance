import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const require=createRequire(new URL('../packages/ui/package.json',import.meta.url)),{createSSRApp,h}=require('vue'),{renderToString}=require('vue/server-renderer')

test('actual Board mounts bounded complete stacks while retaining selected children and full counts',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const {default:Board}=await server.ssrLoadModule('/src/PlannerBoard.vue')
    const records=Array.from({length:2000},(_,i)=>({id:`card-${i}`,kind:'card',source:'deck',collectionId:'board',title:`Card ${String(i).padStart(4,'0')}`,stackId:'todo',status:'To do',body:'- [ ] Check fixture'}))
    records.push({id:'child',kind:'task',source:'tasks',collectionId:'tasks',title:'Linked prerequisite',status:'NEEDS-ACTION'})
    const props={records,collections:[{id:'board',source:'deck',title:'Board',stacks:[{id:'todo',title:'To do'},{id:'empty',title:'Empty'}]}],relations:[{id:'link',type:'depends_on',fromId:'card-1999',toId:'child'}],workflow:{},scopeId:'all',groupTasks:true,selectedId:'child',colorFor:()=>'#123456'}
    const start=performance.now(),html=await renderToString(createSSRApp({render:()=>h(Board,props)})),elapsed=performance.now()-start
    assert.equal((html.match(/data-record-id=/g)||[]).length,7,'six initial stacks plus selected child’s parent')
    assert.equal((html.match(/data-task-id="child"/g)||[]).length,1)
    assert.match(html,/height:375992px/);assert.match(html,/>2000<\/span>/);assert.match(html,/>Empty<\/h3>/)
    assert.doesNotMatch(html,/data-record-id="card-1000"/)
    console.log(`Board fixture: 2,000 cards -> 7 mounted complete stacks; ${Buffer.byteLength(html)} HTML bytes; ${elapsed.toFixed(1)} ms SSR (not device DOM/GPU timing).`)
  }finally{await server.close()}
})
