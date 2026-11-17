import {computed,onScopeDispose,shallowRef,watch} from 'vue'
import {createDateCanvas,dateCanvasAnchor,panDateCanvas,positionDateCanvas} from '@nextspace/core/date-canvas.mjs'

/** Presentation adapter: scroll is local; parent data ranges change only after settling. */
export function useDateCanvas(input:()=>{anchor:string;visibleDays:number;dayWidth:number;scope:string},publish:(anchor:string)=>void){
  const state=shallowRef(createDateCanvas(input()))
  let published:string|undefined,timer:ReturnType<typeof setTimeout>|undefined
  function settle(){clearTimeout(timer);timer=undefined;const anchor=dateCanvasAnchor(state.value);published=anchor;publish(anchor)}
  function pan(delta:number){if(!delta)return;state.value=panDateCanvas(state.value,delta);clearTimeout(timer);timer=setTimeout(settle,160)}
  function setScroll(left:number){pan(left-state.value.scrollLeft)}
  // Zoom returns an absolute offset in its new visible range, never a delta.
  function position(offset:number){clearTimeout(timer);timer=undefined;state.value=positionDateCanvas(input(),offset)}
  watch(input,(next,previous)=>{
    const own=next.anchor===published&&next.visibleDays===previous.visibleDays&&next.scope===previous.scope&&next.dayWidth===previous.dayWidth
    published=undefined
    if(own||next.anchor===previous.anchor&&next.visibleDays===previous.visibleDays&&next.scope===previous.scope&&next.dayWidth===previous.dayWidth)return
    clearTimeout(timer);timer=undefined;state.value=createDateCanvas(next)
  })
  onScopeDispose(()=>clearTimeout(timer))
  return {state,anchor:computed(()=>state.value.anchor),renderDays:computed(()=>state.value.renderDays),scrollLeft:computed(()=>state.value.scrollLeft),pan,setScroll,settle,position}
}
