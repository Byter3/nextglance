import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import path from 'node:path'
import {createEmptyState, createPlannerWorkspace, scopeRecordIds, selectPlanner} from '@nextspace/core/planner.mjs'
import {recordGrouping, timelineGroups} from '@nextspace/core/timeline.mjs'
import {defaultCalendarForRecord} from '@nextspace/core/scheduling.mjs'
import {migrateWorkspace, validateWorkspace, WorkspaceStore, accountScope, workspaceHash} from '@nextspace/nextcloud-node/workspace.mjs'

function fixture() {
  const state=createEmptyState()
  state.connection={connected:true,username:'me'}
  state.workspace.spaces=[{id:'home',name:'First',color:'#0082c9',collectionIds:['personal-deck','work-deck','loose-tasks']}]
  state.workspace.categories=[
    {id:'personal',spaceId:'home',name:'Personal',color:'#229966',collectionIds:['personal-deck','private-calendar','private-tasks']},
    {id:'work',spaceId:'home',name:'Freelance',color:'#3388ee',collectionIds:['work-deck','client-calendar']},
  ]
  state.collections=[
    {id:'personal-deck',title:'Life board',source:'deck'},
    {id:'work-deck',title:'Personal',source:'deck'},
    {id:'private-calendar',title:'My appointments',source:'calendar'},
    {id:'client-calendar',title:'Personal',source:'calendar'},
    {id:'private-tasks',title:'Reminders',source:'tasks'},
  ]
  const task=(id,collectionId)=>({id,title:id,kind:'task',source:'tasks',collectionId})
  const card=(id,collectionId)=>({id,title:id,kind:'card',source:'deck',collectionId,assignmentKnown:true,assigneeIds:['me']})
  const event=(id,collectionId)=>({id,title:id,kind:'event',source:'calendar',collectionId,start:'2026-11-02T10:00:00Z',end:'2026-11-02T11:00:00Z'})
  state.records=[card('personal-card','personal-deck'),task('personal-task','private-tasks'),event('personal-event','private-calendar'),card('work-card','work-deck'),event('work-event','client-calendar'),task('loose','loose-tasks')]
  return state
}
const flatten=groups=>groups.flatMap(group=>[...group.records,...flatten(group.children)])

test('explicit categories keep different sources together inside a selected Space without matching titles',()=>{
  const state=fixture(), options={...state.workspace,collections:state.collections,scopeId:'home'}
  const groups=timelineGroups(state.records,options)
  assert.deepEqual(groups.map(group=>group.name),['First'])
  assert.deepEqual(groups[0].children.map(group=>group.name),['Personal','Freelance','Ungrouped sources'])
  assert.deepEqual(groups[0].children[0].records.map(record=>record.id),['personal-card','personal-task'])
  assert.deepEqual(groups[0].children[1].records.map(record=>record.id),['work-card'])
  assert.deepEqual(groups[0].children[2].records.map(record=>record.id),['loose'])
  assert.ok(groups[0].children[0].collectionIds.includes('private-calendar'))
  assert.equal(groups[0].count,4)
  assert.equal(new Set(flatten(groups).map(record=>record.id)).size,4)
  assert.equal(recordGrouping(state.records[2],options).category.id,'personal')
  assert.equal(recordGrouping(state.records[4],options).category.id,'work','Identical source titles never join unrelated sources')
})

test('category and parent scopes include category sources and explicit child-project records',()=>{
  const state=fixture()
  state.workspace.projects=[{id:'gig',spaceId:'home',categoryId:'work',name:'Gig',collectionIds:['gig-board'],recordIds:['special']}]
  state.records.push({id:'special',title:'Special task',source:'tasks',kind:'task',collectionId:'outside'})
  assert.deepEqual([...scopeRecordIds(state.workspace,state.records,'personal')].sort(),['personal-card','personal-event','personal-task'])
  assert.ok(scopeRecordIds(state.workspace,state.records,'home').has('personal-event'),'Category calendar need not duplicate parent membership to stay in scope')
  assert.ok(scopeRecordIds(state.workspace,state.records,'work').has('special'))
  const model=selectPlanner(state,{scopeId:'personal'})
  assert.equal(model.scope.kind,'category')
  assert.equal(model.categories.find(category=>category.id==='personal').openCount,2)
  assert.deepEqual(model.records.map(record=>record.id).sort(),['personal-card','personal-event','personal-task'])
})

test('nested projects require explicit category identity and retain deterministic row precedence',()=>{
  const state=fixture()
  state.workspace.projects=[
    {id:'old',spaceId:'home',name:'Existing project',collectionIds:['personal-deck'],recordIds:[]},
    {id:'gig',spaceId:'home',categoryId:'work',name:'Client film',collectionIds:['work-deck'],recordIds:['personal-task']},
  ]
  const groups=timelineGroups(state.records,{...state.workspace,scopeId:'home'})
  const project=groups[0].children.find(group=>group.kind==='project')
  assert.equal(project.id,'project:old')
  assert.equal(project.categoryId,undefined,'Existing projects do not gain an inferred category')
  const work=groups[0].children.find(group=>group.categoryId==='work')
  assert.equal(work.children[0].depth,2)
  assert.deepEqual(work.children[0].records.map(record=>record.id),['personal-task','work-card'])
  assert.equal(flatten(groups).filter(record=>record.id==='personal-task').length,1)
  const scoped=timelineGroups([...state.records].filter(record=>record.id==='personal-task'||record.id==='work-card'),{...state.workspace,scopeId:'work'})
  assert.deepEqual(scoped[0].children.map(group=>group.id),['category:work'])
})

