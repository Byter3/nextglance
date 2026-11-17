const fs = require('node:fs/promises')
const path = require('node:path')
const { safeUrl } = require('./security.cjs')

const RESTORE_ERROR = 'Your saved Nextcloud sign-in could not be unlocked. Your account workspace and cached data are preserved. Retry the saved connection or sign in again.'
const POINTER_ERROR = 'Your saved account information could not be read. Existing account files are preserved. Sign in again to reopen your workspace.'

function accountIdentity(value, accountScope, expectedScope) {
  if (typeof value?.serverUrl !== 'string' || typeof value?.username !== 'string' || !value.username || value.username.length > 512 || value.username.includes('\0')) return {}
  try {
    const serverUrl = safeUrl(value.serverUrl, true).href.replace(/\/+$/, '')
    if (accountScope(serverUrl, value.username) !== expectedScope) return {}
    return { serverUrl, username: value.username }
  } catch { return {} }
}

/** Unknown identity gets a memory-only recovery screen, never sample data or a new account file. */
function createRecoveryStore(message, sources) {
  const snapshot = {
    schemaVersion: 1, revision: 0,
    workspace: { schemaVersion: 2, id: 'connection-recovery', name: 'Reconnect planner', updatedAt: new Date().toISOString(), spaces: [], projects: [], relations: [], plans: [], identities: [], properties: {}, appearance: { mode: 'system', calendarColors: {} }, planner: { view: 'overview', scopeId: 'all', assignment: 'me', includeUnassigned: false, unassignedBoardIds: [], hiddenCollectionIds: [], excludedSpaceIds: [], showCompleted: false, scopeAssignments: {}, workflow: {} } },
    cache: { records: [], collections: [], statuses: sources.map(source => ({ source, state: 'unavailable', count: 0, message: 'Reconnect your account to load this source.' })) },
  }
  const blocked = async () => { throw new Error('Reconnect the saved account before changing this recovery workspace. Existing account files have not been changed.') }
  return {
    snapshot: () => structuredClone(snapshot),
    storage: () => ({ syncStatus: 'recovery', message }),
    saveWorkspace: blocked, updateCache: blocked, syncWith: blocked,
  }
}

/** Credential restoration never writes/deletes credentials and never chooses demo after a saved-account failure. */
async function restoreSavedAccount({ credentialPath, credentialDirectory, accountScope, openStore, createClient, canDecrypt, decrypt, sources, readFile = fs.readFile }) {
  const recovery = message => ({ kind: 'recovery', store: createRecoveryStore(message, sources), client: null, connection: { connected: false, reconnectRequired: true, restoreError: message, recoveryOnly: true } })
  let active
  try { active = JSON.parse(await readFile(credentialPath, 'utf8')) }
  catch (error) { return error.code === 'ENOENT' ? { kind: 'none' } : recovery(POINTER_ERROR) }
  if (active?.schemaVersion !== 1 || !/^account-[a-f0-9]{64}$/.test(active?.scope || '')) return recovery(POINTER_ERROR)
  const scope = active.scope
  const accountPath = path.join(credentialDirectory, `${scope}.encrypted.json`)
  const identity = accountIdentity(active, accountScope, scope)
  let store
  try { store = await openStore(scope) }
  catch {
    const result = recovery('The saved account workspace could not be opened. Its existing files and sign-in are preserved. Restore a valid workspace backup before continuing.')
    result.connection = { ...result.connection, ...identity }
    result.accountPath = accountPath
    return result
  }
  const offline = () => ({ kind: 'offline', store, client: null, accountPath, connection: { connected: false, ...identity, reconnectRequired: true, restoreError: RESTORE_ERROR } })
  try {
    if (!canDecrypt()) return offline()
    const persisted = JSON.parse(await readFile(accountPath, 'utf8'))
    if (persisted?.schemaVersion !== 1 || persisted.scope !== scope || typeof persisted.encrypted !== 'string' || !persisted.encrypted || persisted.encrypted.length > 32768) return offline()
    const credentials = JSON.parse(decrypt(Buffer.from(persisted.encrypted, 'base64')))
    const serverUrl = safeUrl(credentials.serverUrl, true).href.replace(/\/+$/, '')
    for (const [key, limit] of [['username', 512], ['appPassword', 4096], ['accountUser', 512]]) {
      if (typeof credentials[key] !== 'string' || !credentials[key].trim() || credentials[key].length > limit || credentials[key].includes('\0')) return offline()
    }
    if (accountScope(serverUrl, credentials.accountUser) !== scope) return offline()
    const client = createClient({ ...credentials, serverUrl })
    return { kind: 'restored', store, client, accountPath, connection: { connected: true, serverUrl, username: credentials.accountUser } }
  } catch { return offline() }
}

module.exports = { restoreSavedAccount, createRecoveryStore }
