import {computed,nextTick,onBeforeUnmount,onMounted,shallowRef,watch,type Ref} from 'vue'
import {boardAnchorAdjustment,boardEdgeScroll,boardStackLayout,boardStackWindow} from '@nextspace/core/board-window.mjs'

type Column={id:string;records:{id:string}[]}
/** DOM adapter. Pure layout/window selection never changes records or their order. */
export function useBoardWindow(root:Ref<HTMLElement|undefined>,columns:Ref<Column[]>,retained:Ref<string[]>){
  const heights=shallowRef<Record<string,number>>({}),viewports=shallowRef<Record<string,{top:number;height:number}>>({})
  const layouts=computed(()=>new Map(columns.value.map(column=>[column.id,boardStackLayout(column.records.map(record=>record.id),heights.value)])))
  const windows=computed(()=>new Map(columns.value.map(column=>[column.id,boardStackWindow(layouts.value.get(column.id)!,{...viewports.value[column.id],retainIds:retained.value})])))
  const nodes=new Map<string,HTMLElement>(),pendingHeights=new Map<string,number>()
  let observer:ResizeObserver|undefined,scrollport:HTMLElement|undefined,frame=0,measureFrame=0,dragFrame=0,alive=true,lastWidth=0
  let point:{x:number;y:number}|null=null
  function findScrollport(){
    let node=root.value?.parentElement
    while(node){if(/(auto|scroll)/.test(getComputedStyle(node).overflowY))return node;node=node.parentElement}
    return document.scrollingElement instanceof HTMLElement?document.scrollingElement:undefined
  }
  function readViewports(){
    frame=0;if(!alive||!root.value)return
    scrollport ||= findScrollport()
    const bounds=scrollport?.getBoundingClientRect(),top=bounds?.top??0,height=scrollport?.clientHeight||window.innerHeight||640
    const next:Record<string,{top:number;height:number}>={}
    for(const element of root.value.querySelectorAll<HTMLElement>('.column-cards[data-window-column]'))next[element.dataset.windowColumn!]={top:Math.round(top-element.getBoundingClientRect().top),height}
    if(JSON.stringify(next)!==JSON.stringify(viewports.value))viewports.value=next
    const width=root.value.querySelector<HTMLElement>('.board-column')?.clientWidth||0
    if(lastWidth&&width&&Math.abs(lastWidth-width)>1){applyHeights({});nodes.forEach(node=>measureNode(node))}
    if(width)lastWidth=width
  }
  function schedule(){if(alive&&!frame)frame=requestAnimationFrame(readViewports)}
  function measureNode(node:HTMLElement){if(!alive)return;const height=node.getBoundingClientRect().height;if(height>0&&Math.abs((heights.value[node.dataset.orderId!]||0)-height)>.5)pendingHeights.set(node.dataset.orderId!,height);if(pendingHeights.size&&!measureFrame)measureFrame=requestAnimationFrame(commitMeasurements)}
  function applyHeights(next:Record<string,number>){
    const rootBounds=root.value?.getBoundingClientRect()
    const visible=Array.from(root.value?.querySelectorAll<HTMLElement>('.column-cards[data-window-column]')||[]).find(element=>{const rect=element.getBoundingClientRect();return !rootBounds||rect.right>rootBounds.left&&rect.left<rootBounds.right})?.dataset.windowColumn
    const column=columns.value.find(column=>column.id===visible&&layouts.value.get(column.id)?.items.length)||columns.value.find(column=>viewports.value[column.id]&&layouts.value.get(column.id)?.items.length)
    const before=column&&layouts.value.get(column.id),top=column?viewports.value[column.id]?.top||0:0,scrollBefore=scrollport?.scrollTop
    heights.value=next
    const correction=before&&column?boardAnchorAdjustment(before,layouts.value.get(column.id)!,top):0
    void nextTick(()=>{if(!alive)return;if(correction&&scrollport&&scrollport.scrollTop===scrollBefore)scrollport.scrollTop+=correction;schedule()})
  }
  function commitMeasurements(){
    measureFrame=0;if(!alive||!pendingHeights.size)return
    const next={...heights.value};for(const [id,height]of pendingHeights)next[id]=height;pendingHeights.clear();applyHeights(next)
  }
  function rowRef(id:string,value:unknown){
    const old=nodes.get(id),node=value instanceof HTMLElement?value:undefined
    if(old===node)return
    if(old)observer?.unobserve(old)
    if(node){nodes.set(id,node);observer?.observe(node);measureNode(node)}else nodes.delete(id)
  }
  async function reveal(columnId:string,id:string){
    if(!alive)return
    const position=layouts.value.get(columnId)?.items.find(item=>item.id===id);if(!position)return
    scrollport ||= findScrollport();readViewports()
    const view=viewports.value[columnId]||{top:0,height:640}
    if(scrollport){if(position.top<view.top)scrollport.scrollTop+=position.top-view.top;else if(position.bottom>view.top+view.height)scrollport.scrollTop+=position.bottom-view.top-view.height}
    readViewports();await nextTick()
    nodes.get(id)?.querySelector<HTMLElement>('.board-card-main')?.focus({preventScroll:true})
  }
  function dragTick(){
    dragFrame=0;if(!point||!alive)return
    scrollport ||= findScrollport()
    const bounds=scrollport?.getBoundingClientRect(),horizontal=root.value?.querySelector<HTMLElement>('.board-columns'),horizontalBounds=horizontal?.getBoundingClientRect()
    const dy=bounds?boardEdgeScroll(point.y,bounds.top,bounds.bottom):0,dx=horizontalBounds?boardEdgeScroll(point.x,horizontalBounds.left,horizontalBounds.right):0
    if(scrollport&&dy)scrollport.scrollTop+=dy
    if(horizontal&&dx)horizontal.scrollLeft+=dx
    if(dx||dy)schedule()
    dragFrame=requestAnimationFrame(dragTick)
  }
  function drag(value:{x:number;y:number}|null){point=value;if(!point){cancelAnimationFrame(dragFrame);dragFrame=0}else if(!dragFrame)dragFrame=requestAnimationFrame(dragTick)}
  watch(columns,()=>{void nextTick(schedule)})
  onMounted(()=>{
    observer=new ResizeObserver(entries=>{for(const entry of entries)if((entry.target as HTMLElement).dataset.orderId)measureNode(entry.target as HTMLElement);schedule()})
    if(root.value)observer.observe(root.value);nodes.forEach(node=>observer!.observe(node))
    document.addEventListener('scroll',schedule,{capture:true,passive:true});window.addEventListener('resize',schedule);schedule()
  })
  onBeforeUnmount(()=>{alive=false;observer?.disconnect();nodes.clear();pendingHeights.clear();cancelAnimationFrame(frame);cancelAnimationFrame(measureFrame);cancelAnimationFrame(dragFrame);document.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule)})
  return {layouts,windows,rowRef,reveal,drag}
}
