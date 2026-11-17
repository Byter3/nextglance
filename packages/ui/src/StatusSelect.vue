<script setup lang="ts">
import {usePortalTarget} from "./portal-target"
const portalTarget=usePortalTarget()
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import { safeColor, textOnColor } from './planner-ui'

interface StatusOption { id:string; title:string; color:string; disabled?:boolean }
const props=defineProps<{modelValue:string; options:StatusOption[]; label:string; disabled?:boolean; title?:string}>()
const emit=defineEmits<{'update:modelValue':[value:string]}>()
const trigger=ref<HTMLButtonElement|null>(null),menu=ref<HTMLElement|null>(null)
const open=ref(false),active=ref(-1),placement=ref<Record<string,string>>({})
const id=useId(),listId=`status-list-${id}`
const chosen=computed(()=>props.options.find(option=>option.id===props.modelValue))
const activeId=computed(()=>active.value>=0?`${listId}-${active.value}`:undefined)
let typed='',typedAt=0
function colors(option?:StatusOption){const color=safeColor(option?.color)||'#8b939f';return {'--choice-color':color,'--choice-text':textOnColor(color)}}
function enabled(){return props.options.map((option,index)=>option.disabled?-1:index).filter(index=>index>=0)}
function place(){
  const bounds=trigger.value?.getBoundingClientRect();if(!bounds)return
  const width=Math.min(Math.max(bounds.width,190),window.innerWidth-16),below=window.innerHeight-bounds.bottom-12,above=bounds.top-12
  const upward=below<Math.min(240,props.options.length*42+14)&&above>below
  placement.value={left:`${Math.max(8,Math.min(bounds.left,window.innerWidth-width-8))}px`,width:`${width}px`,maxHeight:`${Math.max(80,Math.min(340,upward?above:below))}px`,...(upward?{bottom:`${window.innerHeight-bounds.top+5}px`}:{top:`${bounds.bottom+5}px`})}
}
function close(restore=false){open.value=false;typed='';if(restore)trigger.value?.focus()}
async function reveal(first?:'first'|'last'){
  if(props.disabled)return
  const indices=enabled();if(!indices.length)return
  active.value=first==='first'?indices[0]:first==='last'?indices[indices.length-1]:indices.find(index=>props.options[index].id===props.modelValue)??indices[0]
  open.value=true;place();await nextTick();revealActive()
}
function revealActive(){menu.value?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)?.scrollIntoView({block:'nearest'})}
function select(index:number){const option=props.options[index];if(!option||option.disabled||props.disabled)return;close(true);if(option.id!==props.modelValue)emit('update:modelValue',option.id)}
async function keydown(event:KeyboardEvent){
  if(props.disabled)return
  const key=event.key
  if(key==='Tab'){close();return}
  if(key==='Escape'&&open.value){event.preventDefault();event.stopPropagation();close(true);return}
  if(['ArrowDown','ArrowUp','Home','End'].includes(key)){
    event.preventDefault()
    if(!open.value){await reveal(key==='Home'?'first':key==='End'?'last':undefined);return}
    const indices=enabled(),position=indices.indexOf(active.value)
    active.value=key==='Home'?indices[0]:key==='End'?indices[indices.length-1]:indices[(position+(key==='ArrowDown'?1:-1)+indices.length)%indices.length]
    await nextTick();revealActive();return
  }
  if(key==='Enter'||key===' '){event.preventDefault();if(open.value)select(active.value);else await reveal();return}
  if(key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
    event.preventDefault();if(!open.value)await reveal()
    const now=Date.now();typed=now-typedAt>750?key:typed+key;typedAt=now
    const search=typed.toLocaleLowerCase(),indices=enabled(),position=indices.indexOf(active.value)
    const ordered=[...indices.slice(position+1),...indices.slice(0,position+1)]
    let found=ordered.find(index=>props.options[index].title.toLocaleLowerCase().startsWith(search))
    if(found===undefined&&[...search].every(char=>char===search[0]))found=ordered.find(index=>props.options[index].title.toLocaleLowerCase().startsWith(search[0]))
    if(found!==undefined){active.value=found;await nextTick();revealActive()}
  }
}
function outside(event:Event){if(!open.value)return;const node=event.target as Node;if(trigger.value?.contains(node)||menu.value?.contains(node))return;close()}
function scrolled(event:Event){if(open.value&&!menu.value?.contains(event.target as Node))close()}
watch(()=>props.disabled,disabled=>{if(disabled)close()})
watch(()=>props.options,()=>{if(open.value){const option=props.options[active.value];if(!option||option.disabled)active.value=enabled()[0]??-1;if(active.value<0)close();else place()}},{deep:true})
onMounted(()=>{document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside,true);window.addEventListener('scroll',scrolled,true);window.addEventListener('resize',place)})
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside,true);window.removeEventListener('scroll',scrolled,true);window.removeEventListener('resize',place)})
</script>

<template>
  <div class="status-select">
    <button ref="trigger" type="button" role="combobox" class="inspector-status-control status-select-trigger" :style="colors(chosen)" :data-value="modelValue" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open?listId:undefined" :aria-activedescendant="open?activeId:undefined" :disabled="disabled||!options.length" :title="title" @click="open?close():reveal()" @keydown="keydown">
      <span>{{chosen?.title||'Choose status'}}</span><ChevronDown :size="17" aria-hidden="true"/>
    </button>
    <Teleport :to="portalTarget"><div v-if="open" :id="listId" ref="menu" role="listbox" :aria-label="label" class="status-select-menu" :style="placement" @keydown="keydown">
      <div v-for="(option,index) in options" :id="`${listId}-${index}`" :key="option.id" role="option" :aria-selected="option.id===modelValue" :aria-disabled="option.disabled||undefined" :data-index="index" :data-value="option.id" class="status-select-option" :class="{active:active===index,disabled:option.disabled}" :style="colors(option)" @pointermove="!option.disabled&&(active=index)" @pointerdown.prevent @click="select(index)"><span>{{option.title}}</span><Check v-if="option.id===modelValue" :size="16" aria-hidden="true"/><span v-else class="status-select-check-space"/></div>
    </div></Teleport>
  </div>
</template>

<style scoped>
.status-select{min-width:0;width:100%;max-width:280px}
.status-select>.status-select-trigger{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;max-width:none;min-height:38px;border:1px solid transparent;border-radius:9px;padding:8px 12px;background:var(--choice-color);color:var(--choice-text);font-size:14px;text-align:left;line-height:1.4;cursor:pointer}
.status-select-trigger>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status-select-trigger>svg{flex-shrink:0}
.status-select>.status-select-trigger:disabled{opacity:1;cursor:not-allowed}
.status-select-trigger:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
.status-select-menu{position:fixed;z-index:85;overflow-y:auto;padding:7px;display:flex;flex-direction:column;gap:6px;background:var(--surface);border:1px solid var(--border-strong);border-radius:12px;box-shadow:var(--shadow,0 8px 28px #0005);overscroll-behavior:contain}
.status-select-option{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:9px 11px;min-height:38px;border-radius:7px;flex-shrink:0;background:var(--choice-color);color:var(--choice-text);font-size:14px;line-height:1.4;cursor:pointer;overflow-wrap:anywhere;outline:2px solid transparent;outline-offset:1px}
.status-select-option.active{outline-color:var(--primary);box-shadow:inset 0 0 0 1px var(--choice-text)}
.status-select-option.disabled{opacity:.55;cursor:not-allowed}
.status-select-option>svg,.status-select-check-space{width:16px;flex-shrink:0}
</style>
