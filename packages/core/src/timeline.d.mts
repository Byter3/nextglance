import type {Category, Collection, Project, Space, WorkspaceRecord} from '@nextspace/contracts'
export interface TimelineGroup { id:string; name:string; kind:'space'|'category'|'project'|'collection'; color?:string; depth:number; records:WorkspaceRecord[]; children:TimelineGroup[]; count:number; source?:string; collectionIds:string[]; spaceId?:string; categoryId?:string; projectId?:string }
export interface GroupingOptions {spaces?:Space[];categories?:Category[];projects?:Project[];collections?:Collection[];scopeId?:string}
export function recordGrouping(record:WorkspaceRecord,options?:GroupingOptions):{space?:Space;category?:Category;project?:Project}
export interface TimelineInterval {start:number;end:number;clippedStart:boolean;clippedEnd:boolean}
export function timelineOffset(value:string|Date|undefined,anchor:Date|string):number
export function timelineInterval(start:string,end:string,anchor:Date|string,daysCount?:number):TimelineInterval|null
export function timelineGeometry(record:WorkspaceRecord,anchor:Date|string,daysCount?:number):{bar:TimelineInterval|null;point:{offset:number;kind:string}|null;scheduled:boolean;visible:boolean}
export function timelineGroups(records:WorkspaceRecord[],options?:GroupingOptions):TimelineGroup[]
export function timelineStatus(record:WorkspaceRecord,collections?:Collection[]):string
export interface TimelineEvent {record:WorkspaceRecord;range:TimelineInterval;labelLeft:number;labelWidth:number;lane:number;overflow:boolean}
export function indexTimelineEvents(records:WorkspaceRecord[]):(anchor:Date|string,daysCount:number)=>WorkspaceRecord[]
export function timelineEvents(records:WorkspaceRecord[],anchor:Date|string,daysCount?:number,plotWidth?:number,maxLanes?:number):{entries:TimelineEvent[];lanes:number;overflow:TimelineEvent[]}
export function timelineDayEvents(events:TimelineEvent[],daysCount:number):TimelineEvent[][]
