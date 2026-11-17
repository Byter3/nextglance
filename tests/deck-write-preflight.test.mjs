import test from 'node:test'
import assert from 'node:assert/strict'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'

const card={id:7,stackId:3,title:'Draft',description:'Keep content',type:'plain',order:4,lastModified:10,dependentCards:[8],archived:false,deletedAt:0}
const owner={id:'owner',source:'deck',collectionId:'board',remote:{nativeId:7,boardId:2,stackId:3,snapshot:card}}
const prerequisite={id:'prerequisite',source:'deck',readonly:true,remote:{nativeId:8,boardId:9,stackId:10}}
const board={id:'board',source:'deck',stacks:[{id:'4',title:'Review'}],remote:{nativeId:2}}
function fixture({permission=true,stack={id:4,boardId:2},cardPermission,relatedBoard,confirm=true}={}){
  const calls=[]
  let snapshot={...card,...(cardPermission===undefined?{}:{permissions:cardPermission}),...(relatedBoard?{relatedBoard}:{})}
  const client=new NextcloudClient({serverUrl:'https://cloud.example.test',username:'fixture-user',appPassword:'fixture-only'},{fetch:async(url,options={})=>{
    calls.push({url,...options})
    let result
    if(url.endsWith('/boards/2'))result={id:2,labels:[],...(permission==='missing'?{}:{permissions:{PERMISSION_EDIT:permission}})}
    else if(url.endsWith('/stacks/4'))result=stack
    else if(url.endsWith('/labels'))result={id:17,boardId:2,title:'Project',color:'0082c9'}
    else if(url.endsWith('/reorder')){if(confirm)snapshot={...snapshot,stackId:Number(url.match(/\/stacks\/(\d+)\//)[1])};result=[snapshot]}
    else if(url.endsWith('/dependentCards/8')){if(confirm)snapshot={...snapshot,dependentCards:options.method==='DELETE'?[]:[8]};result=snapshot}
    else if(/\/cards\/7$/.test(url))result=snapshot
    else throw Error('Unexpected fixture URL '+url)
    return new Response(JSON.stringify(result))
  }})
  return {client,calls}
}
const writes=calls=>calls.filter(call=>['POST','PUT','DELETE'].includes(call.method))

test('missing or ambiguous fresh board permissions cannot authorize dependency or label writes',async()=>{
  for(const permission of ['missing',null,false,'true',1]){
    for(const operation of ['dependency','label']){
      const {client,calls}=fixture({permission})
      await assert.rejects(operation==='dependency'?client.setDeckDependency({remove:true},owner,prerequisite):client.createDeckLabel({title:'Project'},board),{code:'PERMISSION'})
      assert.deepEqual(writes(calls),[])
    }
  }
})
test('dependency validates the owning board when returned relatedBoard permission belongs elsewhere',async()=>{
  const {client,calls}=fixture({permission:false,relatedBoard:{id:999,permissions:{PERMISSION_EDIT:true}}})
  await assert.rejects(client.setDeckDependency({remove:true},owner,prerequisite),{code:'PERMISSION'})
  assert.equal(calls.some(call=>call.url.endsWith('/boards/2')),true)
  assert.deepEqual(writes(calls),[])
  const moved=fixture({permission:false,relatedBoard:{id:999,permissions:{PERMISSION_EDIT:true}}})
  await assert.rejects(moved.client.moveCard({stackId:'4'},owner,board),{code:'PERMISSION'})
  assert.deepEqual(writes(moved.calls),[])
})
test('native dependency removal verifies ownership, leaves prerequisite untouched and is idempotent',async()=>{
  const {client,calls}=fixture()
  const saved=await client.setDeckDependency({remove:true},owner,prerequisite)
  assert.deepEqual(saved.dependentCards,[]);assert.equal(saved.description,card.description)
  await client.setDeckDependency({remove:true},owner,prerequisite)
  assert.equal(writes(calls).length,1)
  assert.equal(writes(calls)[0].method,'DELETE')
  assert.ok(writes(calls)[0].url.endsWith('/boards/2/stacks/3/cards/7/dependentCards/8'))
})
test('a cached destination stack moved to another board or deleted cannot receive a card',async()=>{
  for(const stack of [{id:4,boardId:99},{id:99,boardId:2},{id:4,boardId:2,deletedAt:10}]){
    const {client,calls}=fixture({stack})
    await assert.rejects(client.moveCard({stackId:'4'},owner,board),{code:'CONFLICT'})
    assert.deepEqual(writes(calls),[])
  }
})
test('stack moves require native confirmation and use only the granular reorder payload',async()=>{
  const okay=fixture()
  assert.equal((await okay.client.moveCard({stackId:'4'},owner,board)).stackId,4)
  assert.deepEqual(JSON.parse(writes(okay.calls)[0].body),{stackId:4,order:99999})
  assert.ok(writes(okay.calls)[0].url.endsWith('/stacks/4/cards/7/reorder'))
  assert.ok(okay.calls.at(-1).url.endsWith('/stacks/4/cards/7'))
  const failed=fixture({confirm:false})
  await assert.rejects(failed.client.moveCard({stackId:'4'},owner,board),{code:'UNAVAILABLE'})
  assert.equal(writes(failed.calls).length,1)
})
