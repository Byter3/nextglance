<script setup lang="ts">
import { CalendarDays, Check, X, Circle, FileText, FolderKanban, BookOpen, Link2 } from 'lucide-vue-next'
import { isClosed } from '@nextspace/core/planner.mjs'
import type { WorkspaceRecord } from '@nextspace/contracts'
import { eventLabel, isOverdue, shortDate, sourceLabels } from './planner-ui'
defineProps<{record: WorkspaceRecord; selected?: boolean; color?: string; compact?: boolean; canComplete?: boolean; linked?: boolean}>()
const emit = defineEmits<{open:[record:WorkspaceRecord];complete:[record:WorkspaceRecord]}>()
const icons = {task: Circle, event: CalendarDays, card: FolderKanban, note: FileText, page: BookOpen}
</script>
<template>
  <div class="item-row" :class="{selected, completed:isClosed(record), compact}">
    <button v-if="record.kind==='task'||record.kind==='card'" class="item-check" :class="{checked:isClosed(record)}" :disabled="!canComplete" :aria-label="`${isClosed(record)?'Reopen':'Complete'} ${record.title}`" :title="canComplete ? (isClosed(record)?'Reopen':'Complete') : 'Open item for details'" @click="emit('complete',record)"><Check v-if="record.completed" :size="13"/><X v-else-if="isClosed(record)" :size="12"/><Circle v-else :size="17"/></button>
    <span v-else class="item-kind" :style="{color}"><component :is="icons[record.kind]" :size="17"/></span>
    <button class="item-body" @click="emit('open',record)"><span class="item-title">{{record.title}}</span><span class="item-caption">{{record.collectionTitle || sourceLabels[record.source]}}<template v-if="record.kind==='card' && record.status"> · {{record.status}}</template></span></button>
    <Link2 v-if="linked" :size="13" class="muted item-link" aria-label="Has linked items"/>
    <span v-if="isClosed(record)" class="item-date" :class="record.completed?'complete-label':'muted'">{{record.completed?'Completed':'Cancelled'}}</span>
    <span v-else-if="record.kind==='event'" class="item-date">{{eventLabel(record)}}</span>
    <span v-else-if="record.due" class="item-date" :class="{overdue:isOverdue(record)}">{{shortDate(record.due)}}</span>
  </div>
</template>
