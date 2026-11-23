/** Host implementation and authenticated runtime capabilities must both permit a write.
 * A scoped host requires an explicit runtime list; legacy reference hosts keep
 * their established global capability when neither list is supplied. */
export function canUseNativeOperation({operation, implemented, canMutateNative=true, hostOperations, runtimeOperations}={}) {
  if(typeof operation!=='string'||!operation||implemented!==true)return false
  const scoped=hostOperations!==undefined
  const hostAllowed=scoped?Array.isArray(hostOperations)&&hostOperations.includes(operation):canMutateNative===true
  if(!hostAllowed)return false
  if(runtimeOperations!==undefined)return Array.isArray(runtimeOperations)&&runtimeOperations.includes(operation)
  return !scoped
}

/** Fresh permission discovery can unlock writes before a bulk refresh finishes.
 * The host-provided list is ephemeral authorization evidence, never cached data. */
export function canWriteNativeSource({source,connected,online,busy=false,loginWaiting=false,statuses=[],nativeWriteSources}={}) {
  if(connected!==true||online!==true||busy||loginWaiting||!['tasks','calendar','deck','notes','collectives'].includes(source))return false
  if(statuses.some(status=>status.source===source&&status.permissionDenied))return false
  return nativeWriteSources!==undefined
    ? Array.isArray(nativeWriteSources)&&nativeWriteSources.includes(source)
    : statuses.some(status=>status.source===source&&status.state==='connected'&&!status.cached)
}

/** Select the existing native completion operation without broadening other
 * status capabilities. Source availability and host authorization are separate. */
export function completionOperation(record,collections=[]) {
  if(!record||record.readonly)return null
  const operation=record.kind==='task'&&record.source==='tasks'?'setTaskCompleted':record.kind==='card'&&record.source==='deck'?'setCardCompleted':null
  if(!operation||collections.some(collection=>collection.id===record.collectionId&&collection.source===record.source&&collection.readonly))return null
  return operation
}

/** Public eligibility is preliminary. Complex events are projected readonly;
 * the host must revalidate the private resource immediately before deleting. */
export function eventDeleteOperation(record,collections=[]) {
  if(!record||record.kind!=='event'||record.source!=='calendar'||(record.eventAccess ? !record.eventAccess.delete : record.readonly))return null
  const collection=collections.find(item=>item.id===record.collectionId&&item.source==='calendar')
  return collection&&!collection.readonly?'deleteEvent':null
}
export function eventEditOperation(record,collections=[]) {
  if(!record||record.kind!=='event'||record.source!=='calendar'||(record.eventAccess ? !record.eventAccess.editDetails&&!record.eventAccess.editReminders&&!record.eventAccess.editAttendees : record.readonly))return null
  const collection=collections.find(item=>item.id===record.collectionId&&item.source==='calendar')
  return collection&&!collection.readonly?'updateEvent':null
}
export function eventRespondOperation(record,collections=[]) {
  if(!record?.eventAccess?.respond||record.kind!=='event'||record.source!=='calendar')return null
  const collection=collections.find(item=>item.id===record.collectionId&&item.source==='calendar')
  return collection&&!collection.readonly?'respondToEvent':null
}
export function eventDeleteFingerprint(record) {
  return record ? JSON.stringify([record.id,record.collectionId,record.etag,record.title,record.start,record.end,Boolean(record.allDay)]) : ''
}

/** Native Deck attachments require the matching loaded writable board. */
export function deckAttachmentOperation(record,collections=[],operation='attachDeckFile') {
  if(!['attachDeckFile','removeDeckAttachment','uploadDeckAttachment'].includes(operation)||!record||record.kind!=='card'||record.source!=='deck'||record.readonly)return null
  const collection=collections.find(item=>item.id===record.collectionId&&item.source==='deck')
  return collection&&!collection.readonly?operation:null
}
