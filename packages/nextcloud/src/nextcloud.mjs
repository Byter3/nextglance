import { utf8, utf8Text, byteLength, bytesEqual, concatBytes, base64, jsonEqual, portableRuntime } from './runtime.mjs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import ICAL from 'ical.js';
import { normalizeColor } from '@nextspace/core/record-presentation.mjs';
import { taskStatusProgress } from '@nextspace/core/status-mapping.mjs';
import { taskCreationOptions } from '@nextspace/core/card-tasks.mjs';
import { DAV_SCAN_LIMITS, davDownloadReservation, roundRobinDavJobs, DavResourceCache } from './dav-scan-policy.mjs';
import { syncDiagnostic } from './sync-diagnostics.mjs';
import {sourceSelection, checkedResourceEntry, validResourceLocator, httpEtag, completeDeckStacks} from './resource-cache-policy.mjs';
import {sanitizeDiagnosticInput} from '@nextspace/core/performance-diagnostics.mjs';
import {DAV_PROJECTION_VERSION, davProjectionWindow, checkedDavToken, checkedDavCheckpoint, davCheckpointCompatible, davInventoryCompatible, checkedDavResourceIndex} from './dav-checkpoint-policy.mjs';
import {calendarContentEquivalent, calendarDeletePreflight} from './calendar-representation.mjs';
import {normalizeEventDetails} from '@nextspace/core/event-details.mjs';
import {eventAlarmDetails, replaceEventReminders} from './event-alarms.mjs';
import {eventMailbox, normalizeEventAttendees, normalizeEventParticipation} from '@nextspace/core/event-scheduling.mjs';
import {eventSchedulingDetails, eventStructureReason, applyEventAuthority, replaceEventAttendees} from './event-scheduling.mjs';
import {mergeDavDelta,davMemberHref,davSyncCollectionBody,davMultigetBody} from './dav-delta-policy.mjs';

const DAY = 86_400_000;
const MAX_BODY = 24 * 1024 * 1024;
const MAX_THEME_IMAGE = 2 * 1024 * 1024;
const MAX_PLANNER_FILE = 8 * 1024 * 1024;
const MAX_PLANNER_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_PLANNER_CACHE_ENTRIES = 32;
function mobileDavContext(isActive = () => true, extra = {}) {
  return {scan: null, isActive, authError: null, cancelError: null, checkActive() {
    if (this.cancelError) throw this.cancelError;
    if (this.authError) throw this.authError;
    if (this.isActive() !== true) throw fail('The calendar refresh was cancelled.', 'CANCELLED');
    if (this.deadline && Date.now() >= this.deadline) throw fail(this.timeoutMessage || 'Source refresh reached its two-minute time budget. Completed resources are saved; retry to continue.', 'TIMEOUT');
  }, ...extra};
}
const xml = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: false, processEntities: true });
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const scalar = value => typeof value === 'object' && value !== null ? value['#text'] ?? '' : value ?? '';
const encode = value => encodeURIComponent(String(value));
const propfind = properties => `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:cs="http://calendarserver.org/ns/"><d:prop>${properties}</d:prop></d:propfind>`;
const isoSeconds = value => value ? new Date(Number(value) * 1000).toISOString() : undefined;
// If-Match uses strong comparison. Never turn a weak or malformed validator
// into a guessed strong one by stripping W/ or adding quotes.
const strongEtag = value => typeof value === 'string' && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value) ? value : null;
function calendarSchedulingFields(calendar, source) {
  if(source!=='calendar')return {};
  const authority=calendar.scheduling;
  return {calendarScheduling:{canInvite:authority?.canInvite===true,...(authority?.organizer?{organizer:authority.organizer}:{}),...(!authority?.canInvite?{reason:authority?.reason||'unknown-identity'}:{})},remote:{href:calendar.href,...(authority?{scheduling:authority}:{})}};
}
// Notes exposes the opaque tag in JSON; its If-Match header must quote it.
// This is separate from DAV, which already returns a complete HTTP validator.
const noteEtag = value => typeof value === 'string' && value.length <= 1000 && !value.startsWith('W/') && value !== '*'
  ? strongEtag(value) || (/^[\x21\x23-\x7e\x80-\xff]+$/.test(value) ? `"${value}"` : null) : null;

function checkedNoteSnapshot(note, nativeId) {
  if (!note || note.error || String(note.id) !== String(nativeId) || !['title', 'content', 'category'].every(key => typeof note[key] === 'string') || !noteEtag(note.etag)) {
    throw fail('The current note could not be read safely. Refresh and review it before saving.', 'CONFLICT');
  }
  return note;
}

function noteRetryPatch(desired, base, latest) {
  if (latest.readonly) throw fail('This note is now read-only on Nextcloud. Your edit has not overwritten it.', 'PERMISSION');
  const patch = {}, conflicts = [];
  for (const [key, value] of Object.entries(desired)) {
    if (value === latest[key]) continue;
    if (typeof base?.[key] !== 'string') conflicts.push(key);
    else if (value === base[key]) continue;
    else if (latest[key] === base[key]) patch[key] = value;
    else conflicts.push(key);
  }
  if (conflicts.length) throw fail(`This note changed on Nextcloud: ${conflicts.join(', ')} ${conflicts.length === 1 ? 'was' : 'were'} edited in both places. Review the current note before saving; your edit is preserved.`, 'CONFLICT', 412);
  return patch;
}
const plannerReadHeaders = { Accept: 'application/json', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' };
const calendarReadHeaders = { Accept: 'text/calendar', 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' };
const xmlText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fileProperties = '<d:displayname/><d:resourcetype/><d:getcontentlength/><d:getcontenttype/><oc:fileid/>';
const filesPropfind = properties => `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:prop>${properties}</d:prop></d:propfind>`;
function cloudFilePath(value = '/') {
  if (typeof value !== 'string' || value.length > 4096 || /^[a-z][a-z\d+.-]*:|[\\\u0000-\u001f\u007f]/i.test(value)) throw fail('Choose a path inside your Nextcloud Files.', 'VALIDATION');
  const parts = value.replace(/^\//, '').replace(/\/$/, '').split('/');
  if (parts.length === 1 && parts[0] === '') return '/';
  if (parts.some(part => !part || part === '.' || part === '..')) throw fail('Choose a path inside your Nextcloud Files.', 'VALIDATION');
  return `/${parts.join('/')}`;
}

function plannerPath(value, directory = false) {
  if (directory && value === '') return [];
  if (typeof value !== 'string' || value.length > 512) throw fail('Invalid planner folder path.', 'VALIDATION');
  const parts = value.split('/');
  if (parts.length > 4 || parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(part) || part === '.' || part === '..')) throw fail('Invalid planner folder path.', 'VALIDATION');
  if (!directory && !parts.at(-1).endsWith('.json')) throw fail('Planner documents must be JSON files.', 'VALIDATION');
  return parts;
}

function plannerBody(document) {
  let body;
  try { body = JSON.stringify(document, null, 2); } catch { throw fail('The planner document cannot be encoded as JSON.', 'VALIDATION'); }
  if (!document || typeof document !== 'object' || Array.isArray(document) || !body || byteLength(body) > MAX_PLANNER_FILE) throw fail('The planner document is invalid or too large.', 'VALIDATION');
  return body;
}

function fail(message, code = 'NEXTCLOUD', status) {
  return Object.assign(new Error(message), { code, ...(status ? { status } : {}) });
}

// Only current destination responses may withdraw session write readiness.
// Local structural/validation failures never imply revoked collection access.
function deniedNativeCollection(message, source, collectionId, status) {
  return Object.assign(fail(message, 'PERMISSION', status),
    typeof collectionId === 'string' && collectionId ? {nativePermissionDenied: {source, collectionId}} : {});
}

export function normalizeServerUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw fail('Enter a valid Nextcloud server URL.', 'VALIDATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw fail('Nextcloud requires HTTPS. HTTP is allowed only on the local computer.', 'VALIDATION');
  if (url.username || url.password || url.search || url.hash) throw fail('Use the server URL without a username, password, query, or fragment.', 'VALIDATION');
  return url.href.replace(/\/+$/, '');
}

function sameOrigin(serverUrl, value) {
  let target;
  try { target = new URL(value, `${serverUrl}/`); } catch { throw fail('Nextcloud returned an invalid URL.', 'SECURITY'); }
  if (target.origin !== new URL(serverUrl).origin || target.username || target.password || target.hash) {
    throw fail('Nextcloud returned a URL outside the configured server. The request was blocked.', 'SECURITY');
  }
  return target.href;
}

function hexColor(value) {
  if (typeof value !== 'string') return undefined;
  if (/^#[\da-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map(c => c + c).join('')}`.toLowerCase();
  return /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value) ? value.slice(0, 7).toLowerCase() : undefined;
}

function serverTheme(capabilities, serverUrl) {
  const theme = capabilities?.theming;
  if (!theme || typeof theme !== 'object') return undefined;
  const result = {};
  if (typeof theme.name === 'string' && theme.name.trim()) result.name = theme.name.slice(0, 200);
  for (const [key, value] of [['color', theme.primaryColor ?? theme.color], ['textColor', theme['color-text']], ['backgroundColor', theme.backgroundColor ?? theme.background], ['backgroundTextColor', theme['background-text']]]) {
    const color = hexColor(value);
    if (color) result[key] = color;
  }
  for (const [key, value] of [['logoUrl', theme.logo], ['backgroundUrl', theme.background]]) {
    if (typeof value !== 'string' || !value || value.startsWith('#')) continue;
    try {
      const url = sameOrigin(serverUrl, value);
      if (new URL(url).protocol === 'https:') result[key] = url;
    } catch { /* Branding must never enable an off-server authenticated request. */ }
  }
  return Object.keys(result).length ? result : undefined;
}

const THEME_COLORS = {
  surfaceColor: '--color-main-background', textColor: '--color-main-text', mutedColor: '--color-text-maxcontrast',
  hoverColor: '--color-background-hover', borderColor: '--color-border', primaryColor: '--color-primary-element',
  primaryTextColor: '--color-primary-element-text', primaryLightColor: '--color-primary-light', primaryLightTextColor: '--color-primary-light-text',
};

function selectedTheme(ids) {
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && /^[a-z-]{1,40}$/.test(id))) return undefined;
  // An enforced theme is prepended by Nextcloud, so the first appearance ID wins.
  return ids.find(id => ['default', 'light', 'dark', 'light-highcontrast', 'highcontrast', 'dark-highcontrast'].includes(id)) ?? (!ids.length ? 'default' : undefined);
}

function themeMode(ids) {
  const selected = selectedTheme(ids);
  return selected?.startsWith('dark') ? 'dark' : selected && selected !== 'default' ? 'light' : selected === 'default' ? 'system' : undefined;
}

function renderedThemeIds(html) {
  const body = /<body\b([^>]*)>/i.exec(html)?.[1];
  // Never infer the user's settings from a login/error page returned as HTTP 200.
  if (!body || !/\bid\s*=\s*(["'])body-(?:user|settings)\1/i.test(body)) return undefined;
  const match = /\bdata-themes\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i.exec(body);
  return match ? (match[1] ?? match[2] ?? match[3]).split(',').filter(Boolean) : undefined;
}

function themeStylesheet(css, serverUrl) {
  // Read only scalar colors from Nextcloud's generated :root block. Remote CSS,
  // selectors, imports, scripts and arbitrary CSS functions never reach the UI.
  const block = /(?:^|})\s*:root\s*\{([^{}]*)\}/i.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1];
  if (!block) return undefined;
  const declarations = new Map(block.split(';').flatMap(declaration => {
    const colon = declaration.indexOf(':');
    return colon < 0 ? [] : [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]];
  }));
  const palette = {};
  for (const [key, variable] of Object.entries(THEME_COLORS)) {
    const color = hexColor(declarations.get(variable));
    if (color) palette[key] = color;
  }
  const result = { palette };
  for (const [key, variable] of [['color', '--color-primary'], ['textColor', '--color-primary-text'], ['backgroundColor', '--color-background-plain'], ['backgroundTextColor', '--color-background-plain-text']]) {
    const color = hexColor(declarations.get(variable));
    if (color) result[key] = color;
  }
  const background = declarations.get('--image-background');
  if (background === 'none') result.backgroundUrl = null;
  else {
    const match = /^url\(\s*(?:'([^'\\]*)'|"([^"\\]*)"|([^\s'"()\\]+))\s*\)$/.exec(background || '');
    if (match) {
      try { result.backgroundUrl = sameOrigin(serverUrl, match[1] ?? match[2] ?? match[3]); }
      catch { /* Off-server wallpaper URLs never receive account credentials. */ }
    }
  }
  return Object.keys(palette).length ? result : undefined;
}

function rasterDataUrl(response) {
  const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  const bytes = response.body;
  const matches = {
    'image/png': bytesEqual(bytes.subarray(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/jpeg': bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/gif': ['GIF87a', 'GIF89a'].includes(utf8Text(bytes.subarray(0, 6))),
    'image/webp': utf8Text(bytes.subarray(0, 4)) === 'RIFF' && utf8Text(bytes.subarray(8, 12)) === 'WEBP',
  };
  if (!Object.hasOwn(matches, mime) || !matches[mime]) throw fail('This image is not a supported PNG, JPEG, GIF or WebP.', 'FORMAT');
  return `data:${mime};base64,${base64(bytes)}`;
}

function pathParts(value, { empty = false, single = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value) || /[\\\u0000-\u001f\u007f]/.test(value)) throw fail('Collectives returned an invalid file path.', 'SECURITY');
  const parts = value.split('/');
  if (value === '' && empty) return [];
  if (parts.some(part => !part || part === '.' || part === '..') || (single && parts.length !== 1)) throw fail('Collectives returned an unsafe file path.', 'SECURITY');
  return parts;
}

async function request(fetcher, serverUrl, target, options = {}) {
  const url = sameOrigin(serverUrl, target);
  const { binary = false, maxBytes = MAX_BODY, allowNotModified = false, checkActive = () => {}, timeoutMs = 25_000, ...fetchOptions } = options;
  const controller = new AbortController();
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timeout = setTimeout(() => { controller.abort(); rejectDeadline(fail('The Nextcloud request timed out. Please try again.', 'TIMEOUT')); }, timeoutMs);
  try {
    checkActive();
    // Native transports can enforce this bound before allocating a bridge body.
    // Standard browser/Node fetch implementations ignore the additional hint.
    const response = await Promise.race([fetcher(url, { ...fetchOptions, maxResponseBytes: maxBytes, redirect: 'manual', signal: controller.signal }), deadline]);
    checkActive();
    if (response.status >= 300 && response.status < 400 && !(allowNotModified && response.status === 304)) throw fail('Nextcloud redirected this request. Use the final HTTPS server URL in connection settings.', 'REDIRECT', response.status);
    // Consume the body inside the timeout, with a size cap even for chunked responses.
    let body = '';
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { value, done } = await Promise.race([reader.read(), deadline]);
        checkActive();
        if (done) break;
        size += value.length;
        if (size > maxBytes) { await reader.cancel(); throw fail('Nextcloud returned too much data for this prototype.', 'LIMIT'); }
        chunks.push(new Uint8Array(value));
      }
      const bytes = concatBytes(chunks, size);
      body = binary ? bytes : utf8Text(bytes);
    } else {
      body = binary ? new Uint8Array(await Promise.race([response.arrayBuffer(), deadline])) : await Promise.race([response.text(), deadline]);
      if (byteLength(body) > maxBytes) throw fail('Nextcloud returned too much data for this prototype.', 'LIMIT');
    }
    checkActive();
    return { status: response.status, headers: response.headers, body };
  } catch (error) {
    checkActive();
    if (error?.code && ['NEXTCLOUD', 'VALIDATION', 'SECURITY', 'REDIRECT', 'LIMIT', 'CANCELLED', 'TIMEOUT'].includes(error.code)) throw error;
    throw fail(controller.signal.aborted ? 'The Nextcloud request timed out. Please try again.' : 'Could not reach Nextcloud. Check the server address, network, and certificate.', controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
  } finally { clearTimeout(timeout); }
}

function assertStatus(response, allowed = []) {
  if (response.status >= 200 && response.status < 300 || allowed.includes(response.status)) return response;
  const status = response.status;
  if (status === 409 || status === 412) throw fail('This item changed on Nextcloud. Refresh before saving again; your changes have not overwritten the server copy.', 'CONFLICT', status);
  if (status === 401) throw fail('Nextcloud rejected this sign-in. Reconnect with a valid app password.', 'AUTH', status);
  if (status === 403) throw fail('Your Nextcloud account does not have permission for this action.', 'PERMISSION', status);
  if (status === 404 || status === 405 || status === 501) throw fail('This Nextcloud app or API is unavailable on the server.', 'UNAVAILABLE', status);
  if (status === 507) throw fail('Nextcloud does not have enough storage to save this item.', 'STORAGE', status);
  throw fail(`Nextcloud could not complete the request (HTTP ${status}).`, 'NEXTCLOUD', status);
}

function jsonBody(response) {
  try { return JSON.parse(response.body); } catch { throw fail('Nextcloud returned an unexpected response instead of JSON.', 'FORMAT'); }
}

function ocsData(response) {
  const body = jsonBody(assertStatus(response));
  const status = Number(body?.ocs?.meta?.statuscode);
  if (![100, 200].includes(status)) {
    assertStatus({ status: status >= 400 ? status : 500 });
  }
  return body.ocs.data;
}

function multistatus(response, uniqueProperty) {
  assertStatus(response);
  if (/<!DOCTYPE|<!ENTITY/i.test(response.body) || XMLValidator.validate(response.body) !== true) throw fail('Nextcloud returned invalid WebDAV XML.', 'FORMAT');
  const parsed = xml.parse(response.body);
  // A valid empty calendar REPORT is an empty multistatus element. The XML
  // parser represents it as an empty string, which is still a valid response.
  if (!Object.hasOwn(parsed, 'multistatus')) throw fail('Nextcloud returned an unexpected WebDAV response.', 'FORMAT');
  return list(parsed.multistatus?.response).map(item => {
    const properties = {};
    let denied = /\s(401|403)(?:\s|$)/.test(String(item.status));
    let unauthorized = /\s401(?:\s|$)/.test(String(item.status));
    let propertySeen = false;
    for (const part of list(item.propstat)) {
      if (uniqueProperty && part.prop && Object.hasOwn(part.prop, uniqueProperty)) {
        if (propertySeen || Array.isArray(part.prop[uniqueProperty])) throw fail('Nextcloud returned conflicting WebDAV properties.', 'FORMAT');
        propertySeen = true;
      }
      if (/\s2\d\d(?:\s|$)/.test(String(part.status))) Object.assign(properties, part.prop);
      if (/\s(401|403)(?:\s|$)/.test(String(part.status))) denied = true;
      if (/\s401(?:\s|$)/.test(String(part.status))) unauthorized = true;
    }
    return { href: String(scalar(item.href)), properties, status: String(scalar(item.status)), denied, unauthorized };
  });
}

export async function beginLogin(serverUrl, { fetch: fetcher = globalThis.fetch } = {}) {
  serverUrl = normalizeServerUrl(serverUrl);
  const response = await request(fetcher, serverUrl, `${serverUrl}/index.php/login/v2`, { method: 'POST', headers: { Accept: 'application/json', 'User-Agent': 'Nextspace/0.1' } });
  const body = jsonBody(assertStatus(response));
  if (typeof body?.poll?.token !== 'string' || typeof body?.login !== 'string' || typeof body?.poll?.endpoint !== 'string') throw fail('Nextcloud did not provide a valid login flow.', 'FORMAT');
  return { serverUrl, loginUrl: sameOrigin(serverUrl, body.login), pollEndpoint: sameOrigin(serverUrl, body.poll.endpoint), token: body.poll.token };
}

export async function pollLogin(flow, { fetch: fetcher = globalThis.fetch } = {}) {
  const serverUrl = normalizeServerUrl(flow.serverUrl);
  const response = await request(fetcher, serverUrl, flow.pollEndpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ token: flow.token }).toString(),
  });
  if (response.status === 404) return { pending: true };
  const body = jsonBody(assertStatus(response));
  if (typeof body?.server !== 'string' || typeof body?.loginName !== 'string' || typeof body?.appPassword !== 'string' || !body.appPassword) throw fail('Nextcloud returned incomplete sign-in information.', 'FORMAT');
  const returnedServer = normalizeServerUrl(body.server);
  sameOrigin(serverUrl, returnedServer);
  return { pending: false, serverUrl: returnedServer, username: body.loginName, appPassword: body.appPassword };
}

