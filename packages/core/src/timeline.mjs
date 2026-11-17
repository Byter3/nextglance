/** One row model drives both sides of the timeline. No source data is changed. */
import {organizationMembership} from './organization-tags.mjs'
const list = value => Array.isArray(value) ? value : []
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const asDate = value => value instanceof Date ? value : new Date(dateOnly(value) ? `${value}T00:00:00` : value)

/** Calendar-day coordinates keep columns aligned across daylight-saving changes. */
export function timelineOffset(value, anchor) {
  if (!value) return NaN
  const date = asDate(value), origin = asDate(anchor)
  if (!Number.isFinite(+date) || !Number.isFinite(+origin)) return NaN
  return (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(origin.getFullYear(), origin.getMonth(), origin.getDate())) / 86400000 + (date.getHours() * 60 + date.getMinutes()) / 1440
}

export function timelineInterval(start, end, anchor, daysCount = 14) {
  const first = timelineOffset(start, anchor), last = timelineOffset(end, anchor)
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first || last <= 0 || first >= daysCount) return null
  return {start: Math.max(0, first), end: Math.min(daysCount, last), clippedStart: first < 0, clippedEnd: last > daysCount}
}

export function timelineGeometry(record, anchor, daysCount = 14) {
  const start = timelineOffset(record.start, anchor)
  // A date-only task deadline covers that calendar day; event DTEND remains exclusive.
  const end = timelineOffset(record.kind === 'event' ? record.end : record.due, anchor) + (record.kind !== 'event' && dateOnly(record.due) ? 1 : 0)
  const span = Number.isFinite(start) && Number.isFinite(end) && end > start ? {start, end} : null
  const bar = span && span.end > 0 && span.start < daysCount ? {start: Math.max(0, span.start), end: Math.min(daysCount, span.end), clippedStart: span.start < 0, clippedEnd: span.end > daysCount} : null
  const pointValue = record.due || (!span ? record.start : undefined)
  const offset = timelineOffset(pointValue, anchor) + (dateOnly(pointValue) ? .5 : 0)
  const point = Number.isFinite(offset) && offset >= 0 && offset < daysCount ? {offset, kind: record.due ? 'due' : 'start'} : null
  return {bar, point, scheduled: Boolean(record.start || record.due), visible: Boolean(bar || point)}
}

/** Resolve configured source identity without guessing from collection names. */
function groupingScope({spaces = [], categories = [], projects = [], scopeId = 'all'} = {}) {
  // Overview groups are independent of every Space; unmatched sources stay visible.
  const overviewCategories=list(categories).filter(category=>category.spaceId==='all')
  if (!scopeId || scopeId === 'all') return {spaces:[],categories:overviewCategories,projects:[],invalid:false}
  const overviewCategory=overviewCategories.find(category=>category.id===scopeId)
  if(overviewCategory)return {scopedCategory:overviewCategory,spaces:[],categories:[overviewCategory],projects:[],invalid:false}
  const knownSpaces = list(spaces)
  const knownCategories = list(categories).filter(category => knownSpaces.some(space => space.id === category.spaceId))
  const activeProjects = list(projects).filter(project => !project.archived)
  const scopedSpace = knownSpaces.find(space => space.id === scopeId)
  const scopedCategory = knownCategories.find(category => category.id === scopeId)
  const scopedProject = activeProjects.find(project => project.id === scopeId)
  const parentId = scopedSpace?.id || scopedCategory?.spaceId || scopedProject?.spaceId
  if (!parentId || !knownSpaces.some(space => space.id === parentId)) return {spaces:[],categories:[],projects:[],invalid:true}
  const eligibleSpaces = knownSpaces.filter(space => space.id === parentId)
  const eligibleCategories = scopedCategory ? [scopedCategory] : scopedProject ? knownCategories.filter(category => category.id === scopedProject.categoryId && category.spaceId === scopedProject.spaceId) : knownCategories.filter(category => category.spaceId === parentId)
  const eligibleProjects = scopedProject ? [scopedProject] : scopedCategory ? activeProjects.filter(project => project.categoryId === scopedCategory.id && project.spaceId === scopedCategory.spaceId) : activeProjects.filter(project => project.spaceId === parentId)
  return {scopedSpace, scopedCategory, scopedProject, spaces: eligibleSpaces, categories: eligibleCategories, projects: eligibleProjects,invalid:false}
}

