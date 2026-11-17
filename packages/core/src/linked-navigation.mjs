/** Resolve explicit linked-item navigation without changing scope or filters. */
export function linkedNavigation({recordId,records,visibleIds,currentView,destination}){
  const record=records.find(item=>item.id===recordId)
  if(!record)return {ok:false,message:'This linked item is not loaded. Refresh its source and try again.'}
  if(!['task','card','event'].includes(record.kind))return {ok:false,message:'This item does not have a calendar or timeline position.'}
  const view=['overview','calendar','timeline'].includes(currentView)?currentView:destination
  if(!['overview','calendar','timeline'].includes(view))return {ok:false,message:'Choose Calendar or Timeline to jump to this item.'}
  if(!visibleIds.includes(record.id))return {ok:false,message:'This item is outside this view’s sources or hidden by its filters. Adjust the Space or filters to reveal it.'}
  const date=[record.start,record.kind==='event'?record.end:record.due].find(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
  return {ok:true,view,...(date?{date}:{}),unscheduled:!date}
}
