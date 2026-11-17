/** Portable, unsaved Space editor drafts. Native records and links are never edited. */
import {validateWorkspace} from './planner-schema.mjs'
import {sourceGroupPresets, sourceGroupNameKey} from './source-groups.mjs'

export {sourceGroupPresets}
const list = value => Array.isArray(value) ? value : []
const unique = values => [...new Set(values)]
const defaults = ['defaultCalendarId', 'defaultTaskListId', 'defaultBoardId']
const clone = value => structuredClone(value)
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value)
const ownerSnapshot = (workspace, space) => ({
  space:clone(space),
  groups:clone(list(workspace.categories).filter(item => item.spaceId === space.id)),
  projects:clone(list(workspace.projects).filter(item => item.spaceId === space.id)),
})

/** Include unavailable IDs and legacy group/project-only selections, with reasons. */
export function spaceSourceInclusions(workspace, spaceId) {
  const space = list(workspace.spaces).find(item => item.id === spaceId)
  if (!space) return []
  const entries = new Map()
  const ensure = collectionId => {
    if (!entries.has(collectionId)) entries.set(collectionId, {collectionId, selected:false, groups:[], projects:[]})
    return entries.get(collectionId)
  }
  for (const id of list(space.collectionIds)) ensure(id).selected = true
  for (const group of list(workspace.categories).filter(item => item.spaceId === spaceId)) {
    for (const id of list(group.collectionIds)) ensure(id).groups.push({id:group.id, name:group.name})
  }
  for (const project of list(workspace.projects).filter(item => item.spaceId === spaceId)) {
    for (const id of list(project.collectionIds)) ensure(id).projects.push({id:project.id, name:project.name})
  }
  return [...entries.values()]
}

/** Opening an editor allocates no persistent identity and writes no metadata. */
export function createSpaceDraft(workspace, spaceId) {
  if (!spaceId) return {space:{name:'', color:'#3483c6', collectionIds:[]}, groups:[]}
  const space = list(workspace.spaces).find(item => item.id === spaceId)
  if (!space) throw new Error('This Space is no longer available.')
  return {
    space:{...clone(space), collectionIds:spaceSourceInclusions(workspace, spaceId).map(item => item.collectionId)},
    groups:clone(list(workspace.categories).filter(item => item.spaceId === spaceId)),
    baseline:ownerSnapshot(workspace, space),
  }
}

/** Accepted suggestions join this draft only, empty and without persistent IDs. */
export function addPresetGroupsToDraft(draft, keys) {
  const result = clone(draft), wanted = new Set(keys)
  const names = new Set(result.groups.map(group => sourceGroupNameKey(group.name)))
  for (const preset of sourceGroupPresets) {
    const key = sourceGroupNameKey(preset.name)
    if (!wanted.has(preset.key) || names.has(key)) continue
    result.groups.push({name:preset.name, color:preset.color, collectionIds:[]})
    names.add(key)
  }
  return result
}

/** Removing a draft group keeps every selected source, including legacy sources. */
export function removeDraftSourceGroup(draft, index) {
  const result = clone(draft), removed = result.groups[index]
  if (!removed) return result
  result.space.collectionIds = unique([...result.space.collectionIds, ...removed.collectionIds])
  result.groups.splice(index, 1)
  return result
}

/** The UI explains any old/new group move before invoking this explicit choice. */
export function assignDraftSourceGroup(draft, collectionId, groupIndex) {
  const result = clone(draft)
  if (groupIndex !== null && !result.groups[groupIndex]) throw new Error('Choose an available source group.')
  if (groupIndex === null || !list(result.groups[groupIndex].tagNames).length) for (const group of result.groups) if (!list(group.tagNames).length) group.collectionIds = group.collectionIds.filter(id => id !== collectionId)
  if (groupIndex !== null) result.groups[groupIndex].collectionIds.push(collectionId)
  result.space.collectionIds = unique([...result.space.collectionIds, collectionId])
  return result
}

/** A deselection also removes draft group assignments and invalid destinations. */
export function selectDraftSource(draft, collectionId, selected) {
  const result = clone(draft)
  result.space.collectionIds = selected ? unique([...result.space.collectionIds, collectionId]) : result.space.collectionIds.filter(id => id !== collectionId)
  if (!selected) {
    for (const group of result.groups) group.collectionIds = group.collectionIds.filter(id => id !== collectionId)
    for (const key of defaults) if (result.space[key] === collectionId) delete result.space[key]
  }
  return result
}

function forgetScopes(workspace, ids) {
  if (ids.has(workspace.planner.scopeId)) workspace.planner.scopeId = 'all'
  workspace.planner.scopeAssignments = Object.fromEntries(Object.entries(workspace.planner.scopeAssignments || {}).filter(([id]) => !ids.has(id)))
  workspace.planner.excludedSpaceIds = list(workspace.planner.excludedSpaceIds).filter(id => !ids.has(id))
  if(workspace.planner.arrangements)workspace.planner.arrangements=Object.fromEntries(Object.entries(workspace.planner.arrangements).filter(([id])=>!ids.has(id)))
}

/** Accept the whole organization change in one result; callers persist it once.
 * Source removal remains blocked until the user chooses to update affected projects.
 */
