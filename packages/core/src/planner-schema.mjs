import { createPlannerWorkspace, plannerSettings, localDay } from './planner.mjs'
import { parseStatusSourceKey } from './status-mapping.mjs'
import {safeArrangementId,validBoardOrderKey} from './planning-order.mjs'
import {organizationTagKey} from './organization-tags.mjs'
import {validateCardTaskReceipts} from './card-tasks.mjs'

const MAX_WORKSPACE_BYTES = 8 * 1024 * 1024
const sources = new Set(['tasks', 'calendar', 'deck', 'notes', 'collectives'])
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
export const hexColor = value => typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
function invalid(message) { throw new Error(`Invalid workspace: ${message}`) }
function text(value, label, maximum = 2048, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > maximum || value.includes('\0')) invalid(label)
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(label)
}
function keys(value, allowed, label) {
  object(value, label)
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${label} contains unsupported field ${key}`)
}
export function jsonValue(value, depth = 0, maxDepth = 12, stringLimit = 200000) {
  if (depth > maxDepth) invalid('custom properties are nested too deeply')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') { text(value, 'custom property text', stringLimit, true); return }
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid('non-finite number'); return }
  if (Array.isArray(value)) {
    if (value.length > 20000) invalid('array is too large')
    for (const item of value) jsonValue(item, depth + 1, maxDepth, stringLimit)
    return
  }
  object(value, 'custom property value')
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key) || key.length > 2048 || key.includes('\0')) invalid('unsafe property key')
    jsonValue(item, depth + 1, maxDepth, stringLimit)
  }
}
function stringList(value, label, maximum = 5000) {
  if (!Array.isArray(value) || value.length > maximum || new Set(value).size !== value.length) invalid(label)
  for (const item of value) text(item, label)
}
function list(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) invalid(label)
  const ids = new Set()
  for (const item of value) {
    text(item?.id, `${label} id`)
    if(item.id==='all')invalid('all is reserved for My overview')
    if (ids.has(item.id)) invalid(`duplicate ${label} id`)
    ids.add(item.id)
  }
  return ids
}
function timestamp(value) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  return Boolean(match && localDay(match[1]) === match[1] && +match[2] < 24 && +match[3] < 60 && +(match[4] || 0) < 60 && +(match[7] || 0) < 24 && +(match[8] || 0) < 60 && Number.isFinite(Date.parse(value)))
}
function tagNames(value) {
  if (value === undefined) return
  stringList(value,'organization tags',100)
  const seen = new Set()
  for (const name of value) {
    text(name,'organization tag name',200)
    const key = organizationTagKey(name)
    if (name !== name.trim() || !key || seen.has(key)) invalid('organization tag names must be trimmed and canonically unique')
    seen.add(key)
  }
}
function statusMapping(mapping) {
  keys(mapping, ['columns', 'assignments'], 'status mapping')
  const columnIds = list(mapping.columns, 'status mapping column', 30)
  if (!columnIds.size) invalid('status mapping needs a column')
  for (const column of mapping.columns) {
    keys(column, ['id', 'title', 'color'], 'status mapping column')
    if (column.id.startsWith('$')) invalid('reserved status mapping column id')
    text(column.title, 'status mapping column title', 120)
    if (!/^#[\da-f]{6}$/i.test(column.color)) invalid('status mapping column color')
  }
  object(mapping.assignments, 'status mapping assignments')
  if (Object.keys(mapping.assignments).length > 10000) invalid('too many mapped statuses')
  for (const [sourceKey,columnId] of Object.entries(mapping.assignments)) {
    if (!parseStatusSourceKey(sourceKey)) invalid('native status mapping key')
    if (!columnIds.has(columnId)) invalid('status mapping references an unavailable column')
  }
}

export function validateWorkspace(workspace) {
  jsonValue(workspace)
  if (new TextEncoder().encode(JSON.stringify(workspace)).byteLength > MAX_WORKSPACE_BYTES) invalid('maximum size is 8 MB')
  keys(workspace, ['schemaVersion', 'id', 'name', 'spaces', 'categories', 'projects', 'relations', 'plans', 'identities', 'properties', 'updatedAt', 'appearance', 'planner'], 'root')
  if (workspace.schemaVersion !== 2) invalid('unsupported schema version')
  text(workspace.id, 'id'); text(workspace.name, 'name', 200); text(workspace.updatedAt, 'updatedAt', 80)
  if (!Number.isFinite(Date.parse(workspace.updatedAt))) invalid('updatedAt must be a date')
  const spaceIds = list(workspace.spaces, 'space', 200)
  if(spaceIds.has('all'))invalid('all is reserved for My overview')
  for (const space of workspace.spaces) {
    keys(space, ['id', 'name', 'color', 'collectionIds', 'defaultCalendarId', 'defaultTaskListId', 'defaultBoardId', 'statusMapping'], 'space')
    text(space.name, 'space name', 200)
    if (!hexColor(space.color)) invalid('space color')
    stringList(space.collectionIds, 'space collections')
    if (space.statusMapping !== undefined) statusMapping(space.statusMapping)
    for (const key of ['defaultCalendarId', 'defaultTaskListId', 'defaultBoardId']) if (space[key] !== undefined) text(space[key], `space ${key}`)
  }
  const categories = workspace.categories === undefined ? [] : workspace.categories
  const categoryIds = list(categories, 'category', 1000)
  if(categoryIds.has('all'))invalid('all is reserved for My overview')
  const categorySources = new Set()
  const overviewNames = new Set()
  for (const category of categories) {
    if(category.id.startsWith('$draft-group:'))invalid('source group draft needs a persistent identity')
    keys(category, ['id', 'spaceId', 'name', 'color', 'collectionIds', 'tagNames'], 'category')
    if (spaceIds.has(category.id)) invalid('space and category IDs must be distinct')
    text(category.name, 'category name', 200); text(category.spaceId, 'category space')
    if (category.spaceId!=='all'&&!spaceIds.has(category.spaceId)) invalid('category space is unavailable')
    if(category.spaceId==='all'){
      const key=organizationTagKey(category.name)
      if(category.name!==category.name.trim()||overviewNames.has(key))invalid('overview group names must be trimmed and unique')
      overviewNames.add(key)
    }
    if (!hexColor(category.color)) invalid('category color')
    stringList(category.collectionIds, 'category collections')
    tagNames(category.tagNames)
    for (const id of category.tagNames?.length ? [] : category.collectionIds) {
      const key = JSON.stringify([category.spaceId, id])
      if (categorySources.has(key)) invalid('a source can belong to only one category within a Space')
      categorySources.add(key)
    }
  }
  const projectIds = list(workspace.projects, 'project', 1000)
  if(projectIds.has('all'))invalid('all is reserved for My overview')
  for (const project of workspace.projects) {
    keys(project, ['id', 'spaceId', 'categoryId', 'name', 'color', 'collectionIds', 'recordIds', 'archived', 'tagNames'], 'project')
    if (spaceIds.has(project.id) || categoryIds.has(project.id)) invalid('space, category and project IDs must be distinct')
    text(project.name, 'project name', 200); text(project.spaceId, 'project space')
    if (!spaceIds.has(project.spaceId)) invalid('project space is unavailable')
    if (project.categoryId !== undefined) {
      text(project.categoryId, 'project category')
      const category = (workspace.categories ?? []).find(item => item.id === project.categoryId)
      if (!category || category.spaceId !== project.spaceId) invalid('project category must belong to its Space')
    }
    if (project.color !== undefined && !hexColor(project.color)) invalid('project color')
    stringList(project.collectionIds, 'project collections'); stringList(project.recordIds, 'project records')
    tagNames(project.tagNames)
    if (project.archived !== undefined && typeof project.archived !== 'boolean') invalid('project archived')
  }
  list(workspace.relations, 'relation', 10000)
  const edgeKeys = new Set(), graph = new Map(), indegree = new Map()
  for (const relation of workspace.relations) {
    keys(relation, ['id', 'type', 'fromId', 'toId', 'role', 'label'], 'relation')
    if (!['depends_on', 'for_event', 'scheduled_during', 'reference', 'related'].includes(relation.type)) invalid('relation type')
    text(relation.fromId, 'relation from'); text(relation.toId, 'relation to')
    if (relation.fromId === relation.toId) invalid('a relation cannot link an item to itself')
    if (relation.label !== undefined) text(relation.label, 'relation label', 200, true)
    if (relation.role !== undefined && !['preparation', 'during', 'follow_up'].includes(relation.role)) invalid('relation role')
    const edge = JSON.stringify([relation.type, relation.fromId, relation.toId, relation.role || ''])
    if (edgeKeys.has(edge)) invalid('duplicate relationship')
    edgeKeys.add(edge)
    if (relation.type === 'depends_on') {
      const targets = graph.get(relation.fromId) || []
      targets.push(relation.toId); graph.set(relation.fromId, targets)
      if (!indegree.has(relation.fromId)) indegree.set(relation.fromId, 0)
      indegree.set(relation.toId, (indegree.get(relation.toId) || 0) + 1)
    }
  }
  const queue = [...indegree].filter(([, n]) => n === 0).map(([id]) => id)
  for (let cursor = 0; cursor < queue.length; cursor++) for (const id of graph.get(queue[cursor]) || []) {
    indegree.set(id, indegree.get(id) - 1)
    if (indegree.get(id) === 0) queue.push(id)
  }
  if (queue.length !== indegree.size) invalid('dependency cycle')
  list(workspace.plans, 'plan', 10000)
  for (const plan of workspace.plans) {
    keys(plan, ['id', 'recordId', 'start', 'end'], 'plan')
    text(plan.recordId, 'plan record'); text(plan.start, 'plan start', 80); text(plan.end, 'plan end', 80)
    if (!timestamp(plan.start) || !timestamp(plan.end) || Date.parse(plan.end) <= Date.parse(plan.start)) invalid('plan dates')
  }
  list(workspace.identities, 'identity', 20000)
  const nativeKeys = new Set()
  for (const identity of workspace.identities) {
    keys(identity, ['id', 'source', 'key', 'locator', 'aliases'], 'identity')
    if (!sources.has(identity.source)) invalid('identity source')
    text(identity.key, 'native identity', 4096)
    const qualified = JSON.stringify([identity.source, identity.key])
    if (nativeKeys.has(qualified)) invalid('duplicate native identity')
    nativeKeys.add(qualified)
    if (identity.locator !== undefined) text(identity.locator, 'identity locator', 4096)
    if (identity.aliases !== undefined) stringList(identity.aliases, 'identity aliases', 32)
  }
  object(workspace.properties, 'properties')
  for(const properties of Object.values(workspace.properties))if(properties?.cardTasks!==undefined)validateCardTaskReceipts(properties.cardTasks)
  if (Object.keys(workspace.properties).length > 20000) invalid('too many custom property records')
  keys(workspace.appearance, ['mode', 'calendarColors'], 'appearance')
  if (!['system', 'light', 'dark'].includes(workspace.appearance.mode)) invalid('appearance mode')
  object(workspace.appearance.calendarColors, 'calendar colors')
  for (const [id, color] of Object.entries(workspace.appearance.calendarColors)) { text(id, 'calendar color id'); if (!hexColor(color)) invalid('calendar color') }
  keys(workspace.planner, ['view', 'scopeId', 'assignment', 'includeUnassigned', 'unassignedBoardIds', 'hiddenCollectionIds', 'excludedSpaceIds', 'showCompleted', 'showCompletedByView', 'scopeAssignments', 'workflow', 'statusMapping', 'arrangements'], 'planner')
  const planner = workspace.planner
  if (planner.arrangements !== undefined) {
    object(planner.arrangements, 'arrangements')
    if (Object.keys(planner.arrangements).length > 2500) invalid('too many arrangement scopes')
    const orderedIds = (value, label) => { stringList(value, label); if (value.some(id => !safeArrangementId(id))) invalid(label) }
    for (const [scope, arrangement] of Object.entries(planner.arrangements)) {
      if (!safeArrangementId(scope)) invalid('arrangement scope')
      keys(arrangement, ['timelineRows', 'timelineGroups', 'boardCards'], 'arrangement')
      for (const field of ['timelineRows', 'timelineGroups']) if (arrangement[field] !== undefined) orderedIds(arrangement[field], `arrangement ${field}`)
      if (arrangement.boardCards !== undefined) {
        object(arrangement.boardCards, 'board order')
        if (Object.keys(arrangement.boardCards).length > 2500) invalid('too many board orders')
        for (const [key, ids] of Object.entries(arrangement.boardCards)) {
          if (!validBoardOrderKey(key)) invalid('board order key')
          orderedIds(ids, 'board order IDs')
        }
      }
    }
  }
  if (!['overview', 'calendar', 'timeline', 'board', 'list'].includes(planner.view)) invalid('planner view')
  text(planner.scopeId, 'planner scope')
  if (!['me', 'all'].includes(planner.assignment)) invalid('planner assignment')
  for (const key of ['includeUnassigned', 'showCompleted']) if (typeof planner[key] !== 'boolean') invalid(`planner ${key}`)
  if (planner.showCompletedByView !== undefined) {
    object(planner.showCompletedByView, 'layout completion visibility')
    for (const [view,value] of Object.entries(planner.showCompletedByView)) {
      if (!['overview','calendar','timeline','board','list'].includes(view) || typeof value !== 'boolean') invalid('layout completion visibility')
    }
  }
  for (const key of ['unassignedBoardIds', 'hiddenCollectionIds', 'excludedSpaceIds']) stringList(planner[key], `planner ${key}`)
  object(planner.scopeAssignments, 'scope assignment filters'); object(planner.workflow, 'personal workflow')
  for (const [id, value] of Object.entries(planner.scopeAssignments)) { text(id, 'scope assignment id'); if (!['me', 'all'].includes(value)) invalid('scope assignment filter') }
  for (const [id, value] of Object.entries(planner.workflow)) { text(id, 'workflow record id'); if (!['inbox', 'planned', 'doing', 'done'].includes(value)) invalid('workflow column') }
  if (planner.statusMapping !== undefined) statusMapping(planner.statusMapping)
  return structuredClone(workspace)
}

export function migrateWorkspace(workspace) {
  if (workspace?.schemaVersion === 2) return validateWorkspace(workspace)
  jsonValue(workspace)
  if (workspace?.schemaVersion !== 1 || !Array.isArray(workspace.dashboards)) invalid('unsupported legacy schema version')
  if (new TextEncoder().encode(JSON.stringify(workspace)).byteLength > MAX_WORKSPACE_BYTES) invalid('legacy workspace is too large')
  const next = createPlannerWorkspace()
  next.id = workspace.id; next.name = workspace.name; next.updatedAt = workspace.updatedAt
  next.properties = structuredClone(workspace.properties || {})
  if (workspace.appearance) next.appearance = structuredClone(workspace.appearance)
  next.planner = plannerSettings({ hiddenCollectionIds: workspace.overview?.hiddenCollectionIds || [] })
  const discarded = new Set(workspace.dashboards.map(item => item.id))
  const edgeKeys = new Set()
  next.relations = []
  for (const relation of workspace.relations || []) {
    // Connections to deleted dashboard objects have no new native endpoint.
    // The unmodified original file remains available as the migration backup.
    if (discarded.has(relation.fromId) || discarded.has(relation.toId) || relation.fromId === relation.toId) continue
    const edge = JSON.stringify([relation.fromId, relation.toId])
    if (edgeKeys.has(edge)) continue
    edgeKeys.add(edge)
    next.relations.push({ id: relation.id, type: 'related', fromId: relation.fromId, toId: relation.toId, ...(relation.label ? { label: relation.label } : {}) })
  }
  return validateWorkspace(next)
}
