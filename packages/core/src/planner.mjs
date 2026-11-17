/** Portable planner projections. No transport, storage, framework or sample data. */
import { normalizeStatusMapping, mappedBoardColumns, effectiveStatusMapping, filterUnifiedStatuses } from './status-mapping.mjs'
import { normalizeArrangements } from './planning-order.mjs'
import { organizationMembership, organizationSourcePool } from './organization-tags.mjs'
const SOURCES = ['tasks', 'calendar', 'deck', 'notes', 'collectives']
const VIEWS = ['overview', 'calendar', 'timeline', 'board', 'list']
const ASSOCIATIONS = new Set(['for_event', 'scheduled_during', 'reference'])
const action = record => record.kind === 'task' || record.kind === 'card'
const list = value => Array.isArray(value) ? value : []
const unique = value => [...new Set(list(value).filter(item => typeof item === 'string'))]
export const isClosed = record => Boolean(record.completed || record.kind === 'task' && String(record.status || '').toUpperCase() === 'CANCELLED')
export const planningColumnForRecord = (record, workflow = {}) => record.completed ? 'done' : isClosed(record) ? 'cancelled' : ['inbox','planned','doing','done'].includes(workflow[record.id]) ? workflow[record.id] : 'inbox'
const validDate = value => {
  if (value === undefined || value === null || value === '' || !Number.isFinite(new Date(value).getTime())) return false
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number)
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false
  }
  return true
}

export function plannerSettings(input = {}) {
  const arrangements = normalizeArrangements(input.arrangements)
  return {
    view: VIEWS.includes(input.view) ? input.view : 'overview',
    scopeId: typeof input.scopeId === 'string' ? input.scopeId : 'all',
    assignment: input.assignment === 'all' ? 'all' : 'me',
    includeUnassigned: input.includeUnassigned === true,
    unassignedBoardIds: unique(input.unassignedBoardIds),
    hiddenCollectionIds: unique(input.hiddenCollectionIds),
    excludedSpaceIds: unique(input.excludedSpaceIds),
    showCompleted: input.showCompleted === true,
    showCompletedByView: Object.fromEntries(Object.entries(input.showCompletedByView || {}).filter(([view,value]) => VIEWS.includes(view) && typeof value === 'boolean')),
    scopeAssignments: Object.fromEntries(Object.entries(input.scopeAssignments || {}).filter(([, value]) => ['me', 'all'].includes(value))),
    workflow: Object.fromEntries(Object.entries(input.workflow || {}).filter(([, value]) => ['inbox', 'planned', 'doing', 'done'].includes(value))),
    ...(normalizeStatusMapping(input.statusMapping) ? {statusMapping:normalizeStatusMapping(input.statusMapping)} : {}),
    ...(arrangements ? {arrangements} : {}),
  }
}

/** New layouts inherit the legacy preference until explicitly toggled. */
export function showCompletedForView(settings, view = settings?.view) {
  const value = settings?.showCompletedByView?.[view]
  return typeof value === 'boolean' ? value : settings?.showCompleted === true
}

/** Apply completion last: a card hidden by explicit filters cannot admit a task. */
export function filterCompletedWork(records, relations = [], view = 'overview', showCompleted = false) {
  if(showCompleted)return records
  if(view!=='board')return records.filter(record=>!action(record)||!isClosed(record))
  const cards=new Set(records.filter(record=>record.kind==='card'&&record.source==='deck').map(record=>record.id)),linked=new Set()
  for(const edge of relations)if(['depends_on','related','reference'].includes(edge.type)){
    if(cards.has(edge.fromId))linked.add(edge.toId)
    if(cards.has(edge.toId))linked.add(edge.fromId)
  }
  return records.filter(record=>!action(record)||record.kind==='card'&&record.source==='deck'||!isClosed(record)||record.kind==='task'&&record.completed===true&&linked.has(record.id))
}

export function createPlannerWorkspace() {
  return {
    schemaVersion: 2, id: 'workspace', name: 'My planner', updatedAt: new Date().toISOString(),
    spaces: [], categories: [], projects: [], relations: [], plans: [], identities: [], properties: {},
    appearance: {mode: 'system', calendarColors: {}}, planner: plannerSettings(),
  }
}

