import test from 'node:test'
import assert from 'node:assert/strict'
import {WorkspaceStore} from '@nextspace/nextcloud-node/workspace.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'

function memoryStore() {
  const store=new WorkspaceStore(),workspace=createPlannerWorkspace()
  const records=[
    {id:'note',source:'notes',kind:'note',title:'Brief',body:'Current text',tags:['Favorite'],remote:{nativeId:1,category:'Work'},identity:{source:'notes',key:'native-note'}},
    {id:'card',source:'deck',kind:'card',title:'Delivery',attachmentFileIds:['1'],remote:{nativeId:2,snapshot:{description:'Private native snapshot'}},identity:{source:'deck',key:'native-card'}},
  ]
  workspace.identities=records.map(record=>({id:record.id,...record.identity}))
  store.value={schemaVersion:1,revision:7,workspace,cache:{records,collections:[{id:'notes',source:'notes',title:'Notes',remote:{path:'/private'}}],statuses:[{source:'notes',state:'connected',count:1}]},sync:{status:'synced',baseWorkspace:structuredClone(workspace),folder:{generation:'test',paths:[]}}}
  store.queue=Promise.resolve();store.recordAliases=new Map([['old-note','note']])
  let writes=0
  store.commit=async(next,options)=>{writes++;store.value=next;return options?.returnSnapshot===false?undefined:store.snapshot()}
  return {store,writes:()=>writes}
}

test('public snapshot strips private source data before cloning and owns every returned mutable field',()=>{
  const {store}=memoryStore()
  // This sentinel cannot be cloned: public reads must not traverse native data
  // merely to discard it afterwards. Persisted native data is always plain JSON.
  store.value.cache.records[0].remote.privateSentinel=()=>{}
  const result=store.publicSnapshot()
  assert.equal(result.sync,undefined)
  assert.ok(result.cache.records.every(record=>!('remote' in record)&&!('identity' in record)))
  assert.ok(!('remote' in result.cache.collections[0]))
  result.cache.records[0].body='Changed copy';result.workspace.name='Changed planner';result.cache.statuses[0].state='error'
  assert.equal(store.value.cache.records[0].body,'Current text')
  assert.notEqual(store.value.workspace.name,'Changed planner')
  assert.equal(store.value.cache.statuses[0].state,'connected')
})

test('selection reads only the requested native record or collection and preserves alias and source checks',()=>{
  const {store}=memoryStore()
  store.value.cache.records[1].remote.privateSentinel=()=>{}
  const note=store.recordSnapshot('old-note','notes')
  assert.equal(note.id,'note');assert.equal(note.remote.nativeId,1)
  note.body='Caller draft';assert.equal(store.value.cache.records[0].body,'Current text')
  assert.equal(store.recordSnapshot('old-note','deck'),undefined)
  assert.equal(store.recordSnapshot('missing'),undefined)
  const collection=store.collectionSnapshot('notes','notes');collection.remote.path='Changed'
  assert.equal(store.value.cache.collections[0].remote.path,'/private')
  assert.equal(store.collectionSnapshot('notes','deck'),undefined)
  const statuses=store.statusSnapshot();statuses[0].state='error';assert.equal(store.value.cache.statuses[0].state,'connected')
})

test('reopening unchanged attachments or note tags does not persist or clone the full envelope',async()=>{
  const {store,writes}=memoryStore(),tag={id:'tag',title:'Research',assignable:true}
  const metadata={fileTags:[tag],tagDetails:[tag],tags:['Favorite','Research']}
  store.snapshot=()=>{throw Error('Inspector metadata must not clone the full persisted envelope')}
  assert.equal(await store.updateRecordMetadata('old-note',metadata),true)
  assert.equal(writes(),1)
  for(let i=0;i<100;i++){
    assert.equal(await store.updateRecordMetadata('note',structuredClone(metadata)),false)
    assert.equal(await store.updateRecordMetadata('card',{attachmentFileIds:['1']}),false)
  }
  assert.equal(writes(),1)
  assert.equal(store.value.revision,7)
  assert.equal(store.value.sync.status,'synced')
  assert.equal(store.value.workspace.identities.length,2)
})

test('metadata commits use the latest locked record and cannot recreate revoked items or change identity/planning',async()=>{
  const {store,writes}=memoryStore()
  let release;const gate=new Promise(resolve=>release=resolve)
  const earlier=store.exclusive(async()=>{await gate;store.value.cache.records[0].body='Newer text';store.value.cache.records[0].tags=[]})
  const update=store.updateRecordMetadata('note',record=>({fileTags:[],tagDetails:[],tags:record.tags?.includes('Favorite')?['Favorite']:[]}))
  release();await earlier;await update
  assert.equal(store.value.cache.records[0].body,'Newer text');assert.deepEqual(store.value.cache.records[0].tags,[])
  await assert.rejects(store.updateRecordMetadata('note',{body:'Overwrite'}),/Only native/)
  await assert.rejects(store.updateRecordMetadata('note',{id:'Another'}),/Only native/)
  await assert.rejects(store.updateRecordMetadata('card',{tags:['Not a card tag update']}),/Only native/)
  const before=writes();store.value.cache.records=[]
  assert.equal(await store.updateRecordMetadata('note',{fileTags:[]}),false)
  assert.equal(writes(),before)
  assert.deepEqual(store.value.cache.records,[])
})
