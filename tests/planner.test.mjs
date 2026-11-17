import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createEmptyState, createPlannerWorkspace, plannerSettings, selectPlanner, scopeRecordIds, relationsFor, canAddRelation, allRelations, dayItems, localDay, weekDays, boardColumns} from '@nextspace/core/planner.mjs'
import {plannerFixture} from './fixtures.mjs'
const now = new Date(2026, 10, 2, 10)
const ids = records => records.map(item => item.id)
const model = (state, overrides = {}) => selectPlanner(state, {now, ...overrides})

test('combined board uses source stacks and task statuses, ignoring personal workflow', () => {
  const state = plannerFixture(now)
  const card = state.records.find(r => r.id === 'card-mine'); card.stackId = 'stack-review'; card.status = 'Outdated stack title'
  state.records.find(r => r.id === 'task-today').status = 'IN-PROCESS'
  const columns = boardColumns(state.records, state.collections, {workflow: {'card-mine':'inbox','task-today':'done'}})
  assert.ok(ids(columns.find(c => c.title === 'Review').records).includes('card-mine'))
  assert.ok(ids(columns.find(c => c.title === 'In progress').records).includes('task-today'))
  assert.ok(ids(columns.find(c => c.title === 'Done').records).includes('card-complete'))
  assert.ok(!columns.some(c => c.title === 'Outdated stack title' || c.title === 'Inbox'))
  assert.equal(columns.flatMap(c => c.records).length, state.records.filter(r => ['task','card'].includes(r.kind)).length)
})

test('completed work never falls into an open personal planning column', () => {
  const records = [{id:'done',kind:'task',completed:true},{id:'open',kind:'task',completed:false}]
  const columns = boardColumns(records, [], {mode:'planning', workflow:{done:'doing',open:'planned'}})
  assert.deepEqual(ids(columns.find(c => c.id === 'done').records), ['done'])
  assert.deepEqual(ids(columns.find(c => c.id === 'planned').records), ['open'])
})

test('board preserves custom labels and missing stack context without inferring completion', () => {
  const records = [{id:'a',kind:'card',collectionId:'board',stackId:'s',status:'Kész',completed:false},{id:'b',kind:'card',collectionId:'board',stackId:'missing',status:'Waiting',completed:false},{id:'cancelled',kind:'task',status:'CANCELLED'}]
  const collections = [{id:'board',source:'deck',stacks:[{id:'s',title:'Kész'},{id:'empty',title:'Empty'}]}]
  const source = boardColumns(records, collections)
  assert.deepEqual(source.map(c => c.title), ['To do','In progress','Kész','Empty','Waiting','Done','Cancelled'])
  const native = boardColumns(records, collections, {mode:'deck',boardId:'board'})
  assert.deepEqual(native.map(c => c.id), ['s','empty','missing'])
  assert.equal(native.flatMap(c => c.records).length, 2)
  assert.equal(records[0].completed, false)
})

test('matching statuses combine across boards and duplicate records render once', () => {
  const records = [{id:'a',kind:'card',status:' Review ',collectionId:'one'},{id:'b',kind:'card',status:'review',collectionId:'two'}]
  const columns = boardColumns([...records,records[0]], [])
  assert.deepEqual(columns.map(column=>column.title), ['Review','Done'])
  assert.deepEqual(ids(columns[0].records), ['a','b'])
})

test('new planner is empty and never substitutes example sources', () => {
  const state = createEmptyState()
  assert.equal(state.workspace.schemaVersion, 2)
  assert.deepEqual(state.records, [])
  assert.deepEqual(state.workspace.spaces, [])
  assert.deepEqual(model(state).actions, [])
  assert.equal(state.connection.connected, false)
  assert.ok(state.statuses.every(status => status.state === 'unavailable'))
  assert.equal(createPlannerWorkspace().planner.assignment, 'me')
})

test('cancelled tasks are closed work without being relabelled completed', () => {
  const state = plannerFixture(now)
  const task = state.records.find(r => r.id === 'task-overdue'); task.status = 'CANCELLED'
  assert.ok(!ids(model(state).records).includes(task.id))
  const shown = model(state, {showCompleted:true})
  assert.ok(ids(shown.records).includes(task.id))
  assert.ok(!ids(shown.overdue).includes(task.id))
  assert.equal(shown.counts.actions, model(state).counts.actions)
  assert.equal(shown.spaces[0].openCount, model(state).spaces[0].openCount)
  assert.equal(task.completed, false)
  assert.ok(ids(boardColumns(shown.records,state.collections).find(c => c.title === 'Cancelled').records).includes(task.id))
})