export function createEmptyState() {
  return {
    mode: 'disconnected', workspace: createPlannerWorkspace(), revision: 0,
    records: [], collections: [],
    statuses: SOURCES.map(source => ({source, state: 'unavailable', count: 0, message: 'Connect Nextcloud to load this source.'})),
    connection: {connected: false}, storage: {syncStatus: 'local'},
  }
}

/** Source status is the default authority. Personal planning is an explicit view. */
export function boardColumns(records, collections, options = {}) {
  const actions = [...new Map(list(records).filter(action).map(record => [record.id, record])).values()]
  if (options.mode === 'mapped') return mappedBoardColumns(actions,collections,options.statusMapping)
  if (options.mode === 'planning') {
    const workflow = options.workflow || {}
    const columns = [{id:'inbox',title:'Inbox'},{id:'planned',title:'Planned'},{id:'doing',title:'In progress'},{id:'done',title:'Done'},{id:'cancelled',title:'Cancelled'}]
    return columns.map(column => ({...column, records: actions.filter(record => planningColumnForRecord(record, workflow) === column.id)}))
  }
  const collectionMap = new Map(list(collections).map(collection => [collection.id, collection]))
  const stackTitle = record => collectionMap.get(record.collectionId)?.stacks?.find(stack => stack.id === record.stackId)?.title || record.status || 'Unsorted'
  if (options.mode === 'deck') {
    const cards = actions.filter(record => record.kind === 'card' && record.collectionId === options.boardId)
    const columns = list(collectionMap.get(options.boardId)?.stacks).map(stack => ({id:stack.id,title:stack.title,records:[]}))
    const byId = new Map(columns.map(column => [column.id, column]))
    for (const record of cards) {
      const id = record.stackId || `missing:${stackTitle(record)}`
      if (!byId.has(id)) { const column = {id,title:stackTitle(record),records:[]}; byId.set(id,column); columns.push(column) }
      byId.get(id).records.push(record)
    }
    return columns
  }
  const groups = new Map()
  const add = (title, record) => {
    // Merge only identical labels (ignoring case/spacing), never guess the
    // meaning of custom Deck stacks such as Review, Waiting, or Hungarian names.
    const clean = String(title).trim().replace(/\s+/g, ' ') || 'Unsorted'
    const id = `status:${clean.toLowerCase()}`
    if (!groups.has(id)) groups.set(id, {id,title:clean,records:[]})
    if (record) groups.get(id).records.push(record)
  }
  for (const collection of list(collections)) if (collection.source === 'deck') for (const stack of list(collection.stacks)) add(stack.title)
  if (list(collections).some(collection => collection.source === 'tasks') || actions.some(record => record.kind === 'task')) for (const title of ['To do','In progress','Done','Cancelled']) add(title)
  if (list(collections).some(collection => collection.source === 'deck') || actions.some(record => record.kind === 'card')) add('Done')
  for (const record of actions) {
    if (record.completed) { add('Done', record); continue }
    if (record.kind === 'card') { add(stackTitle(record), record); continue }
    const status = String(record.status || '').toUpperCase()
    add(status === 'CANCELLED' ? 'Cancelled' : status === 'IN-PROCESS' ? 'In progress' : 'To do', record)
  }
  const rank = id => id === 'status:to do' ? -2 : id === 'status:in progress' ? -1 : id === 'status:done' ? 2 : id === 'status:cancelled' ? 3 : 0
  return [...groups.values()].sort((a,b) => rank(a.id) - rank(b.id))
}

/** Preserve date-only values as calendar dates instead of interpreting them as UTC. */
export function localDay(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? value : ''
  }
  if (!validDate(value)) return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayDate(value) {
  const day = localDay(value)
  if (!day) return null
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

export function weekDays(anchor = new Date()) {
  const monday = dayDate(anchor) || dayDate(new Date())
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  return Array.from({length: 7}, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index))
}

