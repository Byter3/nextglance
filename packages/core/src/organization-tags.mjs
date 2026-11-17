/** Space-local tag selection. No native data is moved or retagged. */
const list = value => Array.isArray(value) ? value : []
const taggedSources = new Set(['deck','tasks','calendar'])
export const organizationTagKey = name => typeof name === 'string' ? name.normalize('NFKC').trim().toLowerCase() : ''
export function normalizeOrganizationTags(names) {
  const seen = new Set()
  return list(names).filter(name => typeof name === 'string' && name.trim() && name.trim().length <= 200 && !name.includes('\0') && !seen.has(organizationTagKey(name)) && seen.add(organizationTagKey(name))).slice(0,100).map(name => name.trim())
}
export function organizationSourcePool(workspace, spaceId, availableIds=[]) {
  if(spaceId==='all')return [...new Set([...list(availableIds),...list(workspace?.categories).filter(value=>value.spaceId==='all').flatMap(value=>list(value.collectionIds))])]
  const space = list(workspace?.spaces).find(value => value.id === spaceId)
  if (!space) return []
  return [...new Set([...list(space.collectionIds), ...list(workspace.categories).filter(value => value.spaceId === spaceId).flatMap(value => list(value.collectionIds)), ...list(workspace.projects).filter(value => value.spaceId === spaceId && !value.archived).flatMap(value => list(value.collectionIds))])]
}
function recordTagKeys(record) {
  if (!taggedSources.has(record.source)) return []
  return [...new Set([...list(record.tags), ...list(record.tagDetails).map(tag => tag?.title)].map(organizationTagKey).filter(Boolean))]
}
/** Build once for a projection. All headings and counts share these exact sets. */
export function organizationMembership(workspace, records) {
  const bySource = new Map(), byTag = new Map(), known = new Set()
  for (const record of records) {
    known.add(record.id)
    if (!bySource.has(record.collectionId)) bySource.set(record.collectionId,new Set())
    bySource.get(record.collectionId).add(record.id)
    for (const key of recordTagKeys(record)) {
      if (!byTag.has(key)) byTag.set(key,new Set())
      byTag.get(key).add(record.id)
    }
  }
  const pools = new Map(list(workspace.spaces).map(space => [space.id,organizationSourcePool(workspace,space.id)]))
  pools.set('all',organizationSourcePool(workspace,'all',[...bySource.keys()].filter(Boolean)))
  const unionSources = ids => new Set(ids.flatMap(id => [...(bySource.get(id) || [])]))
  const rule = value => {
    if (!pools.has(value.spaceId)) return new Set()
    const tags = list(value.tagNames).map(organizationTagKey).filter(Boolean)
    const sources = tags.length && !list(value.collectionIds).length ? pools.get(value.spaceId) : list(value.collectionIds)
    const allowed = new Set(pools.get(value.spaceId))
    const candidates = unionSources(sources.filter(id => allowed.has(id)))
    if (!tags.length) return candidates
    const tagged = new Set(tags.flatMap(key => [...(byTag.get(key) || [])]))
    return new Set([...candidates].filter(id => tagged.has(id)))
  }
  const projects = new Map(), categories = new Map(), scopes = new Map([['all',known]])
  for (const project of list(workspace.projects).filter(value => !value.archived)) {
    const ids = rule(project)
    if (pools.has(project.spaceId)) for (const id of list(project.recordIds)) if (known.has(id)) ids.add(id)
    projects.set(project.id,ids); scopes.set(project.id,new Set(ids))
  }
  for (const category of list(workspace.categories)) {
    const ids = rule(category)
    categories.set(category.id,new Set(ids))
    for (const project of list(workspace.projects)) if (!project.archived && project.spaceId === category.spaceId && project.categoryId === category.id) for (const id of projects.get(project.id) || []) ids.add(id)
    scopes.set(category.id,ids)
  }
  for (const space of list(workspace.spaces)) {
    const ids = unionSources(pools.get(space.id))
    for (const project of list(workspace.projects)) if (!project.archived && project.spaceId === space.id) for (const id of projects.get(project.id) || []) ids.add(id)
    scopes.set(space.id,ids)
  }
  return {scopes,projects,categories,pools}
}
export function organizationTagOptions(records, collections, selected = []) {
  const result = new Map()
  const add = (title,color,available=true) => {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 200 || title.includes('\0')) return
    const key = organizationTagKey(title)
    if (!result.has(key)) result.set(key,{key,title:title.trim(),available,...(typeof color === 'string' && /^#[\da-f]{6}$/i.test(color) ? {color} : {})})
  }
  // Suggest all loaded native tags. Choosing one does not expand rule membership.
  // Catalog order is independent of source-refresh order.
  for (const collection of [...collections].sort((a,b) => a.id.localeCompare(b.id))) if (collection.source === 'deck') for (const tag of [...list(collection.labels)].sort((a,b) => String(a.title).localeCompare(String(b.title)))) add(tag.title,tag.color)
  for (const record of [...records].sort((a,b) => a.id.localeCompare(b.id))) if (taggedSources.has(record.source)) {
    for (const tag of list(record.tagDetails)) add(tag.title,tag.color)
    for (const title of list(record.tags)) add(title)
  }
  for (const title of selected) add(title,undefined,false)
  return [...result.values()].sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}
export function organizationRuleCount(workspace, records, spaceId, collectionIds = [], tagNames = [], recordIds = []) {
  const id = '$draft-rule', project = {id,spaceId,collectionIds,tagNames,recordIds}
  const next = {...workspace,projects:[...list(workspace.projects).filter(value => value.id !== id),project]}
  return organizationMembership(next,records).projects.get(id)?.size || 0
}
