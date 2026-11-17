<script setup lang="ts">
import {AlertCircle, Cloud} from 'lucide-vue-next'
import type {SyncNotice} from '@nextspace/core/sync-notice.mjs'
defineProps<{notice:SyncNotice; actionDisabled?:boolean}>()
defineEmits<{action:[];details:[]}>()
</script>

<template>
  <div class="notice sync-notice" :class="notice.tone==='warning'?'warning-notice':'offline-notice'" :data-sync-kind="notice.kind" role="status">
    <component :is="notice.tone==='warning'?AlertCircle:Cloud" :size="17"/>
    <span>{{notice.message}}</span>
    <div class="sync-notice-actions">
      <button v-if="notice.action&&notice.action!=='details'" class="text-button" :disabled="actionDisabled" @click="$emit('action')">{{notice.actionLabel}}</button>
      <button class="text-button" @click="$emit('details')">{{notice.action==='details'?notice.actionLabel:'Details'}}</button>
    </div>
  </div>
</template>
