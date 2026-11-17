<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {Check, ChevronDown, LoaderCircle, Plus, Search, Tag, X} from 'lucide-vue-next'
import type {Collection, RecordTag, Workspace, WorkspaceRecord} from '@nextspace/contracts'
import {normalizeColor, recordTags, tagColorKey} from '@nextspace/core/record-presentation.mjs'

type AppearancePatch = {color?:string;tags?:string[];tagIds?:string[]}
type TagColorChange = {title:string;color:string}
const props = defineProps<{
  record:WorkspaceRecord;collection?:Collection;records?:WorkspaceRecord[];workspace?:Workspace
  busy?:boolean;disabled?:boolean;error?:string;sourceColor?:string
  saveChanges?:(patch:AppearancePatch)=>Promise<boolean>
  saveTagColors?:(changes:TagColorChange[])=>Promise<boolean>
  createNativeTag?:(title:string)=>Promise<RecordTag>
}>()
const emit = defineEmits<{dirty:[value:boolean];discard:[]}>()
const root = ref<HTMLElement>(), searchInput = ref<HTMLInputElement>()
const createdLabels=ref<RecordTag[]>([]),creatingTag=ref(false)
let tagCreationPromise:Promise<boolean>|null=null
const panel = ref<'tags'|'color'|null>(null), editing = ref(false), saving = ref(false)
const color = ref(''), tags = ref<string[]>([]), tagIds = ref<string[]>([]), query = ref('')
const baseline = ref(''), tagColorDraft = ref<Record<string,string>>({}), tagColorBaseline = ref<Record<string,string>>({})
const failedNativeFields = ref<(keyof AppearancePatch)[]>([])
const localError = ref(''), dismissedError = ref(false)
let savingPromise:Promise<boolean>|null = null
const readOnly = computed(() => Boolean(props.disabled || props.record.readonly || props.collection?.readonly))
const locked = computed(() => readOnly.value || props.busy || saving.value || creatingTag.value)
const sourceColor = computed(() => normalizeColor(props.sourceColor || props.collection?.color) || '#0082c9')
const snapshot = () => JSON.stringify({color:color.value,tags:tags.value,tagIds:tagIds.value})
const tagColorChanges = computed<TagColorChange[]>(() => Object.entries(tagColorDraft.value).filter(([title,value]) => value !== (tagColorBaseline.value[title] || '')).map(([title,value]) => ({title,color:value})))
const dirty = computed(() => editing.value && (snapshot() !== baseline.value || tagColorChanges.value.length > 0 || failedNativeFields.value.length > 0))
const shownError = computed(() => localError.value || (!dismissedError.value && editing.value ? props.error || '' : ''))
const itemColor = computed(() => normalizeColor(editing.value ? color.value : props.record.color) || sourceColor.value)
const nativeLabels = computed(() => {
  const byId = new Map<string,RecordTag>()
  for (const tag of [...(props.collection?.labels || []),...(props.record.tagDetails || []),...createdLabels.value]) if(!byId.has(tag.id))byId.set(tag.id,tag)
  return [...byId.values()]
})
const tagOptions = computed<RecordTag[]>(() => {
  if (props.record.source === 'deck') return nativeLabels.value
  const names = new Set([...(props.record.tags || []),...tags.value])
  for (const record of props.records || []) if(record.source === props.record.source && record.collectionId === props.record.collectionId) for(const name of record.tags || [])names.add(name)
  return [...names].sort((a,b) => a.localeCompare(b)).map(title => ({id:title,title}))
})
const filteredTags = computed(() => tagOptions.value.filter(tag => tag.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const mayCreateTag = computed(() => (props.record.source !== 'deck'||Boolean(props.createNativeTag)) && Boolean(query.value.trim()) && query.value.trim().length <= (props.record.source==='deck'?100:200) && !/[\x00-\x1f]/.test(query.value) && !tagOptions.value.some(tag => tag.title.toLocaleLowerCase() === query.value.trim().toLocaleLowerCase()))
function isTagSelected(tag:RecordTag){return props.record.source === 'deck' ? tagIds.value.includes(tag.id) : tags.value.includes(tag.title)}
function savedTagColor(title:string){return normalizeColor(props.workspace?.properties?.['tag-colors']?.[tagColorKey(props.record.collectionId,title)]) || ''}
function tagColor(tag:RecordTag){return normalizeColor(tag.color) || (props.record.source === 'tasks' ? normalizeColor(editing.value && Object.hasOwn(tagColorDraft.value,tag.title) ? tagColorDraft.value[tag.title] : savedTagColor(tag.title)) : undefined) || sourceColor.value}
const displayedTags = computed(() => editing.value ? tagOptions.value.filter(isTagSelected).map(tag => ({...tag,color:tagColor(tag)})) : recordTags(props.record,props.workspace))
const palette = ['#0082c9','#3975ce','#8b5bb1','#df4583','#e5534b','#d68b24','#d8bc46','#329b75','#657784']

function reset(){
  color.value = normalizeColor(props.record.color) || '';tags.value = [...(props.record.tags || [])];tagIds.value = (props.record.tagDetails || []).map(tag => tag.id)
  query.value = '';tagColorDraft.value = {};tagColorBaseline.value = {};failedNativeFields.value = [];baseline.value = snapshot();localError.value = ''
}
async function open(kind:'tags'|'color'){
  if(locked.value)return
  if(panel.value === kind){if(shownError.value)panel.value = null;else await flush();return}
  if(!editing.value){reset();editing.value = true;dismissedError.value = true}
  panel.value = kind
  await nextTick()
  if(kind === 'tags')searchInput.value?.focus()
}
function toggleTag(tag:RecordTag){
  if(locked.value)return
  if(props.record.source === 'deck')tagIds.value = isTagSelected(tag) ? tagIds.value.filter(id => id !== tag.id) : [...tagIds.value,tag.id]
  else tags.value = isTagSelected(tag) ? tags.value.filter(title => title !== tag.title) : [...tags.value,tag.title]
}
function createTag(){
  if(!mayCreateTag.value || locked.value)return
  if(props.record.source==='deck'&&props.createNativeTag){
    const title=query.value.trim();creatingTag.value=true;localError.value=''
    tagCreationPromise=(async()=>{
      try{
        const tag=await props.createNativeTag!(title)
        if(!createdLabels.value.some(existing=>existing.id===tag.id))createdLabels.value.push(tag)
        if(!tagIds.value.includes(tag.id))tagIds.value.push(tag.id)
        query.value=''
        return true
      }catch(reason){localError.value=reason instanceof Error?reason.message:'Could not create this board tag. Your choices are kept.';return false}
      finally{
        creatingTag.value=false
        // Clearing the search removes the focused Create button. Keep keyboard
        // focus in the editor so Escape cancels this selection instead of
        // reaching the app's inspector-close handler (which saves the draft).
        await nextTick()
        if(panel.value==='tags'&&editing.value)searchInput.value?.focus()
        tagCreationPromise=null
      }
    })()
    return
  }
  tags.value.push(query.value.trim());query.value = ''
  void nextTick(()=>{if(panel.value==='tags'&&editing.value)searchInput.value?.focus()})
}
function setTagColor(title:string,value:string){
  if(!props.saveTagColors || locked.value)return
  if(!Object.hasOwn(tagColorBaseline.value,title))tagColorBaseline.value[title] = savedTagColor(title)
  tagColorDraft.value[title] = value
}
function discard(){
  if(saving.value||creatingTag.value)return
  const hadError = Boolean(shownError.value)
  reset();panel.value = null;editing.value = false;dismissedError.value = true
  if(hadError)emit('discard')
}
function nativePatch():AppearancePatch{
  const before = JSON.parse(baseline.value),patch:AppearancePatch = {}
  if(color.value !== before.color)patch.color = color.value
  if(props.record.source === 'deck'){
    if(JSON.stringify(tagIds.value) !== JSON.stringify(before.tagIds))patch.tagIds = [...tagIds.value]
  }else if(JSON.stringify(tags.value) !== JSON.stringify(before.tags))patch.tags = [...tags.value]
  // The native edit queue protects every field from a failed attempt. Include
  // those fields even if the user has since reverted one to its saved value.
  // Every retry therefore carries the current intent for the whole failed edit.
  for(const field of failedNativeFields.value){
    if(field === 'color')patch.color = color.value
    else if(field === 'tagIds')patch.tagIds = [...tagIds.value]
    else patch.tags = [...tags.value]
  }
  return patch
}
function rememberNativeFailure(patch:AppearancePatch){failedNativeFields.value = [...new Set([...failedNativeFields.value,...(Object.keys(patch) as (keyof AppearancePatch)[])])]}
function flush(retry=false):Promise<boolean>{
  if(tagCreationPromise)return tagCreationPromise.then(okay=>okay?flush(retry):false)
  if(savingPromise)return savingPromise
  if(shownError.value && !retry)return Promise.resolve(false)
  if(!editing.value || !dirty.value){panel.value = null;editing.value = false;return Promise.resolve(true)}
  if(readOnly.value || props.busy){localError.value = 'These changes are still here. Wait for the connection before retrying.';return Promise.resolve(false)}
  // Keep dirty=true throughout the request so background sync and navigation
  // cannot replace the edited record while an acknowledgement is outstanding.
  saving.value = true;localError.value = '';dismissedError.value = true
  const patch = nativePatch(),colors = tagColorChanges.value.map(change => ({...change}))
  let nativeAcknowledged = !Object.keys(patch).length
  savingPromise = (async() => {
    try{
      if(Object.keys(patch).length){
        if(!props.saveChanges || !await props.saveChanges(patch)){rememberNativeFailure(patch);await nextTick();localError.value = props.error || 'Could not save. Your changes are still here.';panel.value = null;return false}
        nativeAcknowledged = true;failedNativeFields.value = []
        // A subsequent metadata error must not repeat an acknowledged native write.
        baseline.value = snapshot()
      }
      if(colors.length){
        if(!props.saveTagColors || !await props.saveTagColors(colors)){localError.value = 'Tag colors could not be saved. Your changes are still here.';panel.value = null;return false}
        for(const change of colors)tagColorBaseline.value[change.title] = change.color
      }
      await nextTick();reset();panel.value = null;editing.value = false
      return true
    }catch(reason){if(!nativeAcknowledged)rememberNativeFailure(patch);localError.value = reason instanceof Error ? reason.message : 'Could not save. Your changes are still here.';panel.value = null;return false}
    finally{saving.value = false;savingPromise = null}
  })()
  return savingPromise
}
function pointerOutside(event:PointerEvent){
  if(!editing.value || !(event.target instanceof Node))return
  const target = event.target instanceof Element ? event.target : event.target.parentElement
  // The title and source label are outside the active editor too. Keep only
  // popover controls and the two editor triggers inside the draft boundary.
  const editorTarget = target?.closest('.appearance-popover,.tag-selector-trigger,.item-color-stripe,.appearance-error button')
  if(!editorTarget || !root.value?.contains(editorTarget)){if(shownError.value)panel.value = null;else void flush()}
}
function focusOutside(event:FocusEvent){
  // A null target can be the OS color picker; wait for a real outside focus or
  // pointer event so closing that picker cannot submit a half-finished choice.
  if(editing.value && event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)){if(shownError.value)panel.value = null;else void flush()}
}
function escape(event:KeyboardEvent){
  if(event.key !== 'Escape' || !editing.value)return
  event.preventDefault();event.stopPropagation();discard()
}
watch(() => props.record.id,() => {reset();editing.value = false;panel.value = null;dismissedError.value = false},{immediate:true})
watch([dirty,saving,creatingTag],([changed,pending,creating]) => emit('dirty',changed||pending||creating),{immediate:true,flush:'sync'})
onMounted(() => document.addEventListener('pointerdown',pointerOutside,true))
onBeforeUnmount(() => {document.removeEventListener('pointerdown',pointerOutside,true);emit('dirty',false)})
defineExpose({flush,hasDirty:() => dirty.value || saving.value || creatingTag.value,discard})
</script>

<template>
  <section ref="root" class="item-appearance inline-appearance" aria-label="Item color and tags" @focusout="focusOutside" @keydown="escape">
    <div class="inline-tags">
      <button class="tag-selector-trigger" type="button" aria-label="Choose tags" aria-haspopup="dialog" :aria-expanded="panel==='tags'" :disabled="locked" @click="open('tags')">
        <Tag :size="14"/>
        <span v-if="displayedTags.length" class="appearance-tags"><span v-for="tag in displayedTags" :key="tag.id" class="appearance-tag" :style="{'--tag-color':tag.color||sourceColor}"><i :style="{backgroundColor:tag.color||sourceColor}"/>{{tag.title}}</span></span>
        <span v-else class="empty-tags">{{readOnly?'No tags':'Add tags'}}</span><ChevronDown v-if="!readOnly" :size="13"/>
      </button>
      <div v-if="panel==='tags'" class="appearance-popover tag-selector-popover" role="dialog" aria-label="Choose tags" :aria-busy="saving||busy">
        <label class="tag-search"><Search :size="14"/><input ref="searchInput" v-model="query" aria-label="Find or add a tag" placeholder="Find or create a tag…" :maxlength="record.source==='deck'?100:200" :disabled="locked" @keydown.enter.prevent="createTag"/></label>
        <div class="tag-options" role="group" aria-label="Available tags">
          <div v-for="tag in filteredTags" :key="tag.id" class="tag-option-row">
            <label class="tag-option"><input type="checkbox" :checked="isTagSelected(tag)" :disabled="locked" @change="toggleTag(tag)"/><i :style="{backgroundColor:tagColor(tag)}"/><span>{{tag.title}}</span></label>
            <template v-if="record.source==='tasks'&&isTagSelected(tag)&&saveTagColors">
              <input class="tag-color-input" type="color" :value="tagColor(tag)" :aria-label="`Color for ${tag.title}`" :disabled="locked" @input="setTagColor(tag.title,($event.target as HTMLInputElement).value)"/>
              <button v-if="Object.hasOwn(tagColorDraft,tag.title)?tagColorDraft[tag.title]:savedTagColor(tag.title)" class="tag-color-reset" type="button" :aria-label="`Reset color for ${tag.title}`" :disabled="locked" @click="setTagColor(tag.title,'')"><X :size="12"/></button>
            </template>
          </div>
          <button v-if="mayCreateTag" class="create-tag" type="button" :disabled="locked" @click="createTag"><Plus :size="14"/>Create tag “{{query.trim()}}”</button>
          <p v-else-if="!filteredTags.length" class="appearance-hint">No matching tags.</p>
        </div>
        <small class="popover-hint"><template v-if="creatingTag">Creating a tag in Deck…</template><template v-else>Choose several · click away to save · Esc to cancel</template></small>
      </div>
    </div>
    <div class="appearance-title-row">
      <button class="item-color-stripe" type="button" aria-label="Change item color" :aria-expanded="panel==='color'" aria-haspopup="dialog" :title="readOnly?'Item color': 'Change item color'" :disabled="locked" :style="{'--item-color':itemColor}" @click="open('color')"><span/></button>
      <h2>{{record.title}}</h2>
      <div v-if="panel==='color'" class="appearance-popover item-color-popover" role="dialog" aria-label="Item color" :aria-busy="saving||busy">
        <button class="source-default-color" type="button" :disabled="locked" @click="color='' "><i :style="{backgroundColor:sourceColor}"/>Use source color<Check v-if="!color" :size="14"/></button>
        <div class="item-color-palette" role="group" aria-label="Suggested item colors"><button v-for="swatch in palette" :key="swatch" type="button" :aria-label="`Use ${swatch}`" :aria-pressed="color===swatch" :disabled="locked" :style="{backgroundColor:swatch}" @click="color=swatch"><Check v-if="color===swatch" :size="15"/></button></div>
        <label class="custom-item-color"><span>Custom color</span><input :value="color||sourceColor" type="color" aria-label="Item color" :disabled="locked" @input="color=($event.target as HTMLInputElement).value"/></label>
        <small class="popover-hint">Click away to save · Esc to cancel</small>
      </div>
    </div>
    <p class="appearance-source inspector-collection"><i :style="{backgroundColor:sourceColor}" title="Original source color"/>{{collection?.title||record.collectionTitle||'Source'}}<span v-if="saving||busy" class="appearance-save-status" role="status"><LoaderCircle :size="12" class="spinning"/>Saving…</span></p>
    <div v-if="shownError" class="appearance-error" role="alert"><span>{{shownError}}</span><div><button type="button" :disabled="locked" @click="flush(true)">Retry</button><button type="button" :disabled="saving||busy" @click="discard">Keep saved values</button></div></div>
  </section>
</template>

<style scoped>
.inline-appearance{position:relative;padding:0 0 16px;border:0;min-width:0}
.inline-tags{position:relative;margin:0 0 13px}.tag-selector-trigger{display:flex;align-items:center;gap:7px;padding:3px 0;min-height:28px;max-width:100%;text-align:left;background:transparent;border:0;color:var(--muted)}.tag-selector-trigger>svg{flex:none}.tag-selector-trigger:disabled{opacity:1;cursor:default}.empty-tags{font-size:12px}.appearance-tags{display:flex;gap:5px;flex-wrap:wrap;min-width:0}.appearance-tag{display:inline-flex;align-items:center;gap:5px;max-width:100%;font-size:11px;line-height:1.4;padding:3px 7px;border:1px solid color-mix(in srgb,var(--tag-color) 50%,var(--border));background:color-mix(in srgb,var(--tag-color) 12%,var(--surface));color:var(--text);border-radius:7px;overflow-wrap:anywhere}.appearance-tag i{width:6px;height:6px;border-radius:50%;flex:none}
.appearance-title-row{display:flex;align-items:stretch;position:relative;gap:10px;min-width:0}.appearance-title-row h2{margin:0;min-width:0;overflow-wrap:anywhere;line-height:1.35;flex:1;font-size:25px;font-weight:650}.item-color-stripe{display:flex;justify-content:center;flex:0 0 15px;width:15px;align-self:stretch;min-height:32px;margin-left:-4px;padding:3px 4px;border:0;background:transparent;border-radius:5px}.item-color-stripe span{width:5px;min-height:26px;align-self:stretch;background:var(--item-color);border-radius:3px}.item-color-stripe:hover:not(:disabled){background:var(--hover)}.item-color-stripe:disabled{opacity:1;cursor:default}.item-color-stripe:focus-visible,.tag-selector-trigger:focus-visible{outline:2px solid var(--primary);outline-offset:3px}
.appearance-source{display:flex;align-items:center;gap:7px;margin:10px 0 0;font-size:12px;line-height:1.5;color:var(--muted);flex-wrap:wrap}.appearance-source>i{width:8px;height:8px;border-radius:50%;flex:none}.appearance-save-status{display:inline-flex;align-items:center;gap:4px;font-size:10px;margin-left:auto}
.appearance-popover{position:absolute;z-index:25;left:0;right:0;top:calc(100% + 6px);padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 35px #0004;color:var(--text)}.tag-selector-popover{max-width:430px}.appearance-popover .tag-search{display:flex;flex-direction:row;align-items:center;gap:7px;margin:0 0 8px;color:var(--muted)}.tag-search>svg{flex:none}.tag-search input{min-width:0;flex:1;width:100%;padding:7px 9px;font-size:12px}.tag-options{max-height:min(280px,45vh);overflow:auto;overscroll-behavior:contain}.tag-option-row{display:flex;align-items:center;gap:5px;min-width:0;border-radius:6px}.tag-option-row:hover{background:var(--hover)}.appearance-popover .tag-option{display:flex;flex-direction:row;align-items:center;gap:8px;flex:1;min-width:0;padding:8px 5px;margin:0;font-size:12px;cursor:pointer}.tag-option input{margin:0;width:14px;height:14px;flex:none;accent-color:var(--primary)}.tag-option>i{width:9px;height:9px;flex:none;border-radius:3px}.tag-option>span{overflow-wrap:anywhere;min-width:0}.tag-color-input{flex:none;width:25px;height:25px;padding:2px;border:1px solid var(--border);border-radius:5px;background:transparent;cursor:pointer}.tag-color-reset{display:flex;align-items:center;justify-content:center;padding:4px;color:var(--muted);background:transparent;border:0}.create-tag{display:flex;align-items:center;gap:6px;font-size:12px;padding:9px 5px;width:100%;text-align:left;color:var(--primary);overflow-wrap:anywhere}.appearance-hint,.popover-hint{font-size:11px;line-height:1.5;color:var(--muted)}.appearance-hint{margin:8px 4px}.popover-hint{display:block;margin-top:10px}
.item-color-popover{width:min(270px,100%);right:auto}.source-default-color{display:flex;align-items:center;gap:7px;width:100%;text-align:left;padding:5px 0;font-size:12px;color:var(--text)}.source-default-color>i{width:12px;height:12px;border-radius:3px}.source-default-color>svg{margin-left:auto}.item-color-palette{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:5px;margin:13px 0}.item-color-palette button{display:flex;justify-content:center;align-items:center;min-width:0;height:22px;border:1px solid #fff3;border-radius:5px;padding:0;color:#fff;text-shadow:0 1px 2px #000}.appearance-popover .custom-item-color{display:flex;flex-direction:row;justify-content:space-between;align-items:center;font-size:12px;margin:0}.custom-item-color input{width:35px;height:29px;padding:2px;border:1px solid var(--border);border-radius:5px;background:transparent;cursor:pointer}.appearance-error{margin-top:10px;padding:9px 10px;border:1px solid color-mix(in srgb,var(--danger,#e5534b) 35%,var(--border));border-radius:7px;font-size:12px;line-height:1.5;color:var(--danger,#e5534b);background:color-mix(in srgb,var(--danger,#e5534b) 5%,var(--surface))}.appearance-error>div{display:flex;gap:12px;margin-top:5px}.appearance-error button{padding:2px 0;color:var(--primary);font-size:12px}
</style>
