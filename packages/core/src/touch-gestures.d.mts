export interface TouchPoint {id:number;x:number;y:number}
export interface TouchPinchAxes {xScale:number;yScale:number;xActive:boolean;yActive:boolean}
export interface TouchGestureState {mode:'idle'|'pending'|'pan'|'pinch'|'armed-edit'|'suppressed';points:TouchPoint[];origin?:TouchPoint;last?:TouchPoint;startedAt?:number;pinch?:{center:{x:number;y:number};distance:number;separation?:{x:number;y:number};axes?:TouchPinchAxes}}
export type TouchGestureEvent={type:'down'|'move'|'up';id:number;x:number;y:number;now:number}|{type:'hold';now:number;eligible:boolean}|{type:'cancel'}
export type TouchEffect={type:'pan';dx:number;dy:number}|{type:'pinchStart';center:{x:number;y:number}}|{type:'pinch';scale:number;center:{x:number;y:number};axes?:TouchPinchAxes}|{type:'editMove'|'editEnd'|'tap';point:TouchPoint}|{type:'arm'|'panEnd'|'cancelEdit'|'suppressClick'}
export const TOUCH_SLOP:number
export const TOUCH_HOLD_MS:number
export function touchGestureState():TouchGestureState
export function reduceTouchGesture(state:TouchGestureState,event:TouchGestureEvent):{state:TouchGestureState;effects:TouchEffect[]}
export function touchTimelineZoom(input:{anchor:string;days:number;scale:number;dayAtCenter:number;centerPixel:number;viewportWidth:number;minimumDayWidth?:number;continuous?:boolean}):{anchor:string;days:number;scrollLeft:number}
export function touchHourZoom(input:{height:number;scrollTop:number;startY:number;centerY:number;scale:number;viewportHeight:number}):{height:number;scrollTop:number}
export function touchPinchAxes(start:{x:number;y:number},current:{x:number;y:number},active?:{xActive:boolean;yActive:boolean}):TouchPinchAxes
export function touchCalendarDateZoom(input:{anchor:string;dayWidth:number;scale:number;dayAtCenter:number;centerPixel:number;viewportWidth:number}):{anchor:string;dayWidth:number;visibleDays:number;scrollLeft:number}
