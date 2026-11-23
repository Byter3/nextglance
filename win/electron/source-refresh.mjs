import {reconcileRefreshedCache} from './security.cjs'

/** Source work runs outside the commit lock; history/account changes fence publication. */
export async function refreshNativeSources({store,client,session,current,selected,sources,resourceCache,onVerified}) {
  const ticket=session.ticket(),active=()=>current()&&ticket.current(),before=store.cacheSnapshot()
  client.primeFileMetadata(before.records)
  let incoming,warning
  try {incoming=await client.readAll({sources:selected,calendarHistoryDays:ticket.days,isActive:active})}
  catch(error){
    if(!active()||error.code==='CANCELLED')return false
    incoming={records:[],collections:[],statuses:selected.map(source=>({source,state:'error',count:0,...(['AUTH','PERMISSION'].includes(error.code)?{permissionDenied:true,message:'Nextcloud denied access. Reconnect to verify your access.'}:{message:'Could not refresh this source. Check your connection.'})}))}
  } finally {
    try {await resourceCache?.flush()} catch(error){if(error.code!=='CANCELLED')warning='Source cache could not be saved. The next refresh may need to download resources again.'}
  }
  warning ||= incoming.cacheWarning?.message
  return session.publish(async()=>{
    if(!active())return false
    let successful
    await store.updateCache(cache=>{
      if(!active())throw Object.assign(new Error('The source session changed.'),{code:'CANCELLED'})
      const byId=new Map(cache.records.map(item=>[item.id,item]))
      const byIdentity=new Map(cache.records.filter(item=>item.identity?.key).map(item=>[`${item.source}\0${item.identity.key}`,item]))
      incoming.records=incoming.records.map(record=>{
        const previous=byId.get(record.id)||(record.identity?.key?byIdentity.get(`${record.source}\0${record.identity.key}`):undefined)
        if(!previous)return record
        return {...record,...(record.source==='deck'&&record.attachmentFileIds===undefined&&previous.attachmentFileIds?{attachmentFileIds:previous.attachmentFileIds}:{}),...(record.source==='notes'&&record.fileTags===undefined&&previous.fileTags?{fileTags:previous.fileTags,tagDetails:previous.fileTags,tags:[...new Set([...(record.tags||[]),...previous.fileTags.map(tag=>tag.title)])]}:{})}
      })
      const reconciled=reconcileRefreshedCache(before,cache,incoming,selected)
      successful=reconciled.successful
      const statuses=new Map(cache.statuses.map(status=>[status.source,status]))
      for(const status of reconciled.cache.statuses)statuses.set(status.source,warning?{...status,message:`${status.message||''} ${warning}`.trim()}:status)
      return {...cache,...reconciled.cache,statuses:sources.map(source=>statuses.get(source)).filter(Boolean),...(incoming.davCheckpoint?{davCheckpoint:incoming.davCheckpoint}:{})}
    },{purgeBackup:incoming.statuses.some(status=>status.permissionDenied===true||status.revokedCollectionIds?.length)})
    onVerified(successful,selected)
    return true
  })
}
