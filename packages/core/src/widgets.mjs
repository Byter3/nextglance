/** Pure launcher-widget configuration and projections. No storage, UI or network. */
import {selectPlanner,scopeRecordIds,allRelations,isClosed,filterCompletedWork} from './planner.mjs'
import {effectiveStatusMapping,mappedBoardColumns,unifiedStatus,filterUnifiedStatuses} from './status-mapping.mjs'
import {organizationMembership,organizationSourcePool,organizationTagKey,organizationTagOptions} from './organization-tags.mjs'
import {boardTaskStacks,orderTimelineRecords,orderTimelineGroups} from './planning-order.mjs'
import {timelineGroups,recordGrouping} from './timeline.mjs'
import {widgetCalendarGrid} from './widget-calendar.mjs'
import {unscheduledRecords} from './unscheduled.mjs'
import {sourceColor} from './record-presentation.mjs'

const list=value=>Array.isArray(value)?value:[]
const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
const id=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!value.includes('\0')&&!['__proto__','constructor','prototype'].includes(value)
const text=(value,max=500)=>typeof value==='string'&&!value.includes('\0')?value.trim().slice(0,max):''
const ids=value=>[...new Set(list(value).filter(id))].slice(0,5000)
const pages=['overview','calendar','timeline','board','list']
const kinds=['event','task','card']
const kindSource={event:'calendar',task:'tasks',card:'deck'}
const pageTitle={overview:'Overview',calendar:'Calendar',timeline:'Timeline',board:'Board',list:'List'}
const number=value=>Number.isInteger(value)&&value>0&&value<=2147483647
const pick=(value,values,fallback)=>values.includes(value)?value:fallback
const compare=(a,b)=>a<b?-1:a>b?1:0
const isWorkTimeline=page=>page==='overview'||page==='timeline'
const uniqueRecords=records=>[...new Map(list(records).filter(record=>record&&id(record.id)&&kinds.includes(record.kind)&&kindSource[record.kind]===record.source).map(record=>[record.id,record])).values()]

/** Unknown versions/identity conflicts fail closed, never widen an existing widget. */
export function normalizeWidgetConfig(input={},identity={}) {
  if(!plain(input)||!plain(identity)||input.version!==undefined&&input.version!==1)return null
  if(identity.widgetId!==undefined&&input.widgetId!==undefined&&identity.widgetId!==input.widgetId)return null
  if(identity.accountKey!==undefined&&input.accountKey!==undefined&&identity.accountKey!==input.accountKey)return null
  const widgetId=identity.widgetId??input.widgetId,accountKey=identity.accountKey??input.accountKey
  if(!number(widgetId)||!id(accountKey))return null
  if(input.generation!==undefined&&!number(input.generation))return null
  const page=pick(input.page,pages,'overview'),defaultKinds=page==='calendar'?['event']:page==='list'?['task']:page==='board'?['task','card']:kinds
  const creationDefaults={}
  for(const kind of kinds){const value=input.creationDefaults?.[kind];if(plain(value)&&id(value.collectionId))creationDefaults[kind]={collectionId:value.collectionId,...(kind==='card'&&id(value.stackId)?{stackId:value.stackId}:{})}}
  return {version:1,widgetId,accountKey,generation:input.generation??1,title:text(input.title,80)||pageTitle[page],page,
    scopeId:id(input.scopeId)?input.scopeId:'all',sourceMode:input.sourceMode==='selected'?'selected':'all',collectionIds:ids(input.collectionIds),
    kinds:[...new Set(Array.isArray(input.kinds)?input.kinds.filter(kind=>kinds.includes(kind)):defaultKinds)].filter(kind=>page!=='board'||kind!=='event'),
    statusIds:ids(input.statusIds),projectIds:ids(input.projectIds),tagNames:[...new Map(list(input.tagNames).map(value=>text(value)).filter(Boolean).map(value=>[organizationTagKey(value),value])).values()].slice(0,5000),
    assignment:input.assignment==='me'?'me':'all',includeUnassigned:input.includeUnassigned!==false,showCompleted:input.showCompleted===true,query:text(input.query,2000),
    dateRange:pick(input.dateRange,['all','today','week','month','overdue'],['board','list'].includes(page)?'all':'week'),
    groupLinkedTasks:input.groupLinkedTasks===undefined?page==='board':input.groupLinkedTasks===true,
    groupBy:pick(input.groupBy,['date','source','project','status','none','planner'],page==='board'?'status':['overview','timeline'].includes(page)?'planner':'date'),sort:input.sort==='title'?'title':'date',
    calendarLayout:pick(input.calendarLayout,['agenda','day','week','month'],['calendar','overview'].includes(page)?'week':'agenda'),transparency:Number.isInteger(input.transparency)?Math.max(0,Math.min(50,input.transparency)):32,
    density:input.density==='comfortable'?'comfortable':'compact',theme:pick(input.theme,['system','light','dark'],'system'),creationDefaults}
}

