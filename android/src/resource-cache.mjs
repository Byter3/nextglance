import {sha256} from '@nextspace/nextcloud-client/runtime.mjs'
import {checkedResourceEntry, validResourceLocator} from '@nextspace/nextcloud-client/resource-cache-policy.mjs'

const queues = new Map()
const limit = 256 * 1024 * 1024
const fail = (message, code = 'CACHE_FORMAT') => Object.assign(new Error(message), {code})

/** Browser development host only. Native Android uses its atomic resource store. */
export function createPreviewResourceCache(files, account, isActive = () => true) {
  const prefix = `resources/${sha256(`${account.serverUrl}\0${account.username}\0${account.name}`)}/`
  const active = () => {if (!isActive()) throw fail('The selected account changed.', 'CANCELLED')}
  let sizes, totalBytes = 0
  const metadata = new Map(), inventories = new Set()
  const locator = value => {
    if (!validResourceLocator(value, account.serverUrl)) throw fail('Invalid native resource cache locator.')
    return value
  }
  const bucket = (kind, collection) => `${prefix}${kind}/${sha256(collection)}/`
  const validCollection = (kind, collection) => typeof collection === 'string' && validResourceLocator({kind, collection, href: kind === 'deck' ? `${collection}/stacks` : `${collection.replace(/\/$/, '')}/__cache_check__.ics`}, account.serverUrl)
  const path = value => {locator(value); return `${bucket(value.kind, value.collection)}${sha256(value.href)}.json`}
  const indexed = async () => {
    if (sizes) return sizes
    active(); const all = await files.keys(); active()
    const pairs = await Promise.all(all.filter(key => key.startsWith(prefix)).map(async key => [key, await files.size(key)]))
    active(); sizes = new Map(pairs.filter(([, size]) => Number.isSafeInteger(size) && size >= 0))
    totalBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0)
    return sizes
  }
  const queue = work => {
    const pending = (queues.get(prefix) || Promise.resolve()).then(() => {active(); return work()})
    const settled = pending.catch(() => {})
    queues.set(prefix, settled)
    void settled.then(() => {if (queues.get(prefix) === settled) queues.delete(prefix)})
    return pending
  }
  const removePaths = async paths => {for (const item of paths) {active(); await files.remove(item); active(); metadata.delete(item); if (sizes?.has(item)) {totalBytes -= sizes.get(item); sizes.delete(item)}}}
  return {
    get: async value => {
      active(); const key = path(value), text = await files.read(key); active()
      if (text == null) return null
      try {return checkedResourceEntry(JSON.parse(text), value, account.serverUrl)} catch {return null}
    },
    list: ({kind, collection}) => queue(async () => {
      if (kind !== 'dav' || !validCollection(kind,collection)) throw fail('Invalid calendar cache inventory.')
      const bucketKey=bucket(kind,collection)
      if(!inventories.has(bucketKey)){
        for(const [key] of await indexed())if(key.startsWith(bucketKey)){
          active();const raw=await files.read(key);active()
          try{const entry=JSON.parse(raw);if(checkedResourceEntry(entry,entry,account.serverUrl)&&entry.kind===kind&&entry.collection===collection)metadata.set(key,{href:entry.href,etag:entry.etag})}catch{}
        }
        inventories.add(bucketKey)
      }
      const result=[...metadata].filter(([key])=>key.startsWith(bucketKey)).map(([,entry])=>entry)
      if(result.length>10000)throw fail('Calendar cache inventory is too large.','LIMIT')
      return result
    }),
    put: entry => queue(async () => {
      const checked = checkedResourceEntry(entry, entry, account.serverUrl)
      if (!checked) throw fail('Invalid native resource cache entry.')
      const key = path(checked), text = JSON.stringify(checked), bytes = new TextEncoder().encode(text).length
      const index = await indexed()
      for (const item of [...index.keys()]) {
        if (totalBytes - (index.get(key) || 0) + bytes <= limit) break
        if (item !== key) await removePaths([item])
      }
      active(); await files.write(key, text); active()
      totalBytes += bytes - (index.get(key) || 0); index.delete(key); index.set(key, bytes)
      metadata.set(key,{href:checked.href,etag:checked.etag})
    }),
    remove: value => queue(() => removePaths([path(value)])),
    prune: ({kind, collection, hrefs}) => queue(async () => {
      if (!validCollection(kind, collection) || !Array.isArray(hrefs)) throw fail('Invalid native inventory.')
      const keep = new Set(hrefs.map(href => path({kind, collection, href})))
      await removePaths([...await indexed()].map(([key]) => key).filter(key => key.startsWith(bucket(kind, collection)) && !keep.has(key)))
    }),
    retainCollections: ({kind, collections}) => queue(async () => {
      if (!['dav', 'deck'].includes(kind) || !Array.isArray(collections) || collections.some(value => !validCollection(kind, value))) throw fail('Invalid native collection inventory.')
      const keep = new Set(collections.map(collection => bucket(kind, collection)))
      await removePaths([...await indexed()].map(([key]) => key).filter(key => key.startsWith(`${prefix}${kind}/`) && !keep.has(key.slice(0, key.lastIndexOf('/') + 1))))
    }),
    clear: () => queue(async () => removePaths([...await indexed()].map(([key]) => key))),
  }
}
