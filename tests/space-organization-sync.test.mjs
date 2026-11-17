/** Organization protocol checks: temporary Windows profiles + isolated memory DAV.
 * This exercises the shared wire contract, not an Android implementation. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkspaceStore,accountScope} from '@nextspace/nextcloud-node/workspace.mjs'
import {splitWorkspace,assembleWorkspace} from '@nextspace/nextcloud-node/planner-folder.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {mergeWorkspaces} from '@nextspace/core/workspace-merge.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'

const clone=value=>structuredClone(value),account=accountScope('https://spaces.fixture.invalid','canonical-user')
const empty=()=>({workspace:createPlannerWorkspace(),records:[],collections:[],statuses:[]})
function fixture(){
  const workspace=createPlannerWorkspace()
  workspace.spaces=[
    {id:'daily',name:'Daily life',color:'#2862a0',collectionIds:['calendar','deck','tasks','unavailable-calendar'],defaultCalendarId:'calendar',defaultTaskListId:'tasks',defaultBoardId:'deck'},
    {id:'planning',name:'Planning',color:'#9c587b',collectionIds:['calendar','deck'],defaultCalendarId:'calendar'},
  ]
  workspace.categories=[
    {id:'daily-personal',spaceId:'daily',name:'Personal',color:'#123456',collectionIds:['calendar','deck','tasks']},
    {id:'daily-home',spaceId:'daily',name:'Home',color:'#654321',collectionIds:[]},
    {id:'planning-personal',spaceId:'planning',name:'Personal',color:'#abcdef',collectionIds:['calendar','deck']},
  ]
  workspace.projects=[{id:'project',spaceId:'daily',categoryId:'daily-personal',name:'Selected work',collectionIds:[],recordIds:['task'] }]
  workspace.relations=[{id:'event-link',type:'scheduled_during',fromId:'task',toId:'event'}]
  return workspace
}
const organization=workspace=>({spaces:workspace.spaces,categories:workspace.categories,projects:workspace.projects})
async function device(t){
  const dataDir=await mkdtemp(join(tmpdir(),'nextspace-space-sync-'))
  t.after(()=>rm(dataDir,{recursive:true,force:true}))
  return {dataDir,store:await WorkspaceStore.open({dataDir,scope:account,initialState:empty()})}
}
async function change(store,edit){const state=store.snapshot();edit(state.workspace);await store.saveWorkspace(state.workspace,state.revision)}
function cloud(){
  const files=new Map(),writes=[];let version=0
  return {
    files,writes,
    readWorkspace:async()=>({workspace:null,etag:null}),
    listPlannerFiles:async(directory='')=>{
      const prefix=directory?directory+'/':'',descendants=[...files].filter(([path])=>path.startsWith(prefix))
      const directories=[...new Set(descendants.map(([path])=>path.slice(prefix.length)).filter(path=>path.includes('/')).map(path=>prefix+path.split('/')[0]))]
      return {exists:true,files:[...directories.map(path=>({path,collection:true,etag:'"directory"'})),...descendants.filter(([path])=>!path.slice(prefix.length).includes('/')).map(([path,value])=>({path,collection:false,etag:value.etag}))]}
    },
    readPlannerFile:async path=>clone(files.get(path)||{document:null,etag:null}),
    writePlannerFile:async(path,document,etag=null)=>{
      const current=files.get(path)
      if(etag!==(current?.etag||null))throw Object.assign(Error('Fixture conditional write rejected'),{code:'CONFLICT',status:412})
      const next={document:clone(document),etag:`"v-${++version}"`};files.set(path,next);writes.push({path,document:clone(document),etag});return {etag:next.etag}
    },
    data:()=>{const manifest=files.get('manifest.json').document,prefix=manifest.generation+'/';return assembleWorkspace(new Map([...files].filter(([path])=>path.startsWith(prefix)&&!path.endsWith('/legacy-import.json')).map(([path,value])=>[path.slice(prefix.length),value.document])))},
  }
}
async function paired(t){
  const a=await device(t),b=await device(t),remote=cloud()
  await change(a.store,w=>Object.assign(w,fixture()))
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.equal(a.store.storage().syncStatus,'synced',a.store.storage().message)
  assert.equal(b.store.storage().syncStatus,'synced',b.store.storage().message)
  return {a,b,remote}
}

test('schema 2 organization envelopes preserve distinct per-Space groups, UUIDs, order and unavailable sources',()=>{
  const original=fixture(),documents=splitWorkspace(original),wire=JSON.parse(JSON.stringify([...documents])),restored=assembleWorkspace(new Map(wire))
  assert.deepEqual(organization(restored),organization(original))
  const doc=documents.get('organization.json')
  assert.equal(doc.format,'nextspace-planner-document');assert.equal(doc.version,1);assert.equal(doc.kind,'organization')
  assert.deepEqual(Object.keys(doc.value),['spaces','categories','projects'])
  assert.deepEqual(restored.categories.filter(group=>group.name==='Personal').map(group=>group.id),['daily-personal','planning-personal'])
  assert.deepEqual(restored.spaces[0].collectionIds,['calendar','deck','tasks','unavailable-calendar'])
  assert.equal([...documents.keys()].some(path=>path.startsWith('spaces/')||path.startsWith('categories/')),false)
  const independent=clone(original);independent.categories.find(group=>group.id==='daily-personal').name='Private'
  assert.equal(validateWorkspace(independent).categories.find(group=>group.id==='planning-personal').name,'Personal')
})

test('fresh profile reads existing organization without replacement and preserves it after edits and restart',async t=>{
  const {a,b,remote}=await paired(t),initialWrites=remote.writes.length
  assert.deepEqual(organization(b.store.snapshot().workspace),organization(a.store.snapshot().workspace))
  assert.deepEqual(organization(remote.data()),organization(fixture()))
  await b.store.syncWith(remote);assert.equal(remote.writes.length,initialWrites,'Fresh/no-change reader does not replace organization')
  await change(b.store,w=>{w.categories.find(group=>group.id==='planning-personal').name='Home';w.categories.find(group=>group.id==='planning-personal').color='#991122'})
  await b.store.syncWith(remote);await a.store.syncWith(remote)
  assert.equal(remote.writes.length,initialWrites+1)
  assert.match(remote.writes.at(-1).path,/\/organization\.json$/)
  assert.ok(remote.writes.at(-1).etag,'Updates use a conditional version')
  assert.equal(a.store.snapshot().workspace.categories[0].name,'Personal')
  assert.equal(a.store.snapshot().workspace.categories[2].name,'Home')
  const reopened=await WorkspaceStore.open({dataDir:a.dataDir,scope:account,initialState:empty()})
  await reopened.syncWith(remote)
  assert.deepEqual(organization(reopened.snapshot().workspace),organization(remote.data()))
  assert.deepEqual(reopened.snapshot().workspace.relations,[{id:'event-link',type:'scheduled_during',fromId:'task',toId:'event'}])
})

test('independent offline edits to different Spaces merge, while local filters do not upload',async t=>{
  const {a,b,remote}=await paired(t)
  await change(a.store,w=>{w.categories[0].name='Private';w.spaces[0].color='#ab0011'})
  await change(b.store,w=>{w.categories[2].name='Home';w.categories[2].color='#1122ab'})
  await a.store.syncWith(remote);await b.store.syncWith(remote);await a.store.syncWith(remote)
  assert.equal(a.store.storage().syncStatus,'synced');assert.equal(b.store.storage().syncStatus,'synced',b.store.storage().message)
  assert.deepEqual(organization(a.store.snapshot().workspace),organization(b.store.snapshot().workspace))
  assert.equal(remote.data().categories[0].name,'Private');assert.equal(remote.data().categories[2].name,'Home')
  const count=remote.writes.length
  await change(b.store,w=>{w.planner.scopeId='planning';w.planner.view='calendar';w.planner.hiddenCollectionIds=['deck'];w.planner.showCompleted=true})
  await b.store.syncWith(remote)
  assert.equal(remote.writes.length,count,'Local scope navigation/filters have no shared document writes')
  assert.deepEqual(remote.data().spaces[1].collectionIds,['calendar','deck'])
})

test('competing source moves remain conflicts instead of assigning one source to two groups',async t=>{
  const {a,b,remote}=await paired(t)
  await change(a.store,w=>{w.categories[0].collectionIds=w.categories[0].collectionIds.filter(id=>id!=='deck');w.categories[1].collectionIds.push('deck')})
  await change(b.store,w=>{w.categories[0].collectionIds=w.categories[0].collectionIds.filter(id=>id!=='deck');w.categories.push({id:'daily-other',spaceId:'daily',name:'Other',color:'#345678',collectionIds:['deck']})})
  const before=b.store.snapshot(),local=clone(before.workspace),base=before.sync.baseWorkspace
  await a.store.syncWith(remote)
  const merged=mergeWorkspaces(base,local,remote.data())
  assert.deepEqual(merged.conflicts,[],'The combined ownership validation is the required guard after field merging')
  assert.throws(()=>validateWorkspace(merged.workspace),/only one category within a Space/)
  const writes=remote.writes.length;await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'conflict');assert.equal(remote.writes.length,writes)
  assert.deepEqual(organization(b.store.snapshot().workspace),organization(local),'Local source choice remains available for review')
  assert.equal(remote.data().categories.find(group=>group.id==='daily-home').collectionIds.includes('deck'),true)
  assert.equal(remote.data().categories.some(group=>group.id==='daily-other'),false)
})

test('Space removal is one coherent update and does not resurrect through unrelated offline edits',async t=>{
  const {a,b,remote}=await paired(t)
  await change(a.store,w=>{w.spaces=w.spaces.filter(space=>space.id!=='daily');w.categories=w.categories.filter(group=>group.spaceId!=='daily');w.projects=w.projects.filter(project=>project.spaceId!=='daily')})
  await change(b.store,w=>{w.categories.find(group=>group.id==='planning-personal').name='Survives'})
  const count=remote.writes.length;await a.store.syncWith(remote)
  assert.equal(remote.writes.length,count+1);assert.match(remote.writes.at(-1).path,/\/organization\.json$/)
  assert.equal(remote.writes.at(-1).document.deleted,undefined,'Required organization document is updated, never tombstoned')
  await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'synced',b.store.storage().message)
  assert.deepEqual(remote.data().spaces.map(space=>space.id),['planning'])
  assert.deepEqual(remote.data().categories.map(group=>group.id),['planning-personal'])
  assert.deepEqual(remote.data().projects,[]);assert.equal(remote.data().categories[0].name,'Survives')
  assert.equal(remote.data().relations[0].id,'event-link','Global item links survive deleting a saved view')
  const reopened=await WorkspaceStore.open({dataDir:b.dataDir,scope:account,initialState:empty()});await reopened.syncWith(remote)
  assert.deepEqual(reopened.snapshot().workspace.spaces.map(space=>space.id),['planning'])
})

test('deleting a Space while an offline client edits its group retains both versions for review',async t=>{
  const {a,b,remote}=await paired(t)
  await change(a.store,w=>{w.spaces=w.spaces.filter(space=>space.id!=='daily');w.categories=w.categories.filter(group=>group.spaceId!=='daily');w.projects=[]})
  await change(b.store,w=>{w.categories[0].name='Unpublished edit'})
  const local=b.store.snapshot().workspace;await a.store.syncWith(remote);const writes=remote.writes.length
  await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'conflict');assert.equal(remote.writes.length,writes)
  assert.deepEqual(organization(b.store.snapshot().workspace),organization(local))
  assert.deepEqual(remote.data().spaces.map(space=>space.id),['planning'])
  assert.equal(b.store.snapshot().sync.conflictWorkspace.spaces.some(space=>space.id==='daily'),false)
})
