import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmptyState,filterCompletedWork,selectPlanner} from '@nextspace/core/planner.mjs'
import {captureScopePreferences,parseScopePreferences,saveScopePreferences,scopePreferencesFor} from '@nextspace/core/scope-preferences.mjs'
import {dependencyCandidates,relationPickerEligibility} from '@nextspace/core/relation-picker.mjs'
import {removeSpace} from '@nextspace/core/space-organization.mjs'

test('page filters persist independently, migrate only active legacy page and reject unknown pages',()=>{
  let store=parseScopePreferences(JSON.stringify({version:1,scopes:{work:{view:'board',assignment:'me',query:'review',hiddenCollectionIds:['private'],statusIds:['ready'],showCompletedByView:{list:true},boardGroupTasks:true}}}))
  assert.equal(store.version,2)
  assert.equal(scopePreferencesFor(store,'work').query,'review')
  const calendar=scopePreferencesFor(store,'work',{},'calendar')
  assert.equal(calendar.assignment,'all');assert.equal(calendar.query,'');assert.deepEqual(calendar.hiddenCollectionIds,[]);assert.deepEqual(calendar.statusIds,[]);assert.equal(calendar.showCompleted,false)
  assert.equal(scopePreferencesFor(store,'work',{},'list').showCompleted,true)
  store=saveScopePreferences(store,'work',{...calendar,query:'meeting',includeUnassigned:true})
  assert.equal(scopePreferencesFor(store,'work',{},'board').query,'review')
  assert.equal(scopePreferencesFor(store,'work',{},'calendar').query,'meeting')
  assert.equal(scopePreferencesFor(store,'all',{},'board').assignment,'me')
  store.scopes.work.pages.secret={query:'bad'}
  const restarted=parseScopePreferences(JSON.stringify(store))
  assert.equal(restarted.scopes.work.pages.secret,undefined)
  assert.equal(scopePreferencesFor(restarted,'work',{},'board').boardGroupTasks,true)
  assert.equal(scopePreferencesFor(restarted,'work',{},'calendar').query,'meeting')
  assert.equal(Object.hasOwn(restarted.scopes.work,'query'),false)
})

test('Board keeps done cards and direct completed linked tasks only after explicit filters',()=>{
  const state=createEmptyState();state.connection.username='tester'
  state.workspace.planner.assignment='all';state.workspace.planner.view='board'
  state.records=[{id:'card',kind:'card',source:'deck',collectionId:'board',title:'Visible',completed:true},{id:'linked',kind:'task',source:'tasks',collectionId:'tasks',title:'Visible linked',completed:true},{id:'other',kind:'task',source:'tasks',title:'Other',completed:true},{id:'cancelled',kind:'task',source:'tasks',title:'Cancelled',status:'CANCELLED'},{id:'transitive',kind:'task',source:'tasks',title:'Transitive',completed:true}]
  state.workspace.relations=[{id:'link',type:'related',fromId:'linked',toId:'card'},{id:'cancel',type:'reference',fromId:'card',toId:'cancelled'},{id:'transitive',type:'depends_on',fromId:'transitive',toId:'linked'}]
  assert.deepEqual(selectPlanner(state).actions.map(item=>item.id).sort(),['card','linked']);assert.equal(selectPlanner(state).counts.actions,0)
  assert.deepEqual(selectPlanner(state,{hiddenCollectionIds:['board']}).actions,[])
  assert.deepEqual(selectPlanner(state,{query:'linked'}).actions,[],'card query exclusion removes exception')
  assert.deepEqual(selectPlanner(state,{view:'timeline'}).actions,[])
  assert.equal(filterCompletedWork(state.records,state.workspace.relations,'board',true).length,5)
})

test('dependency source pool resolves owning Space, ignores tag/page filters and keeps complete graph',()=>{
  const state=createEmptyState(),w=state.workspace
  w.spaces=[{id:'work',name:'Work',color:'#123456',collectionIds:['base']}]
  w.categories=[{id:'group',spaceId:'work',name:'Group',color:'#123456',collectionIds:['group-source'],tagNames:['selected']}]
  w.projects=[{id:'project',spaceId:'work',name:'Project',collectionIds:['project-source'],recordIds:[]},{id:'archive',spaceId:'work',name:'Archived',collectionIds:['archived-source'],recordIds:[],archived:true}]
  const records=['base','group-source','project-source','other','archived-source'].map((collectionId,i)=>({id:String(i),source:'tasks',kind:'task',title:String(i),collectionId}))
  assert.deepEqual(dependencyCandidates(w,records,'project').map(item=>item.id),['0','1','2'])
  assert.deepEqual(dependencyCandidates(w,records,'group').map(item=>item.id),['0','1','2'])
  assert.equal(dependencyCandidates(w,records,'all').length,5);assert.deepEqual(dependencyCandidates(w,records,'missing'),[])
  assert.equal(relationPickerEligibility(records[0],records[2],'dependency','incoming',[{type:'depends_on',fromId:'2',toId:'3'},{type:'depends_on',fromId:'3',toId:'0'}],records).ok,false)
})

test('Space removal drops owned arrangements only and preserves sources/global relationships',()=>{
  const state=createEmptyState(),w=state.workspace
  w.spaces=[{id:'work',name:'Work',color:'#123456',collectionIds:['tasks']}]
  w.categories=[{id:'group',spaceId:'work',name:'Group',color:'#123456',collectionIds:['tasks']}]
  w.projects=[{id:'project',spaceId:'work',name:'Project',collectionIds:[],recordIds:[]}]
  w.planner.arrangements={work:{timelineRows:['a']},group:{timelineRows:['a']},project:{timelineRows:['a']},all:{timelineRows:['a']}}
  w.relations=[{id:'r',type:'related',fromId:'a',toId:'b'}]
  const result=removeSpace(w,'work')
  assert.deepEqual(Object.keys(result.planner.arrangements),['all']);assert.deepEqual(result.relations,w.relations);assert.equal(w.spaces.length,1)
})
