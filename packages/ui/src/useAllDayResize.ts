import {onBeforeUnmount,ref} from 'vue'

/** Pointer/keyboard adapter; the pure calendar sizing rule owns all bounds. */
export function useAllDayResize(size:()=>{height:number;minimum:number;maximum:number},start:()=>void){
  const manualHeight=ref<number|null>(null),active=ref(false)
  let gesture:{pointerId:number;target:HTMLElement;y:number;height:number;previous:number|null}|undefined
  const clamp=(height:number)=>Math.max(size().minimum,Math.min(size().maximum,height))
  function release(){const current=gesture;gesture=undefined;active.value=false;document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',finish,true);document.removeEventListener('pointercancel',cancel,true);document.removeEventListener('pointerdown',second,true);document.removeEventListener('keydown',escape,true);if(current?.target.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId)}
  function cancel(){if(!gesture)return;manualHeight.value=gesture.previous;release()}
  function reset(){cancel();manualHeight.value=null}
  function move(event:PointerEvent){if(!gesture||gesture.pointerId!==event.pointerId)return;event.preventDefault();event.stopPropagation();manualHeight.value=clamp(gesture.height+event.clientY-gesture.y)}
  function finish(event:PointerEvent){if(!gesture||gesture.pointerId!==event.pointerId)return;move(event);release()}
  function second(event:PointerEvent){if(gesture&&gesture.pointerId!==event.pointerId)cancel()}
  function escape(event:KeyboardEvent){if(event.key==='Escape'&&gesture){event.preventDefault();event.stopImmediatePropagation();cancel()}}
  function begin(event:PointerEvent){
    if(event.button!==0||event.isPrimary===false||gesture||(event.target as HTMLElement).closest('button'))return
    event.preventDefault();event.stopPropagation();start()
    const target=event.currentTarget as HTMLElement
    gesture={pointerId:event.pointerId,target,y:event.clientY,height:size().height,previous:manualHeight.value};active.value=true;target.focus();target.setPointerCapture(event.pointerId)
    document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',finish,true);document.addEventListener('pointercancel',cancel,true);document.addEventListener('pointerdown',second,true);document.addEventListener('keydown',escape,true)
  }
  function keyboard(event:KeyboardEvent){
    if(event.key==='Home'){event.preventDefault();reset()}
    else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();start();manualHeight.value=clamp(size().height+(event.key==='ArrowDown'?16:-16))}
  }
  onBeforeUnmount(cancel)
  return {manualHeight,active,begin,keyboard,cancel,reset}
}
