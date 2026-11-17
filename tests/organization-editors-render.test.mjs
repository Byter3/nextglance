import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {defaultStatusMapping,statusSourceKey} from '@nextspace/core/status-mapping.mjs'
const require=createRequire(new URL('../packages/ui/package.json',import.meta.url))
const {createSSRApp,h}=require('vue'),{renderToString}=require('vue/server-renderer')
test('actual organization editors show native tag choices, match counts and Space mapping inheritance',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const workspace=createPlannerWorkspace()
    workspace.spaces=[{id:'work',name:'Work',color:'#123456',collectionIds:['tasks','board']}]
    workspace.categories=[{id:'tagged',spaceId:'work',name:'Tagged group',color:'#123456',collectionIds:['tasks'],tagNames:['Alpha']},{id:'whole',spaceId:'work',name:'Whole group',color:'#654321',collectionIds:['tasks']}]
    const records=[{id:'task',kind:'task',source:'tasks',collectionId:'tasks',title:'Task A',tags:['Alpha']},{id:'other',kind:'task',source:'tasks',collectionId:'tasks',title:'Task B',tags:['Beta']}]
    const collections=[{id:'tasks',source:'tasks',title:'Task list'},{id:'board',source:'deck',title:'Board',labels:[{id:'label',title:'Loaded board label',color:'#123456'}]}]
    const render=async(name,props)=>{const {default:Component}=await server.ssrLoadModule('/src/'+name+'.vue');return renderToString(createSSRApp({render:()=>h(Component,props)}))}
    const picker=await render('OrganizationTagPicker',{workspace,records,collections,spaceId:'work',collectionIds:['tasks'],modelValue:['Alpha','Unavailable tag']})
    assert.match(picker,/2 selected · 1 matching items/);assert.match(picker,/Loaded board label/);assert.match(picker,/Unavailable tag/);assert.match(picker,/unavailable/)
    assert.match(picker,/Match any selected tag within the selected sources/)
    const group=await render('CategoryManager',{workspace,records,collections,spaceId:'work',locked:false})
    assert.match(group,/1 selected · 1 matching items/);assert.match(group,/Matching sources/)
    assert.match(group,/<option value="whole"[^>]*>Whole group<\/option>/);assert.doesNotMatch(group,/<option value="tagged"/)
    const mapping=defaultStatusMapping(collections),editor=await render('StatusMappingEditor',{mapping,collections,records,scopeName:'Work',inherited:true,allowDefault:true})
    assert.match(editor,/Using the global default/);assert.match(editor,/Use default/);assert.match(editor,/<button[^>]*disabled[^>]*>Use default/)
    mapping.columns[0].title='Ready for review';mapping.assignments[statusSourceKey('tasks','tasks','NEEDS-ACTION')]='todo'
    const timeline=await render('PlannerTimeline',{records,collections,spaces:workspace.spaces,categories:[],projects:[],scopeId:'work',relations:[],plans:[],anchor:new Date('2026-11-12T00:00:00Z'),colorFor:()=>'#123456',statusMapping:mapping})
    assert.match(timeline,/title="Ready for review"/);assert.match(timeline,/color:#8b939f/)
    const board=await render('PlannerBoard',{records,collections,relations:[],workflow:{},scopeId:'work',colorFor:()=>'#123456',statusMapping:mapping})
    assert.match(board,/Ready for review/)
    const sourceBoard=await render('PlannerBoard',{records,collections,relations:[],workflow:{},scopeId:'work',colorFor:()=>'#123456',statusMapping:mapping,hasCustomMapping:false})
    assert.match(sourceBoard,/data-column-id="status:to do"/)
    assert.doesNotMatch(sourceBoard,/data-column-id="\$unmapped"/)
  }finally{await server.close()}
})