export function saveSpaceDraft(workspace, draft, options = {}) {
  const fail = (error, message, extra = {}) => ({ok:false, error, message, ...extra})
  const existing = draft.space.id ? list(workspace.spaces).find(item => item.id === draft.space.id) : undefined
  if (draft.space.id && !existing) return fail('space-unavailable', 'This Space was removed. Keep this draft until you decide where to save it.')
  if (existing && draft.baseline && stable(draft.baseline) !== stable(ownerSnapshot(workspace, existing))) return fail('organization-changed', 'This Space changed while the editor was open. Your draft is retained; review the latest organization before saving.')
  const names = new Set()
  for (const group of draft.groups) {
    const name = sourceGroupNameKey(group.name)
    if (!name || names.has(name)) return fail('group-name', 'Give every source group a different, nonempty name within this Space.')
    names.add(name)
  }
  const oldGroups = list(workspace.categories).filter(group => group.spaceId === existing?.id)
  if (draft.groups.some(group => group.id && !oldGroups.some(old => old.id === group.id))) return fail('group-owner', 'A source group must keep its original Space owner.')
  const initialIds = new Set(existing ? spaceSourceInclusions(workspace, existing.id).map(item => item.collectionId) : [])
  const selected = new Set(draft.space.collectionIds)
  const removed = new Set([...initialIds].filter(id => !selected.has(id)))
  // New group assignments can add sources. Existing explicitly deselected sources
  // cannot sneak back in through a stale group or project definition.
  for (const group of draft.groups) for (const id of group.collectionIds) if (!removed.has(id)) selected.add(id)
  const affectedProjects = list(workspace.projects).filter(project => project.spaceId === existing?.id)
    .map(project => ({id:project.id, name:project.name, collectionIds:project.collectionIds.filter(id => removed.has(id))}))
    .filter(project => project.collectionIds.length)
  if (affectedProjects.length && options.projectSourceRemoval !== 'update') return fail('project-source-removal', 'These sources are also selected by projects. Update those project selections or cancel this save.', {affectedProjects})
  const result = clone(workspace), usedIds = new Set([...result.spaces, ...list(result.categories), ...result.projects].map(item => item.id))
  const pendingIds = []
  const nextId = () => {
    let id = `draft:${pendingIds.length}`
    while (usedIds.has(id)) id += ':'
    usedIds.add(id)
    pendingIds.push(id)
    return id
  }
  try {
    const space = {...clone(draft.space), id:existing?.id || nextId(), name:draft.space.name.trim(), collectionIds:[...selected]}
    for (const key of defaults) if (!selected.has(space[key])) delete space[key]
    const groups = draft.groups.map(group => ({
      id:group.id || nextId(), spaceId:space.id, name:group.name.trim(), color:group.color,
      collectionIds:unique(group.collectionIds.filter(id => selected.has(id))),
      ...(group.tagNames !== undefined ? {tagNames:[...group.tagNames]} : {}),
    }))
    const removedGroups = new Set(oldGroups.filter(group => !groups.some(next => next.id === group.id)).map(group => group.id))
    result.spaces = existing ? result.spaces.map(item => item.id === space.id ? space : item) : [...result.spaces, space]
    // Replace only this owner's slots, retaining other Spaces' flat-array order.
    const pending = [...groups]
    result.categories = list(result.categories).flatMap(group => group.spaceId === space.id ? pending.length ? [pending.shift()] : [] : [group])
    result.categories.push(...pending)
    result.projects = result.projects.map(project => {
      if (project.spaceId !== space.id) return project
      const next = {...project, collectionIds:project.collectionIds.filter(id => !removed.has(id))}
      if (removedGroups.has(next.categoryId)) delete next.categoryId
      return next
    })
    forgetScopes(result, removedGroups)
    result.updatedAt = new Date().toISOString()
    // Validate before allocating real identities: an invalid or cancelled form
    // must not consume UUIDs or leave partly accepted definitions behind.
    const accepted = validateWorkspace(result), identities = new Map()
    for (const pendingId of pendingIds) {
      const id = (options.newId || (() => globalThis.crypto.randomUUID()))()
      if (typeof id !== 'string' || !id || usedIds.has(id)) throw new Error('A new Space or group needs a unique identity.')
      usedIds.add(id); identities.set(pendingId, id)
    }
    for (const item of accepted.spaces) item.id = identities.get(item.id) || item.id
    for (const item of accepted.categories) {
      item.id = identities.get(item.id) || item.id
      item.spaceId = identities.get(item.spaceId) || item.spaceId
    }
    return {ok:true, workspace:validateWorkspace(accepted), spaceId:identities.get(space.id) || space.id}
  } catch (error) {
    return fail('invalid-draft', error instanceof Error ? error.message : 'This Space draft is invalid.')
  }
}

/** Delete just a grouping, retaining its unavailable/legacy sources and links. */
export function removeSourceGroup(workspace, groupId) {
  const result = clone(workspace), group = list(result.categories).find(item => item.id === groupId)
  if (!group) return result
  const space = result.spaces.find(item => item.id === group.spaceId)
  if (space) space.collectionIds = unique([...space.collectionIds, ...group.collectionIds])
  result.categories = result.categories.filter(item => item.id !== groupId)
  for (const project of result.projects) if (project.spaceId === group.spaceId && project.categoryId === groupId) delete project.categoryId
  forgetScopes(result, new Set([groupId]))
  result.updatedAt = new Date().toISOString()
  return validateWorkspace(result)
}

/** Remove only saved scope definitions, preserving all native/global metadata. */
export function removeSpace(workspace, spaceId) {
  if(spaceId==='all')throw new Error('My overview cannot be removed.')
  const result = clone(workspace)
  const removed = new Set([spaceId, ...list(result.categories).filter(item => item.spaceId === spaceId).map(item => item.id), ...result.projects.filter(item => item.spaceId === spaceId).map(item => item.id)])
  result.spaces = result.spaces.filter(item => item.id !== spaceId)
  result.categories = list(result.categories).filter(item => item.spaceId !== spaceId)
  result.projects = result.projects.filter(item => item.spaceId !== spaceId)
  forgetScopes(result, removed)
  result.updatedAt = new Date().toISOString()
  return validateWorkspace(result)
}
