import {createPerformanceDiagnostics} from '@nextspace/core/performance-diagnostics.mjs'
import {createPublicState} from './publication.mjs'
import {COMMANDS,EFFECTS,USER_ACTION_COMMANDS,WORKER_PROTOCOL,checkedCall,checkedFileEffect,checkedExternalUrl,createRpc,fail,wireError} from './protocol.mjs'

/** UI adapter: bounded platform effects, public state and a diagnostic mirror. */
export function createWorkerApi({createWorker,effects,isNative,hostAvailable=true,appVersion='Development',hint,saveDiagnostics,copyDiagnostics,onDiagnosticsChange=()=>{},now=()=>performance.now(),timeOrigin=()=>performance.timeOrigin,timers=globalThis,sessionId=()=>crypto.randomUUID()}){
  let ownerEpoch=Date.now(),worker,rpc,session,failed,disposed=false,startPending,readyControl,diagnosticGeneration=0,recordingOrigin=0
  let states=createPublicState(),fallback,sync,publishTimer,pendingPublish,durationTimer
  const listeners=new Set(),syncListeners=new Set(),fileQueues=new Map()
  const diagnostics=createPerformanceDiagnostics({now,platform:isNative?'android':'preview',appVersion,canSaveFile:typeof saveDiagnostics==='function'})
  const send=value=>worker?.postMessage({...value,session,version:WORKER_PROTOCOL})
  const diagnosticControl=()=>send({type:'diagnostic-control',generation:++diagnosticGeneration,recording:diagnostics.summary().recording})
  const diagnosticChange=()=>{try{onDiagnosticsChange()}catch{}}
  const stopDiagnostics=(reason='manual')=>{const result=diagnostics.stop(reason);if(durationTimer!==undefined)timers.clearTimeout(durationTimer);durationTimer=undefined;diagnosticControl();diagnosticChange();return result}
  function publish(){
    pendingPublish=true
    if(publishTimer!==undefined)return
    publishTimer=timers.setTimeout(()=>{publishTimer=undefined;if(!disposed&&pendingPublish){pendingPublish=false;for(const listener of listeners){try{listener(snapshot())}catch{}}}},0)
  }
  function snapshot(){
    const value=states.read()||(fallback?structuredClone(fallback):undefined)
    if(value&&sync)value.deviceSync=structuredClone(sync)
    if(value&&failed){
      value.records=value.records.map(record=>({...record,readonly:true}));value.collections=value.collections.map(collection=>({...collection,readonly:true}));value.nativeOperations=[];value.nativeWriteSources=[]
      value.storage={...value.storage,syncStatus:'error',errorCode:'UNAVAILABLE',errorStage:'local-cache',message:'The background data service stopped. Saved data is retained. Use Refresh sources to restart it; check Nextcloud before retrying an interrupted edit.'}
      value.deviceSync={...value.deviceSync,restoring:false,plannerSyncing:false};delete value.deviceSync.activity
    }
    return value
  }
  function crash(error){if(disposed||failed)return;failed=wireError(error);rpc?.close(fail(failed.message,failed.code));worker?.terminate();stopDiagnostics('background');publish()}
  const decode=value=>{
    if(value?.$nextglanceState){const state=snapshot();if(!state||value.$nextglanceState>states.sequence)throw fail('The background state has not arrived.','STATE_GAP');return {...state,...(value.createdRecordId?{createdRecordId:value.createdRecordId}:{}),...(value.creationWarning?{creationWarning:value.creationWarning}:{})}}
    if(value&&typeof value==='object'&&value.state?.$nextglanceState)return {...value,state:decode(value.state)}
    return value
  }
  // Hold an issued file operation through worker replacement. A completed
  // journal may be the sole durable evidence of an acknowledged native edit;
  // crashes do not prove cancellation. Restart uses normal slot validation.
  const fileEffect=(message,activeSession)=>{
    checkedFileEffect(message.method,message.args,isNative)
    const key=message.args[0]||'*',previous=fileQueues.get(key)||Promise.resolve()
    const current=()=>!disposed&&!failed&&session===activeSession
    const operation=previous.catch(()=>{}).then(async()=>{
      if(!current())throw fail('The background session changed.','CANCELLED')
      return await effects[message.method](...message.args)
    })
    const settled=operation.catch(()=>{});fileQueues.set(key,settled)
    void settled.then(()=>{if(fileQueues.get(key)===settled)fileQueues.delete(key)})
    return operation
  }
  function start(){
    if(disposed)return Promise.reject(fail('The app has closed.'))
    if(startPending)return startPending
    fallback=snapshot();failed=undefined;session=sessionId();ownerEpoch=Math.max(Date.now(),ownerEpoch+1);states=createPublicState();sync=undefined
    let resolveReady,rejectReady
    const ready=readyControl=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
    const activeSession=session
    const timeout=timers.setTimeout(()=>{rejectReady(fail('The background data service did not start. Retry refresh.','TIMEOUT'));crash(fail('The background data service did not start.','TIMEOUT'))},15000);timeout?.unref?.()
    rpc=createRpc({send:value=>worker.postMessage(value),session,methods:COMMANDS,userActions:USER_ACTION_COMMANDS,timers})
    try{worker=createWorker()}catch(error){timers.clearTimeout(timeout);rejectReady(error);crash(error)}
    worker?.addEventListener('error',()=>{if(session!==activeSession)return;timers.clearTimeout(timeout);rejectReady(fail('The background data service stopped.'));crash(fail('The background data service stopped.'))})
    worker?.addEventListener('messageerror',()=>{if(session===activeSession)crash(fail('A background message could not be read.','FORMAT'))})
    worker?.addEventListener('message',event=>{
      const message=event.data
      if(disposed||failed||session!==activeSession||message?.session!==session||message.version!==WORKER_PROTOCOL)return
      if(rpc.receive(message))return
      if(message.type==='ready'){timers.clearTimeout(timeout);diagnostics.record({kind:'restore',stage:'worker-ready',success:true});resolveReady();diagnosticControl();return}
      if(message.type==='fatal'){rejectReady(fail(message.error?.message||'Background service failed.'));crash(message.error);return}
      if(message.type==='state'){
        try{if(states.apply(message)){fallback=undefined;sync=states.peek()?.deviceSync;publish()}send({type:'ack',seq:message.seq})}catch{send({type:'resnapshot'})}return
      }
      if(message.type==='sync'){sync=message.value;for(const listener of syncListeners){try{listener(structuredClone(sync))}catch{}}return}
      if(message.type==='diagnostic-batch'){
        if(message.generation===diagnosticGeneration&&diagnostics.summary().recording&&Array.isArray(message.events)&&message.events.length<=64){
          for(const entry of message.events)if(entry&&Number.isFinite(entry.at))diagnostics.recordAt(entry.event,entry.at-recordingOrigin)
          if(Number.isSafeInteger(message.dropped)&&message.dropped>=0&&message.dropped<=5000)diagnostics.recordDropped(message.dropped)
        }
        send({type:'diagnostic-ack',generation:message.generation,seq:message.seq});return
      }
      if(message.type==='diagnostic'&&message.generation===diagnosticGeneration&&diagnostics.summary().recording){
        diagnostics.recordAt(message.event,message.at-recordingOrigin);return
      }
      if(message.type==='diagnostic-stop'&&message.generation===diagnosticGeneration){stopDiagnostics(message.reason);return}
      if(message.type==='diagnostic-clear'&&message.generation===diagnosticGeneration){diagnostics.clear();if(durationTimer!==undefined)timers.clearTimeout(durationTimer);durationTimer=undefined;diagnosticControl();diagnosticChange();return}
      if(message.type==='call')void(async()=>{
        try{
          checkedCall(message,session,EFFECTS)
          if(message.method==='browser.open')checkedExternalUrl(message.args[0])
          const operation=effects[message.method]
          if(typeof operation!=='function')throw fail('This platform operation is unavailable.','UNAVAILABLE')
          const value=message.method==='native.cacheFile'?await operation({...message.args[0],owner:activeSession,ownerEpoch}):message.method.startsWith('files.')?await fileEffect(message,activeSession):await operation(...message.args)
          if(session===activeSession&&!disposed&&!failed)send({type:'result',id:message.id,value})
        }catch(error){if(session===activeSession&&!disposed&&!failed)send({type:'result',id:message.id,error:wireError(error)})}
      })()
    })
    if(!failed)send({type:'init',isNative,hostAvailable,appVersion,hint})
    startPending=ready.then(()=>rpc.call('getState')).then(decode).catch(error=>{crash(error);throw error})
    void startPending.catch(()=>{})
    return startPending
  }
  const call=async(method,...args)=>{
    if(failed){
      if(['refresh','retryConnection'].includes(method)){worker?.terminate();startPending=undefined;await start()}
      else if(method==='resumeSync')return snapshot()
      else throw fail('The background data service stopped. Use Refresh sources to restart it.')
    }else if(method==='setAppActive')await readyControl
    else await start()
    return decode(await rpc.call(method,...args))
  }
  const api={...Object.fromEntries(COMMANDS.map(method=>[method,(...args)=>call(method,...args)])),isNative,canAuthenticate:hostAvailable,
    getState:async()=>{if(failed&&snapshot())return snapshot();await start();return snapshot()},
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},subscribeSync(listener){syncListeners.add(listener);return()=>syncListeners.delete(listener)},
    startDiagnostics(){recordingOrigin=timeOrigin()+now();const result=diagnostics.start();if(durationTimer!==undefined)timers.clearTimeout(durationTimer);durationTimer=timers.setTimeout(()=>stopDiagnostics('duration'),600000);durationTimer?.unref?.();diagnosticControl();diagnosticChange();return result},
    stopDiagnostics:()=>stopDiagnostics(),clearDiagnostics(){stopDiagnostics();const result=diagnostics.clear();diagnosticControl();diagnosticChange();return result},getDiagnostics:()=>diagnostics.summary(),readDiagnostics:()=>diagnostics.read(),recordDiagnostic:event=>diagnostics.record(event),
    saveDiagnostics:async()=>saveDiagnostics?saveDiagnostics(diagnostics.read()):{saved:false},copyDiagnostics:async()=>copyDiagnostics?copyDiagnostics(diagnostics.read()):{copied:false},
    dispose(){if(disposed)return;send({type:'dispose'});stopDiagnostics('background');disposed=true;rpc?.close();worker?.terminate();if(publishTimer!==undefined)timers.clearTimeout(publishTimer);listeners.clear();syncListeners.clear()},
  }
  const setActive=api.setAppActive
  api.setAppActive=async active=>{try{return await setActive(active)}finally{if(active===false&&diagnostics.summary().recording)stopDiagnostics('background')}}
  void start()
  return api
}
