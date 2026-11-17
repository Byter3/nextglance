import type {Collection, Workspace, Space, WorkspaceRecord, StatusMapping, StatusMappingColumn} from '@nextspace/contracts'
export interface StatusSourceOption {key:string;source:'deck'|'tasks';collectionId:string;status:string;title:string;sourceTitle:string;color?:string;available:boolean}
export interface StatusMoveTarget {key:string;title:string;source:'deck'|'tasks';stackId?:string;status?:string;completed:boolean}
export interface StatusMoveIntent {id:string;source:'deck'|'tasks';stackId?:string;status?:string;completed:boolean}
export const TASK_STATUSES: {id:string;title:string}[]
export function taskStatusProgress(status:string,previousPercent?:number): number
export const DECK_COMPLETED: '$completed'
export const UNMAPPED_COLUMN: '$unmapped'
export function statusSourceKey(source:string,collectionId:string,status:string): string
export function parseStatusSourceKey(key:string): {source:'deck'|'tasks';collectionId:string;status:string}|null
export function nativeStatus(record:WorkspaceRecord): string|null
export function nativeStatusKey(record:WorkspaceRecord): string
export function normalizeStatusMapping(value:unknown): StatusMapping|undefined
export function defaultStatusMapping(collections?:Collection[]): StatusMapping
export function statusSourceOptions(collections?:Collection[],records?:WorkspaceRecord[],mapping?:StatusMapping): StatusSourceOption[]
export function mappedColumnForRecord(record:WorkspaceRecord,mapping?:StatusMapping): string
export function statusMappingSpace(workspace:Workspace,scopeId:string):Space|undefined
export function effectiveStatusMapping(workspace:Workspace,scopeId:string,collections?:Collection[]):StatusMapping
export function setScopeStatusMapping(workspace:Workspace,scopeId:string,mapping:StatusMapping|null):Workspace
export function unifiedStatus(record:WorkspaceRecord,mapping:StatusMapping):StatusMappingColumn|null
export function filterUnifiedStatuses(records:WorkspaceRecord[],mapping:StatusMapping,statusIds?:string[]):WorkspaceRecord[]
export function boardModeAfterMappingChange(mode:string,hadMapping:boolean,hasMapping:boolean):string
export function mappedBoardColumns(records:WorkspaceRecord[],collections:Collection[],mapping?:StatusMapping): (StatusMappingColumn & {records:WorkspaceRecord[]})[]
export function statusMoveTargets(record:WorkspaceRecord,columnId:string,mapping:StatusMapping|undefined,collections:Collection[]): StatusMoveTarget[]
