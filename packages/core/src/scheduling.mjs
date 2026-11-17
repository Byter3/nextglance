/** Calendar booking projections. Source intervals and links stay independent. */
const list = value => Array.isArray(value) ? value : []
const action = record => record?.kind === 'task' || record?.kind === 'card'
const dateOnly = /^\d{4}-\d{2}-\d{2}$/

function instant(value) {
  if (typeof value !== 'string' || !value) return NaN
  if (!dateOnly.test(value)) return Date.parse(value)
  // CalDAV DATE values are local calendar days, not UTC midnights. Validate
  // round trips so invalid dates never become reservations on another day.
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(0, 0, 0, 0)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? +date : NaN
}

function interval(value) {
  if (!value || value.kind && value.kind !== 'event') return null
  if (value.busy === false || String(value.status || '').trim().toUpperCase() === 'CANCELLED') return null
  // Optional transparency also supports a caller holding a native-style draft;
  // refreshed records use the connector's normalized busy boolean.
  if (String(value.transparency || '').trim().toUpperCase() === 'TRANSPARENT') return null
  const start = instant(value.start), end = instant(value.end)
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? {start, end} : null
}

function orderedEvents(a, b) {
  const first = instant(a.start), second = instant(b.start)
  return (Number.isFinite(first) ? first : Infinity) - (Number.isFinite(second) ? second : Infinity) || String(a.id).localeCompare(String(b.id))
}

function registry(records) {
  const result = new Map()
  for (const record of list(records)) if (record?.id && !result.has(record.id)) result.set(record.id, record)
  return result
}

/** Only scheduled_during means reserved work time. Context links are not bookings. */
export function linkedWorkSessions(recordId, records, relations) {
  const byId = registry(records)
  if (!action(byId.get(recordId))) return []
  const seen = new Set(), result = []
  for (const relation of list(relations)) {
    if (relation?.type !== 'scheduled_during' || relation.fromId !== recordId || seen.has(relation.toId)) continue
    const event = byId.get(relation.toId)
    if (event?.kind !== 'event') continue
    seen.add(event.id)
    result.push({event, relation})
  }
  return result.sort((a, b) => orderedEvents(a.event, b.event))
}

/** Reverse lookup uses the same stored association, without duplicating it. */
export function scheduledWorkFor(eventId, records, relations) {
  const byId = registry(records)
  if (byId.get(eventId)?.kind !== 'event') return []
  const seen = new Set(), result = []
  for (const relation of list(relations)) {
    if (relation?.type !== 'scheduled_during' || relation.toId !== eventId || seen.has(relation.fromId)) continue
    const record = byId.get(relation.fromId)
    if (!action(record)) continue
    seen.add(record.id)
    result.push({record, relation})
  }
  return result.sort((a, b) => String(a.record.title || '').localeCompare(String(b.record.title || '')) || String(a.record.id).localeCompare(String(b.record.id)))
}

/**
 * Actual busy event bookings conflict when their half-open intervals overlap.
 * A task's start/due range and planner-only sessions are deliberately excluded.
 * Links do not suppress conflicts with other events. This only evaluates the
 * supplied events; callers must describe the cache/calendar coverage honestly.
 */
export function eventConflicts(slot, events) {
  const candidate = interval(slot)
  if (!candidate) return []
  const seen = new Set(), result = []
  for (const event of list(events)) {
    if (event?.kind !== 'event' || slot.id && event.id === slot.id || event.id && seen.has(event.id)) continue
    const other = interval(event)
    if (!other || candidate.start >= other.end || other.start >= candidate.end) continue
    if (event.id) seen.add(event.id)
    result.push(event)
  }
  return result.sort(orderedEvents)
}

/** Choose a real writable calendar by configured membership, never by its name. */
export function defaultCalendarForRecord(record, workspace, collections, scopeId) {
  const calendars = list(collections).filter(collection => collection?.source === 'calendar' && !collection.readonly && collection.id)
  const writable = new Set(calendars.map(calendar => calendar.id))
  const firstCalendar = ids => list(ids).find(id => writable.has(id))
  if (record?.kind === 'event' && writable.has(record.collectionId)) return record.collectionId
  // Global work has no implicit Space owner. With several destinations the
  // user chooses instead of an unrelated Space changing the proposed booking.
  if (!scopeId || scopeId === 'all') return calendars.length === 1 ? calendars[0].id : undefined
  const overviewGroup=list(workspace?.categories).find(category=>category.id===scopeId&&category.spaceId==='all')
  if(overviewGroup)return firstCalendar(overviewGroup.collectionIds)
  const spaces = list(workspace?.spaces)
  const categories = list(workspace?.categories).filter(category => spaces.some(space => space.id === category.spaceId))
  const allProjects = list(workspace?.projects).filter(project => !project.archived)
  const scopedProject = allProjects.find(project => project.id === scopeId)
  const scopedCategory = categories.find(category => category.id === scopeId)
  const scopedSpace = spaces.find(space => space.id === scopeId || space.id === (scopedProject?.spaceId || scopedCategory?.spaceId))
  // The same source can belong to several Spaces. A visible scope is the user's
  // destination context; never let an earlier unrelated grouping win by order.
  if (scopeId && scopeId !== 'all' && !scopedSpace) return undefined
  const projects = allProjects.filter(project => (!scopedSpace || project.spaceId === scopedSpace.id) && (!scopedCategory || project.categoryId === scopedCategory.id))
  const project = scopedProject || projects.find(project => list(project.recordIds).includes(record?.id)) || projects.find(project => record?.collectionId && list(project.collectionIds).includes(record.collectionId))
  const category = scopedCategory || (project?.categoryId ? categories.find(category => category.id === project.categoryId && category.spaceId === project.spaceId) : categories.find(category => (!project || category.spaceId === project.spaceId) && (!scopedSpace || category.spaceId === scopedSpace.id) && record?.collectionId && list(category.collectionIds).includes(record.collectionId)))
  const space = scopedSpace || spaces.find(space => space.id === (project?.spaceId || category?.spaceId)) || spaces.find(space => record?.collectionId && list(space.collectionIds).includes(record.collectionId))
  const projectCalendar = firstCalendar(project?.collectionIds)
  if (projectCalendar) return projectCalendar
  if (scopedProject) return undefined
  const categoryCalendar = firstCalendar(category?.collectionIds)
  // An explicit category is a destination boundary. If its calendar is missing
  // or read-only, ask the user to choose instead of preselecting another category.
  if (category) return categoryCalendar
  // A deleted or no-longer-member default must not silently book another scope.
  if (space && list(space.collectionIds).includes(space.defaultCalendarId) && writable.has(space.defaultCalendarId)) return space.defaultCalendarId
  return firstCalendar(space?.collectionIds)
}
