const dated=value=>typeof value==='string'&&value.length>0&&Number.isFinite(Date.parse(value))
/** Scheduling is shared across the three date views; visibility filters run first. */
export function unscheduledRecords(records,plans=[],relations=[]){
  const datedEvents=new Set(records.filter(record=>record.kind==='event'&&dated(record.start)).map(record=>record.id))
  const scheduled=new Set(plans.filter(plan=>dated(plan.start)&&dated(plan.end)&&Date.parse(plan.end)>Date.parse(plan.start)).map(plan=>plan.recordId))
  for(const edge of relations)if(edge.type==='scheduled_during'){
    if(datedEvents.has(edge.toId))scheduled.add(edge.fromId)
    if(datedEvents.has(edge.fromId))scheduled.add(edge.toId)
  }
  return records.filter(record=>['task','card'].includes(record.kind)&&!dated(record.start)&&!dated(record.due)&&!scheduled.has(record.id))
}
