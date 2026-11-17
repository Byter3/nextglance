export interface FloatingTimelineEntry {id:string;start:number;end:number;left:number;width:number;lane:number;overflow:boolean}
export interface FloatingTimelineViewport {scrollLeft:number;viewportWidth:number;dayWidth:number;scrollTop:number;headerHeight?:number}
export interface FloatingTimelineProjection {items:{id:string;left:number;width:number;lane:number}[];overflowIds:string[];height:number}
export function timelineFloatingProjection(entries:FloatingTimelineEntry[],viewport:FloatingTimelineViewport):FloatingTimelineProjection
export function timelineFloatingPreview(range:{start:number;end:number}|null,viewport:Omit<FloatingTimelineViewport,'scrollTop'>):{left:number;width:number}|null