const dayPattern=/^\d{4}-\d{2}-\d{2}$/
function validDay(value){if(typeof value!=='string'||!dayPattern.test(value))return false;const date=new Date(`${value}T00:00:00Z`);return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value}
function dayAdd(value,count){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10)}
function dates(options={}) {
  const instant=options.now instanceof Date?options.now:new Date(options.now)
  if(options.now===undefined||!Number.isFinite(instant.getTime()))throw new Error('Widget projection requires an explicit valid time.')
  const timeZone=typeof options.timeZone==='string'?options.timeZone:'UTC',locale=typeof options.locale==='string'?options.locale:'en-GB'
  const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'})
  const day=value=>{
    if(validDay(value))return value
    if(typeof value!=='string'||!value||!Number.isFinite(Date.parse(value)))return ''
    const parts=Object.fromEntries(dayFormatter.formatToParts(new Date(value)).map(part=>[part.type,part.value]))
    return `${parts.year}-${parts.month}-${parts.day}`
  }
  const today=day(instant.toISOString()),displayFormatter=new Intl.DateTimeFormat(locale,{timeZone:'UTC',month:'short',day:'numeric'})
  const display=value=>validDay(value)?displayFormatter.format(new Date(`${value}T12:00:00Z`)):''
  const timeFormatter=new Intl.DateTimeFormat(locale,{timeZone,hour:'2-digit',minute:'2-digit'})
  const time=value=>typeof value==='string'&&!validDay(value)&&Number.isFinite(Date.parse(value))?timeFormatter.format(new Date(value)):''
  return {today,day,display,time,instant:instant.toISOString(),timeZone,locale}
}

function indexState(state) {
  const workspace=state?.workspace
  if(!workspace||!Array.isArray(workspace.spaces)||!Array.isArray(workspace.projects))return null
  const records=uniqueRecords(state.records),collections=list(state.collections).filter(collection=>id(collection?.id)&&Object.values(kindSource).includes(collection.source))
  const membership=organizationMembership(workspace,records),relations=allRelations(workspace,records)
  return {state:{...state,records,collections},workspace,records,collections,membership,relations}
}
function scopeCollections(index,scopeId) {
  const allowed=new Set(organizationSourcePool(index.workspace,scopeId,index.collections.map(collection=>collection.id)))
  const recordIds=scopeRecordIds(index.workspace,index.records,scopeId,index.membership)
  for(const record of index.records)if(recordIds.has(record.id)&&record.collectionId)allowed.add(record.collectionId)
  return {allowed,recordIds}
}

/** Compact configuration catalog; no record bodies, URLs or credentials. */
export function widgetCatalog(state,options={}) {
  const index=indexState(state)
  if(!id(options.accountKey)||!index)return {version:1,accountKey:options.accountKey||'',spaces:[],sources:[],statuses:[],projects:[],tags:[]}
  const spaces=[{id:'all',title:'My overview'},...index.workspace.spaces.filter(space=>id(space.id)).map(space=>({id:space.id,title:text(space.name)}))]
  const pools=new Map(spaces.map(space=>[space.id,scopeCollections(index,space.id).allowed]))
  return {version:1,accountKey:options.accountKey,spaces,defaults:Object.fromEntries(pages.map(page=>[page,normalizeWidgetConfig({widgetId:1,accountKey:options.accountKey,page})])),
    sources:index.collections.map(collection=>({id:collection.id,title:text(collection.title),source:collection.source,kind:Object.keys(kindSource).find(kind=>kindSource[kind]===collection.source),color:sourceColor({collectionId:collection.id},index.collections),readonly:collection.readonly===true,scopeIds:spaces.filter(space=>pools.get(space.id).has(collection.id)).map(space=>space.id),...(collection.source==='deck'?{stacks:list(collection.stacks).filter(stack=>id(stack.id)).map(stack=>({id:stack.id,title:text(stack.title)}))}:{})})),
    statuses:spaces.flatMap(space=>[{id:'$unmapped',title:'Unmapped',color:'#8b939f'},...effectiveStatusMapping(index.workspace,space.id,index.collections).columns].map(column=>({...column,scopeId:space.id}))),
    projects:list(index.workspace.projects).filter(project=>!project.archived&&id(project.id)).map(project=>({id:project.id,title:text(project.name),spaceId:project.spaceId})),
    tags:organizationTagOptions(index.records,index.collections).map(tag=>({title:tag.title,...(tag.color?{color:tag.color}:{})}))}
}

