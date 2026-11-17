import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vuePlugin from '@vitejs/plugin-vue'
const require=createRequire(new URL('../packages/ui/package.json',import.meta.url)),Vue=require('vue'),compiler=require('vue/compiler-sfc')

test('actual creation render retains pending attendee text through Event -> Task -> Event',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vuePlugin()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  let app
  const originalFrame=globalThis.requestAnimationFrame,originalCancel=globalThis.cancelAnimationFrame,originalDocument=globalThis.document,originalDocumentType=globalThis.Document,originalShadowRoot=globalThis.ShadowRoot
  globalThis.Document=class{};globalThis.ShadowRoot=class{};globalThis.document={activeElement:null};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{}
  const noop=()=>{},node=tag=>({tagName:tag.toUpperCase(),children:[],style:{},value:'',getRootNode:()=>globalThis.document,addEventListener:noop,removeEventListener:noop,setAttribute:noop,removeAttribute:noop,get options(){return this.children.filter(item=>item.tagName==='OPTION')}})
  const renderer=Vue.createRenderer({createElement:node,createText:text=>({text}),createComment:text=>({text}),setText:(n,t)=>n.text=t,setElementText:(n,t)=>n.text=t,parentNode:n=>n.parent,nextSibling:()=>null,patchProp:(n,k,_old,v)=>n[k]=v,insert:(n,parent,anchor)=>{n.parent=parent;const i=parent.children.indexOf(anchor);if(i<0)parent.children.push(n);else parent.children.splice(i,0,n)},remove:n=>{if(n.parent)n.parent.children=n.parent.children.filter(child=>child!==n)}})
  async function component(name){const source=await readFile(new URL(`../packages/ui/src/${name}.vue`,import.meta.url),'utf8'),descriptor=compiler.parse(source).descriptor,bindings=compiler.compileScript(descriptor,{id:name}).bindings,{default:loaded}=await server.ssrLoadModule(`/src/${name}.vue`);return {...loaded,ssrRender:undefined,render:Vue.compile(descriptor.template.content,{bindingMetadata:bindings,prefixIdentifiers:true})}}
  try{
    const Attendees=await component('EventAttendees'),Create=await component('CreateItemForm'),originalSetup=Create.setup
    Create.setup=(props,context)=>{const setup=originalSetup(props,context);setup.EventAttendees=Attendees;setup.EventReminders={render:()=>null};return setup}
    app=renderer.createApp(Create,{collections:[{id:'calendar',title:'Calendar',source:'calendar',calendarScheduling:{canInvite:true,organizer:{uri:'mailto:owner@example.test'}}},{id:'tasks',title:'Tasks',source:'tasks'}],initialType:'event',availableTypes:['event','task'],destinations:{event:'calendar',task:'tasks'}});app.provide(Vue.ssrContextKey,{modules:new Set()});const vm=app.mount(node('root')),s=vm.$.setupState
    function attendee(vnode){if(!vnode)return;if(vnode.component?.type===Attendees)return vnode.component;const own=attendee(vnode.component?.subTree);if(own)return own;for(const child of Array.isArray(vnode.children)?vnode.children:[]){const found=attendee(child);if(found)return found}}
    const first=attendee(vm.$.subTree);assert.ok(first);first.setupState.email='new.guest@example.test';first.setupState.name='New guest';await Vue.nextTick();assert.equal(s.attendeePending,true)
    s.type='task';await Vue.nextTick();assert.equal(attendee(vm.$.subTree),first);s.title='Task while attendee pending';s.submit();assert.equal(s.validation,'','hidden event attendee does not block task creation');s.type='event';await Vue.nextTick();assert.equal(attendee(vm.$.subTree),first);assert.equal(first.setupState.email,'new.guest@example.test');assert.equal(first.setupState.name,'New guest');assert.equal(s.attendeePending,true)
    first.setupState.add();await Vue.nextTick();assert.deepEqual([...s.attendees],[{email:'new.guest@example.test',name:'New guest'}]);assert.equal(s.attendeePending,false)
  }finally{try{app?.unmount()}finally{await server.close();globalThis.requestAnimationFrame=originalFrame;globalThis.cancelAnimationFrame=originalCancel;globalThis.document=originalDocument;globalThis.Document=originalDocumentType;globalThis.ShadowRoot=originalShadowRoot}}
})
