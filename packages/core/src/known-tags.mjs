/** Suggestions come from this loaded workspace, never the server-wide tag catalogue. */
export function knownWorkspaceTags(records, collections, workspace, assigned = []) {
  const names = new Map()
  const add = tag => {
    const title = typeof tag?.title === 'string' ? tag.title.trim() : ''
    if (!title || names.has(title.toLocaleLowerCase())) return
    names.set(title.toLocaleLowerCase(), {id:`context:${title.toLocaleLowerCase()}`, title, ...(tag.color ? {color:tag.color} : {})})
  }
  for (const record of records || []) {
    for (const tag of record.tagDetails || []) add(tag)
    for (const title of record.tags || []) add({title})
  }
  for (const collection of collections || []) for (const tag of collection.labels || []) add(tag)
  for (const group of [...(workspace?.spaces || []), ...(workspace?.categories || []), ...(workspace?.projects || []).filter(project=>!project.archived)]) add({title:group.name,color:group.color})
  // Assigned native IDs and their permissions always take precedence over a
  // same-named context suggestion (Deck label IDs are not Files tag IDs).
  for (const tag of assigned) if (tag?.title) names.set(tag.title.trim().toLocaleLowerCase(), {...tag})
  return [...names.values()].sort((a,b)=>a.title.localeCompare(b.title))
}