function ranges(index,date) {
  const occupied=(start,end)=>{
    const first=date.day(start)
    if(!first)return {start:'',end:''}
    if(!date.day(end)||Date.parse(end)<=Date.parse(start))return {start:first,end:first}
    const last=validDay(end)?dayAdd(end,-1):date.day(new Date(Date.parse(end)-1).toISOString())
    return {start:first,end:last<first?first:last}
  }
  const result=new Map(index.records.map(record=>[record.id,record.kind==='event'?occupied(record.start,record.end):{start:date.day(record.start)||date.day(record.due),end:date.day(record.due)||date.day(record.start)}]))
  const add=(recordId,start,end)=>{const next=occupied(start,end);if(!next.start||!date.day(end)||Date.parse(end)<=Date.parse(start))return;const previous=result.get(recordId);if(!previous?.start)result.set(recordId,{...next,intervals:[next]});else previous.intervals=[...(previous.intervals||[{start:previous.start,end:previous.end}]),next]}
  for(const plan of list(index.workspace.plans))add(plan.recordId,plan.start,plan.end)
  const events=new Map(index.records.filter(record=>record.kind==='event').map(record=>[record.id,record]))
  for(const edge of index.relations)if(edge.type==='scheduled_during')for(const [workId,eventId] of [[edge.fromId,edge.toId],[edge.toId,edge.fromId]]){const event=events.get(eventId);if(event)add(workId,event.start,event.end)}
  return result
}
function dateMatches(record,config,date,rangeMap) {
  if(config.dateRange==='all')return true
  const due=date.day(record.due)
  if(config.dateRange==='overdue')return record.kind!=='event'&&!isClosed(record)&&Boolean(due)&&due<date.today
  const range=rangeMap.get(record.id)
  if(!range?.start)return false
  const end=dayAdd(date.today,config.dateRange==='today'?1:config.dateRange==='week'?7:31)
  return (range.intervals||[range]).some(interval=>interval.start<end&&(interval.end||interval.start)>=date.today)
}

function displayedRange(range, firstDay, endDay) {
  const intersects = interval => Boolean(interval?.start) && interval.start < endDay &&
    (interval.end || interval.start) >= firstDay && (interval.end || interval.start) >= interval.start
  if (intersects(range)) return range
  let scheduled
  for (const interval of range?.intervals || []) {
    if (!intersects(interval)) continue
    if (!scheduled || compare(interval.start, scheduled.start) < 0 ||
      interval.start === scheduled.start && compare(interval.end, scheduled.end) < 0) scheduled = interval
  }
  return scheduled
}

function contextFor(index,config,options,date) {
  const unavailable=message=>({ok:false,message,config,records:[],collections:[],relations:[],settings:{},query:'',statusIds:[],boardGroupTasks:false,calendarMode:'week'})
  if(!config||config.accountKey!==options.accountKey)return unavailable('This widget belongs to an unavailable account. Open NextGlance to reconnect.')
  if(!index)return unavailable('Open NextGlance to load saved planner data.')
  if(config.scopeId!=='all'&&!index.workspace.spaces.some(space=>space.id===config.scopeId))return unavailable('This Space is no longer available. Edit this widget’s settings.')
  const {allowed}=scopeCollections(index,config.scopeId),collectionMap=new Map(index.collections.map(collection=>[collection.id,collection]))
  if(config.sourceMode==='selected'&&(!config.collectionIds.length||config.collectionIds.some(value=>!collectionMap.has(value)||!allowed.has(value))))return unavailable('A selected source is unavailable in this Space. Edit this widget’s settings.')
  const selected=new Set(config.sourceMode==='selected'?config.collectionIds:[...allowed])
  const collections=index.collections.filter(collection=>selected.has(collection.id)&&config.kinds.some(kind=>kindSource[kind]===collection.source))
  const included=new Set(collections.map(collection=>collection.id)),wantedTags=new Set(config.tagNames.map(organizationTagKey))
  const projects=list(index.workspace.projects).filter(project=>!project.archived&&(config.scopeId==='all'||project.spaceId===config.scopeId))
  if(config.projectIds.some(value=>!projects.some(project=>project.id===value)))return unavailable('A selected project is unavailable in this Space. Edit this widget’s settings.')
  const projectRecords=new Set(config.projectIds.flatMap(value=>[...scopeRecordIds(index.workspace,index.records,value,index.membership)])),rangeMap=ranges(index,date)
  const settings={view:config.page,scopeId:config.scopeId,assignment:config.assignment,includeUnassigned:config.includeUnassigned,unassignedBoardIds:[],hiddenCollectionIds:[],excludedSpaceIds:[],showCompleted:config.showCompleted,showCompletedByView:{[config.page]:config.showCompleted},scopeAssignments:{[config.scopeId]:config.assignment},workflow:index.workspace.planner?.workflow||{},statusMapping:effectiveStatusMapping(index.workspace,config.scopeId,index.collections)}
  // Scope associations need the complete graph even for an event-only widget.
  // Completion runs after every explicit filter so hidden cards cannot admit tasks.
  const model=selectPlanner(index.state,{...settings,showCompleted:true,query:config.query,statusIds:[],now:date.instant})
  let records=model.records.filter(record=>included.has(record.collectionId)&&config.kinds.includes(record.kind))
  if(config.projectIds.length)records=records.filter(record=>projectRecords.has(record.id))
  if(wantedTags.size)records=records.filter(record=>[...list(record.tags),...list(record.tagDetails).map(tag=>tag.title)].some(tag=>wantedTags.has(organizationTagKey(tag))))
  const contextCandidates=records
  records=filterUnifiedStatuses(records,settings.statusMapping,config.statusIds).filter(record=>dateMatches(record,config,date,rangeMap))
  records=filterCompletedWork(records,index.relations,config.page,config.showCompleted)
  if(config.page==='board'&&config.groupLinkedTasks){
    const parents=records.filter(record=>record.kind==='card'),tasks=contextCandidates.filter(record=>record.kind==='task')
    const stacks=boardTaskStacks([...parents,...tasks],index.relations)
    records=[...new Map([...records,...tasks.filter(task=>Object.hasOwn(stacks.parentByTask,task.id))].map(record=>[record.id,record])).values()]
  }
  if(['overview','calendar','timeline'].includes(config.page)){
    const unscheduled=new Set(unscheduledRecords(records,index.workspace.plans,index.relations).map(record=>record.id))
    records=records.filter(record=>!unscheduled.has(record.id)&&Boolean(rangeMap.get(record.id)?.start))
  }
  if(isWorkTimeline(config.page)){
    const endDay=dayAdd(date.today,timelineHorizon(config))
    records=records.filter(record=>{
      const range=displayedRange(rangeMap.get(record.id),date.today,endDay)
      if(!range)return false
      rangeMap.set(record.id,range)
      return true
    })
  }
  const compareTitle=(a,b)=>compare(String(a.title||''),String(b.title||''))||compare(a.id,b.id)
  if(config.sort==='title')records=[...records].sort(compareTitle)
  else if(config.page==='timeline')records=orderTimelineRecords(records,index.relations)
  else records=[...records].sort((a,b)=>compare(rangeMap.get(a.id)?.start||'9999',rangeMap.get(b.id)?.start||'9999')||compare(String(a.start||a.due||''),String(b.start||b.due||''))||compareTitle(a,b))
  return {ok:true,config,settings,records,collections,relations:index.relations,query:config.query,statusIds:config.statusIds,boardGroupTasks:config.groupLinkedTasks,calendarMode:config.calendarLayout==='month'?'month':config.calendarLayout==='day'?'day':'week',rangeMap,date,scopeTitle:model.scope.name,projects,membership:index.membership,workspace:index.workspace}
}

