/** Framework-independent native-edit transport boundary. The source service still
 * resolves loaded records, checks permissions and performs field validation. */
const MAX_BODY = 8 * 1024 * 1024
const fail = (message, code = 'SECURITY') => Object.assign(new Error(message), {code})
const bytes = value => new TextEncoder().encode(value).length
const strong = value => typeof value === 'string' && value.length <= 1000 && /^"[\x21\x23-\x7e\x80-\xff]+"$/.test(value)
const jsonType = headers => /^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '')

function conditional(headers, create = false) {
  const match = headers['if-match'], none = headers['if-none-match']
  if (create && match === undefined && none === '*') return
  if (none === undefined && strong(match)) return
  throw fail('A native write requires its exact version or a create-only condition.', 'VALIDATION')
}

function objectBody(headers, body) {
  if (!jsonType(headers)) throw fail('A native JSON write requires an application/json content type.', 'VALIDATION')
  let value
  try { value = JSON.parse(body) } catch { throw fail('A valid native JSON object is required.', 'VALIDATION') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('A native JSON object is required.', 'VALIDATION')
  return value
}

function onlyFields(value, allowed, required = []) {
  if (!Object.keys(value).length || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw fail('This native write contains unsupported fields.', 'VALIDATION')
}

function noteFields(value, create) {
  onlyFields(value, ['title', 'content', 'category'], create ? ['title', 'content', 'category'] : [])
  for (const [name, limit] of [['title', 500], ['content', 500000], ['category', 200]]) {
    if (!Object.hasOwn(value, name)) continue
    if (typeof value[name] !== 'string' || value[name].length > limit || value[name].includes('\0') || name === 'title' && !value[name].trim() || name === 'category' && /[\u0000-\u001f]/.test(value[name])) throw fail('The note fields are invalid.', 'VALIDATION')
  }
}

function deckVersion(headers) {
  const version = headers['if-match']
  if (headers['if-none-match'] !== undefined || version !== undefined && (typeof version !== 'string' || !version || version === '*' || version.length > 1000 || /[\u0000-\u001f\u007f]/.test(version))) throw fail('Invalid Deck version condition.', 'VALIDATION')
}

function relativePath(account, target) {
  let url, base
  try {
    if (typeof target !== 'string' || /[\\\u0000-\u0020\u007f]/.test(target)) throw new Error()
    const originalPath = target.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0]
    for (const segment of originalPath.split('/')) {
      const decoded = decodeURIComponent(segment)
      if (decoded === '.' || decoded === '..' || /[\/\\\u0000-\u001f\u007f]|%[\da-f]{2}/i.test(decoded)) throw new Error()
    }
    url = new URL(target); base = new URL(account.serverUrl)
  } catch { throw fail('Invalid native write URL.') }
  const prefix = base.pathname.replace(/\/$/, '')
  if (url.origin !== base.origin || url.username || url.password || url.hash || !url.pathname.startsWith(prefix + '/')) throw fail('Native writes must stay in the selected Nextcloud installation.')
  const parts = url.pathname.slice(prefix.length + 1).split('/').map(part => {
    let value
    try { value = decodeURIComponent(part) } catch { throw fail('Invalid native write path.') }
    if (value === '.' || value === '..' || /[\/\\\u0000-\u001f\u007f]|%[\da-f]{2}/i.test(value)) throw fail('Invalid native write path.')
    return value
  })
  return parts.join('/')
}

/** Admit only request representations used by Notes/tags, dates and scheduling. */
export function checkNativeWrite(account, target, method, headers, body) {
  const path = relativePath(account, target), query = new URL(target).search
  const share=method==='POST'&&path==='ocs/v2.php/apps/files_sharing/api/v1/shares'&&query==='?format=json'
  const detach=method==='DELETE'&&/^index\.php\/apps\/deck\/api\/v1\.1\/boards\/[1-9]\d*\/stacks\/[1-9]\d*\/cards\/[1-9]\d*\/attachments\/[1-9]\d*$/.test(path)&&query==='?type=file'
  if(query&&!share&&!detach)throw fail('Unsupported native query parameters.')
  if (body != null && (typeof body !== 'string' || bytes(body) > MAX_BODY)) throw fail('The native write exceeds its body limit.', 'LIMIT')

  const deckCard = /^index\.php\/apps\/deck\/api\/v1\.0\/boards\/[1-9]\d*\/stacks\/[1-9]\d*\/cards\/[1-9]\d*\//
  if (['POST', 'DELETE'].includes(method) && new RegExp(deckCard.source + 'dependentCards/[1-9]\\d*$').test(path)) {
    deckVersion(headers)
    if (body != null && body !== '') throw fail('A Deck dependency change requires an empty body.', 'VALIDATION')
    return
  }
  if (method === 'PUT' && new RegExp(deckCard.source + '(reorder|assignLabel|removeLabel)$').test(path)) {
    deckVersion(headers)
    const value = objectBody(headers, body), reorder = path.endsWith('/reorder')
    const fields = reorder ? ['stackId', 'order'] : ['labelId']
    onlyFields(value, fields, fields)
    const id = value[reorder ? 'stackId' : 'labelId']
    if (!Number.isSafeInteger(id) || id <= 0 || reorder && (value.order !== 99999 || String(id) !== path.match(/\/stacks\/([1-9]\d*)\/cards\//)?.[1])) throw fail('Invalid Deck stack or label change.', 'VALIDATION')
    return
  }
  if (method === 'POST' && /^index\.php\/apps\/deck\/api\/v1\.0\/boards\/[1-9]\d*\/labels$/.test(path)) {
    const value = objectBody(headers, body)
    onlyFields(value, ['title', 'color'], ['title', 'color'])
    if (headers['if-match'] !== undefined || headers['if-none-match'] !== undefined || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 100 || /[\u0000-\u001f]/.test(value.title) || typeof value.color !== 'string' || !/^[0-9a-f]{6}$/i.test(value.color)) throw fail('Invalid native Deck label.', 'VALIDATION')
    return
  }

  if(share){
    const value=objectBody(headers,body);onlyFields(value,['path','shareType','shareWith','permissions'],['path','shareType','shareWith','permissions'])
    if(typeof value.path!=='string'||!value.path.startsWith('/')||value.path.length>4096||/[\\\u0000-\u001f]/.test(value.path)||value.path.split('/').some(part=>part==='.'||part==='..')||value.shareType!==12||value.permissions!==1||!(/^[1-9]\d*$/.test(String(value.shareWith)))||!Number.isSafeInteger(Number(value.shareWith)))throw fail('Only a read-only file share to a Deck card is allowed.','VALIDATION')
    return
  }
  if(detach){if(body!=null&&body!=='')throw fail('Attachment deletion requires an empty body.','VALIDATION');return}
  if(method==='DELETE'&&/^remote\.php\/dav\/calendars\/[^/]+\/[^/]+\/[^/]+$/.test(path)){conditional(headers);if(body!=null&&body!=='')throw fail('Event deletion requires an empty body.','VALIDATION');return}
  if (method === 'POST' && path === 'index.php/apps/notes/api/v1/notes') {
    if (headers['if-match'] !== undefined || headers['if-none-match'] !== undefined) throw fail('Note creation does not accept a version condition.', 'VALIDATION')
    noteFields(objectBody(headers, body), true)
    return
  }
  if (method === 'PUT' && /^index\.php\/apps\/notes\/api\/v1\/notes\/[1-9]\d*$/.test(path)) {
    conditional(headers)
    noteFields(objectBody(headers, body), false)
    return
  }
  if (method === 'POST' && path === 'remote.php/dav/systemtags/') {
    const value = objectBody(headers, body)
    onlyFields(value, ['name', 'userVisible', 'userAssignable'], ['name', 'userVisible', 'userAssignable'])
    if (typeof value.name !== 'string' || !value.name.trim() || bytes(value.name.trim()) > 64 || /[\u0000-\u001f]/.test(value.name) || value.userVisible !== true || value.userAssignable !== true) throw fail('Only visible, assignable native tags may be created.', 'VALIDATION')
    return
  }
  if (['PUT', 'DELETE'].includes(method) && /^remote\.php\/dav\/systemtags-relations\/files\/[1-9]\d*\/[1-9]\d*$/.test(path)) {
    if (body != null && body !== '') throw fail('Native tag assignment changes must have an empty body.', 'VALIDATION')
    return
  }
  if (method === 'PUT' && /^remote\.php\/dav\/calendars\/[^/]+\/[^/]+\/[^/]+$/.test(path)) {
    conditional(headers, true)
    if (!/^text\/calendar(?:\s*;|$)/i.test(headers['content-type'] || '') || typeof body !== 'string' || !/^BEGIN:VCALENDAR\r?\n/.test(body) || !/(?:^|\n)END:VCALENDAR$/.test(body.trimEnd()) || !/^BEGIN:V(?:EVENT|TODO)\r?$/m.test(body) || body.includes('\0')) throw fail('A bounded native calendar resource is required.', 'VALIDATION')
    return
  }
  if (method === 'POST' && /^index\.php\/apps\/deck\/api\/v1\.0\/boards\/[1-9]\d*\/stacks\/[1-9]\d*\/cards$/.test(path)) {
    const value=objectBody(headers,body),fields=['title','type','order','description','startdate','duedate','users']
    onlyFields(value,fields,fields)
    if(headers['if-match']!==undefined||headers['if-none-match']!==undefined)throw fail('Deck creation does not accept a version condition.','VALIDATION')
    const text=(key,limit)=>typeof value[key]==='string'&&value[key].length<=limit&&!value[key].includes('\0')
    const dates=['startdate','duedate'].every(key=>value[key]===null||typeof value[key]==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value[key]))
    const users=Array.isArray(value.users)&&value.users.length<=1&&value.users.every(user=>user&&typeof user==='object'&&!Array.isArray(user)&&Object.keys(user).length===2&&user.id===account.username&&user.type===0)
    if(!text('title',255)||!value.title.trim()||!text('description',500000)||value.type!=='plain'||value.order!==99999||!dates||!users)throw fail('The Deck card creation fields are invalid.','VALIDATION')
    return
  }
  if (method === 'PUT' && /^index\.php\/apps\/deck\/api\/v1\.0\/boards\/[1-9]\d*\/stacks\/[1-9]\d*\/cards\/[1-9]\d*$/.test(path)) {
    const value = objectBody(headers, body)
    const fields = ['title', 'type', 'owner', 'description', 'order', 'startdate', 'duedate', 'archived', 'done', 'color']
    onlyFields(value, fields, fields)
    // Deck's validator is opaque and optional; the source service verifies a
    // fresh card and its returned dates. Do not invent DAV atomic guarantees.
    deckVersion(headers)
    if (['title', 'type', 'owner', 'description'].some(key => typeof value[key] !== 'string') || !value.owner || !Number.isInteger(value.order) || typeof value.archived !== 'boolean' || ['startdate', 'duedate', 'color'].some(key => value[key] !== null && typeof value[key] !== 'string') || value.done !== null && !['string', 'number', 'boolean'].includes(typeof value.done)) throw fail('The Deck date update is not a complete current card.', 'VALIDATION')
    return
  }
  throw fail('This native operation is not available on this client yet.')
}

export function checkFileSearch(account,target,body){
  const path=relativePath(account,target)
  if(path!=='remote.php/dav/'||new URL(target).search||typeof body!=='string'||bytes(body)>1024*1024||/<!DOCTYPE|<!ENTITY/i.test(body)||!body.includes('<d:searchrequest ')||!body.includes('<oc:fileid/>')||!/<d:literal>[1-9]\d*<\/d:literal>/.test(body)||!body.includes('<d:nresults>2</d:nresults>'))throw fail('Only bounded immutable file lookup is available.','VALIDATION')
}
