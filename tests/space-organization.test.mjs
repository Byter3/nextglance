import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmptyState, scopeRecordIds, scopeContextRecordIds, selectPlanner} from '@nextspace/core/planner.mjs'
import {recordGrouping, timelineGroups} from '@nextspace/core/timeline.mjs'
import {defaultCalendarForRecord} from '@nextspace/core/scheduling.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {mergeWorkspaces} from '@nextspace/core/workspace-merge.mjs'
import {
  sourceGroupPresets, createSpaceDraft, addPresetGroupsToDraft, assignDraftSourceGroup,
  selectDraftSource, removeDraftSourceGroup, saveSpaceDraft, removeSourceGroup, removeSpace, spaceSourceInclusions,
} from '@nextspace/core/space-organization.mjs'

function fixture() {
  const state = createEmptyState(), workspace = state.workspace
  workspace.spaces = [
    {id:'life',name:'Daily life',color:'#123456',collectionIds:['tasks','calendar'],defaultCalendarId:'calendar'},
    {id:'planning',name:'Planning',color:'#654321',collectionIds:['tasks']},
  ]
  workspace.categories = [
    {id:'personal',spaceId:'life',name:'Personal',color:'#228844',collectionIds:['tasks','calendar']},
    {id:'home',spaceId:'planning',name:'Home',color:'#884422',collectionIds:['tasks']},
  ]
  workspace.projects = [{id:'project',spaceId:'life',categoryId:'personal',name:'Selected items',collectionIds:[],recordIds:['curated']}]
  workspace.relations = [
    {id:'event-link',type:'for_event',fromId:'first',toId:'linked-event'},
    {id:'page-link',type:'reference',fromId:'curated',toId:'linked-page'},
    {id:'dependency',type:'depends_on',fromId:'first',toId:'external'},
  ]
  state.collections = [
    {id:'tasks',source:'tasks',title:'Personal',color:'#00bbcc'},
    {id:'board',source:'deck',title:'Personal',color:'#ccbb00'},
    {id:'calendar',source:'calendar',title:'Schedule',color:'#123123'},
    {id:'other-calendar',source:'calendar',title:'Other schedule',color:'#321321'},
  ]
  state.records = [
    {id:'first',kind:'task',source:'tasks',title:'First',collectionId:'tasks'},
    {id:'card',kind:'card',source:'deck',title:'Card',collectionId:'board',assignmentKnown:true,assigneeIds:['me']},
    {id:'curated',kind:'task',source:'tasks',title:'Curated',collectionId:'outside'},
    {id:'external',kind:'task',source:'tasks',title:'External',collectionId:'outside'},
    {id:'linked-event',kind:'event',source:'calendar',title:'Linked event',collectionId:'other-calendar'},
    {id:'other-event',kind:'event',source:'calendar',title:'Other event',collectionId:'other-calendar'},
    {id:'linked-page',kind:'page',source:'collectives',title:'Page',collectionId:'collective'},
  ]
  state.connection = {connected:true,username:'me'}
  return state
}
const accepted = result => {assert.equal(result.ok, true, result.message); return result.workspace}
const sequence = () => {let count=0; return () => `new-${++count}`}

test('opening, browsing or cancelling new Space suggestions creates no metadata or identities', () => {
  const {workspace} = fixture(), original = structuredClone(workspace)
  const draft = createSpaceDraft(workspace)
  assert.deepEqual(draft, {space:{name:'',color:'#3483c6',collectionIds:[]},groups:[]})
  assert.deepEqual(sourceGroupPresets.map(item => item.key), ['personal','freelance','work','shared','home','learning'])
  const suggested = addPresetGroupsToDraft(draft, ['personal','work'])
  assert.deepEqual(draft.groups, [])
  assert.equal(suggested.groups.length, 2)
  assert.ok(suggested.groups.every(group => !group.id && !group.spaceId && !group.collectionIds.length))
  assert.equal(addPresetGroupsToDraft(suggested, ['personal']).groups.length, 2, 'Already added names are skipped')
  assert.deepEqual(workspace, original)
  let allocations = 0
  assert.equal(saveSpaceDraft(workspace, suggested, {newId:() => {allocations++; return 'unused'}}).ok, false, 'Empty Space name needs review')
  assert.equal(allocations, 0)
})

