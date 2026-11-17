const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, session } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const { configureProfile } = require('./profile.cjs')
const { safeUrl, trustedSender, LoginFlowRegistry, reconcileRefreshedCache } = require('./security.cjs')
const { OperationLanes } = require('./operation-lanes.cjs')
const { createPageHandlers, removeDeniedPage } = require('./pages.cjs')
const { createCalendarDeleteHandler } = require('./calendar-delete.cjs')
const { restoreSavedAccount } = require('./auth-restore.cjs')
const { CalendarScheduler } = require('./scheduling.cjs')
const { migrateDeckNoteLinks } = require('./note-link-migration.cjs')
const { createViewPreferenceHandlers } = require('./view-preferences.cjs')

configureProfile(app)
const testMode = !app.isPackaged && process.env.NEXTSPACE_TEST_MODE === '1'
let window, store, client, connection = { connected: false }, mode = 'disconnected'
let WorkspaceStore, accountScope, atomicWriteJson, NextcloudClient, beginLoginFlow, pollLoginFlow, calendarInterval, createPlannerWorkspace, createEmptyState, normalizeEventDetails, normalizeEventAttendees, normalizeEventParticipation, taskCreationOptions, ViewPreferencesClient
let dataDirectory, credentialPath, credentialDirectory, activeCredentialPath, entryUrl, startupWarning
const operations = new OperationLanes()
let refreshPromise
let verifiedSources = new Set()
const loginFlows = new LoginFlowRegistry()
const sourceNames = ['tasks', 'calendar', 'deck', 'notes', 'collectives']
const scheduler = new CalendarScheduler({writeJson: (...args) => atomicWriteJson(...args)})
const cleanClone = value => structuredClone(value)

