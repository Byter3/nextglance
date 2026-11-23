// Identity resolution has no desktop or transport dependency. The registry is
// portable metadata; source locators and titles are not durable identity.
import {remapArrangements} from './planning-order.mjs'
import {sha256} from './digest.mjs'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value))]
const qualified = (source, key) => `${source}\u0000${key}`
const nativeKey = /^[\da-f]{16}:(tasks|calendar|deck|notes|collectives):.+$/s

export function publicTaskIdentity(record) {
  const {source,identity} = record
  if ((source === 'tasks' || source === 'deck') && identity?.source === source && typeof identity.key === 'string' && identity.key) return {source,key:identity.key}
}

function referenceIds(workspace) {
  const result = new Set([...Object.keys(workspace.properties || {}), ...Object.keys(workspace.planner?.workflow || {})])
  for (const {fromId,toId} of workspace.relations || []) { result.add(fromId);result.add(toId) }
  for (const {recordId} of workspace.plans || []) result.add(recordId)
  for (const {recordIds} of workspace.projects || []) for (const id of recordIds || []) result.add(id)
  for (const {timelineRows,boardCards} of Object.values(workspace.planner?.arrangements || {})) {
    for (const id of timelineRows || []) result.add(id)
    for (const ids of Object.values(boardCards || {})) for (const id of ids) result.add(id)
  }
  return result
}

export function projectNativeIdentities(workspace, records, makeId) {
  return reconcileIdentities(workspace,records,makeId,'project')
}

export function promoteNativeIdentities(workspace, records, makeId) {
  return reconcileIdentities(workspace,records,makeId,'promote')
}

export function reconcileIdentities(workspace, records, makeId = () => globalThis.crypto.randomUUID(), mode = 'legacy') {
  const next = structuredClone(workspace)
  next.identities ||= []
  const references = mode === 'promote' ? referenceIds(next) : new Set()
  const byKey = new Map(next.identities.map(entry => [qualified(entry.source, entry.key), entry]))
  const byId = new Map(next.identities.map(entry => [entry.id, entry]))
  const byAlias = new Map()
  const aliasCounts = new Map()
  const inputsByKey = new Map()
  for (const record of records) {
    const source = record.source
    const identity = record.identity && record.identity.source === source ? record.identity : null
    const existing = byId.get(record.id)
    const key = identity?.key || existing?.key || `legacy:${record.id}`
    const portable = mode !== 'legacy' && typeof identity?.key === 'string' && nativeKey.exec(identity.key)?.[1] === source
    const aliases = unique([...(identity?.aliases || []), ...(!uuidPattern.test(record.id) && !/^native-[\da-f]{64}$/.test(record.id) ? [record.id] : []), ...(existing?.aliases || [])])
    const locator = identity?.locator || existing?.locator
    const index = qualified(source, key)
    const previous = inputsByKey.get(index)
    if (previous?.locator && locator && previous.locator !== locator) throw new Error('Nextcloud returned ambiguous identities at different locations. Existing planner data was preserved; refresh this source before editing.')
    inputsByKey.set(index, { record, source, key, portable, aliases: unique([...(previous?.aliases || []), ...aliases]), locator: locator || previous?.locator, recordIds: unique([...(previous?.recordIds || []), record.id]) })
  }
  const input = [...inputsByKey.values()]
  for (const item of input) {
    for (const alias of item.aliases) {
      const index = qualified(item.source, alias)
      aliasCounts.set(index, (aliasCounts.get(index) || 0) + 1)
    }
  }
  for (const entry of next.identities) {
    for (const alias of unique([entry.key, ...(entry.aliases || [])])) {
      const index = qualified(entry.source, alias)
      const list = byAlias.get(index) || []
      list.push(entry)
      byAlias.set(index, list)
    }
  }
  const claimed = new Set()
  const remap = new Map()
  const resolve = []
  for (const item of input) {
    const stableId = item.portable ? `native-${sha256(qualified(item.source,item.key))}` : null
    let entry = byKey.get(qualified(item.source, item.key)) || byId.get(item.record.id) || (stableId && byId.get(stableId))
    if (!entry) {
      const candidates = new Map()
      for (const alias of item.aliases) {
        const index = qualified(item.source, alias)
        const matches = byAlias.get(index) || []
        if (aliasCounts.get(index) === 1 && matches.length === 1 && !claimed.has(matches[0].id)) candidates.set(matches[0].id, matches[0])
      }
      if (candidates.size === 1) entry = candidates.values().next().value
    }
    if (entry && claimed.has(entry.id)) throw new Error('Two source items resolved to the same planner identity. Existing planner data was preserved.')
    const persist = !item.portable || mode === 'promote' && (
      references.has(entry?.id) || references.has(stableId) || item.recordIds.some(id=>references.has(id)) ||
      item.aliases.some(alias=>aliasCounts.get(qualified(item.source,alias))===1&&references.has(alias))
    )
    if (!entry) {
      entry = { id: stableId || makeId(), source: item.source, key: item.key }
      if (persist) next.identities.push(entry)
    } else if (!persist) entry = {...entry}
    claimed.add(entry.id)
    const previousKey = entry.key
    entry.key = item.key
    entry.aliases = unique([...(entry.aliases || []), ...item.aliases, ...(previousKey !== item.key ? [previousKey] : [])]).slice(-32)
    if (item.locator) entry.locator = item.locator
    byKey.set(qualified(item.source, item.key), entry)
    byId.set(entry.id, entry)
    for (const recordId of item.recordIds) remap.set(recordId, entry.id)
    if (stableId && stableId !== entry.id) remap.set(stableId,entry.id)
    resolve.push({ ...item.record, id: entry.id, identity: { source: entry.source, key: entry.key, ...(entry.locator ? { locator: entry.locator } : {}), aliases: entry.aliases } })
  }
  // Only unambiguous source aliases can become reference targets. Entry IDs are
  // always preferred and unavailable references are retained verbatim.
  const aliases = new Map()
  for (const entry of next.identities) for (const alias of unique([entry.key, ...(entry.aliases || [])])) {
    if (!aliases.has(alias)) aliases.set(alias, entry.id)
    else if (aliases.get(alias) !== entry.id) aliases.set(alias, null)
  }
  const target = id => remap.get(id) || (byId.has(id) ? id : aliases.get(id)) || id
  for (const record of resolve) {
    if (record.nativeDependencies) record.nativeDependencies = unique(record.nativeDependencies.map(target))
    if (record.nativeDependents) record.nativeDependents = unique(record.nativeDependents.map(target))
    if (record.nativeRelatedIds) record.nativeRelatedIds = unique(record.nativeRelatedIds.map(target))
  }
  next.relations = (next.relations || []).map(link => ({ ...link, fromId: target(link.fromId), toId: target(link.toId) }))
  next.plans = (next.plans || []).map(plan => ({ ...plan, recordId: target(plan.recordId) }))
  next.projects = (next.projects || []).map(project => ({ ...project, recordIds: unique((project.recordIds || []).map(target)) }))
  next.properties = Object.fromEntries(Object.entries(next.properties || {}).map(([id, value]) => [target(id), value]))
  if (next.planner?.workflow) next.planner.workflow = Object.fromEntries(Object.entries(next.planner.workflow).map(([id, value]) => [target(id), value]))
  if (next.planner?.arrangements) next.planner.arrangements = remapArrangements(next.planner.arrangements, target)
  return { workspace: next, records: resolve, remap }
}
