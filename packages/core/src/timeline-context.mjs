import {timelineGeometry} from './timeline.mjs'

/** Clip a label to the real item rectangle and the current visible date plot. */
export function visibleSpanLabel({start,end,viewportStart,viewportEnd,padding=4}) {
  if (![start,end,viewportStart,viewportEnd,padding].every(Number.isFinite) || end<=start || viewportEnd<=viewportStart) return null
  const left=Math.max(start,viewportStart),right=Math.min(end,viewportEnd)
  if(right<=left)return null
  const inset=Math.min(Math.max(0,padding),(right-left)/2)
  return {offset:left-start+inset,width:Math.max(0,right-left-inset*2)}
}

/** A point title may use adjacent plot space, but only when its point is visible. */
export function timelinePointLabel({point,viewportStart,viewportEnd,maxWidth=240}) {
  if(![point,viewportStart,viewportEnd,maxWidth].every(Number.isFinite)||point<viewportStart||point>=viewportEnd||maxWidth<=0)return null
  const right=Math.max(0,viewportEnd-point-14),left=Math.max(0,point-viewportStart-14)
  const before=right<Math.min(80,maxWidth)&&left>right
  return {offset:before?-14-Math.min(maxWidth,left):14,width:Math.min(maxWidth,before?left:right)}
}

/** Index contiguous band runs once for the rendered rows. */
export function timelineBandRuns(groups) {
  const byCategory = new Map(), bySpace = new Map()
  const add = (index, id, row) => {
    if (!id) return
    const runs = index.get(id) || []
    const last = runs.at(-1)
    if (last?.end === row) last.end++
    else runs.push({start: row, end: row + 1})
    index.set(id, runs)
  }
  groups.forEach((group, row) => {
    add(byCategory, group.categoryId, row)
    add(bySpace, group.spaceId, row)
  })
  const wholePlot = [{start: 0, end: groups.length || 4}]
  return ({category, space}) => {
    if (!groups.length) return wholePlot
    if (category) return byCategory.get(category.id) || []
    if (space) return bySpace.get(space.id) || []
    return wholePlot
  }
}

/** Groups receive only the filtered hierarchy; never query hidden/source records. */
export function collapsedTimelineSpans(group,anchor,daysCount) {
  const records=new Map(),visit=node=>{for(const record of node.records||[])if(['task','card'].includes(record.kind))records.set(record.id,record);for(const child of node.children||[])visit(child)}
  visit(group)
  const spans=[]
  for(const record of records.values()){
    const shape=timelineGeometry(record,anchor,daysCount)
    if(shape.bar)spans.push({record,start:shape.bar.start,end:shape.bar.end,point:false,lane:0})
    else if(shape.point)spans.push({record,start:shape.point.offset,end:shape.point.offset,point:true,lane:0})
  }
  spans.sort((a,b)=>a.start-b.start||a.end-b.end||(a.record.id<b.record.id?-1:a.record.id>b.record.id?1:0))
  const ends=[]
  for(const span of spans){let lane=ends.findIndex(end=>end<=span.start);if(lane<0)lane=ends.length;span.lane=lane;ends[lane]=span.point?span.start+0.02:span.end}
  return {spans,lanes:Math.max(1,ends.length)}
}
