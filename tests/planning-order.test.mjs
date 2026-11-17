import test from 'node:test'
import assert from 'node:assert/strict'
import {orderTimelineRecords,orderTimelineGroups,orderBoardRecords,reorderIds,boardOrderKey,boardTaskStacks,buildLinkIndex,listReorderTarget,listReorderPhase} from '@nextspace/core/planning-order.mjs'
import {createPlannerWorkspace,plannerSettings,selectPlanner} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {reconcileIdentities} from '@nextspace/core/identity.mjs'
import {alignWorkspaceIdentities,mergeWorkspaces} from '@nextspace/core/workspace-merge.mjs'
import {captureScopePreferences,parseScopePreferences,saveScopePreferences,scopePreferencesFor} from '@nextspace/core/scope-preferences.mjs'
import {splitWorkspace,assembleWorkspace} from '@nextspace/nextcloud-client/planner-folder.mjs'
const task=(id,start,extra={})=>({id,title:id,source:'tasks',kind:'task',...(start?{start}:{}),...extra})
const card=(id,start,extra={})=>task(id,start,{source:'deck',kind:'card',...extra})
const edge=(fromId,toId,type='depends_on')=>({id:`${fromId}-${toId}-${type}`,type,fromId,toId})
const ids=values=>values.map(item=>item.id)
const day=n=>`2026-11-${String(n).padStart(2,'0')}`
test('default dates are stable, invalid/missing last, then end/title/id, with no input mutation',()=>{
  const records=[task('undated'),task('bad','2026-02-30'),task('later',day(12)),task('due',null,{due:day(10)}),task('long',day(10),{due:day(14)}),task('end',null,{end:day(11)}),task('tie-b',day(10),{title:'Same'}),task('tie-a',day(10),{title:'Same'})]
  const original=structuredClone(records)
  assert.deepEqual(ids(orderBoardRecords(records)),['tie-a','tie-b','due','long','end','later','bad','undated'])
  assert.deepEqual(records,original)
  assert.deepEqual(ids(orderTimelineRecords([...records].reverse(),[])),ids(orderBoardRecords(records)))
})
test('components stay adjacent with prerequisites before dependent and generic direct work links',()=>{
  const records=[task('later',day(15)),task('unrelated',day(11)),card('dependent',day(10)),task('prerequisite',day(13)),task('ref',day(16)),task('event-mate',day(12))]
  const relations=[edge('dependent','prerequisite'),edge('dependent','ref','related'),edge('dependent','event','for_event'),edge('event-mate','event','for_event')]
  assert.deepEqual(ids(orderTimelineRecords(records,relations)),['prerequisite','dependent','ref','unrelated','event-mate','later'])
})
test('branch ties and malformed cycles use deterministic stable fallback',()=>{
  const records=[task('b',day(12)),task('a',day(10)),task('c',day(11))]
  assert.deepEqual(ids(orderTimelineRecords(records,[edge('a','b'),edge('b','a'),edge('c','b')])),['a','b','c'])
  assert.deepEqual(ids(orderTimelineRecords(records,[edge('a','b'),edge('a','c')])),['c','b','a'])
})
test('manual order overrides components and ignores unavailable IDs without dropping new rows',()=>{
  const records=[task('a',day(10)),task('b',day(11)),task('c',day(12))], manual=['gone','c','a']
  assert.deepEqual(ids(orderTimelineRecords(records,[edge('a','b')],manual)),['c','a','b'])
  assert.deepEqual(ids(orderBoardRecords(records,manual)),['c','a','b'])
  assert.deepEqual(manual,['gone','c','a'])
})
test('nested groups move as units only among siblings with unchanged records/membership',()=>{
  const groups=[{id:'late',name:'Late',records:[task('z',day(19))],children:[]},{id:'early',name:'Early',records:[],children:[{id:'child2',records:[task('d',day(14))],children:[]},{id:'child1',records:[task('a',day(10))],children:[]}]}]
  const original=structuredClone(groups), sorted=orderTimelineGroups(groups)
  assert.deepEqual(ids(sorted),['early','late']);assert.deepEqual(ids(sorted[0].children),['child1','child2'])
  const manual=orderTimelineGroups(groups,['child2','late','early','child1'])
  assert.deepEqual(ids(manual),['late','early']);assert.deepEqual(ids(manual[1].children),['child2','child1']);assert.deepEqual(groups,original)
})
test('reorder retains filtered/unavailable saved IDs and changes only valid sibling targets',()=>{
  assert.deepEqual(reorderIds(['a','hidden','b'],['a','b','c'],'c','a'),['c','a','hidden','b'])
  assert.deepEqual(reorderIds(['a','hidden','b'],['a','b','c'],'a','b','after'),['hidden','b','a','c'])
  assert.deepEqual(reorderIds(['a','hidden','b'],['a','b'],'a','other'),['a','hidden','b'])
  assert.deepEqual(reorderIds(['a','hidden','b'],['a','b'],'hidden','a'),['a','hidden','b'])
  const full=Array.from({length:5000},(_,index)=>`saved-${index}`)
  assert.deepEqual(reorderIds(full,['saved-0','new'],'new','saved-0'),full,'The bound never drops saved filtered positions')
})
test('Board key validates all modes, canonical identity and length',()=>{
  for(const mode of ['source','mapped','planning'])assert.equal(boardOrderKey(mode,'','doing'),`["${mode}","","doing"]`)
  assert.equal(boardOrderKey('deck','board-1','stack'), '["deck","board-1","stack"]')
  for(const args of [['source','board','x'],['deck','','x'],['other','','x'],['mapped','','constructor'],['deck','a'.repeat(2040),'column']])assert.throws(()=>boardOrderKey(...args))
})
test('Board tasks stack by true direction with earliest owner independent of input/manual order',()=>{
  const a=card('a',day(10)),b=card('b',day(11)),input=task('input'),output=task('output'),generic=task('generic')
  const result=boardTaskStacks([b,output,a,generic,input],[edge('b','input'),edge('a','input'),edge('output','a'),edge('generic','a','related'),edge('a','input')])
  assert.deepEqual(result.parentByTask,{input:'a',output:'a'})
  assert.deepEqual(ids(result.byCard.a.incoming),['input']);assert.deepEqual(ids(result.byCard.a.outgoing),['output']);assert.equal(result.byCard.b,undefined)
  assert.deepEqual(boardTaskStacks([input,generic],[edge('a','input')]),{parentByTask:{},byCard:{}})
})
test('stack projection never restores already filtered completion/assignment/source items',()=>{
  const records=[card('a',day(10),{assignmentKnown:true,assigneeIds:['me']}),task('done',undefined,{completed:true}),task('open')]
  const workspace=createPlannerWorkspace();workspace.relations=[edge('a','done'),edge('a','open')]
  const state={workspace,records,collections:[],connection:{username:'me'}}
  const model=selectPlanner(state,{showCompleted:false,assignment:'all'})
  assert.deepEqual(boardTaskStacks(model.actions,model.relations).parentByTask,{open:'a'})
  assert.deepEqual(boardTaskStacks(selectPlanner(state,{showCompleted:true,assignment:'all'}).actions,model.relations).parentByTask,{done:'a',open:'a'})
})
test('link index is bidirectional, deduplicated, direct and does not mutate relations',()=>{
  const relations=[edge('a','b'),edge('a','b'),edge('a','a'),edge('b','c')], index=buildLinkIndex(relations)
  assert.deepEqual([...index.get('a')],['b']);assert.deepEqual([...index.get('b')],['a','c']);assert.equal(index.get('a').has('c'),false)
})
test('scope arrangements validate strictly but local normalization bounds known fields',()=>{
  const key=boardOrderKey('source','','doing'), workspace=createPlannerWorkspace()
  workspace.planner.arrangements={all:{timelineRows:['a','b'],timelineGroups:['g'],boardCards:{[key]:['b','a']}}}
  assert.doesNotThrow(()=>validateWorkspace(workspace))
  for(const value of [{all:{timelineRows:['a','a']}},{all:{timelineRows:['constructor']}},{all:{extra:[]}},{all:{boardCards:{'[ "source", "", "doing" ]':['a']}}},{all:{timelineGroups:Array.from({length:5001},(_,i)=>`g${i}`)}}]) {
    assert.throws(()=>validateWorkspace({...workspace,planner:{...workspace.planner,arrangements:value}}),/Invalid workspace/)
  }
  const normalized=plannerSettings({arrangements:{all:{timelineRows:['a','a',3,'constructor','b'],extra:'removed'}}})
  assert.deepEqual(normalized.arrangements,{all:{timelineRows:['a','b']}})
})
test('identity reconcile and cross-device merge alignment remap rows/cards but preserve group/scope IDs',()=>{
  const workspace=createPlannerWorkspace(),key=boardOrderKey('mapped','','doing')
  workspace.identities=[{id:'canonical',source:'tasks',key:'uid',aliases:['alias']}]
  workspace.planner.arrangements={alias:{timelineRows:['alias','canonical','absent'],timelineGroups:['alias'],boardCards:{[key]:['canonical','alias']}}}
  const resolved=reconcileIdentities(workspace,[task('alias',undefined,{identity:{source:'tasks',key:'uid'}})])
  assert.deepEqual(resolved.workspace.planner.arrangements.alias,{timelineRows:['canonical','absent'],timelineGroups:['alias'],boardCards:{[key]:['canonical']}})
  const local=structuredClone(workspace);local.identities=[{id:'alias',source:'tasks',key:'uid'}]
  assert.deepEqual(alignWorkspaceIdentities(local,workspace).planner.arrangements,resolved.workspace.planner.arrangements)
})
test('independent scope/field edits merge while divergent order and delete/edit conflict',()=>{
  const base=createPlannerWorkspace();base.planner.arrangements={all:{timelineRows:['a','b','c'],timelineGroups:['g1','g2']}}
  const local=structuredClone(base),remote=structuredClone(base)
  local.planner.arrangements.all.timelineRows=['b','a','c'];remote.planner.arrangements.all.timelineGroups=['g2','g1'];remote.planner.arrangements.space={timelineRows:['x']}
  const merged=mergeWorkspaces(base,local,remote);assert.deepEqual(merged.conflicts,[]);assert.deepEqual(merged.workspace.planner.arrangements,{all:{timelineRows:['b','a','c'],timelineGroups:['g2','g1']},space:{timelineRows:['x']}})
  remote.planner.arrangements.all.timelineRows=['c','b','a'];assert.ok(mergeWorkspaces(base,local,remote).conflicts.includes('planner.arrangements.all.timelineRows'))
  delete local.planner.arrangements.all;assert.ok(mergeWorkspaces(base,local,remote).conflicts.includes('planner.arrangements.all'))
})
test('folder has one arrangement per scope outside settings and tombstones restore default order',()=>{
  const workspace=createPlannerWorkspace();workspace.planner.arrangements={all:{timelineRows:['b','a']},space:{timelineGroups:['g2','g1']}}
  const documents=splitWorkspace(workspace), arrangements=[...documents].filter(([,doc])=>doc.kind==='arrangement')
  assert.equal(arrangements.length,2);assert.equal(documents.get('settings.json').value.planner.arrangements,undefined)
  for(const [path,doc] of arrangements){assert.match(path,/^arrangements\/[a-f0-9]{64}\.json$/);assert.equal(doc.version,1)}
  assert.deepEqual(assembleWorkspace(documents).planner.arrangements,workspace.planner.arrangements)
  const [path,doc]=arrangements.find(([,doc])=>doc.key==='all');documents.set(path,{format:doc.format,version:1,kind:doc.kind,key:doc.key,deleted:true})
  assert.deepEqual(assembleWorkspace(documents).planner.arrangements,{space:{timelineGroups:['g2','g1']}})
})
test('Board grouping is local account/scope preference, defaults off and never enters planner',()=>{
  const snapshot=captureScopePreferences({}, {boardGroupTasks:true}), store=saveScopePreferences(parseScopePreferences(null),'space',snapshot)
  assert.equal(scopePreferencesFor(parseScopePreferences(JSON.stringify(store)),'space').boardGroupTasks,true)
  assert.equal(scopePreferencesFor(store,'all').boardGroupTasks,false);assert.equal(plannerSettings(snapshot).boardGroupTasks,undefined)
})
test('reorder input requires deliberate activation and same sibling geometry',()=>{
  assert.equal(listReorderPhase({pointerType:'touch',elapsed:499,distance:0}),'pending');assert.equal(listReorderPhase({pointerType:'touch',elapsed:500,distance:0}),'active');assert.equal(listReorderPhase({pointerType:'touch',elapsed:100,distance:9}),'pan')
  assert.equal(listReorderPhase({pointerType:'mouse',elapsed:0,distance:3}),'pending');assert.equal(listReorderPhase({pointerType:'mouse',elapsed:0,distance:4}),'active')
  const rects=[{id:'a',group:'one',top:0,bottom:10},{id:'b',group:'one',top:10,bottom:20},{id:'c',group:'two',top:20,bottom:30}]
  assert.deepEqual(listReorderTarget(rects,'one','a',18),{targetId:'b',placement:'after'});assert.equal(listReorderTarget(rects,'one','a',25),null)
  const bounded=rects.map(rect=>({...rect,left:0,right:100}))
  assert.equal(listReorderTarget(bounded,'one','a',18,110),null)
  assert.deepEqual(listReorderTarget(bounded,'one','a',18,50),{targetId:'b',placement:'after'})
})
