/** Desktop → IPC → HTTP integration. Uses an isolated fixture profile, never the user's account. */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {createRequire} from 'node:module'
import {readFile, writeFile, rm} from 'node:fs/promises'
import {_electron as electron} from 'playwright'
import ICAL from 'ical.js'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {assembleWorkspace} from '@nextspace/nextcloud-node/planner-folder.mjs'

const require = createRequire(import.meta.url)
const cwd = path.resolve(import.meta.dirname, '..')
const runtimeRoot = path.resolve(cwd, '.runtime')
const dataDir = path.resolve(runtimeRoot, `planner-connected-smoke-${randomUUID()}`)
assert.ok(dataDir.startsWith(`${runtimeRoot}${path.sep}`))
const ocs = data => JSON.stringify({ocs: {meta: {status: 'ok', statuscode: 200}, data}})
const wrap = text => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">${text}</d:multistatus>`
const resource = (href, props) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const ics = lines => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nextspace fixture//EN', ...lines, 'END:VCALENDAR', ''].join('\r\n')
const day = offset => {const value = new Date(); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0, 10)}
const compactDay = offset => day(offset).replaceAll('-', '')
const davHome = '/remote.php/dav/calendars/fixture-user/'
const taskPath = `${davHome}tasks/task.ics`
let eventPath = `${davHome}home/event.ics`
const resources = new Map([
  [taskPath, {version: 1, raw: ics(['BEGIN:VTODO', 'UID:fixture-task', 'SUMMARY:Fixture task', `DUE;VALUE=DATE:${compactDay(1)}`, 'STATUS:NEEDS-ACTION', 'X-KEEP:preserved', 'END:VTODO'])}],
  [`${davHome}tasks/completed.ics`, {version: 1, raw: ics(['BEGIN:VTODO', 'UID:fixture-completed', 'SUMMARY:Previously completed task', 'COMPLETED:20261020T120000Z', 'PERCENT-COMPLETE:100', 'END:VTODO'])}],
  [`${davHome}tasks/progress.ics`, {version: 1, raw: ics(['BEGIN:VTODO', 'UID:fixture-progress', 'SUMMARY:Native task in progress', 'STATUS:IN-PROCESS', 'PERCENT-COMPLETE:40', 'END:VTODO'])}],
  [eventPath, {version: 1, raw: ics(['BEGIN:VEVENT', 'UID:fixture-event', 'SUMMARY:Fixture event', `DTSTART;VALUE=DATE:${compactDay(0)}`, `DTEND;VALUE=DATE:${compactDay(1)}`, 'X-KEEP:preserved', 'END:VEVENT'])}],
])
const notes = new Map([[137, {id: 137, title: 'Fixture note', category: 'Planner', content: '# Source note\n\nOriginal content', etag: 'note-1', modified: 1}]])
const fileTags = [{id:'51',title:'Client',assignable:true,color:'4488cc'},{id:'52',title:'Managed',assignable:false,color:'aa8844'}]
const noteFileTags = new Set(['52']), deckAttachments = new Map()
let attachmentSequence = 500
const noteFilePath = () => `/Notes/${notes.get(137).category}/${notes.get(137).title}.md`
const fileResource = (filePath, id, directory = false) => resource(`/remote.php/dav/files/fixture-user${filePath}`, `<oc:fileid>${id}</oc:fileid><d:displayname>${escapeXml(filePath.split('/').at(-1))}</d:displayname><d:resourcetype>${directory?'<d:collection/>':''}</d:resourcetype><d:getcontentlength>20</d:getcontentlength><d:getcontenttype>text/markdown</d:getcontenttype>`)
const tagResource = tag => resource(`/remote.php/dav/systemtags/${tag.id}`, `<oc:id>${tag.id}</oc:id><oc:display-name>${escapeXml(tag.title)}</oc:display-name><oc:user-visible>true</oc:user-visible><oc:can-assign>${tag.assignable}</oc:can-assign><nc:color>${tag.color||''}</nc:color>`)
const makeCard = (id, uid) => ({id, stackId: 3, title: `Fixture card ${id}`, description: 'Native Deck text', type: 'plain', owner: {uid: 'fixture-user'}, order: id, done: null, startdate: null, duedate: null, color: null, lastModified: 1, ETag: `card-${id}-1`, assignedUsers: [{participant: {uid}, type: 0}], labels: [], dependentCards: []})
const cards = new Map([[7, makeCard(7, 'fixture-user')], [8, makeCard(8, 'fixture-partner')]])
const deckLabels = [{id:11,title:'Later',color:'F2CF58'},{id:12,title:'Review',color:'3C83D4'}]
const pageInfo = {id: 9, title: 'Fixture collective page', parentId: 0, collectivePath: 'My knowledge/Team 🌿', filePath: '', fileName: 'Readme.md'}
const markdown = '# Fixture collective page\n\n## Actual page content\n\nThis **shared knowledge** came from WebDAV.\n\n<script>window.__injected = true</script>'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const wallpaper = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=', 'base64')
const wallpaperDataUrl = `data:image/png;base64,${wallpaper.toString('base64')}`
const themeBase = `--color-primary:#7b2cbf;--color-primary-text:#ffffff;--color-background-plain:#302042;--color-background-plain-text:#ffffff;--image-background:url('/index.php/apps/theming/background?v=fixture-theme');`
const lightThemeCss = `:root{${themeBase}--color-main-background:#ffffff;--color-main-text:#222222;--color-text-maxcontrast:#6b6b6b;--color-background-hover:#f5f5f5;--color-border:#ededed;--color-primary-element:#7b2cbf;--color-primary-element-text:#ffffff;--color-primary-light:#f2eaf8;--color-primary-light-text:#391559;}`
const darkThemeCss = `:root{${themeBase}--color-main-background:#171717;--color-main-text:#ebebeb;--color-text-maxcontrast:#999999;--color-background-hover:#212121;--color-border:#292929;--color-primary-element:#c09be0;--color-primary-element-text:#171717;--color-primary-light:#2e2338;--color-primary-light-text:#ddc7ef;}`
const legacyPlanner = createPlannerWorkspace()
legacyPlanner.name = 'Legacy fixture planner'
legacyPlanner.properties['legacy-preserved'] = {message:'Keep existing single-file customizations'}
const originalLegacyPlanner = JSON.stringify(legacyPlanner)
let pageDenied = false, cloudPlanner = structuredClone(legacyPlanner), cloudVersion = 1, calendarReadFailures = 0
const metadataRoot = '/remote.php/dav/files/fixture-user/Workspace'
const plannerRoot = `${metadataRoot}/Nextspace`
const plannerFiles = new Map(), plannerDirectories = new Set([metadataRoot])
let plannerVersion = 0
const requests = [], serverFailures = []
let nativeRefreshHold, metadataSyncHold
function requestHold() { let entered,release; return {entered:new Promise(resolve=>entered=resolve),wait:new Promise(resolve=>release=resolve),arrive:()=>entered(),release:()=>release()} }
async function responsive(operation) { let timer;try{return await Promise.race([operation,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('An unrelated IPC edit waited for held background network traffic')),3000))])}finally{clearTimeout(timer)} }
const isMetadataRequest = item => item.path === metadataRoot || item.path === `${metadataRoot}/planner.json` || item.path === plannerRoot || item.path.startsWith(`${plannerRoot}/`)
const nativePutCount = () => requests.filter(item => item.method === 'PUT' && !isMetadataRequest(item)).length
const nativeRequestCount = () => requests.filter(item => !isMetadataRequest(item)).length
function cloudFolderWorkspace() {
  const manifest = JSON.parse(plannerFiles.get(`${plannerRoot}/manifest.json`)?.raw || 'null')
  assert.equal(manifest?.format, 'nextspace-planner-folder', 'Folder migration publishes a format marker')
  const prefix = `${plannerRoot}/${manifest.generation}/`
  const documents = new Map([...plannerFiles].filter(([name]) => name.startsWith(prefix) && !['legacy-import.json','legacy-original.json'].includes(name.slice(prefix.length))).map(([name, file]) => [name.slice(prefix.length),JSON.parse(file.raw)]))
  return {manifest,documents,workspace:assembleWorkspace(documents)}
}
const bumpCard = card => {card.lastModified++; card.ETag = `card-${card.id}-${card.lastModified}`}
const send = (res, body = '', status = 200, headers = {}) => {res.writeHead(status, {'Content-Type': 'application/json', ...headers}); res.end(status === 204 ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))}
const server = createServer(async (req, res) => {
  try {
    const route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const input = Buffer.concat(chunks).toString('utf8')
    requests.push({method: req.method, path: route})
    assert.equal(req.headers.authorization, `Basic ${Buffer.from('fixture-login:fixture-password').toString('base64')}`)
    if (route.endsWith('/cloud/user')) return send(res, ocs({id: 'fixture-user'}))
    if (route.endsWith('/cloud/capabilities')) return send(res, ocs({capabilities: {theming: {name: 'Fixture Cloud', color: '#7B2CBF', 'color-text': '#ffffff', enabledThemes:['dark'], cacheBuster:'fixture-theme'}, notes: {api_version: ['1.3']}, deck: {version: '1.18.0'}}}))
    if (route === '/index.php/apps/theming/theme/default.css') return send(res, lightThemeCss, 200, {'Content-Type':'text/css'})
    if (route === '/index.php/apps/theming/theme/dark.css') return send(res, darkThemeCss, 200, {'Content-Type':'text/css'})
    if (route === '/index.php/apps/theming/background') {
      if (req.headers['if-none-match'] === '"fixture-wallpaper"') return send(res, '', 304, {ETag:'"fixture-wallpaper"'})
      return send(res, wallpaper, 200, {'Content-Type':'image/png', ETag:'"fixture-wallpaper"'})
    }
    if (route === `${metadataRoot}/planner.json` && req.method === 'PROPFIND') {
      return cloudPlanner
        ? send(res, wrap(resource(route, `<d:getetag>"planner-${cloudVersion}"</d:getetag><d:resourcetype/><d:getcontenttype>application/json</d:getcontenttype>`)), 207, {'Content-Type':'application/xml'})
        : send(res, '', 404)
    }
    if (route === metadataRoot || route === plannerRoot || route.startsWith(`${plannerRoot}/`)) {
      const location = route.replace(/\/$/, '')
      const stored = plannerFiles.get(location)
      const etag = stored ? `"metadata-${stored.version}"` : null
      const directory = plannerDirectories.has(location)
      if (stored && location === `${plannerRoot}/manifest.json` && ['GET', 'PROPFIND'].includes(req.method) && metadataSyncHold) {
        const hold=metadataSyncHold;metadataSyncHold=undefined;hold.arrive();await hold.wait
      }
      if (req.method === 'MKCOL') {
        if (directory || stored) return send(res, '', 405)
        if (!plannerDirectories.has(location.slice(0, location.lastIndexOf('/')))) return send(res, '', 409)
        plannerDirectories.add(location); return send(res, '', 201)
      }
      if (req.method === 'PROPFIND') {
        if (!directory && !stored) return send(res, '', 404)
        const props = (name, file) => resource(`${name}${file?'':'/'}`, file ? `<d:getetag>"metadata-${file.version}"</d:getetag><d:resourcetype/><d:getcontenttype>application/json</d:getcontenttype>` : '<d:resourcetype><d:collection/></d:resourcetype>')
        let body = props(location, stored)
        if (directory && req.headers.depth !== '0') {
          const child = name => name.startsWith(`${location}/`) && !name.slice(location.length + 1).includes('/')
          body += [...plannerDirectories].filter(child).map(name => props(name)).join('')
          body += [...plannerFiles].filter(([name]) => child(name)).map(([name, value]) => props(name, value)).join('')
        }
        return send(res, wrap(body), 207, {'Content-Type':'application/xml'})
      }
      if (req.method === 'GET') {
        if (!stored) return send(res, '', 404)
        if (req.headers['if-match'] && req.headers['if-match'] !== etag) return send(res, '', 412)
        if ([etag,`W/${etag}`].includes(req.headers['if-none-match'])) return send(res, '', 304, {ETag:etag})
        // Reproduce a representation/proxy weak GET validator. WebDAV getetag
        // remains strong; a weak If-Match must never pass the PUT below.
        return send(res, stored.raw, 200, {ETag:`W/${etag}`})
      }
      if (req.method === 'PUT') {
        if (!plannerDirectories.has(location.slice(0, location.lastIndexOf('/')))) return send(res, '', 409)
        if (stored ? req.headers['if-match'] !== etag : req.headers['if-none-match'] !== '*') return send(res, '', 412)
        JSON.parse(input)
        plannerFiles.set(location, {raw:input,version:++plannerVersion})
        return send(res, '', stored?204:201, {ETag:`"metadata-${plannerVersion}"`})
      }
    }
    if (req.method === 'PROPFIND') {
      let body
      if (route === '/remote.php/dav/') body = resource(route, '<d:current-user-principal><d:href>/remote.php/dav/principals/users/fixture-user/</d:href></d:current-user-principal>')
      else if (route.includes('/principals/')) body = resource(route, `<c:calendar-home-set><d:href>${davHome}</d:href></c:calendar-home-set>`)
      else if (route === davHome) body = [['home', 'Közös fixture', 'VEVENT', '#DA672A'], ['work', 'Freelance fixture', 'VEVENT', '#3474D4'], ['tasks', 'Fixture Tasks', 'VTODO', '#729933']].map(([key, title, component, color]) => resource(`${davHome}${key}/`, `<d:displayname>${title}</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="${component}"/></c:supported-calendar-component-set><a:calendar-color>${color}</a:calendar-color><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>`)).join('')
      else if (['home','work','tasks'].some(key=>route===`${davHome}${key}/`)) body = resource(route, `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="${route.endsWith('/tasks/')?'VTODO':'VEVENT'}"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>`)
      if (body !== undefined) return send(res, wrap(body), 207, {'Content-Type': 'application/xml'})
    }
    if (req.method === 'REPORT' && route.startsWith(davHome)) {
      const component = input.includes('name="VTODO"') ? 'VTODO' : 'VEVENT'
      const body = [...resources.entries()].filter(([href, item]) => href.startsWith(route) && item.raw.includes(`BEGIN:${component}`)).map(([href, item]) => resource(href, `<d:getetag>"dav-${item.version}"</d:getetag><c:calendar-data>${escapeXml(item.raw)}</c:calendar-data>`)).join('')
      if (component === 'VTODO' && nativeRefreshHold) { const hold=nativeRefreshHold;nativeRefreshHold=undefined;hold.arrive();await hold.wait }
      return send(res, wrap(body), 207, {'Content-Type': 'application/xml'})
    }
    if (req.method === 'PUT' && route.startsWith(davHome) && route.endsWith('.ics')) {
      const existing = resources.get(route)
      if (existing ? req.headers['if-match'] !== `"dav-${existing.version}"` : req.headers['if-none-match'] !== '*') return send(res, '', 412)
      new ICAL.Component(ICAL.parse(input))
      const version = (existing?.version || 0) + 1; resources.set(route, {raw: input, version})
      return send(res, '', existing ? 204 : 201, {ETag: `"dav-${version}"`})
    }
    if (req.method === 'GET' && route.startsWith(davHome) && route.endsWith('.ics')) {
      if (calendarReadFailures-- > 0) return send(res, '', 503)
      const existing = resources.get(route)
      return send(res, existing?.raw || '', existing ? 200 : 404, existing ? {ETag: `"dav-${existing.version}"`, 'Content-Type': 'text/calendar'} : {})
    }
    if (route === '/remote.php/dav/' && req.method === 'SEARCH') {
      assert.match(input, /<oc:fileid\/>/);assert.match(input, /<d:literal>137<\/d:literal>/)
      return send(res, wrap(fileResource(noteFilePath(),137)), 207)
    }
    if (route === '/remote.php/dav/files/fixture-user/Notes' && req.method === 'PROPFIND') return send(res, wrap(fileResource('/Notes',20,true)+fileResource(noteFilePath(),137)),207)
    if (route === `/remote.php/dav/files/fixture-user${noteFilePath()}` && req.method === 'PROPFIND') return send(res, wrap(fileResource(noteFilePath(),137)),207)
    if (route === '/remote.php/dav/systemtags/' && req.method === 'PROPFIND') return send(res, wrap(fileTags.map(tagResource).join('')),207)
    const fileTagDetails=route.match(/^\/remote.php\/dav\/systemtags\/(\d+)$/)
    if (fileTagDetails && req.method === 'PROPFIND') {
      assert.equal(req.headers.depth,'0')
      const tag=fileTags.find(item=>item.id===fileTagDetails[1])
      return tag ? send(res,wrap(tagResource(tag)),207) : send(res,'',404)
    }
    if (route === '/remote.php/dav/systemtags/' && req.method === 'POST') {
      const value=JSON.parse(input);assert.equal(value.userVisible,true);assert.equal(value.userAssignable,true)
      if(fileTags.some(tag=>tag.title.toLocaleLowerCase()===value.name.toLocaleLowerCase()))return send(res,'',409)
      const tag={id:String(Math.max(...fileTags.map(tag=>Number(tag.id)))+1),title:value.name,assignable:true}
      fileTags.push(tag);return send(res,'',201,{'Content-Location':`/remote.php/dav/systemtags/${tag.id}`})
    }
    if (route === '/remote.php/dav/systemtags-relations/files/137' && req.method === 'PROPFIND') return send(res, wrap(fileTags.filter(tag=>noteFileTags.has(tag.id)).map(tagResource).join('')),207)
    const fileTagMatch=route.match(/^\/remote.php\/dav\/systemtags-relations\/files\/137\/(\d+)$/)
    if (fileTagMatch) {
      const tag=fileTags.find(tag=>tag.id===fileTagMatch[1]);assert.ok(tag?.assignable)
      if(req.method==='PUT')noteFileTags.add(tag.id);else if(req.method==='DELETE')noteFileTags.delete(tag.id);else throw Error('Unexpected file tag mutation')
      return send(res,'',204)
    }
    if (route === '/ocs/v2.php/apps/files_sharing/api/v1/shares' && req.method==='POST') {
      const share=JSON.parse(input);assert.deepEqual(share,{path:noteFilePath(),shareType:12,shareWith:'7',permissions:1})
      const id=++attachmentSequence;deckAttachments.set(String(id),{id,cardId:7,type:'file',data:notes.get(137).title+'.md',extendedData:{fileid:137,path:noteFilePath(),filesize:20,mimetype:'text/markdown'}})
      cards.get(7).attachmentCount=deckAttachments.size;bumpCard(cards.get(7));return send(res,ocs({id}),201)
    }
    const attachmentMatch=route.match(/^\/index.php\/apps\/deck\/api\/v1\.1\/boards\/2\/stacks\/[34]\/cards\/7\/attachments(?:\/(\d+))?$/)
    if (attachmentMatch) {
      if(req.method==='DELETE'){assert.equal(new URL(req.url,serverUrl).searchParams.get('type'),'file');deckAttachments.delete(attachmentMatch[1]);cards.get(7).attachmentCount=deckAttachments.size;bumpCard(cards.get(7));return send(res,'',204)}
      assert.equal(req.method,'GET');return send(res,[...deckAttachments.values()])
    }
    if(route.startsWith('/ocs/v2.php/apps/related_resources/related/'))return send(res,ocs([{providerId:'files',itemId:'137',title:'Related note file',subtitle:'Files',url:'/index.php/f/137'}]))
    if (route.endsWith('/notes/api/v1/notes') && req.method === 'GET') return send(res, [...notes.values()])
    if (route.endsWith('/notes/api/v1/notes') && req.method === 'POST') {
      const id = Math.max(...notes.keys()) + 1, value = {...JSON.parse(input), id, etag: `note-${id}-1`, modified: 1}
      notes.set(id, value); return send(res, value, 201)
    }
    const noteMatch = route.match(/\/notes\/api\/v1\/notes\/(\d+)$/)
    if (noteMatch && req.method === 'GET') {
      const note = notes.get(Number(noteMatch[1])); return note ? send(res, note) : send(res, '', 404)
    }
    if (noteMatch && req.method === 'PUT') {
      const note = notes.get(Number(noteMatch[1])); if (!note) return send(res, '', 404)
      if (req.headers['if-match'] !== `"${note.etag}"`) return send(res, note, 412)
      Object.assign(note, JSON.parse(input), {modified: note.modified + 1, etag: `${note.etag}-next`}); return send(res, note)
    }
    if (route.endsWith('/deck/api/v1.0/boards')) return send(res, [{id: 2, title: 'Fixture Deck', color: '7B2CBF', labels: deckLabels, permissions: {PERMISSION_READ: true, PERMISSION_EDIT: true}}])
    if (route === '/index.php/apps/deck/api/v1.0/boards/2' && req.method === 'GET') return send(res, {id:2,title:'Fixture Deck',color:'7B2CBF',labels:deckLabels,permissions:{PERMISSION_READ:true,PERMISSION_EDIT:true},archived:false,deletedAt:0})
    if (route === '/index.php/apps/deck/api/v1.0/boards/2/labels' && req.method === 'POST') {
      const value=JSON.parse(input)
      assert.equal(typeof value.title,'string');assert.ok(value.title.length>0&&value.title.length<=100);assert.match(value.color,/^[0-9a-f]{6}$/i)
      const label={id:Math.max(...deckLabels.map(item=>item.id))+1,boardId:2,title:value.title,color:value.color}
      deckLabels.push(label);return send(res,label)
    }
    if (route.endsWith('/deck/api/v1.0/boards/2/stacks')) return send(res, [{id: 3, title: 'To do'}, {id: 4, title: 'Doing'}].map(stack => ({...stack, cards: [...cards.values()].filter(card => card.stackId === stack.id)})))
    const stackMatch = route.match(/\/deck\/api\/v1\.0\/boards\/2\/stacks\/([34])$/)
    if (stackMatch && req.method === 'GET') return send(res, {id:Number(stackMatch[1]),boardId:2,title:stackMatch[1]==='3'?'To do':'Doing',deletedAt:0})
    const createCardMatch = route.match(/\/deck\/api\/v1\.0\/boards\/2\/stacks\/(\d+)\/cards$/)
    if (createCardMatch && req.method === 'POST') {
      const inputCard = JSON.parse(input), id = Math.max(...cards.keys()) + 1
      const card = {...makeCard(id, 'fixture-user'), ...inputCard, id, stackId: Number(createCardMatch[1]), assignedUsers: (inputCard.users || []).map(user => ({participant: {uid: user.id}, type: user.type}))}
      cards.set(id, card); return send(res, card, 201)
    }
    const cardMatch = route.match(/\/deck\/api\/v1\.0\/boards\/2\/stacks\/(\d+)\/cards\/(\d+)(.*)$/)
    if (cardMatch) {
      const card = cards.get(Number(cardMatch[2])); if (!card) return send(res, '', 404)
      const action = cardMatch[3]
      if (req.method === 'GET' && !action) return send(res, card, 200, {ETag: card.ETag})
      if (req.headers['if-match'] && req.headers['if-match'] !== card.ETag) return send(res, '', 412)
      if (req.method === 'PUT' && !action) Object.assign(card, JSON.parse(input))
      else if (req.method === 'PUT' && action === '/reorder') {
        const update = JSON.parse(input), destination = Number(cardMatch[1])
        assert.ok([3, 4].includes(destination)); assert.equal(update.stackId, destination)
        assert.deepEqual(Object.keys(update).sort(), ['order','stackId'])
        Object.assign(card, {stackId:destination,order:0}); bumpCard(card)
        return send(res, [...cards.values()].filter(item => item.stackId === destination))
      }
      else if (req.method === 'PUT' && ['/assignLabel','/removeLabel'].includes(action)) {
        const label = deckLabels.find(item => item.id === JSON.parse(input).labelId); assert.ok(label)
        card.labels = action === '/assignLabel' ? [...card.labels.filter(item => item.id !== label.id), label] : card.labels.filter(item => item.id !== label.id)
      }
      else if (/^\/dependentCards\/\d+$/.test(action) && ['POST', 'DELETE'].includes(req.method)) {
        const target = Number(action.split('/').at(-1)); assert.ok(cards.has(target))
        card.dependentCards = req.method === 'POST' ? [...new Set([...card.dependentCards, target])] : card.dependentCards.filter(id => id !== target)
      } else throw new Error(`Unexpected Deck fixture action: ${req.method} ${action}`)
      bumpCard(card); return send(res, card)
    }
    if (route.endsWith('/collectives/api/v1.0/collectives')) return send(res, ocs({collectives: [{id: 7, name: 'Fixture Team'}]}))
    if (route.endsWith('/collectives/7/pages')) return send(res, ocs({pages: [pageInfo]}))
    if (route.endsWith('/collectives/7/pages/9')) return send(res, pageDenied ? '' : ocs({page: pageInfo}), pageDenied ? 403 : 200)
    if (route === '/remote.php/dav/files/fixture-user/My knowledge/Team 🌿/Readme.md') return send(res, markdown, 200, {'Content-Type': 'text/markdown', ETag: '"page-v1"'})
    if (route === '/remote.php/dav/files/fixture-user/My knowledge/Team 🌿/.attachments.9/diagram.png') return send(res, png, 200, {'Content-Type': 'image/png'})
    if (route === '/remote.php/dav/files/fixture-user/Workspace/planner.json') {
      if (req.method === 'GET') return send(res, cloudPlanner || '', cloudPlanner ? 200 : 404, cloudPlanner ? {ETag: `"planner-${cloudVersion}"`} : {})
      if (req.method === 'PUT') {
        if (cloudPlanner ? req.headers['if-match'] !== `"planner-${cloudVersion}"` : req.headers['if-none-match'] !== '*') return send(res, '', 412)
        cloudPlanner = JSON.parse(input); assert.equal(cloudPlanner.schemaVersion, 2); cloudVersion++
        return send(res, '', 204, {ETag: `"planner-${cloudVersion}"`})
      }
    }
    if (['PUT', 'POST', 'DELETE', 'MKCOL'].includes(req.method)) throw new Error(`Unexpected fixture write: ${req.method} ${route}`)
    return send(res, '', 404)
  } catch (error) {serverFailures.push(error.message); if (!res.headersSent) res.writeHead(500); res.end('Fixture failed')}
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const serverUrl = `http://127.0.0.1:${server.address().port}`
const env = {...process.env, NEXTSPACE_DATA_DIR: dataDir, NEXTSPACE_TEST_MODE: '1'}
delete env.ELECTRON_RUN_AS_NODE; delete env.NEXTSPACE_DEV_URL
let app, page, encryptedPath, originalEncrypted, passed = false
const rendererErrors = []
const launch = async () => {
  app = await electron.launch({executablePath: require('electron'), args: [path.join(cwd, 'win')], cwd, env, timeout: 45000})
  page = await app.firstWindow(); page.on('pageerror', error => rendererErrors.push(error.message))
  await page.waitForFunction(() => Boolean(window.workspaceApi), null, {timeout: 30000})
  await page.waitForFunction(() => Boolean(document.querySelector('#app')?.textContent?.trim()), null, {timeout: 30000})
}
const targetedEdits = new Set(['updateNote', 'updateDescription', 'updateRecordDates', 'setTaskCompleted', 'setTaskDue', 'updateEvent', 'setCardCompleted', 'moveCard', 'updateTaskStatus', 'updateRecordAppearance'])
const invoke = async (method, ...args) => {
  const before = targetedEdits.has(method) ? await page.evaluate(() => window.workspaceApi.getState()) : null
  const start = requests.length
  let result
  try { result = await page.evaluate(({method, args}) => window.workspaceApi[method](...args), {method, args}) }
  catch (error) { throw new Error(`${error.message}\nFixture requests: ${JSON.stringify(requests.slice(start))}`, {cause:error}) }
  if (targetedEdits.has(method)) {
    // A scheduled planner sync may interleave with the selected native edit.
    // Its metadata file is independent of native source refresh/read/write bounds.
    const activity = requests.slice(start).filter(item => !isMetadataRequest(item))
    const editedRecord = before.records.find(item=>item.id===args[0].id)
    const eventCollectionPath = editedRecord?.source==='calendar' ? ['home','work'].map(key=>`${davHome}${key}/`).find(href=>editedRecord.collectionId.endsWith(href)) : undefined
    const boardPreflight = item => editedRecord?.source==='deck' && item.method==='GET' && item.path==='/index.php/apps/deck/api/v1.0/boards/2'
    assert.ok(activity.filter(boardPreflight).length<=1,'A Deck mutation checks its current owner board once at most')
    const selectedActivity=activity.filter(item=>!boardPreflight(item))
    assert.ok(selectedActivity.length <= (method === 'updateRecordAppearance' ? 5 : method === 'moveCard' ? 4 : eventCollectionPath ? 3 : 2), `${method} must only write/read its own resource, not refresh every source: ${JSON.stringify(activity)}`)
    assert.ok(selectedActivity.every(item => item.method === 'PROPFIND' && item.path === eventCollectionPath || ['GET', 'PUT'].includes(item.method) && (/(?:\.ics|\/notes\/\d+|\/cards\/\d+(?:\/(?:reorder|assignLabel|removeLabel))?)$/.test(item.path) || method === 'moveCard' && item.method === 'GET' && item.path.endsWith(`/boards/2/stacks/${args[0].stackId}`))), `${method} fetched an unrelated source: ${JSON.stringify(activity)}`)
    if (method === 'updateRecordAppearance') assert.equal(new Set(selectedActivity.map(item => item.path.replace(/\/(?:assignLabel|removeLabel)$/, ''))).size, 1, 'Color/tag edits touch only the selected native item and its label assignments')
    if (method !== 'moveCard') {
      assert.equal(result.revision, before.revision, `${method} must not change the planner metadata revision`)
      assert.deepEqual(result.workspace, before.workspace, `${method} must preserve planner metadata and identities`)
      if (method === 'updateNote' && args[0].category !== undefined) {
        const existingIds = new Set(before.collections.map(collection => collection.id))
        assert.deepEqual(result.collections.filter(collection => existingIds.has(collection.id)), before.collections, 'Changing a note category must preserve every existing source collection')
        const added = result.collections.filter(collection => !existingIds.has(collection.id))
        const editedNote = result.records.find(record => record.id === args[0].id)
        assert.ok(added.length <= 1, 'A category move may add only its single Notes destination')
        if (added.length) assert.deepEqual(added[0], {id: editedNote.collectionId, source: 'notes', title: args[0].category || 'Uncategorized (default)'})
        assert.equal(result.collections.find(collection => collection.id === editedNote.collectionId)?.source, 'notes')
      } else assert.deepEqual(result.collections, before.collections, `${method} must preserve collections`)
      assert.deepEqual(result.records.filter(item => item.id !== args[0].id), before.records.filter(item => item.id !== args[0].id), `${method} must preserve every unrelated cached record`)
    }
  }
  return result
}
const expectRejected = async (method, args, pattern) => {
  const result = await page.evaluate(async ({method, args}) => {try {await window.workspaceApi[method](...args); return {rejected: false}} catch (error) {return {rejected: true, message: error.message}}}, {method, args})
  assert.equal(result.rejected, true, `${method} should reject`); assert.match(result.message, pattern)
}
function assertAccount(state, connected) {
  assert.equal(state.mode, 'live', 'Saved account must never fall back to samples')
  assert.equal(state.connection.connected, connected); assert.equal(state.connection.username, 'fixture-user')
  assert.equal(state.workspace.schemaVersion, 2); assert.equal(state.workspace.name, 'Authenticated fixture planner')
  assert.equal(state.workspace.spaces[0].name, 'Közös fixture space'); assert.equal(Object.hasOwn(state.workspace, 'dashboards'), false)
  assert.equal(state.workspace.properties['legacy-preserved'].message, 'Keep existing single-file customizations')
  assert.ok(state.records.every(record => !record.id.startsWith('demo:')))
  assert.ok(state.records.every(record => !record.remote && !record.identity), 'Private transport records must be stripped')
  assert.ok(!JSON.stringify(state).includes('fixture-password'))
}
function assertTheme(state) {
  assert.equal(state.theme.color, '#7b2cbf')
  assert.equal(state.theme.mode, 'dark')
  assert.equal(state.theme.backgroundColor, '#302042')
  assert.equal(state.theme.backgroundTextColor, '#ffffff')
  assert.equal(state.theme.backgroundDataUrl, wallpaperDataUrl)
  assert.equal(state.theme.light.surfaceColor, '#ffffff')
  assert.equal(state.theme.light.primaryColor, '#7b2cbf')
  assert.deepEqual(state.theme.darkPalette, {surfaceColor:'#171717',textColor:'#ebebeb',mutedColor:'#999999',hoverColor:'#212121',borderColor:'#292929',primaryColor:'#c09be0',primaryTextColor:'#171717',primaryLightColor:'#2e2338',primaryLightTextColor:'#ddc7ef'})
}
const assertRenderedTheme = async () => {
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.documentElement.style.getPropertyValue('--primary') === '#c09be0')
  const theme = await page.evaluate(() => ({surface:document.documentElement.style.getPropertyValue('--surface'), text:document.documentElement.style.getPropertyValue('--text'), background:getComputedStyle(document.body).backgroundImage}))
  assert.deepEqual(theme, {surface:'#171717',text:'#ebebeb',background:`url("${wallpaperDataUrl}")`})
}
async function pauseRendererBackground() {
  // This test measures each direct IPC edit's exact resource/revision effects.
  // After startup/theming has rendered, use Vue's real cleanup to stop its
  // independent polling/debounce timers. Keep the preload bridge and all main-
  // process behavior live. Explicit held-network tests below still exercise
  // refresh/sync overlap; frontend polling is covered by background UI tests.
  await page.waitForFunction(() => {
    if(document.querySelector('.sync-activity-icon.spinning,.source-save-status'))return false
    const root=document.querySelector('#app'),mounted=root?.__vue_app__
    if(!mounted)return false
    mounted.unmount()
    return true
  })
}
try {
  await launch()
  assert.deepEqual((await invoke('getState')).records, [], 'Disconnected launch must not create example data')
  let state = await invoke('connect', {serverUrl, username: 'fixture-login', appPassword: 'fixture-password'})
  assert.ok(state.statuses.every(status => status.state === 'connected'), JSON.stringify(state.statuses))
  assert.equal(state.theme.color, '#7b2cbf'); assert.equal(state.connection.username, 'fixture-user')
  assertTheme(state)
  await page.reload()
  await assertRenderedTheme()
  await page.waitForFunction(() => document.querySelector('[aria-label="Refresh Nextcloud sources"]')?.disabled === false)
  await pauseRendererBackground()
  // Establish the remote baseline before introducing unrelated local edits.
  // Otherwise the intentional first-sync conflict guard correctly retains both
  // the pre-existing remote planner and the newly customized local planner.
  state = await invoke('syncWorkspace'); assertTheme(state)
  assert.equal(state.storage.syncStatus, 'synced', JSON.stringify({storage:state.storage,requests:requests.filter(isMetadataRequest).slice(-15),serverFailures}))
  const find = (kind, title) => state.records.find(item => item.kind === kind && (!title || item.title === title))
  assert.equal(find('task', 'Previously completed task').completed, true, 'COMPLETED timestamp without STATUS stays completed through the desktop bridge')
  assert.equal(find('task', 'Native task in progress').status, 'IN-PROCESS')
  assert.equal(find('task', 'Native task in progress').percentComplete, 40)
  const taskId = find('task').id, eventId = find('event').id, noteId = find('note').id, pageId = find('page').id
  const cardId = find('card', 'Fixture card 7').id, partnerId = find('card', 'Fixture card 8').id
  assert.ok([taskId, eventId, noteId, pageId, cardId, partnerId].every(id => /^[0-9a-f-]{36}$/i.test(id)))
  assert.deepEqual(find('card', 'Fixture card 7').assigneeIds, ['fixture-user'])
  const calendar = state.collections.find(item => item.source === 'calendar' && item.title === 'Közös fixture')
  const deck = state.collections.find(item => item.source === 'deck'), tasks = state.collections.find(item => item.source === 'tasks')
  assert.equal(calendar.color, '#da672a'); assert.deepEqual(deck.stacks.map(stack => stack.id), ['3', '4'])
  // Hold a stale native response open while editing both local metadata and
  // the task itself. Neither write may sit behind refresh's network traffic.
  const nativeHold=requestHold();nativeRefreshHold=nativeHold
  const refreshing=page.evaluate(()=>window.workspaceApi.refresh())
  await responsive(nativeHold.entered)
  try {
    state=await responsive(invoke('getState'))
    const changed=structuredClone(state.workspace);changed.properties['during-native-refresh']={saved:true}
    await responsive(invoke('saveWorkspace',changed,state.revision))
    state=await responsive(page.evaluate(input=>window.workspaceApi.updateTaskStatus(input),{id:taskId,status:'IN-PROCESS',etag:state.records.find(item=>item.id===taskId).etag}))
    assert.equal(state.records.find(item=>item.id===taskId).status,'IN-PROCESS')
  } finally { nativeHold.release() }
  state=await refreshing
  assert.equal(state.records.find(item=>item.id===taskId).status,'IN-PROCESS','Stale native refresh must not erase an acknowledged edit')
  assert.equal(state.workspace.properties['during-native-refresh'].saved,true)
  const metadataHold=requestHold();metadataSyncHold=metadataHold
  const syncing=page.evaluate(()=>window.workspaceApi.syncWorkspace())
  await responsive(metadataHold.entered)
  try {
    state=await responsive(invoke('getState'))
    const changed=structuredClone(state.workspace);changed.properties['during-metadata-sync']={saved:true}
    await responsive(invoke('saveWorkspace',changed,state.revision))
    state=await responsive(page.evaluate(input=>window.workspaceApi.updateTaskStatus(input),{id:taskId,status:'NEEDS-ACTION',etag:state.records.find(item=>item.id===taskId).etag}))
  } finally { metadataHold.release() }
  state=await syncing
  assert.equal(state.workspace.properties['during-metadata-sync'].saved,true)
  assert.equal(state.records.find(item=>item.id===taskId).status,'NEEDS-ACTION')
  assert.equal(state.storage.syncStatus,'pending','Newer shared edits need a follow-up background sync')
  state=await invoke('syncWorkspace')
  assert.equal(cloudFolderWorkspace().workspace.properties['during-metadata-sync'].saved,true)
  const workspace = structuredClone(state.workspace), spaceId = randomUUID(), projectId = randomUUID()
  workspace.name = 'Authenticated fixture planner'
  workspace.spaces.push({id: spaceId, name: 'Közös fixture space', color: '#7b2cbf', collectionIds: [calendar.id, deck.id, tasks.id], defaultCalendarId: calendar.id, defaultTaskListId: tasks.id, defaultBoardId: deck.id})
  workspace.projects.push({id: projectId, spaceId, name: 'Fixture project', collectionIds: [], recordIds: [cardId]})
  workspace.relations.push({id: randomUUID(), type: 'depends_on', fromId: cardId, toId: taskId}, {id: randomUUID(), type: 'for_event', fromId: cardId, toId: eventId, role: 'preparation'}, {id: randomUUID(), type: 'reference', fromId: taskId, toId: noteId})
  workspace.properties[noteId] = {'Recovery marker': 'Saved before restart'}
  await invoke('saveWorkspace', workspace, state.revision)
  state = await invoke('getState'); assertAccount(state, true)
  assert.equal((await invoke('readPage', {id: pageId})).body, markdown)
  assert.match((await invoke('readPageAsset', {id: pageId, path: '.attachments.9/diagram.png'})).dataUrl, /^data:image\/png;base64,/)
  await expectRejected('readPageAsset', [{id: pageId, path: '../../../private.png'}], /unsafe|relative|path|outside its collective/i)

  // Native Notes -> file identity -> Deck share, and native Files tags. No
  // custom relation is required, so another client can discover these links.
  assert.equal(state.records.find(item=>item.id===noteId).fileId,'137')
  assert.equal((await invoke('listFiles',{path:'/Notes'})).files[0].id,'137')
  await expectRejected('listFiles',[{path:'/../private'}],/path inside/)
  const beforeNoteTags=requests.length
  const noteTagRead=await invoke('readNoteTags',{id:noteId})
  assert.equal(noteTagRead.tags[0].assignable,false)
  assert.deepEqual(noteTagRead.availableTags,noteTagRead.tags,'The note picker receives assigned tags instead of a global Files catalog')
  const assignedTags=await invoke('setNoteTags',{id:noteId,tagIds:['51'],newTags:['Project brief']})
  assert.deepEqual(assignedTags.tags.map(tag=>tag.title),['Client','Managed','Project brief'])
  assert.ok(!requests.slice(beforeNoteTags).some(item=>item.method==='PROPFIND'&&item.path==='/remote.php/dav/systemtags/'),'Assigned reads and new native tag creation use individual IDs without fetching the global catalog')
  const oldForward={id:randomUUID(),type:'reference',fromId:cardId,toId:noteId}
  const oldReverse={id:randomUUID(),type:'related',fromId:noteId,toId:cardId}
  state=await invoke('getState')
  const oldLinks=structuredClone(state.workspace);oldLinks.relations.push(oldForward,oldReverse)
  await invoke('saveWorkspace',oldLinks,state.revision);state=await invoke('syncWorkspace')
  assert.ok(cloudFolderWorkspace().workspace.relations.some(link=>link.id===oldForward.id))
  const converted=await invoke('migrateDeckNoteLinks',{limit:1})
  assert.equal(converted.converted,2);assert.equal(converted.remaining,0);assert.deepEqual(converted.errors,[])
  state=converted.state
  assert.ok(!state.workspace.relations.some(link=>[oldForward.id,oldReverse.id].includes(link.id)))
  assert.ok(state.workspace.relations.some(link=>link.fromId===taskId&&link.toId===noteId),'Migration preserves task-note references')
  state=await invoke('syncWorkspace')
  const migratedFolder=cloudFolderWorkspace()
  assert.ok(!migratedFolder.workspace.relations.some(link=>[oldForward.id,oldReverse.id].includes(link.id)))
  assert.ok([...migratedFolder.documents.values()].some(document=>document.key===oldForward.id&&document.deleted===true),'Old custom link is tombstoned for other PCs')
  assert.equal((await invoke('migrateDeckNoteLinks')).converted,0,'Migration is idempotent')
  const attached=await invoke('attachDeckFile',{id:cardId,noteId})
  assert.equal(attached.attachments[0].fileId,'137')
  await invoke('attachDeckFile',{id:cardId,noteId})
  assert.equal(requests.filter(item=>item.path.endsWith('/files_sharing/api/v1/shares')&&item.method==='POST').length,1)
  state=await invoke('getState');assert.deepEqual(state.records.find(item=>item.id===cardId).attachmentFileIds,['137'])
  assert.equal(state.records.find(item=>item.id===noteId).tagDetails.length,3)
  assert.equal((await invoke('readRelatedResources',{id:cardId})).resources[0].title,'Related note file')
  assert.deepEqual((await invoke('removeDeckAttachment',{id:cardId,attachmentId:attached.attachments[0].id})).attachments,[])
  assert.ok(notes.has(137),'Detaching a note must retain its original file/content')
  await invoke('attachDeckFile',{id:cardId,path:noteFilePath()})
  state=await invoke('getState')
  state=await invoke('updateNote',{id:noteId,title:state.records.find(item=>item.id===noteId).title,content:state.records.find(item=>item.id===noteId).body,category:'Updated category',etag:state.records.find(item=>item.id===noteId).etag})
  assert.equal(notes.get(137).category,'Updated category');assert.equal(state.records.find(item=>item.id===noteId).tagDetails.length,3)

  resources.get(taskPath).raw = resources.get(taskPath).raw.replace('SUMMARY:Fixture task', 'SUMMARY:Renamed task'); resources.get(taskPath).version++
  notes.get(137).title = 'Renamed source note'; notes.get(137).category = 'Changed category'; notes.get(137).etag = 'note-renamed'
  cards.get(7).title = 'Renamed source card'; bumpCard(cards.get(7))
  const movedEvent = resources.get(eventPath); resources.delete(eventPath)
  eventPath = `${davHome}work/moved.ics`; resources.set(eventPath, movedEvent)
  state = await invoke('refresh')
  assertTheme(state)
  assert.equal(find('task', 'Renamed task').id, taskId); assert.equal(find('note', 'Renamed source note').id, noteId)
  assert.equal(find('card', 'Renamed source card').id, cardId); assert.equal(find('event').id, eventId)
  assert.deepEqual(find('card','Renamed source card').attachmentFileIds,['137']);assert.equal(find('note','Renamed source note').fileId,'137')
  assert.ok(state.workspace.relations.some(link => link.fromId === cardId && link.toId === eventId))

  state = await invoke('setTaskDue', {id: taskId, due: day(3)}); assert.equal(state.records.find(item => item.id === taskId).due, day(3))
  state = await invoke('setTaskCompleted', {id: taskId, completed: true}); assert.equal(state.records.find(item => item.id === taskId).completed, true)
  assert.match(resources.get(taskPath).raw, /X-KEEP:preserved/)
  state = await invoke('updateNote', {id: noteId, title: 'Edited through planner', content: '# Saved native note', etag: state.records.find(item => item.id === noteId).etag})
  assert.equal(state.records.find(item => item.id === noteId).body, '# Saved native note')
  state = await invoke('updateEvent', {id: eventId, start: day(2), end: day(3), allDay: true}); assert.equal(state.records.find(item => item.id === eventId).start, day(2))
  assert.match(resources.get(eventPath).raw, /X-KEEP:preserved/)
  state = await invoke('createEvent', {title: 'Planner-created fixture event', collectionId: calendar.id, start: day(4), end: day(5), allDay: true})
  assert.ok(state.records.some(item => item.title === 'Planner-created fixture event'))
  const createdEventId = state.createdRecordId
  assert.equal(state.records.find(item => item.id === createdEventId).title, 'Planner-created fixture event')
  const beforeCreations = requests.length
  state = await invoke('createTask', {title: 'Created ranged task', collectionId: tasks.id, start: day(3), due: day(5), description: '- [ ] First step'})
  const createdTaskId = state.createdRecordId
  assert.equal(state.records.find(item => item.id === createdTaskId).start, day(3)); assert.equal(state.records.find(item => item.id === createdTaskId).body, '- [ ] First step')
  state = await invoke('createCard', {title: 'Created Deck card', collectionId: deck.id, stackId: '4', start: `${day(4)}T09:00:00Z`, due: `${day(4)}T11:00:00Z`, description: '- [ ] Native checklist', assignToMe: true})
  const createdCardId = state.createdRecordId
  const createdCard = state.records.find(item => item.id === createdCardId)
  assert.equal(createdCard.stackId, '4'); assert.equal(createdCard.body, '- [ ] Native checklist'); assert.deepEqual(createdCard.assigneeIds, ['fixture-user'])
  assert.equal(createdCard.start, `${day(4)}T09:00:00.000Z`); assert.equal(createdCard.due, `${day(4)}T11:00:00.000Z`)
  state = await invoke('createNote', {title: 'Created note in existing category', content: 'Content', collectionId: state.records.find(item => item.id === noteId).collectionId, category: 'Wrong display-label fallback'})
  const createdNoteId = state.createdRecordId
  assert.equal(state.records.find(item => item.id === createdNoteId).collectionId, state.records.find(item => item.id === noteId).collectionId, 'Host resolves native Notes category by collection ID')
  const creationScans=requests.slice(beforeCreations).filter(item=>!isMetadataRequest(item)&&['PROPFIND','REPORT'].includes(item.method))
  assert.deepEqual(creationScans.map(item=>({method:item.method,path:item.path})), [{method:'PROPFIND',path:`${davHome}tasks/`}], 'Creation verifies the destination task list once without triggering source enumeration or projection')
  assert.ok([createdTaskId, createdCardId, createdNoteId, createdEventId].every(id => /^[0-9a-f-]{36}$/i.test(id)), 'Creation returns durable planner UUIDs')
  const createdMembership = structuredClone(state.workspace)
  createdMembership.projects.find(item => item.id === projectId).recordIds.push(createdTaskId, createdCardId, createdNoteId, createdEventId)
  await invoke('saveWorkspace', createdMembership, state.revision)
  state = await invoke('refresh')
  for (const id of [createdTaskId, createdCardId, createdNoteId, createdEventId]) assert.ok(state.records.some(item => item.id === id) && state.workspace.projects[0].recordIds.includes(id), 'Created item membership survives native refresh')
  const booking = {recordId: cardId, title: 'Linked fixture work session', collectionId: calendar.id, start: `${day(4)}T09:00:00Z`, end: `${day(4)}T10:00:00Z`, requestId: randomUUID(), expectedRevision: state.revision}
  const writesBeforeBooking = nativePutCount()
  await expectRejected('createLinkedEvent', [{...booking, expectedRevision: state.revision + 1}], /planner changed/i)
  await expectRejected('createLinkedEvent', [{...booking, recordId: noteId}], /task or Deck card/i)
  await expectRejected('createLinkedEvent', [{...booking, recordId: 'another-account-card'}], /task or Deck card/i)
  assert.equal(nativePutCount(), writesBeforeBooking)
  calendarReadFailures = 1
  await expectRejected('createLinkedEvent', [booking], /saved; retry this same booking safely/i)
  state = await invoke('getState')
  assert.equal(state.pendingSchedules.length, 1)
  assert.equal(state.pendingSchedules[0].requestId, booking.requestId)
  assert.equal(state.pendingSchedules[0].created, true)
  assert.ok(resources.has(`${davHome}home/nextspace-${booking.requestId}.ics`))
  await expectRejected('createLinkedEvent', [{...booking, title: 'Changed unsafe retry'}], /original saved details/i)
  state = await invoke('createLinkedEvent', booking)
  const bookedEvent = state.records.find(item => item.title === booking.title)
  assert.ok(bookedEvent); assert.equal(bookedEvent.busy, true)
  assert.ok(state.workspace.relations.some(link => link.type === 'scheduled_during' && link.fromId === cardId && link.toId === bookedEvent.id))
  assert.deepEqual(state.pendingSchedules, [])
  const writesAfterBooking = nativePutCount()
  assert.equal(writesAfterBooking, writesBeforeBooking + 1)
  state = await invoke('createLinkedEvent', booking)
  assert.equal(nativePutCount(), writesAfterBooking)
  state = await invoke('createLinkedEvent', {...booking, requestId: randomUUID(), title: 'Second linked session', start: `${day(4)}T13:00:00Z`, end: `${day(4)}T14:00:00Z`, expectedRevision: state.revision})
  assert.equal(state.workspace.relations.filter(link => link.type === 'scheduled_during' && link.fromId === cardId).length, 2)
  state = await invoke('setCardCompleted', {id: cardId, completed: true}); assert.equal(state.records.find(item => item.id === cardId).completed, true)
  assert.equal(cards.get(7).description, 'Native Deck text')
  state = await invoke('moveCard', {id: cardId, stackId: '4'}); assert.equal(state.records.find(item => item.id === cardId).stackId, '4')
  assert.equal(state.records.find(item => item.id === cardId).etag, cards.get(7).ETag)
  state = await invoke('updateDescription', {id: cardId, description: 'Native Deck text after move'})
  assert.equal(state.records.find(item => item.id === cardId).body, 'Native Deck text after move')
  state = await invoke('moveCard', {id: cardId, stackId: '3'})
  assert.equal(state.records.find(item => item.id === cardId).stackId, '3')
  state = await invoke('moveCard', {id: cardId, stackId: '4'})
  assert.equal(state.records.find(item => item.id === cardId).stackId, '4')
  const requestsBeforeDependency = nativeRequestCount()
  state = await invoke('setDeckDependency', {fromId: cardId, toId: partnerId})
  assert.deepEqual(state.records.find(item => item.id === cardId).nativeDependencies, [partnerId])
  assert.deepEqual(cards.get(7).dependentCards, [8], 'Native Deck lists the prerequisite on the card that waits for it')
  assert.deepEqual(state.records.find(item => item.id === partnerId).nativeDependencies, [])
  assert.equal(nativeRequestCount() - requestsBeforeDependency, 3, 'A dependency edit reads its owner and current board permission, then writes the dedicated endpoint without refreshing sources')
  state = await invoke('setDeckDependency', {fromId: cardId, toId: partnerId})
  assert.equal(nativeRequestCount() - requestsBeforeDependency, 5, 'Retry verifies owner and current board permission without another write')
  state = await invoke('refresh')
  assert.deepEqual(state.records.find(item => item.id === cardId).nativeDependencies, [partnerId], 'Native dependency survives a complete server refresh')
  state = await invoke('setDeckDependency', {fromId: cardId, toId: partnerId, remove: true})
  assert.deepEqual(state.records.find(item => item.id === cardId).nativeDependencies, [])
  assert.deepEqual(cards.get(7).dependentCards, [])
  state = await invoke('setDeckDependency', {fromId: cardId, toId: partnerId})

  for (const [status,expectedProgress] of [['IN-PROCESS', 99], ['CANCELLED', 99], ['COMPLETED', 100]]) {
    const before = state.records.find(item => item.id === taskId)
    state = await invoke('updateTaskStatus', {id: taskId, status, etag: before.etag})
    const after = state.records.find(item => item.id === taskId)
    assert.equal(after.status, status); assert.equal(after.completed, status === 'COMPLETED')
    const todo = new ICAL.Component(ICAL.parse(resources.get(taskPath).raw)).getFirstSubcomponent('vtodo')
    assert.equal(todo.getFirstPropertyValue('status'), status)
    assert.equal(Boolean(todo.getFirstPropertyValue('completed')), status === 'COMPLETED')
    assert.equal(todo.getFirstPropertyValue('percent-complete'), expectedProgress)
    assert.equal(after.due, before.due); assert.match(resources.get(taskPath).raw, /X-KEEP:preserved/)
    await expectRejected('updateTaskStatus', [{id: taskId, status: 'NEEDS-ACTION', etag: before.etag}], /changed|refresh/i)
  }
  await expectRejected('updateTaskStatus', [{id: taskId, status: 'INVENTED'}], /status/i)
  await expectRejected('updateTaskStatus', [{id: cardId, status: 'COMPLETED'}], /task|source|available/i)

  for (const [id, href, color, tags] of [
    [taskId, taskPath, '#d84a67', ['Personal', 'Review, later']],
    [eventId, eventPath, '#2c9d70', ['Közös', 'Client review']],
  ]) {
    const before = state.records.find(item => item.id === id)
    const collectionBefore = structuredClone(state.collections.find(item => item.id === before.collectionId))
    state = await invoke('updateRecordAppearance', {id, color, tags, etag: before.etag})
    const after = state.records.find(item => item.id === id)
    assert.equal(after.color, color); assert.deepEqual(after.tags, tags)
    const native = new ICAL.Component(ICAL.parse(resources.get(href).raw)).getFirstSubcomponent(before.kind === 'task' ? 'vtodo' : 'vevent')
    assert.equal(native.getFirstPropertyValue('color'), color)
    assert.deepEqual(native.getFirstProperty('categories').getValues(), tags)
    assert.deepEqual(state.collections.find(item => item.id === before.collectionId), collectionBefore, 'Item color does not replace the original calendar/task-list color')
    for (const key of ['title', 'body', 'start', 'end', 'due', 'allDay', 'status', 'completed']) assert.deepEqual(after[key], before[key], `Appearance preserves ${key}`)
    assert.match(resources.get(href).raw, /X-KEEP:preserved/)
    await expectRejected('updateRecordAppearance', [{id, color:'#123456', etag:before.etag}], /changed|refresh/i)
  }
  const beforeLabelCreation=structuredClone(state),labelRequestStart=requests.length
  const createdLabel=await invoke('createDeckLabel',{collectionId:deck.id,title:'Created native Deck tag',color:'#55aa99'})
  state=createdLabel.state
  assert.deepEqual(createdLabel.label,{id:'13',title:'Created native Deck tag',color:'#55aa99'})
  assert.deepEqual(deckLabels.find(item=>item.id===13),{id:13,boardId:2,title:'Created native Deck tag',color:'55aa99'},'IPC tag creation reaches the native Deck board label endpoint')
  assert.deepEqual(state.records,beforeLabelCreation.records,'Creating a board label does not assign it or alter any record')
  assert.deepEqual(state.workspace,beforeLabelCreation.workspace,'A native board label needs no custom planner property')
  assert.equal(state.revision,beforeLabelCreation.revision)
  assert.ok(state.collections.find(item=>item.id===deck.id).labels.some(tag=>tag.id==='13'))
  assert.deepEqual(requests.slice(labelRequestStart).filter(item=>!isMetadataRequest(item)),[{method:'GET',path:'/index.php/apps/deck/api/v1.0/boards/2'},{method:'POST',path:'/index.php/apps/deck/api/v1.0/boards/2/labels'}],'Native label creation touches only its board and label endpoint')
  const reuseRequestStart=requests.length
  const reusedLabel=await invoke('createDeckLabel',{collectionId:deck.id,title:'created native deck tag',color:'#ff0000'})
  state=reusedLabel.state
  assert.deepEqual(reusedLabel.label,createdLabel.label,'Existing board label names reuse their native identity and color')
  assert.equal(state.collections.find(item=>item.id===deck.id).labels.filter(tag=>tag.id==='13').length,1)
  assert.deepEqual(requests.slice(reuseRequestStart).filter(item=>!isMetadataRequest(item)),[{method:'GET',path:'/index.php/apps/deck/api/v1.0/boards/2'}],'Reusing a board label performs no native mutation')
  state=await invoke('updateRecordAppearance',{id:cardId,tagIds:[createdLabel.label.id],etag:state.records.find(item=>item.id===cardId).etag})
  assert.deepEqual(cards.get(7).labels.map(item=>item.id),[13],'The newly created label is assigned through Deck, not only in the cache')
  assert.deepEqual(state.records.find(item=>item.id===cardId).tagDetails,[createdLabel.label])
  await expectRejected('createDeckLabel',[{collectionId:tasks.id,title:'Wrong namespace'}],/available Nextcloud source/i)
  const beforeCardAppearance = structuredClone(state.records.find(item => item.id === cardId))
  state = await invoke('updateRecordAppearance', {id:cardId, color:'#c04575', tagIds:['11'], etag:beforeCardAppearance.etag})
  let coloredCard = state.records.find(item => item.id === cardId)
  assert.equal(coloredCard.color, '#c04575'); assert.equal(cards.get(7).color, 'c04575')
  assert.deepEqual(coloredCard.tags, ['Later'])
  assert.deepEqual(coloredCard.tagDetails, [{id:'11',title:'Later',color:'#f2cf58'}])
  assert.deepEqual(cards.get(7).labels.map(item => item.id), [11])
  for (const key of ['title', 'body', 'start', 'due', 'status', 'stackId', 'completed', 'nativeDependencies']) assert.deepEqual(coloredCard[key], beforeCardAppearance[key], `Deck appearance preserves ${key}`)
  assert.equal(state.collections.find(item => item.id === deck.id).color, '#7b2cbf', 'The Deck board keeps its original color')
  state = await invoke('updateRecordAppearance', {id:cardId, tagIds:['12'], etag:coloredCard.etag})
  coloredCard = state.records.find(item => item.id === cardId)
  assert.equal(coloredCard.color, '#c04575', 'Tag-only updates retain the card color')
  assert.deepEqual(coloredCard.tagDetails, [{id:'12',title:'Review',color:'#3c83d4'}])
  assert.deepEqual(cards.get(7).labels.map(item => item.id), [12], 'Replacing native labels removes the previous assignment')
  await expectRejected('updateRecordAppearance', [{id:cardId, tagIds:['999']}], /labels.*board|label.*missing/i)
  state = await invoke('updateRecordAppearance', {id:taskId, color:'', etag:state.records.find(item => item.id === taskId).etag})
  assert.equal(state.records.find(item => item.id === taskId).color, undefined)
  assert.deepEqual(state.records.find(item => item.id === taskId).tags, ['Personal', 'Review, later'], 'Resetting an item color preserves its native tags')
  assert.equal(new ICAL.Component(ICAL.parse(resources.get(taskPath).raw)).getFirstSubcomponent('vtodo').hasProperty('color'), false)
  state = await invoke('refresh')
  assert.equal(state.records.find(item => item.id === cardId).color, '#c04575')
  assert.deepEqual(state.records.find(item => item.id === cardId).tagDetails, [{id:'12',title:'Review',color:'#3c83d4'}])
  assert.equal(state.records.find(item => item.id === eventId).color, '#2c9d70')
  assert.deepEqual(state.records.find(item => item.id === taskId).tags, ['Personal', 'Review, later'])

  for (const id of [taskId, eventId, cardId]) {
    const before = state.records.find(item => item.id === id)
    const description = `# Edited ${before.kind}\n\n- [x] Keep native status\n- **Next:** review, then publish.\n\nKözös 🌿`
    const retained = ['title', 'start', 'end', 'due', 'allDay', 'completed', 'stackId', 'nativeDependencies', 'color', 'tags', 'tagDetails']
    state = await invoke('updateDescription', {id, description, etag: before.etag})
    const after = state.records.find(item => item.id === id)
    assert.equal(after.body, description)
    for (const key of retained) assert.deepEqual(after[key], before[key], `${before.kind} description must preserve ${key}`)
    const writes = nativePutCount()
    await expectRejected('updateDescription', [{id, description: 'Stale draft', etag: before.etag}], /changed|refresh/i)
    assert.equal(nativePutCount(), writes, 'A stale editor draft cannot reach the native writer')
  }
  assert.match(resources.get(taskPath).raw, /X-KEEP:preserved/)
  assert.match(resources.get(eventPath).raw, /X-KEEP:preserved/)
  await expectRejected('updateDescription', [{id: noteId, description: 'Wrong endpoint'}], /task, card, or event/i)
  await expectRejected('updateDescription', [{id: pageId, description: 'Read-only collective'}], /task, card, or event/i)

  for (const [id, change] of [
    [taskId, {due: day(4)}],
    [taskId, {start: day(2), due: day(5)}],
    [taskId, {due: day(6)}],
    [eventId, {start: day(4), end: day(5), allDay: true}],
    [eventId, {end: day(6)}],
    [cardId, {start: `${day(2)}T09:00:00Z`, due: `${day(3)}T12:00:00Z`}],
    [cardId, {start: `${day(2)}T10:00:00Z`}],
  ]) {
    const before = state.records.find(item => item.id === id)
    state = await invoke('updateRecordDates', {id, ...change, etag: before.etag})
    const after = state.records.find(item => item.id === id)
    for (const key of ['start', 'due', 'end']) {
      if (change[key] !== undefined) assert.equal(Date.parse(after[key]), Date.parse(change[key]), `${before.kind} native ${key} changed`)
      else assert.equal(after[key], before[key], `${before.kind} omitted ${key} stayed untouched`)
    }
    for (const key of ['title', 'body', 'completed', 'status', 'stackId', 'nativeDependencies', 'collectionId', 'color', 'tags', 'tagDetails']) assert.deepEqual(after[key], before[key], `Date changes preserve ${key}`)
    const writes = nativePutCount()
    await expectRejected('updateRecordDates', [{id, ...change, etag: before.etag}], /changed|refresh/i)
    assert.equal(nativePutCount(), writes)
  }
  assert.match(resources.get(taskPath).raw, /X-KEEP:preserved/);assert.match(resources.get(eventPath).raw, /X-KEEP:preserved/)
  const writesBeforeBadDates = nativePutCount()
  await expectRejected('updateRecordDates', [{id: taskId, start: day(3), due: day(3)}], /finish after/i)
  await expectRejected('updateRecordDates', [{id: eventId, end: day(4)}], /finish after/i)
  await expectRejected('updateRecordDates', [{id: noteId, due: day(3)}], /task, card, or event/i)
  assert.equal(nativePutCount(), writesBeforeBadDates)

  resources.get(taskPath).version++
  const rawBeforeConflict = resources.get(taskPath).raw
  await expectRejected('setTaskDue', [{id: taskId, due: day(8)}], /changed|refresh/i); assert.equal(resources.get(taskPath).raw, rawBeforeConflict)
  state = await invoke('refresh'); cards.get(7).description = 'Concurrent source edit'; bumpCard(cards.get(7))
  const writesBeforeConflict = nativePutCount()
  await expectRejected('setCardCompleted', [{id: cardId, completed: false}], /changed|refresh/i)
  assert.equal(nativePutCount(), writesBeforeConflict)
  state = await invoke('refresh'); state = await invoke('syncWorkspace')
  assert.equal(state.storage.syncStatus, 'synced', state.storage.message)
  assert.match(state.storage.remotePath, /^\/Workspace\/Nextspace\/?$/)
  const folder = cloudFolderWorkspace()
  assert.equal(folder.workspace.schemaVersion, 2); assert.equal(folder.workspace.spaces[0].id, spaceId)
  assert.deepEqual(folder.workspace.relations, state.workspace.relations)
  assert.equal(folder.workspace.properties[noteId]['Recovery marker'], 'Saved before restart')
  assert.equal(folder.workspace.records, undefined); assert.equal(folder.workspace.cache, undefined)
  assert.equal(folder.workspace.theme, undefined, 'Personal theming stays in the account cache, outside shared planner metadata')
  assert.ok([...folder.documents.values()].some(document => document.kind === 'relation'))
  assert.ok([...folder.documents.values()].some(document => document.kind === 'property' && document.key === noteId))
  assert.ok(![...plannerFiles.values()].some(file => file.raw.includes('fixture-password')))
  assert.equal(JSON.stringify(cloudPlanner), originalLegacyPlanner, 'Migration preserves the original single-file cloud planner')
  assert.equal(cloudVersion, 1, 'New clients never overwrite the legacy planner file')
  assert.ok(!requests.some(item => item.method === 'PUT' && item.path === `${metadataRoot}/planner.json`))
  assert.ok(!requests.some(item => item.path.endsWith('/Workspace/workspace.json')))

  const fileVersions = new Map([...plannerFiles].map(([name,file]) => [name,file.version]))
  const isolatedLink = {id:randomUUID(),type:'reference',fromId:cardId,toId:noteId}
  const linkDraft = structuredClone(state.workspace);linkDraft.relations.push(isolatedLink)
  await invoke('saveWorkspace', linkDraft, state.revision);state = await invoke('syncWorkspace')
  assert.equal(state.storage.syncStatus, 'synced', state.storage.message)
  const changedFiles = [...plannerFiles].filter(([name,file]) => fileVersions.get(name) !== file.version)
  assert.equal(changedFiles.length, 1, 'Adding one custom link writes one small document, not unrelated custom data or the manifest')
  const [linkFile,linkValue] = changedFiles[0]
  assert.equal(JSON.parse(linkValue.raw).kind, 'relation')
  assert.deepEqual(JSON.parse(linkValue.raw).value, isolatedLink)
  assert.ok(cloudFolderWorkspace().workspace.relations.some(link => link.id === isolatedLink.id))
  const unlinkDraft = structuredClone(state.workspace);unlinkDraft.relations = unlinkDraft.relations.filter(link => link.id !== isolatedLink.id)
  await invoke('saveWorkspace', unlinkDraft, state.revision);state = await invoke('syncWorkspace')
  assert.equal(state.storage.syncStatus, 'synced', state.storage.message)
  assert.equal(JSON.parse(plannerFiles.get(linkFile).raw).deleted, true, 'Unlink leaves a tombstone for offline clients')
  assert.ok(!cloudFolderWorkspace().workspace.relations.some(link => link.id === isolatedLink.id))
  pageDenied = true; await expectRejected('readPage', [{id: pageId}], /permission|access/i)
  pageDenied = false; state = await invoke('refresh'); assert.equal(state.records.find(item => item.kind === 'page').id, pageId)

  const restartBooking = {...booking, requestId: randomUUID(), recordId: taskId, title: 'Resume booking after restart', expectedRevision: state.revision}
  calendarReadFailures = 1
  await expectRejected('createLinkedEvent', [restartBooking], /saved; retry this same booking safely/i)
  const writesBeforeRestart = requests.filter(item => item.method === 'PUT' && item.path.startsWith(davHome) && item.path.endsWith('.ics')).length

  await app.close(); app = undefined; await launch(); state = await invoke('getState'); assertAccount(state, true)
  assert.ok(!state.workspace.relations.some(link => link.id === isolatedLink.id), 'Deleted custom links stay deleted after restart')
  assertTheme(state); await assertRenderedTheme(); await pauseRendererBackground()
  assert.equal(state.workspace.projects[0].id, projectId); assert.equal(state.workspace.properties[noteId]['Recovery marker'], 'Saved before restart')
  assert.ok(state.records.some(item => item.id === cardId))
  assert.equal(state.pendingSchedules[0].requestId, restartBooking.requestId)
  state = await invoke('refresh')
  state = await invoke('createLinkedEvent', restartBooking)
  assert.deepEqual(state.pendingSchedules, [])
  assert.equal(requests.filter(item => item.method === 'PUT' && item.path.startsWith(davHome) && item.path.endsWith('.ics')).length, writesBeforeRestart, 'Restart recovery reuses the saved booking; planner sync may independently write its metadata file')
  const resumedEvent = state.records.find(item => item.title === restartBooking.title)
  assert.ok(state.workspace.relations.some(link => link.type === 'scheduled_during' && link.fromId === taskId && link.toId === resumedEvent.id))
  await app.close(); app = undefined
  const pointer = JSON.parse(await readFile(path.join(dataDir, 'active-account.json'), 'utf8')); assert.match(pointer.scope, /^account-[a-f0-9]{64}$/)
  encryptedPath = path.resolve(dataDir, 'credentials', `${pointer.scope}.encrypted.json`); assert.ok(encryptedPath.startsWith(`${dataDir}${path.sep}`))
  originalEncrypted = await readFile(encryptedPath); assert.ok(!originalEncrypted.toString('utf8').includes('fixture-password'))
  const corrupted = JSON.parse(originalEncrypted.toString('utf8')); corrupted.encrypted = Buffer.from('invalid isolated fixture ciphertext').toString('base64')
  await writeFile(encryptedPath, JSON.stringify(corrupted))
  const requestsBeforeOffline = requests.length
  await launch(); const offline = await invoke('getState'); assertAccount(offline, false)
  assertTheme(offline); await assertRenderedTheme(); await pauseRendererBackground()
  assert.equal(offline.connection.reconnectRequired, true); assert.notEqual(offline.connection.recoveryOnly, true)
  assert.ok(offline.records.some(item => item.id === noteId))
  for (const [method, input] of [
    ['refresh'], ['syncWorkspace'], ['createNote', {title: 'Blocked', content: ''}],
    ['setTaskCompleted', {id: taskId, completed: false}], ['setTaskDue', {id: taskId, due: day(5)}],
    ['updateTaskStatus', {id: taskId, status:'IN-PROCESS'}], ['updateRecordAppearance', {id:cardId, color:'#123456'}],
    ['createDeckLabel', {collectionId:deck.id,title:'Offline label'}],
    ['updateDescription', {id: taskId, description: 'Offline draft'}],
    ['updateRecordDates', {id: taskId, due: day(5)}],
    ['updateEvent', {id: eventId, start: day(5), end: day(6), allDay: true}],
    ['createLinkedEvent', {...booking, requestId: randomUUID(), expectedRevision: offline.revision}],
    ['setCardCompleted', {id: cardId, completed: false}], ['readPage', {id: pageId}],
  ]) await expectRejected(method, input ? [input] : [], /reconnect|connect (?:your )?nextcloud/i)
  assert.equal(requests.length, requestsBeforeOffline, 'Failed credential recovery cannot send requests')
  const draft = structuredClone(offline.workspace); draft.properties[noteId]['Recovery marker'] = 'Edited while offline'
  await invoke('saveWorkspace', draft, offline.revision); await writeFile(encryptedPath, originalEncrypted)
  state = await invoke('retryConnection'); assertAccount(state, true)
  state = await invoke('refresh'); assertAccount(state, true)
  assert.equal(state.workspace.properties[noteId]['Recovery marker'], 'Edited while offline')
  assert.deepEqual(await readFile(encryptedPath), originalEncrypted)
  await app.close(); app = undefined; await launch(); state = await invoke('getState'); assertAccount(state, true)
  assert.equal(state.workspace.properties[noteId]['Recovery marker'], 'Edited while offline')
  assert.ok(state.workspace.relations.some(link => link.fromId === cardId && link.toId === taskId))
  assert.deepEqual(serverFailures, []); assert.deepEqual(rendererErrors, [])
  for (const route of ['/index.php/apps/theming/theme/default.css','/index.php/apps/theming/theme/dark.css','/index.php/apps/theming/background']) assert.ok(requests.some(item => item.method === 'GET' && item.path === route), `${route} was requested through the authenticated connector`)
  assert.ok(!requests.some(item => item.path.includes('/apps/theming/') && item.method !== 'GET'), 'Theming remains read-only')
  passed = true
  console.log('PASS isolated Windows desktop → bridge → HTTP: authenticated theme CSS/wallpaper rendered and cached offline, Spaces/links, durable IDs, native task/note/event/Deck edits, mapped task statuses, native item colors and colored Deck/task tags, Markdown descriptions and date moves/resizes, linked calendar sessions with safe retries and restart recovery, conditional conflicts, folder migration with legacy preservation, weak GET/strong WebDAV validators, one-file custom-link edits and deletion tombstones, encrypted credential recovery; no sample fallback')
} finally {
  if (app) await app.close()
  if (encryptedPath && originalEncrypted) await writeFile(encryptedPath, originalEncrypted)
  await new Promise(resolve => server.close(resolve))
  if (passed) await rm(dataDir, {recursive: true, force: true})
  else console.log(`Fixture diagnostics retained only in ${dataDir}`)
}
