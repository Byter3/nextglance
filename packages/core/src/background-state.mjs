import {alignWorkspaceIdentities,mergeWorkspaces} from './workspace-merge.mjs'
const copy=value=>structuredClone(value)
// Compare large note bodies as strings, without allocating JSON copies for
// every record comparison in a refresh.
const equal=(a,b)=>{
  if(a===b)return true
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false
  const keys=Object.keys(a)
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]))
}
const account=state=>JSON.stringify([state.connection.serverUrl,state.connection.username])

function share(previous,next){
  if(previous===next)return previous
  if(!previous||!next||typeof previous!=='object'||typeof next!=='object'||Array.isArray(previous)!==Array.isArray(next))return next
  const keys=Object.keys(next),result=Array.isArray(next)?[]:{}
  let unchanged=keys.length===Object.keys(previous).length
  for(const key of keys){result[key]=share(previous[key],next[key]);if(!Object.hasOwn(previous,key)||result[key]!==previous[key])unchanged=false}
  return unchanged?previous:result
}
/** Keep unchanged UI objects stable so a sync timestamp does not repaint every view.
 * The returned tree shares unchanged branches; callers must treat snapshots as readonly. */
export function reuseUnchangedState(previous,next){
  const result={...next}
  for(const field of ['records','collections']){
    const byId=new Map(previous[field].map(item=>[item.id,item]))
    const items=next[field].map(item=>share(byId.get(item.id),item))
    result[field]=items.length===previous[field].length&&items.every((item,index)=>item===previous[field][index])?previous[field]:items
  }
  for(const key of Object.keys(next))if(key!=='records'&&key!=='collections')result[key]=share(previous[key],next[key])
  return Object.keys(previous).length===Object.keys(result).length&&Object.keys(result).every(key=>Object.hasOwn(previous,key)&&result[key]===previous[key])?previous:result
}

function canonicalRecordIds(before,current,incoming) {
  const aliases=new Map(),key=identity=>JSON.stringify([identity.source,identity.key])
  for(const state of [before,current,incoming])for(const [id,target] of Object.entries(state.recordIdAliases||{}))if(typeof target==='string'&&target&&id!==target)aliases.set(id,target)
  const canonical=new Map(incoming.workspace.identities.map(identity=>[key(identity),identity.id]))
  const canonicalIds=new Set(canonical.values())
  // The registry also covers older bridge replies without an explicit alias map.
  for(const state of [before,current])for(const identity of state.workspace.identities){const target=canonical.get(key(identity));if(target&&target!==identity.id)aliases.set(identity.id,target)}
  const resolve=id=>{
    let target=id;const seen=new Set()
    while(aliases.has(target)&&!canonicalIds.has(target)){if(seen.has(target))return id;seen.add(target);target=aliases.get(target)}
    return target
  }
  const record=value=>{
    const result={...value,id:resolve(value.id)}
    for(const field of ['nativeDependencies','nativeDependents','nativeRelatedIds'])if(Array.isArray(value[field]))result[field]=[...new Set(value[field].map(resolve))]
    return result
  }
  return {resolve,record,aliases:Object.fromEntries([...aliases.keys()].map(id=>[id,resolve(id)]).filter(([id,target])=>id!==target))}
}

function recordMap(records,normalize,rank=(original,record)=>original.id===record.id?1:0) {
  const result=new Map(),ranks=new Map()
  for(const original of records){
    const record=normalize(original),score=rank(original,record)
    if(!result.has(record.id)||score>(ranks.get(record.id)||0)){result.set(record.id,record);ranks.set(record.id,score)}
  }
  return result
}

/** A late network response must not replace a newer local edit or editor draft. */
export function mergeBackgroundState(before,current,incoming,protectedIds=[],{reuseUnchanged=false}={}) {
  if(account(current)!==account(before)||account(incoming)!==account(before))return {state:reuseUnchanged?current:copy(current),conflicts:[]}
  if(incoming.revision<current.revision)return {state:reuseUnchanged?current:copy(current),conflicts:[]}
  const ids=canonicalRecordIds(before,current,incoming)
  const originalProtected=new Set(protectedIds),protectedSet=new Set(protectedIds.map(ids.resolve))
  const prior=recordMap(before.records,ids.record)
  const local=recordMap(current.records,ids.record,(original,record)=>(originalProtected.has(original.id)?8:0)+(!equal(record,prior.get(record.id))?4:0)+(original.id===record.id?1:0))
  const remote=recordMap(incoming.records,ids.record)
  const deniedSources=new Set(incoming.statuses.filter(status=>status.permissionDenied).map(status=>status.source)),deniedCollections=new Set(incoming.statuses.flatMap(status=>status.revokedCollectionIds||[]))
  const denied=record=>deniedSources.has(record.source)||deniedCollections.has(record.collectionId)
  const records=[...remote.values()].map(record=>{
    const latest=local.get(record.id)
    return latest&&(protectedSet.has(record.id)||!equal(latest,prior.get(record.id)))?latest:record
  }).filter(record=>!denied(record))
  const incomingIds=new Set(remote.keys())
  // Keep newly created/edited items if the fetch started before that edit.
  for(const record of local.values())if(!denied(record)&&!incomingIds.has(record.id)&&(protectedSet.has(record.id)||!equal(record,prior.get(record.id))))records.push(record)
  const merged=mergeWorkspaces(before.workspace,current.workspace,incoming.workspace)
  const state={...incoming,revision:Math.max(current.revision,incoming.revision),workspace:merged.conflicts.length?alignWorkspaceIdentities(current.workspace,incoming.workspace):merged.workspace,records,...(Object.keys(ids.aliases).length?{recordIdAliases:ids.aliases}:{})}
  return {state:reuseUnchanged?reuseUnchangedState(current,state):copy(state),conflicts:merged.conflicts}
}
