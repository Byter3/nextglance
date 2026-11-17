import type {WorkspaceRecord} from '@nextspace/contracts'
import type {TimelineGroup} from './timeline.mjs'
export function visibleSpanLabel(input:{start:number;end:number;viewportStart:number;viewportEnd:number;padding?:number}):{offset:number;width:number}|null
export function timelinePointLabel(input:{point:number;viewportStart:number;viewportEnd:number;maxWidth?:number}):{offset:number;width:number}|null
export type CollapsedTimelineSpan={record:WorkspaceRecord;start:number;end:number;point:boolean;lane:number}
export function collapsedTimelineSpans(group:Pick<TimelineGroup,'records'|'children'>,anchor:Date,daysCount:number):{spans:CollapsedTimelineSpan[];lanes:number}
