export function horizontalWheelDelta(event: {ctrlKey?:boolean;metaKey?:boolean;shiftKey?:boolean;deltaX?:number;deltaY?:number;deltaMode?:number},pageSize?:number):number
export function horizontalScrollLimit(element:{scrollLeft:number;scrollWidth:number}):number
export function createDateWheel(): {
  reset():void
  consume(delta:number,options?:{scrollLeft?:number;maxScroll?:number;dayWidth?:number;now?:number}):{scrollLeft:number;days:number}
}
