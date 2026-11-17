import test from 'node:test'
import assert from 'node:assert/strict'
import {isDeviceViewPatch} from '@nextspace/core/view-updates.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {captureScopePreferences,saveScopePreferences,parseScopePreferences,scopePreferencesFor,applyScopePreferences} from '@nextspace/core/scope-preferences.mjs'
import {withDeviceViewPreferences} from '@nextspace/core/workspace-merge.mjs'

test('view-only edits route locally while organization and unknown keys require a save',()=>{
  for(const patch of [{view:'board'},{assignment:'me'},{hiddenCollectionIds:['tasks']},{showCompletedByView:{board:true}},{scopeAssignments:{all:'me'},includeUnassigned:true}])assert.equal(isDeviceViewPatch(patch),true)
  for(const patch of [{workflow:{columns:[]}},{statusMapping:{columns:[]}},{view:'board',workflow:{}},{newUnsupportedRule:true},null,[]])assert.equal(isDeviceViewPatch(patch),false)
})

test('local page choice survives restart without mutating the acknowledged workspace',()=>{
  const acknowledged=createPlannerWorkspace(),before=structuredClone(acknowledged)
  const snapshot=captureScopePreferences({...acknowledged.planner,view:'calendar'},{calendarMode:'month',query:'review'})
  const saved=saveScopePreferences(parseScopePreferences(null),'all',snapshot)
  const restored=scopePreferencesFor(parseScopePreferences(JSON.stringify(saved)),'all',acknowledged.planner)
  assert.equal(applyScopePreferences(acknowledged.planner,'all',restored).view,'calendar')
  assert.equal(restored.calendarMode,'month');assert.equal(restored.query,'review')
  assert.deepEqual(acknowledged,before)
})

test('finishing a planner save preserves a newer device view and the saved shared edit',()=>{
  const acknowledged=createPlannerWorkspace(),current=structuredClone(acknowledged)
  current.planner.view='board';current.planner.hiddenCollectionIds=['hidden']
  acknowledged.spaces.push({id:'saved-space',name:'Saved Space',color:'#0082c9',collectionIds:[]})
  const result=withDeviceViewPreferences(acknowledged,current)
  assert.equal(result.planner.view,'board');assert.deepEqual(result.planner.hiddenCollectionIds,['hidden'])
  assert.equal(result.spaces[0].id,'saved-space');assert.equal(current.spaces.length,0)
})
