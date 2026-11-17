import {validResourceLocator,httpEtag} from './resource-cache-policy.mjs'
import {checkedDavToken} from './dav-checkpoint-policy.mjs'

const failure=(message,code='FORMAT')=>Object.assign(new Error(message),{code})
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]))
const strong=value=>httpEtag(value)&&!value.startsWith('W/')

export function davMemberHref(serverUrl,collection,value){
  if(typeof value!=='string'||/[\\\u0000-\u001f\u007f]/.test(value)||/%(?:2e|2f|5c|00)/i.test(value))throw failure('Unsafe calendar delta member.','SECURITY')
  let href
  try{href=new URL(value,serverUrl+'/').href}catch{throw failure('Invalid calendar delta member.','SECURITY')}
  if(!validResourceLocator({kind:'dav',collection,href},serverUrl))throw failure('Calendar delta member is outside its collection.','SECURITY')
  return href
}

/** A complete RFC 6578 result changes membership atomically. A failed or
 * truncated result never certifies deletion or advances the saved token. */
export function mergeDavDelta({serverUrl,collection,baseline,rows,token}){
  const nextToken=checkedDavToken({kind:'sync-token',value:token})
  if(!nextToken||!Array.isArray(baseline)||baseline.length>10000||!Array.isArray(rows)||rows.length>20000)throw failure('Invalid calendar delta.')
  const resources=new Map(),seen=new Set(),changed=[],deleted=[]
  for(const item of baseline){
    const href=davMemberHref(serverUrl,collection,item?.href)
    if(resources.has(href)||!strong(item.etag))throw failure('Invalid calendar delta baseline.')
    resources.set(href,{href,etag:item.etag})
  }
  for(const item of rows){
    const href=davMemberHref(serverUrl,collection,item?.href)
    if(seen.has(href))throw failure('Calendar delta contains duplicate members.')
    seen.add(href)
    if(item.status===404){resources.delete(href);deleted.push(href);continue}
    if(item.status!==200||!strong(item.etag))throw failure('Calendar delta contains an incomplete member.')
    if(resources.get(href)?.etag!==item.etag)changed.push(href)
    resources.set(href,{href,etag:item.etag})
  }
  if(resources.size>10000)throw failure('Calendar delta exceeds its resource limit.','LIMIT')
  return {resources:[...resources.values()].sort((left,right)=>left.href.localeCompare(right.href)),changed:changed.sort(),deleted:deleted.sort(),token:nextToken}
}

export function davSyncCollectionBody(token){
  const checked=checkedDavToken({kind:'sync-token',value:token})
  if(!checked)throw failure('A valid calendar sync token is required.')
  return `<?xml version="1.0"?><d:sync-collection xmlns:d="DAV:"><d:sync-token>${escape(checked.value)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`
}

export function davMultigetBody(serverUrl,collection,hrefs){
  if(!Array.isArray(hrefs)||!hrefs.length||hrefs.length>4||new Set(hrefs).size!==hrefs.length)throw failure('Calendar multiget must contain one to four distinct members.')
  const paths=hrefs.map(href=>new URL(davMemberHref(serverUrl,collection,href)).pathname)
  return `<?xml version="1.0"?><c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>${paths.map(path=>`<d:href>${escape(path)}</d:href>`).join('')}</c:calendar-multiget>`
}
