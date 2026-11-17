/** Three-way planner merge. Source records and credentials never enter this file. */
import {remapArrangements} from './planning-order.mjs'
const missing = Symbol('missing')
const copy = value => value === missing ? missing : structuredClone(value)
const plain = value => value !== missing && value !== null && typeof value === 'object' && !Array.isArray(value)
const equal = (a, b) => a === missing || b === missing ? a === b : stable(a) === stable(b)
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const memberLists = new Set(['collectionIds', 'recordIds', 'tagNames', 'hiddenCollectionIds', 'excludedSpaceIds', 'unassignedBoardIds', 'aliases'])
const identityKey = identity => JSON.stringify([identity.source, identity.key])
// Navigation and visibility belong to the device; organization and status
// mappings remain shared planner metadata.
export const deviceViewKeys = ['view', 'scopeId', 'assignment', 'includeUnassigned', 'unassignedBoardIds', 'hiddenCollectionIds', 'excludedSpaceIds', 'showCompleted', 'showCompletedByView', 'scopeAssignments']
export function withDeviceViewPreferences(workspace, device) {
  const result = copy(workspace)
  for (const key of deviceViewKeys) {
    if (Object.hasOwn(device.planner, key)) result.planner[key] = copy(device.planner[key])
    else delete result.planner[key]
  }
  return result
}

/** Two independently initialized PCs can give the same native item different UUIDs. */
export function alignWorkspaceIdentities(workspace, reference) {
  const result = copy(workspace)
  const canonical = new Map((reference.identities || []).map(identity => [identityKey(identity), identity.id]))
  const remap = new Map((result.identities || []).map(identity => [identity.id, canonical.get(identityKey(identity)) || identity.id]))
  const target = id => remap.get(id) || id
  result.identities = (result.identities || []).map(identity => ({...identity, id: target(identity.id)}))
  result.relations = (result.relations || []).map(edge => ({...edge, fromId: target(edge.fromId), toId: target(edge.toId)}))
  result.plans = (result.plans || []).map(plan => ({...plan, recordId: target(plan.recordId)}))
  result.projects = (result.projects || []).map(project => ({...project, recordIds: [...new Set((project.recordIds || []).map(target))]}))
  result.properties = Object.fromEntries(Object.entries(result.properties || {}).map(([id, value]) => [target(id), value]))
  if (result.planner?.workflow) result.planner.workflow = Object.fromEntries(Object.entries(result.planner.workflow).map(([id, value]) => [target(id), value]))
  if (result.planner?.arrangements) result.planner.arrangements = remapArrangements(result.planner.arrangements, target)
  return result
}

