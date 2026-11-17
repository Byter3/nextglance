/** A presentation queue: one adoption at a time and only the newest waiting
 * snapshot. The adopter captures its acknowledged baseline when it runs. */
export function createLatestPublication({schedule,cancelScheduled,canAdopt=()=>true,adopt,onError=()=>{}}){
  let pending,scheduled,active=false,disposed=false
  function resume(){
    if(disposed||active||scheduled!==undefined||pending===undefined||!canAdopt())return
    scheduled=schedule(()=>{scheduled=undefined;void drain()})
  }
  async function drain(){
    if(disposed||active||pending===undefined||!canAdopt())return
    const value=pending;pending=undefined;active=true
    try{await adopt(value)}catch(error){if(!disposed)onError(error)}finally{active=false;resume()}
  }
  function clear(){pending=undefined;if(scheduled!==undefined)cancelScheduled(scheduled);scheduled=undefined}
  return {offer(value){if(disposed)return;pending=value;resume()},hasPending(){return pending!==undefined},resume,clear,dispose(){disposed=true;clear()}}
}
