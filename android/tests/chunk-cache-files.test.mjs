import test from 'node:test'
import assert from 'node:assert/strict'
import {createChunkCacheFiles} from '../src/chunk-cache-files.mjs'
import {chunkPort} from './fixtures/chunk-cache-port.mjs'
const path=`cache/${'a'.repeat(64)}.0.json`

test('cache stat treats bounded canonical prefixes only as generation hints',async()=>{
  for(const [prefix,generation] of [[`{"version":1,"generation":42,"value":{`,42],[`{"version":1,"generation":9007199254740992,"value":{`,undefined],['{"generation":42,"version":1,"value":{',undefined],['x'.repeat(257),undefined]]){
    const files=createChunkCacheFiles(async()=>({size:100,revision:'current',prefix}))
    assert.deepEqual(await files.stat(path),{size:100,revision:'current',...(generation?{generation}:{})})
  }
})
test('private cache codec transfers bounded UTF-8 chunks with exact roundtrip',async()=>{
  const saved=new Map(),calls=[],port=chunkPort({size:async key=>saved.has(key)?Buffer.byteLength(saved.get(key)):null,read:async key=>saved.get(key),write:async(key,text)=>saved.set(key,text),remove:async key=>saved.delete(key)})
  const files=createChunkCacheFiles(args=>{calls.push(args);return port(args)}),value='a'.repeat(262143)+'😀é漢'.repeat(80000)
  assert.equal(await files.read(path),null);await files.write(path,value);assert.equal(await files.read(path),value)
  assert.ok(calls.filter(c=>c.operation==='append').length>2)
  assert.ok(calls.filter(c=>c.operation==='append').every(c=>Buffer.from(c.chunk,'base64').length<=262144))
  await files.remove(path);assert.equal(await files.read(path),null)
})
test('cache codec rejects unsafe paths, mismatched chunk lengths and aborts failed stage',async()=>{
  const calls=[],files=createChunkCacheFiles(async args=>{calls.push(args);if(args.operation==='size')return {size:4,revision:'r'};if(args.operation==='read')return {chunk:'YQ=='};if(args.operation==='beginWrite')return {token:'one'};if(args.operation==='append')throw new Error('Storage failed');return {}})
  await assert.rejects(files.read('../profile'),{code:'SECURITY'});await assert.rejects(files.read(path),{code:'CACHE_FORMAT'});await assert.rejects(files.write(path,'data'),/Storage failed/);assert.equal(calls.at(-1).operation,'abort')
})