function groupingFor(record, scope, membership) {
  const project = scope.projects.find(item => list(item.recordIds).includes(record.id)) || scope.projects.find(item => list(item.tagNames).length && membership.projects.get(item.id)?.has(record.id)) || scope.projects.find(item => !list(item.tagNames).length && membership.projects.get(item.id)?.has(record.id))
  if (project) {
    const space = scope.spaces.find(item => item.id === project.spaceId)
    const category = scope.categories.find(item => item.id === project.categoryId && item.spaceId === project.spaceId)
    return {space, category, project}
  }
  const category = scope.categories.find(item => list(item.tagNames).length && membership.categories.get(item.id)?.has(record.id)) || scope.categories.find(item => !list(item.tagNames).length && membership.categories.get(item.id)?.has(record.id))
  const space = category ? scope.spaces.find(item => item.id === category.spaceId) : scope.spaces.find(item => membership.scopes.get(item.id)?.has(record.id))
  return {space, category}
}

export function recordGrouping(record, options = {}) { return groupingFor(record, groupingScope(options),organizationMembership(options,[record])) }

/** Resolve one deterministic location per record; explicit project membership wins.
 * Groups carry source IDs so event bands can use the same category identity as work.
 */
export function timelineGroups(records, options = {}) {
  const scope = groupingScope(options)
  if (scope.invalid) return []
  const membership = organizationMembership(options,records)
  const collections = list(options.collections)
  const unique = [...new Map(list(records).filter(record => ['task', 'card'].includes(record.kind)).map(record => [record.id, record])).values()]
  const result = [], spaceGroups = new Map(), categoryGroups = new Map(), projectGroups = new Map(), sourceGroups = new Map(), ungroupedGroups = new Map()
  const group = (id, name, kind, color, depth = 0, extra = {}) => ({id, name, kind, color, depth, records: [], children: [], count: 0, collectionIds: [], ...extra})
  const ensureSpace = space => {
    if (!spaceGroups.has(space.id)) {
      const collectionIds = [...new Set([...list(space.collectionIds), ...scope.categories.filter(category => category.spaceId === space.id).flatMap(category => list(category.collectionIds))])]
      const value = group(`space:${space.id}`, space.name, 'space', space.color, 0, {spaceId:space.id, collectionIds})
      spaceGroups.set(space.id, value); result.push(value)
    }
    return spaceGroups.get(space.id)
  }
  for (const space of scope.spaces) ensureSpace(space)
  const ensureCategory = category => {
    if (!categoryGroups.has(category.id)) {
      const space = scope.spaces.find(item => item.id === category.spaceId)
      const parent = space ? ensureSpace(space) : null
      const value = group(`category:${category.id}`, category.name, 'category', category.color || space?.color, parent ? 1 : 0, {spaceId:category.spaceId, categoryId:category.id, collectionIds:[...list(category.collectionIds)]})
      categoryGroups.set(category.id, value)
      if (parent) parent.children.push(value); else result.push(value)
    }
    return categoryGroups.get(category.id)
  }
  for (const category of scope.categories) ensureCategory(category)
  const ensureProject = project => {
    if (!projectGroups.has(project.id)) {
      const space = scope.spaces.find(item => item.id === project.spaceId)
      const category = scope.categories.find(item => item.id === project.categoryId && item.spaceId === project.spaceId)
      const parent = category ? ensureCategory(category) : space ? ensureSpace(space) : null
      const value = group(`project:${project.id}`, project.name, 'project', project.color || category?.color || space?.color, parent ? parent.depth + 1 : 0, {spaceId:project.spaceId, ...(category ? {categoryId:category.id} : {}), projectId:project.id, collectionIds:[...list(project.collectionIds)]})
      projectGroups.set(project.id, value)
      if (parent) parent.children.push(value); else result.push(value)
    }
    return projectGroups.get(project.id)
  }
  for (const project of scope.projects) ensureProject(project)
  const ensureUngrouped = space => {
    if (!ungroupedGroups.has(space.id)) {
      const parent = ensureSpace(space)
      const value = group(`ungrouped:space:${space.id}`, 'Ungrouped sources', 'collection', undefined, 1, {spaceId:space.id})
      ungroupedGroups.set(space.id, value); parent.children.push(value)
    }
    return ungroupedGroups.get(space.id)
  }
  const collectionById = new Map(collections.map(collection => [collection.id, collection]))
  const sourceNames = {tasks:'Task list',deck:'Deck board',calendar:'Calendar',notes:'Notes',collectives:'Collective'}
  const collectionNames = new Map()
  for (const collection of collections) {
    const title = String(collection.title || '').trim().toLocaleLowerCase()
    collectionNames.set(title, (collectionNames.get(title) || 0) + 1)
  }
  for (const record of unique) {
    const {space, category, project} = groupingFor(record, scope,membership)
    if (project) {ensureProject(project).records.push(record); continue}
    if (category) {ensureCategory(category).records.push(record); continue}
    if (space) {ensureUngrouped(space).records.push(record); continue}
    const id = record.collectionId || `source:${record.source}`
    if (!sourceGroups.has(id)) {
      const collection = collectionById.get(id)
      const title = collection?.title || record.collectionTitle || ({tasks:'Tasks',deck:'Deck',calendar:'Calendar'}[record.source]) || 'Other items'
      const name = (collectionNames.get(String(title).trim().toLocaleLowerCase()) || 0) > 1 ? `${title} · ${sourceNames[record.source] || record.source}` : title
      const value = group(`collection:${id}`, name, 'collection', collection?.color, 0, {collectionIds:record.collectionId ? [record.collectionId] : []})
      value.source = record.source
      sourceGroups.set(id, value); result.push(value)
    }
    sourceGroups.get(id).records.push(record)
  }
  const finish = value => {
    value.children = value.children.map(finish).filter(child => child.count > 0)
    value.count = value.records.length + value.children.reduce((sum, child) => sum + child.count, 0)
    value.collectionIds = [...new Set([...value.collectionIds, ...value.records.map(record => record.collectionId).filter(Boolean), ...value.children.flatMap(child => child.collectionIds)])]
    return value
  }
  return result.map(finish).filter(value => value.count > 0)
}

