import type {WorkspaceRecord} from '@nextspace/contracts'
export interface RecordDateDraft {start:string;end:string;allDay:boolean}
export interface RecordDatePayload {start:string;due?:string;end?:string;allDay?:boolean}
export function recordDateDraft(record:WorkspaceRecord):RecordDateDraft
export function recordDatePayload(record:WorkspaceRecord,draft:RecordDateDraft):RecordDatePayload
export function selectRecordDateRange(record:WorkspaceRecord,draft:RecordDateDraft,first:string,last:string):RecordDateDraft
export function dragRecordDateDraft(record:WorkspaceRecord,draft:RecordDateDraft,mode:'move'|'start'|'end',offset:number):RecordDateDraft
export function recordDateDayOffset(day:string,anchor:string):number
export function recordDateGeometry(record:WorkspaceRecord,anchor:string,count?:number):{left:number;width:number;clippedStart:boolean;clippedEnd:boolean}|null
