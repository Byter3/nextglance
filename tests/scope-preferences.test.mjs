import test from 'node:test'
import assert from 'node:assert/strict'
import {plannerSettings,showCompletedForView,createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {scopePreferenceStorageKey,parseScopePreferences,captureScopePreferences,scopePreferencesFor,saveScopePreferences,applyScopePreferences,pruneScopePreferences} from '@nextspace/core/scope-preferences.mjs'
import {splitWorkspace,sharedFolderHash} from '@nextspace/nextcloud-node/planner-folder.mjs'

test('scope preferences are account-qualified and do not store credentials in keys',()=>{
  const key=scopePreferenceStorageKey({serverUrl:'https://CLOUD.example.test/nextcloud/',username:'User'})
  assert.equal(key,scopePreferenceStorageKey({serverUrl:'https://cloud.example.test/nextcloud',username:'User'}))
  assert.notEqual(key,scopePreferenceStorageKey({serverUrl:'https://cloud.example.test/nextcloud',username:'Other'}))
  assert.notEqual(key,scopePreferenceStorageKey({serverUrl:'https://cloud.example.test/second',username:'User'}))
  assert.equal(scopePreferenceStorageKey({serverUrl:'https://secret:password@cloud.example.test',username:'User'}),null)
  assert.equal(scopePreferenceStorageKey({serverUrl:'https://cloud.example.test/?token=secret',username:'User'}),null)
  assert.equal(scopePreferenceStorageKey({serverUrl:'not a URL',username:'User'}),null)
  assert.equal(scopePreferenceStorageKey({connected:false,serverUrl:'https://cloud.example.test',username:'User'}),scopePreferenceStorageKey({connected:true,serverUrl:'https://cloud.example.test',username:'User'}))
})

test('only initial Overview inherits legacy completion visibility and old Space exclusions never apply',()=>{
  const legacy=plannerSettings({scopeId:'work',view:'board',showCompleted:true,showCompletedByView:{board:false,list:true},hiddenCollectionIds:['personal'],includeUnassigned:true,excludedSpaceIds:['hidden'],scopeAssignments:{work:'me'}})
  const store=parseScopePreferences(null),overview=scopePreferencesFor(store,'all',legacy),work=scopePreferencesFor(store,'work',legacy)
  assert.equal(overview.showCompleted,true);assert.deepEqual(overview.showCompletedByView,{board:false,list:true})
  assert.deepEqual(overview.hiddenCollectionIds,[]);assert.equal(overview.includeUnassigned,false)
  assert.equal(work.assignment,'me');assert.equal(work.view,'overview');assert.equal(work.showCompleted,false)
  assert.deepEqual(work.showCompletedByView,{})
  assert.deepEqual(applyScopePreferences(legacy,'all',overview).excludedSpaceIds,[])
  const initialOverview=scopePreferencesFor(store,'all',{...legacy,scopeId:'all'})
  assert.deepEqual(initialOverview.hiddenCollectionIds,['personal']);assert.equal(initialOverview.view,'board')
})

test('view, search, source and completion filters survive scope switches without leaking',()=>{
  let store=parseScopePreferences(null)
  const overview=captureScopePreferences(plannerSettings({scopeId:'all',assignment:'me',view:'timeline',hiddenCollectionIds:['work'],showCompletedByView:{timeline:true}}),{query:'phone',attention:'today',listKind:'tasks'})
  store=saveScopePreferences(store,'all',overview)
  const work=scopePreferencesFor(store,'work')
  assert.deepEqual(work.hiddenCollectionIds,[]);assert.equal(work.assignment,'all');assert.equal(work.query,'')
  work.view='calendar';work.showCompletedByView.calendar=false;work.hiddenCollectionIds=['personal'];work.includeUnassigned=true
  store=saveScopePreferences(store,'work',work)
  const shared=plannerSettings({workflow:{task:'doing'},statusMapping:{columns:[{id:'a',title:'Active',color:'#123456'}],assignments:{}}})
  const restored=applyScopePreferences(applyScopePreferences(shared,'work',work),'all',scopePreferencesFor(store,'all'))
  assert.equal(restored.view,'timeline');assert.equal(restored.assignment,'me');assert.equal(restored.includeUnassigned,false)
  assert.equal(showCompletedForView(restored),true);assert.deepEqual(restored.hiddenCollectionIds,['work'])
  assert.deepEqual(restored.workflow,{task:'doing'});assert.deepEqual(restored.statusMapping,shared.statusMapping)
  assert.deepEqual(scopePreferencesFor(store,'all'),{...overview,showCompleted:true})
  const restarted=parseScopePreferences(JSON.stringify(store))
  assert.deepEqual(scopePreferencesFor(restarted,'work'),work)
  assert.deepEqual(scopePreferencesFor(restarted,'all'),{...overview,showCompleted:true})
  work.hiddenCollectionIds.push('mutable');assert.deepEqual(scopePreferencesFor(store,'work').hiddenCollectionIds,['personal'])
})

test('corrupt local values are bounded, normalized and cannot inject organization or prototype state',()=>{
  const bad=parseScopePreferences('{nope')
  assert.deepEqual(Object.keys(bad.scopes),[])
  const store=parseScopePreferences('{"version":1,"scopes":{"__proto__":{"polluted":true},"work":{"view":"bad","assignment":"bad","hiddenCollectionIds":["a","a",12],"showCompletedByView":{"board":true,"secret":true},"query":"hi","attention":"fake","listKind":"bad","spaces":[{"id":"fake"}],"excludedSpaceIds":["other"]}}}')
  assert.equal({}.polluted,undefined);assert.equal(Object.hasOwn(store.scopes,'__proto__'),false)
  const work=scopePreferencesFor(store,'work')
  assert.deepEqual(work.hiddenCollectionIds,['a']);assert.equal(work.view,'overview');assert.equal(work.attention,'all');assert.equal(work.listKind,'all')
  assert.deepEqual(work.showCompletedByView,{overview:false,board:true});assert.equal(work.spaces,undefined);assert.equal(work.excludedSpaceIds,undefined)
  assert.equal(captureScopePreferences({}, {query:'x'.repeat(4000)}).query.length,2000)
  const clean=pruneScopePreferences(saveScopePreferences(store,'all',captureScopePreferences()),['remaining'])
  assert.deepEqual(Object.keys(clean.scopes),['all'])
})

test('local scope switching cannot alter shared folder documents or Space source selections',()=>{
  const workspace=createPlannerWorkspace()
  workspace.spaces=[{id:'work',name:'Work',color:'#123456',collectionIds:['tasks','calendar']}]
  workspace.categories=[{id:'group',spaceId:'work',name:'Personal',color:'#abcdef',collectionIds:['tasks']}]
  const before=sharedFolderHash(workspace),organization=splitWorkspace(workspace).get('organization.json')
  const preferences=captureScopePreferences(plannerSettings({scopeId:'work',hiddenCollectionIds:['tasks'],view:'board',includeUnassigned:true,showCompleted:true}),{query:'temporary'})
  workspace.planner=applyScopePreferences(workspace.planner,'work',preferences)
  assert.equal(sharedFolderHash(workspace),before)
  assert.deepEqual(splitWorkspace(workspace).get('organization.json'),organization)
  assert.deepEqual(workspace.spaces[0].collectionIds,['tasks','calendar'])
})
