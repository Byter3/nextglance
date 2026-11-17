import test from 'node:test'
import assert from 'node:assert/strict'
import {createSlotCache} from '../src/cache.mjs'
import {createSourceEdits, checkedSourceEdits} from '../src/source-edits.mjs'
import {compactSourceCache, sourceCacheValidator} from '../src/foundation.mjs'

const key='a'.repeat(64), overlayKey='b'.repeat(64), serverUrl='https://cloud.example'
const collection={id:'notes',source:'notes',title:'Notes',remote:{category:''}}
const record=(i=1,title='Saved')=>({id:`note-${i}`,source:'notes',kind:'note',title,body:'',collectionId:'notes',identity:{source:'notes',key:`note/${i}`},remote:{nativeId:i,category:''},etag:'one'})
const archive=(records=[record()],acknowledgedSequence=0)=>compactSourceCache({accountKey:key,records,collections:[collection],statuses:[],acknowledgedSequence})
function fixture(){
  const files=new Map(),writes=[],reads=[]
  const io={size:async path=>files.has(path)?Buffer.byteLength(files.get(path)):null,read:async path=>{reads.push(path);return files.get(path)??null},write:async(path,text)=>{writes.push({path,bytes:Buffer.byteLength(text)});files.set(path,text)},remove:async path=>{files.delete(path)}}
  const cache=createSlotCache(io)
  const store=(next=cache)=>createSourceEdits({cache:next,key:overlayKey,accountKey:key,serverUrl})
  return{files,writes,reads,io,cache,store,restart:()=>createSlotCache(io)}
}
const saveOptions={isCurrent:()=>true,fold:()=>assert.fail('Unexpected archive capacity fold')}

test('newest archive corruption recovers acknowledged edits from retained overlay and old archive',async()=>{
  const f=fixture(),store=f.store();await store.load()
  await f.cache.load(key,sourceCacheValidator(key,serverUrl));await f.cache.save(key,archive([record(1,'Before')]))
  await store.save(record(1,'Acknowledged'),collection,0,saveOptions)
  await f.cache.save(key,archive([record(1,'Acknowledged')],1))
  f.files.set(`cache/${key}.1.json`,'broken latest archive')
  const cache=f.restart(),restored=f.store(cache);await restored.load()
  const previous=await cache.load(key,sourceCacheValidator(key,serverUrl)),combined=restored.apply(previous)
  assert.equal(previous.records[0].title,'Before');assert.equal(combined.records[0].title,'Acknowledged');assert.equal(combined.acknowledgedSequence,1)
  await restored.save(record(1,'Next'),collection,combined.acknowledgedSequence,saveOptions)
  assert.equal((await cache.load(overlayKey)).sequence,2)
})

test('archive watermark prevents an old overlay from overwriting newer native refresh data',async()=>{
  const f=fixture(),store=f.store();await store.load();await store.save(record(1,'Edit'),collection,0,saveOptions)
  const state={records:[record(1,'Later remote change')],collections:[collection],acknowledgedSequence:1}
  assert.equal(store.apply(state).records[0].title,'Later remote change')
})

test('capacity retirement requires two durable archive rotations and preserves fallback recovery',async()=>{
  const f=fixture(),store=f.store(),entries=Array.from({length:128},(_,i)=>({sequence:i+1,record:record(i+1),collection}))
  await f.cache.save(overlayKey,{version:1,accountKey:key,sequence:128,entries});await store.load()
  await f.cache.load(key,sourceCacheValidator(key,serverUrl));await f.cache.save(key,archive([]))
  let folds=0
  await store.save(record(129),collection,128,{isCurrent:()=>true,fold:async sequence=>{folds++;await f.cache.save(key,archive(Array.from({length:129},(_,i)=>record(i+1)),sequence))}})
  assert.equal(folds,2);assert.deepEqual((await f.cache.load(overlayKey)).entries,[])
  for(const corrupt of [0,1]){
    const copy=new Map(f.files);f.files.set(`cache/${key}.${corrupt}.json`,'corrupt')
    const saved=await f.restart().load(key,sourceCacheValidator(key,serverUrl));assert.equal(saved.acknowledgedSequence,129);assert.equal(saved.records.length,129)
    f.files.clear();for(const pair of copy)f.files.set(...pair)
  }
})

test('failed second archive rotation never clears the covered overlay',async()=>{
  const f=fixture(),store=f.store(),entries=Array.from({length:128},(_,i)=>({sequence:i+1,record:record(i+1),collection}))
  await f.cache.save(overlayKey,{version:1,accountKey:key,sequence:128,entries});await store.load();let folds=0
  await assert.rejects(store.save(record(129),collection,128,{isCurrent:()=>true,fold:async()=>{if(++folds===2)throw new Error('Full')}}),/Full/)
  assert.equal((await f.cache.load(overlayKey)).entries.length,128)
})

test('nonmissing corrupt overlay and cross-account data cannot be treated as an empty store',async()=>{
  const f=fixture(),store=f.store();await f.cache.save(overlayKey,{version:1,accountKey:'other',sequence:0,entries:[]})
  await assert.rejects(store.load());assert.equal(store.invalid,true)
  await assert.rejects(store.save(record(),collection,0,saveOptions));assert.throws(()=>store.apply({records:[],collections:[]}))
  assert.equal((await f.restart().load(overlayKey)).accountKey,'other')
})

