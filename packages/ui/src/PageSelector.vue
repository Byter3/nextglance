<script setup lang="ts">
import {usePortalTarget} from "./portal-target"
const portalTarget=usePortalTarget()
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch,type Component} from 'vue'
import {Check,ChevronDown} from 'lucide-vue-next'
import type {PlannerView} from '@nextspace/contracts'

const props=defineProps<{modelValue:PlannerView;options:{id:PlannerView;label:string;icon?:Component}[];scopeName:string;disabled?:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:PlannerView];openChange:[value:boolean]}>()
const trigger=ref<HTMLButtonElement>(),menu=ref<HTMLElement>(),open=ref(false),active=ref(0),placement=ref<Record<string,string>>({})
const id=`page-menu-${useId()}`,selected=computed(()=>props.options.find(option=>option.id===props.modelValue))
function close(restoreFocus=false){if(open.value){open.value=false;emit('openChange',false)}if(restoreFocus)trigger.value?.focus()}
function place(){
  const bounds=trigger.value?.getBoundingClientRect();if(!bounds)return
  const width=Math.min(Math.max(200,bounds.width),window.innerWidth-16),below=window.innerHeight-bounds.bottom-12,above=bounds.top-12,up=below<Math.min(260,props.options.length*42+12)&&above>below
  placement.value={width:`${width}px`,left:`${Math.max(8,Math.min(bounds.left,window.innerWidth-width-8))}px`,maxHeight:`${Math.max(40,Math.min(360,up?above:below))}px`,...(up?{bottom:`${window.innerHeight-bounds.top+4}px`}:{top:`${bounds.bottom+4}px`})}
}
async function focusActive(){await nextTick();menu.value?.querySelector<HTMLButtonElement>(`[data-page-index="${active.value}"]`)?.focus()}
async function reveal(edge?:'first'|'last'){
  if(props.disabled||!props.options.length)return
  active.value=edge==='first'?0:edge==='last'?props.options.length-1:Math.max(0,props.options.findIndex(option=>option.id===props.modelValue))
  place();open.value=true;emit('openChange',true);await focusActive()
}
function choose(index:number){const option=props.options[index];if(!option||props.disabled)return;close(true);if(option.id!==props.modelValue)emit('update:modelValue',option.id)}
async function keyboard(event:KeyboardEvent){
  if(props.disabled)return
  if(event.key==='Escape'&&open.value){event.preventDefault();event.stopPropagation();close(true);return}
  if(event.key==='Tab'){close();return}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    event.preventDefault();event.stopPropagation()
    if(!open.value){await reveal(event.key==='Home'?'first':event.key==='End'?'last':undefined);return}
    active.value=event.key==='Home'?0:event.key==='End'?props.options.length-1:(active.value+(event.key==='ArrowDown'?1:-1)+props.options.length)%props.options.length
    await focusActive();return
  }
  if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();if(open.value)choose(active.value);else await reveal()}
}
function outside(event:Event){if(open.value&&!trigger.value?.contains(event.target as Node)&&!menu.value?.contains(event.target as Node))close()}
function scroll(event:Event){if(open.value&&!menu.value?.contains(event.target as Node))close()}
function resize(){close()}
watch(()=>[props.modelValue,props.scopeName,props.disabled],()=>close())
onMounted(()=>{document.addEventListener('pointerdown',outside,true);document.addEventListener('focusin',outside,true);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',resize)})
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('focusin',outside,true);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',resize)})
defineExpose({close})
</script>

<template>
  <div class="page-selector">
    <button ref="trigger" type="button" class="page-selector-trigger" :disabled="disabled||!options.length" aria-haspopup="menu" :aria-expanded="open" :aria-controls="open?id:undefined" :aria-label="`${scopeName} · ${selected?.label||'Choose page'}. Switch page`" :title="`${scopeName} · ${selected?.label||'Choose page'}`" @click="open?close():reveal()" @keydown="keyboard"><span class="page-selector-text"><small>{{scopeName}}</small><strong>{{selected?.label||'Choose page'}}</strong></span><ChevronDown :size="14" aria-hidden="true"/></button>
    <Teleport :to="portalTarget"><div v-if="open" :id="id" ref="menu" class="page-selector-menu" role="menu" aria-label="Planner pages" :style="placement" @keydown="keyboard"><button v-for="(option,index) in options" :key="option.id" type="button" role="menuitemradio" :aria-checked="option.id===modelValue" :tabindex="active===index?0:-1" :data-page-index="index" :class="{selected:option.id===modelValue}" @focus="active=index" @click="choose(index)"><component v-if="option.icon" :is="option.icon" :size="16" aria-hidden="true"/><span>{{option.label}}</span><Check v-if="option.id===modelValue" :size="15" aria-hidden="true"/></button></div></Teleport>
  </div>
</template>

<style scoped>
.page-selector{min-width:0;width:100%;height:44px}
.page-selector-trigger{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;width:100%;height:44px;margin:0;padding:3px 7px;border:1px solid #ffffff25;border-radius:6px;background:#ffffff12;color:var(--cloud-foreground,var(--text));text-align:left;cursor:pointer}
.page-selector-text{display:flex;flex:1;flex-direction:column;min-width:0;gap:0}.page-selector-text small,.page-selector-text strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.page-selector-text small{font-size:9px;line-height:12px;opacity:.8}.page-selector-text strong{font-size:13px;line-height:20px;font-weight:600}.page-selector-trigger>svg{flex:none}
.page-selector-trigger:focus-visible{outline:2px solid var(--primary);outline-offset:1px}
.page-selector-menu{position:fixed;z-index:90;display:flex;flex-direction:column;gap:2px;overflow:auto;padding:5px;border:1px solid var(--border);border-radius:9px;box-shadow:var(--shadow,0 6px 20px #0006);background:var(--surface);color:var(--text);overscroll-behavior:contain}
.page-selector-menu>button{display:flex;align-items:center;gap:9px;flex-shrink:0;width:100%;min-height:40px;padding:7px 9px;border:0;border-radius:5px;background:transparent;color:inherit;text-align:left;font-size:13px;cursor:pointer}.page-selector-menu>button>span{flex:1}.page-selector-menu>button.selected{background:var(--primary-soft);color:var(--primary-soft-text,var(--primary))}.page-selector-menu>button:hover{background:var(--hover)}.page-selector-menu>button:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
</style>
