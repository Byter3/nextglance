import {createChunkCacheFiles} from '../chunk-cache-files.mjs'
import {createMobileController} from '../controller.mjs'
import {createSlotCache} from '../cache.mjs'
import {createBrowserHost} from '../browser-host.mjs'
import {createPreviewResourceCache} from '../resource-cache.mjs'
import {sanitizeDiagnosticInput} from '@nextspace/core/performance-diagnostics.mjs'
import {WORKER_PROTOCOL,COMMANDS,EFFECTS,USER_ACTION_EFFECTS,validSession,checkedCall,createRpc,wireError} from './protocol.mjs'
import {createPublisher,isState} from './publication.mjs'

/** Installs the production data engine on a dedicated browser/Node worker port. */
export function installWorkerRuntime(port,{makeController=createMobileController,timers=globalThis,now=()=>performance.now(),timeOrigin=()=>performance.timeOrigin}={}){
  let session,controller,rpc,disposed=false,inFlight=0,pendingState,timer,diagnosticGeneration=0,recording=false,diagnosticStart=0,diagnosticTimer,diagnosticInFlight=0,diagnosticSequence=0,diagnosticDropped=0,diagnosticQueue=[]
  const publisher=createPublisher()
  const send=value=>{if(!disposed)port.postMessage({...value,version:WORKER_PROTOCOL,session})}
  let diagnosticStopping,diagnosticWaiters=[]
  const finishDiagnosticStop=()=>{
    if(!diagnosticStopping||diagnosticInFlight||diagnosticQueue.length||diagnosticDropped)return
    const reason=diagnosticStopping;diagnosticStopping=undefined;send({type:'diagnostic-stop',generation:diagnosticGeneration,reason})
    for(const resolve of diagnosticWaiters.splice(0))resolve()
  }
  const flushDiagnostics=()=>{
    if(diagnosticInFlight||(!diagnosticQueue.length&&!diagnosticDropped)){finishDiagnosticStop();return}
    if(diagnosticTimer!==undefined)timers.clearTimeout(diagnosticTimer);diagnosticTimer=undefined
    const events=diagnosticQueue.splice(0,64),dropped=Math.min(5000,diagnosticDropped);diagnosticDropped-=dropped
    send({type:'diagnostic-batch',generation:diagnosticGeneration,seq:++diagnosticSequence,events,dropped});diagnosticInFlight=diagnosticSequence
  }
  const scheduleDiagnostics=()=>{if(diagnosticTimer===undefined&&!diagnosticInFlight)diagnosticTimer=timers.setTimeout(()=>{diagnosticTimer=undefined;flushDiagnostics()},50)}
  const resetDiagnostics=()=>{if(diagnosticTimer!==undefined)timers.clearTimeout(diagnosticTimer);diagnosticTimer=undefined;diagnosticQueue=[];diagnosticDropped=0;diagnosticInFlight=0;diagnosticStopping=undefined;for(const resolve of diagnosticWaiters.splice(0))resolve()}
  const diagnostics={
    summary:()=>({recording:recording&&now()-diagnosticStart<600000,elapsedMs:recording?now()-diagnosticStart:0,eventCount:0,dropped:0,canSaveFile:true}),
    start(){recording=true;diagnosticStart=now();return this.summary()},
    stop(reason='manual'){recording=false;diagnosticStopping=reason;flushDiagnostics();return this.summary()},
    clear(){resetDiagnostics();recording=false;send({type:'diagnostic-clear',generation:diagnosticGeneration});return this.summary()},
    record(value){if(!this.summary().recording)return;const event=sanitizeDiagnosticInput(value);if(event){if(diagnosticQueue.length>=256){diagnosticQueue.shift();diagnosticDropped++}diagnosticQueue.push({at:timeOrigin()+now(),event});scheduleDiagnostics()}},
    read:()=>'',
  }
  const publish=state=>{const start=now(),message=publisher.encode(state);send(message);inFlight=message.seq;diagnostics.record({kind:'ui',stage:'publication',durationMs:now()-start,count:state.records.length,success:true});return message.seq}
  const queueState=state=>{
    pendingState=state
    if(inFlight||timer!==undefined)return
    timer=timers.setTimeout(()=>{timer=undefined;if(!disposed&&!inFlight&&pendingState){const state=pendingState;pendingState=undefined;publish(state)}},0)
  }
  const wrapResult=value=>{
    if(isState(value)){
      pendingState=undefined
      // API results and notifications share one sequence, never duplicate bodies.
      const sequence=publish(value)
      return {$nextglanceState:sequence,...(value.createdRecordId?{createdRecordId:value.createdRecordId}:{}),...(value.creationWarning?{creationWarning:value.creationWarning}:{})}
    }
    if(value&&typeof value==='object'&&isState(value.state))return {...value,state:wrapResult(value.state)}
    return value
  }
  async function initialize(message){
    session=message.session
    rpc=createRpc({send:port.postMessage.bind(port),session,methods:EFFECTS,userActions:USER_ACTION_EFFECTS,timeout:50000,timers})
    const effect=(name,...args)=>rpc.call(name,...args)
    const files=message.isNative?createChunkCacheFiles(args=>effect('native.cacheFile',args)):Object.fromEntries(['keys','size','read','write','remove'].map(name=>[name,(...args)=>effect(`files.${name}`,...args)]))
    const preview=!message.isNative?createBrowserHost({identityStore:{load:async()=>{const text=await files.read('selected-account');return text?JSON.parse(text):null},save:account=>files.write('selected-account',JSON.stringify(account)),clear:()=>files.remove('selected-account')}}):undefined
    let hint=message.hint
    controller=makeController({isNative:message.isNative,hostAvailable:message.hostAvailable,appVersion:message.appVersion,diagnostics,
      timeZone:message.timeZone||'UTC',locale:message.locale||'en',widgets:message.isNative?{state:args=>effect('widgets.state',args),publish:args=>effect('widgets.publish',args),consumeAction:args=>effect('widgets.consumeAction',args)}:undefined,
      cache:createSlotCache(files),native:message.isNative?Object.fromEntries(EFFECTS.filter(name=>name.startsWith('native.')).map(name=>[name.slice(7),(...args)=>effect(name,...args)])):{...preview,chooseAttachment:args=>effect('native.chooseAttachment',args),uploadAttachment:args=>effect('native.uploadAttachment',args)},
      launchHints:{read:key=>hint?.accountKey===key?hint.theme:undefined,save(accountKey,theme){hint={accountKey,theme};void effect('hints.save',accountKey,theme).catch(()=>{})},clear(key){if(!key||hint?.accountKey===key)hint=undefined;void effect('hints.clear',key).catch(()=>{})}},
      deferRestoration:()=>new Promise(resolve=>timers.setTimeout(resolve,0)),
      networkStatus:()=>effect('network.status'),openExternal:url=>effect('browser.open',url),exportPlanner:document=>effect('planner.export',document),
      makeResourceCache:(account,isActive)=>{
        if(!message.isNative)return createPreviewResourceCache(files,account,isActive)
        const call=async(operation,args={})=>{
          if(!isActive())throw Object.assign(new Error('The selected account changed.'),{code:'CANCELLED'})
          const result=await effect('native.resourceCache',{accountName:account.name,operation,serialized:true,...args})
          if(!isActive())throw Object.assign(new Error('The selected account changed.'),{code:'CANCELLED'})
          return result
        }
        return {
          get:async locator=>(await call('get',locator)).entry??null,
          getMany:async locators=>{const result=await call('getMany',{locators});return typeof result.entriesJson==='string'?JSON.parse(result.entriesJson):result.entries??[]},
          list:async locator=>(await call('list',locator)).entries??[],
          put:async entry=>{await call('put',{entry})},remove:async locator=>{await call('remove',locator)},prune:async args=>{await call('prune',args)},retainCollections:async args=>{await call('retainCollections',args)},clear:async()=>{await call('clear')},
        }
      },
    })
    controller.subscribe(queueState)
    controller.subscribeSync(value=>send({type:'sync',value}))
    send({type:'ready',at:timeOrigin()+now()})
  }
  const receive=async message=>{
    if(disposed)return
    if(!session){if(message?.type==='init'&&message.version===WORKER_PROTOCOL&&validSession(message.session)&&typeof message.isNative==='boolean')await initialize(message);return}
    if(message?.session!==session||message.version!==WORKER_PROTOCOL)return
    if(rpc.receive(message))return
    if(message.type==='ack'){if(message.seq===inFlight){inFlight=0;if(pendingState)queueState(pendingState)}return}
    if(message.type==='resnapshot'){const value=await controller.getState();pendingState=undefined;const frame=publisher.encode(value,true);send(frame);inFlight=frame.seq;return}
    if(message.type==='diagnostic-ack'){if(message.generation===diagnosticGeneration&&message.seq===diagnosticInFlight){diagnosticInFlight=0;if(diagnosticStopping)flushDiagnostics();else if(diagnosticQueue.length||diagnosticDropped)scheduleDiagnostics();finishDiagnosticStop()}return}
    if(message.type==='diagnostic-control'){
      if(!Number.isSafeInteger(message.generation)||message.generation<=diagnosticGeneration)return
      resetDiagnostics();diagnosticGeneration=message.generation;recording=message.recording===true;diagnosticStart=now();return
    }
    if(message.type==='dispose'){controller.dispose();resetDiagnostics();disposed=true;rpc.close();if(timer!==undefined)timers.clearTimeout(timer);return}
    if(message.type!=='call')return
    try{
      checkedCall(message,session,COMMANDS)
      const value=await controller[message.method](...message.args)
      if(message.method==='setAppActive'&&message.args[0]===false&&diagnosticStopping)await new Promise(resolve=>diagnosticWaiters.push(resolve))
      send({type:'result',id:message.id,value:wrapResult(value)})
    }catch(error){send({type:'result',id:message.id,error:wireError(error)})}
  }
  const listener=event=>{void receive(event.data).catch(error=>send({type:'fatal',error:wireError(error)}))}
  port.addEventListener('message',listener)
  return {dispose(){controller?.dispose();resetDiagnostics();disposed=true;rpc?.close();if(timer!==undefined)timers.clearTimeout(timer);port.removeEventListener?.('message',listener)}}
}
