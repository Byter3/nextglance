export interface DateCanvasState {anchor:string;visibleDays:number;renderDays:number;paddingDays:number;scrollLeft:number;dayWidth:number}
export function createDateCanvas(input:{anchor:string;visibleDays:number;dayWidth:number}):DateCanvasState
export function panDateCanvas(state:DateCanvasState,delta:number):DateCanvasState
export function dateCanvasAnchor(state:DateCanvasState):string
export function positionDateCanvas(input:{anchor:string;visibleDays:number;dayWidth:number},offset:number):DateCanvasState
export function touchCoastStep(input:{vx:number;vy:number;elapsed?:number;dt:number;reducedMotion?:boolean}):{dx:number;dy:number;vx:number;vy:number;elapsed:number;done:boolean}
