import {createApp,h,shallowRef,type App as VueApp} from 'vue'
import {NextspaceApp} from '@nextspace/ui'
import type {State, WorkspaceApi} from '@nextspace/contracts'
import './web.css'

export type SessionHostState={phase:'opening'|'ready'|'offline'|'expired'|'error';message?:string;loginUrl?:string;sourceUrl?:string;appVersion?:string;userId?:string}
export type SessionApi=WorkspaceApi&{
  subscribe:(listener:(state:State)=>void)=>()=>void
  subscribeHost:(listener:(state:SessionHostState)=>void)=>()=>void
  getHostState:()=>SessionHostState
  setOnline:(online:boolean)=>void
  dispose:()=>void
}
/** Only the host lifecycle lives here; planner behavior is the shared Vue app. */
export function mountSessionPlanner(root:HTMLElement,api:SessionApi,nativeOperations:readonly (keyof WorkspaceApi)[]) {
  let app:VueApp|undefined,disposed=false,opened=false
  const currentHost=shallowRef(api.getHostState())
  const offline=document.createElement('div');offline.className='nextglance-offline';offline.setAttribute('role','status');offline.hidden=true;offline.textContent='Offline · Reconnect to edit'
  const content=document.createElement('div');content.className='nextglance-content'
  const gate=document.createElement('section');gate.className='nextglance-session-gate';gate.setAttribute('aria-live','polite')
  root.replaceChildren(content,offline,gate)
  function clearPrivateView(){app?.unmount();app=undefined;content.replaceChildren();content.hidden=true}
  const localLink=(value?:string)=>{if(!value)return;try{const url=new URL(value,location.href);if(url.origin===location.origin&&['http:','https:'].includes(url.protocol))return url.href}catch{/* Invalid host links are never rendered. */}}
  function showGate(host:SessionHostState) {
    clearPrivateView();gate.hidden=false;gate.replaceChildren()
    const title=document.createElement('h2'),message=document.createElement('p')
    title.textContent=host.phase==='opening'?'Opening NextGlance':host.phase==='expired'?'Your Nextcloud session ended':host.phase==='offline'?'Connection required':'Unable to open NextGlance'
    message.textContent=host.message||(host.phase==='opening'?'Checking your Nextcloud session…':host.phase==='offline'?'Reconnect to Nextcloud to open your planner.':'Reload this page to try again.')
    gate.append(title,message)
    if(host.phase!=='opening'){
      const retry=document.createElement('button');retry.type='button';retry.textContent='Reload';retry.addEventListener('click',()=>location.reload());gate.append(retry)
      const login=localLink(host.loginUrl)
      if(host.phase==='expired'&&login){const link=document.createElement('a');link.href=login;link.textContent='Sign in to Nextcloud';gate.append(link)}
    }
  }
  function present(host:SessionHostState) {
    if(disposed)return
    currentHost.value=host;offline.hidden=host.phase!=='offline'||!app
    if((host.phase==='ready'&&opened)||(host.phase==='offline'&&app)) {
      gate.hidden=true;content.hidden=false
      if(!app){app=createApp({setup:()=>()=>h(NextspaceApp,{api,sessionHost:true,sessionReadOnly:currentHost.value.phase!=='ready',portalTarget:'#nextglance-root',nativeConnection:false,manualConnection:false,canExportWorkspace:false,appVersion:host.appVersion||'0.6.12',sourceUrl:localLink(host.sourceUrl),nativeOperations,subscribe:api.subscribe})});app.mount(content)}
    } else showGate(host)
  }
  const unsubscribe=api.subscribeHost(present)
  present(api.getHostState())
  // No local snapshot is used before authenticated initialization succeeds.
  const ready=api.getState().then(()=>{opened=true;present(api.getHostState())}).catch(()=>present(api.getHostState()))
  const connectivity=()=>api.setOnline(navigator.onLine)
  window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity)
  return {ready,dispose(){if(disposed)return;disposed=true;unsubscribe();clearPrivateView();gate.remove();offline.remove();window.removeEventListener('online',connectivity);window.removeEventListener('offline',connectivity);api.dispose()}}
}
