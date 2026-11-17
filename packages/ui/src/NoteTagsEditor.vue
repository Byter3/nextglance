<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,onMounted,ref,useId,watch} from 'vue'
import {Check,ChevronDown,LoaderCircle,Plus,Search,Tag,X} from 'lucide-vue-next'
import type {RecordTag} from '@nextspace/contracts'
type NoteTag=RecordTag&{assignable?:boolean}
const props=defineProps<{tags:NoteTag[];options?:NoteTag[];suggestions?:RecordTag[];disabled?:boolean;busy?:boolean;error?:string;saveChanges:(tags:RecordTag[])=>Promise<boolean>}>()
const emit=defineEmits<{dirty:[value:boolean];discard:[]}>()
const root=ref<HTMLElement>(),searchInput=ref<HTMLInputElement>(),open=ref(false),editing=ref(false),saving=ref(false),query=ref(''),draft=ref<NoteTag[]>([]),localError=ref(''),baseline=ref('')
const id=useId(),panelId=`note-tags-${id}`
let savePromise:Promise<boolean>|null=null
const locked=computed(()=>props.disabled||props.busy||saving.value)
const key=(tags:NoteTag[])=>JSON.stringify(tags.map(tag=>tag.id).sort())
const dirty=computed(()=>editing.value&&(key(draft.value)!==baseline.value||Boolean(localError.value)))
const shown=computed(()=>editing.value?draft.value:props.tags)
const options=computed(()=>{
  const all=new Map<string,NoteTag>()
  for(const tag of [...(props.options||[]),...props.tags,...draft.value])if(!all.has(tag.id))all.set(tag.id,tag)
  return [...all.values()].sort((a,b)=>a.title.localeCompare(b.title))
})
const filtered=computed(()=>options.value.filter(tag=>tag.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const utf8=new TextEncoder()
const validNewName=(value:string)=>Boolean(value.trim())&&utf8.encode(value.trim()).length<=64&&!/[\x00-\x1f]/.test(value)
const matchingName=computed(()=>options.value.some(tag=>tag.title.toLocaleLowerCase()===query.value.trim().toLocaleLowerCase()))
const nameTooLong=computed(()=>!matchingName.value&&utf8.encode(query.value.trim()).length>64)
const canCreate=computed(()=>validNewName(query.value)&&!matchingName.value)
const suggested=computed(()=>{
  const seen=new Set<string>()
  return (props.suggestions||[]).filter(tag=>{const name=tag.title.trim().toLocaleLowerCase(),existing=options.value.find(value=>value.title.toLocaleLowerCase()===name);if(!name||seen.has(name)||shown.value.some(value=>value.title.toLocaleLowerCase()===name)||existing?.assignable===false||!existing&&!validNewName(tag.title))return false;seen.add(name);return true})
})
watch(dirty,value=>emit('dirty',value),{immediate:true})
async function begin(){if(locked.value)return;if(open.value){await flush();return}if(!editing.value){draft.value=props.tags.map(tag=>({...tag}));baseline.value=key(draft.value);editing.value=true;localError.value=''}open.value=true;await nextTick();searchInput.value?.focus()}
function selected(tag:NoteTag){return draft.value.some(value=>value.id===tag.id)}
function toggle(tag:NoteTag){if(locked.value||tag.assignable===false)return;draft.value=selected(tag)?draft.value.filter(value=>value.id!==tag.id):[...draft.value,tag]}
async function useSuggestion(tag:RecordTag){if(locked.value)return;const existing=options.value.find(value=>value.title.toLocaleLowerCase()===tag.title.trim().toLocaleLowerCase());if(!existing&&!validNewName(tag.title))return;if(!editing.value)await begin();const value=existing||{...tag,id:`new:${tag.title.trim()}`,title:tag.title.trim(),assignable:true};if(value.assignable===false)return;if(!selected(value))draft.value.push(value);await flush()}
async function create(){if(locked.value||!canCreate.value)return;draft.value.push({id:`new:${query.value.trim()}`,title:query.value.trim(),assignable:true});query.value='';await nextTick();searchInput.value?.focus()}
function discard(){if(saving.value)return;const failed=Boolean(localError.value);draft.value=[];editing.value=false;open.value=false;localError.value='';query.value='';if(failed)emit('discard')}
function flush(retry=false):Promise<boolean>{
  if(savePromise)return savePromise
  if(localError.value&&!retry)return Promise.resolve(false)
  if(!editing.value||!dirty.value){open.value=false;editing.value=false;return Promise.resolve(true)}
  if(props.disabled||props.busy)return Promise.resolve(false)
  saving.value=true;localError.value=''
  savePromise=(async()=>{try{const okay=await props.saveChanges(draft.value.map(tag=>({...tag})));if(!okay){localError.value='Tags could not be saved. Your selection is still here.';return false}editing.value=false;open.value=false;query.value='';return true}catch(error){localError.value=error instanceof Error?error.message:'Tags could not be saved. Your selection is still here.';return false}finally{saving.value=false;savePromise=null}})()
  return savePromise
}
function outside(event:PointerEvent){if(open.value&&!root.value?.contains(event.target as Node))void flush()}
function keyboard(event:KeyboardEvent){if(event.key==='Escape'&&open.value){event.stopPropagation();if(!dirty.value)discard();else open.value=false}}
onMounted(()=>document.addEventListener('pointerdown',outside,true))
onBeforeUnmount(()=>document.removeEventListener('pointerdown',outside,true))
defineExpose({flush,discard})
</script>

<template>
  <div ref="root" class="note-tags-editor" @keydown="keyboard">
    <button type="button" class="note-tags-trigger" :disabled="locked" aria-label="Edit note tags" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId" @click="begin"><Tag :size="16"/><span class="note-tag-chips"><span v-for="tag in shown" :key="tag.id" class="note-tag-chip" :style="{'--note-tag-color':tag.color||'var(--primary)'}"><i/>{{tag.title}}</span><span v-if="!shown.length" class="empty-tags">Add tags</span></span><LoaderCircle v-if="saving" :size="14" class="spinning"/><ChevronDown v-else :size="14"/></button>
    <div v-if="suggested.length" class="note-tag-suggestions"><span>Suggested from linked work</span><button v-for="tag in suggested" :key="tag.id" type="button" :disabled="locked" @click="useSuggestion(tag)"><Plus :size="12"/>{{tag.title}}</button></div>
    <div v-if="open" :id="panelId" class="note-tags-popover" role="dialog" aria-label="Note tags">
      <header><strong>Note tags</strong><span>Saved in Nextcloud Files</span><button type="button" class="icon-button" aria-label="Close note tags" :disabled="saving" @click="flush()"><X :size="15"/></button></header>
      <label class="note-tags-search"><Search :size="15"/><input ref="searchInput" v-model="query" :disabled="locked" placeholder="Find or create a tag…" aria-label="Find note tags" :aria-invalid="nameTooLong||undefined" :aria-describedby="nameTooLong?`${panelId}-length`:undefined" @keydown.enter.prevent="create"/></label>
      <div class="note-tags-options" role="group" aria-label="Choose note tags"><label v-for="tag in filtered" :key="tag.id" :class="{restricted:tag.assignable===false}"><input type="checkbox" :checked="selected(tag)" :disabled="locked||tag.assignable===false" @change="toggle(tag)"/><i :style="{background:tag.color||'var(--primary)'}"/><span>{{tag.title}}</span><small v-if="tag.assignable===false">Managed</small></label><p v-if="!filtered.length">{{query?'No matching tags':'No tags yet'}}</p></div>
      <button v-if="canCreate" type="button" class="text-button create-note-tag" :disabled="locked" @click="create"><Plus :size="14"/>Create “{{query.trim()}}”</button>
      <p v-if="nameTooLong" :id="`${panelId}-length`" class="field-hint" role="status">Tag name is too long. Use a shorter name.</p>
      <p v-if="localError||error" class="inline-error" role="alert">{{localError||error}}</p>
      <footer><span>{{localError?'Retry or cancel this draft':'Click away to save'}}</span><button type="button" class="text-button" :disabled="saving" @click="discard">Cancel</button><button type="button" class="button" :disabled="locked" @click="flush(true)"><Check :size="14"/>{{localError?'Retry':'Done'}}</button></footer>
    </div>
    <div v-if="!open&&localError" class="note-tag-error" role="alert"><span>{{localError}}</span><button type="button" class="text-button" :disabled="locked" @click="begin">Review</button></div>
  </div>
</template>

<style scoped>
.note-tags-editor{position:relative;margin:0 0 16px}.note-tags-trigger{display:flex;align-items:center;gap:9px;max-width:100%;padding:5px 0;border:0;background:transparent;color:var(--muted);cursor:pointer;text-align:left}.note-tags-trigger>svg{flex:none}.note-tag-chips{display:flex;gap:6px;flex-wrap:wrap;min-width:0}.note-tag-chip{display:inline-flex;align-items:center;gap:6px;background:color-mix(in srgb,var(--note-tag-color) 16%,var(--surface));border:1px solid color-mix(in srgb,var(--note-tag-color) 65%,var(--border));border-radius:7px;color:var(--text);font-size:12px;font-weight:600;padding:5px 8px;line-height:1.3;overflow-wrap:anywhere}.note-tag-chip i{background:var(--note-tag-color);width:7px;height:7px;border-radius:50%;flex:none}.empty-tags{font-size:13px}.note-tags-trigger:hover .empty-tags{color:var(--primary)}.note-tag-suggestions{display:flex;flex-wrap:wrap;gap:5px 7px;margin-top:7px;align-items:center}.note-tag-suggestions>span{font-size:11px;color:var(--muted);width:100%}.note-tag-suggestions button{display:flex;align-items:center;gap:4px;border:1px dashed var(--border);border-radius:6px;padding:4px 7px;color:var(--muted);font-size:11px;background:transparent;cursor:pointer}.note-tag-suggestions button:hover{background:var(--primary-soft);color:var(--primary-soft-text)}.note-tags-popover{position:absolute;left:0;right:0;min-width:min(310px,100%);top:calc(100% + 7px);z-index:35;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 14px 40px #0005;padding:13px}.note-tags-popover>header{display:flex;flex-wrap:wrap;align-items:center;gap:5px 8px;margin-bottom:11px}.note-tags-popover>header strong{font-size:14px}.note-tags-popover>header>span{font-size:10px;color:var(--muted)}.note-tags-popover>header button{margin-left:auto}.note-tags-search{display:flex;flex-direction:row;align-items:center;gap:7px;border:1px solid var(--border);border-radius:6px;padding:0 9px}.note-tags-search input{padding:8px 0;border:0;box-shadow:none;background:transparent;min-width:0;font-size:13px}.note-tags-options{max-height:220px;overflow:auto;margin:9px -4px}.note-tags-options>label{display:flex;flex-direction:row;align-items:center;gap:8px;font-weight:400;padding:8px 4px;border-radius:5px;cursor:pointer;font-size:13px;margin:0}.note-tags-options>label:hover{background:var(--hover)}.note-tags-options input{width:16px;height:16px;accent-color:var(--primary);flex:none}.note-tags-options i{width:7px;height:7px;border-radius:50%;flex:none}.note-tags-options label>span{flex:1;overflow-wrap:anywhere}.note-tags-options small{font-size:10px;color:var(--muted)}.note-tags-options p{font-size:12px;color:var(--muted);padding:6px}.note-tags-options .restricted{opacity:.65;cursor:default}.create-note-tag{font-size:12px;padding:7px 0;overflow-wrap:anywhere}.note-tags-popover footer{display:flex;gap:10px;align-items:center;border-top:1px solid var(--border);padding-top:12px;margin-top:8px}.note-tags-popover footer>span{font-size:11px;color:var(--muted);margin-right:auto}.note-tags-popover footer .button{font-size:12px;padding:6px 9px}.note-tag-error{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--red)}.note-tags-editor button:disabled{cursor:not-allowed;opacity:.55}
</style>
