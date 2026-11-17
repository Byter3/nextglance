import {createEmptyState, localDay} from '@nextspace/core/planner.mjs'

/** Test-only records. This module is never imported into the application bundle. */
export function plannerFixture(now = new Date()) {
  const state = createEmptyState()
  const date = offset => localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset))
  const time = (offset, hour, minute = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, minute).toISOString()
  state.mode = 'live'; state.connection = {connected: true, username: 'fixture-user', serverUrl: 'https://fixture.invalid'}
  state.theme = {name: 'Fixture Cloud', color: '#0082c9', textColor: '#ffffff'}
  state.workspace.name = 'Test fixture planner'
  state.collections = [
    {id: 'calendar-work', source: 'calendar', title: 'Freelance calendar', color: '#3975ce'},
    {id: 'calendar-shared', source: 'calendar', title: 'Shared calendar', color: '#9e5bd6'},
    {id: 'tasks-work', source: 'tasks', title: 'Freelance tasks'},
    {id: 'tasks-personal', source: 'tasks', title: 'Personal tasks'},
    {id: 'deck-work', source: 'deck', title: 'Freelance board', stacks: [{id: 'stack-todo', title: 'To do'}, {id: 'stack-progress', title: 'In progress'}, {id: 'stack-review', title: 'Review'}]},
    {id: 'deck-gig', source: 'deck', title: 'Client film', stacks: [{id: 'gig-todo', title: 'Preparation'}, {id: 'gig-progress', title: 'Production'}]},
    {id: 'deck-shared', source: 'deck', title: 'Shared board', stacks: [{id: 'shared-todo', title: 'To do'}, {id: 'shared-done', title: 'Done'}]},
    {id: 'notes', source: 'notes', title: 'Notes'},
  ]
  const task = (id, title, due, collectionId = 'tasks-work') => ({id, title, due, source: 'tasks', kind: 'task', collectionId, collectionTitle: state.collections.find(c => c.id === collectionId).title, completed: false, readonly: false, etag: 'task-v1'})
  const card = (id, title, ids, collectionId = 'deck-work', due = date(1)) => ({id, title, due, source: 'deck', kind: 'card', collectionId, collectionTitle: state.collections.find(c => c.id === collectionId).title, assigneeIds: ids, assignmentCount: ids.length, assignmentKnown: true, stackId: collectionId === 'deck-work' ? 'stack-todo' : collectionId === 'deck-gig' ? 'gig-todo' : 'shared-todo', status: 'To do', completed: false, readonly: false})
  state.records = [
    task('task-overdue', 'Send revised estimate', date(-2)),
    task('task-today', 'Prepare review notes', date(0)),
    task('task-undated', 'Collect reference material', undefined),
    task('task-personal', 'Book annual service', date(2), 'tasks-personal'),
    card('card-mine', 'Edit the opening sequence', ['fixture-user']),
    card('card-partner', 'Book accommodation', ['partner'], 'deck-shared'),
    card('card-both', 'Plan the weekend', ['partner', 'fixture-user'], 'deck-shared', date(3)),
    card('card-unassigned', 'Prepare project archive', []),
    {...card('card-team', 'Team production planning', []), assignmentCount: 1},
    {...card('card-unknown', 'Assignment not loaded', []), assignmentKnown: false},
    {...card('card-gig', 'Deliver the final cut', ['fixture-user'], 'deck-gig', date(4)), start: date(1)},
    {...card('card-complete', 'Completed delivery', ['fixture-user']), completed: true},
    {id: 'event-review', kind: 'event', source: 'calendar', title: 'Client review', collectionId: 'calendar-work', collectionTitle: 'Freelance calendar', start: time(0, 14), end: time(0, 15), readonly: false, etag: 'event-v1'},
    {id: 'event-other', kind: 'event', source: 'calendar', title: 'Another client meeting', collectionId: 'calendar-work', collectionTitle: 'Freelance calendar', start: time(1, 10), end: time(1, 11), readonly: false, etag: 'event-v1'},
    {id: 'event-shared', kind: 'event', source: 'calendar', title: 'Dinner together', collectionId: 'calendar-shared', collectionTitle: 'Shared calendar', start: time(0, 19), end: time(0, 21), readonly: false, etag: 'event-v1'},
    {id: 'event-all-day', kind: 'event', source: 'calendar', title: 'Production days', collectionId: 'calendar-work', collectionTitle: 'Freelance calendar', start: date(2), end: date(4), allDay: true, readonly: false, etag: 'event-v1'},
    {id: 'note-brief', kind: 'note', source: 'notes', title: 'Client brief', body: '# Client brief\n\nThe approved direction and **review notes**.\n\n- Opening sequence\n- Final delivery\n\n<script>window.fixtureXss = true</script>', collectionId: 'notes', collectionTitle: 'Notes', readonly: false, etag: 'note-v1', updatedAt: time(0, 9)},
  ]
  state.workspace.spaces = [
    {id: 'space-work', name: 'Freelance', color: '#3975ce', collectionIds: ['calendar-work', 'tasks-work', 'deck-work'], defaultCalendarId: 'calendar-work', defaultTaskListId: 'tasks-work', defaultBoardId: 'deck-work'},
    {id: 'space-personal', name: 'Personal', color: '#218c6a', collectionIds: ['tasks-personal']},
    {id: 'space-shared', name: 'Shared', color: '#9e5bd6', collectionIds: ['calendar-shared', 'deck-shared']},
  ]
  state.workspace.projects = [{id: 'project-gig', spaceId: 'space-work', name: 'Client film', collectionIds: ['deck-gig'], recordIds: []}]
  state.workspace.relations = [
    {id: 'relation-blocker', type: 'depends_on', fromId: 'card-both', toId: 'card-partner'},
    {id: 'relation-review', type: 'for_event', fromId: 'card-gig', toId: 'event-review', role: 'preparation'},
    {id: 'relation-note', type: 'reference', fromId: 'card-gig', toId: 'note-brief'},
  ]
  state.workspace.plans = [{id: 'plan-work', recordId: 'task-today', start: time(0, 11), end: time(0, 12)}]
  state.statuses = ['tasks', 'calendar', 'deck', 'notes', 'collectives'].map(source => ({source, state: 'connected', count: state.records.filter(r => r.source === source).length, lastSyncedAt: now.toISOString()}))
  state.storage = {syncStatus: 'local', localPath: 'fixture-only/planner.json'}
  return state
}
