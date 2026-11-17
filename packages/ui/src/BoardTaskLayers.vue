<script setup lang="ts">
import {Check, Circle, CalendarDays} from 'lucide-vue-next'
import type {WorkspaceRecord} from '@nextspace/contracts'
import {isClosed} from '@nextspace/core/planner.mjs'
import {shortDate,sourceLabels} from './planner-ui'
defineProps<{records:WorkspaceRecord[];placement:'incoming'|'outgoing';expanded:boolean;selectedId?:string|null;primaryIds:Set<string>;highlighted:Set<string>;colorFor:(record:WorkspaceRecord)=>string;sourceColorFor?:(record:WorkspaceRecord)=>string;statusFor:(record:WorkspaceRecord)=>string}>()
const emit=defineEmits<{open:[record:WorkspaceRecord];hover:[id:string|null];focus:[id:string|null]}>()
</script>
<template>
  <div v-if="records.length" class="board-task-layers" :class="[placement,{expanded}]" :aria-label="placement==='incoming'?'Prerequisite tasks':'Dependent tasks'">
    <button v-for="(task,index) in records" :key="task.id" class="board-task-layer" :class="{completed:isClosed(task),selected:task.id===selectedId,primary:primaryIds.has(task.id),linked:highlighted.has(task.id)}" :style="{'--item-color':colorFor(task),'--source-color':sourceColorFor?.(task)||colorFor(task),'--layer':index}" :data-task-id="task.id" @click.stop="emit('open',task)" @pointerenter="$event.pointerType!=='touch'&&emit('hover',task.id)" @pointerleave="emit('hover',null)" @focus="emit('focus',task.id)">
      <span class="task-title"><Check v-if="task.completed" :size="14"/><Circle v-else :size="13"/><strong>{{task.title}}</strong></span>
      <span class="task-detail">{{statusFor(task)}} · {{task.collectionTitle||sourceLabels[task.source]}}<span v-if="task.due"><CalendarDays :size="11"/>{{shortDate(task.due)}}</span></span>
    </button>
  </div>
</template>
<style scoped>
.board-task-layers{position:relative;display:grid;gap:0;margin-inline:9px;isolation:isolate}.board-task-layer{position:relative;display:block;width:100%;min-height:40px;text-align:left;padding:8px 10px;color:var(--text);background:color-mix(in srgb,var(--item-color) 10%,var(--surface));border:1px solid var(--border);border-inline-start:3px solid var(--source-color);border-radius:9px;overflow:hidden;transition:margin .12s ease;z-index:calc(30 - var(--layer))}.incoming:not(.expanded) .board-task-layer{margin-bottom:-25px}.outgoing:not(.expanded) .board-task-layer{margin-top:-25px}.incoming{padding-bottom:0}.outgoing{padding-top:0}.board-task-layers.expanded{gap:6px;margin-block:6px}.task-title{display:flex;align-items:center;gap:6px;min-width:0;line-height:1.35}.task-title svg{flex:none}.task-title strong{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.expanded .task-title strong{white-space:normal;overflow-wrap:anywhere}.task-detail{display:none;color:var(--muted);font-size:10px;line-height:1.5;margin-top:5px}.expanded .task-detail{display:block}.task-detail>span{display:flex;align-items:center;gap:4px}.completed .task-title strong{text-decoration:line-through;text-decoration-thickness:2px}.board-task-layer.linked:not(.primary){outline:2px dashed color-mix(in srgb,var(--primary) 70%,var(--muted));outline-offset:-2px;box-shadow:inset 0 0 0 3px color-mix(in srgb,var(--primary) 10%,transparent)}.board-task-layer:is(.selected,.primary){outline:2px solid var(--primary);outline-offset:-2px}.board-task-layer:focus-visible{outline:2px solid var(--primary);outline-offset:1px}@media(prefers-reduced-motion:reduce){.board-task-layer{transition:none}}
</style>