export function mergeWorkspaces(base, local, remote) {
  // The published registry supplies stable UUIDs shared by every device.
  base = alignWorkspaceIdentities(base, remote)
  local = alignWorkspaceIdentities(local, remote)
  const conflicts = []
  // A shared UID alias with different collection keys can mean a moved item or
  // two legitimate copies. Without a common identity history, do not silently
  // strand one device's properties under an invisible duplicate UUID.
  const baseIds = new Set((base.identities || []).map(identity => identity.id))
  const localKeys = new Set((local.identities || []).map(identityKey))
  const remoteKeys = new Set((remote.identities || []).map(identityKey))
  // Most refreshes have the same registry on both devices. Do not compare
  // every identity pair just to discover that their native keys already match.
  const remoteAliases=new Map()
  for(const identity of remote.identities||[]){
    if(localKeys.has(identityKey(identity)))continue
    for(const alias of new Set([identity.key,...(identity.aliases||[])])){
      const key=JSON.stringify([identity.source,alias]),values=remoteAliases.get(key)||[]
      values.push(identity);remoteAliases.set(key,values)
    }
  }
  for(const identity of local.identities||[]){
    if(remoteKeys.has(identityKey(identity)))continue
    const ambiguous=[identity.key,...(identity.aliases||[])].some(alias=>(remoteAliases.get(JSON.stringify([identity.source,alias]))||[]).some(other=>identity.id!==other.id&&!(baseIds.has(identity.id)&&baseIds.has(other.id))))
    if(ambiguous)conflicts.push(`identities[${identity.id}].alias`)
  }
  function conflict(path, a) { conflicts.push(path || 'workspace'); return copy(a) }
  function merge(b, a, c, path = '') {
    if (deviceViewKeys.some(key => path === `planner.${key}`)) return copy(a)
    if (equal(a, c)) return copy(a)
    if (equal(a, b)) return copy(c)
    if (equal(c, b)) return copy(a)
    if (path === 'updatedAt') return [a, c].filter(value => value !== missing).sort((x, y) => Date.parse(y) - Date.parse(x))[0]
    if (a === missing || c === missing) return conflict(path, a) // delete versus edit
    if (plain(a) && plain(c) && (plain(b) || b === missing)) {
      const result = {}
      for (const key of new Set([...Object.keys(b === missing ? {} : b), ...Object.keys(a), ...Object.keys(c)])) {
        const value = merge(b !== missing && Object.hasOwn(b, key) ? b[key] : missing, Object.hasOwn(a, key) ? a[key] : missing, Object.hasOwn(c, key) ? c[key] : missing, path ? `${path}.${key}` : key)
        if (value !== missing) result[key] = value
      }
      return result
    }
    if (Array.isArray(a) && Array.isArray(c) && (Array.isArray(b) || b === missing)) {
      const before = b === missing ? [] : b
      const leaf = path.split('.').at(-1)
      if (memberLists.has(leaf) && [...before, ...a, ...c].every(value => typeof value === 'string')) {
        const keys = [...new Set([...before, ...a, ...c])]
        const values = keys.filter(key => {
          const had = before.includes(key), here = a.includes(key), there = c.includes(key)
          return had ? here && there : here || there
        })
        return leaf === 'aliases' ? values.slice(-32) : values
      }
      if ([...before, ...a, ...c].every(value => plain(value) && typeof value.id === 'string')) {
        const byId = list => new Map(list.map(value => [value.id, value]))
        const maps = [before, a, c].map(byId)
        const result = new Map()
        for (const id of new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()])) {
          const value = merge(...maps.map(map => map.has(id) ? map.get(id) : missing), `${path}[${id}]`)
          if (value !== missing) result.set(id, value)
        }
        // Honor a reorder of existing entities; independent appended entities merge.
        const survivingBase = before.map(value => value.id).filter(id => result.has(id))
        const baseIds = new Set(survivingBase)
        const order = list => list.map(value => value.id).filter(id => baseIds.has(id))
        const aOrder = order(a), cOrder = order(c)
        let chosen = equal(aOrder, survivingBase) ? c : a
        if (!equal(aOrder, survivingBase) && !equal(cOrder, survivingBase) && !equal(aOrder, cOrder)) conflict(`${path}.order`, a)
        const orderedIds = [...new Set([...chosen, ...a, ...c].map(value => value.id))]
        return orderedIds.filter(id => result.has(id)).map(id => result.get(id))
      }
    }
    return conflict(path, a)
  }
  const workspace = withDeviceViewPreferences(merge(base, local, remote), local)
  // Concurrent creation of the same typed link should not duplicate it under two IDs.
  const links = new Map()
  workspace.relations = (workspace.relations || []).filter(edge => {
    const key = JSON.stringify([edge.type, edge.fromId, edge.toId, edge.role || ''])
    const previous = links.get(key)
    if (!previous) { links.set(key, edge); return true }
    const {id: unusedA, ...a} = previous, {id: unusedB, ...b} = edge
    if (!equal(a, b)) conflicts.push(`relations[${edge.id}]`)
    return false
  })
  return {workspace, conflicts: [...new Set(conflicts)]}
}