function intervalOverlaps(start, end, date, allDay = false) {
  const from = dayDate(date)
  if (!from) return false
  const until = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)
  const a = allDay ? dayDate(start) : (validDate(start) ? new Date(start) : null)
  if (!a) return false
  const b = allDay ? dayDate(end) : (validDate(end) ? new Date(end) : null)
  if (!b || b <= a) return localDay(start) === localDay(date)
  return a < until && b > from
}

export function dayItems(records, date, plans = []) {
  const key = localDay(date)
  if (!key) return []
  const scheduled = new Set(list(plans).filter(plan => intervalOverlaps(plan.start, plan.end, date)).map(plan => plan.recordId))
  return list(records).filter(record =>
    record.kind === 'event' ? intervalOverlaps(record.start, record.end, date, record.allDay) :
      action(record) && (localDay(record.due) === key || scheduled.has(record.id))
  )
}

/** A Deck card's selected dependencies are its prerequisites: dependent -> prerequisite. */
export function allRelations(workspace, records) {
  const edges = []; const seen = new Set()
  const recordsById = new Map(list(records).map(record => [record.id, record]))
  const addNative = (fromId, toId, label) => {
    const key = `depends_on\0${fromId}\0${toId}`
    if (fromId === toId || seen.has(key)) return
    seen.add(key)
    edges.push({id: `native:depends_on:${fromId}:${toId}`, type: 'depends_on', fromId, toId, label, native: true})
  }
  for (const record of list(records)) {
    // Both legacy names held the unchanged raw dependentCards list. Never infer
    // direction from those old field names; a fresh canonical [] also wins.
    const dependencies = Array.isArray(record.nativeDependencies) ? record.nativeDependencies : record.nativeDependents ?? record.nativeRelatedIds
    for (const otherId of unique(dependencies)) addNative(record.id, otherId, record.source === 'deck' ? 'Deck dependency' : 'Native prerequisite')
  }
  const notesByFile = new Map(list(records).filter(record => record.kind === 'note' && record.fileId).map(record => [String(record.fileId), record]))
  for (const card of list(records).filter(record => record.kind === 'card')) {
    for (const fileId of unique(card.attachmentFileIds)) {
      const note = notesByFile.get(String(fileId))
      if (!note) continue
      const key = `reference\0${card.id}\0${note.id}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({id:`native:reference:${card.id}:${note.id}`,type:'reference',fromId:card.id,toId:note.id,label:'Deck attachment',native:true})
    }
  }
  for (const edge of list(workspace?.relations)) {
    const from = recordsById.get(edge.fromId), to = recordsById.get(edge.toId)
    // Deck owns card-to-note references. Pending imports are never presented
    // as if they were already native attachments.
    if (['reference','related'].includes(edge.type) && ((from?.kind === 'card' && to?.kind === 'note') || (from?.kind === 'note' && to?.kind === 'card'))) continue
    const key = `${edge.type}\0${edge.fromId}\0${edge.toId}`
    if (seen.has(key)) continue
    seen.add(key); edges.push(edge)
  }
  return edges
}

function scopeMembership(workspace, scopeId, availableIds=[]) {
  const space = list(workspace.spaces).find(item => item.id === scopeId)
  const category = list(workspace.categories).find(item => item.id === scopeId)
  const project = list(workspace.projects).find(item => item.id === scopeId)
  if (!space && !category && !project) return {collectionIds:new Set(),explicit:new Set()}
  const projects = project ? [project] : list(workspace.projects).filter(item => !item.archived && (category ? item.categoryId === category.id && item.spaceId === category.spaceId : item.spaceId === space.id))
  const categories = category ? [category] : space ? list(workspace.categories).filter(item => item.spaceId === space.id) : []
  const sources = item => list(item.tagNames).length && !list(item.collectionIds).length ? organizationSourcePool(workspace,item.spaceId,availableIds) : list(item.collectionIds)
  const collectionIds = new Set([...(space ? list(space.collectionIds) : []), ...categories.flatMap(sources), ...projects.flatMap(sources)])
  const explicit = new Set(projects.flatMap(item => list(item.recordIds)))
  return {collectionIds,explicit}
}

/** The source/status catalog must not disappear when visible item filters are empty. */
export function boardCollectionsForScope(workspace, records, collections, scopeId) {
  if (scopeId === 'all') return list(collections).filter(collection => ['tasks','deck'].includes(collection.source))
  const {collectionIds,explicit} = scopeMembership(workspace,scopeId,list(collections).map(item=>item.id))
  for (const record of records) if (explicit.has(record.id)) collectionIds.add(record.collectionId)
  return list(collections).filter(collection => ['tasks','deck'].includes(collection.source) && collectionIds.has(collection.id))
}

function baseScopeRecordIds(workspace, records, scopeId, membership) {
  const ids = (membership || organizationMembership(workspace,records)).scopes.get(scopeId) || new Set()
  return new Set(records.filter(record => ids.has(record.id)).map(record => record.id))
}

export function scopeRecordIds(workspace, records, scopeId, membership) {
  const base = baseScopeRecordIds(workspace, records, scopeId,membership)
  if (scopeId === 'all') return base
  const result = new Set(base)
  const byId = new Map(records.map(record => [record.id, record]))
  // Contextual event/note associations expand a scope; dependencies do not pull
  // another person's tasks or the entire parent calendar into a project.
  for (const relation of allRelations(workspace, records)) {
    if (!ASSOCIATIONS.has(relation.type)) continue
    for (const [own, other] of [[relation.fromId, relation.toId], [relation.toId, relation.fromId]]) {
      if (!base.has(own)) continue
      const candidate = byId.get(other)
      if (candidate && ['event', 'note', 'page'].includes(candidate.kind)) result.add(other)
    }
  }
  return result
}

/** Linked resources are context, not a second source selection or work owner. */
export function scopeContextRecordIds(workspace, records, scopeId) {
  if (!scopeId || scopeId === 'all') return new Set()
  const direct = baseScopeRecordIds(workspace, records, scopeId)
  return new Set([...scopeRecordIds(workspace, records, scopeId)].filter(id => !direct.has(id)))
}

export function relationsFor(recordId, relations, records) {
  const byId = new Map(records.map(record => [record.id, record]))
  return {
    incoming: relations.filter(edge => edge.toId === recordId).map(edge => ({...edge, record: byId.get(edge.fromId) || null})),
    outgoing: relations.filter(edge => edge.fromId === recordId).map(edge => ({...edge, record: byId.get(edge.toId) || null})),
  }
}

export function canAddRelation(relations, fromId, toId, type, records) {
  return createRelationIndex(relations,records).canAdd(fromId,toId,type)
}

/** One snapshot index serves validation and large candidate lists. */
export function createRelationIndex(relations,records){
  const byId=records?new Map(list(records).map(record=>[record.id,record])):null
  const edges=new Set(),forward=new Map(),reverse=new Map(),ancestors=new Map(),descendants=new Map()
  const key=(type,from,to)=>JSON.stringify([type,from,to])
  for(const edge of relations){
    edges.add(key(edge.type,edge.fromId,edge.toId))
    if(edge.type==='depends_on'){
      if(!forward.has(edge.fromId))forward.set(edge.fromId,[])
      if(!reverse.has(edge.toId))reverse.set(edge.toId,[])
      forward.get(edge.fromId).push(edge.toId);reverse.get(edge.toId).push(edge.fromId)
    }
  }
  function reachable(id,graph,cache){
    if(cache.has(id))return cache.get(id)
    const found=new Set(),pending=[id]
    while(pending.length){const next=pending.pop();if(found.has(next))continue;found.add(next);for(const child of graph.get(next)||[])pending.push(child)}
    cache.set(id,found);return found
  }
  return {byId,has:(type,from,to)=>edges.has(key(type,from,to)),prepare(id){reachable(id,forward,descendants);reachable(id,reverse,ancestors)},canAdd(fromId,toId,type){
  if (!fromId || !toId) return {ok: false, message: 'Choose two available items.'}
  if (!['depends_on', 'for_event', 'scheduled_during', 'reference', 'related'].includes(type)) return {ok: false, message: 'Choose a supported relationship.'}
  if (fromId === toId) return {ok: false, message: 'An item cannot link to itself.'}
  if (edges.has(key(type,fromId,toId))) return {ok: false, message: 'These items already have this relationship.'}
  if (type === 'depends_on') {
    if (byId && ![fromId, toId].every(id => byId.has(id)&&action(byId.get(id)))) return {ok: false, message: 'Dependencies connect tasks and Deck cards. Use an event or reference relationship for other items.'}
    const cycle=ancestors.has(fromId)?ancestors.get(fromId).has(toId):reachable(toId,forward,descendants).has(fromId)
    if(cycle)return {ok: false, message: 'This would create a circular dependency.'}
  }
  return {ok: true}
  }}
}

const unassigned = record => record.assignmentKnown === true && (record.assignmentCount ?? list(record.assigneeIds).length) === 0
function assignmentMatches(record, settings, username) {
  if (record.kind !== 'card' || settings.assignment === 'all') return true
  if (record.assignmentKnown !== true) return false
  if (username && list(record.assigneeIds).includes(username)) return true
  return unassigned(record) && (settings.includeUnassigned || settings.unassignedBoardIds.includes(record.collectionId))
}

function selectionSettings(workspace, overrides) {
  const settings = plannerSettings({...workspace.planner, ...overrides})
  if (!Object.hasOwn(overrides, 'showCompleted')) settings.showCompleted = showCompletedForView(settings)
  if (!Object.hasOwn(overrides, 'assignment')) settings.assignment = settings.scopeAssignments[settings.scopeId] || (settings.scopeId === 'all' ? settings.assignment : 'all')
  return settings
}
const matchesQuery = (record, query) => !query || [record.title, record.collectionTitle, ...(record.tags || [])].some(value => value?.toLocaleLowerCase().includes(query))

/** The open-work badge needs the same selection, not a complete sorted model.
 * Context associations only add events/notes/pages, never another work item. */
export function countPlannerActions(state, overrides = {}) {
  const settings = selectionSettings(state.workspace, overrides)
  const query = String(overrides.query || '').trim().toLocaleLowerCase()
  const records = [...new Map(list(state.records).map(record => [record.id, record])).values()]
  const hidden = new Set(settings.hiddenCollectionIds)
  const base = records.filter(record => !hidden.has(record.collectionId))
  const ids = baseScopeRecordIds(state.workspace, base, settings.scopeId)
  const statusRecords = filterUnifiedStatuses(base,effectiveStatusMapping(state.workspace,settings.scopeId,state.collections),overrides.statusIds)
  let count = 0
  for (const record of statusRecords) if (ids.has(record.id) && action(record) && !isClosed(record) && assignmentMatches(record, settings, state.connection?.username) && matchesQuery(record, query)) count++
  return count
}

export function selectPlanner(state, overrides = {}) {
  const workspace = state.workspace
  const settings = selectionSettings(workspace, overrides)
  const now = overrides.now && validDate(overrides.now) ? new Date(overrides.now) : new Date()
  const today = localDay(now)
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
  const query = String(overrides.query || '').trim().toLocaleLowerCase()
  const records = [...new Map(list(state.records).map(record => [record.id, record])).values()]
  const hidden = new Set(settings.hiddenCollectionIds)
  const base = records.filter(record => !hidden.has(record.collectionId))
  const membership = organizationMembership(workspace,records)
  const scopeIds = scopeRecordIds(workspace, base, settings.scopeId,membership)
  // Spaces are independent saved views, never visibility owners in My overview.
  // Keep accepting the old device field without letting stale exclusions hide work.
  const inScope = base.filter(record => scopeIds.has(record.id))
  const relations = allRelations(workspace, records)
  const openScope = filterCompletedWork(inScope,relations,settings.view,settings.showCompleted)
  const eligible = inScope.filter(record => assignmentMatches(record, settings, state.connection?.username))
  const selected = filterCompletedWork(filterUnifiedStatuses(eligible.filter(record => matchesQuery(record, query)),effectiveStatusMapping(workspace,settings.scopeId,state.collections),overrides.statusIds),relations,settings.view,settings.showCompleted)
  const primaryIds = settings.scopeId === 'all' ? scopeIds : baseScopeRecordIds(workspace, base, settings.scopeId,membership)
  const contextRecordIds = selected.filter(record => !primaryIds.has(record.id)).map(record => record.id)
  const actions = selected.filter(action)
  // Parse each due date once per projection rather than in every sort
  // comparison and attention bucket. No cache outlives the current inputs.
  const actionFacts = new Map(actions.map(record => [record, {closed:isClosed(record), day:localDay(record.due)}]))
  actions.sort((a,b) => {
    const left = actionFacts.get(a), right = actionFacts.get(b)
    if (left.closed !== right.closed) return left.closed ? 1 : -1
    return (left.day || '9999').localeCompare(right.day || '9999') || a.title.localeCompare(b.title)
  })
  const openActions = actions.filter(record => !actionFacts.get(record).closed)
  const events = selected.filter(record => record.kind === 'event').sort((a, b) => (a.start || '').localeCompare(b.start || ''))
  const resources = selected.filter(record => ['note', 'page'].includes(record.kind)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || a.title.localeCompare(b.title))
  const overdue = [], dueToday = [], upcoming = [], undated = [], weekEndDay = localDay(weekEnd)
  for (const record of openActions) {
    const day = actionFacts.get(record).day
    if (!day) undated.push(record)
    else if (day < today) overdue.push(record)
    else if (day === today) dueToday.push(record)
    else if (day < weekEndDay) upcoming.push(record)
  }
  const byId = new Map(records.map(record => [record.id, record]))
  const blocked = new Set()
  const ownActionIds = new Set(openActions.map(record => record.id))
  for (const edge of relations) if (edge.type === 'depends_on' && ownActionIds.has(edge.fromId)) {
    const prerequisite = byId.get(edge.toId)
    if (prerequisite && action(prerequisite) && !prerequisite.completed) blocked.add(edge.fromId)
  }
  const selectedSpace = workspace.spaces.find(item => item.id === settings.scopeId)
  const selectedCategory = list(workspace.categories).find(item => item.id === settings.scopeId)
  const selectedProject = workspace.projects.find(item => item.id === settings.scopeId)
  const scope = settings.scopeId === 'all' ? {id: 'all', name: 'My overview', kind: 'all'} : selectedSpace ?
    {id: selectedSpace.id, name: selectedSpace.name, color: selectedSpace.color, kind: 'space'} : selectedCategory ?
      {id: selectedCategory.id, name: selectedCategory.name, color: selectedCategory.color, kind: 'category'} : selectedProject ?
      {id: selectedProject.id, name: selectedProject.name, color: selectedProject.color || workspace.spaces.find(item => item.id === selectedProject.spaceId)?.color, kind: 'project'} :
      {id: settings.scopeId, name: 'Unavailable space', kind: 'space', unavailable: true}
  const countScope = id => {
    // Navigation badges describe each destination, not the active view's
    // temporary hidden-source/unassigned filters.
    // Context adds resources, not actions. Do not reassemble every relation
    // merely to count each navigation destination's open work.
    const ids = baseScopeRecordIds(workspace, records, id,membership)
    const destinationSettings = {...settings, assignment: settings.scopeAssignments[id] || 'all', includeUnassigned:false,unassignedBoardIds:[]}
    return records.filter(record => ids.has(record.id) && action(record) && !isClosed(record) && assignmentMatches(record, destinationSettings, state.connection?.username)).length
  }
  return {
    records: selected, contextRecordIds, actions, events, resources, overdue, today: dueToday, upcoming, undated,
    spaces: workspace.spaces.map(space => ({...space, openCount: countScope(space.id)})),
    categories: list(workspace.categories).map(category => ({...category, openCount: countScope(category.id)})),
    projects: workspace.projects.filter(project => !project.archived).map(project => ({...project, openCount: countScope(project.id)})),
    relations, scope,
    hiddenAssignmentCount: openScope.filter(record => record.kind === 'card' && !assignmentMatches(record, settings, state.connection?.username)).length,
    unassignedCount: openScope.filter(record => record.kind === 'card' && unassigned(record)).length,
    unknownAssignmentCount: openScope.filter(record => record.kind === 'card' && record.assignmentKnown !== true).length,
    counts: {actions: openActions.length, events: events.length, overdue: overdue.length, today: dueToday.length, undated: undated.length, blocked: blocked.size, records: selected.length},
  }
}
