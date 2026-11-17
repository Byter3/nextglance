<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {Clock3,PanelRightClose,PanelRightOpen} from 'lucide-vue-next'
import type {RecordTag,WorkspaceRecord} from '@nextspace/contracts'
import {restoreUnscheduledPresentation,changeUnscheduledPresentation,unscheduledTrayVisible} from '@nextspace/core/unscheduled-presentation.mjs'
import RecordTagMarkers from './RecordTagMarkers.vue'
const props=withDefaults(defineProps<{records:WorkspaceRecord[];selectedId?:string|null;hoveredId?:string|null;relatedIds?:ReadonlySet<string>;highlightedIds?:ReadonlySet<string>;preferenceKey?:string;persistPresentation?:boolean;disabled?:boolean;allowInline?:boolean;defaultInline?:boolean;colorFor?:(record:WorkspaceRecord)=>string;sourceColorFor?:(record:WorkspaceRecord)=>string;tagsFor?:(record:WorkspaceRecord)=>RecordTag[]}>(),{persistPresentation:true,disabled:false,allowInline:false,defaultInline:false})
const emit=defineEmits<{open:[record:WorkspaceRecord];placement:[inline:boolean];hover:[id:string|null,event:PointerEvent|FocusEvent]}>()
const root=ref<HTMLElement>(),list=ref<HTMLElement>(),containerWidth=ref(1000),first=ref(0),active=ref(false)
const presentation=ref(restoreUnscheduledPresentation(null,props))
const inlineItems=computed(()=>presentation.value.inline)
const preferredWidth=computed({get:()=>presentation.value.width,set:value=>{presentation.value=changeUnscheduledPresentation(presentation.value,{type:'resize',value})}})
const pageSize=40,visibleRecords=computed(()=>props.records.slice(first.value,first.value+pageSize))
const overlay=computed(()=>containerWidth.value<760)
const maximum=computed(()=>Math.max(120,Math.min(520,containerWidth.value-(overlay.value?16:280))))
const minimum=computed(()=>Math.min(200,maximum.value))
const width=computed(()=>Math.round(Math.max(minimum.value,Math.min(maximum.value,preferredWidth.value))))
const visible=computed(()=>unscheduledTrayVisible(presentation.value,props.records.length,props.disabled))
const key=computed(()=>props.preferenceKey?`nextspace.unscheduled-tray.v1:${props.preferenceKey}`:null)
let observer:ResizeObserver|undefined,drag:{id:number;x:number;width:number;target:HTMLElement}|undefined
function persist(){if(!props.persistPresentation||!key.value)return;try{localStorage.setItem(key.value,JSON.stringify(presentation.value))}catch{/* Presentation remains usable in this session. */}}
function restore(){
  let saved:unknown=null;first.value=0
  if(props.persistPresentation&&key.value)try{saved=JSON.parse(localStorage.getItem(key.value)||'null')}catch{/* Ignore damaged presentation geometry only. */}
  presentation.value=restoreUnscheduledPresentation(saved,props)
  emit('placement',inlineItems.value)
}
watch(()=>[key.value,props.persistPresentation,props.defaultInline,props.allowInline],restore,{immediate:true})
function show(){presentation.value=changeUnscheduledPresentation(presentation.value,{type:'show'});persist()}
function hide(){presentation.value=changeUnscheduledPresentation(presentation.value,{type:'hide'});persist()}
function setInline(value:boolean){presentation.value=changeUnscheduledPresentation(presentation.value,{type:'inline',value});emit('placement',value);persist()}
function begin(event:PointerEvent){if(event.button!==0)return;event.preventDefault();event.stopPropagation();const target=event.currentTarget as HTMLElement;target.focus();target.setPointerCapture(event.pointerId);drag={id:event.pointerId,x:event.clientX,width:width.value,target};active.value=true}
function move(event:PointerEvent){if(drag?.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();preferredWidth.value=Math.max(minimum.value,Math.min(maximum.value,drag.width+drag.x-event.clientX))}
function finish(){const previous=drag;drag=undefined;active.value=false;if(previous?.target.hasPointerCapture(previous.id))previous.target.releasePointerCapture(previous.id);persist()}
function keyboard(event:KeyboardEvent){const step=event.shiftKey?60:20;const values:Record<string,number>={ArrowLeft:width.value+step,ArrowRight:width.value-step,Home:minimum.value,End:maximum.value,Enter:260};if(!(event.key in values))return;event.preventDefault();event.stopPropagation();preferredWidth.value=Math.max(minimum.value,Math.min(maximum.value,values[event.key]!));persist()}
watch(()=>props.records.length,length=>{first.value=Math.min(first.value,Math.floor(Math.max(0,length-1)/pageSize)*pageSize)})
async function changePage(delta:number){first.value=Math.max(0,Math.min(Math.floor(Math.max(0,props.records.length-1)/pageSize)*pageSize,first.value+delta*pageSize));await nextTick();if(list.value)list.value.scrollTop=0;list.value?.querySelector<HTMLElement>('.unscheduled-item')?.focus({preventScroll:true})}
async function revealRecord(id:string){const index=props.records.findIndex(record=>record.id===id);if(index<0)return false;first.value=Math.floor(index/pageSize)*pageSize;show();await nextTick();const item=list.value?.querySelector<HTMLElement>(`[data-record-id="${CSS.escape(id)}"]`);item?.scrollIntoView({block:'nearest'});item?.focus({preventScroll:true});return true}
defineExpose({revealRecord})
onMounted(()=>{if(!root.value)return;observer=new ResizeObserver(entries=>{containerWidth.value=entries[0]?.contentRect.width||root.value?.clientWidth||1000});observer.observe(root.value)})
onBeforeUnmount(()=>{observer?.disconnect();finish()})
</script>
<template>
  <div ref="root" class="unscheduled-layout" :class="{'tray-visible':visible,'tray-overlay':overlay,'tray-resizing':active,'tray-disabled':disabled}" :style="{'--unscheduled-width':width+'px'}">
    <div class="unscheduled-content"><slot/></div>
    <button v-if="!disabled&&records.length>0&&!visible" class="unscheduled-reopen button" aria-label="Show unscheduled sidebar" @click="show"><PanelRightOpen :size="16"/><span>Not scheduled</span><small>{{records.length}}</small></button>
    <aside v-if="visible" class="unscheduled-tray-v15" aria-label="Not scheduled">
      <div class="unscheduled-resize" role="separator" tabindex="0" aria-label="Resize unscheduled sidebar" aria-orientation="vertical" :aria-valuemin="minimum" :aria-valuemax="maximum" :aria-valuenow="width" @pointerdown="begin" @pointermove="move" @pointerup="finish" @pointercancel="finish" @lostpointercapture="finish" @keydown="keyboard"></div>
      <header><Clock3 :size="16"/><strong>Not scheduled</strong><small>{{records.length}}</small><button class="icon-button" aria-label="Hide unscheduled sidebar" @click="hide"><PanelRightClose :size="17"/></button></header>
      <label v-if="allowInline" class="check-label timeline-unscheduled-filter"><input type="checkbox" :checked="!inlineItems" @change="setInline(!($event.target as HTMLInputElement).checked)"/>Hide unscheduled items in timeline</label>
      <div ref="list" class="unscheduled-items">
        <button v-for="record in visibleRecords" :key="record.id" class="unscheduled-item" :data-record-id="record.id" :class="{selected:record.id===selectedId,hovered:record.id===hoveredId,related:record.id!==selectedId&&relatedIds?.has(record.id),'hover-linked':record.id!==hoveredId&&highlightedIds?.has(record.id)}" :style="{'--record-color':colorFor?.(record)||'var(--primary)'}" @pointerenter="emit('hover',record.id,$event)" @pointerleave="emit('hover',null,$event)" @focusin="emit('hover',record.id,$event)" @focusout="emit('hover',null,$event)" @click="emit('open',record)"><strong>{{record.title}}</strong><small><i class="source-dot" :style="{background:sourceColorFor?.(record)||colorFor?.(record)||'var(--primary)'}"/>{{record.collectionTitle}}</small><RecordTagMarkers v-if="tagsFor" :tags="tagsFor(record)" :compact="false" :limit="3"/></button>
        <p v-if="!records.length" class="field-hint">No unscheduled work in this view.</p>
      </div>
      <nav v-if="records.length>pageSize" class="unscheduled-pages" aria-label="Unscheduled item pages"><button class="text-button" :disabled="first===0" @click="changePage(-1)">Previous</button><small>{{first+1}}–{{Math.min(records.length,first+pageSize)}} / {{records.length}}</small><button class="text-button" :disabled="first+pageSize>=records.length" @click="changePage(1)">Next</button></nav>
    </aside>
  </div>
</template>
<style scoped>
.unscheduled-layout{position:relative;display:flex;flex-direction:row;flex:1 1 0;min-width:0;min-height:0;height:100%;overflow:hidden}.unscheduled-content{display:flex;flex:1 1 0;min-width:0;min-height:0;overflow:hidden;flex-direction:column}.unscheduled-content:deep(>.timeline-surface){flex:1;min-height:0;display:flex;flex-direction:column}.unscheduled-content:deep(>.timeline-surface>.timeline-scroll){flex:1;min-height:0;max-height:none}.unscheduled-content:deep(>.calendar-main){flex:1;min-height:0}.unscheduled-tray-v15{position:relative;flex:0 0 var(--unscheduled-width);min-width:0;width:var(--unscheduled-width);background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;min-height:0;z-index:13;box-sizing:border-box}.unscheduled-tray-v15 header{display:flex;align-items:center;gap:6px;padding:4px 7px;min-height:38px;border-bottom:1px solid var(--border);flex:none}.unscheduled-tray-v15 header strong{font-size:12px;flex:1}.unscheduled-tray-v15 header small{font-size:11px;color:var(--muted)}.unscheduled-tray-v15 header .icon-button{width:36px;height:36px;flex:none}.unscheduled-items{padding:7px;overflow:auto;overscroll-behavior:contain;min-height:0}.unscheduled-item{display:block;width:100%;text-align:left;padding:8px;margin-bottom:6px;border:1px solid var(--border);border-left:3px solid var(--record-color);border-radius:7px;background:var(--surface);min-height:42px}.unscheduled-item strong{display:block;font-size:12px;line-height:1.45;overflow-wrap:anywhere;font-weight:550}.unscheduled-item small{display:block;font-size:10px;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}.unscheduled-item:hover{background:var(--hover)}.unscheduled-item.selected{outline:2px solid var(--primary);outline-offset:-2px}.unscheduled-resize{position:absolute;left:-5px;top:0;bottom:0;width:10px;z-index:2;cursor:col-resize;touch-action:none}.unscheduled-resize:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}.unscheduled-resize::after{content:'';position:absolute;left:4px;top:35%;height:30%;width:2px;background:var(--border)}.unscheduled-reopen{position:absolute;right:5px;bottom:5px;z-index:14;padding:5px 8px;min-height:36px;font-size:11px;background:var(--surface);box-shadow:0 1px 5px #0003;gap:5px}.unscheduled-reopen small{color:var(--muted)}.tray-overlay>.unscheduled-tray-v15{position:absolute;right:0;top:0;bottom:0;box-shadow:-4px 0 18px #0003}.tray-resizing{user-select:none;cursor:col-resize}.timeline-unscheduled-filter{font-size:11px;line-height:1.4;text-align:left;padding:7px 8px;min-height:36px;border-bottom:1px solid var(--border);flex:none}.timeline-unscheduled-filter input{flex:none}.load-unscheduled{font-size:11px;padding:8px;min-height:36px}
</style>
<style scoped>
.unscheduled-pages{display:flex;align-items:center;justify-content:space-between;gap:4px;padding:3px 6px;border-top:1px solid var(--border);margin-top:auto;flex:none}.unscheduled-pages button{min-height:36px;font-size:11px}.unscheduled-pages small{font-size:10px;color:var(--muted);white-space:nowrap}
.unscheduled-item.related,.unscheduled-item.hover-linked{outline:2px dashed var(--primary);outline-offset:-2px}.unscheduled-item.selected,.unscheduled-item.hovered{outline:2px solid var(--primary);outline-offset:-2px}.unscheduled-item small .source-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}.unscheduled-item:deep(.record-tag-markers){margin-top:5px}
</style>