test('accepted empty suggestions get separate stable IDs and retain them when renamed', () => {
  const {workspace} = fixture()
  let draft = addPresetGroupsToDraft(createSpaceDraft(workspace), ['personal','home'])
  draft.space.name = 'New Space'
  const result = saveSpaceDraft(workspace, draft, {newId:sequence()}), saved = accepted(result)
  assert.equal(result.spaceId, 'new-1')
  const groups = saved.categories.filter(group => group.spaceId === result.spaceId)
  assert.deepEqual(groups.map(group => group.id), ['new-2','new-3'])
  assert.ok(groups.every(group => group.collectionIds.length === 0))
  assert.deepEqual(saved.spaces.at(-1).collectionIds, [])
  draft = createSpaceDraft(saved, result.spaceId)
  draft.groups[0].name = 'Közös'
  const renamed = accepted(saveSpaceDraft(saved, draft, {newId:() => assert.fail('Renaming must preserve identity')}))
  assert.equal(renamed.categories.find(group => group.name === 'Közös').id, 'new-2')
})

test('each source can have independent groups in different Spaces; moving it edits only its owner', () => {
  const {workspace} = fixture(), unrelated = structuredClone(workspace.categories[1])
  let draft = addPresetGroupsToDraft(createSpaceDraft(workspace, 'life'), ['work'])
  draft = assignDraftSourceGroup(draft, 'tasks', 1)
  const saved = accepted(saveSpaceDraft(workspace, draft, {newId:sequence()}))
  assert.deepEqual(saved.categories.find(group => group.id === 'home'), unrelated)
  assert.deepEqual(saved.categories.find(group => group.id === 'personal').collectionIds, ['calendar'])
  assert.deepEqual(saved.categories.find(group => group.name === 'Work').collectionIds, ['tasks'])
  assert.deepEqual(workspace.categories[0].collectionIds, ['tasks','calendar'])
  const invalid = createSpaceDraft(saved, 'life')
  invalid.groups[0].collectionIds.push('tasks')
  assert.equal(saveSpaceDraft(saved, invalid).ok, false, 'Duplicate assignment is rejected')
  invalid.groups[1].name = ' personal '
  assert.equal(saveSpaceDraft(saved, invalid).error, 'group-name')
})

test('source additions, unavailable IDs and legacy inclusion reasons consolidate only on accepted save', () => {
  const {workspace} = fixture()
  workspace.categories[0].collectionIds.push('unavailable:notes:old-name')
  workspace.projects[0].collectionIds.push('project-only')
  const original = structuredClone(workspace), inclusions = spaceSourceInclusions(workspace, 'life')
  assert.deepEqual(inclusions.find(item => item.collectionId === 'project-only'), {
    collectionId:'project-only',selected:false,groups:[],projects:[{id:'project',name:'Selected items'}],
  })
  let draft = createSpaceDraft(workspace, 'life')
  assert.ok(draft.space.collectionIds.includes('unavailable:notes:old-name'))
  draft = assignDraftSourceGroup(draft, 'new-source-id', 0)
  const saved = accepted(saveSpaceDraft(workspace, draft))
  assert.deepEqual(saved.spaces[0].collectionIds, ['tasks','calendar','unavailable:notes:old-name','project-only','new-source-id'])
  assert.deepEqual(workspace, original, 'Opening/reviewing/saving a returned value never mutates the input')
})

