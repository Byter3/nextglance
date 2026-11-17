import type {State} from '@nextspace/contracts'
export interface SyncNotice {
  kind:'source'|'planner'|'connection'; tone:'warning'|'info'; message:string
  action:'reconnect'|'retry-sources'|'retry-planner'|'details'|null; actionLabel:string|null
}
export function syncNoticePresentation(notice?:SyncNotice|null):'none'|'banner'|'indicator'
export function syncNotice(input?: {
  connection?:State['connection']|null; storage?:Partial<State['storage']>; statuses?:State['statuses']
  networkOnline?:boolean; refreshing?:boolean; syncing?:boolean
}):SyncNotice|null
