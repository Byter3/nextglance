import { createPlannerWorkspace } from '@nextspace/core/planner.mjs'
import type { State, WorkspaceApi } from '@nextspace/contracts'

const key = 'nextspace-planner-preview-v2'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** Browser shell is metadata-only. Native data and credentials belong to the desktop bridge. */
export function createBrowserApi(): WorkspaceApi {
  let workspace = createPlannerWorkspace()
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null')
    if (saved?.schemaVersion === 2 && Array.isArray(saved.spaces) && Array.isArray(saved.projects)) workspace = saved
  } catch { /* An unavailable browser store starts an empty preview. */ }
  let state: State = {
    mode: 'disconnected', workspace, revision: 0, records: [], collections: [],
    statuses: ['tasks', 'calendar', 'deck', 'notes', 'collectives'].map(source => ({source, state: 'unavailable', count: 0, message: 'Connect from the Windows app.'})) as State['statuses'],
    connection: {connected: false}, storage: {syncStatus: 'local', message: 'Browser preview · no Nextcloud data loaded'},
  }
  const unavailable = async (): Promise<never> => { throw new Error('Open the Windows app to connect to Nextcloud. This browser preview contains no sample records.') }
  return {
    getState: async () => clone(state), refresh: async () => clone(state),
    saveWorkspace: async (value, revision) => {
      if (revision !== state.revision) throw new Error('This planner changed in another operation. Reload before saving.')
      const workspace = clone(value)
      workspace.updatedAt = new Date().toISOString()
      localStorage.setItem(key, JSON.stringify(workspace))
      state = {...state, workspace, revision: state.revision + 1}
      return {workspace: clone(workspace), revision: state.revision, storage: state.storage}
    },
    readPage: unavailable, beginLogin: unavailable, pollLogin: unavailable,
    cancelLogin: async () => clone(state), connect: unavailable,
    disconnect: async () => clone(state), retryConnection: unavailable,
    createNote: unavailable, updateNote: unavailable, updateDescription: unavailable, updateRecordDates: unavailable, createTask: unavailable, setTaskCompleted: unavailable,
    syncWorkspace: unavailable,
    exportWorkspace: async () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(state.workspace, null, 2)], {type: 'application/json'}))
      const link = document.createElement('a')
      link.href = url; link.download = 'NextGlance-planner.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return {exported: true}
    },
    openExternal: async url => {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only web links can be opened.')
      window.open(parsed.href, '_blank', 'noopener,noreferrer')
    },
  }
}
