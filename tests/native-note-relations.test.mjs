import test from 'node:test'
import assert from 'node:assert/strict'
import {allRelations,scopeRecordIds} from '@nextspace/core/planner.mjs'

test('Deck file attachments project native note links, deduplicate saved links and expand project context',()=>{
  const records=[{id:'card',kind:'card',source:'deck',collectionId:'board',attachmentFileIds:['42','42','90']},{id:'note',kind:'note',source:'notes',fileId:'42'},{id:'unattached',kind:'note',source:'notes',fileId:'43'}]
  const workspace={relations:[{id:'old-local',fromId:'card',toId:'note',type:'reference'}],spaces:[{id:'space',collectionIds:['board']}],projects:[]}
  const links=allRelations(workspace,records)
  assert.equal(links.length,1);assert.equal(links[0].native,true);assert.equal(links[0].label,'Deck attachment')
  assert.deepEqual([...scopeRecordIds(workspace,records,'space')],['card','note'])
  records[0].attachmentFileIds=[]
  assert.equal(allRelations({...workspace,relations:[]},records).length,0)
  assert.equal(allRelations(workspace,records).length,0,'Unpublished card-note planner links are not displayed as attachments')
  assert.equal(allRelations({...workspace,relations:[{id:'reverse',type:'related',fromId:'note',toId:'card'}]},records).length,0,'Reverse generic note links cannot bypass native Deck storage')
})
