import type {State, Source} from '@nextspace/contracts'

export function canRefreshSources(connection: State['connection'] | null | undefined, options?: {networkOnline?: boolean; busy?: boolean; refreshing?: boolean; loginWaiting?: boolean}): boolean
export function sourceConnectionLabel(connection: State['connection'] | null | undefined, options?: {networkOnline?: boolean; refreshing?: boolean; itemCount?: number; sourceErrors?: boolean; statuses?:State['statuses']}): string
export function sourceRefreshFeedback(state?: Pick<State,'statuses'|'records'>): {source: Source; count: number; message?: string; summary: string}[]

export function validRecord(record: unknown): boolean
export function validCollection(collection: unknown): boolean
export function validEventDetails(record: any): boolean
export function validCalendarScheduling(collection: any): boolean
export function optionalMetadata(previous: any, next: any): any
export function mergeSourceRefresh(state: Pick<State,'records'|'collections'|'statuses'>, incoming: Pick<State,'records'|'collections'|'statuses'>, selected?: readonly Source[]): Pick<State,'records'|'collections'|'statuses'>
