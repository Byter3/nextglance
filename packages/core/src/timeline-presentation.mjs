/** Project header chips into a bounded visible-date overlay. Coordinates are
 * relative to the rendered date canvas, never the offscreen label column. */
export function timelineFloatingProjection(entries,viewport){
  const {scrollLeft,viewportWidth,dayWidth,scrollTop}=viewport||{}
  const headerHeight=Number.isFinite(viewport?.headerHeight)&&viewport.headerHeight>=0?viewport.headerHeight:56
  const empty={items:[],overflowIds:[],height:0}
  if(![scrollLeft,viewportWidth,dayWidth,scrollTop].every(Number.isFinite)||viewportWidth<=0||dayWidth<=0)return empty
  const start=scrollLeft/dayWidth,end=(scrollLeft+viewportWidth)/dayWidth,lanes=[],items=[],overflowIds=[]
  for(const entry of entries||[]){
    if(entry.overflow||entry.lane<0||![entry.start,entry.end,entry.left,entry.width,entry.lane].every(Number.isFinite))continue
    const intersects=entry.start===entry.end?entry.start>=start&&entry.start<end:entry.start<end&&entry.end>start
    if(!intersects||scrollTop<headerHeight+6+entry.lane*32)continue
    const width=Math.max(0,Math.min(viewportWidth,entry.width)),left=Math.max(0,Math.min(entry.left-scrollLeft,viewportWidth-width))
    if(!width)continue
    let lane=lanes.findIndex(occupied=>occupied.every(range=>left>=range.end+8||left+width+8<=range.start))
    if(lane<0&&lanes.length<3){lane=lanes.length;lanes.push([])}
    if(lane<0){overflowIds.push(entry.id);continue}
    lanes[lane].push({start:left,end:left+width});items.push({id:entry.id,left,width,lane})
  }
  return {items,overflowIds,height:lanes.length*32}
}

/** A ghost uses proposed dates; eligibility and captured chips still use the
 * acknowledged native interval. Return no invented span outside the viewport. */
export function timelineFloatingPreview(range,viewport){
  const {scrollLeft,viewportWidth,dayWidth}=viewport||{}
  if(!range||![range.start,range.end,scrollLeft,viewportWidth,dayWidth].every(Number.isFinite)||range.end<range.start||viewportWidth<=0||dayWidth<=0)return null
  const start=range.start*dayWidth-scrollLeft,end=range.end*dayWidth-scrollLeft
  if(start>=viewportWidth||(range.start===range.end?start<0:end<=0))return null
  const left=Math.max(0,start),width=Math.min(viewportWidth-left,Math.max(4,Math.min(viewportWidth,end)-left))
  return {left,width}
}
