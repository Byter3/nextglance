import test from 'node:test'
import assert from 'node:assert/strict'
import {buildScopeDraft} from '@nextspace/core/scope-editor.mjs'

test('opening and changing a draft never changes organization or view preferences', () => {
  const workspace = {
    spaces: [{id:'space',name:'Work',color:'#0082c9',collectionIds:['calendar']}],
    categories: [{id:'group',spaceId:'space',name:'Client',color:'#123456',collectionIds:['tasks']}],
    projects: [{id:'project',spaceId:'space',categoryId:'group',name:'Film',color:'#abcdef',collectionIds:['deck'],recordIds:['card']}],
    planner: {scopeId:'all',view:'board',hiddenCollectionIds:['hidden']},
  }
  const before = structuredClone(workspace)
  const project = buildScopeDraft(workspace,{kind:'project',id:'project',scopeId:'all'})
  const space = buildScopeDraft(workspace,{kind:'space',id:'space',scopeId:'all'})
  assert.equal(project.categoryId,'group')
  project.recordIds.push('another-card');project.collectionIds.push('another-source');space.collectionIds.length=0
  assert.deepEqual(workspace,before)
})

test('missing project owner cannot silently become the current Space', () => {
  const workspace={spaces:[{id:'current',name:'Current',color:'#0082c9',collectionIds:[]}],categories:[],projects:[{id:'project',spaceId:'removed',name:'Old',collectionIds:[],recordIds:[]}]}
  assert.equal(buildScopeDraft(workspace,{kind:'project',id:'project',scopeId:'current'}),null)
})

test('new project with no Spaces stays unset for existing save validation', () => {
  const draft=buildScopeDraft({spaces:[],categories:[],projects:[]},{kind:'project',defaultColor:'#abcdef'})
  assert.equal(draft.spaceId,'');assert.equal(draft.categoryId,'');assert.equal(draft.id,'');assert.equal(draft.color,'#abcdef')
})
