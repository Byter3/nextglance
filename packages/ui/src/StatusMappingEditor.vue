<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {ArrowLeft,ArrowRight,GripVertical,Plus,Search,X,FolderKanban,CheckCheck} from 'lucide-vue-next'
import type {Collection,StatusMapping,WorkspaceRecord} from '@nextspace/contracts'
import {defaultStatusMapping,normalizeStatusMapping,statusSourceOptions,UNMAPPED_COLUMN} from '@nextspace/core/status-mapping.mjs'
const props=defineProps<{mapping?:StatusMapping;collections:Collection[];records:WorkspaceRecord[];busy?:boolean;error?:string;scopeName?:string;inherited?:boolean;allowDefault?:boolean}>()
const emit=defineEmits<{save:[mapping:StatusMapping];cancel:[];dirty:[value:boolean];useDefault:[]}>()
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value))
const draft=ref<StatusMapping>(clone(normalizeStatusMapping(props.mapping)||defaultStatusMapping(props.collections)))
const baseline=JSON.stringify(draft.value)
const query=ref(''),dragged=ref(''),dropColumn=ref('')
const allSources=computed(()=>statusSourceOptions(props.collections,props.records,draft.value))
const filteredSources=computed(()=>allSources.value.filter(source=>`${source.title} ${source.sourceTitle} ${source.source}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const lanes=computed(()=>[{id:UNMAPPED_COLUMN,title:'Unmapped statuses',color:'#8b939f'},...draft.value.columns])
const validation=computed(()=>{
  if(!draft.value.columns.length)return 'Keep at least one board column.'
  if(draft.value.columns.some(column=>!column.title.trim()))return 'Give every column a name.'
  const names=draft.value.columns.map(column=>column.title.trim().toLocaleLowerCase())
  if(new Set(names).size!==names.length)return 'Use different names so each column is easy to identify.'
  return ''
})
watch(draft,()=>emit('dirty',JSON.stringify(draft.value)!==baseline),{deep:true,immediate:true})
function inColumn(key:string,columnId:string){return (draft.value.assignments[key]||UNMAPPED_COLUMN)===columnId}
function assign(key:string,columnId:string){
  if(props.busy||!allSources.value.some(source=>source.key===key))return
  if(columnId===UNMAPPED_COLUMN)delete draft.value.assignments[key]
  else if(draft.value.columns.some(column=>column.id===columnId))draft.value.assignments[key]=columnId
}
function addColumn(){if(!props.busy&&draft.value.columns.length<30)draft.value.columns.push({id:crypto.randomUUID(),title:`Column ${draft.value.columns.length+1}`,color:'#0082c9'})}
function removeColumn(id:string){if(props.busy||draft.value.columns.length===1)return;draft.value.columns=draft.value.columns.filter(column=>column.id!==id);for(const [key,column] of Object.entries(draft.value.assignments))if(column===id)delete draft.value.assignments[key]}
function reorder(id:string,delta:number){const index=draft.value.columns.findIndex(column=>column.id===id),target=index+delta;if(props.busy||index<0||target<0||target>=draft.value.columns.length)return;const [column]=draft.value.columns.splice(index,1);draft.value.columns.splice(target,0,column!)}
function start(event:DragEvent,key:string){if(props.busy||(event.target as Element).closest('select')){event.preventDefault();return}dragged.value=key;event.dataTransfer?.setData('text/plain',key);if(event.dataTransfer)event.dataTransfer.effectAllowed='move'}
function drop(columnId:string){if(dragged.value)assign(dragged.value,columnId);dragged.value='';dropColumn.value=''}
function submit(){if(!props.busy&&!validation.value)emit('save',clone({...draft.value,columns:draft.value.columns.map(column=>({...column,title:column.title.trim()}))}))}
</script>

<template>
  <div class="status-mapping-editor">
    <span class="eyebrow">UNIFIED BOARD</span><h2>Map unified statuses</h2>
    <p class="mapping-intro">{{scopeName?scopeName+' · '+(inherited?'Using the global default. Saving creates a customization for this Space.':'Customized for this Space and its projects/groups.'):'Global default for My overview and Spaces without a customization.'}}</p>
    <p class="mapping-intro">Bring different Deck stacks and task statuses into the same columns. Drag a status, or use its column selector. Your original statuses stay in Nextcloud.</p>
    <div class="mapping-tools"><label class="mapping-search"><Search :size="16"/><input v-model="query" placeholder="Find a board, task list or status…" aria-label="Filter native statuses"/></label><button class="button" :disabled="busy||draft.columns.length>=30" @click="addColumn"><Plus :size="15"/>Add column</button></div>
    <div class="mapping-lanes">
      <section v-for="lane in lanes" :key="lane.id" class="mapping-lane" :class="{unmapped:lane.id===UNMAPPED_COLUMN,'mapping-drop':dropColumn===lane.id}" :data-column-id="lane.id" @dragover.prevent="dragged&&(dropColumn=lane.id)" @dragleave="dropColumn=''" @drop.prevent="drop(lane.id)">
        <header v-if="lane.id===UNMAPPED_COLUMN"><h3>Unmapped statuses</h3><span>{{allSources.filter(source=>inColumn(source.key,lane.id)).length}}</span></header>
        <header v-else>
          <input v-model="draft.columns.find(column=>column.id===lane.id)!.color" type="color" :aria-label="`Color for ${lane.title}`" :disabled="busy"/>
          <input v-model="draft.columns.find(column=>column.id===lane.id)!.title" :aria-label="`Column name ${lane.title}`" maxlength="120" :disabled="busy"/>
          <span>{{allSources.filter(source=>inColumn(source.key,lane.id)).length}}</span>
        </header>
        <div v-if="lane.id!==UNMAPPED_COLUMN" class="mapping-column-actions"><button class="icon-button" :aria-label="`Move ${lane.title} left`" :disabled="busy||draft.columns[0]?.id===lane.id" @click="reorder(lane.id,-1)"><ArrowLeft :size="14"/></button><button class="icon-button" :aria-label="`Move ${lane.title} right`" :disabled="busy||draft.columns.at(-1)?.id===lane.id" @click="reorder(lane.id,1)"><ArrowRight :size="14"/></button><button class="icon-button" :aria-label="`Remove ${lane.title} column`" :disabled="busy||draft.columns.length===1" @click="removeColumn(lane.id)"><X :size="14"/></button></div>
        <p v-if="lane.id===UNMAPPED_COLUMN" class="mapping-lane-hint">These items remain visible in an Unmapped column until you choose where they belong.</p>
        <div class="mapping-native-statuses">
          <div v-for="source in filteredSources.filter(source=>inColumn(source.key,lane.id))" :key="source.key" class="mapping-native-status" :data-status-key="source.key" :draggable="!busy" @dragstart="start($event,source.key)" @dragend="dragged='';dropColumn=''">
            <div class="mapping-status-title"><GripVertical :size="14"/><component :is="source.source==='deck'?FolderKanban:CheckCheck" :size="15"/><strong>{{source.title}}</strong></div>
            <small><span v-if="source.color" class="mapping-source-dot" :style="{background:source.color}"></span>{{source.sourceTitle}}<template v-if="!source.available"> · not loaded</template></small>
            <select :value="draft.assignments[source.key]||UNMAPPED_COLUMN" :disabled="busy" :aria-label="`Column for ${source.sourceTitle}: ${source.title}`" @change="assign(source.key,($event.target as HTMLSelectElement).value)"><option :value="UNMAPPED_COLUMN">Unmapped</option><option v-for="column in draft.columns" :key="column.id" :value="column.id">{{column.title}}</option></select>
          </div>
          <p v-if="!filteredSources.some(source=>inColumn(source.key,lane.id))" class="mapping-empty">{{query?'No matching statuses':'Drop statuses here'}}</p>
        </div>
      </section>
    </div>
    <p class="mapping-footer-hint">Moving a work item on the unified board updates its native status. If several statuses match the destination, you choose one. Removing a column returns its mappings to Unmapped.</p>
    <p v-if="validation||error" role="alert" class="inline-error">{{validation||error}}</p>
    <div class="form-actions"><button v-if="allowDefault" class="button quiet" :disabled="busy||inherited" @click="emit('useDefault')">Use default</button><button class="button quiet" :disabled="busy" @click="emit('cancel')">Cancel</button><button class="button primary" :disabled="busy||Boolean(validation)" @click="submit">{{busy?'Saving…':'Save mapping'}}</button></div>
  </div>
</template>

<style scoped>
.mapping-tools>.mapping-search{flex-direction:row;margin:0;align-items:center}.mapping-search>svg{flex:none;color:var(--muted)}
.status-mapping-editor h2{margin:8px 0 12px}.mapping-intro,.mapping-footer-hint{font-size:13px;line-height:1.6;color:var(--muted)}.mapping-tools{display:flex;gap:16px;align-items:center;margin:18px 0}.mapping-tools>label{display:flex;align-items:center;gap:9px;flex:1;min-width:0}.mapping-tools input{min-width:0;flex:1}.mapping-tools .button{flex:none}.mapping-lanes{display:flex;gap:12px;overflow:auto;max-height:55vh;padding:3px 3px 12px;align-items:stretch}.mapping-lane{width:246px;min-width:246px;display:flex;flex-direction:column;background:var(--hover);border:1px solid var(--border);border-radius:10px;padding:12px;transition:border-color .1s}.mapping-lane.unmapped{background:var(--surface)}.mapping-lane.mapping-drop{border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft)}.mapping-lane>header{display:flex;gap:7px;align-items:center;min-height:38px}.mapping-lane h3{font-size:14px;margin:0;flex:1}.mapping-lane>header input:not([type=color]){width:100%;min-width:0;padding:7px;font-size:13px}.mapping-lane>header input[type=color]{padding:0;width:23px;height:25px;border:0;flex:none}.mapping-lane>header>span{font-size:11px;color:var(--muted)}.mapping-column-actions{display:flex;justify-content:flex-end;gap:4px;margin:3px 0 8px}.mapping-column-actions .icon-button{width:25px;height:25px}.mapping-lane-hint{font-size:11px;line-height:1.5;color:var(--muted);margin:8px 0 12px}.mapping-native-statuses{display:flex;flex-direction:column;gap:9px;flex:1}.mapping-native-status{background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:10px;cursor:grab}.mapping-status-title{display:flex;gap:7px;align-items:flex-start;font-size:12px}.mapping-status-title>svg{flex:none;color:var(--muted)}.mapping-status-title>strong{font-weight:600;overflow-wrap:anywhere}.mapping-native-status>small{display:block;font-size:10px;color:var(--muted);line-height:1.5;margin:6px 0 8px;overflow-wrap:anywhere}.mapping-source-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}.mapping-native-status select{font-size:11px;padding:5px 7px;width:100%;min-width:0;cursor:pointer}.mapping-empty{font-size:12px;line-height:1.6;color:var(--muted);margin:14px 0;text-align:center}.mapping-footer-hint{margin:14px 0 0;font-size:12px}.status-mapping-editor .form-actions{margin-top:18px}@media(max-width:600px){.mapping-tools{align-items:stretch;flex-direction:column;gap:10px}.mapping-lanes{max-height:48vh}.mapping-lane{min-width:225px;width:225px}}
</style>
