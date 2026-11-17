export function createBrowserCacheFiles({indexedDB = globalThis.indexedDB} = {}) {
  let database
  const open = () => database ||= new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('Browser storage is unavailable. Enable storage for this local preview.')); return }
    const request = indexedDB.open('nextspace-android-preview', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open browser storage.'))
  }).catch(error => { database = undefined; throw error })
  const operation = async (mode, callback) => {
    const db = await open()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('snapshots', mode)
      const request = callback(transaction.objectStore('snapshots'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error || request.error || new Error('Browser storage was interrupted.'))
      transaction.onerror = () => reject(transaction.error || request.error || new Error('Could not save browser storage.'))
    })
  }
  const read = async path => (await operation('readonly', store => store.get(path))) ?? null
  return {
    read,
    keys: async () => (await operation('readonly', store => store.getAllKeys())).map(String),
    size: async path => { const value = await read(path); return typeof value === 'string' ? new TextEncoder().encode(value).length : null },
    write: async (path, value) => { await operation('readwrite', store => store.put(value, path)) },
    remove: async path => { await operation('readwrite', store => store.delete(path)) },
  }
}
