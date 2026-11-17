<script setup lang="ts">
import {computed,nextTick,ref,watch} from 'vue'
import {AlertCircle,ArrowUp,ArrowDown,BookOpen,CalendarDays,CheckCheck,FileText,FolderKanban,Plus,Search,Trash2} from 'lucide-vue-next'
import type {Collection,Source,Workspace,WorkspaceRecord} from '@nextspace/contracts'
import {addSuggestedGroups,nextSourceGroupDraftId,reorderSourceGroups,sourceGroupNameKey,sourceGroupPresets,spaceSourceIds} from '@nextspace/core/source-groups.mjs'
import OrganizationTagPicker from './OrganizationTagPicker.vue'
const props=defineProps<{workspace:Workspace;collections:Collection[];records?:WorkspaceRecord[];spaceId:string;locked?:boolean}>()
const emit=defineEmits<{'update:workspace':[workspace:Workspace];pending:[value:boolean]}>()
const clone=()=>JSON.parse(JSON.stringify(props.workspace)) as Workspace
const groups=computed(()=>(props.workspace.categories||[]).filter(group=>group.spaceId===props.spaceId))
const space=computed(()=>props.workspace.spaces.find(item=>item.id===props.spaceId))
const overview=computed(()=>props.spaceId==='all'),ownerName=computed(()=>overview.value?'My overview':space.value?.name||'this Space')
const availableOwner=computed(()=>overview.value||Boolean(space.value))
const memberIds=computed(()=>new Set(spaceSourceIds(props.workspace,props.spaceId,props.collections.map(item=>item.id))))
const wholeGroups=computed(()=>groups.value.filter(group=>!group.tagNames?.length))
const assignment=computed(()=>new Map(wholeGroups.value.flatMap(group=>group.collectionIds.map(id=>[id,group.id] as const))))
const names=computed(()=>new Set(groups.value.map(group=>sourceGroupNameKey(group.name))))
const selectedPresets=ref<string[]>([]),showSuggestions=ref(true),search=ref(''),sourceScope=ref('space')
const pendingAssignment=ref<{id:string;groupId:string;title:string;before:string;after:string;outside:boolean}|null>(null)
watch(()=>Boolean(pendingAssignment.value),value=>emit('pending',value))
const sourceIcons={calendar:CalendarDays,tasks:CheckCheck,deck:FolderKanban,notes:FileText,collectives:BookOpen}
const sourceNames:Record<Source,string>={calendar:'Calendar',tasks:'Task list',deck:'Deck board',notes:'Notes',collectives:'Collective'}
const availablePresets=computed(()=>selectedPresets.value.filter(key=>{const preset=sourceGroupPresets.find(item=>item.key===key);return preset&&!names.value.has(sourceGroupNameKey(preset.name))}))
type SourceRow=Partial<Collection>&{id:string;title:string;missing?:boolean}
const rows=computed(()=>{
  const result:SourceRow[]=props.collections.map(item=>({...item})),known=new Set(result.map(item=>item.id))
  for(const id of memberIds.value)if(!known.has(id))result.push({id,title:'Unavailable source',missing:true})
  const query=search.value.trim().toLocaleLowerCase()
  return result.filter(item=>(sourceScope.value==='all'||memberIds.value.has(item.id))&&(!query||`${item.title} ${item.id} ${item.source?sourceNames[item.source]:''}`.toLocaleLowerCase().includes(query))).sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id))
})
const ungrouped=computed(()=>[...memberIds.value].filter(id=>!assignment.value.has(id)).length)
function updateGroup(id:string,field:'name'|'color',value:string){if(props.locked)return;const next=clone(),group=next.categories?.find(item=>item.id===id&&item.spaceId===props.spaceId);if(group){group[field]=value;emit('update:workspace',next)}}
function updateTags(id:string,value:string[]){if(props.locked)return;const next=clone(),group=next.categories?.find(item=>item.id===id&&item.spaceId===props.spaceId);if(group){if(value.length)group.tagNames=value;else delete group.tagNames;emit('update:workspace',next)}}
function toggleTagSource(id:string,sourceId:string){if(props.locked||!memberIds.value.has(sourceId))return;const next=clone(),group=next.categories?.find(item=>item.id===id&&item.spaceId===props.spaceId);if(group?.tagNames?.length){group.collectionIds=group.collectionIds.includes(sourceId)?group.collectionIds.filter(value=>value!==sourceId):[...group.collectionIds,sourceId];emit('update:workspace',next)}}
function customGroup(){
  if(props.locked||!availableOwner.value)return
  const next=clone(),id=nextSourceGroupDraftId(next);next.categories=[...(next.categories||[]),{id,spaceId:props.spaceId,name:'',color:space.value?.color||'#0082c9',collectionIds:[]}]
  emit('update:workspace',next);void nextTick(()=>document.getElementById(`category-name-${id}`)?.focus())
}
function addPresets(){if(props.locked||!availablePresets.value.length)return;let next=clone();for(const key of availablePresets.value)next=addSuggestedGroups(next,props.spaceId,[key],()=>nextSourceGroupDraftId(next));emit('update:workspace',next);selectedPresets.value=[]}
function removeGroup(id:string){
  if(props.locked)return
  const next=clone(),group=next.categories?.find(item=>item.id===id&&item.spaceId===props.spaceId),owner=next.spaces.find(item=>item.id===props.spaceId)
  if(!group||!owner&&!overview.value)return
  if(owner)owner.collectionIds=[...new Set([...owner.collectionIds,...group.collectionIds])]
  next.categories=next.categories?.filter(item=>item.id!==id)
  for(const project of next.projects)if(project.spaceId===props.spaceId&&project.categoryId===id)delete project.categoryId
  if(next.planner.scopeId===id)next.planner.scopeId=props.spaceId
  delete next.planner.scopeAssignments[id]
  if(next.planner.arrangements)delete next.planner.arrangements[id]
  if(pendingAssignment.value?.groupId===id)pendingAssignment.value=null
  emit('update:workspace',next)
}
function requestAssignment(row:SourceRow,groupId:string,event:Event){
  const oldId=assignment.value.get(row.id)||'';(event.target as HTMLSelectElement).value=oldId
  if(props.locked||oldId===groupId)return
  const target=wholeGroups.value.find(group=>group.id===groupId)
  if(groupId&&!target)return
  const before=groups.value.find(group=>group.id===oldId)?.name||'Ungrouped sources',after=target?.name||'Ungrouped sources',outside=!memberIds.value.has(row.id)
  if(oldId||outside){pendingAssignment.value={id:row.id,groupId,title:row.missing?row.id:row.title,before,after,outside};return}
  applyAssignment(row.id,groupId)
}
function applyAssignment(id:string,groupId:string){
  if(props.locked)return
  const next=clone(),owner=next.spaces.find(item=>item.id===props.spaceId)
  if(!owner&&!overview.value)return
  const existing=memberIds.value.has(id)
  for(const group of next.categories||[])if(group.spaceId===props.spaceId&&!group.tagNames?.length)group.collectionIds=group.collectionIds.filter(value=>value!==id)
  const target=next.categories?.find(group=>group.id===groupId&&group.spaceId===props.spaceId&&!group.tagNames?.length)
  if(target)target.collectionIds.push(id)
  if(owner&&(target||existing))owner.collectionIds=[...new Set([...owner.collectionIds,id])]
  pendingAssignment.value=null;emit('update:workspace',next)
}
function moveGroup(id:string,delta:number){if(!props.locked)emit('update:workspace',reorderSourceGroups(props.workspace,props.spaceId,id,delta))}
</script>
<template>
  <div class="source-groups-editor">
    <div class="group-heading"><h3>Source groups</h3><button type="button" class="text-button" :disabled="locked||!availableOwner" @click="customGroup"><Plus :size="15"/>Create custom group</button></div>
    <p class="field-hint">Keep related calendars, task lists and boards together in {{ownerName}}. {{overview?'Your Spaces stay independent.':'Other Spaces and My overview stay independent.'}}</p>
    <section v-if="showSuggestions" class="group-suggestions" aria-label="Suggested groups">
      <header><strong>Suggested groups</strong><button type="button" class="text-button" :disabled="locked" @click="showSuggestions=false;selectedPresets=[]">Skip for now</button></header>
      <div class="suggestion-grid"><label v-for="preset in sourceGroupPresets" :key="preset.key" :class="{added:names.has(sourceGroupNameKey(preset.name))}"><input v-model="selectedPresets" type="checkbox" :value="preset.key" :disabled="locked||names.has(sourceGroupNameKey(preset.name))" :aria-label="'Suggest '+preset.name"/><span><strong>{{preset.name}}</strong><small>{{names.has(sourceGroupNameKey(preset.name))?'Already added':preset.description}}</small></span></label></div>
      <button type="button" class="button quiet" :disabled="locked||!availablePresets.length" @click="addPresets"><Plus :size="14"/>Add selected groups</button>
      <p class="field-hint">Optional starting points. Sources are assigned by you; nothing is saved until you save these groups.</p>
    </section>
    <button v-else type="button" class="text-button show-suggestions" :disabled="locked" @click="showSuggestions=true">Show suggested groups</button>
    <div v-if="groups.length" class="category-list"><div v-for="(group,index) in groups" :key="group.id" class="category-edit-row" :data-category-id="group.id">
      <input :value="group.color" type="color" :disabled="locked" :aria-label="`Color for ${group.name||'source group '+(index+1)}`" @input="updateGroup(group.id,'color',($event.target as HTMLInputElement).value)"/>
      <input :id="`category-name-${group.id}`" :value="group.name" :disabled="locked" :aria-label="`Source group name ${index+1}`" maxlength="200" placeholder="e.g. Work or Shared" @input="updateGroup(group.id,'name',($event.target as HTMLInputElement).value)"/>
      <small>{{group.collectionIds.length}} {{group.collectionIds.length===1?'source':'sources'}}</small><button type="button" class="icon-button" :disabled="locked" :aria-label="`Remove source group ${group.name||index+1}`" title="Remove group; keep all native items" @click="removeGroup(group.id)"><Trash2 :size="15"/></button>
      <div class="group-order-actions"><button type="button" class="icon-button" :disabled="locked||index===0" :aria-label="`Move ${group.name||'group'} up`" @click="moveGroup(group.id,-1)"><ArrowUp :size="14"/></button><button type="button" class="icon-button" :disabled="locked||index===groups.length-1" :aria-label="`Move ${group.name||'group'} down`" @click="moveGroup(group.id,1)"><ArrowDown :size="14"/></button></div><div class="category-tag-settings"><OrganizationTagPicker :workspace="workspace" :records="records||[]" :collections="collections" :space-id="spaceId" :collection-ids="group.collectionIds" :model-value="group.tagNames" :disabled="locked" @update:model-value="updateTags(group.id,$event)"/><details v-if="group.tagNames?.length"><summary>Matching sources · {{group.collectionIds.length||(overview?'All loaded sources':'All in Space')}}</summary><p class="field-hint">Select sources to narrow this tag group. An empty selection uses {{overview?'all loaded task, calendar and Deck sources':'every source in this Space'}}.</p><label v-for="collection in collections.filter(item=>memberIds.has(item.id))" :key="collection.id" class="tag-source-choice"><input type="checkbox" :checked="group.collectionIds.includes(collection.id)" :disabled="locked" @change="toggleTagSource(group.id,collection.id)"/>{{collection.title}}</label></details></div>
    </div></div>
    <p v-else class="empty-groups">No source groups yet. Sources can stay ungrouped, or you can add a suggested or custom group.</p>
    <div class="group-heading connections-heading"><h3>Source assignments</h3><small>{{ungrouped}} ungrouped</small></div>
    <div class="category-source-tools"><label class="category-search"><Search :size="15"/><input v-model="search" type="search" :disabled="locked" aria-label="Find a source to group" placeholder="Find a source…"/></label><select v-if="!overview" v-model="sourceScope" :disabled="locked" aria-label="Sources to show"><option value="space">In this Space</option><option value="all">All Nextcloud sources</option></select></div>
    <div v-if="pendingAssignment" class="assignment-confirm" role="alert"><strong>{{pendingAssignment.title}}</strong><p>{{pendingAssignment.outside?'This source is not in this Space yet.':pendingAssignment.before+' → '+pendingAssignment.after}}</p><p v-if="pendingAssignment.outside">Add to {{space?.name||'this Space'}} and {{pendingAssignment.after}}?</p><div><button type="button" class="button quiet" :disabled="locked" @click="pendingAssignment=null">Keep assignment</button><button type="button" class="button primary" :disabled="locked" @click="applyAssignment(pendingAssignment.id,pendingAssignment.groupId)">{{pendingAssignment.outside?'Add to this Space and group':'Move source'}}</button></div></div>
    <div class="category-source-table" aria-label="Source group assignments"><div v-for="row in rows" :key="row.id" class="category-source-row" :data-source-id="row.id">
      <div class="category-source-name"><i :style="{background:row.color||'var(--muted)'}"/><component :is="row.source?sourceIcons[row.source]:AlertCircle" :size="17"/><span><strong>{{row.title}}</strong><small v-if="row.missing">{{row.id}} · saved connection retained</small><small v-else>{{row.source?sourceNames[row.source]:''}}{{row.readonly?' · Read-only contents':''}}{{!memberIds.has(row.id)?' · Not in this Space':''}}</small></span></div>
      <select :value="assignment.get(row.id)||''" :disabled="locked||Boolean(pendingAssignment)" :aria-label="`Source group for ${row.source?sourceNames[row.source]+': ':''}${row.missing?row.id:row.title}`" @change="requestAssignment(row,($event.target as HTMLSelectElement).value,$event)"><option value="">Ungrouped sources</option><option v-for="(group,index) in wholeGroups" :key="group.id" :value="group.id">{{group.name.trim()||`New source group ${index+1}`}}</option></select>
    </div><div v-if="!rows.length" class="empty-groups"><p>{{search?'No matching sources.':'No sources selected for this Space.'}}</p><button v-if="sourceScope==='space'&&!search" type="button" class="text-button" :disabled="locked" @click="sourceScope='all'">Choose from all Nextcloud sources</button></div></div>
    <p class="field-hint">One whole-source group per source. Tag groups may share sources. Removing a group keeps its sources. Grouping never moves native content or changes access.</p>
  </div>
