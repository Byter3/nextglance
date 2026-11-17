/** Device-local sidebar presentation. The existing inline bit controls rows only. */
export function restoreUnscheduledPresentation(saved,{allowInline=false,defaultInline=false}={}){
  const state={open:true,width:260,inline:allowInline&&defaultInline}
  if(!saved||typeof saved!=='object'||Array.isArray(saved))return state
  if(typeof saved.open==='boolean')state.open=saved.open
  if(Number.isFinite(saved.width)&&saved.width>=120&&saved.width<=520)state.width=saved.width
  if(allowInline&&typeof saved.inline==='boolean')state.inline=saved.inline
  return state
}

/** Showing the sidebar and filtering chart rows are independent intents. */
export function changeUnscheduledPresentation(state,intent){
  if(intent.type==='show')return {...state,open:true}
  if(intent.type==='hide')return {...state,open:false}
  if(intent.type==='inline'&&typeof intent.value==='boolean')return {...state,inline:intent.value}
  if(intent.type==='resize'&&Number.isFinite(intent.value))return {...state,width:Math.max(120,Math.min(520,intent.value))}
  return state
}

export function unscheduledTrayVisible(state,recordCount,disabled=false){
  return !disabled&&recordCount>0&&state.open
}

export function timelineRowRecords(records,unscheduledIds,hideUnscheduled=false){
  return hideUnscheduled?records.filter(record=>!unscheduledIds.has(record.id)):records
}