/** Unbounded current widget selection for snapshot projection and guarded action checks. */
export function widgetPlannerContext(state,input,options={}) {
  const config=normalizeWidgetConfig(input),date=dates(options)
  return contextFor(indexState(state),config,options,date)
}

const timelineHorizon=config=>config.page==='overview'?(config.calendarLayout==='day'?1:7):config.dateRange==='month'?31:config.dateRange==='today'?1:7
function dayRangeLabel(date,range){return range?.start?[date.display(range.start),range.end!==range.start?date.display(range.end):''].filter(Boolean).join(' – '):''}
function timelineAxis(context) {
  const {config,date}=context,horizon=timelineHorizon(config),last=dayAdd(date.today,horizon-1)
  const label=dayRangeLabel(date,{start:date.today,end:last})+(config.page!=='overview'&&['all','overdue'].includes(config.dateRange)?' · 7-day preview':'')
  const ticks=Array.from({length:horizon+1},(_,index)=>({offset:index/horizon*100,label:index===horizon?'':date.display(dayAdd(date.today,index))}))
  return {start:date.today,end:dayAdd(date.today,horizon),label,ticks}
}
function rowPresentation(record,context,range,sourceTitle) {
  const {date}=context,displayDay=dayRangeLabel(date,range)
  if(record.kind==='event'){
    const startDay=date.day(record.start),endDay=date.day(record.end),endTime=date.time(record.end)
    let endLabel=''
    if(record.allDay){if(range?.end&&range.end!==range.start)endLabel=`Through ${date.display(range.end)}`}
    else if(endTime)endLabel=`Until ${endDay!==startDay?`${date.display(endDay)}, `:''}${endTime}`
    return {leadingLabel:record.allDay?'All day':date.time(record.start)||'Event',secondaryLabel:[sourceTitle,endLabel].filter(Boolean).join(' · '),trailingLabel:'',displayDay}
  }
  const due=date.day(record.due),trailingLabel=due?`${due<date.today&&!isClosed(record)?'Overdue · ':''}${due===date.today?'Today':date.display(due)}`:''
  return {leadingLabel:'',secondaryLabel:sourceTitle,trailingLabel,displayDay}
}
function row(record,context,extras={}) {
  const {date,rangeMap,collections,settings}=context,range=rangeMap.get(record.id),due=date.day(record.due)
  const dateKey=record.kind==='event'?date.day(record.start):due
  const dateLabel=record.kind==='event'?(record.allDay?'All day':[date.time(record.start),date.time(record.end)].filter(Boolean).join('–')):due?`${due<date.today&&!isClosed(record)?'Overdue · ':''}${date.display(due)}`:'No deadline'
  const status=unifiedStatus(record,settings.statusMapping),collection=collections.find(value=>value.id===record.collectionId)
  const rangeLabel=context.config.page==='timeline'&&range?.start?[date.display(range.start),range.end!==range.start?date.display(range.end):''].filter(Boolean).join('–'):dateLabel
  const sourceTitle=text(collection?.title||record.collectionTitle),subtitle=[sourceTitle,rangeLabel].filter(Boolean).join(' · ')
  const horizon=timelineHorizon(context.config)
  const offset=range?.start?(Date.parse(`${range.start}T12:00:00Z`)-Date.parse(`${date.today}T12:00:00Z`))/86400000:0
  const end=range?.end?(Date.parse(`${range.end}T12:00:00Z`)-Date.parse(`${date.today}T12:00:00Z`))/86400000+1:offset+1
  const timeline={offset:Math.max(0,Math.min(100,offset/horizon*100)),length:Math.max(0,Math.min(horizon,end)-Math.max(0,offset))/horizon*100}
  return {type:'item',id:`record:${record.id}`,recordId:record.id,title:text(record.title,500),subtitle,color:sourceColor(record,collections),kind:record.kind,source:record.source,collectionId:record.collectionId,completed:record.completed===true,depth:0,dateLabel,...rowPresentation(record,context,range,sourceTitle),...(dateKey?{dateKey}:{}),
    ...(typeof record.start==='string'?{start:record.start}:{}),...(typeof record.end==='string'?{end:record.end}:{}),...(typeof record.due==='string'?{due:record.due}:{}),...(record.allDay?{allDay:true}:{}),...(status?{statusId:status.id,statusLabel:status.title}:{}),...(range?.start?{rangeStartDay:range.start,rangeEndDay:range.end||range.start}:{}),...(['timeline','overview'].includes(context.config.page)?{timeline}:{}),...extras}
}
function groups(context) {
  const {config,records,settings,collections,date,rangeMap}=context
  const grouping={...context.workspace,collections,scopeId:config.scopeId}
  const projectFor=record=>{
    // All-space project grouping still resolves each project's owning Space.
    if(config.scopeId!=='all')return recordGrouping(record,grouping).project
    const eligible=context.projects.filter(project=>context.membership.projects.get(project.id)?.has(record.id))
    return eligible.find(project=>list(project.recordIds).includes(record.id))||eligible.find(project=>list(project.tagNames).length)||eligible[0]
  }
  if(config.page==='board'){
    const stacks=config.groupLinkedTasks?boardTaskStacks(records,context.relations):{parentByTask:{},byCard:{}}
    const roots=records.filter(record=>!Object.hasOwn(stacks.parentByTask,record.id))
    const columns=config.groupBy==='status'?mappedBoardColumns(roots,collections,settings.statusMapping).filter(column=>!config.statusIds.length||config.statusIds.includes(column.id)).map(column=>({id:`status:${column.id}`,title:column.title,color:column.color,records:column.records.map(record=>row(record,context))})):groups({...context,records:roots,config:{...config,page:'list'}})
    const expanded=columns.map(column=>({...column,records:column.records.flatMap(parent=>[
      parent,...['incoming','outgoing'].flatMap(direction=>(stacks.byCard[parent.recordId]?.[direction]||[]).map(child=>{
        const childRow=row(child,context),label=direction==='incoming'?'Prerequisite':'Follow-up'
        return {...childRow,depth:(parent.depth||0)+1,parentId:parent.recordId,direction,subtitle:`${label} · ${childRow.subtitle}`,secondaryLabel:[label,childRow.secondaryLabel].filter(Boolean).join(' · ')}
      }))])}))
    for(let index=0;index<expanded.length;index++)if(expanded[index].depth!==undefined){
      let count=expanded[index].records.length
      for(let next=index+1;next<expanded.length&&expanded[next].depth>expanded[index].depth;next++)count+=expanded[next].records.length
      expanded[index].sectionCount=count
    }
    return expanded
  }
  if(config.groupBy==='planner'){
    const result=[],visit=group=>{
      result.push({id:group.id,title:group.name,color:group.color,depth:group.depth,sectionCount:group.count,records:group.records.map(record=>row(record,context,{depth:group.depth+1}))})
      for(const child of group.children)visit(child)
    }
    for(const group of orderTimelineGroups(timelineGroups(records,grouping)))visit(group)
    const events=records.filter(record=>record.kind==='event')
    if(events.length)result.push({id:'events',title:'Calendar events',records:events.map(record=>row(record,context))})
    return result
  }
  const result=new Map()
  for(const record of records){
    let key='all',title=''
    if(config.groupBy==='date'){
      const range=rangeMap.get(record.id),day=range?.start,ongoing=config.page==='calendar'&&day<date.today&&range.end>=date.today
      key=day?ongoing?'ongoing':day<date.today?'overdue':day:'undated'
      title=key==='undated'?'Not scheduled':key==='ongoing'?'Ongoing':key==='overdue'?'Earlier':day===date.today?'Today':date.display(day)
    }
    else if(config.groupBy==='source'){key=record.collectionId;title=collections.find(collection=>collection.id===key)?.title||record.collectionTitle||'Unavailable source'}
    else if(config.groupBy==='status'){const status=unifiedStatus(record,settings.statusMapping);key=status?.id||'events';title=status?.title||'Calendar events'}
    else if(config.groupBy==='project'){const project=projectFor(record);key=project?`project:${project.id}`:'ungrouped';title=project?.name||'Ungrouped'}
    if(!result.has(key))result.set(key,{id:String(key),title:text(title),records:[]})
    result.get(key).records.push(row(record,context))
  }
  return [...result.values()]
}
function monthGridDays(today) {
  const first=`${today.slice(0,7)}-01`,weekday=new Date(`${first}T12:00:00Z`).getUTCDay(),start=dayAdd(first,-((weekday+6)%7))
  return Array.from({length:42},(_,index)=>dayAdd(start,index))
}
function month(context) {
  const {date,rangeMap}=context,monthKey=date.today.slice(0,7),first=`${monthKey}-01`,days=monthGridDays(date.today)
  const firstDay=days[0],lastDay=days.at(-1),maxRowsPerDay=6
  const label=new Intl.DateTimeFormat(date.locale,{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(`${first}T12:00:00Z`))
  const dayFormat=new Intl.DateTimeFormat(date.locale,{timeZone:'UTC',weekday:'short'})
  const weekdays=days.slice(0,7).map(day=>dayFormat.format(new Date(`${day}T12:00:00Z`)))
  const ordered=[]
  for(const record of context.records){
    const range=rangeMap.get(record.id)
    const intervals=(range?.intervals||(range?[range]:[])).filter(interval=>interval.start&&interval.start<=lastDay&&(interval.end||interval.start)>=firstDay)
    if(!intervals.length)continue
    const allDay=record.kind==='event'&&Boolean(record.allDay||validDay(record.start)),start=Date.parse(record.start||record.due)
    ordered.push({record,allDay,intervals,start:Number.isFinite(start)?start:Number.MAX_SAFE_INTEGER})
  }
  ordered.sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.start-b.start||compare(a.record.id,b.record.id))
  const prepared=days.map(day=>{
    const candidates=[]
    let count=0
    for(const entry of ordered){
      if(!entry.intervals.some(interval=>interval.start<=day&&(interval.end||interval.start)>=day))continue
      count++
      if(candidates.length<maxRowsPerDay)candidates.push(entry)
    }
    return {cell:{date:day,day:Number(day.slice(8,10)),today:day===date.today,inMonth:day.slice(0,7)===monthKey,count,itinerary:[]},candidates}
  })
  const itineraryRows=[],result={year:Number(first.slice(0,4)),month:Number(first.slice(5,7)),label,weekdays,cells:prepared.map(value=>value.cell),itineraryRows}
  const encoder=new TextEncoder(),indices=new Map(),maxReferences=days.length*maxRowsPerDay
  // Reserve index digits and separators up front so later dates can still
  // reference a spanning row when no room remains for new rows.
  const referenceBytes=maxReferences*(String(maxReferences-1).length+1)
  let rowBudget=384*1024-encoder.encode(JSON.stringify(result)).byteLength-referenceBytes
  for(const {cell,candidates} of prepared){
    for(const {record,allDay} of candidates){
      let index=indices.get(record.id)
      if(index===undefined){
        const projected=row(allDay&&!record.allDay?{...record,allDay:true}:record,context)
        const entryBytes=encoder.encode(JSON.stringify(projected)).byteLength+(itineraryRows.length?1:0)
        if(entryBytes>rowBudget)continue
        index=itineraryRows.length
        indices.set(record.id,index)
        itineraryRows.push(projected)
        rowBudget-=entryBytes
      }
      cell.itinerary.push(index)
    }
  }
  return result
}
function widgetDependencies(context, bounded) {
  const isWork = record => record.kind === 'task' || record.kind === 'card'
  const visible = new Map(bounded.filter(isWork).map(({id: recordId}) => [recordId, {recordId, prerequisites: 0, dependents: 0}]))
  if (!visible.size) return undefined

  const eligible = new Set(context.records.filter(isWork).map(record => record.id))
  const edges = []
  // The shared relation graph has already deduplicated native and planner pairs.
  for (const {type, fromId: dependentId, toId: prerequisiteId} of context.relations) {
    if (type !== 'depends_on' || dependentId === prerequisiteId || !eligible.has(dependentId) || !eligible.has(prerequisiteId)) continue
    const dependent = visible.get(dependentId), prerequisite = visible.get(prerequisiteId)
    if (dependent) dependent.prerequisites++
    if (prerequisite) prerequisite.dependents++
    if (dependent && prerequisite) edges.push({prerequisiteId, dependentId})
  }

  const counts = [...visible.values()].filter(row => row.prerequisites || row.dependents).sort((a, b) => compare(a.recordId, b.recordId))
  if (!counts.length) return undefined
  edges.sort((a, b) => compare(a.prerequisiteId, b.prerequisiteId) || compare(a.dependentId, b.dependentId))
  return {edges: edges.slice(0, 60), counts}
}
function fingerprint(value){const serialized=JSON.stringify(value);let hash=2166136261;for(let i=0;i<serialized.length;i++){hash^=serialized.charCodeAt(i);hash=Math.imul(hash,16777619)}return (hash>>>0).toString(16).padStart(8,'0')}
function snapshot(index,input,options,date) {
  const config=normalizeWidgetConfig(input),context=contextFor(index,config,options,date)
  const base={version:1,widgetId:config?.widgetId??input?.widgetId,accountKey:config?.accountKey??'',generation:config?.generation??0,page:config?.page??'overview',scopeId:config?.scopeId??'all',title:config?.title||'NextGlance',state:context.ok?context.records.length?'ready':'empty':'unavailable',generatedAt:date.instant,rows:[],totalCount:context.records.length,truncated:false}
  if(!context.ok)base.message=context.message
  else {
    const kindTitles={event:'Calendar events',task:'Tasks',card:'Deck cards'}
    base.contextLabel=[context.scopeTitle,config.kinds.map(kind=>kindTitles[kind]).join(' + ')].filter(Boolean).join(' · ')
    if(config.page==='overview')base.overview={bookings:context.records.filter(record=>record.kind==='event').length,work:context.records.filter(record=>record.kind!=='event').length}
    if(isWorkTimeline(config.page))base.timelineAxis=timelineAxis(context)
    let selectedIds
    const isAllDay=record=>record.allDay||validDay(record.start)
    const isRange=record=>record.kind!=='event'||isAllDay(record)||context.rangeMap.get(record.id)?.start!==context.rangeMap.get(record.id)?.end
    const calendarChart=config.page==='calendar'&&['day','week'].includes(config.calendarLayout)
    const chartEnd=dayAdd(date.today,config.calendarLayout==='day'?1:7)
    const chartRecords=calendarChart?context.records.filter(record=>{
      const range=context.rangeMap.get(record.id)
      return range?.start&&(range.intervals||[range]).some(interval=>interval.start<chartEnd&&(interval.end||interval.start)>=date.today)
    }):context.records
    if(config.page==='overview'){
      const top=chartRecords.filter(isRange),bottom=chartRecords.filter(record=>record.kind==='event'&&!isAllDay(record))
      selectedIds=new Set(top.slice(0,12).map(record=>record.id))
      for(const record of [...bottom,...top]){if(selectedIds.size>=25)break;selectedIds.add(record.id)}
    }else if(calendarChart)selectedIds=new Set(chartRecords.slice(0,25).map(record=>record.id))
    let remaining=25
    const meaningfulHeadings=new Set()
    const projected=groups(context).map(group=>({...group,visible:group.records.filter(record=>!selectedIds||selectedIds.has(record.recordId))}))
    for(let index=0;index<projected.length;index++){
      const group=projected[index]
      const count=group.sectionCount??group.records.length
      let descendants=false
      if(group.depth!==undefined)for(let next=index+1;next<projected.length&&projected[next].depth>group.depth;next++)if(projected[next].visible.length){descendants=true;break}
      if(remaining&&(group.visible.length||descendants))meaningfulHeadings.add(`heading:${group.id}`)
      if(group.title&&(config.page==='board'&&config.groupBy==='status'||remaining&&(group.visible.length||descendants)))base.rows.push({type:'heading',id:`heading:${group.id}`,title:group.title,subtitle:String(count),sectionCount:count,...(group.depth!==undefined?{depth:group.depth}:{}),...(group.color?{color:group.color}:{})})
      const added=group.visible.slice(0,remaining);base.rows.push(...added);remaining-=added.length
    }
    const headings=base.rows.filter(value=>value.type==='heading'),headingIds=new Set([...headings.filter(value=>meaningfulHeadings.has(value.id)),...headings.filter(value=>!meaningfulHeadings.has(value.id))].slice(0,50).map(value=>value.id))
    base.rows=base.rows.filter(value=>value.type!=='heading'||headingIds.has(value.id))
    base.truncated=base.totalCount>base.rows.filter(value=>value.type==='item').length||headings.length>50
    const boundedIds=new Set(base.rows.filter(value=>value.type==='item').map(value=>value.recordId))
    const bounded=context.records.filter(record=>boundedIds.has(record.id))
    if(config.page==='overview')base.overviewRangeIds=bounded.filter(isRange).map(record=>record.id)
    if(isWorkTimeline(config.page)){
      const dependencies=widgetDependencies(context,bounded)
      if(dependencies)base.dependencies=dependencies
    }
    if(config.page==='overview'||config.page==='calendar'&&['day','week'].includes(config.calendarLayout)){
      base.calendarGrid=widgetCalendarGrid(bounded,list(context.workspace.plans),{today:date.today,timeZone:date.timeZone,locale:date.locale,mode:config.calendarLayout==='day'?'day':'week',collections:context.collections})
      if(base.calendarGrid.timed.length>175||base.calendarGrid.allDay.length>25)base.truncated=true
      base.calendarGrid.timed=base.calendarGrid.timed.slice(0,175);base.calendarGrid.allDay=base.calendarGrid.allDay.slice(0,25)
    }
    if(config.page==='calendar'&&config.calendarLayout==='month')base.month=month(context)
    if(!base.totalCount)base.message='No items match this widget’s filters.'
    const sources=new Set(context.collections.map(collection=>collection.source)),statuses=list(index.state.statuses).filter(status=>sources.has(status.source))
    const stamps=statuses.map(status=>status.lastSyncedAt).filter(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))
    if(stamps.length===sources.size&&stamps.length)base.sourceVerifiedAt=[...stamps].sort()[0]
    const metadata=options.metadataVerifiedAt||index.state.deviceSync?.plannerVerifiedAt||index.state.storage?.lastSyncedAt
    if(typeof metadata==='string'&&Number.isFinite(Date.parse(metadata)))base.metadataVerifiedAt=metadata
    if(statuses.some(status=>status.state==='error'||status.state==='unavailable'))base.message='Showing saved items. Open NextGlance to check synchronization.'
  }
  for(const field of ['sourceRevision','metadataRevision','acknowledgedEditWatermark'])if(typeof options[field]==='string'||typeof options[field]==='number')base[field]=options[field]
  const {generatedAt,...stable}=base
  base.fingerprint=fingerprint(stable)
  return base
}
export function projectWidget(state,config,options={}){return snapshot(indexState(state),config,options,dates(options))}
/** Index the common source generation once; every config retains independent filters. */
export function projectWidgets(state,configs,options={}){const index=indexState(state),date=dates(options);return list(configs).map(config=>snapshot(index,config,options,date))}

