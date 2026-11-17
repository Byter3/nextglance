import test from 'node:test'
import assert from 'node:assert/strict'
import {boardColumns,boardCollectionsForScope,createPlannerWorkspace,scopeRecordIds} from '@nextspace/core/planner.mjs'

const collections=[{id:'deck-a',source:'deck',title:'Work',stacks:[{id:'todo',title:'To do'},{id:'review',title:'Review'}]},{id:'tasks-a',source:'tasks',title:'Tasks'},{id:'deck-b',source:'deck',title:'Personal',stacks:[{id:'ideas',title:'Ideas'}]}]
test('all configured native/mapped/planning columns remain when no records match',()=>{
  assert.deepEqual(boardColumns([],collections.slice(0,2)).map(column=>[column.title,column.records.length]),[['To do',0],['In progress',0],['Review',0],['Done',0],['Cancelled',0]])
  assert.deepEqual(boardColumns([],collections,{mode:'deck',boardId:'deck-a'}).map(column=>column.id),['todo','review'])
  assert.deepEqual(boardColumns([],collections,{mode:'mapped',statusMapping:{columns:[{id:'custom',title:'Ready',color:'#123456'}],assignments:{}}}).map(column=>column.id),['$unmapped','custom'])
  assert.deepEqual(boardColumns([],collections,{mode:'planning'}).map(column=>column.id),['inbox','planned','doing','done','cancelled'])
})
test('empty source catalog follows scope definitions and explicit project items, not filtered records',()=>{
  const workspace=createPlannerWorkspace()
  workspace.spaces=[{id:'space',collectionIds:['deck-a']}]
  workspace.categories=[{id:'category',spaceId:'space',collectionIds:['tasks-a']}]
  workspace.projects=[{id:'project',spaceId:'space',categoryId:'category',collectionIds:[],recordIds:['item']}]
  const records=[{id:'item',kind:'card',source:'deck',collectionId:'deck-b'},{id:'unrelated',kind:'card',source:'deck',collectionId:'deck-b'}]
  const ids=scope=>boardCollectionsForScope(workspace,records,collections,scope).map(collection=>collection.id)
  assert.deepEqual(ids('space'),['deck-a','tasks-a','deck-b'])
  assert.deepEqual(ids('category'),['tasks-a','deck-b'])
  assert.deepEqual(ids('project'),['deck-b'])
  assert.deepEqual(ids('missing'),[])
  assert.deepEqual([...scopeRecordIds(workspace,records,'project')],['item'],'catalog membership does not include unrelated work from an explicit item’s source')
})
