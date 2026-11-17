import {checkedViewPreferences,emptyViewPreferences,mergeViewPreferences,viewPreferencesFromLocal} from './view-preferences.mjs'

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const conflict=paths=>Object.assign(new Error('Filters changed on another device. Review the conflicting filters before retrying.'),{code:'PREFERENCES_CONFLICT',paths})
const merge=(base,local,remote)=>{const result=mergeViewPreferences(base,local,remote);if(result.conflicts.length)throw conflict(result.conflicts);return result.preferences}
const seed=(remote,local)=>{const result=structuredClone(remote);for(const [scope,{pages}] of Object.entries(local.scopes)){result.scopes[scope]||={pages:{}};for(const [view,page] of Object.entries(pages))if(!result.scopes[scope].pages[view])result.scopes[scope].pages[view]=structuredClone(page)}return checkedViewPreferences(result)}

/** One account's filter sync machine. Ports own scheduling, storage and network. */
export function createViewPreferenceSync({read,save,publish,persist=()=>{},status=()=>{},local,initial,retainPending=true}){
  let base=emptyViewPreferences(),preferences=viewPreferencesFromLocal(local),etag=null,migration=true,closed=false,running=null,refreshAgain=false
  if(initial)try{if(initial.version===1){base=checkedViewPreferences(initial.base);preferences=checkedViewPreferences(initial.preferences);etag=typeof initial.etag==='string'?initial.etag:null;migration=initial.migration===true}}catch{/* An invalid journal cannot erase the independently saved local filters. */}
  const journal=()=>({version:1,base:structuredClone(base),preferences:structuredClone(preferences),etag,migration})
  const remember=()=>{if(!closed)persist(journal())}
  const announce=()=>{if(!closed){publish(structuredClone(preferences));remember()}}
  const run=async resolution=>{
    status({syncing:true,error:null})
    try{
      do{
        refreshAgain=false
        const before=structuredClone(preferences),remote=await read()
        if(closed)return
        const incoming=resolution?mergeViewPreferences(base,before,remote.preferences,resolution).preferences:migration?seed(remote.preferences,before):merge(base,before,remote.preferences)
        resolution=undefined
        preferences=merge(before,preferences,incoming);base=checkedViewPreferences(remote.preferences);etag=remote.etag;migration=false;announce()
        // Coalesce edits during a request, with bounded writes per turn.
        for(let attempt=0;attempt<3&&!equal(base,preferences);attempt++){
          const sent=structuredClone(preferences),result=await save({base:structuredClone(base),preferences:sent,etag})
          if(closed)return
          preferences=merge(sent,preferences,result.preferences);base=checkedViewPreferences(result.preferences);etag=result.etag;announce()
        }
      }while(refreshAgain&&!closed)
      if(!closed)status({syncing:false,error:null})
    }catch(error){if(!closed){if(!retainPending&&error.code!=='PREFERENCES_CONFLICT'){preferences=structuredClone(base);migration=false}remember();status({syncing:false,error})}}
  }
  const enqueue=resolution=>{const pending=(running||Promise.resolve()).then(()=>{if(!closed)return run(resolution)});running=pending;void pending.finally(()=>{if(running===pending)running=null});return pending}
  const refresh=()=>{if(closed)return Promise.resolve();if(running){refreshAgain=true;return running}return enqueue()}
  return {
    snapshot:journal,
    edit(value){if(closed)return;preferences=checkedViewPreferences(value);remember()},
    editPage(scope,view,page){if(closed)return;const next=structuredClone(preferences);next.scopes[scope]||={pages:{}};next.scopes[scope].pages[view]=page;preferences=checkedViewPreferences(next);remember()},
    refresh,
    resolve(choice){if(!['local','remote'].includes(choice))throw new Error('Choose local or server filters.');return closed?Promise.resolve():enqueue(choice)},
    close(){closed=true},
  }
}
