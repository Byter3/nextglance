import type {Source, State, DeviceSyncSettings} from '@nextspace/contracts'
export const SYNC_INTERVALS: readonly number[]
export function normalizeSyncSettings(value?:unknown):DeviceSyncSettings
export function validateSyncSettings(value:unknown):DeviceSyncSettings
export function dueSyncSources(settings:unknown,statuses:State['statuses'],lastAttempts:Partial<Record<'caldav'|'deck'|'other',number>>,now:number,options?:{includeOthers?:boolean,independentAccessSources?:Source[]}):Source[]
export function sourceSyncStale(statuses:State['statuses']|undefined,settings:unknown,now:number):boolean
