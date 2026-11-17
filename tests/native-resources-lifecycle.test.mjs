import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const {createRenderer,h,reactive,ref,nextTick,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual resources panel clears a disconnected fetch and ignores late results across reconnect/disposal',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  let app
  try{
    const {default:Panel}=await server.ssrLoadModule('/src/NativeResourcesPanel.vue')
    const component={...Panel,render:()=>null,ssrRender:undefined},child=ref(null),fileRequests=[],relatedRequests=[]
    const deferred=queue=>new Promise((resolve,reject)=>queue.push({resolve,reject}))
    const api={readDeckAttachments:()=>deferred(fileRequests),readRelatedResources:()=>deferred(relatedRequests)}
    const props=reactive({record:{id:'card-one',kind:'card',source:'deck',attachmentFileIds:[]},records:[],connected:true,canWrite:false})
    let changed=0
    const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
    app=renderer.createApp({setup:()=>()=>h(component,{...props,api,ref:child,onChanged:()=>changed++})})
    app.provide(ssrContextKey,{modules:new Set()});app.mount({})
    const state=child.value.$.setupState
    const settle=async()=>{await Promise.resolve();await Promise.resolve();await nextTick()}
    assert.equal(state.loading,true);assert.equal(fileRequests.length,1)

    props.connected=false;await nextTick()
    assert.equal(state.loading,false,'disconnect must remove the active spinner immediately')
    fileRequests[0].reject(new Error('Obsolete request failure'))
    relatedRequests[0].resolve({available:true,resources:[{providerId:'files',itemId:'old',title:'Obsolete',url:'https://cloud.example.test/old'}]})
    await settle()
    assert.equal(state.loading,false);assert.equal(state.error,'');assert.deepEqual(state.related,[]);assert.equal(changed,0)

    props.connected=true;await nextTick();assert.equal(state.loading,true);assert.equal(fileRequests.length,2)
    props.connected=false;await nextTick();props.connected=true;await nextTick()
    assert.equal(fileRequests.length,3)
    fileRequests[1].resolve({attachments:[{id:1,fileId:1,name:'Obsolete file'}]})
    relatedRequests[1].resolve({available:false,resources:[]});await settle()
    assert.equal(state.loading,true,'an obsolete result must not end the newer fetch')
    assert.deepEqual(state.attachments,[])
    fileRequests[2].resolve({attachments:[{id:2,fileId:2,name:'Current file'}]})
    relatedRequests[2].resolve({available:true,resources:[]});await settle()
    assert.equal(state.loading,false);assert.equal(state.attachments[0].name,'Current file');assert.equal(changed,1)

    const finalRead=child.value.reload();app.unmount();app=undefined
    fileRequests[3].resolve({attachments:[{id:3,fileId:3,name:'Disposed file'}]})
    relatedRequests[3].resolve({available:false,resources:[]});await finalRead
    assert.equal(state.attachments[0].name,'Current file');assert.equal(changed,1)
  }finally{app?.unmount();await server.close()}
})
