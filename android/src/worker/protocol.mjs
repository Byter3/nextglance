/** Private same-origin transport; neither endpoint evaluates arbitrary members. */
export const WORKER_PROTOCOL = 1
export const COMMANDS = Object.freeze(['getState','takeWidgetAction','getViewPreferences','saveViewPreferences','refresh','retryConnection','resumeSync','setAppActive','setSyncSettings','setCalendarHistoryDays','selectAccount','disconnect','readPage','createNote','updateNote','readNote','readNoteTags','setNoteTags','updateRecordDates','createLinkedEvent','openExternal','saveWorkspace','syncWorkspace','resolveWorkspaceConflict','saveDeviceState','beginLogin','pollLogin','cancelLogin','connect','createTask','createCard','setTaskCompleted','setCardCompleted','exportWorkspace','listFiles','readDeckAttachments','attachDeckFile','removeDeckAttachment','uploadDeckAttachment','deleteEvent','updateEvent','updateDescription','createEvent','respondToEvent','setDeckDependency','moveCard','updateTaskStatus','updateRecordAppearance','createDeckLabel','readRelatedResources','readPageAsset'])
export const EFFECTS = Object.freeze(['planner.export','widgets.state','widgets.publish','widgets.consumeAction','native.cacheFile','native.chooseAttachment','native.uploadAttachment','native.getAccount','native.getSavedAccount','native.selectAccount','native.disconnect','native.beginLogin','native.pollLogin','native.cancelLogin','native.request','native.resourceCache','native.configureSync','native.getSyncState','native.confirmSourceReads','files.keys','files.size','files.read','files.write','files.remove','network.status','browser.open','hints.save','hints.clear'])
// A file chooser waits for the user, not the network. Only these explicit
// operations are exempt; session shutdown still rejects every pending call.
export const USER_ACTION_COMMANDS = Object.freeze(['exportWorkspace'])
export const USER_ACTION_EFFECTS = Object.freeze(['planner.export'])
export const fail = (message,code='UNAVAILABLE') => Object.assign(new Error(message),{code})
export const wireError = error => ({code:typeof error?.code==='string'&&/^[A-Z_0-9-]{1,64}$/.test(error.code)?error.code:'UNAVAILABLE',message:typeof error?.message==='string'?error.message.slice(0,2000):'The background data service could not complete this operation.'})
export const validSession = value => typeof value==='string'&&/^[a-f0-9-]{16,80}$/.test(value)
export const validId = value => Number.isSafeInteger(value)&&value>0
export function checkedCall(value,session,methods){
  if(!value||value.version!==WORKER_PROTOCOL||value.session!==session||value.type!=='call'||!validId(value.id)||!methods.includes(value.method)||!Array.isArray(value.args)||value.args.length>8)throw fail('Invalid background service request.','SECURITY')
  return value
}
export function checkedFileEffect(method,args,isNative=true){
  if(method==='files.keys'){if(isNative)throw fail('Native cache enumeration is unavailable.','SECURITY');return}
  const previewPath=!isNative&&(args[0]==='selected-account'||/^resources\/[a-f0-9]{64}\/(dav|deck)\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/.test(args[0]||''))
  if(!previewPath&&!/^cache\/[a-f0-9]{64}\.[01]\.json$/.test(args[0]||''))throw fail('The background service requested an invalid cache path.','SECURITY')
  if(method==='files.write'&&(typeof args[1]!=='string'||args[1].length>50*1024*1024))throw fail('The cache write exceeds its limit.','LIMIT')
}
export function createRpc({send,session,methods,userActions=[],timeout=130000,timers=globalThis}){
  let next=0,closed=false;const pending=new Map()
  const receive=message=>{
    if(!message||message.type!=='result'||message.version!==WORKER_PROTOCOL||message.session!==session||!validId(message.id))return false
    const request=pending.get(message.id);if(!request)return true
    pending.delete(message.id);timers.clearTimeout(request.timer)
    if(message.error)request.reject(fail(message.error.message||'Background request failed.',message.error.code||'UNAVAILABLE'))
    else request.resolve(message.value)
    return true
  }
  const call=(method,...args)=>{
    if(closed)return Promise.reject(fail('The background data service has stopped.'))
    if(!methods.includes(method))return Promise.reject(fail('Unsupported background service operation.','SECURITY'))
    if(pending.size>=128)return Promise.reject(fail('Too many background requests. Try again shortly.','LIMIT'))
    const id=++next
    return new Promise((resolve,reject)=>{
      const timer=userActions.includes(method)?undefined:timers.setTimeout(()=>{pending.delete(id);reject(fail('The background operation timed out. Refresh before retrying an edit; it may have reached Nextcloud.','TIMEOUT'))},timeout);timer?.unref?.()
      pending.set(id,{resolve,reject,timer})
      try{send({type:'call',version:WORKER_PROTOCOL,session,id,method,args})}catch(error){pending.delete(id);timers.clearTimeout(timer);reject(error)}
    })
  }
  return {call,receive,close(error=fail('The background data service stopped. Cached data is retained.')){closed=true;for(const request of pending.values()){timers.clearTimeout(request.timer);request.reject(error)}pending.clear()},get pending(){return pending.size}}
}

export function checkedExternalUrl(value){
  let url;try{url=new URL(value)}catch{throw fail('Invalid external URL.','SECURITY')}
  if(url.username||url.password||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw fail('Only secure external links may open.','SECURITY')
  return url.href
}
