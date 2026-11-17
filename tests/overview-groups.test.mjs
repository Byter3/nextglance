import test from 'node:test'
import assert from 'node:assert/strict'
import {createPlannerWorkspace,selectPlanner,boardCollectionsForScope} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {organizationMembership} from '@nextspace/core/organization-tags.mjs'
import {sourceGroupNameError,spaceSourceIds,addSuggestedGroups,nextSourceGroupDraftId,commitSourceGroupIds,reorderSourceGroups} from '@nextspace/core/source-groups.mjs'
import {removeSourceGroup,removeSpace} from '@nextspace/core/space-organization.mjs'
import {timelineGroups} from '@nextspace/core/timeline.mjs'
import {dependencyCandidates} from '@nextspace/core/relation-picker.mjs'
import {defaultCalendarForRecord} from '@nextspace/core/scheduling.mjs'
import {splitWorkspace,assembleWorkspace} from '@nextspace/nextcloud-client/planner-folder.mjs'
import {mergeWorkspaces} from '@nextspace/core/workspace-merge.mjs'
const group=(id,spaceId,collectionIds=[],tagNames)=>({id,spaceId,name:id,color:'#0082c9',collectionIds,...(tagNames?{tagNames}:{})})
const records=[{id:'a',kind:'task',source:'tasks',title:'Alpha',collectionId:'tasks',tags:['Review']},{id:'b',kind:'card',source:'deck',title:'Beta',collectionId:'board',tags:['Review']},{id:'c',kind:'task',source:'tasks',title:'Other',collectionId:'outside'}]
function workspace(){const value=createPlannerWorkspace();value.spaces=[{id:'space',name:'Work',color:'#0082c9',collectionIds:['tasks']}];value.categories=[group('private','space',['tasks']),group('reviews','all',[],['review']),group('source','all',['board'])];return value}
test('overview groups never inherit Space grouping or hide unmatched records',()=>{
  const value=workspace(),membership=organizationMembership(value,records)
  assert.deepEqual([...membership.scopes.get('all')],['a','b','c']);assert.deepEqual([...membership.categories.get('reviews')],['a','b']);assert.deepEqual([...membership.scopes.get('space')],['a'])
  const groups=timelineGroups(records,{...value,scopeId:'all'})
  assert.deepEqual(groups.map(g=>[g.id,g.records.map(r=>r.id)]),[['category:reviews',['a','b']],['collection:outside',['c']]])
  assert.equal(new Set(groups.flatMap(g=>g.records.map(r=>r.id))).size,3)
  const old=timelineGroups(records,{...value,categories:value.categories.filter(g=>g.spaceId!=='all'),scopeId:'all'});assert.deepEqual(old.map(g=>g.id),['collection:tasks','collection:board','collection:outside'])
  assert.deepEqual(dependencyCandidates(value,records,'reviews').map(r=>r.id),['a','b','c'])
  assert.deepEqual(boardCollectionsForScope(value,records,[{id:'tasks',source:'tasks'},{id:'board',source:'deck'},{id:'outside',source:'tasks'}],'reviews').map(c=>c.id),['tasks','board','outside'])
})
test('overview source assignments and native tag filters retain unavailable sources and validate independent owners',()=>{
  const value=workspace();value.categories.push(group('missing','all',['gone']))
  assert.deepEqual(spaceSourceIds(value,'all',['tasks','board','outside']),['tasks','board','outside','gone']);validateWorkspace(value)
  assert.equal(sourceGroupNameError(value,'all'),'')
  const bad=structuredClone(value);bad.categories.push(group('other','all',['board']));assert.throws(()=>validateWorkspace(bad),/one category/)
  const dup=structuredClone(value);dup.categories.push({...group('other','all'),name:'REVIEWS'});assert.throws(()=>validateWorkspace(dup),/unique/)
  assert.throws(()=>validateWorkspace({...value,projects:[{id:'p',spaceId:'all',name:'Project',collectionIds:[],recordIds:[]}]}),/project space/)
  assert.throws(()=>validateWorkspace({...value,spaces:[{id:'all',name:'Invalid',color:'#0082c9',collectionIds:[]}]}),/reserved/)
  assert.equal(defaultCalendarForRecord(records[0],{...value,categories:[group('g','all',['calendar'])]},[{id:'calendar',source:'calendar'},{id:'other',source:'calendar'}],'g'),'calendar')
  assert.equal(defaultCalendarForRecord(records[0],value,[{id:'calendar',source:'calendar'}],'reviews'),undefined)
})
test('draft groups allocate persistent identities only on Save; reordering/removal stay owner-local',()=>{
  const original=workspace();let ids=0
  const draft=addSuggestedGroups(original,'all',['personal'],()=>nextSourceGroupDraftId(original));assert.equal(ids,0);assert.equal(draft.categories.at(-1).id,'$draft-group:1');assert.equal(original.categories.length,3)
  assert.throws(()=>validateWorkspace(draft),/persistent identity/)
  const committed=commitSourceGroupIds(draft,'all',()=>`new-${++ids}`);assert.equal(ids,1);validateWorkspace(committed)
  const reordered=reorderSourceGroups(committed,'all','new-1',-1);assert.deepEqual(reordered.categories.map(g=>g.id),['private','reviews','new-1','source'])
  assert.deepEqual(removeSpace(committed,'space').categories.map(g=>g.id),['reviews','source','new-1']);assert.throws(()=>removeSpace(committed,'all'),/cannot be removed/)
  committed.planner.arrangements={all:{timelineGroups:['category:reviews']},reviews:{timelineRows:['a']}}
  const removed=removeSourceGroup(committed,'reviews');assert.equal(removed.planner.arrangements.reviews,undefined);assert.ok(removed.planner.arrangements.all);assert.equal(removed.spaces.length,1)
})
test('overview organization and arrangement survive folder protocol and unrelated three-way edits',()=>{
  const base=workspace();base.planner.arrangements={all:{timelineGroups:['category:reviews']}}
  const restored=assembleWorkspace(splitWorkspace(base));assert.deepEqual(restored.categories,base.categories);assert.deepEqual(restored.planner.arrangements,base.planner.arrangements)
  const local=structuredClone(base),remote=structuredClone(base);local.categories[1].name='Ready';remote.spaces[0].name='Professional'
  const merged=mergeWorkspaces(base,local,remote);assert.deepEqual(merged.conflicts,[]);assert.equal(merged.workspace.categories[1].name,'Ready');assert.equal(merged.workspace.spaces[0].name,'Professional')
  remote.categories[1].name='Other';assert.ok(mergeWorkspaces(base,local,remote).conflicts.length)
})