test('source deselection requires explicit project update and atomically clears defaults and groups', () => {
  const {workspace} = fixture()
  workspace.projects[0].collectionIds = ['calendar']
  const draft = selectDraftSource(createSpaceDraft(workspace, 'life'), 'calendar', false)
  const blocked = saveSpaceDraft(workspace, draft)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error, 'project-source-removal')
  assert.deepEqual(blocked.affectedProjects, [{id:'project',name:'Selected items',collectionIds:['calendar']}])
  assert.equal(blocked.workspace, undefined)
  assert.equal(saveSpaceDraft(workspace, draft, {projectSourceRemoval:'cancel'}).ok, false)
  const saved = accepted(saveSpaceDraft(workspace, draft, {projectSourceRemoval:'update'}))
  assert.deepEqual(saved.spaces[0].collectionIds, ['tasks'])
  assert.equal(saved.spaces[0].defaultCalendarId, undefined)
  assert.deepEqual(saved.categories[0].collectionIds, ['tasks'])
  assert.deepEqual(saved.projects[0].collectionIds, [])
  assert.deepEqual(saved.projects[0].recordIds, ['curated'], 'Explicit items remain curated independently of full-source membership')
})

test('deleting groups keeps their sources and detaches only matching project references', () => {
  const {workspace} = fixture()
  workspace.categories[0].collectionIds.push('legacy-unavailable')
  const saved = removeSourceGroup(workspace, 'personal')
  assert.ok(saved.spaces[0].collectionIds.includes('legacy-unavailable'))
  assert.equal(saved.projects[0].categoryId, undefined)
  assert.deepEqual(saved.categories, [workspace.categories[1]])
  assert.deepEqual(saved.relations, workspace.relations)
  const draftSaved = accepted(saveSpaceDraft(workspace, removeDraftSourceGroup(createSpaceDraft(workspace, 'life'), 0)))
  assert.deepEqual(draftSaved.spaces, saved.spaces)
  assert.deepEqual(draftSaved.projects, saved.projects)
})

test('deleting a Space removes owned definitions and only its local scope keys, retaining global links', () => {
  const {workspace} = fixture()
  workspace.planner.scopeId = 'project'
  workspace.planner.scopeAssignments = {life:'all',personal:'all',project:'me',planning:'me',home:'all',all:'me'}
  workspace.planner.hiddenCollectionIds = ['hidden']
  workspace.properties = {first:{custom:'keep'}}
  const saved = removeSpace(workspace, 'life')
  assert.deepEqual(saved.spaces, [workspace.spaces[1]])
  assert.deepEqual(saved.categories, [workspace.categories[1]])
  assert.deepEqual(saved.projects, [])
  assert.deepEqual(saved.relations, workspace.relations)
  assert.deepEqual(saved.properties, workspace.properties)
  assert.equal(saved.planner.scopeId, 'all')
  assert.deepEqual(saved.planner.scopeAssignments, {planning:'me',home:'all',all:'me'})
  assert.deepEqual(saved.planner.hiddenCollectionIds, ['hidden'])
})

test('My overview records, row order, counts, colors and destinations ignore all organization changes', () => {
  const state = fixture()
  const snapshot = workspace => {
    const model = selectPlanner({...state,workspace}, {scopeId:'all',now:'2026-11-11T12:00:00Z',excludedSpaceIds:['life','planning']})
    return {
      records:model.records, counts:model.counts,
      groups:timelineGroups(model.records, {...workspace,scopeId:'all',collections:state.collections}),
      owners:state.records.map(record => recordGrouping(record, {...workspace,scopeId:'all'})),
      defaults:state.records.map(record => defaultCalendarForRecord(record, workspace, state.collections, 'all')),
    }
  }
  const original = snapshot(state.workspace)
  assert.ok(original.groups.every(group => group.kind === 'collection'))
  assert.equal(original.groups[0].color, '#00bbcc')
  assert.equal(original.groups[0].name, 'Personal · Task list')
  assert.equal(original.groups[1].name, 'Personal · Deck board')
  const modified = structuredClone(state.workspace)
  modified.spaces.reverse(); modified.projects[0].recordIds.push('external')
  modified.categories.reverse(); modified.categories[0].name = 'Changed'; modified.categories[0].color = '#000000'
  assert.deepEqual(snapshot(modified), original)
  assert.deepEqual(snapshot(removeSourceGroup(modified, 'personal')), original)
  assert.deepEqual(snapshot(removeSpace(removeSpace(modified, 'life'), 'planning')), original)
  assert.equal(defaultCalendarForRecord(state.records[0], modified, state.collections, 'all'), undefined)
  assert.equal(defaultCalendarForRecord(state.records[0], modified, state.collections.filter(collection => collection.id !== 'other-calendar'), 'all'), 'calendar')
})

