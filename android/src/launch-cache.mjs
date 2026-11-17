import {validateWorkspace, jsonValue} from '@nextspace/core/planner-schema.mjs'
import {normalizeTheme} from '@nextspace/core/theme-cache.mjs'
import {normalizeDeviceState, SOURCES, validRecord, validCollection, problem} from './foundation.mjs'

const clone = value => structuredClone(value)
const omitUndefined = value => Array.isArray(value) ? value.map(omitUndefined) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).map(([key, field]) => [key, omitUndefined(field)])) : value
const fail = () => { throw problem('The saved launch view is invalid. The durable planner files are preserved.', 'CACHE_FORMAT') }

/** Disposable public presentation only. Never restore authorization or write bases. */
export function launchCheckpoint(state, accountKey) {
  const {workspace, revision, records, collections, statuses, theme, deviceState, storage} = state
  return omitUndefined({version: 1, accountKey, state: {
    workspace, revision,
    // First paint needs geometry, labels and relationships, not potentially large
    // repeated note/checklist bodies or private native edit baselines.
    records: records.map(({remote, identity, description, content, body, ...record}) => ({...record, ...(record.source === 'notes' && typeof remote?.category === 'string' ? {remote: {category: remote.category}} : {})})),
    collections: collections.map(({remote, ...collection}) => collection), statuses,
    ...(theme ? {theme} : {}), deviceState, storage,
  }})
}

export function checkedLaunchCheckpoint(input, accountKey) {
  if (!input || input.version !== 1 || input.accountKey !== accountKey || !input.state) fail()
  const allowed = new Set(['workspace', 'revision', 'records', 'collections', 'statuses', 'theme', 'deviceState', 'storage'])
  if (Object.keys(input).some(key => !['version', 'accountKey', 'state'].includes(key)) || Object.keys(input.state).some(key => !allowed.has(key))) fail()
  jsonValue(input, 0, 24, 4 * 1024 * 1024)
  const value = clone(input.state)
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.records) || !Array.isArray(value.collections) || !Array.isArray(value.statuses)) fail()
  value.workspace = validateWorkspace(value.workspace)
  if (value.records.some(record => !validRecord(record) || record.identity !== undefined || record.remote && !(record.source === 'notes' && Object.keys(record.remote).length === 1 && typeof record.remote.category === 'string'))) fail()
  if (value.collections.some(collection => !validCollection(collection) || collection.remote !== undefined)) fail()
  if (value.statuses.some(status => !SOURCES.includes(status.source) || !['connected', 'unavailable', 'error'].includes(status.state))) fail()
  value.records = value.records.map(record => ({...record, readonly: true}))
  value.collections = value.collections.map(collection => ({...collection, readonly: true}))
  value.statuses = value.statuses.map(status => ({...status, state: 'unavailable', message: 'Saved on this device · checking for updates.'}))
  value.deviceState = normalizeDeviceState(value.deviceState)
  const theme = normalizeTheme(value.theme)
  if (theme) value.theme = theme
  else delete value.theme
  // The durable metadata envelope restores the actual write baseline/status.
  value.storage = {syncStatus: 'local', message: 'Restoring saved planner data.'}
  return {version: 1, accountKey, state: value}
}