</template>
<style scoped>
.category-tag-settings{grid-column:1/-1;min-width:0}.category-tag-settings details{font-size:12px}.tag-source-choice{display:flex;flex-direction:row;gap:8px;align-items:center;margin:6px 0;font-size:12px}.tag-source-choice input{width:16px;height:16px;accent-color:var(--primary)}
.source-groups-editor{min-width:0}.group-order-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:4px}.group-order-actions .icon-button{min-height:32px}.group-heading,.group-suggestions header{display:flex;justify-content:space-between;align-items:center;gap:12px}.group-heading h3{font-size:16px;margin:0}.group-heading small{color:var(--muted);font-size:12px}.group-suggestions{border:1px solid var(--border);border-radius:10px;padding:13px;margin:14px 0}.group-suggestions header strong{font-size:13px}.suggestion-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.suggestion-grid label{display:flex;gap:8px;align-items:flex-start;border:1px solid var(--border);padding:9px;border-radius:7px;cursor:pointer;margin:0}.suggestion-grid label.added{opacity:.6}.suggestion-grid input{width:16px;height:16px;flex:none;margin-top:2px;accent-color:var(--primary)}.suggestion-grid strong,.suggestion-grid small{display:block;font-size:12px}.suggestion-grid small{font-size:11px;color:var(--muted);font-weight:400;margin-top:4px}.show-suggestions{margin:10px 0}.category-list{display:grid;gap:8px;margin:15px 0}.category-edit-row{display:grid;grid-template-columns:32px minmax(100px,1fr) 64px 30px;align-items:center;gap:8px}.category-edit-row input[type=color]{width:32px;height:32px;padding:3px}.category-edit-row input:not([type=color]){padding:8px;font-size:13px}.category-edit-row small{font-size:11px;text-align:right;color:var(--muted)}.empty-groups{padding:15px;color:var(--muted);font-size:12px;line-height:1.6}.connections-heading{margin-top:22px}.category-source-tools{display:flex;gap:8px;margin:12px 0}.category-search{display:flex;flex-direction:row;flex:1;align-items:center;gap:6px;padding:0 9px;border:1px solid var(--border);border-radius:8px;min-width:0}.category-search input{padding:9px 0;border:0;background:none;min-width:0;font-size:12px}.category-source-tools>select{width:180px;font-size:12px}.category-source-table{max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:9px}.category-source-row{display:grid;grid-template-columns:minmax(0,1fr) 180px;align-items:center;gap:12px;padding:10px;border-bottom:1px solid var(--border)}.category-source-row:last-child{border:0}.category-source-name{display:flex;align-items:center;gap:7px;min-width:0}.category-source-name>i{width:4px;align-self:stretch;border-radius:2px;flex:none;min-height:28px}.category-source-name>svg{flex:none;color:var(--muted)}.category-source-name strong,.category-source-name small{display:block;overflow-wrap:anywhere}.category-source-name strong{font-size:12px}.category-source-name small{font-size:11px;color:var(--muted);margin-top:3px}.category-source-row select{font-size:12px;padding:8px}.assignment-confirm{border:1px solid var(--primary);border-radius:9px;background:var(--primary-soft);color:var(--primary-soft-text);padding:13px;margin:12px 0;font-size:13px}.assignment-confirm p{margin:8px 0}.assignment-confirm>div{display:flex;gap:8px;flex-wrap:wrap}.field-hint{font-size:12px;line-height:1.6;margin:9px 0}.button,.text-button{font-size:12px}
@media(max-width:600px){.suggestion-grid{grid-template-columns:1fr}.group-heading{align-items:flex-start}.category-edit-row{grid-template-columns:30px minmax(80px,1fr) 28px}.category-edit-row small{display:none}.category-source-tools{flex-wrap:wrap}.category-search{flex-basis:100%}.category-source-tools>select{width:100%}.category-source-row{grid-template-columns:1fr;gap:8px}.category-source-row select{width:100%}.category-source-table{max-height:260px}}
</style>
