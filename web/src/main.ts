import type {WorkspaceApi} from '@nextspace/contracts'
import {createWebController,WEB_NATIVE_OPERATIONS} from './session-controller.mjs'
import {mountSessionPlanner,type SessionApi} from './session-view'

declare global {interface Window {OC?:{requestToken?:string}}}
async function selectUpload():Promise<{name:string;bytes:Uint8Array}|null>{
  const input=document.createElement('input');input.type='file';input.hidden=true;document.body.append(input)
  return new Promise((resolve,reject)=>{
    const cleanup=()=>input.remove()
    input.addEventListener('cancel',()=>{cleanup();resolve(null)},{once:true})
    input.addEventListener('change',async()=>{try{const file=input.files?.[0];if(!file){resolve(null);return}if(file.size>20*1024*1024)throw new Error('Choose a file up to 20 MB to upload.');resolve({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())})}catch(error){reject(error)}finally{cleanup()}},{once:true})
    input.click()
  })
}
const root=document.getElementById('nextglance-root')
if(root){
  const api=createWebController({sessionUrl:root.dataset.sessionUrl,fetch:window.fetch.bind(window),origin:location.origin,online:()=>navigator.onLine,requestToken:()=>window.OC?.requestToken||document.head.dataset.requesttoken||'',selectUpload,openExternal:(url:string)=>{window.open(url,'_blank','noopener,noreferrer')}})
  const view=mountSessionPlanner(root,api as unknown as SessionApi,WEB_NATIVE_OPERATIONS as readonly (keyof WorkspaceApi)[])
  // A BFCache return must revalidate rather than reveal the previous session.
  window.addEventListener('pagehide',()=>view.dispose(),{once:true})
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()})
}
