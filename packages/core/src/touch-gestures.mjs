import {shiftTimelineDate} from './timeline-edit.mjs'

export const TOUCH_SLOP = 8
export const TOUCH_HOLD_MS = 500
export const touchGestureState = () => ({mode:'idle',points:[]})
const center = points => ({x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2})
const distance = points => Math.max(1,Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y))
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value))
const separation=points=>({x:Math.abs(points[0].x-points[1].x),y:Math.abs(points[0].y-points[1].y)})

/** Near-aligned fingers and small incidental movement never activate an axis. */
export function touchPinchAxes(start,current,active={xActive:false,yActive:false}){
  const xActive=start.x>=24&&(active.xActive||Math.abs(current.x-start.x)>TOUCH_SLOP)
  const yActive=start.y>=24&&(active.yActive||Math.abs(current.y-start.y)>TOUCH_SLOP)
  return {xScale:xActive?Math.max(.01,current.x/start.x):1,yScale:yActive?Math.max(.01,current.y/start.y):1,xActive,yActive}
}

/** Pure pointer classification. Timers, capture and native edit effects belong to adapters. */
export function reduceTouchGesture(previous,event){
  let state={...previous,points:previous.points.map(point=>({...point}))}
  const effects=[]
  if(event.type==='cancel')return {state:touchGestureState(),effects:[{type:'cancelEdit'},{type:'suppressClick'}]}
  if(event.type==='hold'){
    if(state.mode==='pending'&&event.eligible&&event.now-state.startedAt>=TOUCH_HOLD_MS){state.mode='armed-edit';effects.push({type:'arm'})}
    return {state,effects}
  }
  const point={id:event.id,x:event.x,y:event.y}
  if(!Number.isFinite(point.id)||!Number.isFinite(point.x)||!Number.isFinite(point.y))return {state,effects}
  const index=state.points.findIndex(value=>value.id===point.id)
  if(event.type==='down'){
    if(index>=0)return {state,effects}
    state.points.push(point)
    if(state.points.length===1){state={mode:'pending',points:[point],origin:point,last:point,startedAt:event.now};return {state,effects}}
    effects.push({type:'cancelEdit'},{type:'suppressClick'})
    if(state.points.length===2&&state.mode!=='suppressed'){
      state.mode='pinch';state.pinch={center:center(state.points),distance:distance(state.points),separation:separation(state.points),axes:{xScale:1,yScale:1,xActive:false,yActive:false}}
      effects.push({type:'pinchStart',center:state.pinch.center})
    }else state.mode='suppressed'
    return {state,effects}
  }
  if(index<0)return {state,effects}
  state.points[index]=point
  if(event.type==='move'){
    if(state.mode==='pending'&&Math.hypot(point.x-state.origin.x,point.y-state.origin.y)>TOUCH_SLOP){state.mode='pan';state.last=state.origin}
    if(state.mode==='pan')effects.push({type:'pan',dx:point.x-state.last.x,dy:point.y-state.last.y},{type:'suppressClick'})
    if(state.mode==='pinch'){
      const axes=touchPinchAxes(state.pinch.separation||{x:0,y:0},separation(state.points),state.pinch.axes)
      state.pinch={...state.pinch,axes}
      effects.push({type:'pinch',scale:distance(state.points)/state.pinch.distance,center:center(state.points),axes},{type:'suppressClick'})
    }
    if(state.mode==='armed-edit')effects.push({type:'editMove',point},{type:'suppressClick'})
    state.last=point
  }else if(event.type==='up'){
    if(state.mode==='pending')effects.push({type:'tap',point})
    if(state.mode==='pan')effects.push({type:'panEnd'},{type:'suppressClick'})
    if(state.mode==='armed-edit')effects.push({type:'editEnd',point},{type:'suppressClick'})
    if(state.mode==='pinch'||state.mode==='suppressed')effects.push({type:'suppressClick'})
    state.points.splice(index,1)
    state=state.points.length?{...state,mode:'suppressed'}:touchGestureState()
  }
  return {state,effects}
}

/** Fixed gesture-start geometry prevents cumulative pinch rounding drift. */
export function touchTimelineZoom({anchor,days,scale,dayAtCenter,centerPixel,viewportWidth,minimumDayWidth=12,continuous=false}){
  const nextDays=clamp(Math.round(days/Math.max(.01,scale)),1,90)
  const width=Math.max(minimumDayWidth,viewportWidth/nextDays)
  const overflow=Math.max(0,width*nextDays-viewportWidth),offset=dayAtCenter-centerPixel/width
  const shift=continuous||overflow>1?Math.floor(offset):Math.round(offset)
  return {anchor:shiftTimelineDate(anchor,shift),days:nextDays,scrollLeft:continuous?(offset-shift)*width:clamp((dayAtCenter-shift)*width-centerPixel,0,overflow)}
}

export function touchHourZoom({height,scrollTop,startY,centerY,scale,viewportHeight}){
  const next=clamp(height*scale,24,144)
  return {height:next,scrollTop:clamp((scrollTop+startY)/height*next-centerY,0,Math.max(0,next*24-viewportHeight))}
}

/** Standalone Day/Week density is independent of its navigation preset. */
export function touchCalendarDateZoom({anchor,dayWidth,scale,dayAtCenter,centerPixel,viewportWidth}){
  const width=clamp(dayWidth*Math.max(.01,scale),Math.max(12,viewportWidth/90),1440)
  const visibleDays=clamp(Math.ceil(viewportWidth/width),1,90)
  const offset=dayAtCenter-centerPixel/width,shift=Math.floor(offset)
  return {anchor:shiftTimelineDate(anchor,shift),dayWidth:width,visibleDays,scrollLeft:(offset-shift)*width}
}
