// Uses the real shared application. Only this explicitly opened review route uses fixtures.
import {mountNextspace} from '../../packages/ui/src/index.ts'
import {plannerFixture} from '../../tests/fixtures.mjs'
import {localDay} from '@nextspace/core/planner.mjs'

const params = new URLSearchParams(location.search)
const now = new Date(), state = plannerFixture(now)
state.revision = 0
state.workspace.name = 'Development demo'
state.workspace.planner.assignment = 'all'
state.workspace.appearance.mode = 'dark'
state.storage = {syncStatus: 'synced', lastSyncedAt: now.toISOString()}
state.metadata = {ready: true}
state.nativeOperations = ['updateRecordDates', 'updateNote']
for (const record of state.records) {
  if (record.source === 'deck') record.etag = '"demo-card-1"'
  if (record.source === 'notes') record.body = '# Project brief\n\nKeep the opening sequence clear and concise.\n\n- [x] Collect references\n- [ ] Review the first cut\n- [ ] Prepare delivery'
}
for (const collection of state.collections) if (!collection.color) collection.color = collection.source === 'deck' ? '#318ca8' : '#b06bc9'
Object.assign(state.records.find(record => record.id === 'card-mine'), {title: 'Edit the opening sequence', color: '#3893b3', start: localDay(now), body: '- [x] Collect footage\n- [ ] Assemble first cut\n- [ ] Add sound'})
if (params.get('large') === 'true') for (let index = state.records.length; index < 2200; index++) {
  const day = new Date(now); day.setDate(day.getDate() + index % 105 - 14)
  state.records.push({id: 'review-task-' + index, source: 'tasks', kind: 'task', title: 'Review item ' + (index + 1),
    collectionId: 'tasks-work', collectionTitle: 'Freelance tasks', due: localDay(day),
    status: index % 4 ? 'NEEDS-ACTION' : 'COMPLETED', completed: index % 4 === 0, readonly: false, etag: '"demo-1"'})
}
state.statuses.forEach(status => {status.count = state.records.filter(record => record.source === status.source).length})
// Existing material-test wallpaper, intentionally synthetic and restricted to this demo.
const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 1100
const paint = canvas.getContext('2d'), gradient = paint.createLinearGradient(0, 0, 0, 1100)
gradient.addColorStop(0, '#134b6d'); gradient.addColorStop(.55, '#1f4a64'); gradient.addColorStop(1, '#dbae77')
paint.fillStyle = gradient; paint.fillRect(0, 0, 900, 1100)
for (let i = 0; i < 12; i++) {paint.fillStyle = i % 3 ? '#f9d7a8' : '#fff7e6'; paint.beginPath(); paint.arc(i * 173 % 900, 820 + i * 61 % 280, 18 + i * 7 % 44, 0, Math.PI * 2); paint.fill()}
state.theme = {...state.theme, backgroundColor: '#143b55', backgroundDataUrl: canvas.toDataURL('image/png')}
if (params.get('scenario') === 'source') for (const status of state.statuses.filter(status => ['tasks', 'calendar'].includes(status.source)))
  Object.assign(status, {state: 'error', errorCode: 'LIMIT', errorStage: 'source-read', message: 'Calendar scan reached its transfer budget. Some items remain unavailable. Demo of an incomplete source; planner data is synced.'})
if (params.get('scenario') === 'planner') Object.assign(state.storage, {syncStatus: 'error', errorCode: 'TIMEOUT', errorStage: 'planner-read', message: 'The planner request timed out. Retry when the connection is available. Saved changes remain on this device.'})
const read = async () => structuredClone(state)
const refresh = async () => {
  if (params.get('scenario') === 'refreshing') await new Promise(resolve => setTimeout(resolve, 6000))
  return read()
}
const update = async input => {
  const record = state.records.find(record => record.id === input.id)
  if (!record || record.readonly) throw new Error('This demo item is read only.')
  for (const key of ['start', 'due', 'end', 'allDay', 'status', 'completed']) if (key in input) record[key] = input[key] === '' || input[key] === null ? undefined : input[key]
  record.etag = '"demo-' + Date.now() + '"'
  return read()
}
const api = {isNative: false, getState: read, refresh, syncWorkspace: read,
  openExternal: async () => {throw new Error('External access is disabled in this isolated demo.')},
  saveWorkspace: async (workspace, revision) => {if (revision !== state.revision) throw new Error('Demo revision changed.'); state.workspace = structuredClone(workspace); state.revision++; return {workspace: structuredClone(workspace), revision: state.revision, storage: structuredClone(state.storage)}},
  updateRecordDates: update,
  updateNote: async input => {const record = state.records.find(record => record.id === input.id); if (!record) throw new Error('Unknown demo note.'); if (input.title !== undefined) record.title = input.title; if (input.content !== undefined) record.body = input.content; record.etag = '"demo-note-' + Date.now() + '"'; return read()},
  readPage: async () => ({body: 'This is a development example.'}),
}
mountNextspace(api, '#app', {nativeConnection: true, canMutateNative: false, nativeOperations: ['updateRecordDates', 'updateNote'], mobileHost: true, canExportWorkspace: false})