test('My overview shows direct and shared assignments to canonical user only', () => {
  const result = model(plannerFixture(now))
  assert.deepEqual(ids(result.actions).filter(id => id.startsWith('card')).sort(), ['card-both', 'card-gig', 'card-mine'])
  assert.equal(result.hiddenAssignmentCount, 4)
  assert.equal(result.unassignedCount, 1)
  assert.equal(result.unknownAssignmentCount, 1)
  assert.equal(result.events.length, 4, 'Calendar events are independent of Deck assignment')
  assert.equal(result.counts.blocked, 1, 'Hidden partner card still provides dependency context')
})

test('unassigned opt-in does not include team assignments or unknown assignments', () => {
  const result = model(plannerFixture(now), {includeUnassigned: true})
  assert.ok(ids(result.actions).includes('card-unassigned'))
  assert.ok(!ids(result.actions).includes('card-team'))
  assert.ok(!ids(result.actions).includes('card-unknown'))
  assert.ok(!ids(result.actions).includes('card-partner'))
})

test('per-board unassigned preference is scoped and board ownership never grants mine', () => {
  const state = plannerFixture(now)
  state.records.find(r => r.id === 'card-unassigned').owner = 'fixture-user'
  assert.ok(!ids(model(state).actions).includes('card-unassigned'))
  assert.ok(ids(model(state, {unassignedBoardIds: ['deck-work']}).actions).includes('card-unassigned'))
  assert.ok(!ids(model(state, {unassignedBoardIds: ['deck-shared']}).actions).includes('card-unassigned'))
})

test('each scope keeps responsibility filter separate from My overview', () => {
  const state = plannerFixture(now)
  assert.ok(ids(model(state, {scopeId: 'space-shared'}).actions).includes('card-partner'))
  state.workspace.planner.scopeAssignments['space-shared'] = 'me'
  assert.ok(!ids(model(state, {scopeId: 'space-shared'}).actions).includes('card-partner'))
  assert.ok(!ids(model(state).actions).includes('card-partner'))
})

test('Space rolls up project board, project includes only explicit associated events and notes', () => {
  const state = plannerFixture(now)
  state.records.find(record=>record.id==='card-gig').attachmentFileIds=['42']
  state.records.find(record=>record.id==='note-brief').fileId='42'
  const parent = scopeRecordIds(state.workspace, state.records, 'space-work')
  assert.ok(parent.has('card-gig'))
  assert.ok(parent.has('event-other'))
  const child = scopeRecordIds(state.workspace, state.records, 'project-gig')
  assert.deepEqual([...child].sort(), ['card-gig', 'event-review', 'note-brief'])
  state.workspace.projects[0].recordIds.push('task-today')
  assert.ok(scopeRecordIds(state.workspace, state.records, 'project-gig').has('task-today'))
})

test('dependency links do not transfer work into another project', () => {
  const state = plannerFixture(now)
  state.workspace.relations.push({id: 'external', type: 'depends_on', fromId: 'card-gig', toId: 'card-partner'})
  const result = model(state, {scopeId: 'project-gig'})
  assert.ok(!ids(result.records).includes('card-partner'))
  assert.equal(result.counts.blocked, 1)
  assert.equal(relationsFor('card-gig', result.relations, state.records).outgoing.find(e => e.type === 'depends_on').record.id, 'card-partner')
})

test('global overlap is deduplicated and hidden collections remain hidden', () => {
  const state = plannerFixture(now)
  state.records.push({...state.records[0]})
  state.workspace.projects[0].collectionIds.push('deck-work')
  state.workspace.projects[0].recordIds.push('card-mine')
  const result = model(state)
  assert.equal(result.records.filter(item => item.id === 'card-mine').length, 1)
  assert.equal(result.records.filter(item => item.id === 'task-overdue').length, 1)
  assert.ok(!ids(model(state, {hiddenCollectionIds: ['calendar-work']}).events).includes('event-review'))
})

test('obsolete Space exclusions do not affect My overview membership', () => {
  const state = plannerFixture(now)
  state.workspace.spaces[1].collectionIds.push('calendar-shared')
  const before = model(state)
  const result = model(state, {excludedSpaceIds: ['space-shared']})
  assert.deepEqual(result.records,before.records)
  assert.deepEqual(result.counts,before.counts)
  assert.ok(ids(result.records).includes('card-both'))
  assert.ok(ids(result.records).includes('event-shared'))
  assert.ok(ids(result.records).includes('note-brief'))
})

test('unavailable selected scope stays empty instead of showing everything', () => {
  const result = model(plannerFixture(now), {scopeId: 'deleted-space'})
  assert.equal(result.scope.unavailable, true)
  assert.deepEqual(result.records, [])
})

test('due buckets use local dates, and completion/workflow stay separate', () => {
  const state = plannerFixture(now)
  state.workspace.planner.workflow['task-today'] = 'done'
  const result = model(state)
  assert.deepEqual(ids(result.overdue), ['task-overdue'])
  assert.deepEqual(ids(result.today), ['task-today'])
  assert.deepEqual(ids(result.undated), ['task-undated'])
  assert.ok(!ids(result.actions).includes('card-complete'))
  assert.ok(ids(model(state, {showCompleted: true}).actions).includes('card-complete'))
  assert.equal(model(state, {showCompleted: true}).counts.actions, result.counts.actions)
})

