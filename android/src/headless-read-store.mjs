import {applyReadDenials} from './read-denials.mjs'
import {projectHeadlessSources} from '@nextspace/nextcloud-client/headless-projection.mjs'
import {sha256} from '@nextspace/nextcloud-client/runtime.mjs'
import {createSlotCache} from './cache.mjs'
import {createMetadataStore} from './metadata.mjs'
import {createSourceEdits} from './source-edits.mjs'
import {checkedAccount, sourceCacheValidator, compactSourceCache, publicSnapshot} from './foundation.mjs'
import {launchCheckpoint} from './launch-cache.mjs'
import {cacheKey, metadataKey, launchKey, sourceEditsKey} from './account-cache-keys.mjs'
import {mergeSourceRefresh} from '@nextspace/core/source-refresh.mjs'

/** Pure background transaction: existing foreground rules, no network or filesystem authority. */
export async function prepareHeadlessReadStore(input, {project = projectHeadlessSources} = {}) {
  const account = checkedAccount(input.account)
  if (!account || !Number.isFinite(input.now) || typeof input.seed !== 'string' || !/^[a-f0-9-]{36}$/.test(input.seed) || !['dav','deck'].includes(input.kind)) throw new Error('Invalid background read transaction.')
  const key = cacheKey(account)
  const allowed = new Set([key, metadataKey(account), launchKey(account), sourceEditsKey(account)].flatMap(value => [0,1].map(slot => `cache/${value}.${slot}.json`)))
  const values = new Map(), writes = new Map(), encoder = new TextEncoder()
  for (const [path, text] of Object.entries(input.files || {})) {
    if (!allowed.has(path) || typeof text !== 'string') throw new Error('Invalid background cache input.')
    values.set(path, text)
  }
  const files = {
    size: async path => values.has(path) ? encoder.encode(values.get(path)).length : null,
    read: async path => values.get(path) ?? null,
    write: async (path, text) => {if (!allowed.has(path) || path.includes(sourceEditsKey(account))) throw new Error('Background cannot alter acknowledged edits.'); values.set(path,text); writes.set(path,text)},
    remove: async () => {throw new Error('Background projection cannot remove private stores.')},
  }
  const cache = createSlotCache(files)
  let sequence = 0
  const makeId = () => {const hex = sha256(`${input.seed}\0${++sequence}`); return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`}
  const edits = createSourceEdits({cache,key:sourceEditsKey(account),accountKey:key,serverUrl:account.serverUrl})
  const metadata = createMetadataStore({cache,key:metadataKey(account),client:{},now:()=>input.now,makeId})
  const [archive, planner] = await Promise.all([cache.load(key,sourceCacheValidator(key,account.serverUrl)),metadata.load(),edits.load()])
  // Missing durable source data is first-sync work for the interactive client.
  if (!archive) return {complete:false,code:'CACHE_MISSING',writes:[]}
  const previous = applyReadDenials(edits.apply(archive),input.readDenials,account.serverUrl)
  if (input.denial) {
    const {code,collection} = input.denial
    if (!['AUTH','PERMISSION'].includes(code) || collection !== null && typeof collection !== 'string') throw new Error('Invalid background denial.')
    const selected=code==='AUTH'?['tasks','calendar','deck','notes','collectives']:input.kind==='dav'?['tasks','calendar']:['deck']
    const matches = previous.collections.filter(item => item.remote?.href===collection || item.source==='deck' && `${account.serverUrl}/index.php/apps/deck/api/v1.0/boards/${item.remote?.nativeId}`===collection).map(item=>item.id)
    const statuses=selected.map(source=>({source,state:'error',count:0,errorCode:code,message:'Nextcloud denied access during the background check.',...(collection===null||code==='AUTH'?{permissionDenied:true}:{revokedCollectionIds:matches})}))
    const saved={...previous,...mergeSourceRefresh(previous,{records:[],collections:[],statuses},selected)}
    if(saved.davCheckpoint && (code==='AUTH'||input.kind==='dav'))delete saved.davCheckpoint
    const compact=compactSourceCache(saved),launch=launchCheckpoint(publicSnapshot({...planner,...saved,nativeWriteSources:[],deviceState:planner.deviceState}),key)
    // Both read generations lose revoked content; drafts, planner and native-edit overlay stay untouched.
    await cache.save(key,compact);await cache.save(key,compact)
    await cache.save(launchKey(account),launch);await cache.save(launchKey(account),launch)
    return {complete:true,denied:true,accountKey:key,acknowledgedSequence:saved.acknowledgedSequence||0,count:saved.records.length,writes:[...writes].map(([path,text])=>({path,text}))}
  }
  const result = await project({account:{...account,accountKey:key},previous,workspace:planner.workspace,sources:input.kind==='dav'?['tasks','calendar']:['deck'],snapshot:input.snapshot,now:input.now,makeId,reconcile:false})
  if (!result.complete) return {complete:false,code:'PROJECTION_INCOMPLETE',writes:[]}
  const reconciled = await metadata.reconcileRecords(result.records)
  const saved = {...previous,records:reconciled.records,collections:result.collections,statuses:result.statuses,acknowledgedSequence:previous.acknowledgedSequence || 0}
  if (result.davCheckpoint) saved.davCheckpoint = result.davCheckpoint
  else if (input.kind==='dav') delete saved.davCheckpoint
  await cache.save(key,compactSourceCache(saved))
  await cache.save(launchKey(account),launchCheckpoint(publicSnapshot({...reconciled,...saved,nativeWriteSources:[],deviceState:reconciled.deviceState}),key))
  return {complete:true,accountKey:key,acknowledgedSequence:saved.acknowledgedSequence,count:saved.records.length,writes:[...writes].map(([path,text])=>({path,text}))}
}
