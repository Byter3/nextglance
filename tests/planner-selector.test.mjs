import test from 'node:test'
import assert from 'node:assert/strict'
import {countPlannerActions, selectPlanner} from '@nextspace/core/planner.mjs'
import {plannerFixture} from './fixtures.mjs'

const now = new Date(2026, 10, 12, 12)
const ids = records => records.map(record => record.id)

test('open-work count matches the full projection across scopes, assignment and completion filters', () => {
  const state = plannerFixture(now)
  state.workspace.categories = [{id:'category-work',spaceId:'space-work',name:'Work',collectionIds:['tasks-work']}]
  state.records.find(record => record.id === 'task-overdue').status = 'CANCELLED'
  state.workspace.planner.scopeAssignments = {'space-work':'me','space-shared':'all'}
  state.workspace.planner.showCompletedByView = {board:true,timeline:false}
  const before = structuredClone(state)
  for (const scopeId of ['all','space-work','space-personal','space-shared','category-work','project-gig','missing']) {
    for (const view of ['overview','calendar','timeline','board','list']) {
      for (const filters of [{},{assignment:'all'},{assignment:'me',includeUnassigned:true},{assignment:'me',unassignedBoardIds:['deck-work']},{hiddenCollectionIds:['tasks-work','deck-work']},{query:'delivery'},{query:'no match'},{showCompleted:false},{showCompleted:true}]) {
        const options = {scopeId,view,...filters}
        assert.equal(countPlannerActions(state, options), selectPlanner(state, {...options,now}).counts.actions, JSON.stringify(options))
      }
    }
  }
  assert.deepEqual(state,before,'projections never mutate their inputs')
})

test('open-work count deduplicates current IDs and excludes cancelled or completed work', () => {
  const state = plannerFixture(now)
  state.records = [
    {id:'duplicate',kind:'task',source:'tasks',title:'Old open'},
    {id:'cancelled',kind:'task',source:'tasks',title:'Cancelled',status:'cancelled'},
    {id:'complete',kind:'task',source:'tasks',title:'Complete',completed:true},
    {id:'event',kind:'event',source:'calendar',title:'Not work'},
    {id:'duplicate',kind:'task',source:'tasks',title:'New completed',completed:true},
    {id:'open',kind:'task',source:'tasks',title:'Open'},
    {id:'card',kind:'card',source:'deck',title:'Done stack is still open',status:'Done',completed:false,assignmentKnown:true,assigneeIds:['fixture-user'],assignmentCount:1},
  ]
  assert.equal(countPlannerActions(state,{showCompleted:true}),2)
  assert.equal(countPlannerActions(state,{query:'stack'}),1)
  assert.equal(selectPlanner(state,{now}).counts.actions,2)
})

test('context resources and dependencies do not inflate project work or destination badges', () => {
  const state = plannerFixture(now)
  state.records.find(record => record.id === 'card-gig').attachmentFileIds = ['42']
  state.records.find(record => record.id === 'note-brief').fileId = '42'
  state.workspace.relations.push({id:'external-work',type:'depends_on',fromId:'card-gig',toId:'task-personal'})
  const model = selectPlanner(state,{scopeId:'project-gig',hiddenCollectionIds:['deck-shared'],query:'delivery',now})
  assert.equal(countPlannerActions(state,{scopeId:'project-gig'}),1)
  assert.deepEqual(model.contextRecordIds,[],'search still filters contextual resources')
  assert.equal(model.projects.find(project=>project.id==='project-gig').openCount,1)
  assert.equal(model.spaces.find(space=>space.id==='space-shared').openCount,2,'badges ignore active hidden-source/search filters')
  const contextual = selectPlanner(state,{scopeId:'project-gig',now})
  assert.deepEqual([...contextual.contextRecordIds].sort(),['event-review','note-brief'])
  assert.equal(contextual.counts.actions,1)
})

test('one projection retains date ordering and exact attention boundaries', () => {
  const state = plannerFixture(now)
  state.records = [
    {id:'undated',title:'Undated'},
    {id:'invalid',title:'Invalid',due:'2026-02-30'},
    {id:'overdue',title:'Overdue',due:'2026-11-11'},
    {id:'today-b',title:'Beta',due:'2026-11-12'},
    {id:'today-a',title:'Alpha',due:new Date(2026,10,12,21).toISOString()},
    {id:'upcoming',title:'Upcoming',due:'2026-11-18'},
    {id:'boundary',title:'Next week boundary',due:'2026-11-19'},
    {id:'done',title:'Done',due:'2026-11-10',completed:true},
    {id:'cancelled',title:'Cancelled',due:'2026-11-09',status:'CANCELLED'},
  ].map(record=>({...record,kind:'task',source:'tasks'}))
  const model = selectPlanner(state,{now,showCompleted:true})
  assert.deepEqual(ids(model.actions),['overdue','today-a','today-b','upcoming','boundary','invalid','undated','cancelled','done'])
  assert.deepEqual(ids(model.overdue),['overdue'])
  assert.deepEqual(ids(model.today),['today-a','today-b'])
  assert.deepEqual(ids(model.upcoming),['upcoming'])
  assert.deepEqual(ids(model.undated),['invalid','undated'])
  assert.equal(model.counts.actions,7)
})

test('successive projections reflect in-place date, assignment and status changes', () => {
  const state = plannerFixture(now)
  const record = state.records.find(record=>record.id==='card-partner')
  const before = countPlannerActions(state)
  record.assigneeIds=['fixture-user']; record.due='2026-11-12'
  assert.equal(countPlannerActions(state),before+1)
  assert.ok(ids(selectPlanner(state,{now}).today).includes(record.id))
  record.completed=true
  assert.equal(countPlannerActions(state),before)
  assert.ok(!ids(selectPlanner(state,{now}).today).includes(record.id))
})
