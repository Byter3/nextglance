/** One-shot presentation work after the current render and a frame opportunity.
 * Ports make cancellation and queue ordering testable without a browser. */
export function createAfterPaint({afterRender,requestFrame,cancelFrame,schedule,cancelScheduled}) {
  let generation=0,frame=null,timer=null,disposed=false
  function cancel(){
    generation++
    if(frame!==null)cancelFrame(frame)
    if(timer!==null)cancelScheduled(timer)
    frame=null;timer=null
  }
  function run(work){
    cancel()
    if(disposed)return
    const token=generation
    afterRender(()=>{
      if(disposed||token!==generation)return
      frame=requestFrame(()=>{
        frame=null
        if(disposed||token!==generation)return
        timer=schedule(()=>{
          timer=null
          if(!disposed&&token===generation)work()
        })
      })
    })
  }
  return {run,cancel,dispose(){disposed=true;cancel()}}
}