test('a corrupted latest overlay cannot silently fall back to an older acknowledged edit',async()=>{
  const f=fixture(),store=f.store();await store.load()
  await store.save(record(1,'First'),collection,0,saveOptions);await store.save(record(1,'Second'),collection,0,saveOptions)
  f.files.set(`cache/${overlayKey}.1.json`,'damaged latest edit')
  const before=new Map(f.files),restored=f.store(f.restart())
  await assert.rejects(restored.load(),{code:'CACHE_UNREADABLE'});assert.equal(restored.invalid,true)
  await assert.rejects(restored.save(record(1,'Third'),collection,0,saveOptions));assert.deepEqual(f.files,before)
})

test('revocation clears both overlay generations before a later restart can recover them',async()=>{
  const f=fixture(),store=f.store();await store.load();await store.save(record(),collection,0,saveOptions);await store.save(record(1,'Updated'),collection,0,saveOptions)
  await store.clear();const restored=f.store(f.restart());await restored.load()
  assert.deepEqual(restored.apply({records:[],collections:[],acknowledgedSequence:0}).records,[])
  assert.ok(![...f.files.keys()].some(path=>path.includes(overlayKey)))
})

test('overlay validates unique identity, sequence, collection and native calendar origin',()=>{
  const value={version:1,accountKey:key,sequence:1,entries:[{sequence:1,record:record(),collection}]}
  for(const mutate of [v=>v.entries.push(v.entries[0]),v=>v.sequence=-1,v=>v.entries[0].sequence=2,v=>v.entries[0].record.collectionId='other',v=>v.entries[0].record.identity.source='deck']){
    const candidate=structuredClone(value);mutate(candidate);assert.throws(()=>checkedSourceEdits(candidate,key,serverUrl))
  }
  const task={id:'task',source:'tasks',kind:'task',title:'Task',collectionId:'tasks',identity:{source:'tasks',key:'task'},remote:{href:'https://different.example/remote.php/dav/calendars/user/work/task.ics',raw:'BEGIN:VCALENDAR\nEND:VCALENDAR'}}
  assert.throws(()=>checkedSourceEdits({...value,entries:[{sequence:1,record:task,collection:{id:'tasks',source:'tasks'}}]},key,serverUrl))
})

test('large archived workspace needs only one small durable record write for an acknowledged edit',async t=>{
  const f=fixture(),store=f.store(),records=Array.from({length:7000},(_,i)=>({...record(i+1),body:'Fixture text. '.repeat(80)}))
  await f.cache.save(key,archive(records));await store.load();f.reads.length=0
  const archiveBytes=f.writes[0].bytes
  await store.save({...records[0],title:'Acknowledged edit'},collection,0,saveOptions)
  const overlayBytes=f.writes.at(-1).bytes,archiveReadsDuringEdit=f.reads.filter(path=>path.includes(key)).length
  assert.equal(f.writes.length,2);assert.equal(archiveReadsDuringEdit,0);assert.ok(archiveBytes>overlayBytes*100)
  t.diagnostic(JSON.stringify({fixture:'single-native-edit',records:records.length,archiveBytes,overlayBytes,archiveReadsDuringEdit}))
})

test('overlay rejects incomplete or mismatched native collection and record locators',()=>{
  const calendar=`${serverUrl}/remote.php/dav/calendars/user/work/`
  const cases=[
    {collection,record:record()},
    {collection:{id:'tasks',source:'tasks',remote:{href:calendar}},record:{id:'task',source:'tasks',kind:'task',title:'Task',collectionId:'tasks',identity:{source:'tasks',key:'task'},remote:{href:`${calendar}task.ics`,uid:'task',raw:'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'}}},
    {collection:{id:'board',source:'deck',remote:{nativeId:1},stacks:[{id:2}]},record:{id:'card',source:'deck',kind:'card',title:'Card',collectionId:'board',stackId:'2',identity:{source:'deck',key:'card'},remote:{nativeId:3,boardId:1,stackId:2,snapshot:{id:3,stackId:2,title:'Card',description:''}}}},
  ]
  const envelope=entry=>({version:1,accountKey:key,sequence:1,entries:[{sequence:1,...entry}]})
  for(const entry of cases){
    assert.doesNotThrow(()=>checkedSourceEdits(envelope(entry),key,serverUrl))
    for(const mutate of [v=>{v.record.remote={}},v=>{v.collection.remote={}},v=>{v.record.identity.locator=`${serverUrl}/unrelated`}]){
      const changed=structuredClone(entry);mutate(changed);assert.throws(()=>checkedSourceEdits(envelope(changed),key,serverUrl),{code:'CACHE_FORMAT'})
    }
  }
  const task=structuredClone(cases[1]);task.record.remote.href=`${serverUrl}/remote.php/dav/calendars/user/other/task.ics`
  assert.throws(()=>checkedSourceEdits(envelope(task),key,serverUrl),{code:'CACHE_FORMAT'})
  const card=structuredClone(cases[2]);card.record.remote.snapshot.id=9
  assert.throws(()=>checkedSourceEdits(envelope(card),key,serverUrl),{code:'CACHE_FORMAT'})
})
