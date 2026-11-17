import {onBeforeUnmount,onMounted,ref,watchEffect,type Ref} from 'vue'
import {reduceTouchGesture,touchGestureState,TOUCH_HOLD_MS,type TouchGestureEvent,type TouchPinchAxes} from '@nextspace/core/touch-gestures.mjs'
import {touchCoastStep} from '@nextspace/core/date-canvas.mjs'

type Point={x:number;y:number}
type Edit={target:HTMLElement;eligible:()=>boolean;arm:()=>void;move:(event:PointerEvent)=>void;end:(event:PointerEvent)=>void;cancel:()=>void}
type Options={eligible:(target:HTMLElement)=>boolean;start?:(event:PointerEvent)=>void;pan:(dx:number,dy:number)=>void;panEnd?:()=>void;pinchStart:(center:Point)=>void;pinch:(scale:number,center:Point,axes?:TouchPinchAxes)=>void;cancel?:()=>void}
let activeOwner:object|null=null
const surfaces=new Map<HTMLElement,Options>()
const normalControl=(target:HTMLElement)=>Boolean(target.closest('input,select,textarea,a,[contenteditable="true"],summary'))||Boolean(target.closest('button')&&!target.closest('.timeline-bar,.timeline-deadline,.timeline-row-label,.timeline-group-label,.timeline-bucket-label,.timeline-event-chip,.timeline-session-link,.timeline-point-handle,.timeline-connector,.calendar-event,.all-day-event,.week-draft'))

