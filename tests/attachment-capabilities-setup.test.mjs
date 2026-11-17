import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const {createRenderer,nextTick,reactive,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual attachment dialog separates note, file browse, upload and planner reference capabilities',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  let app
  try{
    const {default:Picker}=await server.ssrLoadModule('/src/NoteLinkPicker.vue')
    let uploads=0
    const props=reactive({record:{id:'card',kind:'card',source:'deck',title:'Review'},records:[{id:'note',kind:'note',title:'Brief'},{id:'page',kind:'page',title:'Shared page'}],relations:[],canAttachNotes:false,canAttachFiles:false,canUploadFile:true,canBrowseFiles:false,api:{uploadDeckAttachment:async()=>{uploads++;return {attachments:[],cancelled:true}}}})
    const emitted=[];let setup
    const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
    app=renderer.createApp({setup(){setup=Picker.setup(props,{expose(){},emit:(...args)=>emitted.push(args)});return()=>null}});app.provide(ssrContextKey,{});app.mount({});await nextTick()
    assert.equal(setup.canLinkNote('note'),false);assert.equal(setup.canLinkNote('page'),true)
    setup.toggleNote('note');assert.deepEqual(setup.selectedIds.value,[])
    assert.equal(setup.filesAvailable.value,true,'upload-only host still exposes Other files')
    await setup.upload();assert.equal(uploads,1);assert.equal(setup.uploadMessage.value,'','cancelled picker does not claim an upload')
    assert.equal(emitted.some(([event])=>event==='changed'),false)
    props.canUploadFile=false;await setup.upload();assert.equal(uploads,1)
    props.canAttachNotes=true;setup.toggleNote('note');assert.deepEqual(setup.selectedIds.value,['note'])
    props.canAttachNotes=false;await nextTick();assert.deepEqual(setup.selectedValid.value,[],'revocation removes pending native eligibility')
    props.record={id:'task',kind:'task',source:'tasks',title:'Prepare review'};await nextTick();assert.equal(setup.canLinkNote('note'),true,'non-Deck planner references remain supported')
  }finally{app?.unmount();await server.close()}
})
