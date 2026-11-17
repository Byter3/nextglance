/** Pure initialization of an organization editor. Opening a form never writes. */
export function buildScopeDraft(workspace, options) {
  const {kind, id = '', parentSpaceId, scopeId = 'all', defaultColor = '#0082c9'} = options
  if (kind !== 'space' && kind !== 'project') return null
  const spaces = workspace.spaces || [], projects = workspace.projects || [], categories = workspace.categories || []
  const existing = (kind === 'space' ? spaces : projects).find(item => item.id === id)
  if (id && !existing) return null
  const selectedProject = projects.find(item => item.id === scopeId)
  const selectedCategory = categories.find(item => item.id === (selectedProject?.categoryId || scopeId))
  if(kind==='project'&&!existing&&parentSpaceId===undefined&&selectedCategory?.spaceId==='all')return null
  const selectedSpace = spaces.find(item => item.id === (selectedProject?.spaceId || selectedCategory?.spaceId || scopeId))
  const explicitParent = parentSpaceId === undefined ? undefined : spaces.find(item => item.id === parentSpaceId)
  if (parentSpaceId !== undefined && !explicitParent) return null
  const space = kind === 'space' && existing ? existing
    : existing ? spaces.find(item => item.id === existing.spaceId)
    : explicitParent || selectedSpace || spaces[0]
  if (kind === 'project' && existing && !space) return null
  const category = kind !== 'project' ? undefined
    : existing ? categories.find(item => item.id === existing.categoryId && item.spaceId === space?.id)
    : parentSpaceId === undefined && selectedCategory?.spaceId === space?.id ? selectedCategory : undefined
  const inheritedColor = kind === 'space' && !existing ? selectedCategory?.color || selectedSpace?.color : category?.color || space?.color
  return {
    kind, id, name: existing?.name || '', color: existing?.color || inheritedColor || defaultColor,
    spaceId: space?.id || '', categoryId: category?.id || '',
    collectionIds: [...new Set([
      ...(existing?.collectionIds || []),
      ...(kind === 'space' && existing ? [
        ...categories.filter(item => item.spaceId === existing.id).flatMap(item => item.collectionIds || []),
        ...projects.filter(item => item.spaceId === existing.id && !item.archived).flatMap(item => item.collectionIds || []),
      ] : []),
    ])],
    recordIds: kind === 'project' ? [...(existing?.recordIds || [])] : [],
    ...(kind === 'project' && existing?.tagNames !== undefined ? {tagNames:[...existing.tagNames]} : {}),
    defaultCalendarId: kind === 'space' ? existing?.defaultCalendarId || '' : '',
    defaultTaskListId: kind === 'space' ? existing?.defaultTaskListId || '' : '',
    defaultBoardId: kind === 'space' ? existing?.defaultBoardId || '' : '',
  }
}
