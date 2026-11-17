import {onBeforeUnmount, ref, watchEffect, type Ref} from 'vue'
import {listReorderTarget,listReorderPhase,reorderIds} from '@nextspace/core/planning-order.mjs'

export type ListReorderItem={id:string;group:string;element:HTMLElement}
export type ListReorderIntent={id:string;targetId:string;placement:'before'|'after';group:string}
export type ListReorderPoint={id:string;sourceGroup:string;x:number;y:number}
export type ListReorderVisual=ListReorderPoint & {startX:number;startY:number;element:HTMLElement}
type Options={canReorder:()=>boolean;items:()=>ListReorderItem[];commit:(intent:ListReorderIntent)=>void;onStart?:()=>void;onVisual?:(point:ListReorderVisual|null)=>void;pan?:(dx:number,dy:number)=>void;onMoveOther?:(point:ListReorderPoint|null)=>boolean;onDropOther?:(point:ListReorderPoint)=>boolean}

/** Pointer/focus adapter for draggable item bodies. Ordering stays in portable core. */
export function useListReorder(root:Ref<HTMLElement|undefined>,options:Options){
  const active=ref(false),marker=ref<Omit<ListReorderIntent,'id'>|null>(null)
  let pending:{id:string;group:string;pointer:number;x:number;y:number;lastX:number;lastY:number;target:HTMLElement;pointerType:string;started:number;moved:boolean;panning:boolean}|undefined
  let hold:ReturnType<typeof setTimeout>|undefined,frame:number|undefined,lastX=0,lastY=0,suppressClickUntil=0
  const eligible=()=>Boolean(pending&&options.canReorder()&&options.items().some(item=>item.id===pending!.id&&item.group===pending!.group))
  const clearHold=()=>{clearTimeout(hold);hold=undefined}
  function cancel(suppress=Boolean(pending&&(pending.panning||active.value&&pending.moved))){
    if(suppress)suppressClickUntil=Date.now()+700
    clearHold();if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined
    const current=pending;pending=undefined;active.value=false;marker.value=null
    options.onMoveOther?.(null);options.onVisual?.(null)
    if(current?.target.hasPointerCapture(current.pointer))current.target.releasePointerCapture(current.pointer)
    document.removeEventListener('pointerdown',secondPointer,true);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',pointerCancel,true);document.removeEventListener('lostpointercapture',lost,true);document.removeEventListener('keydown',escape,true);document.removeEventListener('contextmenu',contextMenu,true)
  }
  function updateMarker(){
    frame=undefined;if(!pending||!eligible()){cancel();return}
    options.onVisual?.({id:pending.id,sourceGroup:pending.group,x:lastX,y:lastY,startX:pending.x,startY:pending.y,element:pending.target})
    if(pending.moved&&options.onMoveOther?.({id:pending.id,sourceGroup:pending.group,x:lastX,y:lastY})){marker.value=null;return}
    const rects=options.items().filter(item=>item.group===pending!.group).map(item=>{const bounds=item.element.getBoundingClientRect();return {id:item.id,group:item.group,top:bounds.top,bottom:bounds.bottom,left:bounds.left,right:bounds.right}})
    const target=listReorderTarget(rects,pending.group,pending.id,lastY,lastX)
    const next=target&&pending.moved?{...target,group:pending.group}:null
    if(next?.targetId!==marker.value?.targetId||next?.placement!==marker.value?.placement||next?.group!==marker.value?.group)marker.value=next
  }
  function capture(){if(pending)try{pending.target.setPointerCapture(pending.pointer)}catch{}}
  function arm(){if(!eligible()){cancel();return}active.value=true;capture();options.onStart?.();updateMarker()}
  function begin(event:PointerEvent,id:string,group:string){
    if(event.button!==0||!options.canReorder()||(event.pointerType==='touch'&&event.isPrimary===false))return
    cancel();suppressClickUntil=0;const target=event.currentTarget as HTMLElement
    if(!options.items().some(item=>item.id===id&&item.group===group))return
    // CSS disables selection/touch browser panning; leave the native tap/click
    // and focus behavior intact until a deliberate move actually activates.
    event.stopPropagation()
    pending={id,group,pointer:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,target,pointerType:event.pointerType,started:Date.now(),moved:false,panning:false};lastX=event.clientX;lastY=event.clientY
    document.addEventListener('pointerdown',secondPointer,true);document.addEventListener('pointermove',move,{capture:true,passive:false});document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',pointerCancel,true);document.addEventListener('lostpointercapture',lost,true);document.addEventListener('keydown',escape,true);document.addEventListener('contextmenu',contextMenu,true)
    if(pending.pointerType==='touch')hold=setTimeout(()=>{if(pending&&listReorderPhase({pointerType:pending.pointerType,elapsed:Date.now()-pending.started,distance:0})==='active')arm()},500)
  }
  function move(event:PointerEvent){
    if(!pending||event.pointerId!==pending.pointer)return
    if(!eligible()){cancel();return}
    event.preventDefault();event.stopPropagation();lastX=event.clientX;lastY=event.clientY
    const distance=Math.hypot(event.clientX-pending.x,event.clientY-pending.y)
    pending.moved ||= listReorderPhase({pointerType:'mouse',elapsed:0,distance})==='active'
    if(!active.value&&!pending.panning){const phase=listReorderPhase({pointerType:pending.pointerType,elapsed:Date.now()-pending.started,distance});if(phase==='pan'){clearHold();pending.panning=true;capture()}else if(phase==='active')arm()}
    if(pending.panning){const dx=pending.lastX-event.clientX,dy=pending.lastY-event.clientY;if(options.pan)options.pan(dx,dy);else if(root.value){root.value.scrollLeft+=dx;root.value.scrollTop+=dy}}
    else if(active.value&&frame===undefined)frame=requestAnimationFrame(updateMarker)
    pending.lastX=event.clientX;pending.lastY=event.clientY
  }
  function end(event:PointerEvent){
    if(!pending||event.pointerId!==pending.pointer)return
    const controlled=pending.panning||active.value&&pending.moved
    if(controlled){event.preventDefault();event.stopPropagation()}
    if(active.value){lastX=event.clientX;lastY=event.clientY;updateMarker()}
    const outside=pending&&pending.moved&&active.value&&eligible()?{id:pending.id,sourceGroup:pending.group,x:lastX,y:lastY}:null
    const intent=pending&&pending.moved&&active.value&&marker.value&&eligible()?{id:pending.id,...marker.value}:null
    const ids=intent?options.items().filter(item=>item.group===intent.group).map(item=>item.id):[]
    const changed=intent&&reorderIds([],ids,intent.id,intent.targetId,intent.placement).some((id,index)=>id!==ids[index])
    cancel(controlled)
    if(outside&&options.onDropOther?.(outside))return
    if(intent&&changed)options.commit(intent)
  }
  function secondPointer(event:PointerEvent){if(pending&&event.pointerId!==pending.pointer){event.preventDefault();event.stopImmediatePropagation();cancel(true)}}
  function pointerCancel(event:PointerEvent){if(event.pointerId===pending?.pointer)cancel(true)}
  function lost(event:PointerEvent){if(event.pointerId===pending?.pointer&&!pending.target.hasPointerCapture(event.pointerId))cancel(true)}
  function escape(event:KeyboardEvent){if(event.key==='Escape'&&pending){event.preventDefault();event.stopPropagation();cancel(true)}}
  function contextMenu(event:Event){if(pending){event.preventDefault();event.stopPropagation()}}
  function keydown(event:KeyboardEvent,id:string,group:string){
    if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key)||!options.canReorder())return
    event.preventDefault();event.stopPropagation();cancel()
    const items=options.items().filter(item=>item.group===group),index=items.findIndex(item=>item.id===id),target=items[index+(event.key==='ArrowUp'?-1:1)]
    if(index>=0&&target)options.commit({id,targetId:target.id,group,placement:event.key==='ArrowUp'?'before':'after'})
  }
  watchEffect(()=>{if(active.value&&!options.canReorder())cancel()})
  function captureClick(event:MouseEvent){if(event.detail&&Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();suppressClickUntil=0}}
  onBeforeUnmount(()=>cancel())
  return {active,marker,begin,keydown,cancel,captureClick}
}
