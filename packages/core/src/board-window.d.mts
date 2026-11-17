export interface BoardStackPosition {id:string;index:number;top:number;height:number;bottom:number}
export interface BoardStackLayout {items:BoardStackPosition[];totalHeight:number}
export function boardStackLayout(ids:string[],heights?:Record<string,number>,estimate?:number,gap?:number):BoardStackLayout
export function boardStackWindow(layout:BoardStackLayout,options?:{top?:number;height?:number;overscan?:number;retainIds?:string[]}):BoardStackPosition[]
export function boardAnchorAdjustment(before:BoardStackLayout,after:BoardStackLayout,top:number):number
export function boardEdgeScroll(position:number,start:number,end:number,edge?:number,speed?:number):number
