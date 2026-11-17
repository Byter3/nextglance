import test from 'node:test'
import assert from 'node:assert/strict'
import {buildNoteContentUpdate} from '../packages/core/src/note-content-edit.mjs'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'

const base = Object.freeze({title:'Brief',content:'Original',category:'Clients/Studio'})
const draft = Object.freeze({id:'note-12',title:'Brief',content:'Edited',category:'Wrong folder',etag:'v1',tags:['Not a category']})
const original = {id:12,title:base.title,content:base.content,category:base.category,etag:'v1',favorite:false}
const record = {id:'note-12',source:'notes',title:base.title,body:base.content,etag:'v1',remote:{nativeId:12,category:base.category}}
const reply = (body,status=200) => new Response(JSON.stringify(body),{status})

test('ordinary content edits whitelist text fields and retain an independent frozen folder baseline',()=>{
  const update=buildNoteContentUpdate(draft,base)
  assert.deepEqual(update,{id:'note-12',title:'Brief',content:'Edited',etag:'v1',base:{...base}})
  update.base.category='Mutation by caller'
  assert.equal(base.category,'Clients/Studio')
  assert.equal(draft.category,'Wrong folder')
})

test('empty and absent native folders stay distinct without adding a desired folder',()=>{
  const empty=buildNoteContentUpdate({...draft,etag:undefined},{...base,category:''})
  assert.equal(Object.hasOwn(empty,'category'),false)
  assert.equal(Object.hasOwn(empty,'etag'),false)
  assert.equal(empty.base.category,'')
  const absent=buildNoteContentUpdate(draft,{title:base.title,content:base.content})
  assert.equal(Object.hasOwn(absent.base,'category'),false)
})

test('content save and reload preserve a native folder without a category or tag write',async()=>{
  const requests=[]
  let server={...original}
  const client=new NextcloudClient({serverUrl:'https://cloud.example.test',username:'user',appPassword:'fixture'},{fetch:async(url,options)=>{
    requests.push(options)
    if(options.method==='PUT'){
      assert.equal(options.headers['If-Match'],'"v1"')
      const patch=JSON.parse(options.body)
      assert.deepEqual(patch,{title:'Brief',content:'Edited'})
      server={...server,...patch,etag:'v2'}
    }
    return reply(server)
  }})
  const saved=await client.updateNote(buildNoteContentUpdate(draft,base),record)
  assert.equal(saved.category,'Clients/Studio')
  assert.equal(saved.content,'Edited')
  const reloaded=await client.readNote(record)
  assert.equal(reloaded.category,'Clients/Studio')
  assert.equal(reloaded.content,'Edited')
  assert.deepEqual(requests.map(request=>request.method||'GET'),['PUT','GET'])
})

test('a concurrent folder move is retained when rebasing an ordinary content edit',async()=>{
  let calls=0
  const remote={...original,title:'Remote title',category:'Archive/Studio',favorite:true,etag:'v2'}
  const client=new NextcloudClient({serverUrl:'https://cloud.example.test',username:'user',appPassword:'fixture'},{fetch:async(url,options)=>{
    if(++calls===1){
      assert.deepEqual(JSON.parse(options.body),{title:'Brief',content:'Edited'})
      return reply(remote,412)
    }
    assert.equal(options.headers['If-Match'],'"v2"')
    assert.deepEqual(JSON.parse(options.body),{content:'Edited'})
    return reply({...remote,content:'Edited',etag:'v3'})
  }})
  const saved=await client.updateNote(buildNoteContentUpdate(draft,base),record)
  assert.equal(saved.category,'Archive/Studio')
  assert.equal(saved.title,'Remote title')
  assert.equal(saved.favorite,true)
  assert.equal(calls,2)
})
