import {validResourceLocator, httpEtag} from './resource-cache-policy.mjs';
import {byteLength} from './runtime.mjs';
import {normalizeCalendarHistoryDays, normalizeCalendarWindow} from '@nextspace/core/history.mjs';

const DAY = 86_400_000;
export const DAV_PROJECTION_VERSION = 4;
const sources = {VTODO: 'tasks', VEVENT: 'calendar'};
const keyField = {tasks: 'taskKeys', calendar: 'eventKeys'};
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\u0000-\u001f]/.test(value);
const unique = values => new Set(values).size === values.length;
export function davProjectionWindow(now, {calendarHistoryDays = 14, calendarWindow} = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new TypeError('A valid projection instant is required.');
  if (calendarWindow !== undefined) {
    const window = normalizeCalendarWindow(calendarWindow);
    if (!window) throw new TypeError('A bounded Calendar date range is required.');
    return window;
  }
  const day = Math.floor(now / DAY) * DAY;
  const days = normalizeCalendarHistoryDays(calendarHistoryDays), earliest = Date.parse('0001-01-01T00:00:00Z');
  return {from: days === null ? earliest : Math.max(earliest, day - days * DAY), to: day + 91 * DAY};
}
export function checkedDavToken(value) {
  return value && ['sync-token', 'ctag'].includes(value.kind) && typeof value.value === 'string' && value.value.trim() && value.value.length <= 4096 && !/[\u0000-\u001f]/.test(value.value) ? {kind: value.kind, value: value.value} : null;
}
export function davCheckpointCompatible(checkpoint, calendar, window, selected = ['tasks', 'calendar']) {
  return davInventoryCompatible(checkpoint, calendar, selected) && (!calendar.components.includes('VEVENT') || !selected.includes('calendar') || checkpoint.from === window.from && checkpoint.to === window.to);
}
/** An unchanged collection token certifies resource membership independently
 * of the display horizon; only the projected occurrences need regenerating. */
export function davInventoryCompatible(checkpoint, calendar, selected = ['tasks', 'calendar']) {
  const token = checkedDavToken(calendar?.token);
  const required = (calendar?.components || []).filter(component => sources[component] && selected.includes(sources[component]));
  return Boolean(checkpoint && token && checkpoint.href === calendar.href && checkpoint.token?.kind === token.kind && checkpoint.token.value === token.value && checkpoint.readonly === Boolean(calendar.readonly) && required.length && required.every(component => checkpoint.components.includes(component)) && checkpoint.components.every(component => calendar.components.includes(component)));
}

/** Validate a private checkpoint against the exact durable rows it certifies.
 * No parsing, network or framework dependencies. Invalid acceleration metadata
 * is discarded independently of valid user records and drafts.
 */
