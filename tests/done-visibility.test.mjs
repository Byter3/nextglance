import test from 'node:test'
import assert from 'node:assert/strict'
import {plannerSettings, showCompletedForView, selectPlanner, createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {splitWorkspace, sharedFolderHash} from '@nextspace/nextcloud-node/planner-folder.mjs'
import {plannerFixture} from './fixtures.mjs'

const views=['overview','calendar','timeline','board','list']
const now=new Date(2026,10,11,9)

test('each layout inherits the old done visibility until explicitly configured',()=>{
  for(const legacy of [false,true]){
    const settings=plannerSettings({showCompleted:legacy})
    assert.ok(views.every(view=>showCompletedForView(settings,view)===legacy))
    settings.showCompletedByView={overview:!legacy,board:legacy}
    assert.equal(showCompletedForView(settings,'overview'),!legacy)
    assert.equal(showCompletedForView(settings,'board'),legacy)
    assert.equal(showCompletedForView(settings,'calendar'),legacy)
  }
})

test('layout-specific visibility keeps completed and cancelled work without changing open counts',()=>{
  const state=plannerFixture(now)
  const done=state.records.find(record=>record.id==='task-today')
  done.completed=true;done.status='COMPLETED'
  const cancelled=state.records.find(record=>record.id==='task-overdue')
  cancelled.status='CANCELLED'
  state.workspace.planner.showCompletedByView={overview:false,calendar:true,timeline:false,board:true,list:true}
  const counts=[]
  for(const view of views){
    state.workspace.planner.view=view
    const result=selectPlanner(state,{now})
    const visible=state.workspace.planner.showCompletedByView[view]
    assert.equal(result.records.some(record=>record.id===done.id),visible,`${view}: completed task`)
    assert.equal(result.records.some(record=>record.id===cancelled.id),visible,`${view}: cancelled task`)
    assert.equal(result.records.some(record=>record.id==='card-complete'),visible,`${view}: completed Deck card`)
    counts.push(result.counts.actions)
  }
  assert.equal(new Set(counts).size,1,'Visibility does not change native open-work counts')
  state.workspace.planner.view='overview'
  assert.ok(selectPlanner(state,{now,showCompleted:true}).records.some(record=>record.id===done.id),'Explicit query overrides remain supported')
})

test('layout visibility validates and survives JSON reload with older metadata still supported',()=>{
  const workspace=createPlannerWorkspace()
  workspace.planner.showCompletedByView={overview:true,calendar:false,timeline:true,board:false,list:true}
  const restored=validateWorkspace(JSON.parse(JSON.stringify(workspace)))
  for(const view of views)assert.equal(showCompletedForView(restored.planner,view),workspace.planner.showCompletedByView[view])
  delete workspace.planner.showCompletedByView
  assert.doesNotThrow(()=>validateWorkspace(workspace),'Older planners do not require the new preference')
  for(const value of [{calendar:'yes'},{canvas:true},[],null]){
    workspace.planner.showCompletedByView=value
    assert.throws(()=>validateWorkspace(workspace),/Invalid workspace/)
  }
  assert.deepEqual(plannerSettings({showCompletedByView:{overview:true,calendar:false,canvas:true,board:'true'}}).showCompletedByView,{overview:true,calendar:false})
})

test('done visibility stays on the device and cannot trigger cloud metadata uploads',()=>{
  const workspace=createPlannerWorkspace(),before=sharedFolderHash(workspace)
  workspace.planner.showCompletedByView={overview:true,calendar:false,timeline:true,board:false,list:true}
  assert.equal(sharedFolderHash(workspace),before)
  assert.equal(JSON.stringify([...splitWorkspace(workspace)]).includes('showCompletedByView'),false)
})
