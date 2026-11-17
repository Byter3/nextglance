<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import {timelineFloatingProjection,timelineFloatingPreview,type FloatingTimelineEntry} from '@nextspace/core/timeline-presentation.mjs'
import type {TimelineEvent} from '@nextspace/core/timeline.mjs'
const props=defineProps<{scroller?:HTMLElement;entries:FloatingTimelineEntry[];events:Map<string,TimelineEvent>;enabled:boolean;labelWidth:number;dayWidth:number;headerHeight?:number;preview?:{id:string;start:number;end:number}}>()
const emit=defineEmits<{activeIds:[ids:string[]]}>()
const view=ref({scrollLeft:0,scrollTop:0,width:0})
let frame:number|undefined,observer:ResizeObserver|undefined
// Scrolling updates this small layer only. Work rows keep their data projections.
function measure(){if(frame!==undefined)return;frame=requestAnimationFrame(()=>{frame=undefined;const element=props.scroller;if(!element)return;const next={scrollLeft:element.scrollLeft,scrollTop:element.scrollTop,width:element.clientWidth};if(next.scrollLeft!==view.value.scrollLeft||next.scrollTop!==view.value.scrollTop||next.width!==view.value.width)view.value=next})}
const projection=computed(()=>props.enabled?timelineFloatingProjection(props.entries,{scrollLeft:view.value.scrollLeft,scrollTop:view.value.scrollTop,viewportWidth:view.value.width-props.labelWidth,dayWidth:props.dayWidth,headerHeight:props.headerHeight}):{items:[],overflowIds:[],height:0})
const items=computed(()=>projection.value.items.flatMap(item=>{const event=props.events.get(item.id);return event?[{...item,event}]:[]}))
const previewStyle=computed(()=>{
  const source=items.value.find(item=>item.id===props.preview?.id)
  if(!source||!props.preview)return null
  const range=timelineFloatingPreview(props.preview,{scrollLeft:view.value.scrollLeft,viewportWidth:view.value.width-props.labelWidth,dayWidth:props.dayWidth})
  return range?{left:`${range.left}px`,width:`${range.width}px`,top:`${source.lane*32+4}px`,height:'24px'}:null
})
watch(()=>projection.value.items.map(item=>item.id).join('\0'),async()=>{
  const active=document.activeElement instanceof HTMLElement?document.activeElement:null
  const chip=active?.closest<HTMLElement>('.timeline-event-chip'),id=chip&&props.scroller?.contains(chip)?chip.dataset.eventId:undefined
  emit('activeIds',projection.value.items.map(item=>item.id))
  if(!id)return
  await nextTick()
  if(document.activeElement!==active&&document.activeElement!==document.body)return
  const target=Array.from(props.scroller?.querySelectorAll<HTMLElement>('.timeline-event-chip')||[]).find(element=>element.dataset.eventId===id&&!element.inert&&!element.closest('[inert]'))
  if(target&&target!==chip)target.focus({preventScroll:true})
})
watch(()=>props.scroller,(element,previous)=>{previous?.removeEventListener('scroll',measure);observer?.disconnect();if(element){element.addEventListener('scroll',measure,{passive:true});observer=new ResizeObserver(measure);observer.observe(element);measure()}},{immediate:true,flush:'post'})
watch(()=>[props.enabled,props.dayWidth,props.labelWidth],measure)
onBeforeUnmount(()=>{props.scroller?.removeEventListener('scroll',measure);observer?.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);emit('activeIds',[])})
</script>
<template>
  <div class="timeline-floating-anchor" :style="{width:`${view.width}px`}"><div v-if="items.length" class="timeline-floating-events" role="group" aria-label="Calendar events in visible dates" :style="{left:`${labelWidth}px`,width:`${Math.max(0,view.width-labelWidth)}px`,height:`${projection.height}px`}"><slot :items="items"/><slot v-if="previewStyle" name="preview" :style="previewStyle"/></div></div>
</template>
<style scoped>
.timeline-floating-anchor{position:sticky;top:0;left:0;height:0;z-index:14;pointer-events:none}.timeline-floating-events{position:absolute;top:0;overflow:hidden;pointer-events:none;touch-action:none}.timeline-floating-events :deep(.timeline-event-chip){pointer-events:auto}
</style>
