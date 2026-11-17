<script setup lang="ts">
import {computed,ref} from 'vue'
import {Search,Tag} from 'lucide-vue-next'
import type {Workspace,WorkspaceRecord,Collection} from '@nextspace/contracts'
import {organizationTagOptions,organizationTagKey,organizationRuleCount,normalizeOrganizationTags} from '@nextspace/core/organization-tags.mjs'
const props=defineProps<{workspace:Workspace;records:WorkspaceRecord[];collections:Collection[];spaceId:string;collectionIds?:string[];recordIds?:string[];modelValue?:string[];disabled?:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:string[]]}>()
const query=ref('')
const selected=computed(()=>new Set((props.modelValue||[]).map(organizationTagKey)))
const options=computed(()=>organizationTagOptions(props.records,props.collections,props.modelValue))
const visible=computed(()=>options.value.filter(option=>option.key.includes(organizationTagKey(query.value))))
const count=computed(()=>organizationRuleCount(props.workspace,props.records,props.spaceId,props.collectionIds,props.modelValue,props.recordIds))
function toggle(title:string){if(props.disabled)return;const key=organizationTagKey(title),current=props.modelValue||[];emit('update:modelValue',selected.value.has(key)?current.filter(value=>organizationTagKey(value)!==key):normalizeOrganizationTags([...current,title]))}
</script>
<template>
  <details class="organization-tags" :open="Boolean(modelValue?.length)">
    <summary><Tag :size="14"/>Narrow by tags<span>{{modelValue?.length||0}} selected · {{count}} matching items</span></summary>
    <p>Match any selected tag within {{collectionIds?.length?'the selected sources':'this Space’s sources'}}. Without tags, selected sources include every item.<template v-if="spaceId!=='all'"> Explicit project items stay included.</template></p>
    <label class="organization-tag-search"><Search :size="14"/><input v-model="query" type="search" placeholder="Find a loaded tag…" aria-label="Find organization tags" :disabled="disabled"/></label>
    <div class="organization-tag-options"><label v-for="option in visible" :key="option.key"><input type="checkbox" :checked="selected.has(option.key)" :disabled="disabled||!selected.has(option.key)&&(modelValue?.length||0)>=100" @change="toggle(option.title)"/><i v-if="option.color" :style="{background:option.color}"/><span>{{option.title}}<small v-if="!option.available"> · unavailable</small></span></label><p v-if="!visible.length">No matching loaded tags.</p></div>
    <button v-if="modelValue?.length" type="button" class="text-button" :disabled="disabled" @click="emit('update:modelValue',[])">Clear tag selection</button>
  </details>
</template>
<style scoped>
.organization-tags{border:1px solid var(--border);border-radius:8px;padding:9px;margin:8px 0;font-size:12px;min-width:0}.organization-tags summary{display:flex;align-items:center;gap:7px;cursor:pointer;flex-wrap:wrap}.organization-tags summary>span{margin-left:auto;color:var(--muted);font-size:11px}.organization-tags p{color:var(--muted);line-height:1.5;margin:9px 0}.organization-tag-search{display:flex;flex-direction:row;align-items:center;gap:7px;margin:8px 0}.organization-tag-search input{min-width:0;font-size:12px;padding:7px}.organization-tag-options{max-height:180px;overflow:auto;display:grid;gap:3px}.organization-tag-options label{display:flex;flex-direction:row;align-items:center;gap:7px;margin:0;padding:5px;cursor:pointer}.organization-tag-options input{width:16px;height:16px;flex:none;accent-color:var(--primary)}.organization-tag-options i{width:8px;height:8px;border-radius:50%;flex:none}.organization-tag-options span{overflow-wrap:anywhere}.organization-tag-options small{color:var(--muted)}.organization-tags .text-button{margin-top:8px;font-size:12px}
</style>