// RFC 5545 permits TZID values with a VTIMEZONE definition. If a server omits
// the definition for an IANA zone, use the runtime's time zone database.
const intlZones = new Map();
function ianaZone(tzid) {
  if (intlZones.has(tzid)) return intlZones.get(tzid);
  let format;
  try { format = new Intl.DateTimeFormat('en-GB', { timeZone: tzid, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { throw fail('A calendar uses an unsupported time zone. Open the affected item in Nextcloud.', 'TIMEZONE'); }
  const localAt = instant => {
    const fields = Object.fromEntries(format.formatToParts(new Date(instant)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    return Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  };
  const zone = new ICAL.Timezone({ tzid });
  zone.utcOffset = time => {
    const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
    const offsets = [...new Set([-DAY, 0, DAY].map(delta => (localAt(wall + delta) - wall - delta) / 1000))];
    const matches = offsets.filter(offset => localAt(wall - offset * 1000) === wall);
    // Ambiguous times use the first occurrence; nonexistent times use the
    // offset before the gap, as specified by RFC 5545 section 3.3.5.
    return matches.length ? Math.max(...matches) : offsets[0];
  };
  intlZones.set(tzid, zone);
  return zone;
}

function parseCalendar(raw) {
  let calendar;
  try { calendar = new ICAL.Component(ICAL.parse(raw)); } catch { throw fail('A calendar item could not be parsed.', 'FORMAT'); }
  const embedded = calendar.getTimeZoneByID.bind(calendar);
  calendar.getTimeZoneByID = tzid => embedded(tzid) || (['UTC', 'GMT', 'Z', 'floating'].includes(tzid) ? null : ianaZone(tzid));
  return calendar;
}

/** Derived process-local accounting. A verified warm collection can be adopted
 * without re-encoding every raw document/occurrence on each refresh. */
function davMetadataValue(record) {
  const {raw: _raw,...remote}=record.remote||{};
  return {...record,remote};
}
function davMetadataAccounting(record, previous) {
  const saved=previous?.records.get(record.identity.key),value=davMetadataValue(record);
  if(saved&&jsonEqual(saved.value,value))return saved;
  return {bytes:byteLength(JSON.stringify(value)),value:structuredClone(value)};
}
function davSnapshotUntouched(snapshot) {
  for(const resource of snapshot.checkpoint.resources){
    const saved=snapshot.accounting.get(resource.href);
    for(const key of [...resource.taskKeys,...resource.eventKeys]){
      const record=snapshot.records.get(key),entry=saved?.records.get(key);
      if(!record||!entry||saved.etag!==resource.etag||record.remote?.raw!==saved.raw||!jsonEqual(entry.value,davMetadataValue(record)))return false;
    }
  }
  return true;
}
function davDocumentBytes(raw, previous) {return previous?.raw===raw?previous.rawBytes:byteLength(raw||'');}
function davSnapshot(checkpoint, records, previousAccounting) {
  const flat={tasks:[],calendar:[]}, bytes={tasks:0,calendar:0,both:0}, titles=new Set(),accounting=new Map();
  for(const resource of checkpoint.resources){
    const previous=previousAccounting?.get(resource.href),saved=previous?.etag===resource.etag?previous:undefined;
    const sizes={tasks:0,calendar:0},recordSizes=new Map();let raw,rawBytes=0;
    for(const source of ['tasks','calendar'])for(const key of resource[source==='tasks'?'taskKeys':'eventKeys']){
      const record=records.get(key);
      titles.add(record.collectionTitle);
      if(raw===undefined){raw=record.remote.raw;rawBytes=davDocumentBytes(raw,saved);}
      const measured=davMetadataAccounting(record,saved);
      recordSizes.set(key,measured);sizes[source]+=measured.bytes;flat[source].push(record);
    }
    bytes.tasks+=sizes.tasks+(sizes.tasks?rawBytes:0);bytes.calendar+=sizes.calendar+(sizes.calendar?rawBytes:0);
    bytes.both+=sizes.tasks+sizes.calendar+(sizes.tasks||sizes.calendar?rawBytes:0);
    if(raw!==undefined)accounting.set(resource.href,{etag:resource.etag,raw,rawBytes,records:recordSizes});
  }
  return {checkpoint,records,flat,bytes,accounting,title:titles.size===1?[...titles][0]:undefined};
}

function dateValue(value) {
  if (!value) return undefined;
  return value.isDate ? value.toString() : value.toJSDate().toISOString();
}

function completionDate(value) {
  try {
    const timestamp = typeof value === 'string' ? value : value && !value.isDate ? dateValue(value) : undefined;
    if (typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(timestamp) && Number.isFinite(Date.parse(timestamp))) return new Date(timestamp).toISOString();
  } catch { /* An invalid timestamp does not make a completed item disappear. */ }
}

function tagsOf(component) {
  return component.getAllProperties('categories').flatMap(property => property.getValues()).map(String);
}

function deckLabels(labels) {
  return list(labels).filter(label => nativeNumber(label?.id) && typeof label.title === 'string' && label.title).map(label => ({id: String(label.id), title: label.title, ...(normalizeColor(label.color) ? {color: normalizeColor(label.color)} : {})}));
}

function sameValues(a, b) { return JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort()); }

function isComplexTask(calendar, todo) {
  return calendar.getAllSubcomponents('vtodo').length !== 1 || calendar.hasProperty('method') ||
    ['rrule', 'rdate', 'exdate', 'recurrence-id', 'organizer', 'attendee'].some(name => todo.hasProperty(name));
}

function isComplexEvent(calendar, event) {
  return calendar.getAllSubcomponents('vevent').length !== 1 || calendar.hasProperty('method') ||
    ['rrule', 'rdate', 'exdate', 'recurrence-id', 'organizer', 'attendee'].some(name => event.hasProperty(name));
}

function calendarTime(value, label, dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
  try {
    if (typeof value !== 'string' || !value || dateOnly && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error();
    if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error();
    const parsed = dateOnly ? ICAL.Time.fromDateString(value) : ICAL.Time.fromJSDate(new Date(value), true);
    if (!Number.isFinite(parsed.toJSDate().getTime()) || dateOnly && parsed.toString() !== value) throw new Error();
    return parsed;
  } catch { throw fail(`Enter a valid ${label}.`, 'VALIDATION'); }
}

export function calendarInterval(start, end, allDay) {
  if (typeof allDay !== 'boolean') throw fail('Choose whether the event is all day.', 'VALIDATION');
  const first = calendarTime(start, 'event start', allDay);
  const last = calendarTime(end, 'event end', allDay);
  if (last.compare(first) <= 0) throw fail('The event must end after it starts. All-day end dates are exclusive.', 'VALIDATION');
  return [first, last];
}

function touchCalendarItem(component, now) {
  const stamp = ICAL.Time.fromJSDate(now, true);
  component.updatePropertyWithValue('last-modified', stamp);
  component.updatePropertyWithValue('dtstamp', stamp);
  component.updatePropertyWithValue('sequence', Number(component.getFirstPropertyValue('sequence') || 0) + 1);
}

function replaceCalendarTime(component, name, value) {
  // A former TZID or VALUE parameter must not survive a date type/zone change.
  component.removeAllProperties(name);
  if (value) component.addPropertyWithValue(name, value);
}

function editableCalendarTime(value, label, dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
  const parsed = calendarTime(value, label, dateOnly);
  // JavaScript normalizes dates such as February 30 and midnight 24:00.
  // Drag edits must reject invalid input instead of silently moving it.
  const day = String(value).slice(0, 10);
  if (ICAL.Time.fromDateString(day).toString() !== day || !dateOnly && (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19) || 0) > 59)) throw fail(`Enter a valid ${label}.`, 'VALIDATION');
  return parsed;
}

function writeCalendarBound(component, name, value, fallbackZone) {
  if (!value) { component.removeAllProperties(name); return; }
  const property = component.getFirstProperty(name);
  const previous = property?.getFirstValue();
  if (previous && previous.isDate === value.isDate && (value.isDate ? previous.toString() === value.toString() : previous.toJSDate().getTime() === value.toJSDate().getTime())) return;
  const original = previous || fallbackZone;
  let next = value;
  if (!value.isDate && original && !original.isDate) {
    const zone = original.zone;
    if (zone === ICAL.Timezone.localTimezone) next = ICAL.Time.fromJSDate(value.toJSDate(), false);
    else if (zone && zone.tzid !== 'UTC') {
      const instant = value.toJSDate().getTime();
      next = value.convertToZone(zone);
      if (next.toJSDate().getTime() !== instant) {
        // Check both sides of a daylight-saving boundary rather than trusting
        // a wall-time offset lookup made with UTC clock fields.
        const offsets = [...new Set([-2, -1, 0, 1, 2].map(days => zone.utcOffset(ICAL.Time.fromJSDate(new Date(instant + days * DAY), true))))];
        next = offsets.map(offset => { const candidate = ICAL.Time.fromJSDate(new Date(instant + offset * 1000), true); candidate.zone = zone; return candidate; }).find(candidate => candidate.toJSDate().getTime() === instant);
        if (!next) throw fail('This time cannot be represented unambiguously in the item’s original time zone. Choose another time or edit it in Nextcloud.', 'TIMEZONE');
      }
    }
  }
  const target = property || component.addProperty(new ICAL.Property(name));
  target.removeParameter('tzid');
  if (!next.isDate && next.zone && ![ICAL.Timezone.localTimezone, ICAL.Timezone.utcTimezone].includes(next.zone) && next.zone.tzid !== 'UTC') target.setParameter('tzid', next.zone.tzid);
  target.setValue(next);
}

function validNativeInterval(start, finish, label, allowEmpty = false) {
  if (!start || !finish) return;
  const order = start.isDate && finish.isDate ? finish.compare(start) : finish.toJSDate().getTime() - start.toJSDate().getTime();
  if (start.isDate !== finish.isDate || (allowEmpty ? order < 0 : order <= 0)) throw fail(`${label} must use matching date types and finish after it starts.`, 'VALIDATION');
}

function nativeNumber(value) { return /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0; }

function deckAssignments(card) {
  if (!Array.isArray(card.assignedUsers)) return { assigneeIds: [], assignmentKnown: false, assignmentCount: 0 };
  let known = true;
  const ids = [];
  for (const assignment of card.assignedUsers) {
    if (!assignment || typeof assignment !== 'object') { known = false; continue; }
    // Old Deck user assignments omit type; modern group/circle/remote entries
    // are not personal assignments, and must not look like unassigned cards.
    const type = assignment.type == null ? 0 : Number(assignment.type);
    const participant = assignment.participant;
    const uid = typeof participant === 'string' ? participant : participant?.uid ?? participant?.primaryKey;
    if (!Number.isInteger(type) || typeof uid !== 'string' || !uid) { known = false; continue; }
    if (type === 0) ids.push(uid);
  }
  return { assigneeIds: [...new Set(ids)], assignmentKnown: known, assignmentCount: card.assignedUsers.length };
}

export class NextcloudClient {
  #fetch;
  #authorization;
  #now;
  #runtime;
  #davReadMode;
  #fileLookupMode;
  #accountUser;
  #themeImage;
  #plannerDirectories = new Set();
  #plannerJsonCache = new Map();
  #plannerJsonBytes = 0;
  #plannerJsonEpoch = 0;
  #deckAttachments = new Map();
  #noteTags = new Map();
  #attachmentReads = new Map();
  #noteTagReads = new Map();
  #knownDeckAttachments = new Set();
  #davResources = new DavResourceCache();
  #resourceCache;
  #cacheEpoch = 0;
  #onDiagnostic;
  #davRetry = new Set();
  #davSnapshots = new Map();
  // Acceleration only: writes remove certification but need not force every
  // unchanged item through iCalendar parsing on the following inventory.
  #davStaleSnapshots = new Map();
  #davEpoch = 0;
  #davAccountKey;
  #davNoDelta = new Set();
  #davNoMultiget = new Set();
  #revokedResources = new Set();

  /**
   * Delegated authentication is for a host-owned authenticated transport such as
   * Nextcloud Android SSO. Its account password never enters this client.
   * @param {{serverUrl: string, username: string, appPassword?: string, accountUser?: string}} credentials
   * @param {{fetch?: (url: string, options: any) => Promise<any>, now?: () => Date, runtime?: {sha256: (value: string) => string, randomUUID: () => string}, authentication?: 'password'|'delegated', davReadMode?: 'report'|'propfind-get', fileLookupMode?: 'search'|'notes-propfind', accountKey?:string, resourceCache?: {get: Function, getMany?: Function, list?:Function, put: Function, remove: Function, prune: Function, retainCollections: Function, clear: Function}}} [options]
   */
  constructor(credentials, options = {}) {
    const {serverUrl, username, appPassword, accountUser} = credentials;
    const {fetch: fetcher, now = () => new Date(), runtime = portableRuntime, authentication = 'password', davReadMode = 'report', fileLookupMode = 'search'} = options;
    this.serverUrl = normalizeServerUrl(serverUrl);
    if (!['password', 'delegated'].includes(authentication)) throw fail('Unsupported Nextcloud authentication mode.', 'VALIDATION');
    if (!['report', 'propfind-get'].includes(davReadMode)) throw fail('Unsupported calendar read mode.', 'VALIDATION');
    if (!['search', 'notes-propfind'].includes(fileLookupMode)) throw fail('Unsupported note file lookup mode.', 'VALIDATION');
    if (typeof username !== 'string' || !username.trim() || username.includes(':') || authentication === 'password' && (typeof appPassword !== 'string' || !appPassword)) throw fail('Enter your Nextcloud username and an app password.', 'VALIDATION');
    if (authentication === 'delegated' && (typeof fetcher !== 'function' || appPassword !== undefined)) throw fail('Delegated sign-in requires a native authenticated transport and no app password.', 'VALIDATION');
    if (typeof runtime?.sha256 !== 'function' || typeof runtime?.randomUUID !== 'function') throw fail('The Nextcloud runtime is incomplete.', 'VALIDATION');
    this.username = typeof accountUser === 'string' && accountUser ? accountUser : username;
    this.#accountUser = typeof accountUser === 'string' && accountUser ? accountUser : null;
    this.#authorization = authentication === 'password' ? `Basic ${base64(utf8(`${username}:${appPassword}`))}` : undefined;
    this.#fetch = fetcher ?? globalThis.fetch;
    this.#now = now;
    this.#runtime = runtime;
    this.#davReadMode = davReadMode;
    this.#fileLookupMode = fileLookupMode;
    if(options.accountKey!==undefined&&(typeof options.accountKey!=='string'||!options.accountKey||options.accountKey.length>16384||/[\u0000-\u001f]/.test(options.accountKey)))throw fail('The device cache account key is invalid.','VALIDATION');
    this.#davAccountKey = options.accountKey ?? JSON.stringify([this.serverUrl, this.username]);
    this.#onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : undefined;
    if (options.resourceCache && !['get', 'put', 'remove', 'prune', 'retainCollections', 'clear'].every(name => typeof options.resourceCache[name] === 'function')) throw fail('The resource cache port is incomplete.', 'VALIDATION');
    this.#resourceCache = options.resourceCache;
    this.capabilities = {};
    this.discovered = false;
  }

  id(source, native) {
    const account = this.#runtime.sha256(`${this.serverUrl}\0${this.username}`).slice(0, 16);
    return `${account}:${source}:${native}`;
  }

  identity(source, native, locator, aliases = []) {
    const key = this.id(source, native);
    return { source, key, ...(locator ? { locator } : {}), aliases: [...new Set([key, ...aliases])] };
  }

  url(path) { return `${this.serverUrl}/${path.replace(/^\//, '')}`; }

  primeDavState({accountKey, records, collections, checkpoint} = {}) {
    this.#davSnapshots.clear(); this.#davStaleSnapshots.clear(); this.#davEpoch++;
    if (accountKey !== this.#davAccountKey) return false;
    const checked = checkedDavCheckpoint(checkpoint, {accountKey, serverUrl: this.serverUrl, records, collections});
    if (!checked) return false;
    const rows = new Map(records.filter(record => record?.identity?.key).map(record => [record.identity.key, record]));
    for (const entry of checked.collections) this.#davSnapshots.set(entry.href, davSnapshot(entry, new Map(entry.resources.flatMap(resource => [...resource.taskKeys, ...resource.eventKeys]).map(key => [key, rows.get(key)]))));
    return true;
  }

  davCheckpoint() {
    const collections=[],counts={tasks:0,calendar:0};let resources=0;
    // Independent source-family passes can leave several valid older baselines.
    // Acceleration metadata is bounded independently of the retained user data.
    for(const value of [...this.#davSnapshots.values()].reverse()){
      if(collections.length>=64||resources+value.checkpoint.resources.length>50000||['tasks','calendar'].some(source=>counts[source]+value.flat[source].length>10000))continue;
      collections.push(structuredClone(value.checkpoint));resources+=value.checkpoint.resources.length;for(const source of ['tasks','calendar'])counts[source]+=value.flat[source].length;
    }
    return {version: 1, projectionVersion: DAV_PROJECTION_VERSION, accountKey: this.#davAccountKey, collections};
  }

  primeFileMetadata(records) {
    // Resume periodic refresh of already-discovered native file metadata after
    // restarting the desktop app, without fetching tags on every unseen note.
    for (const record of records || []) {
      const id = String(record.remote?.nativeId ?? '');
      if (!nativeNumber(id)) continue;
      if (record.source === 'notes' && Array.isArray(record.fileTags) && !this.#noteTags.has(id)) this.#noteTags.set(id, structuredClone(record.fileTags));
      if (record.source === 'deck' && record.attachmentFileIds?.length) this.#knownDeckAttachments.add(id);
    }
  }

  async request(target, options = {}) {
    const response = await request(this.#fetch, this.serverUrl, target, { priority: 'high', ...options, headers: { Accept: 'application/json', 'OCS-APIRequest': 'true', ...options.headers, ...(this.#authorization ? {Authorization: this.#authorization} : {}) } });
    if (response.status >= 200 && response.status < 300 && ['PUT', 'POST', 'DELETE', 'PATCH', 'MOVE'].includes(options.method)) {
      const href = sameOrigin(this.serverUrl, target), url = new URL(href);
      this.#plannerJsonEpoch++;
      this.#forgetPlannerJson(href);
      if (url.pathname.includes('/remote.php/dav/calendars/')) {
        const collection = href.slice(0, href.lastIndexOf('/') + 1);
        if (this.#davSnapshots.has(collection)) this.#davStaleSnapshots.set(collection, this.#davSnapshots.get(collection));
        this.#davSnapshots.delete(collection); this.#davEpoch++;
        this.#davResources.remove(collection, href);
        await this.resourceOperation('remove', {kind: 'dav', collection, href});
      }
      const board = /^(.*\/index\.php\/apps\/deck\/api\/v1\.0\/boards\/\d+)(?:\/|$)/.exec(href);
      if (board) await this.resourceOperation('remove', {kind: 'deck', collection: board[1], href: `${board[1]}/stacks`});
    }
    return response;
  }

  sourceRequest(context, target, options = {}) {
    context?.checkActive();
    return this.request(target, {...options, ...(context ? {priority:'low', checkActive: () => context.checkActive(), timeoutMs: Math.max(1, Math.min(25_000, (context.deadline || Infinity) - Date.now()))} : {})});
  }

  diagnostic(value) {if (this.#onDiagnostic) {const safe=sanitizeDiagnosticInput(value);if(safe) try {this.#onDiagnostic(safe);} catch { /* Diagnostics never control sync. */ }}}

  async resourceOperation(method, value, context) {
    if (!this.#resourceCache) return null;
    context?.checkActive();
    let timer;const reading=['get','getMany','list'].includes(method);
    try {
      const result = await Promise.race([this.#resourceCache[method](value), new Promise((_, reject) => { timer = setTimeout(() => reject(fail('The device resource cache timed out.', reading ? 'CACHE_READ_FAILED' : 'CACHE_WRITE_FAILED')), Math.max(1, Math.min(25_000, (context?.deadline || Infinity) - Date.now()))); })]);
      context?.checkActive();
      return result;
    } catch (error) {
      context?.checkActive();
      if (error?.code === 'CANCELLED') throw error;
      if (context) context.cacheWarning = {errorCode: reading ? 'CACHE_READ_FAILED' : 'CACHE_WRITE_FAILED', errorStage: 'local-cache', message: reading ? 'Native sources are available, but the device resource cache could not be read. Check device storage and retry.' : 'Native sources are available, but the device resource cache could not be saved. Check device storage and retry.'};
      return null;
    } finally { clearTimeout(timer); }
  }

  async cachedResource(locator, context, supplied, expectedEtag) {
    if (!this.#resourceCache || !validResourceLocator(locator, this.serverUrl)) return null;
    const entry = checkedResourceEntry(supplied === undefined ? await this.resourceOperation('get', locator, context) : supplied, locator, this.serverUrl);
    if (entry && expectedEtag && entry.etag !== expectedEtag) return null;
    if (entry?.kind === 'dav') {
      try { return {...entry, parsed:parseCalendar(entry.body)}; } catch { await this.resourceOperation('remove', locator, context); return null; }
    }
    return entry;
  }

  async saveResource(locator, etag, body, context) {
    const epoch = this.#cacheEpoch;
    const entry = checkedResourceEntry({version: 1, ...locator, etag, body, bytes: byteLength(body)}, locator, this.serverUrl);
    if (!entry || this.#revokedResources.has(locator.collection)) return;
    context?.checkActive();
    try { await this.resourceOperation('put', entry, context); }
    finally { if (epoch !== this.#cacheEpoch || this.#revokedResources.has(locator.collection) || context?.isActive() === false) await this.resourceOperation('remove', locator); }
    context?.checkActive();
  }

  async revokeResources(kind, collection, context) {
    this.#cacheEpoch++;
    if (!kind || kind === 'dav') { this.#davEpoch++; if (collection) {this.#davSnapshots.delete(collection);this.#davStaleSnapshots.delete(collection);} else {this.#davSnapshots.clear();this.#davStaleSnapshots.clear();} }
    if (collection) {
      this.#revokedResources.add(collection);
      if (kind === 'dav') this.#davResources.deleteCollection(collection);
      await this.resourceOperation('prune', {kind, collection, hrefs: []});
    } else { this.#davResources.clear(); await this.resourceOperation('clear'); }
    context?.checkActive();
  }

  async revokeSourceResources(source) {
    const kind = ['tasks', 'calendar'].includes(source) ? 'dav' : source === 'deck' ? 'deck' : null;
    if (!kind) return;
    this.#cacheEpoch++;
    if (kind === 'dav') {this.#davResources.clear();this.#davSnapshots.clear();this.#davStaleSnapshots.clear();this.#davEpoch++;}
    await this.resourceOperation('retainCollections', {kind, collections: []});
  }

  async refreshCapabilities(context) {
    const caps = await this.sourceRequest(context, this.url('ocs/v2.php/cloud/capabilities?format=json'));
    // Some servers restrict capabilities without restricting the source apps.
    if ([403, 404].includes(caps.status)) return false;
    this.capabilities = ocsData(caps)?.capabilities ?? {};
    return true;
  }

  async readTheme(context) {
    const capability = this.capabilities?.theming;
    if (!capability || typeof capability !== 'object') { this.#themeImage = undefined; return { theme: undefined }; }
    const theme = serverTheme(this.capabilities, this.serverUrl) || {};
    let transientFailure = false;
    const optional = async work => {
      try { context?.checkActive(); const result = await work(); context?.checkActive(); return result; }
      catch (error) {
        // Missing/restricted optional endpoints do not affect source syncing.
        // A temporary outage must not erase the last usable cached appearance.
        if (['CANCELLED', 'TIMEOUT'].includes(error.code)) throw error;
        if (error.code === 'NETWORK' || error.code === 'NEXTCLOUD') transientFailure = true;
        return undefined;
      }
    };
    let enabled = Array.isArray(capability.enabledThemes) ? capability.enabledThemes : undefined;
    if (themeMode(enabled) === undefined) {
      enabled = await optional(async () => {
        const page = assertStatus(await this.request(this.url('index.php/settings/user/theming'), { maxBytes: 2 * 1024 * 1024, headers: { Accept: 'text/html' } }));
        return renderedThemeIds(page.body);
      });
    }
    const mode = themeMode(enabled);
    if (mode) theme.mode = mode;
    const highContrast = selectedTheme(enabled)?.includes('highcontrast');
    if (typeof highContrast === 'boolean') theme.highContrast = highContrast;
    const cacheBuster = typeof capability.cacheBuster === 'string' && /^[a-z\d-]{1,80}$/i.test(capability.cacheBuster) ? capability.cacheBuster : undefined;
    const [light, dark] = await Promise.all([
      highContrast ? 'light-highcontrast' : 'default',
      highContrast ? 'dark-highcontrast' : 'dark',
    ].map(id => optional(async () => {
      const query = new URLSearchParams({ plain: '1', ...(cacheBuster ? { v: cacheBuster } : {}) });
      const sheet = assertStatus(await this.request(this.url(`index.php/apps/theming/theme/${id}.css?${query}`), { maxBytes: 256 * 1024, headers: { Accept: 'text/css' } }));
      return themeStylesheet(sheet.body, this.serverUrl);
    })));
    if (light) theme.light = light.palette;
    if (dark) theme.darkPalette = dark.palette;
    const selected = mode === 'dark' ? dark : light;
    if (selected) {
      for (const key of ['color', 'textColor', 'backgroundColor', 'backgroundTextColor']) if (selected[key]) theme[key] = selected[key];
      if (selected.backgroundUrl === null) delete theme.backgroundUrl;
      else if (selected.backgroundUrl) theme.backgroundUrl = selected.backgroundUrl;
    }
    if (theme.backgroundUrl) {
      const image = await optional(async () => {
        const target = new URL(theme.backgroundUrl);
        if (cacheBuster && !target.searchParams.has('v')) target.searchParams.set('v', cacheBuster);
        if (this.#themeImage?.url !== target.href) this.#themeImage = undefined;
        const cached = this.#themeImage;
        try {
          const response = assertStatus(await this.request(target.href, {
            binary: true, maxBytes: MAX_THEME_IMAGE, allowNotModified: Boolean(cached),
            headers: {
              Accept: 'image/png, image/jpeg, image/gif, image/webp',
              ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
              ...(cached?.lastModified ? { 'If-Modified-Since': cached.lastModified } : {}),
            },
          }), cached ? [304] : []);
          if (response.status === 304) return cached.dataUrl;
          const dataUrl = rasterDataUrl(response);
          const validator = name => {
            const value = response.headers.get(name);
            return value && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
          };
          this.#themeImage = { url: target.href, dataUrl, etag: validator('ETag'), lastModified: validator('Last-Modified') };
          return dataUrl;
        } catch (error) {
          if (!['NETWORK', 'NEXTCLOUD'].includes(error.code)) this.#themeImage = undefined;
          throw error;
        }
      });
      if (image) theme.backgroundDataUrl = image;
    } else this.#themeImage = undefined;
    return transientFailure ? {} : { theme: Object.keys(theme).length ? theme : undefined };
  }

  async discover(context, {includeTheme = true} = {}) {
    const identity = ocsData(await this.sourceRequest(context, this.url('ocs/v2.php/cloud/user?format=json')));
    if (typeof identity?.id !== 'string' || !identity.id) throw fail('Nextcloud did not return your account identity.', 'FORMAT');
    if (this.#accountUser && identity.id !== this.#accountUser) throw fail('Saved sign-in information now identifies a different Nextcloud account. Reconnect before syncing.', 'IDENTITY');
    this.username = identity.id;
    this.#accountUser = identity.id;
    const themeAvailable = await this.refreshCapabilities(context);
    this.discovered = true;
    return { username: this.username, capabilities: this.capabilities, ...(themeAvailable && includeTheme ? await this.readTheme(context) : {}) };
  }

  davCollections(sources, available) {
    return sources.flatMap(source => available.filter(calendar => calendar.components.includes(source === 'tasks' ? 'VTODO' : 'VEVENT')).map(calendar => ({
      id: this.id(source, calendar.href), source, title: calendar.title, readonly: Boolean(calendar.readonly),
      ...(hexColor(calendar.color) ? {color: hexColor(calendar.color)} : {}),
      remote: {href: calendar.href}, ...calendarSchedulingFields(calendar, source),
    })));
  }

  /** Verify current targets without reading source bodies or certifying content.
   * The host still needs durable records and native per-write revision checks. */
  async readSourceAccess({sources = ['tasks', 'calendar', 'deck'], isActive = () => true, onCollections} = {}) {
    const selected = sourceSelection(sources);
    if (selected.some(source => !['tasks', 'calendar', 'deck'].includes(source))) throw fail('Choose Calendar, Tasks or Deck to verify current source access.', 'VALIDATION');
    const context = mobileDavContext(isActive, {deadline: Date.now() + 30_000, timeoutMessage: 'Checking source access timed out. Saved data is preserved; retry to verify access.'});
    const failure = async (names, error) => {
      if (error.code === 'CANCELLED') throw error;
      if (['AUTH', 'IDENTITY'].includes(error.code)) context.authError ||= error;
      else if (error.code === 'PERMISSION') {
        // Tasks and Calendar share one DAV authority boundary and cache.
        if (names.some(source => ['tasks', 'calendar'].includes(source))) await this.revokeSourceResources('calendar');
        if (names.includes('deck')) await this.revokeSourceResources('deck');
      }
      const code = error.code === 'IDENTITY' ? 'IDENTITY' : syncDiagnostic(error, 'discovery').errorCode || 'UNKNOWN';
      return {sources: names, collections: [], errors: names.map(source => ({source, code, message: code === 'UNKNOWN' ? 'Source access could not be verified. Retry when the connection is available.' : error.message, ...(['AUTH', 'IDENTITY', 'PERMISSION'].includes(code) ? {permissionDenied: true} : {})}))};
    };
    const verify = async (names, discover) => {
      try {
        context.checkActive();
        const collections = await discover();
        context.checkActive();
        if (new Set(collections.map(collection => collection.id)).size !== collections.length) throw fail('Nextcloud returned duplicate source collections. Retry to verify current access.', 'FORMAT');
        if (typeof onCollections === 'function') {try {onCollections({sources: names, collections});} catch { /* Observers cannot fail access verification. */ }}
        return {sources: names, collections, errors: []};
      } catch (error) {return failure(names, error);}
    };
    let results;
    try {
      context.checkActive();
      // Recheck identity on each foreground access pass; a prior process or
      // public launch checkpoint cannot certify the current authorized user.
      await this.discover(context, {includeTheme: false});
      context.checkActive();
      const davSources = selected.filter(source => ['tasks', 'calendar'].includes(source));
      results = await Promise.all([
        ...(davSources.length ? [verify(davSources, async () => this.davCollections(davSources, await this.discoverCalendars(() => context.checkActive(), context)))] : []),
        ...(selected.includes('deck') ? [verify(['deck'], async () => (await this.discoverDeckBoards(context)).map(board => this.deckCollection(board)))] : []),
      ]);
    } catch (error) {results = [await failure(selected, error)];}
    if (!isActive()) throw fail('The source access check was cancelled.', 'CANCELLED');
    if (context.authError) {
      this.discovered = false;
      await this.revokeResources();
      return {collections: [], verifiedSources: [], errors: (await failure(selected, context.authError)).errors};
    }
    const errors = results.flatMap(result => result.errors);
    return {
      collections: selected.flatMap(source => results.flatMap(result => result.collections.filter(collection => collection.source === source))),
      verifiedSources: selected.filter(source => !errors.some(error => error.source === source)),
      errors: selected.flatMap(source => errors.filter(error => error.source === source)),
    };
  }

  async readAll({sources, isActive = () => true, onProgress, onSource, onCollections, calendarHistoryDays, calendarWindow} = {}) {
    const selected = sourceSelection(sources);
    let lastProgress = 0;
    const progress = (group, stage, completed, total, message, force = false) => {
      if (typeof onProgress !== 'function' || !isActive() || !force && Date.now() - lastProgress < 150) return;
      lastProgress = Date.now();
      try { onProgress({sources: group, stage, completed, ...(total !== undefined ? {total} : {}), message}); } catch { /* Observers never change source results. */ }
    };
    const publishCollections = value => {
      if (typeof onCollections === 'function' && isActive()) {
        try { onCollections(value); } catch { /* Observers cannot change native authority. */ }
      }
    };
    const projectionWindow = calendarHistoryDays !== undefined || calendarWindow !== undefined ? davProjectionWindow(this.#now().getTime(), {calendarHistoryDays, calendarWindow}) : undefined;
    const davContext = mobileDavContext(isActive, {deadline: Date.now() + 120_000, selected, progress, publishCollections, projectionWindow});
    davContext.checkActive();
    const stamp = this.#now().toISOString();
    const errorStatus = (source, error, stage = 'source-read') => {
      if (error.code === 'CANCELLED') { if (davContext) davContext.cancelError = error; throw error; }
      if (error.code === 'AUTH') { this.#davResources.clear(); davContext.authError = error; }
      const diagnostic = syncDiagnostic(error, stage);
      return { source, state: error.code === 'UNAVAILABLE' ? 'unavailable' : 'error', count: 0, message: diagnostic.errorCode ? error.message : 'This source could not be read. Try refreshing.', ...diagnostic, ...(['AUTH', 'PERMISSION'].includes(error.code) ? { permissionDenied: true } : {}) };
    };
    const discoveryFailure = error => {
      const denied = ['AUTH', 'PERMISSION'].includes(error.code);
      if (denied) this.#themeImage = undefined;
      return { records: [], collections: [], statuses: selected.map(source => errorStatus(source, error, 'discovery')), davCheckpoint: this.davCheckpoint(), ...(denied ? { theme: undefined } : {}) };
    };
    let themeResult = {};
    progress(selected, 'discovery', 0, undefined, 'Checking Nextcloud source access', true);
    if (!this.discovered) {
      try {
        const discovery = await this.discover(davContext);
        if (Object.hasOwn(discovery, 'theme')) themeResult = { theme: discovery.theme };
      }
      catch (error) { if (['AUTH', 'PERMISSION'].includes(error.code)) await this.revokeResources(); return discoveryFailure(error); }
    } else {
      try { if (await this.refreshCapabilities(davContext)) themeResult = await this.readTheme(davContext); }
      catch (error) {
        if (error.code === 'CANCELLED') throw error;
        if (error.code === 'AUTH') { await this.revokeResources(); return discoveryFailure(error); }
        // A temporary branding failure must not hide otherwise readable sources
        // or erase the previous theme. An absent theme field means keep it.
      }
    }
    davContext.checkActive();
    const publish = result => {
      if (typeof onSource === 'function' && isActive()) {try {onSource({records:result.records,collections:result.collections,statuses:[result.status],davCheckpoint:this.davCheckpoint()});} catch { /* A presentation observer cannot change source results. */ }}
      this.diagnostic({kind:'source',source:result.status.source,stage:result.status.state === 'connected' ? 'finish' : 'error',count:result.records.length,success:result.status.state === 'connected',code:result.status.errorCode});
      return result;
    };
    const collect = async (source, read) => {
      try {
        davContext.checkActive();
        const result = await read();
        return publish({ ...result, status: { source, state: result.warning ? 'error' : 'connected', count: result.records.length, ...(!result.warning ? {lastSyncedAt: stamp} : {}), ...(result.warning || result.message ? { message: result.warning || result.message } : {}), ...(result.warning ? syncDiagnostic({code: result.errorCode}, 'source-read') : {}), ...(result.metadataStale ? {metadataStale: true} : {}), ...(result.revokedCollectionIds?.length ? { revokedCollectionIds: result.revokedCollectionIds } : {}) } });
      } catch (error) {
        if (error.code === 'PERMISSION') await this.revokeSourceResources(source);
        return publish({ records: [], collections: [], status: errorStatus(source, error) });
      }
    };
    // Android's Files SSO supports PROPFIND + GET, not REPORT. Share bounded
    // downloads between task/event projections of the same calendar resources.
    davContext.checkActive();
    const dav = selected.some(source => ['tasks', 'calendar'].includes(source)) ? this.discoverCalendars(() => davContext.checkActive(), davContext).then(available => {
      davContext.checkActive();
      // Permission discovery is complete before potentially large resource
      // scans. Publish only authority, never pretend the content is refreshed.
      if (typeof onCollections === 'function') {
        const sources = selected.filter(source => ['tasks', 'calendar'].includes(source));
        const collections = this.davCollections(sources, available);
        publishCollections({sources, collections});
      }
      return available;
    }) : null;
    const readers = {tasks: async () => this.readDav('tasks', await dav, davContext), calendar: async () => this.readDav('calendar', await dav, davContext), notes: () => this.readNotes(davContext), deck: () => this.readDeck(davContext), collectives: () => this.readCollectives(davContext)};
    const results = await Promise.all(selected.map(source => collect(source, readers[source])));
    // Authentication failures are source status results; cancellation instead
    // abandons the whole obsolete read so no partial result can be adopted.
    if (!isActive()) throw fail('The source refresh was cancelled.', 'CANCELLED');
    if (davContext.authError) await this.revokeResources();
    progress(selected, 'source-read', selected.length, selected.length, 'Source check finished', true);
    return { records: results.flatMap(r => r.records), collections: results.flatMap(r => r.collections), statuses: results.map(r => r.status), davCheckpoint:this.davCheckpoint(), ...themeResult, ...(davContext.cacheWarning ? {cacheWarning: davContext.cacheWarning} : {}) };
  }

  async readNotes(context) {
    const records = new Map();
    const categories = new Map();
    const seenCursors = new Set();
    let cursor = '';
    for (let page = 0; page < 200; page++) {
      const params = new URLSearchParams({ chunkSize: '200', ...(cursor ? { chunkCursor: cursor } : {}) });
      const response = assertStatus(await this.sourceRequest(context, this.url(`index.php/apps/notes/api/v1/notes?${params}`)));
      const versionHeader = response.headers.get('X-Notes-API-Versions');
      const versions = versionHeader ? versionHeader.split(',').map(v => v.trim()) : this.capabilities.notes?.api_version;
      const safeUpdates = !Array.isArray(versions) || versions.some(v => /^1\.(\d+)$/.test(v) && Number(v.split('.')[1]) >= 2);
      const notes = jsonBody(response);
      if (!Array.isArray(notes)) throw fail('Notes returned an unexpected list format.', 'FORMAT');
      for (const note of notes) {
        if (note.id == null) continue;
        const category = String(note.category ?? '');
        const collectionId = this.id('notes', `category:${category}`);
        categories.set(collectionId, { id: collectionId, source: 'notes', title: category || 'Uncategorized (default)', remote: { category } });
        const fileTags = this.#noteTags.get(String(note.id));
        records.set(String(note.id), { id: this.id('notes', note.id), source: 'notes', kind: 'note', fileId: String(note.id), title: note.title || 'Untitled note', body: note.content ?? '', url: this.url(`index.php/apps/notes/#/note/${encode(note.id)}`), collectionId, collectionTitle: category || 'Uncategorized (default)', updatedAt: isoSeconds(note.modified), readonly: Boolean(note.readonly) || !note.etag || !safeUpdates, etag: note.etag, tags: [...(note.favorite ? ['Favorite'] : []), ...(fileTags || []).map(tag => tag.title)], ...(fileTags ? {fileTags, tagDetails: fileTags} : {}), identity: this.identity('notes', note.id, this.url(`index.php/apps/notes/api/v1/notes/${encode(note.id)}`)), remote: { nativeId: note.id, category } });
      }
      cursor = response.headers.get('X-Notes-Chunk-Cursor') || '';
      if (!cursor) {
        const loaded = [...records.values()], known = loaded.filter(record => this.#noteTags.has(record.fileId));
        let tagFailure = false;
        // Refresh only tags that were opened before, in bounded batches. Do not
        // add one Files request per unseen note to every background sync.
        for (let i = 0; i < known.length; i += 4) await Promise.all(known.slice(i, i + 4).map(async record => {
          context?.checkActive();
          const epoch = this.#noteTagReads.get(record.fileId) ?? 0;
          try {
            let tags = await this.fileTags(`systemtags-relations/files/${encode(record.fileId)}`, '1', context);
            if (epoch === (this.#noteTagReads.get(record.fileId) ?? 0)) this.#noteTags.set(record.fileId, tags);
            else tags = this.#noteTags.get(record.fileId) ?? tags;
            record.fileTags = tags; record.tagDetails = tags; record.tags = [...(record.tags.includes('Favorite') ? ['Favorite'] : []), ...tags.map(tag => tag.title)];
          } catch (error) { if (['AUTH', 'CANCELLED', 'TIMEOUT'].includes(error.code)) throw error; tagFailure = true; }
        }));
        return { records: loaded, collections: [...categories.values()], ...(tagFailure ? {metadataStale: true, message: 'Notes loaded, but some file tags could not be refreshed. Open the note to retry.'} : {}) };
      }
      if (seenCursors.has(cursor)) throw fail('Notes returned a repeated pagination cursor. Refresh to try again.', 'FORMAT');
      seenCursors.add(cursor);
    }
    throw fail('The Notes list exceeded the prototype pagination limit.', 'LIMIT');
  }

  async discoverCalendars(checkActive = () => {}, context) {
    checkActive();
    const principalResponse = multistatus(await this.sourceRequest(context, this.url('remote.php/dav/'), { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: propfind('<d:current-user-principal/>') }));
    checkActive();
    const principal = principalResponse.map(r => scalar(r.properties['current-user-principal']?.href)).find(Boolean);
    if (!principal) throw fail('Nextcloud did not expose a CalDAV principal for this account.', principalResponse.some(r => r.denied) ? 'PERMISSION' : 'UNAVAILABLE');
    const principalUrl = sameOrigin(this.serverUrl, principal);
    const homes = multistatus(await this.sourceRequest(context, principalUrl, { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml' }, body: propfind('<c:calendar-home-set/><c:calendar-user-address-set/><c:schedule-outbox-URL/><d:displayname/>') }));
    checkActive();
    const home = homes.flatMap(r => list(r.properties['calendar-home-set']?.href)).map(scalar).find(Boolean);
    if (!home) throw fail('Nextcloud did not expose a calendar home for this account.', homes.some(r => r.denied) ? 'PERMISSION' : 'UNAVAILABLE');
    const principalProperties = homes.find(row=>row.properties['calendar-home-set'])?.properties || {};
    const addresses=[...new Set(list(principalProperties['calendar-user-address-set']?.href).map(scalar).map(eventMailbox).filter(Boolean))];
    const outbox=list(principalProperties['schedule-outbox-URL']?.href).map(scalar).find(Boolean);
    let sendInvite=false,sendReply=false;
    if(addresses.length&&outbox)try{
      const rows=multistatus(await this.sourceRequest(context,sameOrigin(this.serverUrl,outbox),{method:'PROPFIND',headers:{Depth:'0','Content-Type':'application/xml'},body:propfind('<d:current-user-privilege-set/>')}));
      const privileges=rows.flatMap(row=>list(row.properties['current-user-privilege-set']?.privilege));
      sendInvite=privileges.some(value=>['all','schedule-send','schedule-send-invite'].some(key=>Object.hasOwn(value,key)));
      sendReply=privileges.some(value=>['all','schedule-send','schedule-send-reply'].some(key=>Object.hasOwn(value,key)));
    }catch(error){checkActive();if(['AUTH','CANCELLED'].includes(error.code))throw error;}
    const responses = multistatus(await this.sourceRequest(context, sameOrigin(this.serverUrl, home), { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml' }, body: propfind('<d:displayname/><d:resourcetype/><d:owner/><c:supported-calendar-component-set/><d:current-user-privilege-set/><a:calendar-color/><d:sync-token/><cs:getctag/>') }));
    checkActive();
    if (responses.some(row => row.unauthorized)) throw fail('Nextcloud rejected calendar access. Reconnect before refreshing.', 'AUTH');
    if (responses.some(row => row.denied)) throw fail('Calendar access was revoked. Review Nextcloud sharing permissions.', 'PERMISSION');
    if (responses.some(row => row.status && !/\s2\d\d(?:\s|$)/.test(row.status))) throw fail('Nextcloud returned an incomplete calendar inventory. Retry to continue.', 'FORMAT');
    return responses.flatMap(({ href, properties: p }) => {
      if (!p.resourcetype || !Object.hasOwn(p.resourcetype, 'calendar')) return [];
      const url = sameOrigin(this.serverUrl, href);
      if (/\/app-generated--deck--[^/]+\/?$/i.test(decodeURIComponent(new URL(url).pathname))) return [];
      const components = list(p['supported-calendar-component-set']?.comp).map(comp => comp['@_name']);
      const privileges = list(p['current-user-privilege-set']?.privilege);
      const writable = privileges.some(privilege => ['all', 'write', 'write-content'].some(key => Object.hasOwn(privilege, key)));
      const color = hexColor(scalar(p['calendar-color']));
      let owned=false;
      try{owned=Boolean(p.owner?.href)&&sameOrigin(this.serverUrl,scalar(p.owner.href)).replace(/\/$/,'')===principalUrl.replace(/\/$/,'');}catch{}
      const name=String(scalar(principalProperties.displayname)||'').slice(0,200);
      const scheduling={owned,addresses,canInvite:owned&&writable&&sendInvite&&addresses.length>0,canRespond:owned&&writable&&sendReply&&addresses.length>0,...(addresses[0]?{organizer:{uri:`mailto:${addresses[0]}`,...(name?{name}:{})}}:{}),reason:!owned?'not-calendar-owner':!addresses.length?'unknown-identity':'unsupported-scheduling'};
      const token = checkedDavToken({kind:'sync-token',value:scalar(p['sync-token'])}) || checkedDavToken({kind:'ctag',value:scalar(p.getctag)});
      return [{ href: url, title: String(scalar(p.displayname) || 'Calendar'), components, readonly: !writable, scheduling, ...(token ? {token} : {}), ...(color ? { color } : {}) }];
    });
  }

  async readDavDelta(calendar, baseline, context) {
    if(this.#davReadMode!=='report'||this.#davNoDelta.has(calendar.href)||baseline?.checkpoint.token?.kind!=='sync-token'||calendar.token?.kind!=='sync-token')return null;
    const response=await this.sourceRequest(context,calendar.href,{method:'REPORT',headers:{Depth:'1','Content-Type':'application/xml','Cache-Control':'no-cache'},body:davSyncCollectionBody(baseline.checkpoint.token.value),maxBytes:DAV_SCAN_LIMITS.fileBytes});
    context.checkActive();
    if([404,405,501].includes(response.status)){this.#davNoDelta.add(calendar.href);return null;}
    if(response.status===403&&!/<!DOCTYPE|<!ENTITY/i.test(response.body)&&XMLValidator.validate(response.body)===true){
      const error=xml.parse(response.body)?.error;
      if(error&&Object.hasOwn(error,'valid-sync-token'))return null;
    }
    const rows=multistatus(response);
    if(rows.some(row=>row.unauthorized))throw fail('Nextcloud rejected this sign-in.','AUTH',401);
    if(rows.some(row=>row.denied))throw fail('Calendar access was revoked.','PERMISSION',403);
    const merged=mergeDavDelta({serverUrl:this.serverUrl,collection:calendar.href,baseline:baseline.checkpoint.resources,rows:rows.map(row=>({href:row.href,etag:scalar(row.properties.getetag),status:row.status?Number(/\s(\d{3})(?:\s|$)/.exec(row.status)?.[1]):200})),token:scalar(xml.parse(response.body).multistatus?.['sync-token'])});
    // Only an entirely validated delta may prune membership or certify a token.
    context.checkActive();const retained=new Set(merged.resources.map(resource=>resource.href));
    this.#davResources.pruneCollection(calendar.href,retained);
    await this.resourceOperation('prune',{kind:'dav',collection:calendar.href,hrefs:[...retained]},context);
    calendar.token=merged.token;
    return {resources:merged.resources,resourceCount:merged.resources.length,failures:0,denied:false};
  }

  async readDavResource(calendar, resource, revision, allowance, context) {
    const single=()=>this.sourceRequest(context,resource.href,{headers:{...calendarReadHeaders,...(revision?{'If-Match':revision}:{})},maxBytes:allowance});
    if(this.#davReadMode!=='report'||!revision||this.#davNoMultiget.has(calendar.href))return single();
    // The four bounded download workers coalesce their current reads. No extra
    // items are prefetched, so existing transfer reservations remain in force.
    context.multigets ||= new Map();
    let queue=context.multigets.get(calendar.href);
    if(!queue){queue=[];context.multigets.set(calendar.href,queue);queueMicrotask(async()=>{
      context.multigets.delete(calendar.href);
      try{
        context.checkActive();
        const response=await this.sourceRequest(context,calendar.href,{method:'REPORT',headers:{Depth:'1','Content-Type':'application/xml','Cache-Control':'no-cache'},body:davMultigetBody(this.serverUrl,calendar.href,queue.map(item=>item.resource.href)),maxBytes:queue.reduce((sum,item)=>sum+item.allowance,0)});
        if([405,501].includes(response.status)){
          this.#davNoMultiget.add(calendar.href);
          await Promise.all(queue.map(async item=>{try{item.resolve(await item.single());}catch(error){item.reject(error);}}));return;
        }
        const rows=multistatus(response),byHref=new Map();
        if(rows.length!==queue.length)throw fail('Calendar multiget returned an incomplete result.','FORMAT');
        const requested=new Set(queue.map(item=>item.resource.href));
        for(const row of rows){const href=davMemberHref(this.serverUrl,calendar.href,row.href);if(!requested.has(href)||byHref.has(href))throw fail('Calendar multiget returned unexpected members.','FORMAT');byHref.set(href,row);}
        for(const item of queue){
          const row=byHref.get(item.resource.href),status=row.unauthorized?401:row.denied?403:row.status?Number(/\s(\d{3})(?:\s|$)/.exec(row.status)?.[1]):200;
          if(status!==200){item.resolve({status,body:'',headers:{get:()=>null}});continue;}
          const body=scalar(row.properties['calendar-data']),etag=scalar(row.properties.getetag);
          if(typeof body!=='string'||!body||!strongEtag(etag))throw fail('Calendar multiget returned an incomplete resource.','FORMAT');
          if(byteLength(body)>item.allowance)throw fail('Calendar multiget member exceeds its size limit.','LIMIT');
          if(etag!==item.revision)throw fail('A calendar item changed during refresh.','CONFLICT');
          item.resolve({status:200,body,headers:{get:key=>key.toLowerCase()==='etag'?etag:null}});
        }
      }catch(error){for(const item of queue)item.reject(error);}
    });}
    return new Promise((resolve,reject)=>queue.push({resource,revision,allowance,single,resolve,reject}));
  }

  async readDavInventory(calendar, context) {
      context.checkActive();
      const root = new URL(sameOrigin(this.serverUrl, calendar.href));
      const rootPath = root.pathname.replace(/\/$/, '') + '/';
      const rows = multistatus(await this.sourceRequest(context, root.href, {method: 'PROPFIND', headers: {Depth: '1', 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache'}, body: propfind('<d:getetag/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/>'), maxBytes: DAV_SCAN_LIMITS.fileBytes}));
      context.checkActive();
      const resources = [], seen = new Set();
      let failures = 0, rootSeen = false, denied = false;
      for (const row of rows) {
        if (row.unauthorized) throw fail('Nextcloud rejected this sign-in. Reconnect before refreshing.', 'AUTH', 401);
        const target = new URL(sameOrigin(this.serverUrl, row.href));
        if (target.search || target.hash) throw fail('The calendar returned an unsafe resource URL.', 'SECURITY');
        if (target.pathname.replace(/\/$/, '') + '/' === rootPath) {
          if (rootSeen) throw fail('The calendar returned a duplicate collection root.', 'FORMAT');
          rootSeen = true; denied ||= row.denied;
          if (!row.denied && (row.status && !/\s2\d\d(?:\s|$)/.test(row.status) || !Object.hasOwn(row.properties.resourcetype || {}, 'collection'))) throw fail('The calendar returned an incomplete folder listing.', 'FORMAT');
          continue;
        }
        const relative = target.pathname.startsWith(rootPath) ? target.pathname.slice(rootPath.length) : '';
        let filename;
        try { filename = decodeURIComponent(relative); } catch { throw fail('The calendar returned an invalid resource path.', 'SECURITY'); }
        if (!filename || /[\/\\\u0000-\u001f\u007f]|%[\da-f]{2}/i.test(filename) || ['.', '..'].includes(filename)) throw fail('A calendar resource is outside its collection.', 'SECURITY');
        if (seen.has(target.href)) throw fail('The calendar returned a duplicate resource.', 'FORMAT');
        seen.add(target.href);
        if (row.denied) { denied = true; continue; }
        if (row.status && !/\s2\d\d(?:\s|$)/.test(row.status)) { failures++; continue; }
        if (row.properties.resourcetype && Object.hasOwn(row.properties.resourcetype, 'collection')) continue;
        const length = Number(scalar(row.properties.getcontentlength));
        const modified = Date.parse(String(scalar(row.properties.getlastmodified)));
        resources.push({href: target.href, etag: scalar(row.properties.getetag), length: Number.isFinite(length) && length > 0 ? length : undefined, modified: Number.isFinite(modified) ? modified : 0});
      }
      if (!rootSeen) throw fail('The calendar returned an incomplete folder listing.', 'FORMAT');
      if (denied) return {items: [], failures: failures + 1, denied: true};
      // Only a complete successful inventory is authoritative for deletion.
      if (!failures) {
        context.checkActive();
        this.#davResources.pruneCollection(calendar.href, seen);
        await this.resourceOperation('prune', {kind: 'dav', collection: calendar.href, hrefs: [...seen]}, context);
      }
      resources.sort((a, b) => b.modified - a.modified || a.href.localeCompare(b.href));
      return {resources, resourceCount: seen.size, failures, denied: false};
  }

  async scanMobileDav(available, context) {
    if (context.scan) return context.scan;
    context.scan = (async () => {
      context.checkActive();
      const epoch = this.#davEpoch;
      const window = context.projectionWindow ?? davProjectionWindow(this.#now().getTime());
      const unique = new Map();
      for (const calendar of available) if (calendar.components.some(component => ['VTODO', 'VEVENT'].includes(component))) {
        if (!unique.has(calendar.href)) unique.set(calendar.href, {...calendar, components: [...calendar.components]});
        else unique.get(calendar.href).components = [...new Set([...unique.get(calendar.href).components, ...calendar.components])];
      }
      this.#davResources.retainCollections(new Set(unique.keys()));
      for (const href of this.#davSnapshots.keys()) if (!unique.has(href)) this.#davSnapshots.delete(href);
      for (const href of this.#davStaleSnapshots.keys()) if (!unique.has(href)) this.#davStaleSnapshots.delete(href);
      await this.resourceOperation('retainCollections', {kind: 'dav', collections: [...unique.keys()]}, context);
      const inventories = [], byHref = new Map();
      const sourceNames = calendar => ['tasks', 'calendar'].filter(source => (!context.selected || context.selected.includes(source)) && calendar.components.includes(source === 'tasks' ? 'VTODO' : 'VEVENT'));
      const markLimit = (inventory, reason, source) => {
        for (const name of source ? [source] : sourceNames(inventory.calendar)) inventory.limits[name].add(reason);
      };
      const failureCode = error => syncDiagnostic(error, 'source-read').errorCode || 'Unknown';
      const failed = (inventory, code = 'Unknown') => { for (const source of sourceNames(inventory.calendar)) { inventory.failures[source]++; inventory.failureCodes[source].add(code); } };
      let resourceCount = 0, collectionCount = 0;
      for (const calendar of unique.values()) {
        context.checkActive();
        if(!sourceNames(calendar).length)continue;
        let certified = this.#davSnapshots.get(calendar.href);
        let baseline = certified || this.#davStaleSnapshots.get(calendar.href);
        // Reader results are mutable public data. Never let a caller's in-place
        // edit turn a cached byte total or source baseline into server truth.
        if(baseline&&!davSnapshotUntouched(baseline)){
          this.#davSnapshots.delete(calendar.href);this.#davStaleSnapshots.delete(calendar.href);
          certified=undefined;baseline=undefined;
        }
        const inventory = {calendar, baseline, baselineResources: new Map((baseline?.checkpoint.resources || []).map(resource=>[resource.href,resource])), reused: new Map(), accounting:new Map(), resources: [], records: {tasks: [], calendar: []}, projectedBytes: 0, failures: {tasks: 0, calendar: 0}, failureCodes: {tasks: new Set(), calendar: new Set()}, limits: {tasks: new Set(), calendar: new Set()}, denied: false};
        inventories.push(inventory); byHref.set(calendar.href, inventory);
        if (collectionCount++ >= DAV_SCAN_LIMITS.collections) { this.#davSnapshots.delete(calendar.href);markLimit(inventory, '64 collections'); continue; }
        try {
          if (davInventoryCompatible(certified?.checkpoint, calendar, sourceNames(calendar))) {
            if(resourceCount+baseline.checkpoint.resources.length>DAV_SCAN_LIMITS.inventoryResources){this.#davSnapshots.delete(calendar.href);markLimit(inventory,'50,000 resources per scan');continue;}
            inventory.resources = baseline.checkpoint.resources.map(resource=>({href:resource.href,etag:resource.etag}));
            resourceCount += inventory.resources.length;
            inventory.completeInventory = true;
            inventory.compatible = davCheckpointCompatible(certified.checkpoint, calendar, window, sourceNames(calendar));
            if (!inventory.compatible) {this.#davStaleSnapshots.set(calendar.href, certified);this.#davSnapshots.delete(calendar.href);}
            continue;
          }
          // The old baseline can accelerate exact-ETag resources, but its token
          // must not survive an interrupted refresh of a changed collection.
          if (baseline) this.#davStaleSnapshots.set(calendar.href, baseline);
          this.#davSnapshots.delete(calendar.href);
          const listed = await this.readDavDelta(calendar, baseline, context) || await this.readDavInventory(calendar, context);
          inventory.denied = listed.denied;
          if (listed.denied) { await this.revokeResources('dav', calendar.href); failed(inventory, 'PERMISSION'); continue; }
          this.#revokedResources.delete(calendar.href);
          for (const source of sourceNames(calendar)) { inventory.failures[source] += listed.failures; if (listed.failures) inventory.failureCodes[source].add('Unknown'); }
          if (listed.resourceCount > DAV_SCAN_LIMITS.collectionResources) { markLimit(inventory, '10,000 resources per collection'); continue; }
          if (resourceCount + listed.resourceCount > DAV_SCAN_LIMITS.inventoryResources) { markLimit(inventory, '50,000 resources per scan'); continue; }
          resourceCount += listed.resourceCount; inventory.resources = listed.resources;
          inventory.completeInventory = listed.failures === 0;
        } catch (error) {
          context.checkActive();
          if (error.code === 'AUTH' || error.code === 'CANCELLED') throw error;
          inventory.error = error;
          if (error.code === 'PERMISSION') { inventory.denied = true; await this.revokeResources('dav', calendar.href); }
          else if (error.code === 'LIMIT') markLimit(inventory, '2 MiB listing response');
          failed(inventory, failureCode(error));
        }
      }
      const from = new Date(window.from), to = new Date(window.to);
      const count = {tasks: 0, calendar: 0};
      const transfer = {knownBytes: 0, unknownReservedBytes: 0, failedRequests: 0, errorCounts: new Map()};
      context.transfer = transfer;
      let projectedBytes = 0, transferBytes = DAV_SCAN_LIMITS.scanBytes;
      let reusedResources=0;
      for(const inventory of inventories)if(inventory.compatible){
        const selected=sourceNames(inventory.calendar);let baseline=inventory.baseline;
        if(baseline.records.size && baseline.title!==inventory.calendar.title){
          baseline=davSnapshot(baseline.checkpoint,new Map([...baseline.records].map(([key,record])=>[key,{...record,collectionTitle:inventory.calendar.title}])),baseline.accounting);
          inventory.baseline=baseline;this.#davSnapshots.set(inventory.calendar.href,baseline);
        }
        const bytes=baseline.bytes[selected.length===2?'both':selected[0]];
        if(projectedBytes+bytes>DAV_SCAN_LIMITS.projectedBytes||selected.some(source=>count[source]+baseline.flat[source].length>DAV_SCAN_LIMITS.recordsPerSource))continue;
        for(const source of selected){inventory.records[source]=baseline.flat[source];count[source]+=baseline.flat[source].length;}
        inventory.projectedBytes=bytes;projectedBytes+=bytes;inventory.bulk=true;reusedResources+=inventory.resources.length;
      }
      let projectionMs=0;
      // Hot-cache scans otherwise parse/project up to 250 resources in one task.
      // Yield work without publishing an unverified partial source snapshot.
      let projectionItems = 0;
      const yieldProjection = async () => { await new Promise(resolve => setTimeout(resolve, 0)); context.checkActive(); };
      const reusable = (inventory, resource) => {
        if(inventory.reused.has(resource.href)) return inventory.reused.get(resource.href);
        const previous = inventory.baselineResources.get(resource.href), baseline = inventory.baseline;
        if (!previous || previous.etag !== strongEtag(resource.etag) || baseline.checkpoint.readonly !== Boolean(inventory.calendar.readonly) || !baseline.checkpoint.components.every(component=>inventory.calendar.components.includes(component))) return {};
        const result = {};
        for (const source of sourceNames(inventory.calendar)) {
          if (!baseline.checkpoint.components.includes(source === 'tasks' ? 'VTODO' : 'VEVENT') || source === 'calendar' && (baseline.checkpoint.from !== window.from || baseline.checkpoint.to !== window.to)) continue;
          result[source] = previous[source === 'tasks' ? 'taskKeys' : 'eventKeys'].map(key=>baseline.records.get(key));
        }
        inventory.reused.set(resource.href,result); return result;
      };
      const fullyReusable = (inventory, resource) => sourceNames(inventory.calendar).every(source=>Object.hasOwn(reusable(inventory,resource),source));
      const project = async (inventory, resource, raw, etag, parsed, reused = reusable(inventory,resource)) => {
        const started=Date.now();
        try {
        if (inventory.denied) return;
        // Occurrences share the exact source document/write baseline. Charge it
        // once, then count only the distinct normalized metadata for each row.
        let retainedDocument = false;
        const previousAccounting=inventory.baseline?.accounting.get(resource.href),savedAccounting=previousAccounting?.etag===etag?previousAccounting:undefined;
        let resourceAccounting;
        for (const source of sourceNames(inventory.calendar)) {
          const calendar = inventory.calendar;
          const collection = {id: this.id(source, calendar.href), source, title: calendar.title, readonly: Boolean(calendar.readonly),...calendarSchedulingFields(calendar,source)};
          try {
            const projected = Object.hasOwn(reused,source) ? reused[source].map(record=>record.collectionTitle === collection.title ? record : {...record,collectionTitle:collection.title}) : await this.calendarRecordsCooperative(raw, resource.href, etag, collection, from, to, context, parsed || (parsed=parseCalendar(raw)));
            for (const record of projected) {
              if (++projectionItems % 128 === 0) await yieldProjection();
              if (inventory.denied) return;
              if (count[source] >= DAV_SCAN_LIMITS.recordsPerSource) { markLimit(inventory, '10,000 projected items per source', source); break; }
              const measured=davMetadataAccounting(record,savedAccounting),metadataBytes=measured.bytes;
              if(!resourceAccounting){const document=raw||record.remote?.raw||'';resourceAccounting={etag,raw:document,rawBytes:davDocumentBytes(document,savedAccounting),records:new Map()};}
              const size = metadataBytes + (retainedDocument ? 0 : resourceAccounting.rawBytes);
              if (projectedBytes + size > DAV_SCAN_LIMITS.projectedBytes) { markLimit(inventory, '32 MiB projected data', source); break; }
              resourceAccounting.records.set(record.identity.key,measured);inventory.accounting.set(resource.href,resourceAccounting);
              inventory.records[source].push(record); retainedDocument = true; count[source]++; projectedBytes += size; inventory.projectedBytes += size;
            }
          } catch (error) { context.checkActive();if(['CANCELLED','AUTH','TIMEOUT'].includes(error.code))throw error; inventory.failures[source]++; inventory.failureCodes[source].add(failureCode(error)); }
        }
        } finally {projectionMs+=Date.now()-started;}
      };
      const jobKey=job=>JSON.stringify([job.inventory.calendar.href,job.resource.href]);
      const jobs = roundRobinDavJobs(inventories.filter(inventory=>!inventory.bulk));
      const cacheIndices = new Map();
      if (typeof this.#resourceCache?.list === 'function') for (const inventory of inventories) {
        if (inventory.denied || inventory.bulk || !inventory.resources.some(resource=>!fullyReusable(inventory,resource))) continue;
        const index=checkedDavResourceIndex(await this.resourceOperation('list',{kind:'dav',collection:inventory.calendar.href},context),inventory.calendar.href,this.serverUrl);
        cacheIndices.set(inventory.calendar.href,index);
      }
      // A bounded pass can end during local replay as well as downloading. On
      // retry, visit its unfinished tail before re-projecting a completed prefix.
      const priority = job => {
        if (fullyReusable(job.inventory,job.resource)) return 2;
        const revision=strongEtag(job.resource.etag), index=cacheIndices.get(job.inventory.calendar.href);
        if (index && (!revision || index.get(job.resource.href)!==revision)) return 0;
        return this.#davRetry.has(jobKey(job)) ? 0 : 1;
      };
      if(this.#davRetry.size || cacheIndices.size) jobs.sort((left,right)=>priority(left)-priority(right));
      this.#davRetry=new Set(jobs.map(jobKey));
      let cursor = 0, completed = reusedResources;
      const group = ['tasks', 'calendar'].filter(source => !context.selected || context.selected.includes(source));
      const report = () => context.progress?.(group, 'source-read', completed, resourceCount, 'Checking calendar resources (downloaded or reused)');
      report();
      while (cursor < jobs.length) {
        context.checkActive();
        const scanExhausted = transferBytes < DAV_SCAN_LIMITS.fileBytes;
        const batchSize = DAV_SCAN_LIMITS.batchJobs;
        const prefetched = new Map();
        const pending = jobs.slice(cursor,cursor+batchSize).filter(({inventory,resource})=>!inventory.denied&&strongEtag(resource.etag)&&!fullyReusable(inventory,resource));
        if (typeof this.#resourceCache?.getMany === 'function' && pending.length) {
          const candidates=pending.filter(job=>{
            const hit=this.#davResources.get(job.inventory.calendar.href,job.resource.href,strongEtag(job.resource.etag));
            if(hit)prefetched.set(job,{memory:hit});return !hit;
          });
          let prefetchedBytes=0;
          for(let offset=0;offset<candidates.length&&prefetchedBytes<DAV_SCAN_LIMITS.batchBytes;offset+=32){
            const part=candidates.slice(offset,offset+32);
            const started=Date.now(), locators=part.map(({inventory,resource})=>({kind:'dav',collection:inventory.calendar.href,href:resource.href}));
            const saved=await this.resourceOperation('getMany',locators,context);
            this.diagnostic({kind:'cache',source:'caldav',stage:'cache-read',durationMs:Date.now()-started,count:part.length});
            if(Array.isArray(saved))for(let i=0;i<Math.min(part.length,saved.length);i++){
              const entry=saved[i];const size=Number.isSafeInteger(entry?.bytes)&&entry.bytes>=0?entry.bytes:0;
              if(prefetchedBytes+size>DAV_SCAN_LIMITS.batchBytes)break;
              prefetchedBytes+=size;prefetched.set(part[i],{entry});
            }
          }
        }
        let budget = {files: batchSize, bytes: DAV_SCAN_LIMITS.batchBytes}, processed = 0;
        const stats={cacheHits:0,cacheMisses:0,downloads:0,bytes:0},projectionStart=projectionMs;
        const worker = async () => {
          while (cursor < jobs.length && processed < batchSize) {
            context.checkActive();
            const job = jobs[cursor++], {inventory, resource} = job;
            processed++;
            if (inventory.denied) { completed++; report(); continue; }
            const locator = {kind: 'dav', collection: inventory.calendar.href, href: resource.href};
            if (resource.length > DAV_SCAN_LIMITS.fileBytes) { completed++; markLimit(inventory, '2 MiB per file'); report(); continue; }
            const revision = strongEtag(resource.etag);
            if (fullyReusable(inventory,resource)) {stats.cacheHits++;await project(inventory,resource,null,revision);this.#davRetry.delete(jobKey(job));completed++;report();if(completed%128===0)await yieldProjection();continue;}
            let cached = prefetched.get(job)?.memory || this.#davResources.get(inventory.calendar.href, resource.href, revision);
            if (!cached && revision) {
              const saved = await this.cachedResource(locator, context, prefetched.get(job)?.entry, revision);
              if (saved?.etag === revision) cached = {raw: saved.body, etag: saved.etag, bytes: saved.bytes, parsed:saved.parsed};
            }
            context.checkActive();
            if (inventory.denied) { completed++; report(); continue; }
            if (cached) { stats.cacheHits++;this.#davResources.set(inventory.calendar.href, resource.href, cached); await project(inventory, resource, cached.raw, cached.etag,cached.parsed);this.#davRetry.delete(jobKey(job)); completed++; report(); if (completed % 8 === 0) await yieldProjection(); continue; }
            stats.cacheMisses++;
            if (transferBytes < DAV_SCAN_LIMITS.fileBytes) {
              // In-flight successes can refund their unused reservation. Only
              // declare exhaustion at a batch boundary with no pending reads.
              if (!scanExhausted) { jobs.push(job); return; }
              completed++; markLimit(inventory, '256 MiB resource transfer budget per scan'); report(); continue;
            }
            const reservation = davDownloadReservation(budget, resource.length);
            if (reservation.kind === 'next-batch') { jobs.push(job); return; }
            budget = reservation.budget; transferBytes -= reservation.allowance;
            let consumed = reservation.allowance, knownResponse = false;
            try {
              context.checkActive();
              const response = await this.readDavResource(inventory.calendar,resource,revision,reservation.allowance,context);
              // A complete bounded error/empty/changed response has a known
              // size too. It must not consume the full 2 MiB reservation.
              consumed = byteLength(response.body); knownResponse = true; transfer.knownBytes += consumed;
              stats.downloads++;stats.bytes+=consumed;
              assertStatus(response);
              context.checkActive();
              if (!response.body) throw fail('A calendar item returned an empty document.', 'FORMAT');
              const responseEtag = response.headers.get('ETag');
              if (revision && strongEtag(responseEtag) && responseEtag !== revision) throw fail('A calendar item changed during refresh.', 'CONFLICT');
              const etag = strongEtag(responseEtag) || revision || responseEtag || undefined;
              // A parallel read may already have revoked this collection.
              if (!inventory.denied) {
                const parsed=parseCalendar(response.body);
                this.#davResources.set(inventory.calendar.href, resource.href, {etag, raw: response.body, bytes: consumed});
                await this.saveResource(locator, etag, response.body, context);
                context.checkActive();
                if (inventory.denied) continue;
                await project(inventory, resource, response.body, etag,parsed);
                this.#davRetry.delete(jobKey(job));
              }
            } catch (error) {
              transfer.failedRequests++;
              const code = failureCode(error);
              transfer.errorCounts.set(code, (transfer.errorCounts.get(code) || 0) + 1);
              context.checkActive();
              if (error.code === 'AUTH') { context.authError = error; await this.revokeResources(); throw error; }
              if (error.code === 'CANCELLED') { context.cancelError = error; throw error; }
              if (error.code === 'PERMISSION') {
                inventory.denied = true; await this.revokeResources('dav', inventory.calendar.href);
                for (const source of ['tasks', 'calendar']) count[source] -= inventory.records[source].length;
                projectedBytes -= inventory.projectedBytes; inventory.projectedBytes = 0;
                inventory.records = {tasks: [], calendar: []};
              }
              if (error.code === 'LIMIT') markLimit(inventory, '2 MiB per file');
              failed(inventory, code);
            } finally {
              if (!knownResponse) transfer.unknownReservedBytes += reservation.allowance;
              const unused = reservation.allowance - consumed; budget.bytes += unused; transferBytes += unused;
              completed++; report();
            }
          }
        };
        try {await Promise.all(Array.from({length: 4}, worker));}
        finally {this.diagnostic({kind:'projection',source:'caldav',stage:'projection',...stats,count:processed,completed,total:resourceCount,durationMs:projectionMs-projectionStart});}
        context.checkActive();
        if (cursor < jobs.length) await new Promise(resolve => setTimeout(resolve, 0));
      }
      context.checkActive();
      if (epoch === this.#davEpoch) for (const inventory of inventories) {
        if(inventory.bulk)continue;
        const selected = sourceNames(inventory.calendar), token=checkedDavToken(inventory.calendar.token);
        if (!token || !selected.length || !inventory.completeInventory || inventory.denied || selected.some(source=>inventory.failures[source]||inventory.limits[source].size)) continue;
        if (inventory.resources.some(resource=>!strongEtag(resource.etag))) continue;
        const keys = new Map(inventory.resources.map(resource=>[resource.href,{href:resource.href,etag:resource.etag,taskKeys:[],eventKeys:[]}]));
        const records = new Map();
        for (const source of selected) for (const record of inventory.records[source]) {records.set(record.identity.key,record);keys.get(record.remote.href)[source==='tasks'?'taskKeys':'eventKeys'].push(record.identity.key);}
        const checkpoint={href:inventory.calendar.href,token,components:selected.map(source=>source==='tasks'?'VTODO':'VEVENT'),readonly:Boolean(inventory.calendar.readonly),...window,resources:[...keys.values()]};
        this.#davSnapshots.set(inventory.calendar.href,davSnapshot(checkpoint,records,inventory.accounting));
        this.#davStaleSnapshots.delete(inventory.calendar.href);
      }
      return byHref;
    })().catch(async error => { if (error.code === 'AUTH') { context.authError = error; await this.revokeResources(); } throw error; });
    return context.scan;
  }

  async readMobileDav(source, available, context) {
    const snapshots = await this.scanMobileDav(available, context);
    const calendars = [...new Map(available.filter(calendar => calendar.components.includes(source === 'tasks' ? 'VTODO' : 'VEVENT')).map(calendar => [calendar.href, calendar])).values()];
    const records = [], collections = [], revokedCollectionIds = [], limits = new Set(), failureCodes = new Set();
    let failures = 0;
    for (const calendar of calendars) {
      const snapshot = snapshots.get(calendar.href), id = this.id(source, calendar.href);
      for (const code of snapshot.failureCodes[source]) failureCodes.add(code);
      if (snapshot.denied) { revokedCollectionIds.push(id); failures++; continue; }
      if (snapshot.error && calendars.length === 1 && snapshot.error.code !== 'LIMIT') throw snapshot.error;
      const collection={id, source, title: calendar.title, readonly: Boolean(calendar.readonly), ...(hexColor(calendar.color) ? {color: hexColor(calendar.color)} : {}), remote: {href: calendar.href},...calendarSchedulingFields(calendar,source)};
      collections.push(collection);
      records.push(...snapshot.records[source].map(record=>applyEventAuthority(record,collection))); failures += snapshot.failures[source];
      for (const limit of snapshot.limits[source]) limits.add(limit);
    }
    const transfer = context.transfer;
    const errorCounts = transfer && [...transfer.errorCounts].sort(([left], [right]) => left.localeCompare(right)).map(([code, count]) => `${code}: ${count}`).join(', ');
    const details = transfer ? ` Shared Tasks/Calendar scan: ${(transfer.knownBytes / 1048576).toFixed(2)} MiB received in bounded responses; ${(transfer.unknownReservedBytes / 1048576).toFixed(2)} MiB reserved for transfers with unknown sizes; ${transfer.failedRequests} failed resource requests${errorCounts ? ` (${errorCounts})` : ''}.` : '';
    const commonCode = failureCodes.size === 1 ? syncDiagnostic({code: [...failureCodes][0]}, 'source-read').errorCode : undefined;
    return {records, collections, revokedCollectionIds, ...(limits.size ? {errorCode: 'LIMIT', warning: `Calendar refresh could not finish within its safety limits (${[...limits].join('; ')}). Only part of this source is loaded. Open Nextcloud to see all items.${details}`} : failures ? {...(commonCode ? {errorCode: commonCode} : {}), warning: `${failures} calendar collection(s) or item(s) could not be read. Other data is available; open Nextcloud for the affected items.${details}`} : {message: source === 'calendar' && !context?.projectionWindow ? 'Agenda includes the previous 14 days and next 90 days.' : undefined})};
  }

  async readDav(source, available, context = undefined) {
    // Collection tokens do not opt a REPORT host into downloading its entire
    // history. That scan needs a durable resource cache to resume across runs;
    // otherwise keep the server-side event horizon and complete task query.
    if (this.#davReadMode === 'propfind-get' || this.#resourceCache) return this.readMobileDav(source, available, context || mobileDavContext());
    const component = source === 'tasks' ? 'VTODO' : 'VEVENT';
    const calendars = available.filter(c => c.components.includes(component));
    const collections = calendars.map(c => ({ id: this.id(source, c.href), source, title: c.title, readonly: Boolean(c.readonly), ...(hexColor(c.color) ? { color: hexColor(c.color) } : {}), remote: { href: c.href },...calendarSchedulingFields(c,source) }));
    const from = new Date(context?.projectionWindow?.from ?? this.#now().getTime() - 14 * DAY);
    const to = new Date(context?.projectionWindow?.to ?? this.#now().getTime() + 90 * DAY);
    const compact = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const range = source === 'calendar' ? `<c:time-range start="${compact(from)}" end="${compact(to)}"/>` : '';
    const body = `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="${component}">${range}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const records = [];
    const revokedCollectionIds = [];
    let failures = 0, projectedResources = 0;
    for (let index = 0; index < calendars.length; index++) {
      try {
        context?.checkActive();
        const items = multistatus(await this.sourceRequest(context, calendars[index].href, { method: 'REPORT', headers: { Depth: '1', 'Content-Type': 'application/xml' }, body }));
        if (items.some(item => item.denied)) {
          revokedCollectionIds.push(collections[index].id);
          failures++;
          continue;
        }
        for (const item of items) {
          if (++projectedResources % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
          context?.checkActive();
          const raw = scalar(item.properties['calendar-data']);
          if (!raw) { if (item.status && !/\s2\d\d(?:\s|$)/.test(item.status)) failures++; continue; }
          try {
            const parsed = await this.calendarRecordsCooperative(raw, sameOrigin(this.serverUrl, item.href), scalar(item.properties.getetag) || undefined, collections[index], from, to, context);
            records.push(...parsed);
          }
          catch (error) { context?.checkActive(); if (['AUTH', 'CANCELLED', 'TIMEOUT'].includes(error.code)) throw error; failures++; }
        }
      } catch (error) {
        context?.checkActive();
        if (['AUTH', 'CANCELLED'].includes(error.code)) throw error;
        if (error.code === 'PERMISSION') revokedCollectionIds.push(collections[index].id);
        if (calendars.length === 1) throw error;
        failures++;
      }
    }
    return { records, collections: collections.filter(c => !revokedCollectionIds.includes(c.id)), revokedCollectionIds, ...(failures ? { warning: `${failures} calendar collection(s) or item(s) could not be read. Other data is available; open Nextcloud for the affected items.` } : { message: source === 'calendar' && !context?.projectionWindow ? 'Agenda includes the previous 14 days and next 90 days.' : undefined }) };
  }

  calendarRecords(raw, href, etag, collection, from, to) {
    const walk = this.#calendarRecordWalk(raw, href, etag, collection, from, to);
    let step = walk.next();
    while (!step.done) step = walk.next();
    return step.value;
  }

  async calendarRecordsCooperative(raw, href, etag, collection, from, to, context, parsed) {
    context?.checkActive();
    const walk = this.#calendarRecordWalk(raw, href, etag, collection, from, to, parsed);
    let step = walk.next();
    while (!step.done) {
      // One resource can contain thousands of historical recurrence slots.
      // Yield while walking them, not only after constructing the final array.
      await new Promise(resolve => setTimeout(resolve, 0));
      context?.checkActive();
      step = walk.next();
    }
    context?.checkActive();
    return step.value;
  }

  *#calendarRecordWalk(raw, href, etag, collection, from, to, parsed) {
    const calendar = parsed || parseCalendar(raw);
    const common = { collectionId: collection.id, collectionTitle: collection.title, etag };
    let work = 0;
    if (collection.source === 'tasks') {
      const records = [];
      for (const todo of calendar.getAllSubcomponents('vtodo')) {
        if (++work % 128 === 0) yield;
        const uid = String(todo.getFirstPropertyValue('uid') || href);
        if (/^deck-(?:card|stack)-/i.test(uid)) continue;
        const recurrenceId = todo.getFirstPropertyValue('recurrence-id');
        const originalId = this.id('tasks', `${href}:${uid}${recurrenceId ? `:${recurrenceId}` : ''}`);
        const recurrenceKey = recurrenceId ? recurrenceId.toString() : '';
        const identity = this.identity('tasks', JSON.stringify([collection.id, uid, recurrenceKey]), href, [originalId, this.id('tasks', JSON.stringify(['uid', uid, recurrenceKey]))]);
        const status = String(todo.getFirstPropertyValue('status') || '').trim().toUpperCase();
        const percent = todo.getFirstPropertyValue('percent-complete');
        // Nextcloud Tasks treats either COMPLETED or STATUS:COMPLETED as done.
        // A percentage alone is progress, and CANCELLED remains a separate state.
        const nativeCompleted = todo.getFirstPropertyValue('completed');
        const completed = Boolean(nativeCompleted) || status === 'COMPLETED';
        const completedAt = completionDate(nativeCompleted);
        const percentComplete = Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : undefined;
        records.push({ ...common, id: originalId, source: 'tasks', kind: 'task', title: String(todo.getFirstPropertyValue('summary') || 'Untitled task'), body: String(todo.getFirstPropertyValue('description') || ''), url: this.url('index.php/apps/tasks/'), due: dateValue(todo.getFirstPropertyValue('due')), start: dateValue(todo.getFirstPropertyValue('dtstart')), completed, ...(completedAt ? {completedAt} : {}), ...(status ? { status } : {}), ...(percentComplete !== undefined ? { percentComplete } : {}), priority: todo.getFirstPropertyValue('priority') || 0, color: normalizeColor(todo.getFirstPropertyValue('color')), tags: tagsOf(todo), readonly: Boolean(collection.readonly) || !etag || isComplexTask(calendar, todo), identity, remote: { href, raw, uid } });
      }
      return records;
    }
    const masters = [], exceptions = [];
    for (const component of calendar.getAllSubcomponents('vevent')) {
      if (++work % 128 === 0) yield;
      const event = new ICAL.Event(component);
      (event.isRecurrenceException() ? exceptions : masters).push(event);
    }
    const records = new Map(), eventDetails = new WeakMap();
    const put = (event, start, end, occurrenceId) => {
      if (!start || event.component.getFirstPropertyValue('status') === 'CANCELLED') return;
      const first = start.toJSDate().getTime(), last = end?.toJSDate().getTime();
      if (first >= to.getTime() || (last > first ? last <= from.getTime() : first < from.getTime())) return;
      const id = this.id('calendar', `${href}:${event.uid}${occurrenceId ? `:${occurrenceId}` : ''}`);
      const identity = this.identity('calendar', JSON.stringify([collection.id, event.uid, occurrenceId || '']), href, [id, this.id('calendar', JSON.stringify(['uid', event.uid, occurrenceId || '']))]);
      if (!eventDetails.has(event.component)) eventDetails.set(event.component, {location: String(event.component.getFirstPropertyValue('location') || ''), ...eventAlarmDetails(event.component),...eventSchedulingDetails(calendar,event.component,collection.remote?.scheduling,occurrenceId)});
      const {structuralReason,invalid,...details}=eventDetails.get(event.component);
      records.set(id, applyEventAuthority({ ...common, id, source: 'calendar', kind: 'event', title: event.summary || 'Untitled event', body: event.description || '', ...details, url: this.url('index.php/apps/calendar/'), start: dateValue(start), end: dateValue(end), allDay: Boolean(start.isDate), busy: String(event.component.getFirstPropertyValue('transp') || '').toUpperCase() !== 'TRANSPARENT', readonly: Boolean(collection.readonly) || !etag || Boolean(occurrenceId) || isComplexEvent(calendar, event.component), tags: tagsOf(event.component), color: normalizeColor(event.component.getFirstPropertyValue('color')), identity, remote: { href, raw, uid: event.uid, eventStructure:structuralReason,invalidScheduling:invalid,...(occurrenceId ? { recurrenceId: occurrenceId } : {}) } },collection));
    };
    for (const master of masters) {
      if (++work % 128 === 0) yield;
      for (const exception of exceptions) {
        if (++work % 128 === 0) yield;
        if (exception.uid === master.uid) master.relateException(exception);
      }
      if (!master.isRecurring()) { put(master, master.startDate, master.endDate); continue; }
      const iterator = master.iterator();
      let exhausted = false;
      for (let count = 0; count < 20_000; count++) {
        if (++work % 128 === 0) yield;
        const occurrence = iterator.next();
        if (!occurrence || occurrence.toJSDate().getTime() >= to.getTime() + 366 * DAY) { exhausted = true; break; }
        const detail = master.getOccurrenceDetails(occurrence);
        put(detail.item, detail.startDate, detail.endDate, occurrence.toString());
        if (occurrence.toJSDate().getTime() >= to.getTime() && !master.rangeExceptions.length) { exhausted = true; break; }
      }
      if (!exhausted) throw fail('A recurrence exceeds the prototype expansion limit.', 'LIMIT');
    }
    // Include moved exceptions even when their original date lies beyond the
    // expansion window, and detached instances without their master.
    for (const exception of exceptions) {
      if (++work % 128 === 0) yield;
      put(exception, exception.startDate, exception.endDate, exception.recurrenceId.toString());
    }
    return [...records.values()];
  }

  async discoverDeckBoards(context) {
    const base = 'index.php/apps/deck/api/v1.0';
    const headers = { 'Content-Type': 'application/json' };
    const boards = jsonBody(assertStatus(await this.sourceRequest(context, this.url(`${base}/boards?details=true`), { headers })));
    if (!Array.isArray(boards)) throw fail('Deck returned an unexpected board list.', 'FORMAT');
    if (boards.some(board => !board || !nativeNumber(board.id))) throw fail('Deck returned an incomplete board inventory.', 'FORMAT');
    return boards.filter(b => !b.deletedAt && !b.archived);
  }

  deckCollection(board) {
    const color = hexColor(String(board.color || '').startsWith('#') ? board.color : `#${board.color || ''}`);
    return {id: this.id('deck', board.id), source: 'deck', title: board.title || 'Untitled board', readonly: board.permissions?.PERMISSION_EDIT !== true, labels: deckLabels(board.labels), ...(color ? {color} : {}), remote: {nativeId: board.id}};
  }

  async readDeck(context) {
    const base = 'index.php/apps/deck/api/v1.0';
    const headers = { 'Content-Type': 'application/json' };
    const visibleBoards = await this.discoverDeckBoards(context);
    context?.checkActive();
    // Stacks intentionally remain absent until read. A current board inventory
    // certifies access; it does not certify old cached stack choices or content.
    context?.publishCollections?.({sources: ['deck'], collections: visibleBoards.map(board => this.deckCollection(board))});
    await this.resourceOperation('retainCollections', {kind: 'deck', collections: visibleBoards.map(board => this.url(`${base}/boards/${encode(board.id)}`))}, context);
    const collections = [];
    const records = [];
    const revokedCollectionIds = [];
    let failures = 0;
    let attachmentFailures = 0;
    let completed = 0;
    for (const board of visibleBoards) {
      context?.checkActive();
      const locator = {kind: 'deck', collection: this.url(`${base}/boards/${encode(board.id)}`), href: this.url(`${base}/boards/${encode(board.id)}/stacks`)};
      this.#revokedResources.delete(locator.collection);
      const collectionId = this.id('deck', board.id);
      const editable = board.permissions?.PERMISSION_EDIT === true;
      const collection = {...this.deckCollection(board), stacks: []};
      collections.push(collection);
      try {
        let saved = await this.cachedResource(locator, context);
        let savedStacks;
        try { savedStacks = saved && JSON.parse(saved.body); } catch { saved = null; }
        if (saved && !completeDeckStacks(savedStacks)) { saved = null; await this.resourceOperation('remove', locator, context); }
        const response = assertStatus(await this.sourceRequest(context, locator.href, {headers: {...headers, ...(saved ? {'If-None-Match': saved.etag} : {})}, allowNotModified: Boolean(saved)}), saved ? [304] : []);
        const stacks = response.status === 304 ? savedStacks : jsonBody(response);
        if (!Array.isArray(stacks)) throw fail('Deck returned an unexpected stack list.', 'FORMAT');
        if (response.status !== 304 && completeDeckStacks(stacks) && httpEtag(response.headers.get('ETag'))) await this.saveResource(locator, response.headers.get('ETag'), response.body, context);
        collection.stacks = stacks.filter(s => !s.deletedAt && nativeNumber(s.id)).map(s => ({ id: String(s.id), title: String(s.title || 'Untitled stack') }));
        for (const stack of stacks.filter(s => !s.deletedAt)) for (const card of list(stack.cards).filter(c => !c.deletedAt && !c.archived)) {
          context?.checkActive();
          if (!nativeNumber(card.id)) continue;
          const nativeDependencies = Array.isArray(card.dependentCards) ? [...new Set(card.dependentCards.filter(nativeNumber).map(id => this.id('deck', id)))] : [];
          const record = { id: this.id('deck', card.id), source: 'deck', kind: 'card', title: card.title || 'Untitled card', body: card.description || '', url: this.url(`index.php/apps/deck/board/${encode(board.id)}/card/${encode(card.id)}`), collectionId, collectionTitle: board.title, status: stack.title, stackId: String(stack.id), start: card.startdate || undefined, due: card.duedate || undefined, completed: Boolean(card.done), completedAt: completionDate(card.done), tags: deckLabels(card.labels).map(label => label.title), tagDetails: deckLabels(card.labels), color: normalizeColor(card.color), updatedAt: isoSeconds(card.lastModified), readonly: !editable || card.permissions?.PERMISSION_EDIT === false, etag: card.ETag ? String(card.ETag) : undefined, ...deckAssignments(card), nativeDependencies, identity: this.identity('deck', card.id, this.url(`${base}/boards/${encode(board.id)}/stacks/${encode(stack.id)}/cards/${encode(card.id)}`)), remote: { nativeId: card.id, boardId: board.id, stackId: stack.id, lastModified: card.lastModified, snapshot: card } };
          if (Number(card.attachmentCount) > 0 || card.attachments?.length > 0 || this.#deckAttachments.has(String(card.id)) || this.#knownDeckAttachments.has(String(card.id))) {
            try {
              const {attachments} = await this.readDeckAttachments(record, {cached: true, context});
              record.attachmentFileIds = [...new Set(attachments.flatMap(item => item.fileId ? [item.fileId] : []))];
            } catch (error) {
              if (['AUTH', 'CANCELLED', 'TIMEOUT'].includes(error.code)) throw error;
              // Undefined means unavailable, not deleted. The desktop cache
              // keeps prior attachment identities until a successful read.
              attachmentFailures++;
            }
          } else if (card.attachmentCount != null && Number(card.attachmentCount) === 0) record.attachmentFileIds = [];
          records.push(record);
        }
      } catch (error) {
        if (['AUTH', 'CANCELLED', 'TIMEOUT'].includes(error.code)) throw error;
        if (error.code === 'PERMISSION') { revokedCollectionIds.push(collectionId); await this.revokeResources('deck', locator.collection); }
        failures++;
      }
      completed++;
      context?.progress?.(['deck'], 'source-read', completed, visibleBoards.length, 'Checking Deck boards');
    }
    return { records, collections: collections.filter(c => !revokedCollectionIds.includes(c.id)), revokedCollectionIds, ...(failures ? {warning: `${failures} Deck board(s) could not be read.`} : attachmentFailures ? {metadataStale: true, message: `Cards loaded, but attachments on ${attachmentFailures} card(s) could not be refreshed. Open the card to retry.`} : {}) };
  }

  async readCollectives(context) {
    const base = 'ocs/v2.php/apps/collectives/api/v1.0/collectives';
    const data = ocsData(await this.sourceRequest(context, this.url(`${base}?format=json`)));
    const groups = Array.isArray(data) ? data : data?.collectives;
    if (!Array.isArray(groups)) throw fail('Collectives returned an unexpected list format.', 'FORMAT');
    const records = [];
    const collections = [];
    const revokedCollectionIds = [];
    let failures = 0;
    for (const group of groups.filter(g => !g.trashTimestamp)) {
      context?.checkActive();
      const title = group.name || group.title || 'Collective';
      const collectionId = this.id('collectives', group.id);
      collections.push({ id: collectionId, source: 'collectives', title, readonly: true, remote: { nativeId: group.id } });
      try {
        const pageData = ocsData(await this.sourceRequest(context, this.url(`${base}/${encode(group.id)}/pages?format=json`)));
        const pages = Array.isArray(pageData) ? pageData : pageData?.pages;
        if (!Array.isArray(pages)) throw fail('Collectives returned an unexpected page list.', 'FORMAT');
        for (const page of pages.filter(p => !p.trashTimestamp)) {
          const collectivePath = encode(group.slug ? `${group.slug}-${group.id}` : title);
          const pagePath = page.slug ? encode(`${page.slug}-${page.id}`) : [...String(page.filePath || '').split('/').filter(Boolean), ...(page.fileName === 'Readme.md' || page.parentId === 0 ? [] : [page.title || ''])].map(encode).join('/');
          records.push({ id: this.id('collectives', `${group.id}:${page.id}`), source: 'collectives', kind: 'page', title: page.title || 'Untitled page', body: typeof page.content === 'string' ? page.content : '', url: this.url(`index.php/apps/collectives/${collectivePath}${pagePath ? `/${pagePath}` : ''}`), collectionId, collectionTitle: title, updatedAt: isoSeconds(page.timestamp), readonly: true, tags: Array.isArray(page.tags) ? page.tags.filter(t => typeof t === 'string') : [], identity: this.identity('collectives', `${group.id}:${page.id}`), remote: { nativeId: page.id, collectiveId: group.id, parentId: page.parentId, collectivePath: page.collectivePath, fileName: page.fileName, filePath: page.filePath, linkedPageIds: page.linkedPageIds } });
        }
      } catch (error) {
        if (['AUTH', 'CANCELLED', 'TIMEOUT'].includes(error.code)) throw error;
        if (error.code === 'PERMISSION') revokedCollectionIds.push(collectionId);
        failures++;
      }
    }
    return { records, collections: collections.filter(c => !revokedCollectionIds.includes(c.id)), revokedCollectionIds, ...(failures ? { warning: `${failures} collective(s) could not be read.` } : { message: 'Select a page to read its content. Collaborative editing opens in Nextcloud.' }) };
  }

  async resolvePage(record) {
    if (record?.source !== 'collectives' || record.kind !== 'page' || !/^\d+$/.test(String(record.remote?.nativeId)) || !/^\d+$/.test(String(record.remote?.collectiveId))) throw fail('Select an available Collectives page.', 'VALIDATION');
    if (!this.discovered) await this.discover();
    const { nativeId, collectiveId } = record.remote;
    // PageInfo contains the actual mounted collective folder, including a user's
    // custom location and emoji. Refresh it so renamed/moved pages still open.
    const data = ocsData(await this.request(this.url(`ocs/v2.php/apps/collectives/api/v1.0/collectives/${encode(collectiveId)}/pages/${encode(nativeId)}?format=json`)));
    const page = data?.page;
    if (!page || String(page.id) !== String(nativeId)) throw fail('Collectives did not return the selected page.', 'FORMAT');
    if (page.trashTimestamp) throw fail('This Collectives page has been removed. Refresh the workspace.', 'UNAVAILABLE', 404);
    if (!page.collectivePath) throw fail('Collectives did not provide this page’s mounted file location. Open it in Nextcloud.', 'UNAVAILABLE');
    const collective = pathParts(page.collectivePath);
    const folder = pathParts(page.filePath, { empty: true });
    const filename = pathParts(page.fileName, { single: true });
    if (!/\.md$/i.test(filename[0])) throw fail('The selected Collectives page is not Markdown.', 'FORMAT');
    const filesRoot = this.url(`remote.php/dav/files/${encode(this.username)}/`);
    const collectiveUrl = `${filesRoot}${collective.map(encode).join('/')}/`;
    const href = `${collectiveUrl}${[...folder, ...filename].map(encode).join('/')}`;
    return { href, collectiveUrl };
  }

  async readPage(record) {
    const { href } = await this.resolvePage(record);
    const response = assertStatus(await this.request(href, { headers: { Accept: 'text/markdown, text/plain' }, maxBytes: 4 * 1024 * 1024 }));
    const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if (mime && !['text/markdown', 'text/x-markdown', 'text/plain', 'application/octet-stream'].includes(mime) || response.body.includes('\u0000')) throw fail('Collectives returned an unexpected page content format.', 'FORMAT');
    return { body: response.body, ...(response.headers.get('ETag') ? { etag: response.headers.get('ETag') } : {}), contentType: 'text/markdown' };
  }

  async readPageAsset(record, relativePath) {
    if (typeof relativePath !== 'string' || !relativePath || relativePath.length > 4096 || /^[a-z][a-z\d+.-]*:|^[\/\\]|[\\\u0000-\u001f\u007f]/i.test(relativePath)) throw fail('Only images attached within this collective can be loaded.', 'SECURITY');
    const { href, collectiveUrl } = await this.resolvePage(record);
    let asset;
    try { asset = new URL(relativePath, href); } catch { throw fail('This page image has an invalid path.', 'SECURITY'); }
    if (asset.search || asset.hash || asset.username || asset.password || asset.origin !== new URL(collectiveUrl).origin) throw fail('This page image has an unsafe path.', 'SECURITY');
    let decoded;
    try { decoded = decodeURIComponent(asset.pathname); } catch { throw fail('This page image has an invalid path.', 'SECURITY'); }
    const rootPath = decodeURIComponent(new URL(collectiveUrl).pathname);
    // Decode once to reject encoded separators, traversal and double-encoded
    // paths before authorizing the request. Never allow an image to read another
    // account's Files or another collective through the authenticated bridge.
    if (!decoded.startsWith(rootPath) || /[\\\u0000-\u001f\u007f]|%[\da-f]{2}/i.test(decoded) || decoded.split('/').some(p => p === '.' || p === '..')) throw fail('This page image is outside its collective.', 'SECURITY');
    const response = assertStatus(await this.request(asset.href, { binary: true, maxBytes: 4 * 1024 * 1024, headers: { Accept: 'image/png, image/jpeg, image/gif, image/webp' } }));
    return { dataUrl: rasterDataUrl(response) };
  }

  filesUrl(path = '/') {
    return this.url(`remote.php/dav/files/${encode(this.username)}${cloudFilePath(path).split('/').map(encode).join('/')}`);
  }

  cloudFiles(responses) {
    const root = new URL(this.filesUrl('/')).pathname;
    return responses.flatMap(response => {
      if (response.denied) return [];
      const href = new URL(sameOrigin(this.serverUrl, response.href));
      if (!href.pathname.startsWith(root)) return [];
      let path;
      try { path = cloudFilePath(`/${href.pathname.slice(root.length).split('/').map(decodeURIComponent).join('/')}`); } catch { return []; }
      const props = response.properties, id = String(scalar(props.fileid));
      if (!nativeNumber(id)) return [];
      const size = Number(scalar(props.getcontentlength));
      return [{ id, path, name: String(scalar(props.displayname) || path.split('/').at(-1) || 'Files'), directory: Boolean(props.resourcetype && Object.hasOwn(props.resourcetype, 'collection')), ...(Number.isFinite(size) && size >= 0 ? {size} : {}), mimeType: String(scalar(props.getcontenttype) || '') }];
    });
  }

  async listFiles({ path = '/' } = {}) {
    path = cloudFilePath(path);
    const rows = multistatus(await this.request(this.filesUrl(path), {method: 'PROPFIND', headers: {Depth: '1', 'Content-Type': 'application/xml'}, body: filesPropfind(fileProperties)}));
    const files = this.cloudFiles(rows).filter(file => file.path !== path);
    if (files.length > 5000) throw fail('This folder is too large. Choose a smaller folder in Nextcloud Files.', 'LIMIT');
    return {path, files: files.sort((a,b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))};
  }

  async findFileById(fileId) {
    if (!nativeNumber(fileId)) throw fail('The note has no valid Nextcloud file identity.', 'VALIDATION');
    if (this.#fileLookupMode === 'notes-propfind') return this.findNoteFileById(fileId);
    // Resolve by immutable file ID, never by the mutable note title/category.
    const body = `<?xml version="1.0"?><d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:basicsearch><d:select><d:prop>${fileProperties}</d:prop></d:select><d:from><d:scope><d:href>${xmlText(`/files/${this.username}`)}</d:href><d:depth>infinity</d:depth></d:scope></d:from><d:where><d:eq><d:prop><oc:fileid/></d:prop><d:literal>${fileId}</d:literal></d:eq></d:where><d:orderby/><d:limit><d:nresults>2</d:nresults></d:limit></d:basicsearch></d:searchrequest>`;
    const matches = this.cloudFiles(multistatus(await this.request(this.url('remote.php/dav/'), {method: 'SEARCH', headers: {'Content-Type': 'application/xml'}, body}))).filter(file => file.id === String(fileId));
    if (matches.length !== 1 || matches[0].directory) throw fail('The note file could not be found in your Nextcloud Files. Refresh Notes and try again.', 'UNAVAILABLE');
    return matches[0];
  }

  async findNoteFileById(fileId) {
    if (!nativeNumber(fileId)) throw fail('The note has no valid Nextcloud file identity.', 'VALIDATION');
    const settings = jsonBody(assertStatus(await this.request(this.url('index.php/apps/notes/api/v1/settings'))));
    if (typeof settings?.notesPath !== 'string' || !settings.notesPath.trim()) throw fail('Nextcloud Notes did not provide its folder. Open Notes settings and try again.', 'UNAVAILABLE');
    const root = cloudFilePath(settings.notesPath);
    if (root === '/') throw fail('Choose a dedicated Notes folder before attaching notes through this connection.', 'VALIDATION');
    const queue = [{path: root, depth: 0}], seen = new Set([root]), matches = new Map();
    let entries = 0;
    for (let index = 0; index < queue.length; index++) {
      const folder = queue[index];
      const rows = multistatus(await this.request(this.filesUrl(folder.path), {method: 'PROPFIND', headers: {Depth: '1', 'Content-Type': 'application/xml'}, body: filesPropfind(fileProperties)}));
      if (rows.some(row => row.denied)) throw fail('Part of your Notes folder is inaccessible. Refresh access before attaching this note.', 'PERMISSION');
      entries += rows.length;
      if (entries > 10000) throw fail('The Notes folder exceeds the safe lookup limit. Attach the file using Other files instead.', 'LIMIT');
      const files = this.cloudFiles(rows);
      if (files.length !== rows.length) throw fail('Part of the Notes folder could not be identified safely. Choose the file in Other files instead.', 'UNAVAILABLE');
      if (!files.some(file => file.path === folder.path && file.directory)) throw fail('The configured Notes folder could not be verified.', 'UNAVAILABLE');
      for (const file of files) {
        if (file.path === folder.path) continue;
        // A Depth-1 response may not redirect traversal outside the configured
        // subtree, or skip intermediate directories through an injected href.
        if (!file.path.startsWith(root + '/') || file.path.slice(0, file.path.lastIndexOf('/')) !== folder.path) throw fail('Nextcloud returned a file outside the requested Notes folder.', 'SECURITY');
        if (file.id === String(fileId)) matches.set(file.path, file);
        if (file.directory && !seen.has(file.path)) {
          if (folder.depth >= 16 || seen.size >= 256) throw fail('The Notes folder exceeds the safe lookup limit. Attach the file using Other files instead.', 'LIMIT');
          seen.add(file.path); queue.push({path: file.path, depth: folder.depth + 1});
        }
      }
    }
    if (matches.size !== 1 || [...matches.values()][0].directory) throw fail('The note file could not be identified uniquely in your Notes folder. Refresh Notes or choose it in Other files.', 'UNAVAILABLE');
    return [...matches.values()][0];
  }

  attachmentUrl(record) { return this.deckCardUrl(record).replace('/api/v1.0/', '/api/v1.1/') + '/attachments'; }

  normalizeDeckAttachments(raw, record) {
    if (!Array.isArray(raw)) throw fail('Deck returned an unexpected attachment list.', 'FORMAT');
    return raw.filter(item => item && nativeNumber(item.id) && !item.deletedAt && ['file', 'deck_file'].includes(item.type)).map(item => {
      const extra = item.extendedData || {}, fileId = nativeNumber(extra.fileid) ? String(extra.fileid) : undefined;
      let path;
      try { if (extra.path) path = cloudFilePath(extra.path); } catch { /* Do not expose an unsafe path. */ }
      return {id: String(item.id), type: item.type, name: String(item.data || extra.data || 'Attachment').slice(0, 1000), ...(fileId ? {fileId} : {}), ...(path ? {path} : {}), url: fileId ? this.url(`index.php/f/${encode(fileId)}`) : `${this.attachmentUrl(record)}/${encode(item.id)}?type=${encode(item.type)}`, ...(Number.isFinite(Number(extra.filesize)) ? {size: Number(extra.filesize)} : {}), mimeType: String(extra.mimetype || '')};
    });
  }

  async readDeckAttachments(record, { cached = false, context } = {}) {
    const key = String(record.remote?.nativeId), version = `${record.remote?.lastModified ?? ''}:${record.remote?.snapshot?.attachmentCount ?? ''}`;
    const previous = this.#deckAttachments.get(key);
    if (cached && previous?.version === version && this.#now().getTime() - previous.readAt < 120000) return {attachments: structuredClone(previous.attachments)};
    const epoch = (this.#attachmentReads.get(key) ?? 0) + 1;
    this.#attachmentReads.set(key, epoch);
    let attachments = this.normalizeDeckAttachments(jsonBody(assertStatus(await this.sourceRequest(context, this.attachmentUrl(record)))), record);
    if (this.#attachmentReads.get(key) === epoch) this.#deckAttachments.set(key, {version, attachments, readAt: this.#now().getTime()});
    else attachments = this.#deckAttachments.get(key)?.attachments ?? attachments;
    return {attachments};
  }

  async assertDeckAttachmentWritable(record) {
    if (record.readonly) throw fail('This Deck card is read-only.', 'PERMISSION');
    const card = jsonBody(assertStatus(await this.request(this.deckCardUrl(record))));
    if (String(card?.id) !== String(record.remote.nativeId) || String(card.stackId) !== String(record.remote.stackId) || card.deletedAt || card.archived) throw fail('This Deck card moved or is no longer available. Refresh before attaching a file.', 'CONFLICT');
    if (card.permissions?.PERMISSION_EDIT === false || card.relatedBoard?.permissions?.PERMISSION_EDIT === false) throw fail('This Deck card is read-only.', 'PERMISSION');
  }

  async attachDeckFile({ path, note }, record) {
    await this.assertDeckAttachmentWritable(record);
    let file;
    if (note) {
      if (note.source !== 'notes') throw fail('Choose an available Nextcloud note.', 'VALIDATION');
      file = await this.findFileById(note.remote?.nativeId);
    } else {
      path = cloudFilePath(path);
      file = this.cloudFiles(multistatus(await this.request(this.filesUrl(path), {method: 'PROPFIND', headers: {Depth: '0', 'Content-Type': 'application/xml'}, body: filesPropfind(fileProperties)}))).find(candidate => candidate.path === path);
      if (!file || file.directory) throw fail('Choose a file, rather than a folder, to attach to this card.', 'VALIDATION');
    }
    const current = await this.readDeckAttachments(record);
    if (current.attachments.some(item => item.fileId === file.id)) return current;
    // This is the native Files -> Deck share, not a public link or a copied note.
    // Deck controls access through the card's board membership; read-only is sufficient.
    const response = await this.request(this.url('ocs/v2.php/apps/files_sharing/api/v1/shares?format=json'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path: file.path, shareType: 12, shareWith: String(record.remote.nativeId), permissions: 1})});
    try { ocsData(response); }
    catch (error) {
      if (error.code !== 'CONFLICT') throw error;
      const retry = await this.readDeckAttachments(record);
      if (retry.attachments.some(item => item.fileId === file.id)) return retry;
      throw error;
    }
    const verified = await this.readDeckAttachments(record);
    if (!verified.attachments.some(item => item.fileId === file.id)) throw fail('Nextcloud accepted the attachment, but Deck has not returned it yet. Refresh attachments before trying again.', 'UNAVAILABLE');
    return verified;
  }

  async removeDeckAttachment({ attachmentId }, record) {
    if (!nativeNumber(attachmentId)) throw fail('Choose a valid Deck attachment.', 'VALIDATION');
    await this.assertDeckAttachmentWritable(record);
    const current = await this.readDeckAttachments(record);
    const attachment = current.attachments.find(item => item.id === String(attachmentId));
    if (!attachment) return current;
    // Only detach native file shares. Never delete a legacy deck_file's contents.
    if (attachment.type !== 'file') throw fail('Remove this legacy attachment in Deck.', 'VALIDATION');
    assertStatus(await this.request(`${this.attachmentUrl(record)}/${encode(attachment.id)}?type=file`, {method: 'DELETE'}));
    const verified = await this.readDeckAttachments(record);
    if (verified.attachments.some(item => item.id === attachment.id)) throw fail('Deck has not confirmed detaching this file yet. Refresh attachments before trying again.', 'UNAVAILABLE');
    return verified;
  }

  async uploadDeckAttachment({ name, bytes }, record) {
    if (typeof name !== 'string' || !name || /[\/\\\u0000-\u001f]/.test(name) || !(bytes instanceof Uint8Array) || bytes.length > 20 * 1024 * 1024) throw fail('Choose a file up to 20 MB to upload.', 'VALIDATION');
    await this.assertDeckAttachmentWritable(record);
    const data = new FormData();
    data.set('type', 'file'); data.set('data', name); data.set('file', new Blob([bytes]), name);
    assertStatus(await this.request(this.attachmentUrl(record), {method: 'POST', body: data}));
    return this.readDeckAttachments(record);
  }

  async fileTags(path, depth = '1', context) {
    const properties = '<oc:id/><oc:display-name/><oc:user-visible/><oc:user-assignable/><oc:can-assign/><nc:color/>';
    return multistatus(await this.sourceRequest(context, this.url(`remote.php/dav/${path}`), {method: 'PROPFIND', headers: {Depth: depth, 'Content-Type': 'application/xml'}, body: filesPropfind(properties)})).flatMap(row => {
      const p = row.properties, id = String(scalar(p.id)), title = String(scalar(p['display-name']));
      if (row.denied || !nativeNumber(id) || !title || String(scalar(p['user-visible'])) === 'false') return [];
      const assignable = ['true','1'].includes(String(scalar(p['can-assign'] ?? p['user-assignable'])));
      const color = normalizeColor(String(scalar(p.color)));
      return [{id, title, assignable, ...(color ? {color} : {})}];
    });
  }

  async readNoteTags(record) {
    if (record?.source !== 'notes' || !nativeNumber(record.remote?.nativeId)) throw fail('Choose an available Nextcloud note.', 'VALIDATION');
    const key = String(record.remote.nativeId), epoch = (this.#noteTagReads.get(key) ?? 0) + 1;
    this.#noteTagReads.set(key, epoch);
    // Opening a note must not enumerate an instance's potentially huge tag
    // catalog. The picker gets suggestions from sources already loaded by the app.
    const tags = await this.fileTags(`systemtags-relations/files/${encode(record.remote.nativeId)}`);
    if (this.#noteTagReads.get(key) === epoch) this.#noteTags.set(key, tags);
    const assigned = this.#noteTags.get(key) ?? tags;
    return {tags: assigned, availableTags: assigned};
  }

  async setNoteTags({ tagIds, newTags = [] }, record) {
    if (record?.readonly) throw fail('This note is read-only.', 'PERMISSION');
    if (!Array.isArray(tagIds) || tagIds.length > 100 || tagIds.some(id => !nativeNumber(id)) || !Array.isArray(newTags) || newTags.length > 20 || newTags.some(name => typeof name !== 'string' || !name.trim() || /[\u0000-\u001f]/.test(name))) throw fail('Choose valid note tags.', 'VALIDATION');
    // Nextcloud's native system-tag name column is 64 bytes. Do not let the
    // server silently truncate a newly entered name into a different tag.
    if (newTags.some(name => byteLength(name.trim()) > 64)) throw fail('Note tag names must fit within 64 bytes in Nextcloud. Shorten this tag name.', 'VALIDATION');
    const current = await this.readNoteTags(record);
    const wanted = new Set(tagIds.map(String));
    const readAssignable = async id => {
      const match = (await this.fileTags(`systemtags/${encode(id)}`, '0')).find(tag => tag.id === id && tag.assignable);
      if (!match) throw fail('One of these tags cannot be assigned by your account.', 'PERMISSION');
      return match;
    };
    for (const id of wanted) if (!current.tags.some(tag => tag.id === id)) await readAssignable(id);
    // Restricted tags stay attached, even when omitted from the editable selection.
    for (const tag of current.tags.filter(tag => !tag.assignable)) wanted.add(tag.id);
    let catalog;
    const existingByName = async name => {
      // DAV has no filtered system-tag listing. Only an existing-name collision
      // (or a missing creation Location header) requires this fallback, once per
      // save. Never send this catalog to the renderer as picker suggestions.
      catalog ??= await this.fileTags('systemtags/');
      return catalog.find(tag => tag.title.toLocaleLowerCase() === name.toLocaleLowerCase() && tag.assignable);
    };
    for (const name of [...new Set(newTags.map(name => name.trim()))]) {
      let match = current.tags.find(tag => tag.title.toLocaleLowerCase() === name.toLocaleLowerCase() && tag.assignable);
      if (!match) {
        const known = [...this.#noteTags.values()].flat().find(tag => tag.title.toLocaleLowerCase() === name.toLocaleLowerCase() && tag.assignable);
        if (known) {
          const refreshed = await readAssignable(known.id);
          if (refreshed.title.toLocaleLowerCase() === name.toLocaleLowerCase()) match = refreshed;
        }
      }
      if (!match) {
        const response = await this.request(this.url('remote.php/dav/systemtags/'), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, userVisible: true, userAssignable: true})});
        assertStatus(response, [403, 409]);
        if (response.status < 300) {
          const location = response.headers.get('Content-Location') || response.headers.get('Location');
          if (location) {
            let target;
            try { target = new URL(location, this.url('remote.php/dav/systemtags/')); } catch { /* Fall back to native lookup below. */ }
            const base = new URL(this.url('remote.php/dav/systemtags/'));
            const id = target?.pathname.startsWith(base.pathname) ? target.pathname.slice(base.pathname.length) : '';
            if (target?.origin === base.origin && !target.username && !target.password && nativeNumber(id)) match = await readAssignable(id);
          }
        }
        match ??= await existingByName(name);
        if (!match) throw fail('Nextcloud could not create this tag. Your administrator may restrict tag creation.', 'PERMISSION');
      }
      wanted.add(match.id);
    }
    const base = this.url(`remote.php/dav/systemtags-relations/files/${encode(record.remote.nativeId)}`);
    for (const id of wanted) if (!current.tags.some(tag => tag.id === id)) assertStatus(await this.request(`${base}/${encode(id)}`, {method: 'PUT', body: ''}));
    for (const tag of current.tags) if (tag.assignable && !wanted.has(tag.id)) assertStatus(await this.request(`${base}/${encode(tag.id)}`, {method: 'DELETE'}), [404]);
    return this.readNoteTags(record);
  }

  async readRelatedResources(record) {
    // Related resources is a server-side recommendation engine based on sharing.
    // Deck's provider uses board IDs; Notes uses the Files provider and file ID.
    const provider = record?.source === 'deck' ? 'deck' : record?.source === 'notes' ? 'files' : null;
    const id = record?.source === 'deck' ? record.remote?.boardId : record?.remote?.nativeId;
    if (!provider || !nativeNumber(id)) return {available: false, resources: []};
    const response = await this.request(this.url(`ocs/v2.php/apps/related_resources/related/${provider}/${encode(id)}?format=json`));
    if ([403,404,405,501].includes(response.status)) return {available: false, resources: []};
    const raw = ocsData(response);
    if (!Array.isArray(raw)) throw fail('Related resources returned an unexpected response.', 'FORMAT');
    const resources = raw.slice(0,100).flatMap(item => {
      if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') return [];
      let url;
      try { const parsed = new URL(item.url, `${this.serverUrl}/`); if (parsed.origin !== new URL(this.serverUrl).origin || parsed.username || parsed.password || !['https:','http:'].includes(parsed.protocol)) return []; url = parsed.href; } catch { return []; }
      return [{providerId: String(item.providerId || ''), itemId: String(item.itemId || ''), title: item.title.slice(0,500), subtitle: String(item.subtitle || '').slice(0,300), url}];
    });
    return {available: true, resources};
  }

  async createNote({ title, content = '', category = '' }) {
    if (typeof title !== 'string' || !title.trim() || typeof content !== 'string' || typeof category !== 'string') throw fail('Enter a note title and text.', 'VALIDATION');
    return jsonBody(assertStatus(await this.request(this.url('index.php/apps/notes/api/v1/notes'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), content, category }) })));
  }

  async readNote(record) {
    if (record?.source !== 'notes' || !nativeNumber(record.remote?.nativeId)) throw fail('Choose an available Nextcloud note.', 'VALIDATION');
    return checkedNoteSnapshot(jsonBody(assertStatus(await this.request(this.url(`index.php/apps/notes/api/v1/notes/${encode(record.remote.nativeId)}`), {headers: {'Cache-Control': 'no-cache'}}))), record.remote.nativeId);
  }

  async updateNote({ title, content, category, etag, base }, record) {
    if (record?.source !== 'notes' || record.readonly || record.remote?.nativeId == null) throw fail('This note cannot be edited here.', 'VALIDATION');
    if (typeof title !== 'string' || !title.trim() || title.length > 500 || typeof content !== 'string' || content.length > 500000) throw fail('Enter a valid note title and text.', 'VALIDATION');
    let revision = noteEtag(etag ?? record.etag);
    if (!revision) throw fail('Refresh this note before editing; a valid version identifier is required.', 'CONFLICT');
    if (category !== undefined && (typeof category !== 'string' || category.length > 200 || /[\u0000-\u001f]/.test(category))) throw fail('Choose a valid note category.', 'VALIDATION');
    if (base !== undefined && (!base || typeof base !== 'object' || Array.isArray(base) || typeof base.title !== 'string' || base.title.length > 500 || typeof base.content !== 'string' || base.content.length > 500000 || base.category !== undefined && (typeof base.category !== 'string' || base.category.length > 200))) throw fail('The note edit reference is invalid. Reopen the note before saving.', 'VALIDATION');
    if (base === undefined && etag !== undefined && noteEtag(record.etag) !== revision) throw fail('This note changed while it was being edited. Review the current note before saving; your edit is preserved.', 'CONFLICT');
    const reference = base ?? {title: record.title, content: record.body, category: record.remote?.category};
    const desired = {title: title.trim(), content, ...(category !== undefined ? {category} : {})};
    let patch = desired;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.request(this.url(`index.php/apps/notes/api/v1/notes/${encode(record.remote.nativeId)}`), {method: 'PUT', headers: {'Content-Type': 'application/json', 'If-Match': revision}, body: JSON.stringify(patch)});
      if (response.status !== 412) return jsonBody(assertStatus(response));
      // The Notes API returns its current representation with a 412 response.
      // Merge independent attribute edits only; never replace concurrent text.
      let latest;
      try { latest = checkedNoteSnapshot(jsonBody(response), record.remote.nativeId); }
      catch { throw fail('This note changed on Nextcloud. Review the current note before saving; your edit is preserved.', 'CONFLICT', 412); }
      patch = noteRetryPatch(desired, reference, latest);
      if (!Object.keys(patch).length) return latest;
      revision = noteEtag(latest.etag);
    }
    throw fail('This note kept changing on Nextcloud during saving. Your edit is preserved; review the current note and try again.', 'CONFLICT', 412);
  }

  async savedRecord(record, collection, saved) {
    // A successful source write already contains its new representation. Reuse
    // it instead of refreshing every calendar, board, note and collective. Only
    // fetch the one resource when its write response lacks enough information.
    if (!record || !collection || record.source !== collection.source) throw fail('The edited source is no longer available. Refresh the workspace.', 'UNAVAILABLE');
    if(record.source==='calendar'&&saved?.verifiedCollection?.id===collection.id&&saved.verifiedCollection.source==='calendar'&&saved.verifiedCollection.remote?.href===collection.remote?.href)collection=saved.verifiedCollection;
    if (record.source === 'tasks' || record.source === 'calendar') {
      let raw = saved?.raw, etag = saved?.etag;
      if (typeof raw !== 'string' || typeof etag !== 'string' || !etag || etag === '*') {
        const headers = record.source === 'calendar' ? calendarReadHeaders : {Accept: 'text/calendar'};
        const response = assertStatus(await this.request(record.remote.href, {headers, maxBytes: 2 * 1024 * 1024}));
        raw = response.body; etag = response.headers.get('ETag') || undefined;
      }
      const items = this.calendarRecords(raw, record.remote.href, etag, collection, new Date(-8640000000000000), new Date(8640000000000000));
      const item = items.find(value => value.remote.uid === record.remote.uid);
      if (!item || items.length !== 1) throw fail('The source saved this change, but its latest representation could not be read. Refresh before editing again.', 'UNAVAILABLE');
      return { ...item, id: record.id };
    }
    if (record.source === 'notes') {
      let note = saved;
      if (!note || String(note.id) !== String(record.remote.nativeId) || typeof note.content !== 'string' || typeof note.title !== 'string' || !note.etag) {
        note = jsonBody(assertStatus(await this.request(this.url(`index.php/apps/notes/api/v1/notes/${encode(record.remote.nativeId)}`))));
      }
      if (!note || String(note.id) !== String(record.remote.nativeId) || typeof note.content !== 'string') throw fail('The saved note could not be read. Refresh before editing again.', 'UNAVAILABLE');
      const category = String(note.category ?? record.remote.category ?? '');
      const fileTags = this.#noteTags.get(String(note.id)) ?? record.fileTags;
      return { ...record, fileId: String(note.id), title: note.title || 'Untitled note', body: note.content, collectionId: this.id('notes', `category:${category}`), collectionTitle: category || 'Uncategorized (default)', updatedAt: isoSeconds(note.modified), readonly: Boolean(note.readonly) || !note.etag, etag: note.etag, tags: [...(note.favorite ? ['Favorite'] : []), ...(fileTags || []).map(tag => tag.title)], ...(fileTags ? {fileTags, tagDetails: fileTags} : {}), remote: { ...record.remote, category } };
    }
    if (record.source === 'deck') {
      let card = saved;
      if (!card || String(card.id) !== String(record.remote.nativeId) || !['title', 'description', 'type', 'order', 'stackId', 'lastModified', 'done'].every(key => Object.hasOwn(card, key))) {
        const locator = { ...record, remote: { ...record.remote, stackId: card?.stackId ?? record.remote.stackId } };
        const response = assertStatus(await this.request(this.deckCardUrl(locator), {headers: {'Cache-Control': 'no-cache'}}));
        card = jsonBody(response);
        if (card && response.headers.get('ETag')) card = {...card, ETag: response.headers.get('ETag')};
      }
      if (!card || String(card.id) !== String(record.remote.nativeId) || !nativeNumber(card.stackId) || card.deletedAt || card.archived) throw fail('The saved Deck card moved or is no longer available. Refresh the board.', 'UNAVAILABLE');
      const stack = collection.stacks?.find(value => String(value.id) === String(card.stackId));
      if (!stack) throw fail('The saved Deck card moved to an unknown stack. Refresh the board.', 'UNAVAILABLE');
      const nativeDependencies = Array.isArray(card.dependentCards) ? [...new Set(card.dependentCards.filter(nativeNumber).map(id => this.id('deck', id)))] : record.nativeDependencies ?? record.nativeDependents ?? record.nativeRelatedIds ?? [];
      const { nativeRelatedIds: legacyLinks, nativeDependents: legacyDependents, ...currentRecord } = record;
      return { ...currentRecord, title: card.title || 'Untitled card', body: card.description || '', status: stack.title, stackId: String(card.stackId), start: card.startdate || undefined, due: card.duedate || undefined, completed: Boolean(card.done), completedAt: completionDate(card.done), tags: deckLabels(card.labels).map(label => label.title), tagDetails: deckLabels(card.labels), color: normalizeColor(card.color), updatedAt: isoSeconds(card.lastModified), readonly: Boolean(collection.readonly) || card.permissions?.PERMISSION_EDIT === false || card.relatedBoard?.permissions?.PERMISSION_EDIT === false, etag: card.ETag ? String(card.ETag) : undefined, ...deckAssignments(card), nativeDependencies, identity: this.identity('deck', card.id, this.deckCardUrl({ ...record, remote: { ...record.remote, stackId: card.stackId } })), remote: { ...record.remote, stackId: card.stackId, lastModified: card.lastModified, snapshot: card } };
    }
    throw fail('This source cannot be edited here.', 'VALIDATION');
  }

  async createDeckLabel({title, color}, collection) {
    if (collection?.source !== 'deck' || collection.readonly || !nativeNumber(collection.remote?.nativeId)) throw fail('Choose a writable Deck board.', 'VALIDATION');
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 100 || /[\u0000-\u001f]/.test(title)) throw fail('Enter a Deck tag name of up to 100 characters.', 'VALIDATION');
    if (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) throw fail('Choose a six-digit tag color.', 'VALIDATION');
    const boardId = String(collection.remote.nativeId);
    const url = this.url(`index.php/apps/deck/api/v1.0/boards/${encode(boardId)}`);
    const board = await this.freshDeckBoard(boardId, collection.id);
    const existing = deckLabels(board.labels).find(label => label.title.toLocaleLowerCase() === title.trim().toLocaleLowerCase());
    if (existing) return existing;
    const nativeColor = (color || normalizeColor(collection.color) || '#0082c9').slice(1);
    const saved = jsonBody(assertStatus(await this.request(`${url}/labels`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: title.trim(), color: nativeColor})})));
    const label = deckLabels([saved])[0];
    if (!label || saved.boardId != null && String(saved.boardId) !== boardId) throw fail('Deck did not return the new tag. Refresh the board before adding it again.', 'FORMAT');
    return label;
  }

  async updateRecordAppearance({color, tags, tagIds, etag}, record, collection) {
    if (!['tasks', 'calendar', 'deck'].includes(record?.source) || record.readonly || collection?.readonly || collection?.id !== record.collectionId) throw fail('This item is read-only or its source is unavailable. Refresh before editing.', 'PERMISSION');
    if (color !== undefined && (typeof color !== 'string' || color !== '' && !/^#[a-f\d]{6}$/i.test(color))) throw fail('Choose a six-digit item color, or use the source color.', 'VALIDATION');
    if (color === undefined && tags === undefined && tagIds === undefined) throw fail('Choose a color or tags to save.', 'VALIDATION');
    if (etag !== undefined && (typeof etag !== 'string' || !etag || etag === '*' || /[\r\n\0]/.test(etag) || etag !== record.etag)) throw fail('This item changed while its appearance was being edited. Refresh before saving.', 'CONFLICT');
    const desiredColor = color ? normalizeColor(color) : undefined;
    if (record.source === 'deck') {
      if (tags !== undefined) throw fail('Choose native Deck labels for this board.', 'VALIDATION');
      if (tagIds !== undefined && (!Array.isArray(tagIds) || tagIds.length > 100 || tagIds.some(id => !nativeNumber(id) || !collection.labels?.some(label => String(label.id) === String(id))))) throw fail('Choose labels from this Deck board. Refresh if a label is missing.', 'VALIDATION');
      const {card, url, etag: revision} = await this.freshDeckCard(record);
      if (tagIds !== undefined && !sameValues(deckLabels(card.labels).map(label => label.id), deckLabels(record.remote.snapshot.labels).map(label => label.id))) throw fail('The card labels changed in Deck. Refresh before saving.', 'CONFLICT');
      if (color !== undefined) {
        if (!Object.hasOwn(card, 'color')) throw fail('This Deck server does not expose native card colors. Update Deck or edit the card in Nextcloud.', 'UNAVAILABLE');
        const owner = typeof card.owner === 'string' ? card.owner : card.owner?.uid ?? card.owner?.primaryKey;
        if (typeof owner !== 'string' || !owner || typeof card.title !== 'string' || typeof card.type !== 'string' || !Number.isInteger(card.order)) throw fail('Deck returned incomplete card data. Refresh before editing.', 'FORMAT');
        // Deck renders '#' + card.color; its native value omits the hash.
        const body = {title: card.title, type: card.type, owner, description: card.description || '', order: card.order, duedate: card.duedate ?? null, startdate: card.startdate ?? null, archived: Boolean(card.archived), done: card.done ?? null, color: desiredColor?.slice(1) ?? null};
        assertStatus(await this.request(url, {method: 'PUT', headers: {'Content-Type': 'application/json', ...(revision && revision !== '*' ? {'If-Match': revision} : {})}, body: JSON.stringify(body)}));
      }
      if (tagIds !== undefined) {
        const desired = [...new Set(tagIds.map(String))];
        const existing = deckLabels(card.labels).map(label => label.id);
        // These endpoints change assignments only; label definitions and other
        // card content stay in Deck. A final GET detects unsupported writes.
        for (const id of existing.filter(id => !desired.includes(id))) assertStatus(await this.request(`${url}/removeLabel`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({labelId: Number(id)})}));
        for (const id of desired.filter(id => !existing.includes(id))) assertStatus(await this.request(`${url}/assignLabel`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({labelId: Number(id)})}));
      }
      const saved = jsonBody(assertStatus(await this.request(url)));
      if (String(saved?.id) !== String(card.id) || color !== undefined && normalizeColor(saved?.color) !== desiredColor || tagIds !== undefined && !sameValues(deckLabels(saved?.labels).map(label => label.id), tagIds.map(String))) throw fail('Deck did not confirm all color and tag changes. Refresh and check the card before retrying; some changes may already be saved.', 'UNAVAILABLE');
      return saved;
    }
    if (tagIds !== undefined) throw fail('Calendar items use tag names, not Deck label IDs.', 'VALIDATION');
    if (tags !== undefined && (!Array.isArray(tags) || tags.length > 100 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 200 || /[\x00-\x1f]/.test(tag)))) throw fail('Enter up to 100 tags, each between 1 and 200 characters.', 'VALIDATION');
    if (!record.remote?.raw || !record.remote?.href || record.remote.recurrenceId) throw fail('Recurring items and invitations must be edited in Nextcloud.', 'VALIDATION');
    const revision = etag || record.etag;
    if (typeof revision !== 'string' || !revision || revision === '*' || /[\r\n\0]/.test(revision)) throw fail('Refresh before editing; a version identifier is required.', 'CONFLICT');
    const calendar = parseCalendar(record.remote.raw);
    const kind = record.source === 'tasks' ? 'vtodo' : 'vevent';
    const item = calendar.getFirstSubcomponent(kind);
    if (!item || (kind === 'vtodo' ? isComplexTask(calendar, item) : isComplexEvent(calendar, item)) || item.getFirstPropertyValue('uid') !== record.remote.uid) throw fail('This source item changed or cannot be edited here. Refresh and open it in Nextcloud.', 'CONFLICT');
    if (color !== undefined) {
      item.removeAllProperties('color');
      if (desiredColor) item.addPropertyWithValue('color', desiredColor);
    }
    const desiredTags = tags === undefined ? undefined : [...new Set(tags.map(tag => tag.trim()))];
    if (desiredTags !== undefined) {
      item.removeAllProperties('categories');
      if (desiredTags.length) { const categories = new ICAL.Property('categories'); categories.setValues(desiredTags); item.addProperty(categories); }
    }
    touchCalendarItem(item, this.#now());
    assertStatus(await this.request(record.remote.href, {method: 'PUT', headers: {'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': revision}, body: calendar.toString()}));
    const response = assertStatus(await this.request(record.remote.href, {headers: {Accept: 'text/calendar'}, maxBytes: 2 * 1024 * 1024}));
    const saved = parseCalendar(response.body).getFirstSubcomponent(kind);
    if (!saved || saved.getFirstPropertyValue('uid') !== record.remote.uid || color !== undefined && normalizeColor(saved.getFirstPropertyValue('color')) !== desiredColor || desiredTags !== undefined && !sameValues(tagsOf(saved), desiredTags)) throw fail('Nextcloud did not confirm all color and tag changes. Refresh before retrying; some changes may already be saved.', 'UNAVAILABLE');
    return {raw: response.body, etag: response.headers.get('ETag')};
  }

  async updateDescription({ description, etag }, record) {
    if (typeof description !== 'string' || description.length > 500000 || description.includes('\0')) throw fail('Enter a description of at most 500,000 characters.', 'VALIDATION');
    if (!['tasks', 'calendar', 'deck'].includes(record?.source) || record.readonly) throw fail('This description cannot be edited here. Open the item in Nextcloud.', 'VALIDATION');
    if (etag !== undefined && (typeof etag !== 'string' || !etag || etag === '*' || etag.length > 1000 || /[\r\n\0]/.test(etag))) throw fail('Refresh this item before editing; a valid version identifier is required.', 'CONFLICT');
    if (etag !== undefined && etag !== record.etag) throw fail('This item changed while its description was being edited. Refresh and reopen it before saving.', 'CONFLICT');
    if (record.source === 'deck') {
      const { card, url, etag: currentEtag } = await this.freshDeckCard(record);
      const owner = typeof card.owner === 'string' ? card.owner : card.owner?.uid ?? card.owner?.primaryKey;
      if (typeof owner !== 'string' || !owner || typeof card.title !== 'string' || typeof card.type !== 'string' || !Number.isInteger(card.order)) throw fail('Deck returned incomplete card data. Open the card in Nextcloud.', 'FORMAT');
      // The public Deck REST API updates the complete card. Preserve every
      // unrelated update field from the fresh snapshot, including completion.
      const body = { title: card.title, type: card.type, owner, description, order: card.order, duedate: card.duedate ?? null, startdate: card.startdate ?? null, archived: Boolean(card.archived), done: card.done ?? null, color: card.color ?? null };
      const result = jsonBody(assertStatus(await this.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(currentEtag && currentEtag !== '*' ? { 'If-Match': currentEtag } : {}) }, body: JSON.stringify(body) })));
      if (!result || String(result.id) !== String(card.id) || (result.description ?? '') !== description) throw fail('Deck did not confirm the saved description. Refresh and check the card in Nextcloud.', 'UNAVAILABLE');
      return result;
    }
    if (!record.remote?.raw || !record.remote?.href || record.remote.recurrenceId) throw fail('This description must be edited in Nextcloud. Recurring items and invitations are read-only here.', 'VALIDATION');
    const revision = etag || record.etag;
    if (typeof revision !== 'string' || !revision || revision === '*' || /[\r\n\0]/.test(revision)) throw fail('Refresh this item before editing; a version identifier is required.', 'CONFLICT');
    const calendar = parseCalendar(record.remote.raw);
    const component = calendar.getFirstSubcomponent(record.source === 'tasks' ? 'vtodo' : 'vevent');
    if (!component || (record.source === 'tasks' ? isComplexTask(calendar, component) : isComplexEvent(calendar, component))) throw fail('Recurring items and invitations must be edited in Nextcloud.', 'VALIDATION');
    if (record.remote.uid && component.getFirstPropertyValue('uid') !== record.remote.uid) throw fail('This source item changed. Refresh before editing its description.', 'CONFLICT');
    component.removeAllProperties('description');
    if (description) component.addPropertyWithValue('description', description);
    touchCalendarItem(component, this.#now());
    const response = assertStatus(await this.request(record.remote.href, { method: 'PUT', headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': revision }, body: calendar.toString() }));
    return { etag: response.headers.get('ETag'), raw: calendar.toString() };
  }

  async updateRecordDates(input, record) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Choose valid dates for this item.', 'VALIDATION');
    if (!['tasks', 'calendar', 'deck'].includes(record?.source) || record.readonly) throw fail('These dates cannot be edited here. Open the item in Nextcloud.', 'VALIDATION');
    const { etag } = input;
    if (etag !== undefined && (typeof etag !== 'string' || !etag || etag === '*' || etag.length > 1000 || /[\r\n\0]/.test(etag) || etag !== record.etag)) throw fail('This item changed. Refresh and try the date change again.', 'CONFLICT');
    const hasStart = input.start !== undefined, hasDue = input.due !== undefined, hasEnd = input.end !== undefined;
    if (!hasStart && !hasDue && !hasEnd) throw fail('Choose a start, due, or end date to change.', 'VALIDATION');
    for (const field of ['start', 'due', 'end']) if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 80 || input[field].includes('\0'))) throw fail('Choose valid date values.', 'VALIDATION');
    if (input.allDay !== undefined && typeof input.allDay !== 'boolean') throw fail('Choose a valid event date mode.', 'VALIDATION');
    if (record.source === 'calendar' ? hasDue : hasEnd || input.allDay !== undefined) throw fail(record.source === 'calendar' ? 'Calendar events use an end date, not a due date.' : 'Tasks and Deck cards use start and due dates.', 'VALIDATION');

    if (record.source === 'deck') {
      // Deck stores date-times, not CalDAV DATE values. Callers must choose
      // an explicit instant for a newly placed card, including its UTC offset.
      if (hasStart && input.start) editableCalendarTime(input.start, 'Deck start date and time', false);
      if (hasDue && input.due) editableCalendarTime(input.due, 'Deck due date and time', false);
      const { card, url, etag: currentEtag } = await this.freshDeckCard(record);
      const start = hasStart ? input.start || null : card.startdate ?? null;
      const due = hasDue ? input.due || null : card.duedate ?? null;
      validNativeInterval(start ? editableCalendarTime(start, 'Deck start date and time', false) : null, due ? editableCalendarTime(due, 'Deck due date and time', false) : null, 'A Deck work range');
      const owner = typeof card.owner === 'string' ? card.owner : card.owner?.uid ?? card.owner?.primaryKey;
      if (typeof owner !== 'string' || !owner || typeof card.title !== 'string' || typeof card.type !== 'string' || !Number.isInteger(card.order)) throw fail('Deck returned incomplete card data. Open the card in Nextcloud.', 'FORMAT');
      const body = { title: card.title, type: card.type, owner, description: card.description || '', order: card.order, startdate: start, duedate: due, archived: Boolean(card.archived), done: card.done ?? null, color: card.color ?? null };
      const result = jsonBody(assertStatus(await this.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(currentEtag && currentEtag !== '*' ? { 'If-Match': currentEtag } : {}) }, body: JSON.stringify(body) })));
      const matches = (actual, expected) => expected == null ? actual == null || actual === '' : typeof actual === 'string' && Date.parse(actual) === Date.parse(expected);
      if (!result || String(result.id) !== String(card.id) || !matches(result.startdate, start) || !matches(result.duedate, due)) throw fail('Deck did not confirm these dates. Refresh and check the card in Nextcloud.', 'UNAVAILABLE');
      return result;
    }

    if (!record.remote?.raw || !record.remote?.href || record.remote.recurrenceId) throw fail('Recurring items and invitations must be edited in Nextcloud.', 'VALIDATION');
    const revision = etag || record.etag;
    if (typeof revision !== 'string' || !revision || revision === '*' || /[\r\n\0]/.test(revision)) throw fail('Refresh this item before editing; a version identifier is required.', 'CONFLICT');
    const calendar = parseCalendar(record.remote.raw);
    const isTask = record.source === 'tasks';
    const component = calendar.getFirstSubcomponent(isTask ? 'vtodo' : 'vevent');
    if (!component || (isTask ? isComplexTask(calendar, component) : isComplexEvent(calendar, component))) throw fail('Recurring items and invitations must be edited in Nextcloud.', 'VALIDATION');
    if (record.remote.uid && component.getFirstPropertyValue('uid') !== record.remote.uid) throw fail('This source item changed. Refresh before editing its dates.', 'CONFLICT');
    const oldStart = component.getFirstPropertyValue('dtstart');
    const oldFinish = component.getFirstPropertyValue(isTask ? 'due' : 'dtend');
    const duration = component.getFirstPropertyValue('duration');
    const start = hasStart ? input.start ? editableCalendarTime(input.start, 'start date') : null : oldStart;
    const changesFinish = isTask ? hasDue : hasEnd, finishInput = isTask ? input.due : input.end;
    let finish = changesFinish ? finishInput ? editableCalendarTime(finishInput, isTask ? 'due date' : 'end date') : null : oldFinish;
    if (!isTask) {
      if (!start || changesFinish && !finish) throw fail('Calendar events need a start and an end after the start.', 'VALIDATION');
      if (!finish && !changesFinish) {
        finish = start.clone();
        if (duration) finish.addDuration(duration);
        else if (start.isDate) finish.adjust(1, 0, 0, 0);
      }
      if (input.allDay !== undefined && (start.isDate !== input.allDay || finish.isDate !== input.allDay)) throw fail('The event start and end must match the selected date mode.', 'VALIDATION');
      validNativeInterval(start, finish, 'An event', !changesFinish && !oldFinish && !duration);
    } else {
      validNativeInterval(start, finish, 'A task work range');
      if (duration && !changesFinish && (!start || start.isDate && duration.toSeconds() % 86400 !== 0)) throw fail('This task’s duration needs a compatible start date. Set a due date or edit the duration in Nextcloud.', 'VALIDATION');
    }
    if (hasStart) writeCalendarBound(component, 'dtstart', start, oldFinish);
    if (changesFinish) { writeCalendarBound(component, isTask ? 'due' : 'dtend', finish, oldStart); component.removeAllProperties('duration'); }
    touchCalendarItem(component, this.#now());
    const response = assertStatus(await this.request(record.remote.href, { method: 'PUT', headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': revision }, body: calendar.toString() }));
    return { etag: response.headers.get('ETag'), raw: calendar.toString() };
  }

  async createTask(input, collection) {
    const {title,start,due,description=''}=input;
    let options;
    try {options=taskCreationOptions(input);} catch(error){throw fail(error.message,'VALIDATION');}
    const {requestId,completed=false}=options;
    if (collection?.source !== 'tasks' || collection.readonly || !collection.remote?.href) throw fail('Choose a writable Nextcloud task list.', 'VALIDATION');
    if (typeof title !== 'string' || !title.trim() || title.trim().length>500 || typeof description !== 'string' || description.length>500000) throw fail('Enter a task title of at most 500 characters and a description of at most 500000 characters.', 'VALIDATION');
    const first = start ? calendarTime(start, 'task start date') : null;
    const last = due ? calendarTime(due, 'task due date') : null;
    validNativeInterval(first, last, 'A task work range');
    collection = await this.freshDavWriteCollection(collection);
    const calendar = new ICAL.Component('vcalendar');
    calendar.addPropertyWithValue('version', '2.0');
    calendar.addPropertyWithValue('prodid', '-//Nextspace//Workspace 0.1//EN');
    const todo = new ICAL.Component('vtodo');
    const uid = requestId || this.#runtime.randomUUID();
    todo.addPropertyWithValue('uid', uid);
    todo.addPropertyWithValue('summary', title.trim());
    if (description) todo.addPropertyWithValue('description', description);
    todo.addPropertyWithValue('status', completed?'COMPLETED':'NEEDS-ACTION');
    if(completed){todo.addPropertyWithValue('percent-complete',100);todo.addPropertyWithValue('completed',ICAL.Time.fromJSDate(this.#now(),true));}
    if(requestId)todo.addPropertyWithValue('x-nextspace-request',requestId);
    todo.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(this.#now(), true));
    if (first) todo.addPropertyWithValue('dtstart', first);
    if (last) todo.addPropertyWithValue('due', last);
    calendar.addSubcomponent(todo);
    const href = `${sameOrigin(this.serverUrl, collection.remote.href).replace(/\/?$/, '/')}${uid}.ics`;
    const result = await this.request(href, { method: 'PUT', headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, body: calendar.toString() });
    if(requestId&&result.status===412){
      const response=assertStatus(await this.request(href,{headers:{Accept:'text/calendar','Cache-Control':'no-cache'},maxBytes:2*1024*1024}));
      const existing=parseCalendar(response.body),task=existing.getFirstSubcomponent('vtodo');
      if(!task||isComplexTask(existing,task)||existing.getAllSubcomponents('vtodo').length!==1||existing.getAllSubcomponents('vevent').length||task.getFirstPropertyValue('uid')!==uid||task.getFirstPropertyValue('x-nextspace-request')!==requestId)throw fail('The task resource no longer matches this creation request. It was not overwritten. Refresh and review the task.','CONFLICT');
      const records=this.calendarRecords(response.body,href,response.headers.get('ETag')||undefined,collection,new Date(-8640000000000000),new Date(8640000000000000));
      const record=records.find(value=>value.kind==='task'&&value.remote?.uid===uid);
      if(!record||records.length!==1)throw fail('The created task could not be verified. Refresh before retrying.','CONFLICT');
      return {href,uid,raw:response.body,etag:response.headers.get('ETag'),record,reused:true};
    }
    assertStatus(result);
    return { href, uid, raw: calendar.toString(), etag: result.headers.get('ETag') };
  }

  async setTaskCompleted({ completed }, record) {
    if (typeof completed !== 'boolean') throw fail('Task completion must be true or false.', 'VALIDATION');
    return this.updateTaskStatus({status: completed ? 'COMPLETED' : 'NEEDS-ACTION'}, record);
  }

  async updateTaskStatus({status, etag}, record) {
    if (record?.source !== 'tasks' || record.readonly || !record.remote?.raw || !record.remote?.href) throw fail('This task cannot be edited here. Recurring and shared scheduling tasks must be edited in Nextcloud.', 'VALIDATION');
    if (!['NEEDS-ACTION', 'IN-PROCESS', 'COMPLETED', 'CANCELLED'].includes(status)) throw fail('Choose a native task status.', 'VALIDATION');
    if (typeof record.etag !== 'string' || !record.etag || record.etag === '*' || /[\r\n\0]/.test(record.etag) || etag !== undefined && etag !== record.etag) throw fail('Refresh this task before editing; its version changed or is unavailable.', 'CONFLICT');
    const calendar = parseCalendar(record.remote.raw);
    const todo = calendar.getFirstSubcomponent('vtodo');
    if (!todo || isComplexTask(calendar, todo) || record.remote.uid && todo.getFirstPropertyValue('uid') !== record.remote.uid) throw fail('Recurring and shared scheduling tasks must be edited in Nextcloud.', 'VALIDATION');
    const now = ICAL.Time.fromJSDate(this.#now(), true);
    const percent = Number(todo.getFirstPropertyValue('percent-complete') || 0);
    todo.updatePropertyWithValue('status', status);
    todo.updatePropertyWithValue('percent-complete', taskStatusProgress(status, percent));
    if (status === 'COMPLETED') todo.updatePropertyWithValue('completed', now);
    else todo.removeAllProperties('completed');
    todo.updatePropertyWithValue('last-modified', now);
    todo.updatePropertyWithValue('dtstamp', now);
    todo.updatePropertyWithValue('sequence', Number(todo.getFirstPropertyValue('sequence') || 0) + 1);
    const result = assertStatus(await this.request(record.remote.href, { method: 'PUT', headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': record.etag }, body: calendar.toString() }));
    return { etag: result.headers.get('ETag'), raw: calendar.toString() };
  }

  async setTaskDue({ due }, record) {
    if (record?.source !== 'tasks' || record.readonly || !record.remote?.raw || !record.remote?.href) throw fail('This task cannot be rescheduled here. Open it in Nextcloud.', 'VALIDATION');
    if (!record.etag || record.etag === '*') throw fail('Refresh this task before editing; a version identifier is required.', 'CONFLICT');
    const calendar = parseCalendar(record.remote.raw);
    const todo = calendar.getFirstSubcomponent('vtodo');
    if (!todo || isComplexTask(calendar, todo)) throw fail('Recurring and shared scheduling tasks must be edited in Nextcloud.', 'VALIDATION');
    const value = due == null || due === '' ? null : calendarTime(due, 'task due date');
    const start = todo.getFirstPropertyValue('dtstart');
    if (value && start && (value.isDate !== start.isDate || value.compare(start) <= 0)) throw fail('The due date must match the start date type and be after the task starts.', 'VALIDATION');
    replaceCalendarTime(todo, 'due', value);
    if (value) todo.removeAllProperties('duration');
    touchCalendarItem(todo, this.#now());
    const response = assertStatus(await this.request(record.remote.href, { method: 'PUT', headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': record.etag }, body: calendar.toString() }));
    return { etag: response.headers.get('ETag'), raw: calendar.toString() };
  }

  async createEvent(input, collection) {
    const {start, end, allDay = false, requestId} = input;
    let details;
    try { details = normalizeEventDetails(input, {requireTitle: true}); } catch (error) { throw fail(error.message, 'VALIDATION'); }
    const {title, description = '', location, reminders} = details;
    let attendees;
    try { if(input.attendees!==undefined)attendees=normalizeEventAttendees(input.attendees); } catch(error){throw fail(error.message,'VALIDATION');}
    if (collection?.source !== 'calendar' || collection.readonly || !collection.remote?.href) throw fail('Choose a writable Nextcloud calendar.', 'VALIDATION');
    if (typeof title !== 'string' || !title.trim() || typeof description !== 'string') throw fail('Enter an event title and description.', 'VALIDATION');
    if (requestId !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) throw fail('Invalid calendar scheduling request.', 'VALIDATION');
    const [first, last] = calendarInterval(start, end, allDay);
    if (attendees?.length) {
      collection = await this.freshEventCollection(collection);
      if (!collection.remote?.scheduling?.canInvite) throw fail('This calendar cannot send invitations for your verified identity. Open it in Nextcloud.', 'PERMISSION');
    } else collection = await this.freshDavWriteCollection(collection);
    const calendar = new ICAL.Component('vcalendar');
    calendar.addPropertyWithValue('version', '2.0');
    calendar.addPropertyWithValue('prodid', '-//Nextspace//Planner//EN');
    const event = new ICAL.Component('vevent');
    const uid = requestId ? `nextspace-${requestId.toLowerCase()}` : this.#runtime.randomUUID();
    event.addPropertyWithValue('uid', uid);
    event.addPropertyWithValue('summary', title.trim());
    if (description) event.addPropertyWithValue('description', description);
    if (location) event.addPropertyWithValue('location', location);
    if (reminders !== undefined) replaceEventReminders(event, reminders, title);
    if(attendees?.length)try{replaceEventAttendees(event,attendees,collection.remote.scheduling);}catch(error){throw fail(error.message,'VALIDATION');}
    event.addPropertyWithValue('dtstart', first);
    event.addPropertyWithValue('dtend', last);
    event.addPropertyWithValue('dtstamp', ICAL.Time.fromJSDate(this.#now(), true));
    if (requestId) event.addPropertyWithValue('x-nextspace-request', requestId.toLowerCase());
    calendar.addSubcomponent(event);
    const href = `${sameOrigin(this.serverUrl, collection.remote.href).replace(/\/?$/, '/')}${uid}.ics`;
    const response = await this.request(href, { method: 'PUT', headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-None-Match': '*' }, body: calendar.toString() });
    if (requestId && response.status === 412) {
      // A retry after a lost response must reuse the original resource without
      // overwriting a source edit, guessing from titles, or creating duplicates.
      const existing = await this.readCreatedEvent({href, uid, requestId}, collection);
      return {href, uid, etag: existing.etag, record: existing, reused: true};
    }
    assertStatus(response);
    if(attendees?.length){
      try{const record=await this.readCreatedEvent({href,uid,requestId},collection,{authorityVerified:true});return {href,uid,etag:record.etag,record,verifiedCollection:collection};}
      catch{
        const warning='The event was created, but its latest version could not be refreshed. Refresh Calendar before editing it; do not create it again.';
        const record=this.calendarRecords(calendar.toString(),href,undefined,collection,new Date(-8640000000000000),new Date(8640000000000000))[0];
        return {href,uid,raw:calendar.toString(),record:{...record,readonly:true,creationWarning:warning},warning,verifiedCollection:collection};
      }
    }
    return { href, uid, raw: calendar.toString(), etag: response.headers.get('ETag') };
  }

  async freshDavWriteCollection(collection) {
    const href = collection?.remote?.href;
    if (!['tasks', 'calendar'].includes(collection?.source) || !validResourceLocator({kind: 'dav', collection: href, href: `${href}write-validation`}, this.serverUrl)) throw fail('Choose a calendar or task list from this Nextcloud account.', 'SECURITY');
    const response = await this.request(href, {method: 'PROPFIND', headers: {Depth: '0', 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache'}, body: propfind('<d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/>')});
    if (response.status === 403) throw deniedNativeCollection('This calendar or task list is no longer writable. Refresh before editing.', collection.source, collection.id, response.status);
    const rows = multistatus(response);
    const matching = rows.filter(row => sameOrigin(this.serverUrl, row.href).replace(/\/$/, '') === href.replace(/\/$/, ''));
    if (matching.some(row => row.unauthorized)) throw fail('Nextcloud authorization expired. Reconnect before editing.', 'AUTH');
    const current = matching.length === 1 ? matching[0] : null;
    const p = current?.properties;
    const writable = list(p?.['current-user-privilege-set']?.privilege).some(privilege => ['all', 'write', 'write-content'].some(key => Object.hasOwn(privilege, key)));
    const component = collection.source === 'tasks' ? 'VTODO' : 'VEVENT';
    if (current?.denied || p && Object.hasOwn(p, 'current-user-privilege-set') && !writable) throw deniedNativeCollection('This calendar or task list is no longer writable. Refresh before editing.', collection.source, collection.id);
    if (!current || current.denied || current.status && !/\s2\d\d(?:\s|$)/.test(current.status) || !p?.resourcetype || !Object.hasOwn(p.resourcetype, 'calendar') || !list(p['supported-calendar-component-set']?.comp).some(value => value['@_name'] === component) || !writable) throw fail('This calendar or task list is no longer writable. Refresh before editing.', 'PERMISSION');
    return {...collection, readonly: false};
  }

  async freshEventCollection(collection) {
    if(collection?.source!=='calendar'||!collection.remote?.href)throw fail('Choose an available calendar.','PERMISSION');
    const found=(await this.discoverCalendars()).find(item=>item.href===collection.remote.href&&item.components.includes('VEVENT'));
    if(found?.readonly)throw deniedNativeCollection('This calendar is no longer writable. Refresh before editing.','calendar',collection.id);
    if(!found)throw fail('This calendar is no longer writable. Refresh before editing.','PERMISSION');
    return {...collection,readonly:false,...calendarSchedulingFields(found,'calendar')};
  }

  async eventWriteContext(record,collection,etag,needsScheduling=false) {
    if(record?.source!=='calendar'||record.kind!=='event'||!record.remote?.raw||!record.remote?.href||!record.remote.uid)throw fail('Refresh this calendar event before editing.','VALIDATION');
    if(!strongEtag(record.etag)||etag!==undefined&&etag!==record.etag)throw fail('Refresh this event before editing; its version changed or is unavailable.','CONFLICT');
    const calendar=parseCalendar(record.remote.raw),event=calendar.getFirstSubcomponent('vevent');
    if(!event||eventStructureReason(calendar,event,record.remote.recurrenceId))throw fail('Recurring events and mixed resources must be edited in Nextcloud.','VALIDATION');
    if(event.getFirstPropertyValue('uid')!==record.remote.uid)throw fail('The event identity changed. Refresh before editing.','CONFLICT');
    const invited=event.hasProperty('organizer')||event.hasProperty('attendee');
    if(eventSchedulingDetails(calendar,event).invalid)throw fail('This event uses unsupported scheduling participants. Open it in Nextcloud.','VALIDATION');
    if(collection && (collection.id!==record.collectionId||collection.source!=='calendar'||collection.readonly))throw fail('This calendar is read-only or unavailable.','PERMISSION');
    if(invited||needsScheduling){
      collection=await this.freshEventCollection(collection);
      if(!validResourceLocator({kind:'dav',collection:collection.remote.href,href:record.remote.href},this.serverUrl))throw fail('The event has no safe calendar resource identity.','SECURITY');
      const fresh=assertStatus(await this.request(record.remote.href,{headers:{'If-Match':record.etag,'Cache-Control':'no-cache',Accept:'text/calendar'},maxBytes:2*1024*1024}));
      if(fresh.headers.get('ETag')&&fresh.headers.get('ETag')!==record.etag||!calendarContentEquivalent(fresh.body,record.remote.raw))throw fail('This event changed on Nextcloud. Refresh and review it before saving.','CONFLICT',412);
    } else {
      if(record.readonly)throw fail('This event is read-only.','PERMISSION');
      collection ||= {id:record.collectionId,source:'calendar',readonly:false,remote:{href:record.remote.href.slice(0,record.remote.href.lastIndexOf('/')+1)}};
      collection=await this.freshDavWriteCollection(collection);
      if(!validResourceLocator({kind:'dav',collection:collection.remote.href,href:record.remote.href},this.serverUrl))throw fail('The event has no safe calendar resource identity.','SECURITY');
    }
    const evidence=eventSchedulingDetails(calendar,event,collection.remote?.scheduling);
    const projected=applyEventAuthority({...record,eventScheduling:evidence.eventScheduling,remote:{...record.remote,eventStructure:evidence.structuralReason,invalidScheduling:evidence.invalid}},collection);
    return {calendar,event,collection,access:projected.eventAccess,scheduling:projected.eventScheduling,invited};
  }

  async eventWriteReadback(record,response,verifiedCollection) {
    try{
      const revision=strongEtag(response.headers.get('ETag'));
      const readback=assertStatus(await this.request(record.remote.href,{headers:{Accept:'text/calendar','Cache-Control':'no-cache',...(revision?{'If-Match':revision}:{})},maxBytes:2*1024*1024}));
      if(revision&&readback.headers.get('ETag')&&readback.headers.get('ETag')!==revision)throw new Error('Changed after saving');
      const latest=parseCalendar(readback.body),event=latest.getFirstSubcomponent('vevent');
      if(!event||eventStructureReason(latest,event)||event.getFirstPropertyValue('uid')!==record.remote.uid)throw new Error('Unexpected saved resource');
      return {etag:readback.headers.get('ETag')||undefined,raw:readback.body,...(verifiedCollection?{verifiedCollection}:{})};
    }catch{throw fail('Event was saved but could not be verified. Refresh before retrying.','UNAVAILABLE');}
  }

  /** Normalize a successfully created native item without listing every source. */
  async createdRecord(source, saved, collection) {
    if (saved?.record) return saved.record;
    if (source === 'tasks' || source === 'calendar') {
      if (!saved?.href || !saved?.uid || collection?.source !== source) throw fail('The created item did not return its native identity. Refresh before creating another item.', 'FORMAT');
      const seed = {id: this.id(source, `${saved.href}:${saved.uid}`), source, remote: {href: saved.href, uid: saved.uid}};
      try { return await this.savedRecord(seed, collection, saved); }
      catch {
        // PUT already succeeded. Preserve its identity instead of inviting a
        // duplicate create when only the follow-up version read failed.
        const record = typeof saved.raw === 'string' ? this.calendarRecords(saved.raw, saved.href, undefined, collection, new Date(-8640000000000000), new Date(8640000000000000)).find(item => item.remote.uid === saved.uid) : null;
        if (!record) throw fail('The item was created, but its details could not be read. Refresh this source before creating another item.', 'FORMAT');
        return {...record, readonly: true, creationWarning: 'The item was created, but its latest version could not be refreshed. Refresh this source before editing it; do not create it again.'};
      }
    }
    if (source === 'notes') {
      if (!nativeNumber(saved?.id)) throw fail('The note was created but its identity was not returned. Refresh Notes before creating another note.', 'FORMAT');
      const category = String(saved.category ?? collection?.remote?.category ?? '');
      const seed = {id: this.id('notes', saved.id), source: 'notes', kind: 'note', collectionId: this.id('notes', `category:${category}`), collectionTitle: category || 'Uncategorized (default)', url: this.url(`index.php/apps/notes/#/note/${encode(saved.id)}`), identity: this.identity('notes', saved.id, this.url(`index.php/apps/notes/api/v1/notes/${encode(saved.id)}`)), remote: {nativeId: saved.id, category}};
      try { return await this.savedRecord(seed, collection || {source: 'notes'}, saved); }
      catch { return {...seed, title: saved.title || 'Created note (refresh for details)', body: typeof saved.content === 'string' ? saved.content : '', readonly: true, creationWarning: 'The note was created, but its latest version could not be refreshed. Refresh Notes before editing it; do not create it again.'}; }
    }
    throw fail('This source does not support item creation here.', 'VALIDATION');
  }

  async createCard({title, stackId, description = '', start, due, assignToMe = false}, collection) {
    if (collection?.source !== 'deck' || collection.readonly || !nativeNumber(collection.remote?.nativeId) || !nativeNumber(stackId) || !collection.stacks?.some(stack => String(stack.id) === String(stackId))) throw fail('Choose a writable Deck board and stack.', 'VALIDATION');
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 255 || typeof description !== 'string' || typeof assignToMe !== 'boolean') throw fail('Enter a card title of up to 255 characters, description and assignment.', 'VALIDATION');
    const deckDate = (value, finish) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;
      calendarTime(value, 'Deck date');
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year, month - 1, day, finish ? 23 : 0, finish ? 59 : 0).toISOString();
    };
    start = start ? deckDate(start, false) : undefined; due = due ? deckDate(due, true) : undefined;
    const first = start ? calendarTime(start, 'Deck start date and time', false) : null;
    const last = due ? calendarTime(due, 'Deck due date and time', false) : null;
    validNativeInterval(first, last, 'A Deck work range');
    const boardId = collection.remote.nativeId;
    const board = await this.freshDeckBoard(boardId, collection.id);
    const stack = jsonBody(assertStatus(await this.request(this.url(`index.php/apps/deck/api/v1.0/boards/${encode(boardId)}/stacks/${encode(stackId)}`), {headers: {'Cache-Control': 'no-cache'}})));
    if (!stack || String(stack.id) !== String(stackId) || String(stack.boardId) !== String(board.id) || stack.deletedAt) throw fail('This Deck stack is no longer available. Refresh the board before creating a card.', 'PERMISSION');
    const base = this.url(`index.php/apps/deck/api/v1.0/boards/${encode(boardId)}/stacks/${encode(stackId)}/cards`);
    // Current official CardApiController accepts startdate and users on create,
    // even though the API prose only lists the older due-date fields.
    const body = {title: title.trim(), type: 'plain', order: 99999, description, startdate: first ? new Date(start).toISOString() : null, duedate: last ? new Date(due).toISOString() : null, users: assignToMe ? [{id: this.username, type: 0}] : []};
    const card = jsonBody(assertStatus(await this.request(base, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})));
    if (!nativeNumber(card?.id)) throw fail('Deck created a card without returning its identity. Refresh Deck before creating another card.', 'FORMAT');
    const seed = {id: this.id('deck', card.id), source: 'deck', kind: 'card', collectionId: collection.id, collectionTitle: collection.title, url: this.url(`index.php/apps/deck/board/${encode(boardId)}/card/${encode(card.id)}`), remote: {nativeId: card.id, boardId, stackId: Number(stackId)}};
    // The create response may not include newly assigned users. One targeted
    // GET is authoritative and also detects older servers ignoring new fields.
    let native = card, warning;
    try { native = jsonBody(assertStatus(await this.request(`${base}/${encode(card.id)}`))); }
    catch { warning = 'The card was created, but its latest details could not be refreshed. Refresh Deck before editing it; do not create it again.'; }
    let record;
    try {
      if (warning) throw new Error(warning);
      record = await this.savedRecord(seed, collection, native);
    } catch {
      warning ||= 'The card was created, but its latest details could not be refreshed. Refresh Deck before editing it; do not create it again.';
      native = card;
      record = {...seed, title: native.title || title.trim(), body: native.description || '', status: collection.stacks.find(stack => String(stack.id) === String(stackId)).title, stackId: String(stackId), start: native.startdate || undefined, due: native.duedate || undefined, completed: Boolean(native.done), ...deckAssignments(native), readonly: true, identity: this.identity('deck', card.id, `${base}/${encode(card.id)}`), remote: {...seed.remote, snapshot: native}};
    }
    const ignored = [];
    if (start && Date.parse(record.start) !== Date.parse(start)) ignored.push('start date');
    if (due && Date.parse(record.due) !== Date.parse(due)) ignored.push('due date');
    if (assignToMe && !record.assigneeIds?.includes(this.username)) ignored.push('assignment');
    if (!warning && ignored.length) warning = `The card was created, but this Deck server did not confirm its ${ignored.join(' and ')}. Open the existing card in Nextcloud or refresh Deck; do not create it again.`;
    return {record, ...(warning ? {warning} : {})};
  }

  async readCreatedEvent({href, uid, requestId}, collection, {authorityVerified=false}={}) {
    const response = assertStatus(await this.request(href, {headers: calendarReadHeaders, maxBytes: 2 * 1024 * 1024}));
    const calendar = parseCalendar(response.body);
    const event = calendar.getFirstSubcomponent('vevent');
    if (!event || eventStructureReason(calendar,event) || event.getFirstPropertyValue('uid') !== uid || requestId && event.getFirstPropertyValue('x-nextspace-request') !== requestId.toLowerCase()) throw fail('The scheduling resource no longer matches this request. It was not overwritten. Refresh and link the existing event manually.', 'CONFLICT');
    if(!authorityVerified&&(event.hasProperty('organizer')||event.hasProperty('attendee')))collection=await this.freshEventCollection(collection);
    if (String(event.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') throw fail('This scheduled event was cancelled in Nextcloud. It was not recreated. Refresh and choose another event.', 'CONFLICT');
    const records = this.calendarRecords(response.body, sameOrigin(this.serverUrl, href), response.headers.get('ETag') || undefined, collection, new Date(-8640000000000000), new Date(8640000000000000));
    if (records.length !== 1 || records[0].remote.uid !== uid) throw fail('The created calendar event could not be read. Retry this scheduling request without changing it.', 'FORMAT');
    return records[0];
  }

  async updateEvent(input, record, collection) {
    let attendees;
    try{if(input.attendees!==undefined)attendees=normalizeEventAttendees(input.attendees);}catch(error){throw fail(error.message,'VALIDATION');}
    let details;
    try { details = normalizeEventDetails(input); } catch (error) { throw fail(error.message, 'VALIDATION'); }
    const dates = input.start !== undefined || input.end !== undefined;
    if (!dates && input.allDay !== undefined || dates && (input.start === undefined || input.end === undefined) || !dates && !Object.keys(details).length&&attendees===undefined) throw fail('Choose event details, or both a start and end date.', 'VALIDATION');
    const interval = dates ? calendarInterval(input.start, input.end, input.allDay ?? Boolean(record.allDay)) : null;
    const {calendar,event,access,scheduling,invited,collection:verifiedCollection}=await this.eventWriteContext(record,collection,input.etag,Boolean(attendees?.length));
    if(!access.editDetails&&!access.editReminders&&!access.editAttendees)throw fail('This event cannot be edited for your current calendar identity. Open it in Nextcloud.','PERMISSION');
    if((dates||['title','description','location'].some(key=>details[key]!==undefined))&&!access.editDetails||details.reminders!==undefined&&!access.editReminders||attendees!==undefined&&(attendees.length||event.hasProperty('attendee'))&&!access.editAttendees)throw fail('These event changes are not allowed for your calendar role. Open the event in Nextcloud.','PERMISSION');
    if(attendees!==undefined)try{replaceEventAttendees(event,attendees,verifiedCollection.remote?.scheduling);}catch(error){throw fail(error.message,'VALIDATION');}
    if (dates) {
      const [first, last] = interval;
      replaceCalendarTime(event, 'dtstart', first);
      replaceCalendarTime(event, 'dtend', last);
      event.removeAllProperties('duration');
    }
    for (const [key, property] of [['title', 'summary'], ['description', 'description'], ['location', 'location']]) if (details[key] !== undefined) {
      event.removeAllProperties(property);
      if (details[key]) event.addPropertyWithValue(property, details[key]);
    }
    if (details.reminders !== undefined) replaceEventReminders(event, details.reminders, String(event.getFirstPropertyValue('summary') || 'Event'));
    if(scheduling.role==='attendee'){
      const stamp=ICAL.Time.fromJSDate(this.#now(),true);event.updatePropertyWithValue('last-modified',stamp);event.updatePropertyWithValue('dtstamp',stamp);
    }else touchCalendarItem(event, this.#now());
    const response = assertStatus(await this.request(record.remote.href, { method: 'PUT', headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': record.etag }, body: calendar.toString() }));
    if (Object.keys(details).length||attendees!==undefined||invited) return this.eventWriteReadback(record,response,verifiedCollection);
    return { etag: response.headers.get('ETag'), raw: calendar.toString() };
  }

  async respondToEvent(input,record,collection) {
    let participation;
    try{participation=normalizeEventParticipation(input.participation);}catch(error){throw fail(error.message,'VALIDATION');}
    if(input.id!==record?.id||!strongEtag(input.etag))throw fail('Refresh this invitation before responding.','CONFLICT');
    const {calendar,event,access,scheduling,collection:verifiedCollection}=await this.eventWriteContext(record,collection,input.etag,true);
    if(!access.respond||!scheduling.ownAttendeeUri)throw fail('This invitation cannot be answered for your current calendar identity.','PERMISSION');
    const target=event.getAllProperties('attendee').find(property=>String(property.getFirstValue())===scheduling.ownAttendeeUri);
    target.setParameter('partstat',participation);target.setParameter('rsvp','FALSE');
    const stamp=ICAL.Time.fromJSDate(this.#now(),true);event.updatePropertyWithValue('last-modified',stamp);event.updatePropertyWithValue('dtstamp',stamp);
    const response=assertStatus(await this.request(record.remote.href,{method:'PUT',headers:{'Content-Type':'text/calendar; charset=utf-8','If-Match':record.etag},body:calendar.toString()}));
    return this.eventWriteReadback(record,response,verifiedCollection);
  }

  async #calendarResourceEtag(href, collectionHref) {
    const response = await this.request(href, {method: 'PROPFIND', headers: {Depth: '0', 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache'}, body: propfind('<d:getetag/>'), maxBytes: 64 * 1024});
    if ([404, 405, 501].includes(response.status)) return null;
    const rows = multistatus(response, 'getetag');
    if (rows.length !== 1 || davMemberHref(this.serverUrl, collectionHref, rows[0].href) !== href) return null;
    const [row] = rows;
    if (row.unauthorized) throw fail('Nextcloud authorization expired. Reconnect before editing.', 'AUTH', 401);
    if (row.denied) throw fail('Your Nextcloud account does not have permission for this action.', 'PERMISSION', 403);
    if (row.status && !/\s2\d\d(?:\s|$)/.test(row.status)) return null;
    return strongEtag(row.properties.getetag);
  }

  async deleteEvent({id}, record, collection) {
    const href = record?.remote?.href, collectionHref = collection?.remote?.href;
    if (id !== record?.id || record?.source !== 'calendar' || record.kind !== 'event' || collection?.source !== 'calendar' || collection.readonly || collection.id !== record.collectionId) throw fail('Choose an editable calendar event from a verified source.', 'PERMISSION');
    if (!validResourceLocator({kind: 'dav', collection: collectionHref, href}, this.serverUrl)) throw fail('The event has no safe calendar resource identity.', 'SECURITY');
    const etag = strongEtag(record.etag);
    if (!etag || etag.length > 1000 || typeof record.remote.raw !== 'string' || !record.remote.raw || !record.remote.uid || record.remote.recurrenceId) throw fail('Refresh this event before deleting it, or open it in Nextcloud.', 'VALIDATION');
    const checkDocument = raw => {
      let calendar;
      try { calendar = new ICAL.Component(ICAL.parse(raw)); } catch { throw fail('The calendar resource could not be verified for deletion.', 'FORMAT'); }
      const event = calendar.getFirstSubcomponent('vevent');
      if (!event || eventStructureReason(calendar,event)) throw fail('Recurring events and mixed calendar resources must be deleted in Nextcloud.', 'VALIDATION');
      if (event.getFirstPropertyValue('uid') !== record.remote.uid) throw fail('The event identity changed on Nextcloud. Refresh before deleting.', 'CONFLICT');
      return {calendar,event};
    };
    const baseline=checkDocument(record.remote.raw);
    const invited=baseline.event.hasProperty('organizer')||baseline.event.hasProperty('attendee');
    if(eventSchedulingDetails(baseline.calendar,baseline.event).invalid)throw fail('This event uses unsupported scheduling participants. Open it in Nextcloud.','VALIDATION');
    if(invited)collection=await this.freshEventCollection(collection);
    else {
      if(record.readonly)throw fail('This event is read-only.','PERMISSION');
      collection=await this.freshDavWriteCollection(collection);
    }
    const evidence=eventSchedulingDetails(baseline.calendar,baseline.event,collection.remote?.scheduling);
    const permission=applyEventAuthority({...record,eventScheduling:evidence.eventScheduling,remote:{...record.remote,eventStructure:evidence.structuralReason,invalidScheduling:evidence.invalid}},collection).eventAccess;
    if(!permission.delete)throw fail('Only the organizer may delete this invitation. Decline or open it in Nextcloud.','PERMISSION');
    const forget = async (cacheAlreadyInvalidated = false) => {
      this.#davSnapshots.delete(collectionHref); this.#davEpoch++;
      this.#davResources.remove(collectionHref, href);
      if(!cacheAlreadyInvalidated)await this.resourceOperation('remove', {kind: 'dav', collection: collectionHref, href});
      return {deleted: true};
    };
    const fresh = await this.request(href, {headers: {...calendarReadHeaders, 'If-Match': etag}, maxBytes: 2 * 1024 * 1024});
    if (fresh.status === 404) return forget();
    assertStatus(fresh);
    checkDocument(fresh.body);
    // A proxy can change a GET representation tag. If the complete resource
    // matches, confirm the original revision through its DAV property.
    const revisionEvidence = {baseline: record.remote.raw, body: fresh.body, etag, responseEtag: fresh.headers.get('ETag')};
    let preflight = calendarDeletePreflight(revisionEvidence);
    if (preflight === 'check-dav') {
      const davEtag = await this.#calendarResourceEtag(href, collectionHref);
      preflight = calendarDeletePreflight({...revisionEvidence, davEtag});
    }
    if (preflight !== 'verified') throw fail('This event changed on Nextcloud. Refresh and review it before deleting.', 'CONFLICT', 412);
    const removed = await this.request(href, {method: 'DELETE', headers: {'If-Match': etag}});
    if ([200, 204].includes(removed.status)) return forget(new URL(href).pathname.includes('/remote.php/dav/calendars/'));
    if (removed.status !== 404) assertStatus(removed);
    // Asynchronous success or a raced 404 is not proof of removal. Read once;
    // never replay DELETE after an uncertain transport outcome.
    const verify = await this.request(href, {headers: calendarReadHeaders, maxBytes: 2 * 1024 * 1024});
    if (verify.status === 404) return forget();
    assertStatus(verify);
    throw fail('Nextcloud has not confirmed that this event was deleted. Refresh before trying again.', 'UNAVAILABLE');
  }

  deckCardUrl(record) {
    if (record?.source !== 'deck' || !nativeNumber(record.remote?.nativeId) || !nativeNumber(record.remote?.boardId) || !nativeNumber(record.remote?.stackId)) throw fail('Refresh this Deck card before editing.', 'VALIDATION');
    return this.url(`index.php/apps/deck/api/v1.0/boards/${encode(record.remote.boardId)}/stacks/${encode(record.remote.stackId)}/cards/${encode(record.remote.nativeId)}`);
  }

  async freshDeckBoard(boardId, collectionId) {
    if (!nativeNumber(boardId)) throw fail('Choose an available Deck board.', 'VALIDATION');
    const response = await this.request(this.url(`index.php/apps/deck/api/v1.0/boards/${encode(boardId)}`), {headers: {'Cache-Control': 'no-cache'}});
    if (response.status === 403) throw deniedNativeCollection('This Deck board is read-only.', 'deck', collectionId, response.status);
    const board = jsonBody(assertStatus(response));
    if (!board || String(board.id) !== String(boardId)) throw fail('The Deck board could not be verified. Refresh Deck.', 'FORMAT');
    if (board.permissions?.PERMISSION_EDIT === false || board.archived || board.deletedAt) throw deniedNativeCollection('This Deck board is read-only.', 'deck', collectionId);
    if (board.permissions?.PERMISSION_EDIT !== true || board.archived || board.deletedAt) throw fail('This Deck board is read-only.', 'PERMISSION');
    return board;
  }

  async freshDeckCard(record) {
    if (record?.readonly) throw fail('This Deck card is read-only.', 'PERMISSION');
    const url = this.deckCardUrl(record);
    const response = assertStatus(await this.request(url, {headers: {'Cache-Control': 'no-cache'}}));
    const card = jsonBody(response);
    if (!card || String(card.id) !== String(record.remote.nativeId) || String(card.stackId) !== String(record.remote.stackId) || card.deletedAt || card.archived) throw fail('This Deck card moved or changed. Refresh before editing.', 'CONFLICT');
    if (card.relatedBoard?.permissions?.PERMISSION_EDIT === false && String(card.relatedBoard.id) === String(record.remote.boardId)) throw deniedNativeCollection('This Deck board is read-only.', 'deck', record.collectionId);
    if (card.permissions?.PERMISSION_EDIT === false || card.relatedBoard?.permissions?.PERMISSION_EDIT === false) throw fail('This Deck card is read-only.', 'PERMISSION');
    const snapshot = record.remote.snapshot;
    if (!snapshot) throw fail('Refresh this Deck card before editing.', 'CONFLICT');
    // Deck has no documented atomic If-Match contract for card updates. Re-read
    // and compare immediately before mutation; send If-Match too where honored.
    // This prevents edits based on known stale data, not every concurrent race.
    const fields = ['title', 'description', 'type', 'order', 'duedate', 'startdate', 'done', 'color', 'lastModified'];
    if (fields.some(key => JSON.stringify(card[key] ?? null) !== JSON.stringify(snapshot[key] ?? null))) throw fail('This Deck card changed. Refresh before editing; the server copy was preserved.', 'CONFLICT');
    if (card.permissions?.PERMISSION_EDIT !== true && !(String(card.relatedBoard?.id) === String(record.remote.boardId) && card.relatedBoard?.permissions?.PERMISSION_EDIT === true)) await this.freshDeckBoard(record.remote.boardId, record.collectionId);
    return { card, url, etag: response.headers.get('ETag') || card.ETag || record.etag };
  }

  async setCardCompleted({ completed }, record) {
    if (typeof completed !== 'boolean') throw fail('Card completion must be true or false.', 'VALIDATION');
    const { card, url, etag } = await this.freshDeckCard(record);
    if (!Object.hasOwn(card, 'done')) throw fail('This Deck version does not expose card completion. Open the card in Nextcloud.', 'UNAVAILABLE');
    const owner = typeof card.owner === 'string' ? card.owner : card.owner?.uid ?? card.owner?.primaryKey;
    if (typeof owner !== 'string' || !owner || typeof card.title !== 'string' || typeof card.type !== 'string' || !Number.isInteger(card.order)) throw fail('Deck returned incomplete card data. Open the card in Nextcloud.', 'FORMAT');
    const body = { title: card.title, type: card.type, owner, description: card.description || '', order: card.order, duedate: card.duedate ?? null, startdate: card.startdate ?? null, archived: Boolean(card.archived), done: completed ? this.#now().toISOString() : null, color: card.color ?? null };
    const result = jsonBody(assertStatus(await this.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) }, body: JSON.stringify(body) })));
    if (!result || String(result.id) !== String(card.id) || Boolean(result.done) !== completed) throw fail('Deck did not confirm this completion change. Refresh and open the card in Nextcloud.', 'UNAVAILABLE');
    return result;
  }

  async moveCard({ stackId }, record, collection) {
    if (!nativeNumber(stackId) || collection?.source !== 'deck' || collection.readonly || collection.id !== record?.collectionId || !collection.stacks?.some(stack => String(stack.id) === String(stackId))) throw fail('Choose a writable stack in this card’s Deck board.', 'VALIDATION');
    const { etag } = await this.freshDeckCard(record);
    const stack = jsonBody(assertStatus(await this.request(this.url(`index.php/apps/deck/api/v1.0/boards/${encode(record.remote.boardId)}/stacks/${encode(stackId)}`), {headers: {'Cache-Control': 'no-cache'}})));
    if (!stack || String(stack.id) !== String(stackId) || String(stack.boardId) !== String(record.remote.boardId) || stack.deletedAt) throw fail('This Deck stack is no longer available in the card’s board. Refresh Deck before moving it.', 'CONFLICT');
    // CardApiController::reorder receives stackId from the route before the JSON
    // body (Nextcloud Request::getParam URL precedence). Use the destination in
    // both places; an old-stack route can return 200 without moving the card.
    const destinationUrl = this.deckCardUrl({...record, remote: {...record.remote, stackId}});
    assertStatus(await this.request(`${destinationUrl}/reorder`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) }, body: JSON.stringify({ stackId: Number(stackId), order: 99999 }) }));
    // Deck returns the reordered stack's card array. Read the single enriched
    // card afresh so the next edit uses the new stack, snapshot and validator.
    const response = assertStatus(await this.request(destinationUrl, {headers: {'Cache-Control': 'no-cache'}}));
    const saved = jsonBody(response);
    const matches = value => value && String(value.id) === String(record.remote.nativeId) && String(value.stackId) === String(stackId) && !value.archived && !value.deletedAt;
    if (!matches(saved)) throw fail('Deck did not confirm this stack change. Refresh the board before trying again.', 'UNAVAILABLE');
    return response.headers.get('ETag') ? {...saved, ETag: response.headers.get('ETag')} : saved;
  }

  async setDeckDependency({ remove = false }, fromRecord, toRecord) {
    if (typeof remove !== 'boolean' || fromRecord?.source !== 'deck' || toRecord?.source !== 'deck' || fromRecord.id === toRecord.id || String(fromRecord.remote?.nativeId) === String(toRecord.remote?.nativeId)) throw fail('Choose two different Deck cards.', 'VALIDATION');
    this.deckCardUrl(toRecord);
    if (fromRecord.readonly) throw fail('The dependent Deck card is read-only.', 'PERMISSION');
    // The owner waits for its selected cards. Keep the API direction identical
    // to the visible Deck selector: from depends on to.
    const url = this.deckCardUrl(fromRecord), targetId = String(toRecord.remote.nativeId);
    const response = assertStatus(await this.request(url));
    const card = jsonBody(response);
    if (!card || String(card.id) !== String(fromRecord.remote.nativeId) || String(card.stackId) !== String(fromRecord.remote.stackId) || card.deletedAt || card.archived) throw fail('The dependent Deck card moved or is unavailable. Refresh the board.', 'CONFLICT');
    if (card.permissions?.PERMISSION_EDIT === false || card.relatedBoard?.permissions?.PERMISSION_EDIT === false) throw fail('The dependent Deck card is read-only.', 'PERMISSION');
    if (!Array.isArray(card.dependentCards)) throw fail('This Deck version does not expose native dependencies.', 'UNAVAILABLE');
    if (card.permissions?.PERMISSION_EDIT !== true && !(String(card.relatedBoard?.id) === String(fromRecord.remote.boardId) && card.relatedBoard?.permissions?.PERMISSION_EDIT === true)) await this.freshDeckBoard(fromRecord.remote.boardId, fromRecord.collectionId);
    const matches = value => value && String(value.id) === String(card.id) && String(value.stackId) === String(fromRecord.remote.stackId) && !value.archived && !value.deletedAt && Array.isArray(value.dependentCards) && value.dependentCards.some(id => String(id) === targetId) !== remove;
    // Reading first makes retries after a lost response safe, without comparing
    // stale descriptions or rewriting any unrelated native card fields.
    if (matches(card)) return card;
    const etag = response.headers.get('ETag') || card.ETag;
    const written = assertStatus(await this.request(`${url}/dependentCards/${encode(toRecord.remote.nativeId)}`, { method: remove ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) } }));
    let saved;
    try { saved = jsonBody(written); } catch (error) { if (error.code !== 'FORMAT') throw error; }
    if (!matches(saved)) saved = jsonBody(assertStatus(await this.request(url)));
    if (!matches(saved)) throw fail('Deck did not confirm this dependency change. Retry to check the native card before continuing.', 'UNAVAILABLE');
    return saved;
  }

  workspaceUrl() { return this.url(`remote.php/dav/files/${encode(this.username)}/Workspace/planner.json`); }

  plannerFileUrl(path = '', directory = false) {
    const parts = plannerPath(path, directory);
    return this.url(`remote.php/dav/files/${encode(this.username)}/Workspace/Nextspace/${parts.map(encode).join('/')}`);
  }

  async plannerDavProperties(url) {
    const response = await this.request(url, { method: 'PROPFIND', headers: { Depth: '0', 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' }, body: propfind('<d:getetag/><d:resourcetype/>') });
    if (response.status === 404) return null;
    if ([405, 501].includes(response.status)) return { etag: null, collection: false };
    const rows = multistatus(response);
    const expected = new URL(url).pathname.replace(/\/$/, '');
    const row = rows.find(item => new URL(sameOrigin(this.serverUrl, item.href)).pathname.replace(/\/$/, '') === expected);
    if (!row) throw fail('Nextcloud returned no properties for the requested planner file.', 'ETAG_UNAVAILABLE');
    if (row.denied) throw fail('Nextcloud denied access to this planner file.', 'PERMISSION', 403);
    if (/\s404(?:\s|$)/.test(row.status)) return null;
    return { etag: strongEtag(scalar(row.properties.getetag)), collection: Object.hasOwn(row.properties.resourcetype || {}, 'collection') };
  }

  #forgetPlannerJson(url) {
    const cached = this.#plannerJsonCache.get(url);
    if (cached) { this.#plannerJsonBytes -= cached.bytes; this.#plannerJsonCache.delete(url); }
  }

  #rememberPlannerJson(url, document, etag, bytes) {
    this.#forgetPlannerJson(url);
    if (!strongEtag(etag) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_PLANNER_FILE) return;
    while (this.#plannerJsonCache.size >= MAX_PLANNER_CACHE_ENTRIES || this.#plannerJsonBytes + bytes > MAX_PLANNER_CACHE_BYTES) this.#forgetPlannerJson(this.#plannerJsonCache.keys().next().value);
    this.#plannerJsonCache.set(url, {document: structuredClone(document), etag, bytes});
    this.#plannerJsonBytes += bytes;
  }

  async readPlannerJson(url, { requireVersion = false, recoverVersion = true } = {}) {
    url = sameOrigin(this.serverUrl, url);
    const epoch = this.#plannerJsonEpoch, cached = this.#plannerJsonCache.get(url);
    if (cached) {
      // A previous body alone is never a freshness or permission proof. DAV
      // validators avoid repeatedly downloading multi-megabyte import files,
      // including on Files SSO where conditional GET/304 is not dependable.
      let current;
      try { current = await this.plannerDavProperties(url); }
      catch (error) { this.#forgetPlannerJson(url); throw error; }
      if (!current) { this.#forgetPlannerJson(url); this.#plannerDirectories.clear(); return {document: null, etag: null}; }
      if (current.collection) { this.#forgetPlannerJson(url); this.#plannerDirectories.clear(); throw fail('A folder exists where a planner document is expected.', 'FORMAT'); }
      if (current.etag === cached.etag && epoch === this.#plannerJsonEpoch) {
        this.#plannerJsonCache.delete(url); this.#plannerJsonCache.set(url, cached);
        return {document: structuredClone(cached.document), etag: cached.etag};
      }
      this.#forgetPlannerJson(url);
    }
    let response = await this.request(url, { headers: plannerReadHeaders, maxBytes: MAX_PLANNER_FILE });
    if (response.status === 404) return { document: null, etag: null };
    let document = jsonBody(assertStatus(response));
    const encoding = response.headers.get('Content-Encoding');
    let etag = !encoding || encoding.toLowerCase() === 'identity' ? strongEtag(response.headers.get('ETag')) : null;
    if (!etag && recoverVersion) {
      // Proxies can weaken/change a GET ETag for compression. Use the DAV file
      // validator only with a conditional body read and matching post-read DAV
      // version; do not attach a freshly observed ETag to an older body.
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await this.plannerDavProperties(url);
        if (!before) return { document: null, etag: null };
        if (before.collection) throw fail('A folder exists where a planner document is expected.', 'FORMAT');
        if (!before.etag) break;
        response = await this.request(url, { headers: { ...plannerReadHeaders, 'If-Match': before.etag }, maxBytes: MAX_PLANNER_FILE });
        if (response.status === 412) {
          if (attempt === 2) assertStatus(response);
          continue;
        }
        if (response.status === 404) return { document: null, etag: null };
        document = jsonBody(assertStatus(response));
        const after = await this.plannerDavProperties(url);
        if (after?.etag === before.etag && !after.collection) { etag = before.etag; break; }
        if (attempt === 2) throw fail('This planner file changed while its version was being checked. Retry sync to read the newer version.', 'CONFLICT', 412);
      }
    }
    if (requireVersion && !etag) throw fail('Nextcloud did not provide a strong planner file version (ETag). Check the server or proxy configuration; no cloud file was overwritten.', 'ETAG_UNAVAILABLE');
    if (epoch === this.#plannerJsonEpoch) this.#rememberPlannerJson(url, document, etag, byteLength(response.body));
    return { document, etag };
  }

  async readWorkspace({ requireVersion = true } = {}) {
    if (!this.discovered) await this.discover();
    // Import only reads the legacy file. It needs no overwrite validator and
    // must not fail simply because an old proxy omits or weakens the GET ETag.
    const { document: workspace, etag } = await this.readPlannerJson(this.workspaceUrl(), { requireVersion, recoverVersion: requireVersion });
    if (workspace === null) return { workspace, etag };
    if (!workspace || workspace.schemaVersion !== 2 || !Array.isArray(workspace.spaces) || !Array.isArray(workspace.projects) || !Array.isArray(workspace.relations)) throw fail('The remote planner file has an unsupported or invalid format.', 'FORMAT');
    return { workspace, etag };
  }

  async listPlannerFiles(relativeDir = '') {
    plannerPath(relativeDir, true);
    if (!this.discovered) await this.discover();
    const url = this.plannerFileUrl(relativeDir, true);
    const response = await this.request(url, { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml', 'Cache-Control': 'no-cache' }, body: propfind('<d:getetag/><d:resourcetype/>') });
    if (response.status === 404) return { exists: false, files: [] };
    const directory = new URL(url).pathname.replace(/\/$/, '');
    const files = [], seen = new Set();
    let foundDirectory = false;
    for (const row of multistatus(response)) {
      const pathname = new URL(sameOrigin(this.serverUrl, row.href)).pathname.replace(/\/$/, '');
      if (row.denied) throw fail('Nextcloud denied access to part of the planner folder.', 'PERMISSION', 403);
      if (pathname === directory) {
        if (!Object.hasOwn(row.properties.resourcetype || {}, 'collection')) throw fail('A file exists where the Nextspace planner folder is expected.', 'FORMAT');
        foundDirectory = true;
        continue;
      }
      if (!pathname.startsWith(directory + '/') || pathname.slice(directory.length + 1).includes('/')) throw fail('Nextcloud returned a planner entry outside the requested folder.', 'SECURITY');
      let name;
      try { name = decodeURIComponent(pathname.slice(directory.length + 1)); } catch { throw fail('Nextcloud returned an invalid planner file name.', 'SECURITY'); }
      if (name.includes('/') || name.includes('\\')) throw fail('Nextcloud returned an unsafe planner file name.', 'SECURITY');
      const path = [relativeDir, name].filter(Boolean).join('/');
      // This dedicated folder may contain unrelated files added by a user.
      // Only protocol-safe names are returned; no remote href is ever followed.
      try { plannerPath(path, true); } catch { continue; }
      if (/\s(?:4|5)\d\d(?:\s|$)/.test(row.status)) throw fail('A planner folder entry could not be read. No missing entry was treated as deleted.', 'NEXTCLOUD');
      if (seen.has(path)) throw fail('Nextcloud returned duplicate planner folder entries.', 'FORMAT');
      seen.add(path);
      files.push({ path, etag: strongEtag(scalar(row.properties.getetag)), collection: Object.hasOwn(row.properties.resourcetype || {}, 'collection') });
      if (files.length > 20000) throw fail('The planner folder contains too many entries to sync safely.', 'LIMIT');
    }
    if (!foundDirectory) throw fail('Nextcloud did not confirm the requested planner folder. No entries were treated as deleted.', 'FORMAT');
    this.#plannerDirectories.add(url.replace(/\/$/, ''));
    return { exists: true, files };
  }

  async readPlannerFile(path) {
    plannerPath(path);
    if (!this.discovered) await this.discover();
    return this.readPlannerJson(this.plannerFileUrl(path));
  }

  async ensurePlannerParents(path) {
    const parts = ['Workspace', 'Nextspace', ...plannerPath(path).slice(0, -1)];
    for (let count = 1; count <= parts.length; count++) {
      const url = this.url(`remote.php/dav/files/${encode(this.username)}/${parts.slice(0, count).map(encode).join('/')}`);
      if (this.#plannerDirectories.has(url)) continue;
      const response = await this.request(url, { method: 'MKCOL' });
      if (response.status === 409) throw fail('The planner parent folder is unavailable or changed while it was being created. Retry sync after checking Nextcloud Files.', 'STORAGE_LAYOUT', 409);
      assertStatus(response, [405]);
      if (response.status === 405 && !(await this.plannerDavProperties(url))?.collection) throw fail('A file exists where a Nextspace planner folder is needed.', 'STORAGE_LAYOUT');
      this.#plannerDirectories.add(url);
    }
  }

  async writePlannerFile(path, document, etag = null) {
    const parts = plannerPath(path), body = plannerBody(document);
    if (etag != null && !strongEtag(etag)) throw fail('A strong planner file version is required for an update.', 'ETAG_UNAVAILABLE');
    if (!this.discovered) await this.discover();
    await this.ensurePlannerParents(parts.join('/'));
    const url = this.plannerFileUrl(path);
    const put = () => this.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8', ...(etag == null ? { 'If-None-Match': '*' } : { 'If-Match': etag }) }, body });
    let response = await put();
    if (response.status === 409) {
      // A cached collection may have been removed by another client. Recreate
      // parents once, then repeat the exact conditional PUT; never weaken it.
      this.#plannerDirectories.clear();
      await this.ensurePlannerParents(parts.join('/'));
      response = await put();
      if (response.status === 409) throw fail('The planner destination folder is unavailable. Check Nextcloud Files before retrying.', 'STORAGE_LAYOUT', 409);
    }
    assertStatus(response);
    let nextEtag = strongEtag(response.headers.get('ETag'));
    if (!nextEtag) {
      const stored = await this.readPlannerJson(url, { requireVersion: true });
      if (!jsonEqual(stored.document, JSON.parse(body))) throw fail('This planner file changed after upload. Retry sync to merge the newer version.', 'CONFLICT', 412);
      nextEtag = stored.etag;
    }
    return { etag: nextEtag };
  }

  async writeWorkspace(workspace, etag) {
    if (!this.discovered) await this.discover();
    if (!workspace || workspace.schemaVersion !== 2 || !Array.isArray(workspace.spaces) || !Array.isArray(workspace.projects) || !Array.isArray(workspace.relations)) throw fail('The planner has an invalid format.', 'VALIDATION');
    if (etag != null && !strongEtag(etag)) throw fail('A strong workspace version identifier is required.', 'ETAG_UNAVAILABLE');
    if (etag == null) {
      const directory = this.url(`remote.php/dav/files/${encode(this.username)}/Workspace`);
      const mkdir = await this.request(directory, { method: 'MKCOL' });
      assertStatus(mkdir, [405]); // 405 means a collection already exists.
    }
    const body = JSON.stringify(workspace, null, 2);
    const response = assertStatus(await this.request(this.workspaceUrl(), { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8', ...(etag == null ? { 'If-None-Match': '*' } : { 'If-Match': etag }) }, body }));
    let nextEtag = strongEtag(response.headers.get('ETag'));
    if (!nextEtag) {
      const stored = await this.readWorkspace();
      if (!jsonEqual(stored.workspace, workspace)) throw fail('The workspace changed immediately after upload. Refresh before syncing again.', 'CONFLICT', 412);
      nextEtag = stored.etag;
    }
    return { etag: nextEtag };
  }
}
