import test from 'node:test'
import assert from 'node:assert/strict'
import {NextcloudClient} from '@nextspace/nextcloud-node/nextcloud.mjs'

// Real Deck route precedence and return shape, not an invented object response:
// https://github.com/nextcloud/deck/blob/stable34/lib/Controller/CardApiController.php
// https://github.com/nextcloud/deck/blob/stable34/lib/Service/CardService.php
// https://github.com/nextcloud/server/blob/stable34/lib/private/AppFramework/Http/Request.php
const initial={id:7,stackId:3,title:'Proposal',description:'Keep the brief',type:'plain',owner:'example',order:8,done:null,startdate:null,duedate:null,color:'0082c9',lastModified:10,labels:[{id:20,title:'Project',color:'0082c9'}],assignedUsers:[{participant:{uid:'example'},type:0}],dependentCards:[8],archived:false,deletedAt:0,permissions:{PERMISSION_EDIT:true}}
const collection={id:'board',source:'deck',title:'Projects',stacks:[{id:'3',title:'Ready'},{id:'4',title:'Doing'}],remote:{nativeId:2}}
const record=()=>({id:'card',source:'deck',collectionId:'board',readonly:false,etag:'"card-10"',remote:{nativeId:7,boardId:2,stackId:3,snapshot:structuredClone(initial)}})
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers})
function fixture({ack='array',readback,failWrite=false}={}){
  let card=structuredClone(initial),wrote=false
  const requests=[]
  const client=new NextcloudClient({serverUrl:'https://cloud.example.test',username:'example',appPassword:'fixture-only'},{fetch:async(url,options={})=>{
    const path=new URL(url).pathname,method=options.method||'GET',headers=new Headers(options.headers)
    requests.push({path,method,headers,body:options.body})
    const stack=path.match(/\/stacks\/(\d+)$/)
    if(stack)return json({id:Number(stack[1]),boardId:2,deletedAt:0})
    const match=path.match(/\/stacks\/(\d+)\/cards\/7(\/reorder)?$/)
    assert.ok(match,'Unexpected request '+path)
    if(method==='GET'){
      // A normal browser/proxy cache would return the old locator/snapshot.
      assert.equal(headers.get('Cache-Control'),'no-cache')
      return json(wrote&&readback?readback(card):card,200,{ETag:`"card-${card.lastModified}"`})
    }
    assert.equal(method,'PUT')
    if(failWrite)return json({},412)
    assert.equal(headers.get('If-Match'),`"card-${card.lastModified}"`)
    const input=JSON.parse(options.body)
    if(match[2]){
      const destination=Number(match[1])
      assert.equal(input.stackId,destination,'The native route overrides body stackId')
      assert.deepEqual(input,{stackId:destination,order:99999})
      card={...card,stackId:destination,order:0,lastModified:card.lastModified+1};wrote=true
      if(ack==='empty')return new Response(null,{status:204})
      return json([{id:99,stackId:destination}, {...card,description:'Sparse acknowledgement; use enriched readback'}])
    }
    card={...card,...input,lastModified:card.lastModified+1}
    return json(card,200,{ETag:`"card-${card.lastModified}"`})
  }})
  return {client,requests,get card(){return card},change(fields){card={...card,...fields}}}
}

test('Deck destination route, array acknowledgement and fresh enriched readback preserve a next-edit baseline',async()=>{
  const f=fixture(),saved=await f.client.moveCard({stackId:'4'},record(),collection)
  assert.equal(saved.stackId,4);assert.equal(saved.order,0);assert.equal(saved.description,initial.description)
  assert.deepEqual(saved.labels,initial.labels);assert.deepEqual(saved.dependentCards,[8]);assert.equal(saved.ETag,'"card-11"')
  const adopted=await f.client.savedRecord(record(),collection,saved)
  assert.equal(adopted.status,'Doing');assert.equal(adopted.remote.stackId,4);assert.equal(adopted.remote.snapshot.lastModified,11);assert.equal(adopted.etag,'"card-11"')
  assert.ok(adopted.identity.locator.endsWith('/stacks/4/cards/7'))
  const edited=await f.client.updateDescription({description:'Updated after move'},adopted)
  const afterEdit=await f.client.savedRecord(adopted,collection,edited)
  const movedBack=await f.client.moveCard({stackId:'3'},afterEdit,collection)
  assert.equal(movedBack.stackId,3);assert.equal(movedBack.description,'Updated after move')
  assert.equal(f.requests.filter(r=>r.path.endsWith('/reorder')).length,2)
})

test('empty native reorder acknowledgement is confirmed by the targeted readback',async()=>{
  const f=fixture({ack:'empty'}),saved=await f.client.moveCard({stackId:'4'},record(),collection)
  assert.equal(saved.stackId,4);assert.equal(saved.ETag,'"card-11"')
  assert.equal(f.requests.length,4)
})

test('readback must identify the requested card in its actual destination',async()=>{
  for(const change of [{id:99},{stackId:3},{archived:true},{deletedAt:1}]){
    const f=fixture({readback:card=>({...card,...change})})
    await assert.rejects(f.client.moveCard({stackId:'4'},record(),collection),{code:'UNAVAILABLE'})
    assert.equal(f.requests.filter(r=>r.method==='PUT').length,1,'Never replay an ambiguous move or overwrite fields')
  }
})

test('genuine stale-card and conditional write conflicts remain protected',async()=>{
  for(const change of [{description:'Edited elsewhere'},{stackId:4},{lastModified:20},{archived:true}]){
    const f=fixture();f.change(change)
    await assert.rejects(f.client.moveCard({stackId:'4'},record(),collection),{code:'CONFLICT'})
    assert.equal(f.requests.some(r=>r.method==='PUT'),false)
  }
  const f=fixture({failWrite:true})
  await assert.rejects(f.client.moveCard({stackId:'4'},record(),collection),{status:412})
  assert.equal(f.requests.filter(r=>r.method==='PUT').length,1)
})

test('a real change after a successful move is not mistaken for the move itself',async()=>{
  const f=fixture(),old=record(),saved=await f.client.moveCard({stackId:'4'},old,collection)
  const adopted=await f.client.savedRecord(old,collection,saved)
  f.change({description:'Collaborator changed the brief',lastModified:12})
  await assert.rejects(f.client.updateDescription({description:'Stale edit'},adopted),{code:'CONFLICT'})
  assert.equal(f.card.description,'Collaborator changed the brief')
  assert.equal(f.requests.filter(r=>r.method==='PUT').length,1)
})