test('curated project items and linked context do not import another source or dependency work', () => {
  const state = fixture(), selected = scopeRecordIds(state.workspace, state.records, 'life')
  assert.deepEqual([...selected].sort(), ['curated','first','linked-event','linked-page'])
  assert.deepEqual([...scopeContextRecordIds(state.workspace, state.records, 'life')].sort(), ['linked-event','linked-page'])
  assert.deepEqual([...scopeRecordIds(state.workspace, state.records, 'planning')].sort(), ['first','linked-event'])
  assert.equal(recordGrouping(state.records[2], {...state.workspace,scopeId:'life'}).project.id, 'project')
  assert.equal(recordGrouping(state.records[2], {...state.workspace,scopeId:'planning'}).category, undefined)
  const model = selectPlanner(state, {scopeId:'life'})
  assert.deepEqual(model.contextRecordIds.sort(), ['linked-event','linked-page'])
  assert.equal(model.counts.actions, 2)
})

test('independent draft edits merge across Spaces while conflicting source moves fail full validation', () => {
  const {workspace:base} = fixture()
  const leftDraft = createSpaceDraft(base, 'life'); leftDraft.groups[0].name = 'Private'
  const rightDraft = createSpaceDraft(base, 'planning'); rightDraft.groups[0].name = 'Household'
  const merged = mergeWorkspaces(base, accepted(saveSpaceDraft(base, leftDraft)), accepted(saveSpaceDraft(base, rightDraft)))
  assert.deepEqual(merged.conflicts, [])
  assert.deepEqual(validateWorkspace(merged.workspace).categories.map(group => group.name), ['Private','Household'])
  base.categories.push({id:'work',spaceId:'life',name:'Work',color:'#444444',collectionIds:[]}, {id:'learning',spaceId:'life',name:'Learning',color:'#555555',collectionIds:[]})
  const first = accepted(saveSpaceDraft(base, assignDraftSourceGroup(createSpaceDraft(base, 'life'), 'tasks', 1)))
  const second = accepted(saveSpaceDraft(base, assignDraftSourceGroup(createSpaceDraft(base, 'life'), 'tasks', 2)))
  const collision = mergeWorkspaces(base, first, second)
  assert.throws(() => validateWorkspace(collision.workspace), /only one category/, 'Storage must reject the complete invalid merge before upload')
})

test('a dirty draft cannot silently remove source or group updates received while it was open', () => {
  const {workspace} = fixture(), draft = createSpaceDraft(workspace, 'life')
  draft.groups[0].name = 'My rename'
  const unrelated = structuredClone(workspace)
  unrelated.spaces[1].name = 'A different Space changed'
  assert.equal(saveSpaceDraft(unrelated, draft).ok, true)
  const concurrent = structuredClone(workspace)
  concurrent.spaces[0].collectionIds.push('newly-synced-source')
  const blocked = saveSpaceDraft(concurrent, draft)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error, 'organization-changed')
  assert.equal(draft.groups[0].name, 'My rename')
  assert.ok(concurrent.spaces[0].collectionIds.includes('newly-synced-source'))
  assert.equal(saveSpaceDraft(removeSpace(workspace, 'life'), draft).error, 'space-unavailable')
})
