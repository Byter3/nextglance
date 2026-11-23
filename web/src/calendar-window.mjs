/** Session-only Calendar projection. Native identities and source merge rules stay shared. */
import {calendarItem} from '@nextspace/core/calendar-items.mjs'
import {mergeSourceRefresh} from '@nextspace/core/source-refresh.mjs'

export const nativeKey = record => record.identity ? JSON.stringify([record.identity.source,record.identity.key]) : record.id
export const sameWindow = (left,right) => Boolean(left && right && left.from === right.from && left.to === right.to)
export const coversWindow = (coverage,window) => Boolean(coverage && window && coverage.from <= window.from && coverage.to >= window.to)
export function calendarSnapshot(state) {
  return {records:state.records.filter(record=>record.source==='calendar'),collections:state.collections.filter(collection=>collection.source==='calendar'),statuses:state.statuses.filter(status=>status.source==='calendar')}
}
export function replaceCalendar(state,calendar) {
  return {...state,records:[...state.records.filter(record=>record.source!=='calendar'),...calendar.records],collections:[...state.collections.filter(collection=>collection.source!=='calendar'),...calendar.collections],statuses:[...state.statuses.filter(status=>status.source!=='calendar'),...calendar.statuses.map(status=>({...status,count:calendar.records.length}))]}
}
export function inCalendarWindow(record,window) {
  const item=calendarItem(record)
  return Boolean(item && window && item.start < window.to && (item.end > window.from || item.start===item.end && item.start>=window.from))
}
const empty = () => ({records:[],collections:[],statuses:[]})
/** A fresh bounded read cannot certify or retain stale occurrences of a changed resource. */
export function mergeCalendarWindow(recent,previous,incoming,window) {
  const next=mergeSourceRefresh(previous&&sameWindow(previous.window,window)?previous.snapshot:empty(),incoming,['calendar'])
  const status=next.statuses.find(value=>value.source==='calendar'),complete=status?.state==='connected'&&!status.permissionDenied
  const revoked=new Set(status?.revokedCollectionIds||[]),loaded=new Set(next.records.map(nativeKey)),currentCollections=new Map(next.collections.map(collection=>[collection.id,collection]))
  if(complete)for(const collection of recent.collections)if(!currentCollections.has(collection.id))revoked.add(collection.id)
  const changed=new Set(),versions=new Map(next.records.filter(record=>record.remote?.href&&record.etag).map(record=>[record.remote.href,record.etag]))
  for(const record of recent.records)if(record.remote?.href&&versions.has(record.remote.href)&&record.etag!==versions.get(record.remote.href))changed.add(record.remote.href)
  const retained={
    records:status?.permissionDenied?[]:recent.records.filter(record=>!revoked.has(record.collectionId)&&!changed.has(record.remote?.href)&&(!complete||!inCalendarWindow(record,window)||loaded.has(nativeKey(record)))).map(record=>currentCollections.get(record.collectionId)?.readonly?{...record,readonly:true}:record),
    collections:status?.permissionDenied?[]:recent.collections.filter(collection=>!revoked.has(collection.id)).map(collection=>currentCollections.get(collection.id)||collection),
    statuses:status?.permissionDenied||revoked.size?[{...status,...(revoked.size?{revokedCollectionIds:[...revoked]}:{})}]:recent.statuses,
  }
  const records=[...new Map([...retained.records,...next.records].map(record=>[nativeKey(record),record])).values()]
  const collections=[...new Map([...retained.collections,...next.collections].map(collection=>[collection.id,collection])).values()]
  const statuses=next.statuses.map(value=>({...value,count:records.length,...(revoked.size?{revokedCollectionIds:[...revoked]}:{})}))
  return {recent:retained,additional:{window,snapshot:{...next,statuses},complete},invalidateRecent:changed.size>0||Boolean(status?.permissionDenied)||revoked.size>0,snapshot:{records,collections,statuses}}
}
