import test from 'node:test'
import assert from 'node:assert/strict'
import {knownWorkspaceTags} from '@nextspace/core/known-tags.mjs'

test('Known note tags use loaded work and groupings with native assigned IDs taking precedence',()=>{
  const tags=knownWorkspaceTags([{tags:['Review','Personal'],tagDetails:[{id:'board-label-7',title:'Review',color:'#123456'}]}],[{labels:[{id:'20',title:'Delivery'}]}],{spaces:[{name:'Freelance'}],categories:[{name:'Personal'}],projects:[{name:'Film'},{name:'Retired',archived:true}]},[{id:'77',title:'review',assignable:false}])
  assert.deepEqual(tags.map(tag=>tag.title),['Delivery','Film','Freelance','Personal','review'])
  assert.equal(tags.find(tag=>tag.title==='review').id,'77')
  assert.equal(tags.find(tag=>tag.title==='review').assignable,false)
  assert.equal(tags.find(tag=>tag.title==='Delivery').id,'context:delivery')
})
