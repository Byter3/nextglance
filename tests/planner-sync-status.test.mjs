import test from 'node:test'
import assert from 'node:assert/strict'
import {plannerSyncStatus} from '@nextspace/core/planner-sync-status.mjs'
import {captureScopePreferences,parseScopePreferences,saveScopePreferences,scopePreferencesFor,applyScopePreferences} from '@nextspace/core/scope-preferences.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {sharedFolderHash} from '@nextspace/nextcloud-node/planner-folder.mjs'

test('planner diagnostics retain real folder/error and last success without inventing counts',()=>{
  const status=plannerSyncStatus({storage:{remotePath:'/Workspace/Nextspace/',syncStatus:'error',lastSyncedAt:'2026-11-12T09:00:00Z',errorStage:'planner-read',errorCode:'TIMEOUT',message:'Planner download timed out. Saved changes remain on this device.'},syncing:false})
  assert.equal(status.state,'error');assert.equal(status.errorCode,'TIMEOUT');assert.equal(status.lastSyncedAt,'2026-11-12T09:00:00Z')
  assert.equal(status.folder,'/Workspace/Nextspace/');assert.equal(status.count,undefined)
  assert.match(status.message,/timed out/)
  assert.equal(plannerSyncStatus({storage:{syncStatus:'synced'},connection:{connected:false}}).state,'local')
})

test('timeline collapse persists per account-local scope without entering cloud organization',()=>{
  const workspace=createPlannerWorkspace(),before=sharedFolderHash(workspace)
  const captured=captureScopePreferences(workspace.planner,{timelineListCollapsed:true})
  const store=parseScopePreferences(JSON.stringify(saveScopePreferences(parseScopePreferences(null),'work',captured)))
  assert.equal(scopePreferencesFor(store,'work').timelineListCollapsed,true)
  assert.equal(scopePreferencesFor(store,'other').timelineListCollapsed,false)
  workspace.planner=applyScopePreferences(workspace.planner,'work',captured)
  assert.equal(workspace.planner.timelineListCollapsed,undefined)
  assert.equal(sharedFolderHash(workspace),before)
  assert.equal(captureScopePreferences({}, {timelineListCollapsed:'true'}).timelineListCollapsed,false)
})
