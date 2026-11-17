import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {readFile} from 'node:fs/promises'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {removeSourceGroup} from '@nextspace/core/space-organization.mjs'
import {splitWorkspace,assembleWorkspace} from '@nextspace/nextcloud-client/planner-folder.mjs'
const {createRenderer,nextTick,reactive,h,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('actual Overview editor protects drafts, persists independent groups and keeps Space changes',async()=>{
  const originals=new Map(),apps=[],storage=new Map();let saves=0,uuidCalls=0,confirm=false,files
  const noop=()=>{},set=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true})}
  set('window',{innerWidth:900,matchMedia:()=>({matches:false,addEventListener:noop,removeEventListener:noop}),addEventListener:noop,removeEventListener:noop,confirm:()=>confirm})
  set('document',{hidden:false,visibilityState:'visible',addEventListener:noop,removeEventListener:noop,querySelector:()=>null,getElementById:()=>null,documentElement:{dataset:{},style:{setProperty:noop,removeProperty:noop}}})
  set('navigator',{onLine:true});set('localStorage',{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)});set('getComputedStyle',()=>({getPropertyValue:()=>'#171717'}));set('ResizeObserver',class{observe(){}disconnect(){}});set('HTMLElement',class{});set('requestAnimationFrame',()=>1);set('cancelAnimationFrame',noop)
  set('crypto',{randomUUID:()=>`accepted-group-${++uuidCalls}`})
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  const renderer=createRenderer({createElement:type=>({type,children:[]}),createText:text=>({text}),createComment:text=>({text}),setText:noop,setElementText:noop,parentNode:()=>null,nextSibling:()=>null,patchProp:noop,insert:noop,remove:noop})
  async function mount(name,props,events={}){const {default:Component}=await server.ssrLoadModule(`/src/${name}.vue`),Bare={...Component,render:()=>null,ssrRender:undefined};let child;const app=renderer.createApp({setup:()=>()=>h(Bare,{...props,...events,ref:value=>child=value})});app.provide(ssrContextKey,{modules:new Set()});app.mount({});apps.push(app);await nextTick();return child.$.setupState}
  try{
    const host=createEmptyState();host.connection={connected:true,serverUrl:'https://cloud.example.test',username:'fixture'};host.statuses=['tasks','calendar'].map(source=>({source,state:'connected',count:1}))
    host.collections=[{id:'tasks',source:'tasks',title:'Tasks'},{id:'calendar',source:'calendar',title:'Calendar'},{id:'outside',source:'tasks',title:'Other tasks'}]
    host.records=[{id:'task',source:'tasks',kind:'task',title:'Review',collectionId:'tasks',tags:['Review']},{id:'other',source:'tasks',kind:'task',title:'Other',collectionId:'outside'}]
    host.workspace.spaces=[{id:'work',name:'Work',color:'#0082c9',collectionIds:['tasks']}]
    host.workspace.categories=[{id:'space-group',spaceId:'work',name:'Projects',color:'#0082c9',collectionIds:['tasks']}]
    const api={getState:async()=>structuredClone(host),resumeSync:async()=>{},saveWorkspace:async workspace=>{validateWorkspace(workspace);files=splitWorkspace(workspace);host.workspace=assembleWorkspace(files);host.revision++;saves++;return structuredClone(host)}}
    const app=await mount('App',{api});await new Promise(resolve=>setTimeout(resolve,0));await nextTick()
    await app.openCategories('all');assert.equal(app.modal,'categories');assert.equal(app.categorySpaceId,'all');assert.equal(saves,0)
    const manager=await mount('CategoryManager',{workspace:app.state.workspace,collections:host.collections,records:host.records,spaceId:'all',locked:false})
    const props=reactive({workspace:manager.draft,collections:host.collections,records:host.records,spaceId:'all',locked:false})
    const group=await mount('SourceGroupsEditor',props,{'onUpdate:workspace':value=>{manager.draft=value;props.workspace=value}})
    const before=uuidCalls;group.customGroup();await nextTick();assert.equal(uuidCalls,before);const temporary=manager.draft.categories.at(-1).id;assert.match(temporary,/^\$draft-group:/)
    group.updateGroup(temporary,'name','Review work');await nextTick();group.updateTags(temporary,['Review']);await nextTick();group.toggleTagSource(temporary,'tasks');await nextTick()
    assert.equal(saves,0);assert.equal(host.workspace.categories.length,1,'unsaved editor is isolated')
    let accepted;const manager2=await mount('CategoryManager',{workspace:manager.draft,collections:host.collections,records:host.records,spaceId:'all',locked:false},{onSave:value=>accepted=value});manager2.save();assert.equal(uuidCalls,before+1);assert.ok(accepted.categories.at(-1).id.startsWith('accepted-group-'))
    await app.saveCategories(accepted);assert.equal(app.saveError,'');assert.equal(app.error,'');assert.equal(saves,1);assert.equal(app.modal,null)
    const overviewId=accepted.categories.at(-1).id;assert.equal(assembleWorkspace(files).categories.find(g=>g.id===overviewId).spaceId,'all');assert.deepEqual(host.workspace.spaces[0].collectionIds,['tasks'])
    app.changeScope(overviewId);assert.equal(app.currentSpace,undefined);assert.equal(app.captureDestination('event'),'');assert.deepEqual(app.dependencyCandidates(app.state.workspace,app.state.records,app.settings.scopeId).map(r=>r.id),['task','other'])
    app.openScope('project');assert.equal(app.modal,null,'Overview group never defaults a new project into the first Space')
    await app.openCategories('all');const old=JSON.parse(JSON.stringify(app.state.workspace));old.categories.find(g=>g.id===overviewId).name='Local name';app.state.workspace.categories.find(g=>g.id===overviewId).name='Remote name';app.categoriesDirty=true;await app.saveCategories(old);assert.match(app.error,/overlap/);assert.equal(saves,1);assert.equal(app.modal,'categories');assert.equal(app.state.workspace.categories.find(g=>g.id===overviewId).name,'Remote name')
    await app.openCategories('all');assert.equal(app.categoriesDirty,true,'refusing discard keeps the original editor');confirm=true;app.closeModal();await app.openCategories('all');const updated=JSON.parse(JSON.stringify(app.state.workspace));updated.categories.find(g=>g.id===overviewId).name='Accepted rename';app.state.workspace.spaces[0].name='Remote Space';await app.saveCategories(updated);assert.equal(app.saveError,'');assert.equal(app.state.workspace.spaces[0].name,'Remote Space');assert.equal(app.state.workspace.categories.find(g=>g.id===overviewId).name,'Accepted rename')
    app.state.workspace.planner.arrangements={all:{timelineGroups:[`category:${overviewId}`]},[overviewId]:{timelineRows:['task']}};await app.openCategories('all');await app.saveCategories(removeSourceGroup(JSON.parse(JSON.stringify(app.state.workspace)),overviewId));assert.equal(app.state.workspace.planner.arrangements[overviewId],undefined);assert.ok(app.state.workspace.planner.arrangements.all)
    await app.openCategories('all');const restore=JSON.parse(JSON.stringify(app.state.workspace));restore.categories.push({id:'overview-kept',spaceId:'all',name:'Overview kept',color:'#0082c9',collectionIds:['outside']});await app.saveCategories(restore);await app.requestDeleteSpace('work');await app.deleteScope();assert.equal(app.saveError,'');assert.deepEqual(app.state.workspace.categories.map(g=>g.id),['overview-kept']);assert.deepEqual(assembleWorkspace(files).categories.map(g=>g.id),['overview-kept'])
    const source=await readFile(new URL('../packages/ui/src/App.vue',import.meta.url),'utf8');const menu=source.match(/<div v-if="navActions\?\.kind==='overview'"[\s\S]*?<\/div>/)[0];assert.match(menu,/Group sources/);assert.doesNotMatch(menu,/Add project|Delete Space/)
  }finally{apps.reverse().forEach(app=>app.unmount());await server.close();for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}}
})
