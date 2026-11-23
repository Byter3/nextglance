import {widgetCatalog, projectWidgets, normalizeWidgetConfig, validateWidgetIntent} from '@nextspace/core/widgets.mjs'
import {applyReadDenials} from './read-denials.mjs'

/** The worker owns selection; the native port owns only bounded private widget storage. */
export function widgetPublication(state, configs, {accountKey, now, timeZone='UTC', locale='en', ...revisions}) {
  const options={accountKey,now,timeZone,locale,metadataVerifiedAt:state.storage?.lastSyncedAt,...revisions}
  return {catalog:widgetCatalog(state,options),snapshots:projectWidgets(state,configs,options)}
}

/** Coalesce commits; neither progress ticks nor launcher renders request source sync. */
export function createWidgetPublisher({host, current, now=Date.now, timeZone='UTC', locale='en', timers=globalThis}) {
  let pending=false,running=false,timer,closed=false
  async function flush(){
    if(timer!==undefined)timers.clearTimeout(timer)
    timer=undefined
    if(closed||running||!pending)return
    pending=false;running=true
    const value=current()
    try{
      if(!value)return
      const saved=await host.state({accountKey:value.accountKey})
      if(closed||!value.isCurrent())return
      if(!Array.isArray(saved?.configs)||!Number.isSafeInteger(saved.revision)||saved.revision<0)return
      const permitted=applyReadDenials(value.state,saved.readDenials,value.state.connection?.serverUrl)
      const publication=widgetPublication(permitted,saved.configs,{accountKey:value.accountKey,now:now(),timeZone,locale,sourceRevision:value.sourceRevision,metadataRevision:value.state.revision,acknowledgedEditWatermark:value.acknowledgedEditWatermark})
      if(closed||!value.isCurrent())return
      await host.publish({accountKey:value.accountKey,revision:saved.revision,publicationToken:saved.publicationToken,...publication})
    }catch{/* A disposable widget snapshot cannot fail an acknowledged save. */}
    finally{running=false;if(pending&&!closed)schedule()}
  }
  function schedule(){if(closed||!host)return;pending=true;if(!running&&timer===undefined){timer=timers.setTimeout(flush,100);timer?.unref?.()}}
  return {schedule,close(){closed=true;pending=false;if(timer!==undefined)timers.clearTimeout(timer)},flush}
}

/** Revalidate a native launch against the live state, never trust launcher row payloads. */
export function resolveWidgetAction(value,state,options){
  if(value?.error)throw Object.assign(new Error(String(value.error)),{code:'WIDGET_UNAVAILABLE'})
  if(!value?.action)return null
  const config=normalizeWidgetConfig(value.config)
  if(!config)throw Object.assign(new Error('This widget needs to be configured again.'),{code:'WIDGET_UNAVAILABLE'})
  const permitted=applyReadDenials(state,value.readDenials,state.connection?.serverUrl)
  const checked=validateWidgetIntent(value.action,config,permitted,options)
  if(!checked?.ok)throw Object.assign(new Error(checked?.message||'This widget action is no longer available. Reconfigure the widget.'),{code:'WIDGET_UNAVAILABLE'})
  return {action:{widgetId:config.widgetId,accountKey:options.accountKey,generation:config.generation,action:checked.action,...(checked.kind?{kind:checked.kind}:{}),...(checked.recordId?{recordId:checked.recordId}:{}),...(checked.date?{date:checked.date}:{})},config,accountKey:options.accountKey}
}
