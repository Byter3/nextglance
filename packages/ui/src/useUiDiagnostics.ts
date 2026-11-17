import {nextTick,onBeforeUnmount,onMounted} from 'vue'
import type {DiagnosticInput,WorkspaceApi} from '@nextspace/contracts'

// View-only measurements. The pure host recorder validates and bounds the log.
export function useUiDiagnostics(api:WorkspaceApi){
  let frame=0,active=false,last=0,windowStart=0,frames=0,slow=0,maxDelay=0,scrolls=0,generation=0
  const pending=new Set<number>()
  type Action='page'|'panel'
  const intents=new Map<Action,number>()
  const actions:Record<Action,number>={page:0,panel:0}
  function reset(){last=0;windowStart=performance.now();frames=0;slow=0;maxDelay=0;scrolls=0}
  function flush(time:number){
    if(frames)api.recordDiagnostic?.({kind:'ui',stage:'frame',durationMs:time-windowStart,frames,count:slow,maxDelayMs:maxDelay})
    if(scrolls)api.recordDiagnostic?.({kind:'ui',stage:'scroll',durationMs:time-windowStart,count:scrolls})
    frames=0;slow=0;maxDelay=0;scrolls=0;windowStart=time
  }
  function tick(time:number){if(!active)return;if(!api.getDiagnostics?.().recording||document.hidden){sync();return}if(last){const delay=time-last;frames++;if(delay>50)slow++;maxDelay=Math.max(maxDelay,delay)}last=time;if(time-windowStart>=1000)flush(time);frame=requestAnimationFrame(tick)}
  function sync(){const enabled=Boolean(api.getDiagnostics?.().recording)&&!document.hidden;if(enabled===active)return;active=enabled;generation++;cancelAnimationFrame(frame);pending.forEach(cancelAnimationFrame);pending.clear();intents.clear();if(active){reset();frame=requestAnimationFrame(tick)}else reset()}
  function scroll(){if(active)scrolls++}
  // Call before synchronous selection preparation; cancel if navigation is refused.
  function markIntent(stage:Action){
    if(!api.getDiagnostics?.().recording||document.hidden)return()=>{}
    const start=performance.now();intents.set(stage,start)
    return()=>{if(intents.get(stage)===start)intents.delete(stage)}
  }
  function measure(stage:Action,page:DiagnosticInput['page']){
    if(!api.getDiagnostics?.().recording||document.hidden)return
    const start=intents.get(stage)??performance.now(),token=generation,action=++actions[stage]
    intents.delete(stage)
    const current=()=>token===generation&&action===actions[stage]&&!document.hidden&&Boolean(api.getDiagnostics?.().recording)
    const afterFrame=(callback:()=>void)=>{const id=requestAnimationFrame(()=>{pending.delete(id);if(current())callback()});pending.add(id)}
    // Two frame opportunities include DOM/layout work after the first callback.
    // This remains a UI latency estimate; it is not GPU or temperature telemetry.
    void nextTick().then(()=>{if(current())afterFrame(()=>afterFrame(()=>api.recordDiagnostic?.({kind:'ui',stage,page,durationMs:performance.now()-start,count:1})))})
  }
  onMounted(()=>{if(!api.recordDiagnostic)return;window.addEventListener('nextspace:diagnostics',sync);document.addEventListener('visibilitychange',sync);document.addEventListener('scroll',scroll,{capture:true,passive:true});sync()})
  onBeforeUnmount(()=>{active=false;generation++;cancelAnimationFrame(frame);pending.forEach(cancelAnimationFrame);window.removeEventListener('nextspace:diagnostics',sync);document.removeEventListener('visibilitychange',sync);document.removeEventListener('scroll',scroll,true)})
  return {measure,markIntent}
}
