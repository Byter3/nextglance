import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {migrateDeckNoteLinks}=createRequire(import.meta.url)('../win/electron/note-link-migration.cjs')

const card={id:'card',kind:'card',source:'deck',remote:{nativeId:7}}
const note={id:'note',kind:'note',source:'notes',remote:{nativeId:137}}
const second={id:'other-note',kind:'note',source:'notes',remote:{nativeId:138}}
const task={id:'task',kind:'task',source:'tasks',remote:{uid:'task'}}
const page={id:'page',kind:'page',source:'collectives',remote:{nativeId:30}}
const relation=(id,fromId='card',toId='note',type='reference')=>({id,fromId,toId,type})
function fakeStore(relations){
  let value=structuredClone({workspace:{relations,properties:{keep:{value:'Original'}},identities:[]},revision:5,cache:{records:[card,note,second,task,page]},sync:{baseHash:'base',status:'synced'}})
  let queue=Promise.resolve()
  return {snapshot:()=>structuredClone(value),resolveRecordId:id=>id,exclusive:operation=>{const next=queue.then(operation);queue=next.catch(()=>{});return next},commit:async next=>{value=structuredClone(next);return structuredClone(value)},change:change=>change(value)}
}
const confirmed=async(_card,note)=>({attachments:[{id:'native-share',fileId:String(note.remote.nativeId)}]})

test('Automatic note migration removes both orientations and duplicate custom types only after native acknowledgement',async()=>{
  const store=fakeStore([relation('one'),relation('two','note','card','related'),relation('task-note','task','note'),relation('card-page','card','page'),relation('dependency','card','task','depends_on')])
  let calls=0
  const result=await migrateDeckNoteLinks({store,attach:async(card,note)=>{calls++;return confirmed(card,note)}})
  assert.deepEqual(result,{converted:2,remaining:0,errors:[]});assert.equal(calls,1)
  assert.deepEqual(store.snapshot().workspace.relations.map(item=>item.id),['task-note','card-page','dependency'])
  assert.equal(store.snapshot().revision,6);assert.equal(store.snapshot().sync.status,'pending')
});

test('Native migration preserves concurrent workspace edits and does not depend on an old whole-workspace revision',async()=>{
  const store=fakeStore([relation('one')])
  const result=await migrateDeckNoteLinks({store,attach:async(card,note)=>{
    store.change(latest=>{latest.workspace.properties.keep.value='Edited during request';latest.workspace.relations.push(relation('new-unrelated','task','note'));latest.revision++})
    return confirmed(card,note)
  }})
  assert.equal(result.converted,1)
  assert.equal(store.snapshot().workspace.properties.keep.value,'Edited during request')
  assert.deepEqual(store.snapshot().workspace.relations.map(item=>item.id),['new-unrelated'])
  assert.equal(store.snapshot().revision,7)
});

test('Retargeting custom intent while native attachment is pending cannot delete the new relationship',async()=>{
  const store=fakeStore([relation('one')])
  const result=await migrateDeckNoteLinks({store,attach:async(card,note)=>{store.change(latest=>latest.workspace.relations[0].toId='other-note');return confirmed(card,note)}})
  assert.equal(result.converted,0);assert.equal(result.remaining,1)
  assert.equal(store.snapshot().workspace.relations[0].toId,'other-note')
});

test('Failed or unconfirmed native attachments retain internal retry intent and never claim conversion',async()=>{
  const store=fakeStore([relation('one'),relation('two','card','other-note')])
  const result=await migrateDeckNoteLinks({store,limit:2,attach:async(card,note)=>{if(note.id==='note')throw Error('Permission denied');return {attachments:[]}}})
  assert.equal(result.converted,0);assert.equal(result.remaining,2);assert.equal(result.errors.length,2)
  assert.equal(store.snapshot().revision,5);assert.equal(store.snapshot().workspace.relations.length,2)
});

test('Migration limits bound work and skip unavailable records without removing unrelated intent',async()=>{
  const store=fakeStore([relation('one'),relation('two','card','other-note'),relation('unavailable','card','not-loaded')])
  const first=await migrateDeckNoteLinks({store,attach:confirmed})
  assert.equal(first.converted,1);assert.equal(first.remaining,1)
  const secondPass=await migrateDeckNoteLinks({store,attach:confirmed})
  assert.equal(secondPass.converted,1);assert.equal(secondPass.remaining,0)
  assert.deepEqual(store.snapshot().workspace.relations.map(item=>item.id),['unavailable'])
  await assert.rejects(migrateDeckNoteLinks({store,attach:confirmed,limit:100}),/one and five/)
});

test('Cleanup follows stable native identities when sync canonicalizes application UUIDs',async()=>{
  const store=fakeStore([relation('one')])
  let changed=false
  store.resolveRecordId=id=>changed&&id==='card'?'canonical-card':id
  const result=await migrateDeckNoteLinks({store,attach:async(card,note)=>{
    changed=true;store.change(latest=>{latest.cache.records.find(record=>record.id==='card').id='canonical-card';latest.workspace.relations[0].fromId='canonical-card'})
    return confirmed(card,note)
  }})
  assert.equal(result.converted,1);assert.equal(result.remaining,0)
});

test('Retry after cleanup failure reuses acknowledged native attachment without losing other changes',async()=>{
  const store=fakeStore([relation('one')]),commit=store.commit
  let fail=true,attachments=[]
  store.commit=async next=>{if(fail){fail=false;throw Error('Disk temporarily busy')}return commit(next)}
  const attach=async(card,note)=>{if(!attachments.length)attachments=(await confirmed(card,note)).attachments;return {attachments}}
  assert.equal((await migrateDeckNoteLinks({store,attach})).converted,0)
  store.change(latest=>latest.workspace.properties.keep.value='Still preserved')
  assert.equal((await migrateDeckNoteLinks({store,attach})).converted,1)
  assert.equal(attachments.length,1);assert.equal(store.snapshot().workspace.properties.keep.value,'Still preserved')
});