test('removing a category restores Space grouping without deleting or editing source records',()=>{
  const state=fixture(), before=structuredClone(state.records)
  state.workspace.spaces[0].collectionIds.push('private-calendar','private-tasks')
  state.workspace.categories=state.workspace.categories.filter(category=>category.id!=='personal')
  const groups=timelineGroups(state.records,{...state.workspace,scopeId:'home'})
  const ungrouped=groups[0].children.find(group=>group.id==='ungrouped:space:home')
  assert.ok(ungrouped.records.some(record=>record.id==='personal-card'))
  assert.ok(ungrouped.records.some(record=>record.id==='personal-task'))
  assert.deepEqual(state.records,before)
  assert.equal(scopeRecordIds(state.workspace,state.records,'personal').size,0)
})

test('category calendar is preferred over an unrelated Space default, and unavailable targets require a choice',()=>{
  const state=fixture()
  state.workspace.spaces[0].collectionIds.push('client-calendar')
  state.workspace.spaces[0].defaultCalendarId='client-calendar'
  assert.equal(defaultCalendarForRecord(state.records[0],state.workspace,state.collections,'home'),'private-calendar')
  state.collections.find(collection=>collection.id==='private-calendar').readonly=true
  assert.equal(defaultCalendarForRecord(state.records[0],state.workspace,state.collections,'home'),undefined)
  state.workspace.categories[0].collectionIds=state.workspace.categories[0].collectionIds.filter(id=>id!=='private-calendar')
  assert.equal(defaultCalendarForRecord(state.records[0],state.workspace,state.collections,'home'),undefined)
})

test('context-linked external events have no inferred group outside the active scope',()=>{
  const state=fixture()
  state.workspace.relations.push({id:'external',type:'scheduled_during',fromId:'personal-card',toId:'work-event'})
  assert.ok(scopeRecordIds(state.workspace,state.records,'personal').has('work-event'))
  const event=state.records.find(record=>record.id==='work-event')
  assert.equal(recordGrouping(event,{...state.workspace,scopeId:'personal'}).category,undefined)
  assert.equal(recordGrouping(event,{...state.workspace,scopeId:'all'}).category,undefined)
  assert.equal(recordGrouping(event,{...state.workspace,scopeId:'home'}).category.id,'work')
})

test('legacy schema 2 metadata remains unchanged while categories validate strictly',()=>{
  const legacy=createPlannerWorkspace(); delete legacy.categories
  const hash=workspaceHash(legacy)
  assert.deepEqual(migrateWorkspace(legacy),legacy)
  assert.equal(workspaceHash(migrateWorkspace(legacy)),hash)
  const valid=fixture().workspace
  assert.deepEqual(validateWorkspace(valid),valid)
  for(const mutate of [
    workspace=>{workspace.categories=null},
    workspace=>{workspace.categories[0].spaceId='missing'},
    workspace=>{workspace.categories[0].id='home'},
    workspace=>{workspace.categories[1].collectionIds.push('personal-deck')},
    workspace=>{workspace.projects=[{id:'project',spaceId:'home',categoryId:'missing',name:'Bad',collectionIds:[],recordIds:[]}]},
    workspace=>{workspace.spaces.push({id:'other',name:'Other',color:'#333333',collectionIds:[]});workspace.projects=[{id:'project',spaceId:'other',categoryId:'personal',name:'Bad',collectionIds:[],recordIds:[]}]},
  ]) {const invalid=structuredClone(valid);mutate(invalid);assert.throws(()=>validateWorkspace(invalid),/Invalid workspace/)}
  const other=structuredClone(valid)
  other.spaces.push({id:'other',name:'Other',color:'#333333',collectionIds:[]})
  other.categories.push({id:'other-personal',name:'Personal',spaceId:'other',color:'#333333',collectionIds:['personal-deck']})
  assert.doesNotThrow(()=>validateWorkspace(other),'The same source may appear in categories in distinct Spaces')
})

test('categories and child project identity survive local reopen and conditional cloud sync',async t=>{
  const root=path.resolve('.runtime');await mkdir(root,{recursive:true})
  const dataDir=await mkdtemp(path.join(root,'category-test-'))
  assert.ok(path.resolve(dataDir).startsWith(`${root}${path.sep}`))
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  const state=fixture()
  state.workspace.projects=[{id:'gig',spaceId:'home',categoryId:'work',name:'Gig',collectionIds:[],recordIds:['work-card']}]
  const scope=accountScope('https://category-fixture.invalid','me')
  const store=await WorkspaceStore.open({dataDir,scope,initialState:createEmptyState()})
  await store.saveWorkspace(state.workspace,store.snapshot().revision)
  let remote=null, etag=null
  const writes=[]
  const client={readWorkspace:async()=>({workspace:remote,etag}),writeWorkspace:async(workspace,expected)=>{assert.equal(expected,etag);remote=structuredClone(workspace);etag='"categories-1"';writes.push(expected);return {etag}}}
  await store.syncWith(client)
  assert.deepEqual(remote.categories,state.workspace.categories)
  assert.equal(remote.projects[0].categoryId,'work')
  assert.deepEqual(writes,[null])
  const reopened=await WorkspaceStore.open({dataDir,scope,initialState:createEmptyState()})
  assert.deepEqual(reopened.snapshot().workspace.categories,state.workspace.categories)
  assert.equal(reopened.snapshot().workspace.projects[0].categoryId,'work')
  assert.equal(reopened.snapshot().sync.etag,'"categories-1"')
})
