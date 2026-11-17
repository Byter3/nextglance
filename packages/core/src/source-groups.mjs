/** Portable starter catalog. Suggestions never create memberships automatically. */
export const sourceGroupPresets = Object.freeze([
  {key:'personal',name:'Personal',color:'#3483c6',description:'Personal tasks and appointments'},
  {key:'freelance',name:'Freelance',color:'#8a62b5',description:'Independent client work'},
  {key:'work',name:'Work',color:'#ba7435',description:'Employment and professional work'},
  {key:'shared',name:'Shared',color:'#b85b87',description:'Partner and family sources'},
  {key:'home',name:'Home',color:'#388a70',description:'Household and home projects'},
  {key:'learning',name:'Learning',color:'#768c35',description:'Study and skill development'},
].map(Object.freeze))
const list=value=>Array.isArray(value)?value:[]
export const sourceGroupNameKey=name=>String(name||'').trim().normalize('NFKC').toLowerCase()
export function nextSourceGroupDraftId(workspace){
  const used=new Set([...list(workspace.spaces),...list(workspace.categories),...list(workspace.projects)].map(item=>item.id))
  let index=1
  while(used.has(`$draft-group:${index}`))index++
  return `$draft-group:${index}`
}
/** Persistent identities are allocated only after the owner accepts Save. */
export function commitSourceGroupIds(workspace,spaceId,newId=()=>globalThis.crypto.randomUUID()){
  const result=structuredClone(workspace),used=new Set([...list(result.spaces),...list(result.categories),...list(result.projects)].map(item=>item.id))
  for(const group of list(result.categories))if(group.spaceId===spaceId&&group.id.startsWith('$draft-group:')){
    const id=newId()
    if(typeof id!=='string'||!id||id==='all'||id.startsWith('$draft-group:')||used.has(id))throw new Error('A source group needs a new unique identity.')
    used.add(id);group.id=id
  }
  return result
}
export function spaceSourceIds(workspace,spaceId,availableIds=[]){
  if(spaceId==='all')return [...new Set([...list(availableIds),...list(workspace?.categories).filter(item=>item.spaceId==='all').flatMap(item=>list(item.collectionIds))])]
  const space=list(workspace?.spaces).find(item=>item.id===spaceId)
  if(!space)return []
  return [...new Set([...list(space.collectionIds),...list(workspace.categories).filter(item=>item.spaceId===spaceId).flatMap(item=>list(item.collectionIds)),...list(workspace.projects).filter(item=>item.spaceId===spaceId).flatMap(item=>list(item.collectionIds))])]
}
export function sourceGroupNameError(workspace,spaceId){
  const names=new Set(),sources=new Set()
  for(const group of list(workspace?.categories).filter(item=>item.spaceId===spaceId)){
    const key=sourceGroupNameKey(group.name)
    if(!key||String(group.name).trim().length>200)return 'Give each source group a name of at most 200 characters before saving.'
    if(names.has(key))return `Use a different name for each source group in ${spaceId==='all'?'My overview':'this Space'}.`
    names.add(key)
    if(!list(group.tagNames).length)for(const id of list(group.collectionIds)){
      if(sources.has(id))return `A source can belong to only one whole-source group in ${spaceId==='all'?'My overview':'this Space'}. Keep a tag filter or adjust its source selection.`
      sources.add(id)
    }
  }
  return ''
}
/** Move only this owner's category slots; other owners retain their positions. */
export function reorderSourceGroups(workspace,spaceId,id,delta){
  const result=structuredClone(workspace),groups=list(result.categories).filter(group=>group.spaceId===spaceId)
  const index=groups.findIndex(group=>group.id===id),target=index+delta
  if(![-1,1].includes(delta)||index<0||target<0||target>=groups.length)return result
  ;[groups[index],groups[target]]=[groups[target],groups[index]]
  let next=0
  result.categories=list(result.categories).map(group=>group.spaceId===spaceId?groups[next++]:group)
  return result
}
/** The caller owns the unsaved draft and decides when to persist this result. */
export function addSuggestedGroups(workspace,spaceId,keys,newId=()=>globalThis.crypto.randomUUID()){
  const result=structuredClone(workspace)
  if(spaceId!=='all'&&!list(result.spaces).some(space=>space.id===spaceId))throw new Error('Choose an available Space first.')
  const wanted=new Set(keys),names=new Set(list(result.categories).filter(group=>group.spaceId===spaceId).map(group=>sourceGroupNameKey(group.name)))
  result.categories=list(result.categories)
  const usedIds=new Set([...result.spaces,...result.categories,...list(result.projects)].map(item=>item.id))
  for(const preset of sourceGroupPresets){
    const nameKey=sourceGroupNameKey(preset.name)
    if(!wanted.has(preset.key)||names.has(nameKey))continue
    const id=newId()
    if(typeof id!=='string'||!id||usedIds.has(id))throw new Error('A source group needs a new unique identity.')
    result.categories.push({id,spaceId,name:preset.name,color:preset.color,collectionIds:[]})
    names.add(nameKey);usedIds.add(id)
  }
  return result
}
