import type {WorkspaceRecord,PlanSession} from '@nextspace/contracts'
export interface TimelineDateEdit {id:string;start?:string;due?:string;end?:string;allDay?:boolean;etag?:string}
export function shiftTimelineDate(value:string|undefined,days:number):string|undefined
export function timelineDateEdit(record:WorkspaceRecord,mode:'move'|'start'|'end'|'place',deltaDays:number,targetDay?:string):TimelineDateEdit|null
export function timelinePlanEdit(plan:PlanSession,mode:'move'|'start'|'end',deltaDays:number):{id:string;start:string;end:string}|null
export function zoomTimelineRange(anchor:Date|string,days:number,delta:number,pointerFraction?:number,pointerDay?:number):{anchor:string;days:number}
