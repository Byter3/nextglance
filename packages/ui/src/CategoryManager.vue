<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import type {Collection,Workspace,WorkspaceRecord} from '@nextspace/contracts'
import {commitSourceGroupIds,sourceGroupNameError,spaceSourceIds} from '@nextspace/core/source-groups.mjs'
import SourceGroupsEditor from './SourceGroupsEditor.vue'
const props=defineProps<{workspace:Workspace;collections:Collection[];records?:WorkspaceRecord[];spaceId:string;locked:boolean}>()
const emit=defineEmits<{save:[workspace:Workspace];cancel:[];dirty:[value:boolean]}>()
const draft=ref<Workspace>(JSON.parse(JSON.stringify(props.workspace))),pending=ref(false),error=ref('')
const space=computed(()=>draft.value.spaces.find(item=>item.id===props.spaceId))
const availableOwner=computed(()=>props.spaceId==='all'||Boolean(space.value))
const dirty=computed(()=>JSON.stringify(draft.value)!==JSON.stringify(props.workspace))
const invalid=computed(()=>sourceGroupNameError(draft.value,props.spaceId))
watch([dirty,pending],()=>emit('dirty',dirty.value||pending.value),{immediate:true})
function save(){
  if(props.locked||pending.value||!availableOwner.value)return
  error.value=invalid.value;if(error.value)return
  const next=commitSourceGroupIds(JSON.parse(JSON.stringify(draft.value)),props.spaceId),owner=next.spaces.find(item=>item.id===props.spaceId)
  if(owner)owner.collectionIds=spaceSourceIds(next,props.spaceId)
  for(const group of next.categories||[])if(group.spaceId===props.spaceId)group.name=group.name.trim()
  draft.value=JSON.parse(JSON.stringify(next))
  emit('save',next)
}
</script>
<template>
  <div class="category-manager"><span class="eyebrow">{{spaceId==='all'?'MY OVERVIEW':space?.name||'SPACE'}}</span><h2>Group sources</h2>
    <form @submit.prevent="save"><SourceGroupsEditor v-model:workspace="draft" :collections="collections" :records="records" :space-id="spaceId" :locked="locked" @pending="pending=$event"/>
      <p v-if="error" class="inline-error" role="alert">{{error}}</p><p v-else-if="dirty&&invalid" class="field-hint">{{invalid}}</p>
      <div class="form-actions"><button type="button" class="button quiet" :disabled="locked" @click="emit('cancel')">Cancel</button><button class="button primary" :disabled="locked||!availableOwner||!dirty||Boolean(invalid)||pending">Save source groups</button></div>
    </form>
  </div>
</template>
<style scoped>
.category-manager h2{font-size:24px;line-height:1.3;margin:8px 28px 20px 0}.category-manager .form-actions{position:sticky;bottom:-29px;z-index:2;background:var(--surface);padding:14px 0;border-top:1px solid var(--border);margin:20px 0 -14px}.inline-error,.field-hint{font-size:12px;margin-top:12px}
@media(max-width:600px){.category-manager h2{font-size:22px}.category-manager .form-actions{bottom:-20px}}
</style>
