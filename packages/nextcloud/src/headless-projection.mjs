import {NextcloudClient} from './nextcloud.mjs'
import {portableRuntime,byteLength} from './runtime.mjs'
import {checkedResourceEntry} from './resource-cache-policy.mjs'
import {davProjectionWindow} from './dav-checkpoint-policy.mjs'
import {mergeSourceRefresh} from '@nextspace/core/source-refresh.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'
import {projectNativeIdentities} from '@nextspace/core/identity.mjs'

const failure=(message,code='FORMAT')=>Object.assign(new Error(message),{code})
const copy=value=>structuredClone(value)
const headers=value=>{const entries=new Map(Object.entries(value||{}).map(([key,item])=>[key.toLowerCase(),String(item)]));return {get:key=>entries.get(key.toLowerCase())??null}}

/** Project a complete account-fenced native read with the actual portable parsers.
 * The host validates its archive/mutation watermark and owns all persistence.
 * Missing replies are failures, never permission to perform network I/O here.
 */
export async function projectHeadlessSources({account,previous,workspace,sources,snapshot,now,calendarHistoryDays,makeId=portableRuntime.randomUUID,reconcile=true,isActive=()=>true}) {
  if(!account||typeof account.serverUrl!=='string'||typeof account.username!=='string'||typeof account.accountKey!=='string'||!account.accountKey||!Number.isFinite(now)||!Array.isArray(sources)||!sources.length||sources.some(source=>!['tasks','calendar','deck'].includes(source))||!previous||previous.accountKey!==undefined&&previous.accountKey!==account.accountKey||!['records','collections','statuses'].every(key=>Array.isArray(previous[key])))throw failure('Invalid background projection input.')
  const check=()=>{if(isActive()!==true)throw failure('Background projection was cancelled.','CANCELLED')}
  const base=new URL(account.serverUrl),prefix=base.pathname.replace(/\/$/,'')+'/'
  const checkedUrl=value=>{
    if(typeof value!=='string'||/[\\\u0000-\u001f]/.test(value)||/%(?:2e|2f|5c|00)/i.test(value))throw failure('Unsafe background resource URL.','SECURITY')
    const url=new URL(value)
    if(url.origin!==base.origin||!url.pathname.startsWith(prefix)||url.username||url.password||url.hash)throw failure('Background resource is outside this account installation.','SECURITY')
    return url.href
  }
  const replies=new Map(),resources=new Map();let bytes=0
  if(!Array.isArray(snapshot?.replies)||snapshot.replies.length>10000||!Array.isArray(snapshot.resources)||snapshot.resources.length>50000)throw failure('Invalid background resource snapshot.')
  for(const reply of snapshot.replies){
    check();const url=checkedUrl(reply?.url),method=reply.method?.toUpperCase()
    if(!['GET','PROPFIND'].includes(method)||!Number.isInteger(reply.status)||reply.status<200||reply.status>599||typeof reply.body!=='string')throw failure('Invalid background read reply.')
    bytes+=byteLength(reply.body);if(bytes>256*1024*1024)throw failure('Background resources exceed their projection budget.','LIMIT')
    const key=JSON.stringify([method,url])
    if(replies.has(key))throw failure('Background replies contain duplicate requests.')
    replies.set(key,{status:reply.status,headers:headers(reply.headers),body:reply.body})
  }
  for(const value of snapshot.resources){
    check();const entry=checkedResourceEntry(value,value,account.serverUrl)
    if(!entry||resources.has(entry.href))throw failure('Invalid background resource cache entry.')
    bytes+=entry.bytes;if(bytes>256*1024*1024)throw failure('Background resources exceed their projection budget.','LIMIT')
    resources.set(entry.href,entry)
  }
  const client=new NextcloudClient({serverUrl:account.serverUrl,username:account.username,accountUser:account.username},{authentication:'delegated',fetch:async()=>{throw failure('Background projection cannot make network requests.','SECURITY')},davReadMode:'propfind-get',accountKey:account.accountKey,now:()=>new Date(now),runtime:{...portableRuntime,randomUUID:makeId}})
  client.request=async(target,options={})=>{
    check();options.checkActive?.();const url=checkedUrl(target),method=(options.method||'GET').toUpperCase()
    if(!['GET','PROPFIND'].includes(method))throw failure('Background projection cannot write source data.','SECURITY')
    let reply=replies.get(JSON.stringify([method,url]))
    if(!reply&&method==='GET'){
      const cached=resources.get(url)
      if(cached)reply={status:200,headers:headers({'ETag':cached.etag}),body:cached.body}
    }
    if(!reply)throw failure('Background projection needs a missing native read.','UNAVAILABLE')
    if(byteLength(reply.body)>(options.maxBytes||24*1024*1024))throw failure('Background reply exceeds its operation budget.','LIMIT')
    return reply
  }
  if(previous.davCheckpoint)client.primeDavState({accountKey:account.accountKey,records:previous.records,collections:previous.collections,checkpoint:previous.davCheckpoint})
  const selected=[...new Set(sources)],result={records:[],collections:[],statuses:[]},stamp=new Date(now).toISOString()
  const context={isActive,checkActive:check,selected,scan:null,projectionWindow:davProjectionWindow(now,{calendarHistoryDays})}
  let calendars
  if(selected.some(source=>source==='tasks'||source==='calendar'))try{calendars=await client.discoverCalendars(check,context)}catch(error){check();calendars=error}
  for(const source of selected){
    check()
    try{
      if(source!=='deck'&&calendars instanceof Error)throw calendars
      const value=source==='deck'?await client.readDeck(context):await client.readDav(source,calendars,context)
      check();result.records.push(...value.records);result.collections.push(...value.collections)
      result.statuses.push({source,state:value.warning?'error':'connected',count:value.records.length,...(value.warning?{message:value.warning,errorCode:value.errorCode||'FORMAT'}:{lastSyncedAt:stamp}),...(value.metadataStale?{metadataStale:true}:{}),...(value.revokedCollectionIds?.length?{revokedCollectionIds:value.revokedCollectionIds}:{})})
    }catch(error){check();result.statuses.push({source,state:'error',count:0,errorCode:error.code||'FORMAT',message:'Background source projection could not finish.'})}
  }
  const complete=result.statuses.every(status=>status.state==='connected')
  if(!complete)return {...copy(previous),complete:false,workspace:copy(workspace),recordIdAliases:{},attemptStatuses:result.statuses}
  const merged=mergeSourceRefresh(previous,result,selected),valid=copy(workspace)
  validateWorkspace(valid)
  const resolved=reconcile?projectNativeIdentities(valid,merged.records,makeId):{workspace:valid,records:merged.records,remap:new Map()}
  check()
  return {complete:true,...merged,records:resolved.records,workspace:resolved.workspace,recordIdAliases:Object.fromEntries(resolved.remap),davCheckpoint:client.davCheckpoint()}
}
