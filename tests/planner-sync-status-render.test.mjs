import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const require=createRequire(new URL('../packages/ui/package.json',import.meta.url))
const {createSSRApp,h}=require('vue'),{renderToString}=require('vue/server-renderer')

test('actual planner source row shows independent status, folder, failure and retry without a fabricated item count',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const {default:Status}=await server.ssrLoadModule('/src/PlannerSyncStatus.vue')
    const render=props=>renderToString(createSSRApp({render:()=>h(Status,{connection:{connected:true},online:true,retryDisabled:false,...props})}))
    const failed=await render({storage:{syncStatus:'error',errorCode:'TIMEOUT',errorStage:'planner-read',message:'Planner request timed out.'}})
    assert.match(failed,/Planner data/);assert.match(failed,/Workspace\/Nextspace/);assert.match(failed,/Reading planner files · TIMEOUT/)
    assert.match(failed,/Last successful sync: Not yet/);assert.match(failed,/Sync planner/);assert.doesNotMatch(failed,/\d+ items/)
    const offline=await render({online:false,storage:{syncStatus:'synced'}})
    assert.match(offline,/>Offline</);assert.match(offline,/button[^>]+disabled/)
    const running=await render({syncing:true,storage:{syncStatus:'pending'}})
    assert.match(running,/>Syncing</);assert.match(running,/button[^>]+disabled/)
  }finally{await server.close()}
})
