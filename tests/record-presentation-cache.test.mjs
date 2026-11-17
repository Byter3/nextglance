import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createRecordPresentation} from '../packages/ui/src/record-presentation-cache.mjs'
const {reactive}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('tag presentation reuses unchanged arrays but tracks in-place native and custom edits',()=>{
  const state=reactive({workspace:{properties:{}},collections:[{id:'list',color:'#123456'}],fallback:'#0082c9'})
  const record=reactive({id:'task',kind:'task',source:'tasks',collectionId:'list',tags:['Review'],tagDetails:[]})
  const presentation=createRecordPresentation({collections:()=>state.collections,workspace:()=>state.workspace,fallback:()=>state.fallback})
  const original=presentation.tagsFor(record)
  for(let index=0;index<1000;index++)assert.equal(presentation.tagsFor(record),original)
  record.tags.push('Ready');assert.deepEqual(presentation.tagsFor(record).map(tag=>tag.title),['Review','Ready'])
  state.workspace.properties['tag-colors']={'["list","Review"]':'#aabbcc'}
  assert.equal(presentation.tagsFor(record)[0].color,'#aabbcc')
  state.workspace.properties['tag-colors']['["list","Review"]']='#112233'
  assert.equal(presentation.tagsFor(record)[0].color,'#112233')
  record.tagDetails.push({id:'native',title:'Review',color:'#ff0000'})
  assert.equal(presentation.tagsFor(record)[0].color,'#ff0000')
  record.tagDetails[0].color='#00ff00';assert.equal(presentation.tagsFor(record)[0].color,'#00ff00')
  record.tagDetails=[];record.collectionId='another'
  assert.equal(presentation.tagsFor(record)[0].color,undefined)
  const changed=presentation.tagsFor(record);state.workspace={properties:state.workspace.properties}
  assert.equal(presentation.tagsFor(record),changed)
})
test('source color lookup preserves normalized native precedence and observes replacements and in-place edits',()=>{
  const state=reactive({collections:[{id:'board',color:'#123'}],fallback:'#abcdef'})
  const presentation=createRecordPresentation({collections:()=>state.collections,workspace:()=>undefined,fallback:()=>state.fallback})
  assert.equal(presentation.sourceColorFor({collectionId:'board'}),'#112233')
  state.collections[0].color='#445566';assert.equal(presentation.sourceColorFor({collectionId:'board'}),'#445566')
  assert.equal(presentation.sourceColorFor({collectionId:'unknown'}),'#abcdef')
  state.fallback='#654321';assert.equal(presentation.sourceColorFor({collectionId:'unknown'}),'#654321')
  state.collections=[{id:'board',color:'invalid'}];assert.equal(presentation.sourceColorFor({collectionId:'board'}),'#654321')
})