test('query finds titles, collection names and labels without changing source records', () => {
  const state = plannerFixture(now)
  const before = JSON.stringify(state)
  assert.deepEqual(ids(model(state, {query: 'opening'}).records), ['card-mine'])
  assert.ok(model(state, {query: 'KÖZÖS'}).events.length > 0)
  assert.equal(JSON.stringify(state), before)
})

test('dependencies reject self links, duplicate semantics and multi-hop cycles', () => {
  const relations = [{id: 'a', type: 'depends_on', fromId: 'one', toId: 'two'}, {id: 'b', type: 'depends_on', fromId: 'two', toId: 'three'}]
  assert.equal(canAddRelation(relations, 'one', 'one', 'reference').ok, false)
  assert.equal(canAddRelation(relations, 'one', 'two', 'depends_on').ok, false)
  assert.match(canAddRelation(relations, 'three', 'one', 'depends_on').message, /circular/)
  assert.equal(canAddRelation(relations, 'three', 'one', 'reference').ok, true)
  assert.equal(canAddRelation(relations, 'three', 'four', 'depends_on').ok, true)
})

test('native dependencies share the dependency graph and take precedence over a planner copy', () => {
  const records = [
    {id:'dependent',source:'deck',kind:'card',nativeDependencies:['prerequisite','prerequisite','dependent']},
    {id:'prerequisite',source:'deck',kind:'card'},
    {id:'task',source:'tasks',kind:'task'},
  ]
  const workspace = {relations:[
    {id:'legacy-copy',type:'depends_on',fromId:'dependent',toId:'prerequisite'},
    {id:'cross-app',type:'depends_on',fromId:'task',toId:'dependent'},
    {id:'reference',type:'related',fromId:'dependent',toId:'task'},
  ]}
  const before = JSON.stringify({records,workspace})
  const relations = allRelations(workspace, records)
  const native = relations.filter(edge=>edge.native)
  assert.equal(native.length,1,'Duplicates and self links do not create extra native edges')
  assert.equal(native[0].type,'depends_on')
  assert.equal(native[0].fromId,'dependent')
  assert.equal(native[0].toId,'prerequisite')
  assert.equal(relations.some(edge=>edge.id==='legacy-copy'),false)
  assert.equal(relations.some(edge=>edge.id==='cross-app'),true,'Cross-app dependency remains planner metadata')
  assert.equal(relations.some(edge=>edge.id==='reference'&&edge.type==='related'),true,'A generic association does not silently become a dependency')
  assert.equal(canAddRelation(relations,'dependent','prerequisite','depends_on',records).ok,false,'Imported native edge prevents duplicates')
  assert.equal(canAddRelation(relations,'prerequisite','task','depends_on',records).ok,false,'Cycle detection traverses native and planner dependencies together')
  assert.equal(relationsFor('dependent',relations,records).outgoing.find(edge=>edge.native).record.id,'prerequisite')
  assert.equal(relationsFor('prerequisite',relations,records).incoming[0].record.id,'dependent')
  assert.equal(JSON.stringify({records,workspace}),before,'Normalization does not rewrite source records or metadata')
})

test('cached native Deck links are prerequisites and participate in blocking', () => {
  const state = plannerFixture(now)
  state.records.find(r => r.id === 'card-mine').nativeRelatedIds = ['card-partner']
  const result = model(state, {assignment:'all'})
  const native = result.relations.find(edge => edge.native)
  assert.equal(native.type, 'depends_on')
  assert.equal(native.label, 'Deck dependency')
  assert.equal(native.fromId, 'card-mine', 'The card owning the Deck list waits for the listed card')
  assert.equal(native.toId, 'card-partner')
  assert.equal(result.counts.blocked, 2)
  const links = relationsFor('card-mine', result.relations, state.records)
  assert.ok(links.outgoing.some(edge => edge.record?.id === 'card-partner'))
})

test('legacy Deck fields retain raw owner-to-prerequisite direction and a fresh empty list supersedes cached links', () => {
  const records = [
    {id:'dependent',source:'deck',kind:'card',nativeDependents:['prerequisite','prerequisite','dependent'],nativeRelatedIds:['stale']},
    {id:'prerequisite',source:'deck',kind:'card',nativeDependencies:[]},
    {id:'cleared',source:'deck',kind:'card',nativeDependencies:[],nativeDependents:['stale'],nativeRelatedIds:['stale']},
  ]
  const edges = allRelations({relations:[{id:'copy',type:'depends_on',fromId:'dependent',toId:'prerequisite'}]},records)
  assert.equal(edges.length,1)
  assert.equal(edges[0].fromId,'dependent')
  assert.equal(edges[0].toId,'prerequisite')
  assert.equal(edges[0].native,true)
  const unavailable = allRelations({relations:[]},[{id:'owner',source:'deck',nativeDependents:['not-loaded']}])
  assert.deepEqual(unavailable.map(edge=>[edge.fromId,edge.toId]),[['owner','not-loaded']],'Unavailable prerequisites remain represented without invented record data')
})

