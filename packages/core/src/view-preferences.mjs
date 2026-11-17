import {parseScopePreferences} from './scope-preferences.mjs'

const fields=['assignment','includeUnassigned','unassignedBoardIds','hiddenCollectionIds','showCompleted','query','attention','listKind','statusIds']
const views=['overview','calendar','timeline','board','list']
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
const safe=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!/[\u0000-\u001f]/.test(value)&&!['__proto__','prototype','constructor'].includes(value)
const stable=value=>value===undefined?'undefined':JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
const same=(a,b)=>stable(a)===stable(b)
const fail=()=>{throw Object.assign(new Error('Saved filters have an unsupported or invalid format. Existing preferences were preserved.'),{code:'PREFERENCES_FORMAT'})}
export function emptyViewPreferences(){return {format:'nextspace-view-preferences',version:1,scopes:{}}}
export function checkedViewPreferences(value){
  if(!object(value)||value.format!=='nextspace-view-preferences'||value.version!==1||Object.keys(value).sort().join(',')!=='format,scopes,version'||!object(value.scopes)||Object.keys(value.scopes).length>2500)fail()
  let serialized;try{serialized=JSON.stringify(value)}catch{fail()}
  if(serialized.length>2_000_000)fail()
  const result=emptyViewPreferences()
  for(const [scope,entry]of Object.entries(value.scopes)){
    if(!safe(scope)||!object(entry)||Object.keys(entry).join(',')!=='pages'||!object(entry.pages)||Object.keys(entry.pages).some(view=>!views.includes(view)))fail()
    const parsed=parseScopePreferences(JSON.stringify({version:2,scopes:{[scope]:entry}}))
    const pages={}
    for(const [view,page]of Object.entries(entry.pages)){
      if(!object(page)||Object.keys(page).length!==fields.length||fields.some(key=>!Object.hasOwn(page,key))||!same(page,parsed.scopes[scope]?.pages[view]))fail()
      pages[view]=structuredClone(page)
    }
    result.scopes[scope]={pages}
  }
  return result
}
/** Extract only saved semantic pages. Geometry and active navigation never sync. */
export function viewPreferencesFromLocal(store){
  const normalized=parseScopePreferences(JSON.stringify(store)),result=emptyViewPreferences()
  for(const [scope,value]of Object.entries(normalized.scopes))if(Object.keys(value.pages).length)result.scopes[scope]={pages:structuredClone(value.pages)}
  return checkedViewPreferences(result)
}
export function applyViewPreferences(store,preferences){
  const result=parseScopePreferences(JSON.stringify(store)),shared=checkedViewPreferences(preferences)
  for(const value of Object.values(result.scopes))value.pages={}
  for(const [scope,value]of Object.entries(shared.scopes))result.scopes[scope]={...(result.scopes[scope]||{view:'overview',calendarMode:'week',timelineFloatingEvents:false,timelineListCollapsed:false,boardGroupTasks:false}),pages:structuredClone(value.pages)}
  return result
}
/** Seed only absent cloud pages, never overwrite another device with defaults. */
export function importViewPreferences(remote,local){
  const result=checkedViewPreferences(remote),saved=viewPreferencesFromLocal(local)
  for(const [scope,{pages}]of Object.entries(saved.scopes)){
    result.scopes[scope]||={pages:{}}
    for(const [view,page]of Object.entries(pages))if(!Object.hasOwn(result.scopes[scope].pages,view))result.scopes[scope].pages[view]=page
  }
  return checkedViewPreferences(result)
}
/** Three-way merge with explicit divergent-field conflicts; no clock-based winner. */
export function mergeViewPreferences(base,local,remote,resolution){
  base=checkedViewPreferences(base);local=checkedViewPreferences(local);remote=checkedViewPreferences(remote)
  const result=emptyViewPreferences(),conflicts=[]
  const pick=(a,b,c,path)=>{if(same(b,a))return c;if(same(c,a)||same(b,c))return b;conflicts.push(path);return resolution==='local'?b:c}
  for(const scope of new Set([...Object.keys(base.scopes),...Object.keys(local.scopes),...Object.keys(remote.scopes)])){
    const pages={}
    for(const view of views){
      const a=base.scopes[scope]?.pages[view],b=local.scopes[scope]?.pages[view],c=remote.scopes[scope]?.pages[view]
      if(!a||!b||!c){const chosen=pick(a,b,c,`${scope}/${view}`);if(chosen)pages[view]=structuredClone(chosen);continue}
      pages[view]=Object.fromEntries(fields.map(key=>[key,structuredClone(pick(a[key],b[key],c[key],`${scope}/${view}/${key}`))]))
    }
    if(Object.keys(pages).length)result.scopes[scope]={pages}
  }
  return {preferences:checkedViewPreferences(result),conflicts}
}
