/** Portable DAV fallback budgets/cache. No host, UI, network or persistence. */
export const DAV_SCAN_LIMITS = Object.freeze({
  batchJobs: 250, batchBytes: 16 * 1024 * 1024, fileBytes: 2 * 1024 * 1024,
  collections: 64, collectionResources: 10_000, inventoryResources: 50_000,
  scanBytes: 256 * 1024 * 1024, projectedBytes: 32 * 1024 * 1024, recordsPerSource: 10_000,
  cacheBytes: 32 * 1024 * 1024, cacheEntries: 10_000,
});

export function davDownloadReservation(budget, resourceBytes) {
  const unchanged = {files: budget.files, bytes: budget.bytes};
  if (resourceBytes > DAV_SCAN_LIMITS.fileBytes) return {kind: 'file-too-large', budget: unchanged};
  if (budget.files < 1 || budget.bytes < DAV_SCAN_LIMITS.fileBytes) return {kind: 'next-batch', budget: unchanged};
  return {kind: 'reserve', budget: {files: budget.files - 1, bytes: budget.bytes - DAV_SCAN_LIMITS.fileBytes}, allowance: DAV_SCAN_LIMITS.fileBytes};
}

export function roundRobinDavJobs(inventories) {
  const jobs = [];
  const longest = Math.max(0, ...inventories.map(inventory => inventory.resources.length));
  for (let index = 0; index < longest; index++) for (const inventory of inventories) {
    if (index < inventory.resources.length) jobs.push({inventory, resource: inventory.resources[index]});
  }
  return jobs;
}

const strong = value => typeof value === 'string' && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
const keyFor = (collection, href) => JSON.stringify([collection, href]);
export class DavResourceCache {
  #entries = new Map();
  #bytes = 0;
  constructor({maxBytes = DAV_SCAN_LIMITS.cacheBytes, maxEntries = DAV_SCAN_LIMITS.cacheEntries} = {}) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries;
  }
  get size() { return this.#entries.size; }
  get bytes() { return this.#bytes; }
  get(collection, href, etag) {
    const key = keyFor(collection, href), entry = this.#entries.get(key);
    if (!strong(etag) || !entry || entry.etag !== etag) {
      if (entry) this.#remove(key);
      return undefined;
    }
    this.#entries.delete(key); this.#entries.set(key, entry);
    return {etag: entry.etag, raw: entry.raw, bytes: entry.bytes};
  }
  set(collection, href, {etag, raw, bytes}) {
    const key = keyFor(collection, href);
    this.#remove(key);
    if (!strong(etag) || typeof raw !== 'string' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.maxBytes) return;
    this.#entries.set(key, {collection, href, etag, raw, bytes}); this.#bytes += bytes;
    while (this.#bytes > this.maxBytes || this.#entries.size > this.maxEntries) this.#remove(this.#entries.keys().next().value);
  }
  #remove(key) { const entry = this.#entries.get(key); if (entry) { this.#bytes -= entry.bytes; this.#entries.delete(key); } }
  remove(collection, href) { this.#remove(keyFor(collection, href)); }
  pruneCollection(collection, hrefs) { for (const [key, entry] of this.#entries) if (entry.collection === collection && !hrefs.has(entry.href)) this.#remove(key); }
  deleteCollection(collection) { for (const [key, entry] of this.#entries) if (entry.collection === collection) this.#remove(key); }
  retainCollections(hrefs) { for (const [key, entry] of this.#entries) if (!hrefs.has(entry.collection)) this.#remove(key); }
  clear() { this.#entries.clear(); this.#bytes = 0; }
}
