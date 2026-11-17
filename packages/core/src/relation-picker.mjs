import { createRelationIndex } from './planner.mjs'
import { organizationSourcePool } from './organization-tags.mjs'

/** Picker candidates use the owning Space pool; graph validation stays global. */
export function dependencyCandidates(workspace,records,scopeId='all'){
  const work=records.filter(record=>['task','card'].includes(record.kind))
  if(scopeId==='all')return work
  const space=workspace.spaces?.find(value=>value.id===scopeId)
  const child=workspace.categories?.find(value=>value.id===scopeId)||workspace.projects?.find(value=>value.id===scopeId&&!value.archived)
  if(child?.spaceId==='all')return work
  const pool=new Set(organizationSourcePool(workspace,space?.id||child?.spaceId))
  return work.filter(record=>pool.has(record.collectionId))
}

/** UI arrows describe the order of work; depends_on is stored from the waiting item. */
export function relationPickerIntent(recordId, targetId, mode, direction = 'incoming', role = 'preparation') {
  if (mode === 'dependency') return {
    fromId: direction === 'outgoing' ? targetId : recordId,
    toId: direction === 'outgoing' ? recordId : targetId,
    type: 'depends_on',
  }
  if (mode === 'event-work') return { fromId: recordId, toId: targetId, type: 'for_event', role }
  return { fromId: recordId, toId: targetId, type: mode === 'note' ? 'reference' : 'related' }
}

export function relationPickerEligibility(record, target, mode, direction, relations, records) {
  return createRelationPickerIndex(records,relations).eligibility(record,target,mode,direction)
}

export function createRelationPickerIndex(records,relations){
  const index=createRelationIndex(relations,records)
  return {byId:index.byId,eligibility(record,target,mode,direction,options){
  if (!record || !target) return { ok: false, message: 'Choose an available item.' }
  if (record.id === target.id) return { ok: false, message: 'This is the current item.' }
  if (mode === 'dependency' && ![record, target].every(item => ['task', 'card'].includes(item.kind))) return { ok: false, message: 'Dependencies connect tasks and Deck cards.' }
  if (mode === 'note' && !['note', 'page'].includes(target.kind)) return { ok: false, message: 'Choose a note or Collective page.' }
  if (mode === 'event-work' && target.kind !== 'event') return { ok: false, message: 'Choose a calendar event.' }
  const intent = relationPickerIntent(record.id, target.id, mode, direction)
  if(options&&record.kind==='card'&&record.source==='deck'&&target.kind==='card'&&target.source==='deck'){
    if(intent.type!=='depends_on')return {ok:false,message:'Use Add dependency to connect Deck cards.'}
    if(options.deckAvailable===false)return {ok:false,message:'Connect and refresh Deck to save this dependency in Nextcloud.'}
    if(index.byId.get(intent.fromId)?.readonly)return {ok:false,message:'The card that waits for this work is read only in Deck.'}
  }
  // References and general associations are presented as one connection in either direction.
  if (intent.type !== 'depends_on' && (index.has(intent.type,intent.fromId,intent.toId)||index.has(intent.type,intent.toId,intent.fromId))) return { ok: false, message: 'Already linked.' }
  index.prepare(record.id)
  const result = index.canAdd(intent.fromId,intent.toId,intent.type)
  if (!result.ok && result.message === 'These items already have this relationship.') return { ok: false, message: 'Already linked in this direction.' }
  if (!result.ok && result.message === 'This would create a circular dependency.') return { ok: false, message: 'Would create a dependency cycle.' }
  return result
  }}
}