export function timelineStatus(record, collections = []) {
  if (record.completed) return 'Done'
  if (record.kind === 'event') return record.allDay ? 'All day' : 'Event'
  if (record.kind === 'card') return list(collections).find(item => item.id === record.collectionId)?.stacks?.find(stack => stack.id === record.stackId)?.title || record.status || 'Unsorted'
  const status = String(record.status || '').toUpperCase()
  return status === 'CANCELLED' ? 'Cancelled' : status === 'IN-PROCESS' ? 'In progress' : 'To do'
}

/** Calendar events are background time bands, never work rows. Label lanes use
 * their visible pixel widths so short bookings remain readable at a day zoom. */
export function timelineEvents(records, anchor, daysCount = 14, plotWidth = 840, maxLanes = 3) {
  const width = Math.max(1, Number(plotWidth) || 840)
  const lanes = []
  const events = [...new Map(list(records).filter(record => record.kind === 'event').map(record => [record.id, record])).values()]
    .flatMap(record => {
      const shape = timelineGeometry(record, anchor, daysCount)
      const range = shape.bar || (shape.point ? {start: shape.point.offset, end: shape.point.offset, clippedStart: false, clippedEnd: false} : null)
      return range ? [{record, range}] : []
    }).sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end || String(a.record.title).localeCompare(String(b.record.title)))
  const entries = events.map(({record, range}) => {
    const labelWidth = Math.min(width, Math.max(156, Math.min(236, String(record.title).length * 7 + 34)))
    // Center short bookings over their narrow band; all-day labels follow the
    // band's leading edge. This also avoids unnecessary header lanes at day zoom.
    const desiredLeft = range.end - range.start < 1 ? (range.start + range.end) / 2 / daysCount * width - labelWidth / 2 : range.start / daysCount * width + 3
    const labelLeft = Math.max(0, Math.min(desiredLeft, width - labelWidth - 3))
    let lane = lanes.findIndex(end => end + 8 <= labelLeft)
    if (lane < 0 && lanes.length < Math.max(1, maxLanes)) lane = lanes.length
    if (lane >= 0) lanes[lane] = labelLeft + labelWidth
    return {record, range, labelLeft, labelWidth, lane, overflow: lane < 0}
  })
  return {entries, lanes: Math.max(1, lanes.length), overflow: entries.filter(entry => entry.overflow)}
}
