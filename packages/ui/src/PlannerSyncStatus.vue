<script setup lang="ts">
import {computed} from 'vue'
import {FolderSync} from 'lucide-vue-next'
import type {State} from '@nextspace/contracts'
import {plannerSyncStatus} from '@nextspace/core/planner-sync-status.mjs'
const props=defineProps<{storage:State['storage'];connection:State['connection'];restoring?:boolean;syncing?:boolean;online:boolean;retryDisabled:boolean;plannerVerifiedAt?:string}>()
const emit=defineEmits<{retry:[]}>()
const status=computed(()=>plannerSyncStatus(props))
const stage=computed(()=>({authorization:'Nextcloud authorization','planner-read':'Reading planner files','planner-write':'Saving planner files','local-cache':'Device storage'} as Record<string,string>)[status.value.errorStage||'']||status.value.errorStage)
const lastSync=computed(()=>status.value.lastSyncedAt&&Number.isFinite(Date.parse(status.value.lastSyncedAt))?new Date(status.value.lastSyncedAt).toLocaleString():'Not yet')
</script>

<template>
  <div class="planner-source-status" aria-label="Planner data sync status">
    <FolderSync :size="15" :class="{spinning:status.state==='syncing'}"/>
    <strong>Planner data</strong>
    <span class="status-pill" :class="{connected:status.state==='synced',error:['conflict','error'].includes(status.state),unavailable:['authorization','offline','local'].includes(status.state)}">{{status.label}}</span>
    <button class="text-button" :disabled="retryDisabled||status.state==='syncing'||status.state==='restoring'||!online" @click="emit('retry')">Sync planner</button>
    <p>{{status.message}}</p>
    <p class="sync-diagnostic planner-folder">{{status.folder}}</p>
    <p class="sync-diagnostic"><template v-if="stage||status.errorCode">{{[stage,status.errorCode].filter(Boolean).join(' · ')}} · </template>Last successful sync: {{lastSync}}</p>
  </div>
</template>

<style scoped>
.planner-source-status>button{margin-left:auto}.planner-source-status>p{margin:0}.planner-folder{overflow-wrap:anywhere}
</style>
