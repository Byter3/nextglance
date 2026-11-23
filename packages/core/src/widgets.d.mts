import type {WidgetCalendarGrid} from './widget-calendar.mjs'
import type {State,WorkspaceRecord,Collection,Relation,PlannerSettings,PlannerView} from '@nextspace/contracts'
export interface WidgetConfig {
  version:1;widgetId:number;accountKey:string;generation:number;title:string;page:PlannerView;scopeId:string
  sourceMode:'all'|'selected';collectionIds:string[];kinds:('event'|'task'|'card')[];statusIds:string[];projectIds:string[];tagNames:string[]
  assignment:'all'|'me';includeUnassigned:boolean;showCompleted:boolean;query:string;dateRange:'all'|'today'|'week'|'month'|'overdue'
  groupLinkedTasks:boolean;groupBy:'date'|'source'|'project'|'status'|'none'|'planner';sort:'date'|'title';calendarLayout:'agenda'|'day'|'week'|'month'
  transparency:number;density:'compact'|'comfortable';theme:'system'|'light'|'dark'
  creationDefaults:Partial<Record<'event'|'task'|'card',{collectionId:string;stackId?:string}>>
}
export interface WidgetProjectionOptions {accountKey:string;now:Date|string|number;timeZone?:string;locale?:string;generatedAt?:string;metadataVerifiedAt?:string;sourceRevision?:string|number;metadataRevision?:string|number;acknowledgedEditWatermark?:string|number}
export interface WidgetRow {type:'heading'|'item';id:string;title:string;subtitle:string;color?:string;recordId?:string;kind?:'event'|'task'|'card';source?:string;collectionId?:string;completed?:boolean;depth?:number;dateLabel?:string;dateKey?:string;leadingLabel?:string;secondaryLabel?:string;trailingLabel?:string;sectionCount?:number;displayDay?:string;start?:string;end?:string;due?:string;allDay?:boolean;statusId?:string;statusLabel?:string;parentId?:string;direction?:'incoming'|'outgoing';rangeStartDay?:string;rangeEndDay?:string;timeline?:{offset:number;length:number}}
export interface WidgetDependencies {
  edges:{prerequisiteId:string;dependentId:string}[]
  counts:{recordId:string;prerequisites:number;dependents:number}[]
}
export interface WidgetSnapshot {version:1;widgetId:number;accountKey:string;generation:number;page:PlannerView;scopeId:string;title:string;state:'ready'|'empty'|'unavailable';message?:string;generatedAt:string;sourceVerifiedAt?:string;metadataVerifiedAt?:string;rows:WidgetRow[];totalCount:number;truncated:boolean;fingerprint:string;contextLabel?:string;calendarGrid?:WidgetCalendarGrid;overviewRangeIds?:string[];overview?:{bookings:number;work:number};timelineAxis?:{start:string;end:string;label:string;ticks:{offset:number;label:string}[]};dependencies?:WidgetDependencies;month?:{year:number;month:number;label:string;weekdays:string[];cells:{date:string;day:number;count:number;today:boolean;inMonth:boolean;itinerary?:number[]}[];itineraryRows?:WidgetRow[]};sourceRevision?:string|number;metadataRevision?:string|number;acknowledgedEditWatermark?:string|number}
export interface WidgetCatalog {version:1;accountKey:string;spaces:{id:string;title:string}[];defaults?:Record<PlannerView,WidgetConfig>;sources:{id:string;title:string;source:string;kind:string;color:string;readonly:boolean;scopeIds:string[];stacks?:{id:string;title:string}[]}[];statuses:{id:string;title:string;color:string;scopeId:string}[];projects:{id:string;title:string;spaceId:string}[];tags:{title:string;color?:string}[]}
export interface WidgetContext {ok:boolean;message?:string;config:WidgetConfig|null;settings:PlannerSettings;records:WorkspaceRecord[];collections:Collection[];relations:Relation[];query:string;statusIds:string[];boardGroupTasks:boolean;calendarMode:'day'|'week'|'month';scopeTitle?:string}
export interface WidgetIntent {widgetId:number;accountKey:string;generation:number;action:'open'|'create'|'item'|'date';recordId?:string;date?:string;kind?:'event'|'task'|'card'}
export interface WidgetIntentResult {ok:boolean;message?:string;action?:WidgetIntent['action'];page?:PlannerView;scopeId?:string;recordId?:string;date?:string;kind?:'event'|'task'|'card';collectionId?:string;stackId?:string;config?:WidgetConfig;context?:WidgetContext}
export function normalizeWidgetConfig(input?:unknown,identity?:{widgetId?:number;accountKey?:string}):WidgetConfig|null
export function widgetCatalog(state:State,options:{accountKey:string}):WidgetCatalog
export function widgetPlannerContext(state:State,config:unknown,options:WidgetProjectionOptions):WidgetContext
export function projectWidget(state:State,config:unknown,options:WidgetProjectionOptions):WidgetSnapshot
export function projectWidgets(state:State,configs:unknown[],options:WidgetProjectionOptions):WidgetSnapshot[]
export function validateWidgetIntent(intent:unknown,config:unknown,state:State,options:WidgetProjectionOptions):WidgetIntentResult

export interface WidgetNavigation {page:PlannerView;scopeId:string;recordId?:string;date?:string;calendarMode?:'day'}
export function widgetNavigation(result:WidgetIntentResult):WidgetNavigation|null