export function checkedDavCheckpoint(value, {accountKey, serverUrl, records = [], collections = []} = {}) {
  if (!value || value.version !== 1 || value.projectionVersion !== DAV_PROJECTION_VERSION || value.accountKey !== accountKey || !text(accountKey) || !Array.isArray(value.collections) || value.collections.length > 64 || !Array.isArray(records) || !Array.isArray(collections)) return null;
  const recordMap = new Map(), duplicates = new Set(), collectionRecords = new Map();
  for (const record of records) if (record && ['tasks', 'calendar'].includes(record.source) && text(record.identity?.key)) {
    if (recordMap.has(record.identity.key)) duplicates.add(record.identity.key);
    recordMap.set(record.identity.key, record);
    const rows=collectionRecords.get(record.collectionId)||[];rows.push(record);collectionRecords.set(record.collectionId,rows);
  }
  const collectionMap = new Map(collections.map(collection => [collection.id, collection]));
  const hrefs = new Set(), allKeys = new Set();
  let total = 0;const keyCounts={tasks:0,calendar:0};
  const checked = [];
  for (const entry of value.collections) {
    const token = checkedDavToken(entry?.token);
    if (!entry || !text(entry.href) || !entry.href.endsWith('/') || !validResourceLocator({kind:'dav',collection:entry.href,href:entry.href+'checkpoint-validation'},serverUrl) || hrefs.has(entry.href) || !token || typeof entry.readonly !== 'boolean' || !Array.isArray(entry.components) || !entry.components.length || entry.components.length > 2 || !entry.components.every(component => Object.hasOwn(sources, component)) || !unique(entry.components) || !Number.isFinite(entry.from) || !Number.isFinite(entry.to) || entry.from >= entry.to || !Number.isFinite(new Date(entry.from).getTime()) || !Number.isFinite(new Date(entry.to).getTime()) || !Array.isArray(entry.resources) || entry.resources.length > 10000 || (total += entry.resources.length) > 50000) return null;
    hrefs.add(entry.href);
    for (const component of entry.components) if (!collections.some(collection => collection.source === sources[component] && collection.remote?.href === entry.href && Boolean(collection.readonly) === entry.readonly)) return null;
    const resourceHrefs = new Set(), resources = [];
    for (const resource of entry.resources) {
      const locator = {kind: 'dav', collection: entry.href, href: resource?.href};
      if (!validResourceLocator(locator, serverUrl) || resourceHrefs.has(resource.href) || !httpEtag(resource.etag) || resource.etag.startsWith('W/')) return null;
      resourceHrefs.add(resource.href);
      let raw;
      for (const source of ['tasks', 'calendar']) {
        const keys = resource[keyField[source]];
        if (!Array.isArray(keys) || keys.length > 10000 || !keys.every(text) || !unique(keys) || (!entry.components.includes(source === 'tasks' ? 'VTODO' : 'VEVENT') && keys.length)) return null;
        if((keyCounts[source]+=keys.length)>10000)return null;
        for (const key of keys) {
          const record = recordMap.get(key), collection = collectionMap.get(record?.collectionId);
          if (duplicates.has(key) || allKeys.has(key) || !record || record.source !== source || record.identity?.source !== source || record.identity?.locator !== resource.href || record.remote?.href !== resource.href || collection?.source !== source || collection.remote?.href !== entry.href || record.etag !== resource.etag || typeof record.remote?.raw !== 'string' || typeof record.readonly !== 'boolean' || entry.readonly && !record.readonly || raw !== undefined && raw !== record.remote.raw) return null;
          if (raw === undefined && (!record.remote.raw || byteLength(record.remote.raw) > 2 * 1024 * 1024 || !/^\uFEFF?BEGIN:VCALENDAR(?:\r?\n)/i.test(record.remote.raw) || !/(?:\r?\n)END:VCALENDAR\s*$/i.test(record.remote.raw))) return null;
          raw = record.remote.raw; allKeys.add(key);
        }
      }
      resources.push({href: resource.href, etag: resource.etag, taskKeys: [...resource.taskKeys], eventKeys: [...resource.eventKeys]});
    }
    const revisions=new Map(resources.map(resource=>[resource.href,resource.etag]));
    for(const collection of collections)if(collection.remote?.href===entry.href&&entry.components.includes(collection.source==='tasks'?'VTODO':'VEVENT'))for(const record of collectionRecords.get(collection.id)||[]){
      if(revisions.get(record.remote?.href)===record.etag&&!allKeys.has(record.identity.key))return null;
    }
    checked.push({href: entry.href, token, components: [...entry.components], readonly: entry.readonly, from: entry.from, to: entry.to, resources});
  }
  return {version: 1, projectionVersion: DAV_PROJECTION_VERSION, accountKey, collections: checked};
}

/** Metadata is only a scheduling hint; remote inventory remains authoritative. */
export function checkedDavResourceIndex(value, collection, serverUrl) {
  const result = new Map();
  if (!Array.isArray(value)) return result;
  for (const entry of value.slice(0, 10000)) if (validResourceLocator({kind: 'dav', collection, href: entry?.href}, serverUrl) && httpEtag(entry.etag) && !entry.etag.startsWith('W/')) result.set(entry.href, entry.etag);
  return result;
}
