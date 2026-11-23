import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmptyState,selectPlanner,countPlannerActions,scopeRecordIds,boardCollectionsForScope} from '@nextspace/core/planner.mjs'
import {defaultStatusMapping,statusSourceKey,effectiveStatusMapping,setScopeStatusMapping,unifiedStatus,filterUnifiedStatuses,statusMoveTargets,boardModeAfterMappingChange} from '@nextspace/core/status-mapping.mjs'
import {organizationMembership,organizationTagOptions,organizationTagKey,organizationRuleCount} from '@nextspace/core/organization-tags.mjs'
import {timelineGroups,recordGrouping} from '@nextspace/core/timeline.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {mergeWorkspaces,alignWorkspaceIdentities} from '@nextspace/core/workspace-merge.mjs'
import {captureScopePreferences,parseScopePreferences,saveScopePreferences} from '@nextspace/core/scope-preferences.mjs'
import {createSpaceDraft,saveSpaceDraft} from '@nextspace/core/space-organization.mjs'
import {buildScopeDraft} from '@nextspace/core/scope-editor.mjs'
import {splitWorkspace,assembleWorkspace} from '@nextspace/nextcloud-node/planner-folder.mjs'
const clone=value=>structuredClone(value)
function fixture(){
  const state=createEmptyState(),workspace=state.workspace
  state.connection={connected:true,username:'fixture-user'};workspace.planner.assignment='all'
  state.collections=[{id:'tasks',source:'tasks',title:'Tasks'},{id:'board',source:'deck',title:'Board',labels:[{id:'1',title:'Alpha',color:'#123456'}],stacks:[{id:'stack',title:'Native stack'}]},{id:'cal',source:'calendar',title:'Calendar'},{id:'outside',source:'tasks',title:'Outside'}]
  const record=(id,source,kind,collectionId,tags=[],extra={})=>({id,source,kind,collectionId,title:id,tags,...extra})
  state.records=[record('a','tasks','task','tasks',['Alpha']),record('b','tasks','task','tasks',['Beta']),record('card','deck','card','board',[],{tagDetails:[{id:'1',title:'ＡＬＰＨＡ'}],stackId:'stack',assignmentKnown:true,assigneeIds:['fixture-user']}),record('done','tasks','task','tasks',['Alpha'],{completed:true,status:'COMPLETED'}),record('event','calendar','event','cal',['Alpha'],{start:'2026-11-12T09:00:00Z',end:'2026-11-12T10:00:00Z'}),record('foreign','tasks','task','outside',['Alpha']),record('note','notes','note','notes',['Alpha'])]
  workspace.spaces=[{id:'work',name:'Work',color:'#123456',collectionIds:['tasks','board','cal']},{id:'home',name:'Home',color:'#654321',collectionIds:['tasks']}]
  workspace.categories=[{id:'whole',spaceId:'work',name:'Whole source',color:'#123456',collectionIds:['tasks']},{id:'tagged',spaceId:'work',name:'Alpha group',color:'#654321',collectionIds:[],tagNames:['Alpha']}]
  workspace.projects=[{id:'project',spaceId:'work',categoryId:'tagged',name:'Project A',collectionIds:['tasks'],recordIds:[],tagNames:['Alpha']}]
  workspace.planner.statusMapping=defaultStatusMapping(state.collections)
  workspace.planner.statusMapping.assignments[statusSourceKey('deck','board','stack')]='todo'
  return state
}
const ids=records=>records.map(record=>record.id).sort()
test('Space mapping inherits live global changes and customizes only its owner',()=>{
  const {workspace,collections,records}=fixture(),global=effectiveStatusMapping(workspace,'all',collections)
  assert.deepEqual(effectiveStatusMapping(workspace,'project',collections),global)
  const custom=clone(global);custom.columns[0].title='Queued';custom.assignments[statusSourceKey('tasks','tasks','NEEDS-ACTION')]='doing'
  const updated=setScopeStatusMapping(workspace,'project',custom)
  assert.deepEqual(workspace.spaces[0].statusMapping,undefined)
  assert.equal(effectiveStatusMapping(updated,'tagged',collections).columns[0].title,'Queued')
  assert.equal(effectiveStatusMapping(updated,'home',collections).columns[0].title,'To do')
  updated.planner.statusMapping.columns[0].title='Global queue'
  assert.equal(effectiveStatusMapping(updated,'home',collections).columns[0].title,'Global queue')
  assert.equal(effectiveStatusMapping(updated,'work',collections).columns[0].title,'Queued')
  assert.equal(unifiedStatus(records[0],effectiveStatusMapping(updated,'project',collections)).id,'doing')
  assert.equal(statusMoveTargets(records[0],'doing',effectiveStatusMapping(updated,'project',collections),collections).length,2)
  assert.equal(effectiveStatusMapping(setScopeStatusMapping(updated,'work',null),'project',collections).columns[0].title,'Global queue')
  assert.throws(()=>setScopeStatusMapping(updated,'missing',custom),/no longer available/)
})
test('mapping updates preserve explicit native/source/planning Board modes',()=>{
  assert.equal(boardModeAfterMappingChange('',false,true),'__unified__')
  for(const mode of ['','board','__planning__','__unified__'])assert.equal(boardModeAfterMappingChange(mode,true,true),mode)
  assert.equal(boardModeAfterMappingChange('board',false,true),'board')
  assert.equal(boardModeAfterMappingChange('__unified__',true,false),'__unified__')
})
test('tag rules narrow source pools, match any canonical tag, retain curated exceptions and ignore unrelated note tags',()=>{
  const {workspace,records}=fixture()
  assert.deepEqual([...scopeRecordIds(workspace,records,'project')].sort(),['a','done'])
  assert.deepEqual([...scopeRecordIds(workspace,records,'tagged')].sort(),['a','card','done','event'])
  workspace.projects[0].tagNames.push('Beta');workspace.projects[0].recordIds=['foreign','note']
  assert.deepEqual([...scopeRecordIds(workspace,records,'project')].sort(),['a','b','done','foreign','note'])
  assert.deepEqual([...scopeRecordIds(workspace,records,'home')].sort(),['a','b','done'])
  assert.equal(organizationTagKey(' ＡＬＰＨＡ '),'alpha')
  assert.equal(organizationRuleCount(workspace,records,'work',['tasks'],['Alpha'],['foreign']),3)
})
test('combined timeline priority is explicit project, tag project, whole project, tag group, whole group',()=>{
  const state=fixture(),{workspace,records}=state
  workspace.projects.unshift({id:'whole-project',spaceId:'work',name:'Whole project',collectionIds:['tasks'],recordIds:[]})
  workspace.projects.push({id:'explicit',spaceId:'work',name:'Explicit',collectionIds:[],recordIds:['card']})
  const options={...workspace,scopeId:'work',collections:state.collections}
  assert.equal(recordGrouping(records[0],options).project.id,'project')
  assert.equal(recordGrouping(records[1],options).project.id,'whole-project')
  assert.equal(recordGrouping(records[2],options).project.id,'explicit')
  const flattened=groups=>groups.flatMap(group=>[...group.records,...flattened(group.children)])
  assert.equal(new Set(ids(flattened(timelineGroups(records,options)))).size,flattened(timelineGroups(records,options)).length)
  workspace.projects=[]
  assert.equal(recordGrouping(records[0],{...workspace,scopeId:'work'}).category.id,'tagged')
  assert.equal(recordGrouping(records[1],{...workspace,scopeId:'work'}).category.id,'whole')
  assert.deepEqual(recordGrouping(records[0],{...workspace,scopeId:'all'}),{space:undefined,category:undefined})
})
test('status filtering applies before counts and linked layers in all views without hiding events or notes',()=>{
  const state=fixture(),mapping=effectiveStatusMapping(state.workspace,'all',state.collections)
  assert.deepEqual(ids(filterUnifiedStatuses(state.records,mapping,['done'])),['done','event','note'])
  for(const view of ['overview','timeline','calendar','board','list']){
    const model=selectPlanner(state,{view,statusIds:['done'],showCompleted:true})
    assert.deepEqual(ids(model.records),['done','event','note']);assert.equal(model.actions.length,1)
    assert.deepEqual(ids(selectPlanner(state,{view,statusIds:['done'],showCompleted:false}).records),['event','note'])
  }
  assert.deepEqual(ids(selectPlanner(state,{statusIds:['removed']}).records),['event','note'])
  assert.equal(countPlannerActions(state,{statusIds:['done']}),0)
  assert.equal(countPlannerActions(state,{statusIds:['todo']}),4)
  assert.equal(selectPlanner(state,{scopeId:'project'}).projects.find(project=>project.id==='project').openCount,1)
})
test('source hiding does not let tag scopes pull linked context back through excluded work',()=>{
  const state=fixture();state.workspace.relations=[{id:'context',type:'reference',fromId:'a',toId:'note'}]
  assert.ok(scopeRecordIds(state.workspace,state.records,'project').has('note'))
  assert.deepEqual(ids(selectPlanner(state,{scopeId:'project',hiddenCollectionIds:['tasks']}).records),[])
})
test('tag-only catalogs retain empty source columns and do not make archived projects sources',()=>{
  const state=fixture();state.workspace.projects[0].collectionIds=[]
  assert.deepEqual(ids(boardCollectionsForScope(state.workspace,state.records,state.collections,'project')),['board','tasks'])
  state.workspace.projects.push({id:'archived',spaceId:'work',name:'Archived',collectionIds:['outside'],recordIds:['foreign'],tagNames:['Alpha'],archived:true})
  assert.equal(organizationMembership(state.workspace,state.records).scopes.get('work').has('foreign'),false)
  assert.deepEqual([...scopeRecordIds(state.workspace,state.records,'archived')],[])
})
test('loaded tag catalog is deterministic, native-source limited, and preserves missing selected names',()=>{
  const state=fixture(),args=[state.records,state.collections,['Missing']]
  const options=organizationTagOptions(...args)
  assert.deepEqual(options.map(option=>[option.key,option.available]),[['alpha',true],['beta',true],['missing',false]])
  assert.equal(options[0].color,'#123456')
  assert.deepEqual(organizationTagOptions([...state.records].reverse(),[...state.collections].reverse(),['Missing']),options)
  state.records.find(record=>record.id==='foreign').tags=['Draft source tag']
  assert.ok(organizationTagOptions(state.records,state.collections).some(option=>option.title==='Draft source tag'))
  assert.equal(organizationRuleCount(state.workspace,state.records,'work',[],['Draft source tag']),0)
})
test('strict schema permits overlapping tag categories but not duplicate unfiltered sources or malformed rules',()=>{
  const {workspace}=fixture();workspace.categories.push({id:'beta',spaceId:'work',name:'Beta',color:'#123456',collectionIds:['tasks'],tagNames:['Beta']})
  workspace.categories[1].collectionIds=['tasks'];assert.doesNotThrow(()=>validateWorkspace(workspace))
  for(const value of [['Alpha','ＡＬＰＨＡ'],[' Alpha'],[''],['x'.repeat(201)],Array.from({length:101},(_,i)=>String(i))]){const next=clone(workspace);next.projects[0].tagNames=value;assert.throws(()=>validateWorkspace(next),/Invalid workspace/)}
  const duplicate=clone(workspace);delete duplicate.categories[1].tagNames;assert.throws(()=>validateWorkspace(duplicate),/only one category/)
  const bad=clone(workspace);bad.spaces[0].statusMapping={columns:[],assignments:{}};assert.throws(()=>validateWorkspace(bad),/needs a column/)
})
test('organization folder and draft round trips preserve maps/tags while local status filters stay local',()=>{
  const state=fixture(),workspace=setScopeStatusMapping(state.workspace,'work',state.workspace.planner.statusMapping)
  const docs=splitWorkspace(workspace),restored=assembleWorkspace(docs)
  assert.deepEqual(restored.spaces,workspace.spaces);assert.deepEqual(restored.categories,workspace.categories);assert.deepEqual(restored.projects,workspace.projects)
  assert.equal(docs.get('settings.json').value.planner.statusMapping.columns[0].title,'To do')
  assert.equal(docs.get('organization.json').value.spaces[0].statusMapping.columns[0].title,'To do')
  const draft=createSpaceDraft(workspace,'work');draft.space.name='Renamed';const result=saveSpaceDraft(workspace,draft)
  assert.equal(result.ok,true);assert.deepEqual(result.workspace.categories[1].tagNames,['Alpha']);assert.deepEqual(result.workspace.spaces[0].statusMapping,workspace.spaces[0].statusMapping)
  assert.deepEqual(buildScopeDraft(workspace,{kind:'project',id:'project'}).tagNames,['Alpha'])
  const snapshot=captureScopePreferences(workspace.planner,{statusIds:['removed','$unmapped','removed']})
  const local=saveScopePreferences(parseScopePreferences(null),'work',snapshot)
  assert.deepEqual(parseScopePreferences(JSON.stringify(local)).scopes.work.pages[snapshot.view].statusIds,['removed','$unmapped'])
  assert.ok([...docs.values()].every(document=>!JSON.stringify(document).includes('statusIds')))
})
test('independent Space customization and tag edits merge, same mapped field conflicts, identities leave rules intact',()=>{
  const {workspace}=fixture();workspace.spaces[0].statusMapping=clone(workspace.planner.statusMapping)
  const left=clone(workspace),right=clone(workspace)
  left.spaces[0].statusMapping.columns[0].title='Queued';right.projects[0].tagNames=['Beta']
  const combined=mergeWorkspaces(workspace,left,right)
  assert.deepEqual(combined.conflicts,[]);assert.equal(combined.workspace.spaces[0].statusMapping.columns[0].title,'Queued');assert.deepEqual(combined.workspace.projects[0].tagNames,['Beta'])
  right.spaces[0].statusMapping.columns[0].title='Waiting';assert.ok(mergeWorkspaces(workspace,left,right).conflicts.some(path=>path.includes('statusMapping.columns[todo].title')))
  left.identities=[{id:'local',source:'tasks',key:'native-key'}];left.projects[0].recordIds=['local'];right.identities=[{id:'cloud',source:'tasks',key:'native-key'}]
  const aligned=alignWorkspaceIdentities(left,right)
  assert.deepEqual(aligned.projects[0].recordIds,['cloud']);assert.deepEqual(aligned.projects[0].tagNames,['Alpha']);assert.deepEqual(aligned.spaces[0].statusMapping,left.spaces[0].statusMapping)
})
