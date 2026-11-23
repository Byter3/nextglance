import type {State, WorkspaceRecord} from '@nextspace/contracts'
export function restoreSourceStatuses(statuses?:State['statuses'], records?:Pick<WorkspaceRecord,'source'>[]):State['statuses']
export function hasSavedSourceRead(statuses?:State['statuses']):boolean
export function sourceReadLabel(status?:{state:string;cached?:boolean}):string
export function syncPresentationState(input?:{authorized?:boolean;networkOnline?:boolean;connected?:boolean;hasSavedData?:boolean;active?:boolean;hasError?:boolean;stale?:boolean;pending?:boolean}):'offline'|'syncing'|'error'|'saved'|'stale'|'pending'|'synced'
