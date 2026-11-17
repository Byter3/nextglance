import type {State} from '@nextspace/contracts'
export function plannerSyncReady(input?:{connection?:Partial<State['connection']>;online?:boolean;restoring?:boolean;syncing?:boolean;busy?:boolean;protectedChanges?:boolean}):boolean
export interface PlannerSyncStatus {
  folder:string;lastSyncedAt:string|null;errorCode:string|null;errorStage:string|null
  state:'restoring'|'conflict'|'error'|'authorization'|'offline'|'syncing'|'pending'|'synced'|'local'
  label:string;message:string
}
export function plannerSyncStatus(input?:{storage?:Partial<State['storage']>;connection?:Partial<State['connection']>;restoring?:boolean;syncing?:boolean;online?:boolean;plannerVerifiedAt?:string}):PlannerSyncStatus
