import test from 'node:test'
import assert from 'node:assert/strict'
import {createPreviewAttachments} from '../src/preview-attachments.mjs'

test('preview upload keeps picked bytes in host memory and consumes the account-bound token',async()=>{
  const file=new File(['fixture'],'brief.txt'),calls=[]
  const host=createPreviewAttachments({pick:async()=>file,newToken:()=> 'fixture-token',fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.endsWith('session')?{token:'session'}:{uploaded:true}))}})
  const chosen=await host.chooseAttachment({accountName:'account'})
  assert.deepEqual(chosen,{token:'fixture-token',name:'brief.txt',size:7})
  assert.deepEqual(await host.uploadAttachment({accountName:'account',token:chosen.token,boardId:1,stackId:2,cardId:3}),{uploaded:true})
  assert.equal(calls[1].options.body.get('file').name,'brief.txt')
  assert.equal(await calls[1].options.body.get('file').text(),'fixture')
  assert.equal(calls[1].options.headers['X-NextGlance-Token'],'session')
  await assert.rejects(host.uploadAttachment({accountName:'account',token:chosen.token,boardId:1,stackId:2,cardId:3}),{code:'CANCELLED'})
})

test('picker cancellation, replacement, expiry and reentry cannot upload an unintended file',async()=>{
  let resolve,time=0
  const host=createPreviewAttachments({pick:()=>new Promise(done=>{resolve=done}),now:()=>time,newToken:()=> 'fixture-token',fetchImpl:()=>assert.fail('No upload expected')})
  const first=host.chooseAttachment({accountName:'account'})
  await assert.rejects(host.chooseAttachment({accountName:'other'}),{code:'LIMIT'})
  resolve(undefined);assert.deepEqual(await first,{cancelled:true})
  const pending=host.chooseAttachment({accountName:'account'});host.clear();resolve(new File(['x'],'note.txt'));await assert.rejects(pending,{code:'CANCELLED'})
  const next=host.chooseAttachment({accountName:'account'});resolve(new File(['x'],'note.txt'));const chosen=await next
  time=300001;await assert.rejects(host.uploadAttachment({...chosen,accountName:'account',boardId:1,stackId:2,cardId:3}),{code:'CANCELLED'})
})