/** Re-derive current scope. A historical launcher snapshot is never action authority. */
export function validateWidgetIntent(intent,input,state,options={}) {
  const config=normalizeWidgetConfig(input),fail=message=>({ok:false,message})
  if(!plain(intent)||!config||intent.widgetId!==config.widgetId||intent.accountKey!==config.accountKey||options.accountKey!==config.accountKey||intent.generation!==config.generation)return fail('This widget action is out of date. Reopen or configure the widget.')
  if(!['open','create','item','date'].includes(intent.action))return fail('This widget action is unavailable.')
  const context=widgetPlannerContext(state,config,options)
  if(!context.ok)return fail(context.message)
  const result={ok:true,action:intent.action,page:config.page,scopeId:config.scopeId,config,context}
  if(intent.action==='item'){
    if(!id(intent.recordId)||!context.records.some(record=>record.id===intent.recordId))return fail('This item is no longer visible in this widget. Open NextGlance to review its sources or filters.')
    result.recordId=intent.recordId
  }
  if(intent.action==='date'){
    const gridDays=config.page==='calendar'&&config.calendarLayout==='month'?monthGridDays(context.date.today):Array.from({length:config.calendarLayout==='day'?1:7},(_,index)=>dayAdd(context.date.today,index))
    if(!['calendar','overview'].includes(config.page)||config.page==='calendar'&&config.calendarLayout==='agenda'||!validDay(intent.date)||!gridDays.includes(intent.date))return fail('Choose an available calendar date.')
    result.date=intent.date
  }
  if(intent.action==='create'){
    const allowed=context.collections.filter(collection=>collection.readonly!==true&&config.kinds.some(kind=>kindSource[kind]===collection.source))
    if(!allowed.length)return fail('No writable destination is available in this widget. Open NextGlance to check source access.')
    if(intent.kind!==undefined&&!config.kinds.includes(intent.kind))return fail('This item type is excluded from the widget.')
    const kind=intent.kind||(config.kinds.length===1?config.kinds[0]:undefined)
    if(kind){
      const candidates=allowed.filter(collection=>collection.source===kindSource[kind]),saved=config.creationDefaults[kind]
      if(!candidates.length)return fail('Choose a writable destination for this item type.')
      result.kind=kind
      const collection=candidates.find(value=>value.id===saved?.collectionId)||(candidates.length===1?candidates[0]:undefined)
      if(collection){result.collectionId=collection.id;if(kind==='card'&&saved?.stackId&&list(collection.stacks).some(stack=>stack.id===saved.stackId))result.stackId=saved.stackId}
    }
  }
  return result
}

/** Route an already validated widget intent into ordinary planner navigation only. */
export function widgetNavigation(result) {
  if(!result?.ok||!pages.includes(result.page)||!id(result.scopeId))return null
  const route={page:result.page,scopeId:result.scopeId}
  if(result.action==='item'){
    const record=result.context?.records.find(record=>record.id===result.recordId)
    if(!record)return null
    route.recordId=record.id
    const displayedStart=result.context.rangeMap.get(record.id)?.start
    const date=(isWorkTimeline(result.page)?displayedStart:undefined)||result.context.date.day(record.start||record.due)||displayedStart
    if(date)route.date=date
  }
  if(result.action==='date'){route.page='calendar';route.date=result.date;route.calendarMode='day'}
  return route
}
