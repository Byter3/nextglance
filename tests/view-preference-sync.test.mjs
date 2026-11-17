import test from 'node:test'
import assert from 'node:assert/strict'
import {createViewPreferenceSync} from '../packages/core/src/view-preference-sync.mjs'
import {emptyViewPreferences,viewPreferencesFromLocal,mergeViewPreferences,applyViewPreferences} from '../packages/core/src/view-preferences.mjs'
import {captureScopePreferences,parseScopePreferences,saveScopePreferences} from '../packages/core/src/scope-preferences.mjs'
const local=(query='')=>saveScopePreferences(parseScopePreferences(null),'all',captureScopePreferences({view:'overview'},{query}))
const document=(query='')=>viewPreferencesFromLocal(local(query))
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('first sync imports saved pages only where the server has no page',async()=>{
  const remote=document('server'),writes=[],published=[]
  const machine=createViewPreferenceSync({local:local('device'),read:async()=>({preferences:remote,etag:'"1"'}),save:async input=>{writes.push(input);return {preferences:input.preferences,etag:'"2"'}},publish:value=>published.push(value)})
  await machine.refresh()
  assert.deepEqual(published.at(-1),remote);assert.equal(writes.length,0)
})
test('offline pending edits survive restart and merge a different remote field',async()=>{
  const base=document('before'),edited=document('local'),remote=document('before');remote.scopes.all.pages.overview.showCompleted=true
  let journal,publication,error,writes=0
  const machine=createViewPreferenceSync({local:local(),initial:{version:1,base,preferences:edited,etag:'"1"',migration:false},read:async()=>({preferences:remote,etag:'"2"'}),save:async input=>{writes++;assert.equal(input.etag,'"2"');return {preferences:input.preferences,etag:'"3"'}},publish:value=>publication=value,persist:value=>journal=value,status:value=>error=value.error})
  await machine.refresh()
  assert.equal(publication.scopes.all.pages.overview.query,'local');assert.equal(publication.scopes.all.pages.overview.showCompleted,true);assert.equal(writes,1);assert.equal(error,null);assert.deepEqual(journal.base,journal.preferences)
})
test('edits made while a save is running remain pending and are saved next',async()=>{
  let finish,writes=0,published
  const machine=createViewPreferenceSync({local:local('first'),read:async()=>({preferences:emptyViewPreferences(),etag:null}),save:async input=>{writes++;if(writes===1)await new Promise(resolve=>finish=resolve);return {preferences:input.preferences,etag:`"${writes}"`}},publish:value=>published=value})
  const pending=machine.refresh();await tick();machine.edit(document('second'));finish();await pending
  assert.equal(writes,2);assert.equal(published.scopes.all.pages.overview.query,'second');assert.deepEqual(machine.snapshot().base,machine.snapshot().preferences)
})
test('divergent same-field conflict preserves local pending filters without a write',async()=>{
  let error,writes=0
  const machine=createViewPreferenceSync({local:local(),initial:{version:1,base:document('base'),preferences:document('local'),etag:'"1"',migration:false},read:async()=>({preferences:document('remote'),etag:'"2"'}),save:async()=>{writes++},publish:()=>assert.fail('must not silently replace local filters'),status:value=>error=value.error})
  await machine.refresh();assert.equal(error.code,'PREFERENCES_CONFLICT');assert.equal(writes,0);assert.equal(machine.snapshot().preferences.scopes.all.pages.overview.query,'local')
})
test('closing an account fences a late response and persisted publication',async()=>{
  let finish,published=0,persisted=0
  const machine=createViewPreferenceSync({local:local(),read:()=>new Promise(resolve=>finish=resolve),save:()=>assert.fail('closed account write'),publish:()=>published++,persist:()=>persisted++})
  const pending=machine.refresh();await tick();machine.close();finish({preferences:document(),etag:'"1"'});await pending;assert.equal(published,0);assert.equal(persisted,0)
})
test('network failure preserves the journal and retry resumes',async()=>{
  let failed=true,error
  const machine=createViewPreferenceSync({local:local('saved'),read:async()=>{if(failed)throw new Error('offline');return {preferences:emptyViewPreferences(),etag:null}},save:async input=>({preferences:input.preferences,etag:'"1"'}),publish:()=>{},status:value=>error=value.error})
  await machine.refresh();assert.match(error.message,/offline/);assert.equal(machine.snapshot().migration,true);failed=false;await machine.refresh();assert.equal(error,null);assert.equal(machine.snapshot().base.scopes.all.pages.overview.query,'saved')
})
test('applying cloud filters preserves local geometry, but removes deleted semantic pages',()=>{
  const store=local();store.scopes.all.timelineListCollapsed=true;store.scopes.all.calendarMode='month'
  const result=applyViewPreferences(store,emptyViewPreferences());assert.deepEqual(result.scopes.all.pages,{});assert.equal(result.scopes.all.timelineListCollapsed,true);assert.equal(result.scopes.all.calendarMode,'month')
})
test('different scope/page edits merge without changing each other',()=>{
  const base=document('base'),a=structuredClone(base),b=structuredClone(base);a.scopes.all.pages.overview.query='mine';b.scopes.project={pages:{board:{...b.scopes.all.pages.overview,query:'theirs'}}}
  const result=mergeViewPreferences(base,a,b);assert.deepEqual(result.conflicts,[]);assert.equal(result.preferences.scopes.all.pages.overview.query,'mine');assert.equal(result.preferences.scopes.project.pages.board.query,'theirs')
})

