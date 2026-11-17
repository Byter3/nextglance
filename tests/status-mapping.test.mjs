import test from 'node:test'
import assert from 'node:assert/strict'
import {createPlannerWorkspace,plannerSettings,boardColumns} from '@nextspace/core/planner.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {defaultStatusMapping,statusSourceKey,nativeStatusKey,statusSourceOptions,mappedBoardColumns,statusMoveTargets,UNMAPPED_COLUMN} from '@nextspace/core/status-mapping.mjs'

const collections=[
  {id:'board-a',source:'deck',title:'Freelance',stacks:[{id:'a-todo',title:'Ideas'},{id:'a-doing',title:'Animating'},{id:'a-review',title:'Client review'}]},
  {id:'board-b',source:'deck',title:'Personal',stacks:[{id:'b-todo',title:'Later'},{id:'b-doing',title:'Working'}]},
  {id:'tasks',source:'tasks',title:'Tasks'},
]
const card=(id,collectionId,stackId,extra={})=>({id,kind:'card',source:'deck',collectionId,stackId,completed:false,...extra})
const task=(id,status,extra={})=>({id,kind:'task',source:'tasks',collectionId:'tasks',status,...extra})
const records=[card('a','board-a','a-todo'),card('b','board-b','b-todo'),card('review','board-a','a-review'),task('task','IN-PROCESS'),card('done','board-a','a-todo',{completed:true}),task('cancelled','CANCELLED')]
function mapped(){const result=defaultStatusMapping(collections);result.assignments[statusSourceKey('deck','board-a','a-todo')]='todo';result.assignments[statusSourceKey('deck','board-b','b-todo')]='todo';result.assignments[statusSourceKey('deck','board-a','a-doing')]='doing';result.assignments[statusSourceKey('deck','board-a','a-review')]='doing';return result}

test('many native stacks/statuses map to one column without changing source status',()=>{
  const before=structuredClone(records),mapping=mapped()
  const columns=boardColumns(records,collections,{mode:'mapped',statusMapping:mapping})
  assert.deepEqual(columns.find(column=>column.id==='todo').records.map(record=>record.id),['a','b'])
  assert.deepEqual(columns.find(column=>column.id==='doing').records.map(record=>record.id),['review','task'])
  assert.deepEqual(columns.find(column=>column.id==='done').records.map(record=>record.id),['done'])
  assert.deepEqual(columns.find(column=>column.id==='cancelled').records.map(record=>record.id),['cancelled'])
  assert.deepEqual(records,before)
})

test('unknown stacks are visible and defaults never guess status from a custom name',()=>{
  const input=[card('unknown','board-a','a-todo',{status:'Done'}),card('lost','board-a','deleted-stack'),card('undated','missing-board','same-id')]
  const columns=mappedBoardColumns(input,collections)
  assert.deepEqual(columns.find(column=>column.id===UNMAPPED_COLUMN).records.map(record=>record.id),['unknown','lost','undated'])
  assert.equal(columns.flatMap(column=>column.records).length,input.length)
  assert.equal(columns.find(column=>column.id==='done').records.length,0)
})

test('compatible move targets belong to the item’s own source and preserve ambiguity',()=>{
  const mapping=mapped()
  const targets=statusMoveTargets(records[0],'doing',mapping,collections)
  assert.deepEqual(targets.map(target=>target.stackId),['a-doing','a-review'])
  assert.ok(targets.every(target=>target.completed===false&&target.source==='deck'))
  assert.deepEqual(statusMoveTargets(records[1],'doing',mapping,collections),[])
  assert.deepEqual(statusMoveTargets(records[3],'doing',mapping,collections).map(target=>target.status),['IN-PROCESS'])
  assert.deepEqual(statusMoveTargets({...records[0],readonly:true},'doing',mapping,collections),[])
  assert.deepEqual(statusMoveTargets(records[0],UNMAPPED_COLUMN,mapping,collections),[])
  assert.equal(statusMoveTargets(records[0],'done',mapping,collections)[0].completed,true)
  assert.equal(statusMoveTargets(records[0],'done',mapping,collections)[0].stackId,undefined)
})

test('native completion/cancellation wins over an old stack or missing completed flag',()=>{
  assert.equal(nativeStatusKey({...records[0],completed:true}),statusSourceKey('deck','board-a','$completed'))
  assert.equal(nativeStatusKey(task('c','COMPLETED',{completed:false})),statusSourceKey('tasks','tasks','COMPLETED'))
  assert.equal(nativeStatusKey(task('x','CANCELLED')),statusSourceKey('tasks','tasks','CANCELLED'))
})

test('mapping editor retains unavailable sources while listing source-specific statuses',()=>{
  const mapping=mapped(),missingKey=statusSourceKey('deck','old-board','stack-old')
  mapping.assignments[missingKey]='todo'
  const options=statusSourceOptions(collections,[],mapping)
  assert.equal(options.find(option=>option.key===missingKey).available,false)
  assert.equal(options.find(option=>option.key===statusSourceKey('deck','board-a','a-review')).sourceTitle,'Freelance')
  assert.equal(options.filter(option=>option.source==='tasks').length,4)
})

test('mapping is portable planner metadata and schema rejects dangling or unsafe rules',()=>{
  const workspace=createPlannerWorkspace();workspace.planner.statusMapping=mapped()
  const restored=validateWorkspace(JSON.parse(JSON.stringify(workspace)))
  assert.deepEqual(plannerSettings(restored.planner).statusMapping,workspace.planner.statusMapping)
  for(const mutate of [
    value=>value.columns.push({...value.columns[0]}),
    value=>value.assignments[statusSourceKey('deck','board-a','a-todo')]='missing',
    value=>value.assignments['["tasks","tasks","GUESSED-STATE"]']='todo',
    value=>value.columns[0].color='url(https://untrusted.invalid)',
    value=>value.columns[0].id='$unmapped',
    value=>value.columns=[],
  ]){
    const broken=structuredClone(workspace);mutate(broken.planner.statusMapping)
    assert.throws(()=>validateWorkspace(broken),/Invalid workspace/)
  }
})
