import {byteLength} from './runtime.mjs';

export const NATIVE_SOURCES = Object.freeze(['tasks', 'calendar', 'notes', 'deck', 'collectives']);
export const httpEtag = value => typeof value === 'string' && value.length <= 1000 && /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value) ? value : null;

export function sourceSelection(value) {
  if (value === undefined) return [...NATIVE_SOURCES];
  if (!Array.isArray(value) || !value.length || value.some(source => !NATIVE_SOURCES.includes(source))) throw Object.assign(new Error('Choose at least one supported source to refresh.'), {code: 'VALIDATION'});
  return NATIVE_SOURCES.filter(source => value.includes(source));
}

/** Private locators are canonical URLs inside this configured installation. */
export function validResourceLocator(locator, serverUrl) {
  try {
    if (!locator || !['dav', 'deck'].includes(locator.kind)) return false;
    const base = new URL(serverUrl), collection = new URL(locator.collection), href = new URL(locator.href);
    const prefix = base.pathname.replace(/\/$/, '') + '/';
    for (const url of [collection, href]) {
      if (url.origin !== base.origin || !url.pathname.startsWith(prefix) || url.username || url.password || url.search || url.hash || url.href !== (url === collection ? locator.collection : locator.href)) return false;
      if (/%(?:2f|5c|00)/i.test(url.pathname) || /[\\\x00-\x1f\x7f]/.test(decodeURIComponent(url.pathname))) return false;
    }
    if (locator.kind === 'deck') return new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 'index\\.php/apps/deck/api/v1\\.0/boards/[1-9]\\d*$').test(collection.pathname) && href.href === collection.href + '/stacks';
    const root = collection.pathname.replace(/\/$/, '') + '/';
    const tail = href.pathname.startsWith(root) ? href.pathname.slice(root.length) : '';
    return collection.pathname.startsWith(prefix + 'remote.php/dav/calendars/') && Boolean(tail) && !tail.includes('/') && !['.', '..'].includes(decodeURIComponent(tail));
  } catch { return false; }
}

/** Invalid disposable cache entries are misses, never a source baseline. */
export function checkedResourceEntry(value, locator, serverUrl) {
  if (!validResourceLocator(locator, serverUrl) || !value || value.version !== 1 || value.kind !== locator.kind || value.collection !== locator.collection || value.href !== locator.href || !httpEtag(value.etag) || typeof value.body !== 'string' || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > (locator.kind === 'dav' ? 2 : 24) * 1024 * 1024 || byteLength(value.body) !== value.bytes) return null;
  if (locator.kind === 'dav' && value.etag.startsWith('W/')) return null;
  return {version: 1, kind: value.kind, collection: value.collection, href: value.href, etag: value.etag, body: value.body, bytes: value.bytes};
}

export function completeDeckStacks(value) {
  const stacks = new Set(), cards = new Set();
  return Array.isArray(value) && value.every(stack => {
    if (!stack || typeof stack !== 'object' || !/^[1-9]\d*$/.test(String(stack.id)) || stacks.has(String(stack.id)) || typeof stack.title !== 'string' || !Array.isArray(stack.cards)) return false;
    stacks.add(String(stack.id));
    return stack.cards.every(card => {
      if (!card || typeof card !== 'object' || !/^[1-9]\d*$/.test(String(card.id)) || cards.has(String(card.id)) || typeof card.title !== 'string') return false;
      cards.add(String(card.id)); return true;
    });
  });
}