test('the user Deck chain preserves incoming prerequisites and outgoing dependents independently', () => {
  const records = [
    {id:'website',source:'deck',kind:'card',title:'Project move n update',nativeDependencies:['storm']},
    {id:'blueprints',source:'deck',kind:'card',title:'Rebuid ProjectBlueprints',nativeDependencies:['website']},
    {id:'storm',source:'deck',kind:'card',title:'Publish release notes',nativeDependencies:[]},
    {id:'render',source:'deck',kind:'card',title:'Render project preview',nativeDependencies:['blueprints']},
  ]
  const edges = allRelations({relations:[]},records)
  const website = relationsFor('website',edges,records), blueprints = relationsFor('blueprints',edges,records)
  assert.deepEqual(website.outgoing.map(edge=>edge.record.title),['Publish release notes'],'Website waits for release notes')
  assert.deepEqual(website.incoming.map(edge=>edge.record.title),['Rebuid ProjectBlueprints'],'Blueprints needs Website')
  assert.deepEqual(blueprints.outgoing.map(edge=>edge.record.title),['Project move n update'],'Blueprints waits for Website')
  assert.deepEqual(blueprints.incoming.map(edge=>edge.record.title),['Render project preview'],'Rendering needs Blueprints')
})

test('one relationship is visible in both directions and retains unavailable targets', () => {
  const state = plannerFixture(now)
  state.records.find(record=>record.id==='card-gig').attachmentFileIds=['42']
  state.records.find(record=>record.id==='note-brief').fileId='42'
  state.workspace.relations.push({id: 'missing', type: 'reference', fromId: 'card-mine', toId: 'missing-note'})
  const relations = allRelations(state.workspace, state.records)
  assert.equal(relationsFor('card-mine', relations, state.records).outgoing[0].record, null)
  assert.equal(relationsFor('card-gig', relations, state.records).outgoing.length, 2)
  assert.equal(relationsFor('event-review', relations, state.records).incoming[0].record.id, 'card-gig')
})

test('calendar uses exclusive all-day ends, cross-midnight overlap and due-only markers', () => {
  const records = [
    {id: 'all', kind: 'event', allDay: true, start: '2026-11-02', end: '2026-11-04'},
    {id: 'night', kind: 'event', start: new Date(2026, 10, 2, 23).toISOString(), end: new Date(2026, 10, 3, 1).toISOString()},
    {id: 'deadline', kind: 'task', due: '2026-11-03'},
    {id: 'unscheduled', kind: 'task'},
  ]
  assert.deepEqual(ids(dayItems(records, '2026-11-02')), ['all', 'night'])
  assert.deepEqual(ids(dayItems(records, '2026-11-03')), ['all', 'night', 'deadline'])
  assert.deepEqual(ids(dayItems(records, '2026-11-04')), [])
  const plan = {id: 'session', recordId: 'unscheduled', start: new Date(2026, 10, 3, 11).toISOString(), end: new Date(2026, 10, 3, 12).toISOString()}
  assert.ok(ids(dayItems(records, '2026-11-03', [plan])).includes('unscheduled'))
  assert.equal(records[3].start, undefined, 'Planning does not mutate native dates')
})

test('weeks run Monday to Sunday and calendar dates survive daylight saving changes', () => {
  const moduleUrl = import.meta.resolve('@nextspace/core/planner.mjs')
  for (const tz of ['Europe/Budapest', 'America/New_York', 'Pacific/Auckland']) {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `import {weekDays,localDay} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(weekDays('2026-10-25').map(localDay)));`], {env: {...process.env, TZ: tz}, encoding: 'utf8'})
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  }
  assert.equal(localDay('2026-02-30'), '')
  assert.equal(localDay('2026-02-30T10:00:00Z'), '')
  assert.equal(weekDays('2026-11-01').length, 7)
})

test('settings normalize unknown options and do not introduce sample membership', () => {
  const settings = plannerSettings({view: 'canvas', hiddenCollectionIds: ['x', 'x'], scopeAssignments: {all: 'other'}, workflow: {a: 'invalid'}})
  assert.equal(settings.view, 'overview')
  assert.deepEqual(settings.hiddenCollectionIds, ['x'])
  assert.deepEqual(settings.scopeAssignments, {})
  assert.deepEqual(settings.workflow, {})
})
