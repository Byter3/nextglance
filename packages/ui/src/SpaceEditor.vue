<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {AlertCircle,Search,Trash2} from 'lucide-vue-next'
import type {Collection,Source,Workspace,WorkspaceRecord} from '@nextspace/contracts'
import {commitSourceGroupIds,sourceGroupNameError,spaceSourceIds} from '@nextspace/core/source-groups.mjs'
import SourceGroupsEditor from './SourceGroupsEditor.vue'
const props=defineProps<{workspace:Workspace;collections:Collection[];records?:WorkspaceRecord[];spaceId?:string;locked:boolean}>()
const emit=defineEmits<{save:[workspace:Workspace];dirty:[value:boolean];cancel:[];remove:[id:string]}>()
const clone=(value:Workspace)=>JSON.parse(JSON.stringify(value)) as Workspace
const id=props.spaceId||crypto.randomUUID(),initial=clone(props.workspace)
if(!props.spaceId)initial.spaces.push({id,name:'',color:'#0082c9',collectionIds:[]})
const baseline=JSON.stringify(initial),draft=ref(initial),search=ref(''),error=ref(''),pendingGroup=ref(false),pendingRemoval=ref<{id:string;title:string;projects:string[];recordIds:string[]}|null>(null)
const space=computed(()=>draft.value.spaces.find(item=>item.id===id))
const memberIds=computed(()=>new Set(spaceSourceIds(draft.value,id)))
const dirty=computed(()=>JSON.stringify(draft.value)!==baseline)
const invalid=computed(()=>sourceGroupNameError(draft.value,id))
const sourceNames:Record<Source,string>={calendar:'Calendar',tasks:'Task list',deck:'Deck board',notes:'Notes',collectives:'Collective'}
type SourceRow=Partial<Collection>&{id:string;title:string;missing?:boolean}
const rows=computed(()=>{
  const all:SourceRow[]=props.collections.map(item=>({...item})),known=new Set(all.map(item=>item.id))
  for(const sourceId of memberIds.value)if(!known.has(sourceId))all.push({id:sourceId,title:'Unavailable source',missing:true})
  const query=search.value.trim().toLocaleLowerCase()
  return all.filter(item=>!query||`${item.title} ${item.id} ${item.source?sourceNames[item.source]:''}`.toLocaleLowerCase().includes(query)).sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id))
})
const defaults=[{key:'defaultCalendarId' as const,source:'calendar',label:'Calendar'},{key:'defaultTaskListId' as const,source:'tasks',label:'Task list'},{key:'defaultBoardId' as const,source:'deck',label:'Deck board'}]
watch([dirty,pendingGroup,()=>Boolean(pendingRemoval.value)],()=>emit('dirty',dirty.value||pendingGroup.value||Boolean(pendingRemoval.value)),{immediate:true})
function sourceContext(sourceId:string){
  const groups=(draft.value.categories||[]).filter(group=>group.spaceId===id&&group.collectionIds.includes(sourceId)).map(group=>group.name||'Unnamed group')
  const projects=draft.value.projects.filter(project=>project.spaceId===id&&project.collectionIds.includes(sourceId)).map(project=>project.name)
  return [groups.length?'Group: '+groups.join(', '):'',projects.length?'Project source: '+projects.join(', '):''].filter(Boolean).join(' · ')
}
function toggleSource(row:SourceRow,event:Event){
  const selected=memberIds.value.has(row.id);(event.target as HTMLInputElement).checked=selected
  if(props.locked||!space.value)return
  if(!selected){space.value.collectionIds=[...new Set([...space.value.collectionIds,row.id])];return}
  const knownRecordIds=new Set((props.records||[]).filter(record=>record.collectionId===row.id).map(record=>record.id))
  const projects=draft.value.projects.filter(project=>project.spaceId===id&&(project.collectionIds.includes(row.id)||project.recordIds.some(recordId=>knownRecordIds.has(recordId))))
  if(projects.length){pendingRemoval.value={id:row.id,title:row.missing?row.id:row.title,projects:projects.map(project=>project.name),recordIds:[...knownRecordIds]};return}
  removeSource(row.id,[])
}
function removeSource(sourceId:string,recordIds:string[]){
  if(props.locked||!space.value)return
  space.value.collectionIds=spaceSourceIds(draft.value,id).filter(value=>value!==sourceId)
  for(const group of draft.value.categories||[])if(group.spaceId===id)group.collectionIds=group.collectionIds.filter(value=>value!==sourceId)
  for(const project of draft.value.projects)if(project.spaceId===id){project.collectionIds=project.collectionIds.filter(value=>value!==sourceId);project.recordIds=project.recordIds.filter(value=>!recordIds.includes(value))}
  for(const choice of defaults)if(space.value[choice.key]===sourceId)delete space.value[choice.key]
  pendingRemoval.value=null
}
function save(){
  if(props.locked||pendingGroup.value||pendingRemoval.value||!space.value)return
  error.value=!space.value.name.trim()?'Give this Space a name.':invalid.value;if(error.value)return
  const next=commitSourceGroupIds(clone(draft.value),id),owner=next.spaces.find(item=>item.id===id)!
  owner.name=owner.name.trim();owner.collectionIds=spaceSourceIds(next,id)
  for(const choice of defaults)if(!owner[choice.key]||!owner.collectionIds.includes(owner[choice.key]!))delete owner[choice.key]
  for(const group of next.categories||[])if(group.spaceId===id)group.name=group.name.trim()
  draft.value=clone(next)
  next.planner.scopeId=id;emit('save',next)
}
</script>
<template>
  <div v-if="space" class="space-editor">
    <span class="eyebrow">INDEPENDENT VIEW</span><h2>{{spaceId?'Manage Space':'Create Space'}}</h2>
    <p class="field-hint">Choose sources and organize them for this Space. My overview and other Spaces keep their own view.</p>
    <form @submit.prevent="save"><fieldset :disabled="locked">
      <div class="space-name-fields"><label>Name<input id="scope-name" v-model="space.name" maxlength="200" required placeholder="e.g. Daily life" autofocus/></label><label>Color<input v-model="space.color" type="color" aria-label="Space color"/></label></div>
      <section aria-label="Space sources"><div class="space-section-heading"><h3>Sources</h3><small>{{memberIds.size}} selected</small></div><p class="field-hint">Choose any combination. The same source can appear in several Spaces.</p>
        <label class="space-source-search"><Search :size="15"/><input v-model="search" type="search" aria-label="Find Space sources" placeholder="Find a calendar, board or task list…"/></label>
        <div v-if="pendingRemoval" class="source-removal-confirm" role="alert"><AlertCircle :size="18"/><div><strong>Remove {{pendingRemoval.title}} from this Space?</strong><p>Also update these project selections: {{pendingRemoval.projects.join(', ')}}. Their selected items from this source will be removed from these project views. Native content stays unchanged.</p><div><button type="button" class="button quiet" @click="pendingRemoval=null">Keep source</button><button type="button" class="button danger" @click="removeSource(pendingRemoval.id,pendingRemoval.recordIds)">Remove source and update projects</button></div></div></div>
        <div class="space-source-list"><label v-for="row in rows" :key="row.id" class="space-source-row" :data-source-id="row.id"><input type="checkbox" :checked="memberIds.has(row.id)" :disabled="Boolean(pendingRemoval)" :aria-label="`Include ${row.source?sourceNames[row.source]+': ':''}${row.missing?row.id:row.title}`" @change="toggleSource(row,$event)"/><i :style="{background:row.color||'var(--muted)'}"/><span><strong>{{row.title}}</strong><small>{{row.missing?row.id+' · saved connection retained':(row.source?sourceNames[row.source]:'')+(row.readonly?' · Read-only contents':'')}}</small><small v-if="sourceContext(row.id)">{{sourceContext(row.id)}}</small></span></label><p v-if="!rows.length" class="field-hint">{{search?'No matching sources.':'No sources loaded yet. You can create an empty Space and add sources later.'}}</p></div>
        <details v-if="memberIds.size" class="space-defaults"><summary>Default destinations for new items</summary><label v-for="choice in defaults" :key="choice.key">{{choice.label}}<select v-model="space[choice.key]"><option value="">Choose when creating</option><option v-if="space[choice.key]&&!collections.some(item=>item.id===space![choice.key]&&item.source===choice.source&&!item.readonly)" :value="space[choice.key]">Unavailable destination (retained)</option><option v-for="collection in collections.filter(item=>item.source===choice.source&&!item.readonly&&memberIds.has(item.id))" :key="collection.id" :value="collection.id">{{collection.title}}</option></select></label></details>
      </section>
      <section class="space-groups"><SourceGroupsEditor v-model:workspace="draft" :collections="collections" :records="records" :space-id="id" :locked="locked||Boolean(pendingRemoval)" @pending="pendingGroup=$event"/></section>
    </fieldset><p v-if="error" class="inline-error" role="alert">{{error}}</p><p v-else-if="dirty&&invalid" class="field-hint">{{invalid}}</p>
    <div class="form-actions"><button v-if="spaceId" type="button" class="button danger quiet" :disabled="locked" @click="emit('remove',id)"><Trash2 :size="14"/>Remove Space</button><button type="button" class="button quiet" :disabled="locked" @click="emit('cancel')">Cancel</button><button class="button primary" :disabled="locked||!space.name.trim()||Boolean(invalid)||pendingGroup||Boolean(pendingRemoval)">{{spaceId?'Save changes':'Create Space'}}</button></div></form>
  </div>
