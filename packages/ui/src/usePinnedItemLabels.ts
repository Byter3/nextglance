import {onBeforeUnmount} from 'vue'
import {visibleSpanLabel,timelinePointLabel} from '@nextspace/core/timeline-context.mjs'

type Surface={viewport:HTMLElement|undefined;selector:string;gutter:number;points?:string}
type Item={element:HTMLElement;start:number;end:number;point:boolean;last?:string}
type Viewport={scroll:number;width:number;gutter:number;selector:string;points?:string}
/** Cache item rectangles at layout changes; scrolling reads only each viewport. */
export function usePinnedItemLabels(surfaces:()=>Surface[]){
  let frame:number|undefined,dirty=true
  const cache=new Map<HTMLElement,Item[]>()
  const viewports=new Map<HTMLElement,Viewport>()
  function update(){
    if(frame!==undefined)return
    frame=requestAnimationFrame(()=>{
      frame=undefined
      const writes:{element:HTMLElement;offset:number;width:number;edge:number;edgeVisible:boolean}[]=[]
      for(const surface of surfaces()){
        const viewport=surface.viewport;if(!viewport)continue
        const scroll=viewport.scrollLeft,width=viewport.clientWidth
        const previous=viewports.get(viewport)
        const layoutChanged=!previous||previous.width!==width||previous.selector!==surface.selector||previous.points!==surface.points
        if(!dirty&&!layoutChanged&&previous.scroll===scroll&&previous.gutter===surface.gutter)continue
        if(dirty||!cache.has(viewport)||layoutChanged){
          const bounds=viewport.getBoundingClientRect()
          cache.set(viewport,Array.from(viewport.querySelectorAll<HTMLElement>(surface.selector)).map(element=>{
            const rect=element.getBoundingClientRect(),border=element.clientLeft
            return {element,start:rect.left-bounds.left+scroll+border,end:rect.right-bounds.left+scroll,point:Boolean(surface.points&&element.matches(surface.points))}
          }))
        }
        viewports.set(viewport,{scroll,width,gutter:surface.gutter,selector:surface.selector,points:surface.points})
        const left=scroll+surface.gutter,right=scroll+width
        for(const item of cache.get(viewport)||[]){
          const label=item.point?timelinePointLabel({point:(item.start+item.end)/2,viewportStart:left,viewportEnd:right}):visibleSpanLabel({start:item.start,end:item.end,viewportStart:left,viewportEnd:right})
          const edgeVisible=item.start<left&&item.end>left,offset=label?.offset||0,width=label?.width||0,edge=edgeVisible?left-item.start:0
          const key=`${offset}:${width}:${edge}:${edgeVisible}`
          if(item.last!==key){item.last=key;writes.push({element:item.element,offset,width,edge,edgeVisible})}
        }
      }
      dirty=false
      for(const value of writes){
        value.element.style.setProperty('--label-offset',`${value.offset}px`)
        value.element.style.setProperty('--label-width',`${value.width}px`)
        value.element.style.setProperty('--source-edge-offset',`${value.edge}px`)
        value.element.style.setProperty('--source-edge-visible',value.edgeVisible?'1':'0')
      }
    })
  }
  function invalidate(){dirty=true;cache.clear();viewports.clear();update()}
  onBeforeUnmount(()=>{if(frame!==undefined)cancelAnimationFrame(frame);cache.clear();viewports.clear()})
  return {update,invalidate}
}
