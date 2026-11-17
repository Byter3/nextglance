export type CreationRange = {start:string;end:string;allDay:boolean;origin:'timeline'|'calendar';recordId?:string}
export type CreationSelection = {startOffset:number;endOffset:number;range:CreationRange}
export function creationSelection(anchor:string|Date,from:number,to:number,options?:{daysCount?:number;timed?:boolean;dragged?:boolean;origin?:CreationRange['origin'];recordId?:string}):CreationSelection
