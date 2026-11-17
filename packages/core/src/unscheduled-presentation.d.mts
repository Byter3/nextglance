import type {WorkspaceRecord} from '@nextspace/contracts'
export interface UnscheduledPresentation {open:boolean;width:number;inline:boolean}
export type UnscheduledPresentationIntent={type:'show'|'hide'}|{type:'inline';value:boolean}|{type:'resize';value:number}
export function restoreUnscheduledPresentation(saved:unknown,options?:{allowInline?:boolean;defaultInline?:boolean}):UnscheduledPresentation
export function changeUnscheduledPresentation(state:UnscheduledPresentation,intent:UnscheduledPresentationIntent):UnscheduledPresentation
export function unscheduledTrayVisible(state:UnscheduledPresentation,recordCount:number,disabled?:boolean):boolean
export function timelineRowRecords(records:WorkspaceRecord[],unscheduledIds:ReadonlySet<string>,hideUnscheduled?:boolean):WorkspaceRecord[]
