import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {readFile} from 'node:fs/promises'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createEmptyState} from '@nextspace/core/planner.mjs'
const {createRenderer,nextTick,reactive,h,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual App switches page filters independently, scopes dependency submits and guards Space deletion',async()=>{
  const originals=new Map(),storage=new Map();let app,confirm=false,saves=0
  const noop=()=>{},set=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true})}
  set('window',{innerWidth:900,matchMedia:()=>({matches:false,addEventListener:noop,removeEventListener:noop}),addEventListener:noop,removeEventListener:noop,confirm:()=>confirm})
  set('document',{hidden:false,visibilityState:'visible',addEventListener:noop,removeEventListener:noop,querySelector:()=>null,getElementById:()=>null,documentElement:{dataset:{},style:{setProperty:noop,removeProperty:noop}}})
  set('navigator',{onLine:true});set('localStorage',{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)});set('getComputedStyle',()=>({getPropertyValue:()=>'#171717'}));set('ResizeObserver',class{observe(){}disconnect(){}});set('HTMLElement',class{});set('requestAnimationFrame',()=>1);set('cancelAnimationFrame',noop)
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const host=createEmptyState();host.connection={connected:true,serverUrl:'https://cloud.example.test',username:'fixture'}
    host.workspace.spaces=[{id:'work',name:'Work',color:'#123456',collectionIds:['inside']}]
    host.workspace.categories=[{id:'group',name:'Group',spaceId:'work',color:'#123456',collectionIds:['inside']}]
    host.workspace.projects=[{id:'project',name:'Project',spaceId:'work',collectionIds:['inside'],recordIds:[]}]
    host.workspace.planner.arrangements={work:{timelineRows:['inside-task']},group:{timelineRows:['inside-task']},project:{timelineRows:['inside-task']},all:{timelineRows:['outside-task']}}
    host.records=[{id:'inside-task',kind:'task',source:'tasks',collectionId:'inside',title:'Inside'},{id:'outside-task',kind:'task',source:'tasks',collectionId:'outside',title:'Outside'}]
    const api={getState:async()=>structuredClone(host),resumeSync:async()=>{},saveWorkspace:async({workspace})=>{saves++;host.workspace=structuredClone(workspace);host.revision++;return structuredClone(host)}}
    const {default:App}=await server.ssrLoadModule('/src/App.vue')
    const renderer=createRenderer({createElement:type=>({type,children:[]}),createText:text=>({text}),createComment:text=>({text}),setText:noop,setElementText:noop,parentNode:()=>null,nextSibling:()=>null,patchProp:noop,insert:noop,remove:noop})
    app=renderer.createApp({...App,render:()=>null,ssrRender:undefined},{api});app.provide(ssrContextKey,{modules:new Set()})
    const s=app.mount({}).$.setupState;await new Promise(resolve=>setTimeout(resolve,0));await nextTick()
    s.query='overview query';s.attention='today';s.statusIds=['selected'];s.toggleSettingList('hiddenCollectionIds','outside');s.setShowDone(true);await nextTick()
    s.setView('board');await nextTick();assert.equal(s.query,'');assert.equal(s.attention,'all');assert.equal(s.showDone,false);assert.deepEqual(s.settings.hiddenCollectionIds,[])
    s.query='board query';s.setAssignment('all');s.setShowDone(true);await nextTick();s.resetFilters();await nextTick();assert.equal(s.showDone,true,'reset retains this page completion');assert.equal(s.query,'')
    s.setView('overview');await nextTick();assert.equal(s.query,'overview query');assert.equal(s.attention,'today');assert.deepEqual(s.settings.hiddenCollectionIds,['outside']);assert.deepEqual(s.statusIds,['selected']);assert.equal(s.showDone,true)
    s.setView('board');await nextTick();assert.equal(s.query,'');assert.equal(s.showDone,true);assert.equal(saves,0,'page changes never save cloud metadata')
    const saved=[...storage.values()].map(value=>{try{return JSON.parse(value)}catch{return null}}).find(value=>value?.version===2);assert.ok(saved.scopes.all.pages.board);assert.equal(saved.scopes.all.pages.overview.query,'overview query')
    s.changeScope('project');s.panelRecordId='inside-task';s.modal='relation';s.relationMode='dependency';await s.addRelation({fromId:'inside-task',toId:'outside-task',type:'depends_on'});assert.match(s.error,/Space/);assert.equal(s.state.workspace.relations.length,0)
    s.modal='scope';s.scopeDraft={...s.scopeDraft,kind:'space',id:'work'};s.spaceEditorDirty=true;await s.requestDeleteSpace('work');assert.equal(s.modal,'scope','refused discard leaves editor')
    s.selectedId='inside-task';s.editingNote=true;s.noteDraft={id:'inside-task',title:'Inside',content:'Unsaved description',category:'',etag:undefined};s.noteBaseline='previous draft'
    confirm=true;await s.requestDeleteSpace('work');assert.equal(s.modal,'delete');assert.equal(s.state.workspace.spaces.length,1,'confirmation does not mutate')
    await s.deleteScope();assert.equal(s.state.workspace.spaces.length,0);assert.equal(s.state.workspace.categories.length,0);assert.equal(s.state.workspace.projects.length,0);assert.deepEqual(Object.keys(s.state.workspace.planner.arrangements),['all']);assert.equal(s.settings.scopeId,'all');assert.equal(s.state.records.length,2);assert.equal(s.selectedId,'inside-task');assert.equal(s.editingNote,true);assert.equal(s.noteDraft.content,'Unsaved description','native editor draft is retained when its view is removed')
    const template=await readFile(new URL('../packages/ui/src/App.vue',import.meta.url),'utf8');assert.match(template,/@click="requestDeleteSpace\(space.id\)"[^>]*><Trash2[^>]*\/>Delete Space/)
    const {default:Picker}=await server.ssrLoadModule('/src/RelationPicker.vue'),Bare={...Picker,render:()=>null,ssrRender:undefined},props=reactive({record:host.records[0],records:host.records,relations:[],mode:'dependency',candidateIds:['outside-task']}),added=[];let picker
    const pickerApp=renderer.createApp({setup:()=>()=>h(Bare,{...props,onAdd:value=>added.push(value),ref:value=>{picker=value}})});pickerApp.provide(ssrContextKey,{modules:new Set()});pickerApp.mount({});await nextTick()
    try{const p=picker.$.setupState;p.selectedId='outside-task';assert.equal(p.chosenEligibility.ok,true);props.candidateIds=[];await nextTick();assert.equal(p.results.length,0);assert.equal(p.chosenEligibility.ok,false);p.submit();assert.deepEqual(added,[])}finally{pickerApp.unmount()}
  }finally{app?.unmount();await server.close();for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}}
})
