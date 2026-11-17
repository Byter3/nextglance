import type {WorkspaceRecord,Relation,ScopeArrangement} from '@nextspace/contracts'
export function safeArrangementId(value:unknown):value is string
export function validBoardOrderKey(value:unknown):boolean
export function boardOrderKey(mode:'source'|'deck'|'mapped'|'planning',boardId:string,columnId:string):string
export function normalizeArrangements(input:unknown):Record<string,ScopeArrangement>|undefined
export function remapArrangements(input:Record<string,ScopeArrangement>,target:(id:string)=>string):Record<string,ScopeArrangement>
export function orderTimelineRecords<T extends WorkspaceRecord>(records:T[],relations:Relation[],manualIds?:string[]):T[]
export interface OrderedTimelineGroup {id:string;name?:string;title?:string;records?:WorkspaceRecord[];children?:OrderedTimelineGroup[]}
export function orderTimelineGroups<T extends OrderedTimelineGroup>(groups:T[],manualIds?:string[]):T[]
export function orderBoardRecords<T extends WorkspaceRecord>(records:T[],manualIds?:string[]):T[]
export function reorderIds(savedIds:string[],visibleIds:string[],draggedId:string,targetId:string,placement?:'before'|'after'):string[]
export function boardTaskStacks<T extends WorkspaceRecord>(records:T[],relations:Relation[]):{parentByTask:Record<string,string>;byCard:Record<string,{incoming:T[];outgoing:T[]}>}
export function buildLinkIndex(relations:Relation[]):Map<string,Set<string>>
export function boardHighlightState(index:Map<string,Set<string>>,activeIds:(string|null|undefined)[]):{primary:Set<string>;linked:Set<string>}
export function boardColumnDropAllowed(input:{mode:'source'|'deck'|'mapped'|'planning';currentColumnId:string;columnId:string;canMove:boolean;statusTargetCount?:number}):boolean
export function listReorderTarget(rects:{id:string;group:string;top:number;bottom:number;left?:number;right?:number}[],group:string,id:string,y:number,x?:number):{targetId:string;placement:'before'|'after'}|null
export function listReorderPhase(input:{pointerType:string;elapsed:number;distance:number}):'pending'|'pan'|'active'