/** DOM adapter only: the portable reducer owns classification, thresholds and states. */
export function usePlannerTouch(root:Ref<HTMLElement|undefined>,options:Options){
  const owner={},mode=ref('idle')
  let state=touchGestureState(),candidate:Edit|undefined,tap:(()=>void)|undefined,hold:ReturnType<typeof setTimeout>|undefined
  let initialEvent:PointerEvent|undefined,suppressUntil=0,scope:HTMLElement|undefined
  const captured=new Set<number>()
  let frame:number|undefined,coast:number|undefined,pendingX=0,pendingY=0,pendingPinch:{scale:number;center:Point;axes?:TouchPinchAxes}|undefined
  let velocity={x:0,y:0},sampleTime=0,lastMove=0
  function flush(){if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;if(pendingX||pendingY){options.pan(pendingX,pendingY);pendingX=0;pendingY=0}if(pendingPinch){options.pinch(pendingPinch.scale,pendingPinch.center,pendingPinch.axes);pendingPinch=undefined}}
  function schedule(){if(frame===undefined)frame=requestAnimationFrame(flush)}
  function stopCoast(){if(coast!==undefined)cancelAnimationFrame(coast);coast=undefined}
  function coastPan(){
    flush();stopCoast()
    let vx=Date.now()-lastMove>100?0:velocity.x,vy=Date.now()-lastMove>100?0:velocity.y,elapsed=0,previous=performance.now()
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const advance=(time:number)=>{const next=touchCoastStep({vx,vy,elapsed,dt:time-previous,reducedMotion});previous=time;vx=next.vx;vy=next.vy;elapsed=next.elapsed;if(next.dx||next.dy)options.pan(next.dx,next.dy);if(next.done){coast=undefined;options.panEnd?.()}else coast=requestAnimationFrame(advance)}
    coast=requestAnimationFrame(advance)
  }
  const clearHold=()=>{if(hold)clearTimeout(hold);hold=undefined}
  function release(){for(const id of captured)if(root.value?.hasPointerCapture(id))root.value.releasePointerCapture(id);captured.clear()}
  function markArmed(value:boolean){candidate?.target.classList.toggle('touch-edit-armed',value)}
  function apply(input:TouchGestureEvent,event?:PointerEvent){
    const previous=state.mode,result=reduceTouchGesture(state,input)
    state=result.state;mode.value=state.mode
    if(state.mode==='suppressed'&&previous==='pinch')pendingPinch=undefined
    if(state.mode!=='pending')clearHold()
    const controlled=['pan','pinch','armed-edit','suppressed'].includes(previous)||['pan','pinch','armed-edit','suppressed'].includes(state.mode)
    for(const effect of result.effects){
      if(effect.type==='suppressClick')suppressUntil=Date.now()+700
      else if(effect.type==='pan'){const now=Date.now(),dt=Math.max(8,now-sampleTime);velocity={x:effect.dx/dt,y:effect.dy/dt};sampleTime=now;lastMove=now;pendingX+=effect.dx;pendingY+=effect.dy;schedule()}
      else if(effect.type==='panEnd')coastPan()
      else if(effect.type==='pinchStart'){flush();stopCoast();options.pinchStart(effect.center)}
      else if(effect.type==='pinch'){pendingPinch={scale:effect.scale,center:effect.center,axes:effect.axes};schedule()}
      else if(effect.type==='arm'){if(candidate?.eligible()){markArmed(true);candidate.arm()}else cancel()}
      else if(effect.type==='editMove'&&event){if(candidate?.eligible())candidate.move(event);else cancel()}
      else if(effect.type==='editEnd'&&event){markArmed(false);if(candidate?.eligible())candidate.end(event);else candidate?.cancel()}
      else if(effect.type==='cancelEdit'){markArmed(false);candidate?.cancel()}
      else if(effect.type==='tap'&&tap){tap();suppressUntil=Date.now()+700;event?.preventDefault();event?.stopImmediatePropagation()}
    }
    if(event&&controlled&&previous!=='idle'){event.preventDefault();event.stopImmediatePropagation()}
    if(state.mode==='pan'||state.mode==='pinch')for(const point of state.points){try{root.value?.setPointerCapture(point.id);captured.add(point.id)}catch{}}
    if(state.mode==='idle'){clearHold();release();candidate=undefined;tap=undefined;initialEvent=undefined;if(activeOwner===owner)activeOwner=null}
  }
  function cancel(){clearHold();stopCoast();if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;pendingX=0;pendingY=0;pendingPinch=undefined;markArmed(false);candidate?.cancel();options.cancel?.();state=touchGestureState();mode.value='idle';release();candidate=undefined;tap=undefined;initialEvent=undefined;suppressUntil=Date.now()+700;if(activeOwner===owner)activeOwner=null}
  function down(event:PointerEvent){
    if(event.pointerType!=='touch'||!(event.target instanceof Element)||!root.value)return
    stopCoast()
    if(activeOwner&&activeOwner!==owner)return
    const target=event.target instanceof HTMLElement?event.target:event.target.parentElement
    if(!target)return
    if(activeOwner===owner){
      const surface=target.closest<HTMLElement>('[data-planner-touch-surface]')
      if(!scope?.contains(target)||!surface||normalControl(target)||!surfaces.get(surface)?.eligible(target)){cancel();return}
      apply({type:'down',id:event.pointerId,x:event.clientX,y:event.clientY,now:Date.now()},event)
      return
    }
    if(!root.value.contains(target)||!options.eligible(target)||normalControl(target))return
    activeOwner=owner;scope=root.value.closest<HTMLElement>('.unified-overview')||root.value
    suppressUntil=0;candidate=undefined;tap=undefined;initialEvent=event;velocity={x:0,y:0};sampleTime=Date.now();options.start?.(event)
    apply({type:'down',id:event.pointerId,x:event.clientX,y:event.clientY,now:Date.now()})
    hold=setTimeout(()=>apply({type:'hold',now:Date.now(),eligible:Boolean(candidate?.eligible())}),TOUCH_HOLD_MS)
  }
  function move(event:PointerEvent){if(activeOwner===owner&&state.points.some(point=>point.id===event.pointerId))apply({type:'move',id:event.pointerId,x:event.clientX,y:event.clientY,now:Date.now()},event)}
  function up(event:PointerEvent){if(activeOwner===owner&&state.points.some(point=>point.id===event.pointerId)){flush();apply({type:'up',id:event.pointerId,x:event.clientX,y:event.clientY,now:Date.now()},event)}}
  function cancelled(event:PointerEvent){if(activeOwner===owner&&state.points.some(point=>point.id===event.pointerId))cancel()}
  function lost(event:PointerEvent){
    if(activeOwner!==owner||!state.points.some(point=>point.id===event.pointerId))return
    // A deliberate hold transfers implicit capture from the hit child to the
    // existing edit target. Do not let the view mistake that transfer for loss.
    if(root.value?.hasPointerCapture(event.pointerId)||candidate?.target.hasPointerCapture(event.pointerId)){event.stopImmediatePropagation();return}
    cancelled(event)
  }
  function click(event:MouseEvent){if(event.detail&&Date.now()<suppressUntil&&root.value?.contains(event.target as Node)){event.preventDefault();event.stopImmediatePropagation()}}
  function menu(event:Event){if(activeOwner===owner&&scope?.contains(event.target as Node))event.preventDefault()}
  watchEffect(()=>{if(mode.value==='armed-edit'&&candidate&&!candidate.eligible())cancel()})
  onMounted(()=>{
    if(root.value){root.value.dataset.plannerTouchSurface='';surfaces.set(root.value,options)}
    document.addEventListener('pointerdown',down,true);document.addEventListener('pointermove',move,{capture:true,passive:false});document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancelled,true);document.addEventListener('lostpointercapture',lost,true);document.addEventListener('click',click,true);document.addEventListener('contextmenu',menu,true)
  })
  onBeforeUnmount(()=>{cancel();if(root.value)surfaces.delete(root.value);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',cancelled,true);document.removeEventListener('lostpointercapture',lost,true);document.removeEventListener('click',click,true);document.removeEventListener('contextmenu',menu,true)})
  return {mode,cancel,stopCoast,
    edit(event:PointerEvent,edit:Edit){if(activeOwner===owner&&state.mode==='pending'&&initialEvent?.pointerId===event.pointerId)candidate=edit},
    tap(event:PointerEvent,action:()=>void){if(activeOwner===owner&&state.mode==='pending'&&initialEvent?.pointerId===event.pointerId)tap=action},
  }
}