</template>
<style scoped>
.space-editor h2{font-size:24px;margin:8px 0 12px}.space-editor fieldset{padding:0;margin:0;border:0;min-width:0}.space-name-fields{display:grid;grid-template-columns:1fr 70px;gap:16px;margin:18px 0}.space-name-fields label{font-size:13px}.space-name-fields input{margin-top:7px}.space-name-fields input[type=color]{width:100%;height:40px;padding:4px}.space-section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.space-section-heading h3{font-size:16px}.space-section-heading small{font-size:12px;color:var(--muted)}.field-hint{font-size:12px;color:var(--muted);line-height:1.6;margin:9px 0}.space-source-search{display:flex;flex-direction:row;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--border);border-radius:8px;margin:12px 0}.space-source-search input{border:0;background:transparent;padding:9px 0;min-width:0;font-size:12px}.space-source-list{border:1px solid var(--border);border-radius:9px;max-height:250px;overflow:auto;padding:3px}.space-source-row{display:flex;flex-direction:row;align-items:center;gap:9px;padding:9px;cursor:pointer;margin:0;border-bottom:1px solid var(--border)}.space-source-row:last-child{border:0}.space-source-row input{width:16px;height:16px;accent-color:var(--primary);flex:none}.space-source-row i{align-self:stretch;width:4px;border-radius:2px;flex:none}.space-source-row strong,.space-source-row small{display:block;overflow-wrap:anywhere}.space-source-row strong{font-size:12px;font-weight:500}.space-source-row small{color:var(--muted);font-size:11px;margin-top:3px}.space-defaults{margin:15px 0;font-size:12px}.space-defaults label{margin:10px 0;display:grid;grid-template-columns:85px 1fr;align-items:center;gap:10px}.space-defaults select{font-size:12px}.space-groups{border-top:1px solid var(--border);margin-top:22px;padding-top:20px}.source-removal-confirm{display:flex;align-items:flex-start;gap:9px;padding:13px;border:1px solid var(--border);border-radius:8px;background:var(--hover);margin:12px 0;font-size:12px}.source-removal-confirm>svg{flex:none}.source-removal-confirm p{margin:8px 0;line-height:1.6}.source-removal-confirm div>div{display:flex;gap:7px;flex-wrap:wrap}.source-removal-confirm button{font-size:12px}.space-editor .form-actions{position:sticky;bottom:-29px;background:var(--surface);z-index:2;border-top:1px solid var(--border);padding:14px 0;margin:20px 0 -14px;flex-wrap:wrap}.space-editor .form-actions button{font-size:12px}.inline-error{font-size:13px;margin-top:10px}
@media(max-width:600px){.space-editor .form-actions{bottom:-20px}.space-name-fields{grid-template-columns:minmax(0,1fr) 55px;gap:10px}.space-defaults label{grid-template-columns:1fr;gap:5px}.space-editor h2{font-size:22px}}
</style>