test('explicit conflict choice changes only conflicting fields and keeps unrelated remote changes',async()=>{
  const base=document('base'),remote=document('remote');remote.scopes.all.pages.overview.showCompleted=true
  let saved
  const machine=createViewPreferenceSync({local:local(),initial:{version:1,base,preferences:document('local'),etag:'"1"',migration:false},read:async()=>({preferences:saved||remote,etag:saved?'"3"':'"2"'}),save:async input=>{saved=input.preferences;return {preferences:saved,etag:'"3"'}},publish:()=>{}})
  await machine.refresh();await machine.resolve('local');assert.equal(saved.scopes.all.pages.overview.query,'local');assert.equal(saved.scopes.all.pages.overview.showCompleted,true)
})

test('resolution serializes refresh and keeps edits made during its delayed read',async()=>{
  let release,active=0,maxActive=0,delayed=true,remote=document('remote')
  const machine=createViewPreferenceSync({local:local(),initial:{version:1,base:document('base'),preferences:document('local'),etag:'"1"',migration:false},read:async()=>{active++;maxActive=Math.max(maxActive,active);if(delayed){delayed=false;await new Promise(resolve=>release=resolve)}active--;return {preferences:remote,etag:'"2"'}},save:async input=>{remote=input.preferences;return {preferences:remote,etag:'"3"'}},publish:()=>{}})
  const resolving=machine.resolve('local');await tick();const refreshing=machine.refresh();const next=document('local');next.scopes.all.pages.overview.showCompleted=true;machine.edit(next);release();await resolving;await refreshing
  assert.equal(maxActive,1);assert.equal(remote.scopes.all.pages.overview.query,'local');assert.equal(remote.scopes.all.pages.overview.showCompleted,true)
})

test('online-only host never replays a failed save on reconnect',async()=>{
  let writes=0,fail=true
  const machine=createViewPreferenceSync({local:parseScopePreferences(null),retainPending:false,read:async()=>({preferences:document('server'),etag:'"1"'}),save:async input=>{writes++;if(fail)throw new Error('offline');return {preferences:input.preferences,etag:'"2"'}},publish:()=>{}})
  await machine.refresh();machine.editPage('all','overview',document('unsent').scopes.all.pages.overview);await machine.refresh();assert.equal(writes,1);fail=false;await machine.refresh();assert.equal(writes,1);assert.equal(machine.snapshot().preferences.scopes.all.pages.overview.query,'server')
})
