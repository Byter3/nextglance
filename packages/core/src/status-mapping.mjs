/** Source-keyed status mappings. Column labels never imply native state. */
export const TASK_STATUSES = [
  {id:'NEEDS-ACTION',title:'To do'},
  {id:'IN-PROCESS',title:'In progress'},
  {id:'COMPLETED',title:'Completed'},
  {id:'CANCELLED',title:'Cancelled'},
]
/** Match Nextcloud Tasks' status/progress rules without erasing existing work. */
export function taskStatusProgress(status, previousPercent) {
  const percent = Number.isInteger(previousPercent) && previousPercent >= 0 && previousPercent <= 100 ? previousPercent : 0
  if (status === 'COMPLETED') return 100
  if (status === 'IN-PROCESS') return Math.max(1, Math.min(percent, 99))
  if (status === 'NEEDS-ACTION') return Math.min(percent, 99)
  return percent // Cancellation retains progress; it is not a reset.
}
export const DECK_COMPLETED = '$completed'
export const UNMAPPED_COLUMN = '$unmapped'
const list = value => Array.isArray(value) ? value : []
const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
export const statusSourceKey = (source, collectionId, status) => JSON.stringify([source, collectionId || '', status])
export function parseStatusSourceKey(key) {
  try {
    const value = JSON.parse(key)
    if (!Array.isArray(value) || value.length !== 3 || key !== JSON.stringify(value) || !['deck','tasks'].includes(value[0]) || value.some(part => typeof part !== 'string' || !part || part.length > 2048 || part.includes('\0'))) return null
    if (value[0] === 'tasks' && !TASK_STATUSES.some(status => status.id === value[2])) return null
    return {source:value[0],collectionId:value[1],status:value[2]}
  } catch { return null }
}
export function nativeStatus(record) {
  if (record.kind === 'card' && record.source === 'deck') return record.completed ? DECK_COMPLETED : record.stackId || '$unknown'
  if (record.kind === 'task' && record.source === 'tasks') {
    if (record.completed || String(record.status || '').toUpperCase() === 'COMPLETED') return 'COMPLETED'
    const value = String(record.status || 'NEEDS-ACTION').toUpperCase()
    return TASK_STATUSES.some(status => status.id === value) ? value : 'NEEDS-ACTION'
  }
  return null
}
export function nativeStatusKey(record) {
  const status = nativeStatus(record)
  return status && record.collectionId ? statusSourceKey(record.source,record.collectionId,status) : ''
}
export function normalizeStatusMapping(value) {
  if (!value || !Array.isArray(value.columns) || !value.columns.length) return undefined
  const ids = new Set()
  const columns = value.columns.filter(column => column && typeof column.id === 'string' && column.id && !column.id.startsWith('$') && typeof column.title === 'string' && column.title.trim() && color(column.color) && !ids.has(column.id) && ids.add(column.id)).map(column => ({id:column.id,title:column.title.trim(),color:column.color}))
  if (!columns.length) return undefined
  const assignments = Object.fromEntries(Object.entries(value.assignments || {}).filter(([key,columnId]) => parseStatusSourceKey(key) && ids.has(columnId)))
  return {columns,assignments}
}
export function defaultStatusMapping(collections = []) {
  const columns = [{id:'todo',title:'To do',color:'#8b939f'},{id:'doing',title:'In progress',color:'#0082c9'},{id:'done',title:'Done',color:'#2c9d70'},{id:'cancelled',title:'Cancelled',color:'#8b748e'}]
  const assignments = {}
  for (const collection of collections) {
    if (collection.source === 'tasks') for (const status of TASK_STATUSES) assignments[statusSourceKey('tasks',collection.id,status.id)] = {'NEEDS-ACTION':'todo','IN-PROCESS':'doing','COMPLETED':'done','CANCELLED':'cancelled'}[status.id]
    if (collection.source === 'deck') assignments[statusSourceKey('deck',collection.id,DECK_COMPLETED)] = 'done'
  }
  return {columns,assignments}
}
export function statusSourceOptions(collections = [], records = [], mapping) {
  const result = new Map()
  const add = (source,collectionId,status,title,sourceTitle,sourceColor,available = true) => {
    const key = statusSourceKey(source,collectionId,status)
    if (!result.has(key)) result.set(key,{key,source,collectionId,status,title,sourceTitle,color:sourceColor,available})
  }
  for (const collection of collections) {
    if (collection.source === 'tasks') for (const status of TASK_STATUSES) add('tasks',collection.id,status.id,status.title,collection.title,collection.color)
    if (collection.source === 'deck') {
      for (const stack of list(collection.stacks)) add('deck',collection.id,stack.id,stack.title,collection.title,collection.color)
      add('deck',collection.id,DECK_COMPLETED,'Marked done',collection.title,collection.color)
    }
  }
  for (const record of records) {
    const key = nativeStatusKey(record),status = nativeStatus(record)
    if (key && !result.has(key)) add(record.source,record.collectionId,status,record.status || (status === DECK_COMPLETED ? 'Marked done' : status),record.collectionTitle || 'Unavailable source',undefined,false)
  }
  for (const key of Object.keys(mapping?.assignments || {})) {
    const source = parseStatusSourceKey(key)
    if (source && !result.has(key)) add(source.source,source.collectionId,source.status,source.status === DECK_COMPLETED ? 'Marked done' : source.status,'Unavailable source',undefined,false)
  }
  return [...result.values()].sort((a,b)=>a.sourceTitle.localeCompare(b.sourceTitle)||a.title.localeCompare(b.title))
}
export function mappedColumnForRecord(record,mapping) {
  return mapping?.assignments?.[nativeStatusKey(record)] || UNMAPPED_COLUMN
}
/** A selected project/group inherits only its owning Space's customization. */
export function statusMappingSpace(workspace,scopeId) {
  if (!scopeId || scopeId === 'all') return undefined
  const owner = list(workspace?.categories).find(item => item.id === scopeId) || list(workspace?.projects).find(item => item.id === scopeId)
  return list(workspace?.spaces).find(space => space.id === (owner?.spaceId || scopeId))
}
export function effectiveStatusMapping(workspace,scopeId,collections = []) {
  return normalizeStatusMapping(statusMappingSpace(workspace,scopeId)?.statusMapping) || normalizeStatusMapping(workspace?.planner?.statusMapping) || defaultStatusMapping(collections)
}
export function setScopeStatusMapping(workspace,scopeId,mapping) {
  const result = structuredClone(workspace), normalized = mapping === null ? undefined : normalizeStatusMapping(mapping)
  if (mapping !== null && !normalized) throw new Error('Choose a valid status mapping.')
  const overviewGroup=list(result.categories).some(category=>category.id===scopeId&&category.spaceId==='all')
  const target = scopeId === 'all'||overviewGroup ? result.planner : statusMappingSpace(result,scopeId)
  if (!target) throw new Error('This Space is no longer available.')
  if (normalized) target.statusMapping = normalized
  else delete target.statusMapping
  return result
}
export function unifiedStatus(record,mapping) {
  if (!nativeStatus(record)) return null
  const id = mappedColumnForRecord(record,mapping)
  return mapping?.columns?.find(column => column.id === id) || {id:UNMAPPED_COLUMN,title:'Unmapped',color:'#8b939f'}
}
export function filterUnifiedStatuses(records,mapping,statusIds = []) {
  const wanted = new Set(list(statusIds))
  if (!wanted.size) return records
  return records.filter(record => !nativeStatus(record) || wanted.has(unifiedStatus(record,mapping).id))
}
/** Saving a first map may open Unified; later edits never replace a chosen mode. */
export function boardModeAfterMappingChange(mode,hadMapping,hasMapping) {
  return hasMapping && !hadMapping && mode === '' ? '__unified__' : mode
}
export function mappedBoardColumns(records,collections,mapping) {
  const config = normalizeStatusMapping(mapping) || defaultStatusMapping(collections)
  const columns = config.columns.map(column => ({...column,records:[]}))
  const map = new Map(columns.map(column => [column.id,column]))
  const unmapped = {id:UNMAPPED_COLUMN,title:'Unmapped',color:'#8b939f',records:[]}
  const unique = new Map(records.filter(record => record.kind === 'task' || record.kind === 'card').map(record => [record.id,record]))
  for (const record of unique.values()) (map.get(mappedColumnForRecord(record,config)) || unmapped).records.push(record)
  columns.unshift(unmapped)
  return columns
}
/** Only targets from the item's own native source are eligible for a drop. */
export function statusMoveTargets(record,columnId,mapping,collections) {
  const config = normalizeStatusMapping(mapping) || defaultStatusMapping(collections)
  const collection = collections.find(item => item.id === record.collectionId && item.source === record.source)
  if (record.readonly || !collection || collection.readonly || columnId === UNMAPPED_COLUMN) return []
  const targets = []
  for (const [key,targetColumn] of Object.entries(config.assignments)) {
    const source = parseStatusSourceKey(key)
    if (targetColumn !== columnId || !source || source.source !== record.source || source.collectionId !== record.collectionId) continue
    if (source.source === 'tasks') targets.push({key,title:TASK_STATUSES.find(status => status.id === source.status).title,source:'tasks',status:source.status,completed:source.status === 'COMPLETED'})
    else if (source.status === DECK_COMPLETED) targets.push({key,title:'Mark done',source:'deck',completed:true})
    else {
      const stack = list(collection.stacks).find(item => item.id === source.status)
      if (stack) targets.push({key,title:stack.title,source:'deck',stackId:stack.id,completed:false})
    }
  }
  return targets
}