function boundedString(value, label, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum || value.includes('\0')) throw new Error(`${label} is missing or too long.`)
  return value
}
function inputObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid action input.')
  return value
}
function encryptCredentials(credentials) {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')) throw new Error('Secure system credential storage is unavailable. Enable Windows credential protection and restart NextGlance before connecting.')
  return safeStorage.encryptString(JSON.stringify(credentials)).toString('base64')
}
async function writeCredentials(credentials, scope) {
  const encrypted = encryptCredentials(credentials)
  const accountPath = path.join(credentialDirectory, `${scope}.encrypted.json`)
  await atomicWriteJson(accountPath, { schemaVersion: 1, scope, encrypted }, { backup: false })
  await atomicWriteJson(credentialPath, { schemaVersion: 1, scope, serverUrl: credentials.serverUrl, username: credentials.accountUser }, { backup: false })
  if (activeCredentialPath && activeCredentialPath !== accountPath) await fs.unlink(activeCredentialPath).catch(() => {})
  activeCredentialPath = accountPath
}
function state() {
  const current = store.publicSnapshot()
  return {
    mode, workspace: current.workspace, revision: current.revision, recordIdAliases: store.recordIdAliases(),
    records: current.cache.records, collections: current.cache.collections, statuses: current.cache.statuses.map(status => mode === 'live' && !verifiedSources.has(status.source) && status.state === 'connected' ? { ...status, state: 'unavailable', message: 'Cached from a previous session. Refresh to check this source before editing.' } : status),
    connection: cleanClone(connection), storage: { ...store.storage(), ...(startupWarning ? { message: startupWarning } : {}) },
    pendingSchedules: scheduler.pending(store).map(pending => ({...pending,recordId:store.resolveRecordId(pending.recordId)})),
    ...(current.cache.theme ? { theme: cleanClone(current.cache.theme) } : {}),
  }
}
async function loadDisconnected() {
  const nextStore = await WorkspaceStore.open({ dataDir: dataDirectory, scope: 'local', initialState: createEmptyState() })
  store = nextStore; client = null; mode = 'disconnected'; connection = { connected: false }; verifiedSources = new Set()
  await scheduler.load(store)
  return state()
}
function freshLiveState() {
  return { workspace: createPlannerWorkspace(), records: [], collections: [], statuses: sourceNames.map(source => ({ source, state: 'unavailable', count: 0, message: 'Refresh to load data from Nextcloud.' })) }
}
async function refreshSources() {
  if (mode === 'disconnected') return state()
  requireLiveConnection()
  if (refreshPromise) return refreshPromise
  const operation = refreshNativeSources()
  refreshPromise = operation
  try { return await operation } finally { if (refreshPromise === operation) refreshPromise = undefined }
}
async function refreshNativeSources() {
  // Native reads and custom metadata sync have independent background actions.
  // The current registry is reconciled again when either action commits.
  const before = store.cacheSnapshot()
  client.primeFileMetadata(before.records)
  let incoming
  try { incoming = await client.readAll() }
  catch (error) { incoming = { records: [], collections: [], statuses: sourceNames.map(source => ({ source, state: 'error', count: 0, ...(['AUTH', 'PERMISSION'].includes(error.code) ? { permissionDenied: true, message: 'Nextcloud denied access. Reconnect to verify your access.' } : { message: 'Could not refresh this source. Check your connection.' }) })) } }
  await store.updateCache(current => {
    // Optional file-tag/attachment discovery can fail independently of Notes
    // or Deck. Missing metadata is not an instruction to erase cached links.
    const byId = new Map(current.records.map(item => [item.id, item]))
    const byIdentity = new Map(current.records.filter(item => item.identity?.key).map(item => [`${item.source}\0${item.identity.key}`, item]))
    incoming.records = incoming.records.map(record => {
      const previous = byId.get(record.id) || (record.identity?.key ? byIdentity.get(`${record.source}\0${record.identity.key}`) : undefined);
      if (!previous) return record;
      return {...record, ...(record.source === 'deck' && record.attachmentFileIds === undefined && previous.attachmentFileIds ? {attachmentFileIds: previous.attachmentFileIds} : {}), ...(record.source === 'notes' && record.fileTags === undefined && previous.fileTags ? {fileTags: previous.fileTags, tagDetails: previous.fileTags, tags: [...new Set([...(record.tags || []), ...previous.fileTags.map(tag => tag.title)])]} : {})};
    })
    const reconciled = reconcileRefreshedCache(before, current, incoming, sourceNames)
    verifiedSources = reconciled.successful
    return reconciled.cache
  }, { purgeBackup: incoming.statuses.some(status => status.permissionDenied === true || status.revokedCollectionIds?.length) })
  return state()
}
async function commitSourceEdit(record, saved) {
  const collection = store.collectionSnapshot(record.collectionId, record.source)
  const updated = await client.savedRecord(record, collection, saved)
  // Take the cache inside the short commit lock: a background refresh may have
  // completed since savedRecord read the response. Never replace other items.
  await store.updateCache(cache => {
    if (cache.statuses.some(status => status.source === record.source && (status.permissionDenied || status.revokedCollectionIds?.includes(record.collectionId)))) return cache
    const collections = cache.collections.map(item=>saved?.verifiedCollection?.id===item.id&&saved.verifiedCollection.source===item.source&&saved.verifiedCollection.remote?.href===item.remote?.href?saved.verifiedCollection:item)
    if (updated.source === 'notes' && !collections.some(item => item.id === updated.collectionId)) collections.push({ id: updated.collectionId, source: 'notes', title: updated.collectionTitle, remote: { category: updated.remote.category } })
    const id = store.resolveRecordId(record.id)
    return { ...cache, collections, records: cache.records.map(item => item.id === id ? {...updated,id} : item) }
  })
  return state()
}
async function commitCreatedItem(source, saved, collection) {
  const {creationWarning, ...record} = await client.createdRecord(source, saved, collection)
  await store.updateCache(cache => {
    if (cache.statuses.some(status => status.source === source && (status.permissionDenied || status.revokedCollectionIds?.includes(record.collectionId)))) return cache
    const collections = cache.collections.map(item=>saved?.verifiedCollection?.id===item.id&&saved.verifiedCollection.source===item.source&&saved.verifiedCollection.remote?.href===item.remote?.href?saved.verifiedCollection:item)
    if (source === 'notes' && !collections.some(item => item.id === record.collectionId)) collections.push({id: record.collectionId, source: 'notes', title: record.collectionTitle, remote: {category: record.remote.category}})
    // A retry can return the same native task under its protocol ID rather than
    // its reconciled app UUID. Replace that identity before computing counts.
    const records = [...cache.records.filter(item => item.id !== record.id && !(record.identity?.key && item.source === source && item.identity?.key === record.identity.key)), record]
    return {...cache, collections, records, statuses: cache.statuses.map(status => status.source === source ? {...status, count: records.filter(item => item.source === source).length} : status)}
  })
  // Cache reconciliation assigns the durable app UUID. Return that identity so
  // the UI can add a new item to an individually curated project immediately.
  const created = store.snapshot().cache.records.find(item => item.source === source && item.identity?.key === record.identity?.key)
  if (!created) throw new Error('The item was created, but its planner identity could not be resolved. Refresh before creating another item.')
  return {...state(), createdRecordId: created.id, ...(saved?.warning || creationWarning ? {creationWarning: saved?.warning || creationWarning} : {})}
}
async function connectAccount(input, loginEntry) {
  inputObject(input)
  const serverUrl = safeUrl(input.serverUrl, true).href.replace(/\/+$/, '')
  const username = boundedString(input.username, 'Username', 512)
  const appPassword = boundedString(input.appPassword, 'App password', 4096)
  // Validate OS protection and the account before touching the active connection.
  encryptCredentials({ serverUrl, username, appPassword })
  const candidate = new NextcloudClient({ serverUrl, username, appPassword })
  const discovered = await candidate.discover()
  if (loginEntry) loginFlows.assertCurrent(loginEntry)
  const canonicalUsername = boundedString(discovered.username || candidate.username || username, 'Nextcloud user identity', 512)
  const scope = accountScope(serverUrl, canonicalUsername)
  const nextStore = await WorkspaceStore.open({ dataDir: dataDirectory, scope, initialState: freshLiveState() })
  if (loginEntry) loginFlows.beginCommit(loginEntry)
  await writeCredentials({ serverUrl, username, appPassword, accountUser: canonicalUsername }, scope)
  store = nextStore; client = candidate; mode = 'live'; connection = { connected: true, serverUrl, username: canonicalUsername }; startupWarning = undefined; verifiedSources = new Set()
  await scheduler.load(store)
  await store.syncWith(client)
  return refreshSources()
}
function requireWritableSource(source) {
  requireLiveConnection()
  if (mode === 'live' && !verifiedSources.has(source)) throw new Error('Refresh this Nextcloud source successfully before editing. Cached data is available for reading.')
}
function requireLiveConnection() {
  if (mode !== 'live' || !connection.connected || !client) throw new Error('Connect your Nextcloud account first. Your local planner and cached data are preserved.')
}
function currentRecord(id, source) {
  requireWritableSource(source)
  boundedString(id, 'Record id', 2048)
  const record = findRecord(id, source)
  if (!record) throw new Error('That record is no longer available. Refresh and try again.')
  if (record.readonly) throw new Error('This record is read-only in NextGlance.')
  return record
}
function currentEventRecord(id) {
  requireWritableSource('calendar')
  boundedString(id, 'Record id', 2048)
  const record=findRecord(id,'calendar')
  if(!record||record.kind!=='event')throw new Error('That event is no longer available. Refresh and try again.')
  return record
}
function findRecord(id, source) {
  return store.recordSnapshot(id, source)
}
function currentCollection(id, source = 'tasks') {
  requireWritableSource(source)
  boundedString(id, 'Source collection', 2048)
  const collection = store.collectionSnapshot(id, source)
  if (!collection) throw new Error('Choose an available Nextcloud source.')
  if (collection.readonly) throw new Error('This source is read-only.')
  return collection
}
function readableRecord(input, source) {
  inputObject(input); requireLiveConnection()
  const id = boundedString(input.id, 'Record id', 2048)
  const record = findRecord(id, source)
  if (!record) throw new Error('That record is no longer available. Refresh and try again.')
  return record
}
async function rememberAttachments(record, result, refreshCard = false) {
  if (refreshCard) await commitSourceEdit(record, {})
  await store.updateRecordMetadata(record.id, {attachmentFileIds:[...new Set(result.attachments.flatMap(attachment => attachment.fileId ? [attachment.fileId] : []))]})
  return result
}
async function rememberNoteTags(record, result) {
  await store.updateRecordMetadata(record.id, item => ({fileTags:result.tags,tagDetails:result.tags,tags:[...new Set([...(item.tags?.includes('Favorite')?['Favorite']:[]),...result.tags.map(tag=>tag.title)])]}))
  return result
}
const handlers = {
  ...createViewPreferenceHandlers({
    getClient: () => { requireLiveConnection(); return client },
    createClient: nativeClient => new ViewPreferencesClient(nativeClient),
  }),
  deleteEvent: createCalendarDeleteHandler({getContext: id => {
    const record = currentEventRecord(id)
    return {client, store, record, collection: currentCollection(record.collectionId, 'calendar')}
  }, state}),
  ...createPageHandlers({
    getContext: input => ({ mode, connection, client, cache: {records:[store.recordSnapshot(input?.id,'collectives')].filter(Boolean),statuses:store.statusSnapshot()}, resolveRecordId: id => store.resolveRecordId(id) }),
    onAccessDenied: async (record, error) => {
      verifiedSources.delete('collectives')
      await store.updateCache(cache => removeDeniedPage(cache, {...record,id:store.resolveRecordId(record.id)}, error), { purgeBackup: true })
    },
  }),
  getState: async () => state(),
  retryConnection: async () => {
    if (!await restoreConnection()) {
      if (mode === 'live') connection = { ...connection, connected: false, reconnectRequired: true, restoreError: 'Saved sign-in information is unavailable. Sign in again to reconnect; your account workspace is preserved.' }
    }
    return state()
  },
  refresh: async () => refreshSources(),
  saveWorkspace: async (workspace, expectedRevision) => { startupWarning = undefined; return store.saveWorkspace(workspace, expectedRevision) },
  connect: connectAccount,
  beginLogin: async (serverUrl, generation) => {
    safeUrl(serverUrl, true)
    encryptCredentials({})
    const flow = await beginLoginFlow(serverUrl)
    const loginUrl = safeUrl(flow.loginUrl)
    if (loginUrl.origin !== safeUrl(serverUrl, true).origin) throw new Error('Nextcloud returned a login address on a different server. Use an app password to connect instead.')
    const flowId = randomUUID()
    loginFlows.publish(flowId, flow, generation)
    await shell.openExternal(loginUrl.href)
    return { flowId, loginUrl: loginUrl.href }
  },
  pollLogin: async flowId => {
    boundedString(flowId, 'Sign-in request', 80)
    const entry = loginFlows.get(flowId)
    const result = await pollLoginFlow(entry.flow)
    loginFlows.assertCurrent(entry)
    if (result.pending) return { pending: true }
    try { return { pending: false, state: await connectAccount(result, entry) } }
    finally { loginFlows.finish(entry) }
  },
  disconnect: async () => {
    if (activeCredentialPath) await fs.unlink(activeCredentialPath).catch(error => { if (error.code !== 'ENOENT') throw error })
    await fs.unlink(credentialPath).catch(error => { if (error.code !== 'ENOENT') throw error })
    activeCredentialPath = undefined
    loginFlows.begin(); startupWarning = undefined
    return loadDisconnected()
  },
  createNote: async input => {
    requireWritableSource('notes')
    inputObject(input)
    const title = boundedString(input.title, 'Note title', 500)
    const content = boundedString(input.content, 'Note content', 500000, true)
    const collection = input.collectionId ? currentCollection(input.collectionId, 'notes') : undefined
    const category = collection ? collection.remote?.category ?? '' : input.category === undefined ? '' : boundedString(input.category, 'Note category', 200, true)
    return commitCreatedItem('notes', await client.createNote({ title, content, category }), collection)
  },
  updateNote: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'notes')
    const title = boundedString(input.title, 'Note title', 500)
    const content = boundedString(input.content, 'Note content', 500000, true)
    if (input.etag !== undefined) boundedString(input.etag, 'Note version', 1000)
    const category = input.category === undefined ? undefined : boundedString(input.category, 'Note category', 200, true)
    let base
    if (input.base !== undefined) {
      inputObject(input.base)
      base = {title: boundedString(input.base.title, 'Original note title', 500, true), content: boundedString(input.base.content, 'Original note content', 500000, true)}
      if (input.base.category !== undefined) base.category = boundedString(input.base.category, 'Original note category', 200, true)
    }
    return commitSourceEdit(record, await client.updateNote({ id: record.id, title, content, category, etag: input.etag ?? record.etag, base }, record))
  },
  readNote: async input => {
    const record = readableRecord(input, 'notes')
    const note = await client.readNote(record)
    return {id: record.id, title: note.title, content: note.content, category: note.category, etag: note.etag, readonly: Boolean(note.readonly)}
  },
  readNoteTags: async input => {
    const record = readableRecord(input, 'notes')
    return rememberNoteTags(record, await client.readNoteTags(record))
  },
  setNoteTags: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'notes')
    return rememberNoteTags(record, await client.setNoteTags(input, record))
  },
  listFiles: async input => {
    inputObject(input); requireLiveConnection()
    const path = input.path === undefined ? '/' : boundedString(input.path, 'Nextcloud folder', 4096)
    return client.listFiles({path})
  },
  readDeckAttachments: async input => {
    const record = readableRecord(input, 'deck')
    return rememberAttachments(record, await client.readDeckAttachments(record))
  },
  attachDeckFile: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'deck')
    if (Boolean(input.path) === Boolean(input.noteId)) throw new Error('Choose one file or note to attach.')
    const note = input.noteId ? readableRecord({id: boundedString(input.noteId, 'Note id', 2048)}, 'notes') : undefined
    const filePath = input.path ? boundedString(input.path, 'Nextcloud file', 4096) : undefined
    return rememberAttachments(record, await client.attachDeckFile({path: filePath, note}, record), true)
  },
  removeDeckAttachment: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'deck')
    const attachmentId = boundedString(input.attachmentId, 'Attachment id', 100)
    return rememberAttachments(record, await client.removeDeckAttachment({attachmentId}, record), true)
  },
  uploadDeckAttachment: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'deck')
    // Renderer supplies no local path; only the user's native picker choice is read.
    const choice = await dialog.showOpenDialog(window, {title: 'Attach a file to this Deck card', properties: ['openFile']})
    if (choice.canceled || choice.filePaths.length !== 1) return {cancelled: true, ...(await client.readDeckAttachments(record))}
    const filePath = choice.filePaths[0], stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Choose a file up to 20 MB to upload.')
    return rememberAttachments(record, await client.uploadDeckAttachment({name: path.basename(filePath), bytes: await fs.readFile(filePath)}, record), true)
  },
  readRelatedResources: async input => client.readRelatedResources(readableRecord(input)),
  migrateDeckNoteLinks: async (input = {}) => {
    inputObject(input); requireWritableSource('deck')
    const result = await migrateDeckNoteLinks({store, limit: input.limit ?? 1, attach: async (card, note) => {
      // A read-only card may already contain the native attachment. Confirm it
      // before cleaning up duplicate custom intent; never bypass permissions.
      const native = card.readonly ? await client.readDeckAttachments(card) : await client.attachDeckFile({note}, card)
      return rememberAttachments(card, native, !card.readonly)
    }})
    return {...result, state: state()}
  },
  updateDescription: async input => {
    inputObject(input)
    requireLiveConnection()
    const id = boundedString(input.id, 'Record id', 2048)
    const candidate = findRecord(id)
    if (!candidate || !['tasks', 'calendar', 'deck'].includes(candidate.source)) throw new Error('Choose an available task, card, or event to edit its description.')
    const record = currentRecord(id, candidate.source)
    const description = boundedString(input.description, 'Description', 500000, true)
    if (input.etag !== undefined) {
      boundedString(input.etag, 'Item version', 1000)
      if (input.etag !== record.etag) throw new Error('This item changed while its description was being edited. Refresh and reopen it before saving.')
    }
    return commitSourceEdit(record, await client.updateDescription({ description, etag: input.etag }, record))
  },
  createDeckLabel: async input => {
    inputObject(input)
    const collection = currentCollection(input.collectionId, 'deck')
    const label = await client.createDeckLabel(input, collection)
    await store.updateCache(cache => ({...cache, collections: cache.collections.map(item => item.id === collection.id ? {...item, labels: [...(item.labels || []).filter(value => value.id !== label.id), label]} : item)}))
    return {label, state: state()}
  },
  updateRecordAppearance: async input => {
    inputObject(input)
    const id = boundedString(input.id, 'Record id', 2048)
    const item = findRecord(id)
    if (!item || !['tasks','calendar','deck'].includes(item.source)) throw new Error('Choose a task, event or Deck card.')
    const record = currentRecord(id, item.source)
    const collection = store.collectionSnapshot(record.collectionId)
    return commitSourceEdit(record, await client.updateRecordAppearance(input, record, collection))
  },
  updateTaskStatus: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'tasks')
    return commitSourceEdit(record, await client.updateTaskStatus(input, record))
  },
  updateRecordDates: async input => {
    inputObject(input)
    requireLiveConnection()
    const id = boundedString(input.id, 'Record id', 2048)
    const candidate = findRecord(id)
    if (!candidate || !['tasks', 'calendar', 'deck'].includes(candidate.source)) throw new Error('Choose an available task, card, or event to change its dates.')
    const record = currentRecord(id, candidate.source)
    const change = {}
    for (const field of ['start', 'due', 'end']) if (input[field] !== undefined) change[field] = boundedString(input[field], 'Date', 80, true)
    if (input.allDay !== undefined) {
      if (typeof input.allDay !== 'boolean') throw new Error('Choose a valid event date mode.')
      change.allDay = input.allDay
    }
    if (input.etag !== undefined) {
      change.etag = boundedString(input.etag, 'Item version', 1000)
      if (input.etag !== record.etag) throw new Error('This item changed. Refresh and try the date change again.')
    }
    return commitSourceEdit(record, await client.updateRecordDates(change, record))
  },
  createTask: async input => {
    inputObject(input)
    const options = taskCreationOptions(input)
    const title = boundedString(input.title, 'Task title', 500)
    const collection = currentCollection(input.collectionId, 'tasks')
    const due = input.due === undefined || input.due === '' ? undefined : boundedString(input.due, 'Task due date', 80)
    const start = input.start === undefined || input.start === '' ? undefined : boundedString(input.start, 'Task start date', 80)
    const description = input.description === undefined ? '' : boundedString(input.description, 'Task description', 500000, true)
    if (due && !Number.isFinite(Date.parse(due))) throw new Error('Choose a valid task due date.')
    return commitCreatedItem('tasks', await client.createTask({ title, start, due, description, ...options }, collection), collection)
  },
  createCard: async input => {
    inputObject(input)
    const collection = currentCollection(input.collectionId, 'deck')
    const title = boundedString(input.title, 'Deck card title', 255)
    const stackId = boundedString(input.stackId, 'Deck stack', 2048)
    const description = input.description === undefined ? '' : boundedString(input.description, 'Card description', 500000, true)
    const start = input.start === undefined || input.start === '' ? undefined : boundedString(input.start, 'Card start date', 80)
    const due = input.due === undefined || input.due === '' ? undefined : boundedString(input.due, 'Card due date', 80)
    if (input.assignToMe !== undefined && typeof input.assignToMe !== 'boolean') throw new Error('Choose whether to assign this card to yourself.')
    return commitCreatedItem('deck', await client.createCard({title, stackId, description, start, due, assignToMe: input.assignToMe === true}, collection), collection)
  },
  setTaskCompleted: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'tasks')
    if (typeof input.completed !== 'boolean') throw new Error('Task completion must be true or false.')
    return commitSourceEdit(record, await client.setTaskCompleted({ id: record.id, completed: input.completed }, record))
  },
  setTaskDue: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'tasks')
    const due = input.due === undefined || input.due === '' ? undefined : boundedString(input.due, 'Task due date', 80)
    if (due && !Number.isFinite(Date.parse(due))) throw new Error('Choose a valid task due date.')
    return commitSourceEdit(record, await client.setTaskDue({ id: record.id, due }, record))
  },
  createEvent: async input => {
    inputObject(input)
    const collection = currentCollection(input.collectionId, 'calendar')
    const details = normalizeEventDetails(input, {requireTitle: true})
    const start = boundedString(input.start, 'Event start', 80), end = boundedString(input.end, 'Event end', 80)
    if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) throw new Error('Choose an end after the event start.')
    if (input.allDay !== undefined && typeof input.allDay !== 'boolean') throw new Error('Choose a valid event date mode.')
    const attendees=input.attendees===undefined?{}:{attendees:normalizeEventAttendees(input.attendees)}
    return commitCreatedItem('calendar', await client.createEvent({ ...details, ...attendees, collectionId: collection.id, start, end, allDay: input.allDay }, collection), collection)
  },
  createLinkedEvent: async input => {
    requireLiveConnection()
    return scheduler.create(input, {store, client, getCollection: id => currentCollection(id, 'calendar'), validateInterval: calendarInterval, state})
  },
  updateEvent: async input => {
    inputObject(input)
    const record = currentEventRecord(input.id)
    const collection=currentCollection(record.collectionId,'calendar')
    const details = normalizeEventDetails(input)
    const dates = input.start !== undefined || input.end !== undefined
    const start = dates ? boundedString(input.start, 'Event start', 80) : undefined, end = dates ? boundedString(input.end, 'Event end', 80) : undefined
    if (dates && (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start))) throw new Error('Choose an end after the event start.')
    if (input.allDay !== undefined && typeof input.allDay !== 'boolean') throw new Error('Choose a valid event date mode.')
    const attendees=input.attendees===undefined?{}:{attendees:normalizeEventAttendees(input.attendees)}
    return commitSourceEdit(record, await client.updateEvent({ id: record.id, ...details,...attendees, ...(dates ? {start, end} : {}), ...(input.allDay !== undefined ? {allDay: input.allDay} : {}), ...(input.etag !== undefined ? {etag: input.etag} : {}) }, record,collection))
  },
  respondToEvent: async input => {
    inputObject(input)
    const record=currentEventRecord(input.id),collection=currentCollection(record.collectionId,'calendar')
    const etag=boundedString(input.etag,'Event version',1000),participation=normalizeEventParticipation(input.participation)
    return commitSourceEdit(record,await client.respondToEvent({id:record.id,etag,participation},record,collection))
  },
  setCardCompleted: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'deck')
    if (typeof input.completed !== 'boolean') throw new Error('Card completion must be true or false.')
    return commitSourceEdit(record, await client.setCardCompleted({ id: record.id, completed: input.completed }, record))
  },
  moveCard: async input => {
    inputObject(input)
    const record = currentRecord(input.id, 'deck')
    const stackId = boundedString(input.stackId, 'Deck stack', 2048)
    const collection = currentCollection(record.collectionId, 'deck')
    if (!collection.stacks?.some(stack => String(stack.id) === stackId)) throw new Error('Choose an available stack in this board.')
    const saved = await client.moveCard({ id: record.id, stackId }, record, collection)
    return commitSourceEdit(record, saved)
  },
  setDeckDependency: async input => {
    inputObject(input)
    const from = currentRecord(input.fromId, 'deck')
    boundedString(input.toId, 'Prerequisite card id', 2048)
    const to = findRecord(input.toId, 'deck')
    if (!to) throw new Error('The prerequisite Deck card is no longer available. Refresh and try again.')
    if (from.id === to.id) throw new Error('Choose a different Deck card to link.')
    if (input.remove !== undefined && typeof input.remove !== 'boolean') throw new Error('Choose a valid card link action.')
    const saved = await client.setDeckDependency({ fromId: from.id, toId: to.id, remove: input.remove === true }, from, to)
    return commitSourceEdit(from, saved)
  },
  syncWorkspace: async () => { requireLiveConnection(); startupWarning = undefined; await store.syncWith(client); return state() },
  exportWorkspace: async () => {
    const result = await dialog.showSaveDialog(window, { title: 'Export planner metadata', defaultPath: `NextGlance-planner-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON planner metadata', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return { exported: false }
    await atomicWriteJson(result.filePath, store.snapshot().workspace, { backup: false })
    return { exported: true, path: result.filePath }
  },
  openExternal: async url => { await shell.openExternal(safeUrl(url).href) },
}

function installBridge() {
  ipcMain.handle('nextspace:cancelLogin', async (event, flowId) => {
    if (!trustedSender(event, window?.webContents, entryUrl)) throw new Error('This page is not allowed to access the workspace.')
    boundedString(flowId, 'Sign-in request', 80)
    loginFlows.cancel(flowId)
    await operations.idle()
    return state()
  })
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`nextspace:${name}`, async (event, ...args) => {
    if (!trustedSender(event, window?.webContents, entryUrl)) throw new Error('This page is not allowed to access the workspace.')
    const generation = ['beginLogin', 'connect', 'disconnect'].includes(name) ? loginFlows.begin() : undefined
    const operation = operations.run(async () => {
      try { return await (name === 'beginLogin' ? handler(args[0], generation) : handler(...args)) }
      catch (error) {
        // Native fs errors can contain paths; network errors can contain headers. Only known safe messages reach the UI.
        if (error.code && ['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'EROFS', 'EIO'].includes(error.code)) throw new Error('The local workspace could not be saved or read. Check available disk space and folder permissions. Existing data was preserved.')
        const message = typeof error.message === 'string' ? error.message : 'The action could not finish. Please try again.'
        if (/authorization|basic [a-z0-9+/=]+|password[=:]|token[=:]/i.test(message)) throw new Error('The Nextcloud request failed. Check your connection and sign in again if necessary.')
        throw new Error(message.slice(0, 1200))
      }
    }, { parallel: ['refresh', 'syncWorkspace', 'getViewPreferences', 'saveViewPreferences', 'getState', 'saveWorkspace', 'listFiles', 'readRelatedResources'].includes(name), contextChange: ['connect', 'disconnect', 'retryConnection', 'pollLogin', 'beginLogin'].includes(name) })
    return operation
  })
}
async function restoreConnection() {
  const restored = await restoreSavedAccount({
    credentialPath, credentialDirectory, accountScope, sources: sourceNames,
    openStore: scope => WorkspaceStore.open({ dataDir: dataDirectory, scope, initialState: freshLiveState() }),
    createClient: credentials => new NextcloudClient(credentials),
    canDecrypt: () => safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text'),
    decrypt: encrypted => safeStorage.decryptString(encrypted),
  })
  if (restored.kind === 'none') return false
  store = restored.store; client = restored.client; connection = restored.connection; mode = 'live'
  activeCredentialPath = restored.accountPath; verifiedSources = new Set(); startupWarning = undefined
  await scheduler.load(store)
  return true
}
async function createWindow() {
  const devUrl = !app.isPackaged ? process.env.NEXTSPACE_DEV_URL : undefined
  if (devUrl) {
    const checked = safeUrl(devUrl)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(checked.hostname)) throw new Error('Development UI must run on localhost.')
    entryUrl = checked.href
  } else entryUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href
  window = new BrowserWindow({ width: 1480, height: 980, minWidth: 920, minHeight: 640, title: 'NextGlance', icon: path.join(__dirname, 'icon.ico'), backgroundColor: '#f8f7f4', show: false, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: !testMode, devTools: !app.isPackaged } })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] !== entryUrl.split('#')[0]) event.preventDefault()
  })
  if (!testMode) window.once('ready-to-show', () => window.show())
  window.on('closed', () => { window = null })
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question', title: 'Edits are not saved yet',
      message: 'Keep NextGlance open to finish saving your edits?',
      detail: 'There are unsaved editor drafts, planner changes, or Nextcloud edits still saving or needing a retry. Closing now may lose them. Keep the app open to save, retry, or export your planner draft.',
      buttons: ['Keep open', 'Close without saving'], defaultId: 0, cancelId: 0, noLink: true,
    })
    // In Electron, preventing this event explicitly allows the unload that the
    // renderer blocked. The default preserves pending edits and keeps the app.
    if (choice === 1) event.preventDefault()
  })
  await window.loadURL(entryUrl)
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window && !testMode) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.whenReady().then(async () => {
    const workspaceModule = await import('@nextspace/nextcloud-node/workspace.mjs')
    const connectorModule = await import('@nextspace/nextcloud-node/nextcloud.mjs')
    const plannerModule = await import('@nextspace/core/planner.mjs')
    ;({ ViewPreferencesClient } = await import('@nextspace/nextcloud-client/view-preferences.mjs'))
    ;({normalizeEventDetails} = await import('@nextspace/core/event-details.mjs'))
    ;({normalizeEventAttendees,normalizeEventParticipation} = await import('@nextspace/core/event-scheduling.mjs'))
    ;({taskCreationOptions} = await import('@nextspace/core/card-tasks.mjs'))
    ;({ WorkspaceStore, accountScope, atomicWriteJson } = workspaceModule)
    ;({ NextcloudClient, beginLogin: beginLoginFlow, pollLogin: pollLoginFlow, calendarInterval } = connectorModule)
    ;({ createPlannerWorkspace, createEmptyState } = plannerModule)
    dataDirectory = path.resolve(process.env.NEXTSPACE_DATA_DIR || app.getPath('userData'))
    await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 })
    credentialPath = path.join(dataDirectory, 'active-account.json')
    credentialDirectory = path.join(dataDirectory, 'credentials')
    await fs.mkdir(credentialDirectory, { recursive: true, mode: 0o700 })
    if (!await restoreConnection()) await loadDisconnected()
    installBridge(); await createWindow()
  }).catch(error => {
    if (testMode) console.error('NextGlance test startup failed:', error.stack || error.message)
    else dialog.showErrorBox('NextGlance could not start', error.code === 'ERR_FILE_NOT_FOUND' ? 'Build the app first with pnpm build, then run pnpm desktop.' : 'NextGlance could not open its local workspace. Check the data folder permissions and restore a valid workspace backup if necessary. Existing files were preserved.')
    app.quit()
  })
  app.on('activate', () => { if (!window && store) createWindow().catch(() => app.quit()) })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
