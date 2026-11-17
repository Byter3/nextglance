function pageRecord(context, input, asset = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['id', ...(asset ? ['path'] : [])].includes(key))) throw new Error('Use a page ID from this workspace.')
  if (typeof input.id !== 'string' || !input.id || input.id.length > 2048 || input.id.includes('\0')) throw new Error('Choose an available knowledge page.')
  const id = context.resolveRecordId?.(input.id) || input.id
  const record = context.cache.records.find(item => item.id === id && item.source === 'collectives' && item.kind === 'page')
  if (!record) throw new Error('This knowledge page is no longer available. Refresh and try again.')
  const status = context.cache.statuses.find(item => item.source === 'collectives')
  if (status?.permissionDenied || status?.revokedCollectionIds?.includes(record.collectionId)) throw new Error('Access to this knowledge page was removed. Refresh to check your access.')
  if (context.mode !== 'live' || !context.connection?.connected || !context.client) throw new Error('Connect Nextcloud to read this knowledge page.')
  return record
}

function safePageResult(result) {
  if (!result || typeof result.body !== 'string' || Buffer.byteLength(result.body, 'utf8') > 4 * 1024 * 1024) throw new Error('The knowledge page is too large or returned an unsupported response.')
  return { body: result.body, ...(typeof result.etag === 'string' && result.etag.length <= 1000 ? { etag: result.etag } : {}) }
}

/** The renderer supplies IDs, never URLs, native paths, or credential-bearing records. */
function createPageHandlers({ getContext, onAccessDenied = async () => {} }) {
  const read = async (input, asset) => {
    const context = getContext(input)
    const record = pageRecord(context, input, asset)
    if (asset && (typeof input.path !== 'string' || !input.path || input.path.length > 2048 || /[\u0000-\u001f]/.test(input.path))) throw new Error('Choose a valid knowledge page attachment.')
    try {
      if (!asset) return safePageResult(await context.client.readPage(record))
      const result = await context.client.readPageAsset(record, input.path)
      if (typeof result?.dataUrl !== 'string' || result.dataUrl.length > 6 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(result.dataUrl)) throw new Error('This knowledge page attachment is not a supported image.')
      return { dataUrl: result.dataUrl }
    } catch (error) {
      if (['AUTH', 'PERMISSION'].includes(error.code) || [401, 403].includes(error.status)) await onAccessDenied(record, error)
      throw error
    }
  }
  return { readPage: input => read(input, false), readPageAsset: input => read(input, true) }
}

function removeDeniedPage(cache, record, error) {
  const deniedSource = error.code === 'AUTH' || error.status === 401
  const next = structuredClone(cache)
  next.records = next.records.filter(item => deniedSource ? item.source !== 'collectives' : item.id !== record.id)
  if (deniedSource) next.collections = next.collections.filter(item => item.source !== 'collectives')
  next.statuses = next.statuses.map(status => status.source !== 'collectives' ? status : {
    ...status, state: 'error', count: next.records.filter(item => item.source === 'collectives').length,
    ...(deniedSource ? { permissionDenied: true } : {}),
    message: deniedSource ? 'Nextcloud rejected access. Cached knowledge pages were removed; reconnect to check your access.' : 'Access to a knowledge page was removed. Its cached content was removed; refresh to update the page list.',
  })
  return next
}

module.exports = { createPageHandlers, removeDeniedPage }
