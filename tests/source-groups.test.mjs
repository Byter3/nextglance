import test from 'node:test'
import assert from 'node:assert/strict'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {addSuggestedGroups,sourceGroupNameError,spaceSourceIds} from '@nextspace/core/source-groups.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'

function workspace(){const value=createPlannerWorkspace();value.spaces=[{id:'first',name:'First',color:'#123456',collectionIds:['calendar']},{id:'second',name:'Second',color:'#654321',collectionIds:['calendar']}];return value}
test('accepted presets use independent IDs/owners, start empty and never mutate original organization',()=>{
  const original=workspace(),before=structuredClone(original);let sequence=0
  let draft=addSuggestedGroups(original,'first',['personal','shared'],()=>`group-${++sequence}`)
  draft=addSuggestedGroups(draft,'second',['personal'],()=>`group-${++sequence}`)
  assert.deepEqual(original,before)
  assert.deepEqual(draft.categories.map(group=>[group.id,group.spaceId,group.name,group.collectionIds]),[['group-1','first','Personal',[]],['group-2','first','Shared',[]],['group-3','second','Personal',[]]])
  draft.categories[0].name='Private life';draft.categories[0].collectionIds=['calendar']
  assert.equal(draft.categories[2].name,'Personal');assert.deepEqual(draft.categories[2].collectionIds,[])
  validateWorkspace(draft)
})
test('existing normalized names avoid duplicate presets; invalid UUID reuse is rejected',()=>{
  const original=workspace();original.categories=[{id:'already',spaceId:'first',name:' PERSONAL ',color:'#123456',collectionIds:['calendar']}]
  const draft=addSuggestedGroups(original,'first',['personal','unknown'],()=>{throw Error('No ID should be allocated')})
  assert.deepEqual(draft,original)
  assert.throws(()=>addSuggestedGroups(original,'missing',['work']),/available Space/)
  assert.throws(()=>addSuggestedGroups(original,'first',['work'],()=> 'already'),/unique identity/)
  original.categories.push({id:'duplicate',spaceId:'first',name:'Personal',color:'#654321',collectionIds:[]})
  assert.match(sourceGroupNameError(original,'first'),/different name/)
  assert.equal(sourceGroupNameError(original,'second'),'')
})
test('Space source editing retains unavailable group/project selections but not other Spaces sources',()=>{
  const value=workspace();value.categories=[{id:'g',spaceId:'first',name:'Retained',color:'#123456',collectionIds:['missing']},{id:'g2',spaceId:'second',name:'Other',color:'#654321',collectionIds:['foreign']}]
  value.projects=[{id:'p',spaceId:'first',name:'Project',collectionIds:['project-source'],recordIds:['curated-item']}]
  assert.deepEqual(spaceSourceIds(value,'first'),['calendar','missing','project-source'])
  assert.deepEqual(spaceSourceIds(value,'missing-space'),[])
})
