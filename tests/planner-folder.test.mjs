/** Folder sync contracts. Isolated in-memory DAV plus temporary local profiles only. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkspaceStore,accountScope} from '@nextspace/nextcloud-node/workspace.mjs'
import {FolderWorkspaceClient,splitWorkspace,assembleWorkspace,sharedFolderHash} from '@nextspace/nextcloud-node/planner-folder.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'

const clone=value=>structuredClone(value)
const scope=accountScope('https://folder-fixture.invalid','tester')
const initialState=()=>({workspace:createPlannerWorkspace(),records:[],collections:[],statuses:[]})
async function device(t){const dataDir=await mkdtemp(join(tmpdir(),'nextspace-folder-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));return {dataDir,store:await WorkspaceStore.open({dataDir,scope,initialState:initialState()})}}
async function change(store,callback){const next=store.snapshot();callback(next.workspace);return store.saveWorkspace(next.workspace,next.revision)}
const link=(id,fromId=id)=>({id,type:'reference',fromId,toId:'note'})
const nativeRecord=(id,key,aliases=[])=>({id,source:'tasks',kind:'task',title:key,identity:{source:'tasks',key,aliases}})
const cache=records=>({records,collections:[],statuses:[]})

function cloud(initialLegacy=null){
  let legacy=clone(initialLegacy),legacyVersion=1,sequence=0
  const files=new Map(),writes=[],attempts=[],reads=[],legacyWrites=[]
  const api={
    files,writes,attempts,reads,legacyWrites,beforeWrite:null,listVersion:null,
    readWorkspace:async()=>({workspace:clone(legacy),etag:legacy?`"legacy-${legacyVersion}"`:null}),
    writeWorkspace:async(value,etag)=>{assert.equal(etag,legacy?`"legacy-${legacyVersion}"`:null);legacy=clone(value);legacyVersion++;legacyWrites.push(clone(value));return {etag:`"legacy-${legacyVersion}"`}},
    mutateLegacy:callback=>{legacy=callback(clone(legacy));legacyVersion++},legacy:()=>clone(legacy),
    listPlannerFiles:async directory=>{
      const prefix=directory?`${directory}/`:''
      const descendants=[...files].filter(([path])=>path.startsWith(prefix))
      const childDirectories=[...new Set(descendants.map(([path])=>path.slice(prefix.length)).filter(path=>path.includes('/')).map(path=>prefix+path.split('/')[0]))]
      return {exists:descendants.length>0,files:[...childDirectories.map(path=>({path,collection:true,etag:'"directory"'})),...descendants.filter(([path])=>!path.slice(prefix.length).includes('/')).map(([path,value])=>({path,collection:false,etag:api.listVersion?api.listVersion(path,value.etag):value.etag}))]}
    },
    readPlannerFile:async path=>{reads.push(path);const value=files.get(path);return value?clone(value):{document:null,etag:null}},
    writePlannerFile:async(path,document,etag=null)=>{
      attempts.push({path,document:clone(document),etag})
      if(api.beforeWrite)await api.beforeWrite(path,clone(document),etag)
      const current=files.get(path)
      if(etag!==(current?.etag||null))throw Object.assign(Error('Conditional planner file changed'),{code:'CONFLICT',status:412})
      const saved={document:clone(document),etag:`"file-${++sequence}"`};files.set(path,saved);writes.push({path,...clone(saved),ifMatch:etag});return {etag:saved.etag}
    },
    mutate:(path,callback)=>{const current=files.get(path);assert.ok(current,`Fixture file exists: ${path}`);files.set(path,{document:callback(clone(current.document)),etag:`"file-${++sequence}"`})},
    manifest:()=>clone(files.get('manifest.json')?.document),
    data:()=>{const manifest=api.manifest();assert.ok(manifest);const prefix=`${manifest.generation}/`;return assembleWorkspace(new Map([...files].filter(([path])=>path.startsWith(prefix)&&!path.endsWith('/legacy-import.json')&&!path.endsWith('/legacy-original.json')).map(([path,value])=>[path.slice(prefix.length),value.document])),{updatedAt:manifest.createdAt})},
    pathFor:(kind,key)=>{const prefix=`${api.manifest().generation}/`;return [...files].find(([path,value])=>path.startsWith(prefix)&&value.document.kind===kind&&value.document.key===key)?.[0]},
  }
  api.legacyClient={readWorkspace:api.readWorkspace,writeWorkspace:api.writeWorkspace}
  return api
}

test('scope arrangements publish independently and two devices merge separate fields without settings writes',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  const before=remote.writes.length
  await change(a.store,w=>{w.planner.arrangements={all:{timelineRows:['b','a','unavailable']}}})
  await a.store.syncWith(remote)
  assert.equal(remote.writes.length-before,1);assert.match(remote.writes.at(-1).path,/\/arrangements\/[a-f0-9]{64}\.json$/)
  await change(b.store,w=>{w.planner.arrangements={all:{timelineGroups:['g2','g1']},space:{timelineRows:['x']}}})
  await b.store.syncWith(remote);await a.store.syncWith(remote)
  assert.equal(a.store.storage().syncStatus,'synced');assert.equal(b.store.storage().syncStatus,'synced')
  assert.deepEqual(remote.data().planner.arrangements,{all:{timelineRows:['b','a','unavailable'],timelineGroups:['g2','g1']},space:{timelineRows:['x']}})
  assert.equal(remote.writes.slice(before).some(write=>write.path.endsWith('/settings.json')),false)
  const reopened=await WorkspaceStore.open({dataDir:a.dataDir,scope,initialState:initialState()})
  assert.deepEqual(reopened.snapshot().workspace.planner.arrangements,remote.data().planner.arrangements)
})

test('divergent same-scope order is a conflict and does not combine order values as membership sets',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await change(a.store,w=>{w.planner.arrangements={all:{timelineRows:['a','b','c']}}})
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  await change(a.store,w=>{w.planner.arrangements.all.timelineRows=['b','a','c']})
  await change(b.store,w=>{w.planner.arrangements.all.timelineRows=['c','b','a']})
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.notEqual(b.store.storage().syncStatus,'synced')
  assert.deepEqual(b.store.snapshot().workspace.planner.arrangements.all.timelineRows,['c','b','a'])
  assert.deepEqual(remote.data().planner.arrangements.all.timelineRows,['b','a','c'])
})

test('reset arrangement tombstone survives another offline device edit and restart',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await change(a.store,w=>{w.planner.arrangements={all:{timelineRows:['b','a']}}})
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  const path=remote.pathFor('arrangement','all')
  await change(a.store,w=>{delete w.planner.arrangements.all});await a.store.syncWith(remote)
  assert.equal(a.store.storage().syncStatus,'synced')
  assert.equal(remote.files.get(path).document.deleted,true)
  await change(b.store,w=>{w.properties.unrelated={value:'keep'}});await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'synced');assert.equal(remote.data().planner.arrangements?.all,undefined)
  const reopened=await WorkspaceStore.open({dataDir:b.dataDir,scope,initialState:initialState()});await reopened.syncWith(remote)
  assert.equal(reopened.snapshot().workspace.planner.arrangements?.all,undefined)
  assert.equal(remote.files.get(path).document.deleted,true)
})

test('folder documents preserve shared data while excluding device navigation and source caches',()=>{
  const workspace=createPlannerWorkspace()
  workspace.name='Studio'
  workspace.spaces=[{id:'space',name:'Personal',color:'#123456',collectionIds:['calendar','deck']}]
  workspace.categories=[{id:'category',spaceId:'space',name:'Home',color:'#334455',collectionIds:['calendar']}]
  workspace.projects=[{id:'project',spaceId:'space',categoryId:'category',name:'Project',recordIds:['missing-task'],collectionIds:[]}]
  workspace.identities=[{id:'item',source:'tasks',key:'tasks:native',aliases:['old-task']}]
  workspace.relations=[link('brief','item')]
  workspace.plans=[{id:'session',recordId:'item',start:'2026-11-11T09:00:00Z',end:'2026-11-11T10:00:00Z'}]
  workspace.properties.item={estimate:60};workspace.properties['tag-colors']={'task:Later':'#ccbb00'}
  workspace.planner.workflow.item='doing';workspace.planner.view='board';workspace.planner.scopeId='space';workspace.planner.hiddenCollectionIds=['calendar']
  const documents=splitWorkspace(workspace),restored=assembleWorkspace(documents)
  assert.equal(sharedFolderHash(restored),sharedFolderHash(workspace))
  assert.equal(restored.planner.view,'overview');assert.equal(restored.planner.scopeId,'all');assert.deepEqual(restored.planner.hiddenCollectionIds,[])
  assert.equal(documents.get('organization.json').value.projects[0].recordIds[0],'missing-task')
  assert.ok([...documents.keys()].some(path=>path.startsWith('links/')))
  assert.deepEqual(documents.get('identities.json').value.identities,workspace.identities)
  assert.deepEqual(documents.get('dependencies.json').value.relations,[])
  assert.equal(JSON.stringify([...documents]).includes('cache'),false)
})

test('migration merges unsynced local changes with the existing cloud baseline and never rewrites legacy JSON',async t=>{
  const {store}=await device(t),legacy=createPlannerWorkspace();legacy.properties.imported={value:'cloud'}
  const remote=cloud(legacy);await store.syncWith(remote.legacyClient)
  await change(store,w=>{w.relations.push(link('unsynced-link'))})
  remote.mutateLegacy(w=>{w.properties.fromOtherPC={value:3};return w})
  const original=JSON.stringify(remote.legacy())
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'synced',store.storage().message)
  assert.equal(store.storage().remotePath,'/Workspace/Nextspace/')
  assert.equal(JSON.stringify(remote.legacy()),original);assert.equal(remote.legacyWrites.length,0)
  assert.equal(remote.data().properties.imported.value,'cloud');assert.equal(remote.data().properties.fromOtherPC.value,3)
  assert.equal(remote.data().relations[0].id,'unsynced-link')
  assert.equal(remote.writes.at(-1).path,'manifest.json','Completion marker publishes last')
  assert.deepEqual(remote.files.get(`${remote.manifest().generation}/legacy-original.json`).document,remote.legacy())
  assert.deepEqual(remote.files.get(`${remote.manifest().generation}/legacy-import.json`).document.workspace,remote.legacy())
})

test('interrupted seed resumes the same generation after restart and retains an exact pre-migration backup',async t=>{
  const {store,dataDir}=await device(t),remote=cloud()
  await change(store,w=>{w.properties.local={retain:true};w.relations=[link('retain')]})
  const before=store.snapshot();let count=0
  remote.beforeWrite=()=>{if(++count===2)throw Error('Fixture offline during migration')}
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'error');assert.equal(remote.manifest(),undefined)
  assert.deepEqual(store.snapshot().workspace,before.workspace);assert.equal(remote.legacy(),null)
  const seeded=remote.writes[0].path,generation=seeded.split('/')[0]
  const backup=JSON.parse(await readFile(join(store.directory,'planner-before-folder-migration.json'),'utf8'))
  assert.deepEqual(backup,before,'Permanent recovery file keeps the exact local envelope before migration')
  const reopened=await WorkspaceStore.open({dataDir,scope,initialState:initialState()})
  remote.beforeWrite=null;await reopened.syncWith(remote)
  assert.equal(reopened.storage().syncStatus,'synced',reopened.storage().message)
  assert.equal(remote.manifest().generation,generation,'Resuming identical data must not create another seed folder')
  assert.equal(remote.writes.filter(write=>write.path===seeded).length,1,'Acknowledged seed files are reused after restart')
  assert.deepEqual(JSON.parse(await readFile(join(store.directory,'planner-before-folder-migration.json'),'utf8')),before,'Retry must not replace the original backup')
  assert.equal(remote.data().relations[0].id,'retain');assert.equal(remote.data().properties.local.retain,true)
})

test('adding one link writes one file and never rewrites the manifest, settings or identities',async t=>{
  const {store}=await device(t),remote=cloud();await store.syncWith(remote)
  const marker=clone(remote.files.get('manifest.json')),count=remote.writes.length
  await change(store,w=>{w.relations.push(link('new-link'))});await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'synced',store.storage().message)
  assert.equal(remote.writes.length-count,1);assert.match(remote.writes.at(-1).path,/\/links\/[a-f0-9]+\.json$/)
  assert.deepEqual(remote.files.get('manifest.json'),marker)
  const after=remote.writes.length;await store.syncWith(remote)
  assert.equal(remote.writes.length,after,'No-op sync must not upload document timestamps')
})

test('independent links and attributes from two offline PCs merge into separate files and survive restart',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  await change(a.store,w=>{w.relations.push(link('from-a'))})
  await change(b.store,w=>{w.properties.task={estimate:45};w.relations.push(link('from-b'))})
  await a.store.syncWith(remote);await b.store.syncWith(remote);await a.store.syncWith(remote)
  assert.equal(a.store.storage().syncStatus,'synced');assert.equal(b.store.storage().syncStatus,'synced')
  assert.deepEqual(new Set(remote.data().relations.map(item=>item.id)),new Set(['from-a','from-b']))
  assert.equal(remote.data().properties.task.estimate,45)
  const reopened=await WorkspaceStore.open({dataDir:a.dataDir,scope,initialState:initialState()});await reopened.syncWith(remote)
  assert.equal(reopened.snapshot().workspace.properties.task.estimate,45)
  assert.deepEqual(reopened.snapshot().sync.folder,a.store.snapshot().sync.folder)
})

test('same-field conflicts preserve local, remote and baseline values instead of last-writer wins',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await change(a.store,w=>{w.properties.task={estimate:30}})
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  await change(a.store,w=>{w.properties.task.estimate=45});await change(b.store,w=>{w.properties.task.estimate=60})
  const before=b.store.snapshot();await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'conflict');assert.match(b.store.storage().message,/properties.task.estimate/)
  assert.equal(b.store.snapshot().workspace.properties.task.estimate,60);assert.equal(remote.data().properties.task.estimate,45)
  assert.deepEqual(b.store.snapshot().sync.baseWorkspace,before.sync.baseWorkspace)
  assert.equal(b.store.snapshot().sync.conflictWorkspace.properties.task.estimate,45)
})

test('tombstones prevent an offline PC from resurrecting a deleted link after unrelated changes or restart',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await change(a.store,w=>{w.relations=[link('remove')]});await a.store.syncWith(remote);await b.store.syncWith(remote)
  const path=remote.pathFor('relation','remove')
  await change(a.store,w=>{w.relations=[]});await change(b.store,w=>{w.properties.task={newValue:true}})
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'synced',b.store.storage().message)
  assert.equal(remote.files.get(path).document.deleted,true);assert.deepEqual(remote.data().relations,[])
  const reopened=await WorkspaceStore.open({dataDir:b.dataDir,scope,initialState:initialState()});await reopened.syncWith(remote)
  assert.deepEqual(reopened.snapshot().workspace.relations,[]);assert.equal(remote.data().properties.task.newValue,true)
})

test('partially acknowledged updates retain the old baseline and retry only still-missing files',async t=>{
  const {store}=await device(t),remote=cloud();await store.syncWith(remote)
  await change(store,w=>{w.relations=[link('part-one'),link('part-two')];w.properties.local={value:'keep'}})
  const before=store.snapshot();let count=0
  remote.beforeWrite=()=>{if(++count===2)throw Error('Fixture disconnect after first file')}
  const writeCount=remote.writes.length;await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'error');assert.equal(remote.writes.length-writeCount,1)
  const acknowledged=remote.writes.at(-1).path
  assert.deepEqual(store.snapshot().workspace,before.workspace);assert.deepEqual(store.snapshot().sync.baseWorkspace,before.sync.baseWorkspace)
  remote.beforeWrite=null;await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'synced',store.storage().message)
  assert.equal(remote.writes.filter(item=>item.path===acknowledged).length,1,'Acknowledged file must not be uploaded twice')
  assert.equal(remote.data().relations.length,2);assert.equal(remote.data().properties.local.value,'keep')
})

test('a conditional per-file race re-reads and merges different attributes without overwriting either',async t=>{
  const {store}=await device(t),remote=cloud()
  await change(store,w=>{w.properties.task={base:1}});await store.syncWith(remote)
  await change(store,w=>{w.properties.task.local=10})
  const path=remote.pathFor('property','task');let raced=false
  remote.beforeWrite=target=>{if(target===path&&!raced){raced=true;remote.mutate(path,document=>{document.value.remote=20;return document})}}
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'synced',store.storage().message)
  assert.deepEqual(remote.data().properties.task,{base:1,local:10,remote:20})
  assert.equal(remote.attempts.filter(item=>item.path===path).length,3,'Initial create, rejected stale write, merged retry')
})

test('physical removal of known files is a conflict rather than an inferred user deletion',async t=>{
  const {store}=await device(t),remote=cloud();await store.syncWith(remote)
  await change(store,w=>{w.relations=[link('known-later')]});await store.syncWith(remote)
  const path=remote.pathFor('relation','known-later');remote.files.delete(path)
  const before=store.snapshot();await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'conflict');assert.match(store.storage().message,/missing/i)
  assert.deepEqual(store.snapshot().workspace,before.workspace);assert.equal(remote.files.has(path),false)
})

test('corrupt cloud documents cannot replace the saved local planner or be overwritten by retry',async t=>{
  const {store}=await device(t),remote=cloud();await store.syncWith(remote)
  const path=`${remote.manifest().generation}/settings.json`
  remote.mutate(path,document=>({...document,version:99}))
  const before=store.snapshot(),writes=remote.writes.length;await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'error');assert.match(store.storage().message,/format|invalid/i)
  assert.deepEqual(store.snapshot().workspace,before.workspace);assert.equal(remote.writes.length,writes)
})

test('independent edits from older PCs import forward without replacing newer folder links',async t=>{
  const legacy=createPlannerWorkspace(),remote=cloud(legacy),{store}=await device(t)
  await store.syncWith(remote)
  await change(store,w=>{w.relations=[link('folder-link')]});await store.syncWith(remote)
  remote.mutateLegacy(w=>{w.properties.oldPC={value:'import me'};w.relations=[link('legacy-link')];return w})
  const original=JSON.stringify(remote.legacy());await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'synced',store.storage().message)
  assert.deepEqual(new Set(remote.data().relations.map(item=>item.id)),new Set(['folder-link','legacy-link']))
  assert.equal(remote.data().properties.oldPC.value,'import me');assert.equal(JSON.stringify(remote.legacy()),original)
  assert.deepEqual(remote.files.get(`${remote.manifest().generation}/legacy-import.json`).document.workspace,remote.legacy())
  const count=remote.writes.length;await store.syncWith(remote);assert.equal(remote.writes.length,count,'Accepted legacy imports are not replayed')
})

test('conflicting same-field changes from older PCs preserve both values and report the affected field',async t=>{
  const legacy=createPlannerWorkspace();legacy.properties.task={estimate:30}
  const remote=cloud(legacy),{store}=await device(t);await store.syncWith(remote)
  await change(store,w=>{w.properties.task.estimate=45});await store.syncWith(remote)
  remote.mutateLegacy(w=>{w.properties.task.estimate=60;return w})
  const before=store.snapshot(),count=remote.writes.length;await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'conflict');assert.match(store.storage().message,/older Nextspace|Update Nextspace/)
  assert.match(store.storage().message,/properties.task.estimate/)
  assert.equal(remote.legacy().properties.task.estimate,60);assert.equal(remote.data().properties.task.estimate,45)
  assert.deepEqual(store.snapshot().workspace,before.workspace);assert.equal(remote.writes.length,count)
})

test('legacy import receipts advance only after data acknowledgment and resume after a failed receipt save',async t=>{
  const legacy=createPlannerWorkspace(),remote=cloud(legacy),{store}=await device(t);await store.syncWith(remote)
  const receipt=`${remote.manifest().generation}/legacy-import.json`,beforeReceipt=clone(remote.files.get(receipt))
  remote.mutateLegacy(w=>{w.relations=[link('late-old-link')];w.properties.imported={value:7};return w})
  remote.beforeWrite=path=>{if(path===receipt)throw Error('Fixture lost connection before import receipt')}
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'error');assert.deepEqual(remote.files.get(receipt),beforeReceipt)
  assert.equal(remote.data().relations[0].id,'late-old-link','The preceding data writes were acknowledged')
  const count=remote.writes.length;remote.beforeWrite=null;await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'synced',store.storage().message)
  assert.equal(remote.writes.length-count,1,'Only the pending receipt needs to be saved on retry')
  assert.deepEqual(remote.files.get(receipt).document.workspace,remote.legacy())
  assert.equal(store.snapshot().workspace.properties.imported.value,7)
})

test('weak or unavailable file versions report a server-version error without guessing that another PC is writing',async t=>{
  const {store}=await device(t),remote=cloud();await store.syncWith(remote)
  await change(store,w=>{w.properties.local={keep:true}})
  remote.listVersion=(path,etag)=>`W/${etag}`
  const before=store.snapshot(),count=remote.writes.length;await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'error');assert.match(store.storage().message,/strong version|ETag/)
  assert.doesNotMatch(store.storage().message,/kept changing|other device finishes/)
  assert.deepEqual(store.snapshot().workspace,before.workspace);assert.equal(remote.writes.length,count)
})

test('two migrations sharing a baseline publish one generation and merge each device’s edits',{timeout:15000},async t=>{
  const a=await device(t),b=await device(t),remote=cloud(createPlannerWorkspace())
  await a.store.syncWith(remote.legacyClient);await b.store.syncWith(remote.legacyClient)
  await change(a.store,w=>{w.properties.a={value:1}});await change(b.store,w=>{w.properties.b={value:2}})
  let arrivals=0,release
  const barrier=new Promise(resolve=>release=resolve)
  remote.beforeWrite=async path=>{if(path==='manifest.json'){if(++arrivals===2)release();await barrier}}
  await Promise.all([a.store.syncWith(remote),b.store.syncWith(remote)])
  assert.equal(a.store.storage().syncStatus,'synced',a.store.storage().message)
  assert.equal(b.store.storage().syncStatus,'synced',b.store.storage().message)
  assert.equal(remote.writes.filter(write=>write.path==='manifest.json').length,1)
  assert.deepEqual(remote.data().properties,{a:{value:1},b:{value:2}})
  await a.store.syncWith(remote)
  assert.deepEqual(a.store.snapshot().workspace.properties,remote.data().properties)
})

test('unchanged document bodies are reused from versioned cache while changed files are reread',async t=>{
  const remote=cloud(),adapter=new FolderWorkspaceClient(remote),workspace=createPlannerWorkspace()
  workspace.properties.task={value:1}
  const first=await adapter.readWorkspace(),written=await adapter.writeWorkspace(workspace,first.etag)
  written.workspace.properties.task.value=999
  const list=remote.listPlannerFiles;let inventories=0;remote.listPlannerFiles=async directory=>{inventories++;return list(directory)}
  const before=remote.reads.length,warm=await adapter.readWorkspace()
  assert.equal(warm.workspace.properties.task.value,1,'Caller mutations cannot change the certified remote snapshot')
  assert.equal(inventories,2,'One fresh root and one property directory; no duplicate certification scan for an identical snapshot')
  const receipt=`${remote.manifest().generation}/legacy-import.json`
  assert.deepEqual(remote.reads.slice(before),['manifest.json',receipt])
  const path=remote.pathFor('property','task');remote.mutate(path,document=>{document.value.value=2;return document})
  const reread=remote.reads.length,result=await adapter.readWorkspace()
  assert.equal(inventories,6,'A changed validator requires both complete inventories')
  assert.deepEqual(remote.reads.slice(reread).sort(),['manifest.json',receipt,path].sort())
  assert.equal(result.workspace.properties.task.value,2)
  adapter.setCheckpoint(adapter.checkpointValue());remote.files.delete(path)
  await assert.rejects(adapter.readWorkspace(),/previously saved planner file is missing/)
})

test('the folder checkpoint is durable and a missing manifest cannot fall back to stale legacy data',async t=>{
  const {store,dataDir}=await device(t),remote=cloud(createPlannerWorkspace());await store.syncWith(remote)
  const file=JSON.parse(await readFile(store.path,'utf8'));assert.equal(file.sync.folder.generation,remote.manifest().generation)
  remote.files.delete('manifest.json')
  const reopened=await WorkspaceStore.open({dataDir,scope,initialState:initialState()}),before=reopened.snapshot()
  await reopened.syncWith(remote)
  assert.equal(reopened.storage().syncStatus,'conflict');assert.match(reopened.storage().message,/manifest was removed/)
  assert.deepEqual(reopened.snapshot().workspace,before.workspace);assert.equal(remote.manifest(),undefined)
})

test('concurrent opposite dependencies cannot publish a cyclic cloud graph',{timeout:15000},async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  await change(a.store,w=>{w.relations=[{id:'a-waits-b',type:'depends_on',fromId:'task-a',toId:'task-b'}]})
  await change(b.store,w=>{w.relations=[{id:'b-waits-a',type:'depends_on',fromId:'task-b',toId:'task-a'}]})
  const path=`${remote.manifest().generation}/dependencies.json`
  let arrivals=0,release
  const barrier=new Promise(resolve=>release=resolve)
  remote.beforeWrite=async target=>{if(target===path){if(++arrivals===2)release();await barrier}}
  await Promise.all([a.store.syncWith(remote),b.store.syncWith(remote)])
  assert.deepEqual(new Set([a.store.storage().syncStatus,b.store.storage().syncStatus]),new Set(['synced','conflict']))
  const saved=remote.data().relations
  assert.equal(saved.length,1,'Only one direction may reach the cloud; assembleWorkspace also validates acyclicity')
  assert.equal(remote.writes.filter(write=>write.path===path).length,2,'Initial graph plus one acknowledged edge')
  assert.equal([...remote.files.keys()].some(path=>path.includes('/links/')),false,'Metadata dependencies use one atomic graph document')
  const failed=[a.store,b.store].find(store=>store.storage().syncStatus==='conflict')
  assert.equal(failed.snapshot().workspace.relations.length,1,'The rejected local edge remains available for review')
})

test('a native key move keeps one UUID and all references through a partially acknowledged upload',async t=>{
  const {store}=await device(t),remote=cloud()
  await store.updateCache(cache([nativeRecord('native-task','calendar-A:task-UID',['uid:task-UID'])]))
  const id=store.snapshot().cache.records[0].id
  await change(store,w=>{w.relations=[link('task-note',id)];w.properties[id]={estimate:20}})
  await store.syncWith(remote)
  await store.updateCache(cache([nativeRecord('moved-native-task','calendar-B:task-UID',['uid:task-UID'])]))
  assert.equal(store.snapshot().cache.records[0].id,id)
  await change(store,w=>{w.properties[id].estimate=40})
  let count=0
  remote.beforeWrite=()=>{if(++count===2)throw Error('Fixture disconnect after identity registry acknowledgment')}
  await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'error')
  const partial=remote.data()
  assert.equal(partial.identities.length,1);assert.equal(partial.identities[0].id,id);assert.equal(partial.identities[0].key,'calendar-B:task-UID')
  assert.equal(partial.relations[0].fromId,id);assert.equal(partial.properties[id].estimate,20)
  remote.beforeWrite=null;await store.syncWith(remote)
  assert.equal(store.storage().syncStatus,'synced',store.storage().message)
  assert.equal(remote.data().identities.length,1);assert.equal(remote.data().properties[id].estimate,40)
  assert.equal(remote.data().relations[0].fromId,id);assert.equal(store.snapshot().cache.records[0].id,id)
  assert.equal([...remote.files.keys()].some(path=>path.includes('/identities/')),false,'A move never splits the registry across source-key buckets')
})

test('independently discovered UUIDs for one native item converge with links and attributes intact',async t=>{
  const a=await device(t),b=await device(t),remote=cloud()
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  const native=nativeRecord('native-task','calendar:shared-task',['uid:shared-task'])
  await a.store.updateCache(cache([native]));await b.store.updateCache(cache([native]))
  const aId=a.store.snapshot().cache.records[0].id,bId=b.store.snapshot().cache.records[0].id
  assert.notEqual(aId,bId)
  await change(a.store,w=>{w.relations=[link('shared-note',aId)]})
  await change(b.store,w=>{w.properties[bId]={estimate:75};w.plans=[{id:'booked',recordId:bId,start:'2026-11-11T09:00:00Z',end:'2026-11-11T10:00:00Z'}]})
  await a.store.syncWith(remote);await b.store.syncWith(remote)
  assert.equal(b.store.storage().syncStatus,'synced',b.store.storage().message)
  const saved=remote.data()
  assert.equal(saved.identities.length,1);assert.equal(saved.identities[0].id,aId)
  assert.equal(saved.properties[aId].estimate,75);assert.equal(saved.properties[bId],undefined)
  assert.equal(saved.relations[0].fromId,aId);assert.equal(saved.plans[0].recordId,aId)
  assert.equal(b.store.snapshot().cache.records[0].id,aId)
})
