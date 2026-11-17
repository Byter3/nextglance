<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown, ListChecks } from 'lucide-vue-next'
import { boardChecklist } from '@nextspace/core/board-checklist.mjs'
import { toggleMarkdownTask } from '@nextspace/core/markdown.mjs'

const props=defineProps<{body:string;recordId:string;title:string;editable:boolean}>()
const emit=defineEmits<{edit:[body:string]}>()
const checklist=computed(()=>boardChecklist(props.body))
const collapsed=ref(false),showAll=ref(false)
const visible=computed(()=>showAll.value?checklist.value.tasks:checklist.value.tasks.slice(0,3))
function toggle(offset:number){
  if(!props.editable)return
  const body=toggleMarkdownTask(props.body,offset)
  if(body!==props.body)emit('edit',body)
}
</script>

<template>
  <section v-if="checklist.total" class="board-checklist" :aria-label="`Checklist for ${title}`" @click.stop @dragstart.stop.prevent>
    <button type="button" class="board-checklist-heading" :aria-expanded="!collapsed" :aria-controls="`checklist-${recordId}`" :title="`Checklist from the card description: ${checklist.completed} of ${checklist.total} complete`" @click="collapsed=!collapsed">
      <ListChecks :size="14"/><span>Checklist</span><span class="board-checklist-progress">{{checklist.completed}} / {{checklist.total}}</span><ChevronDown :size="14" :class="{collapsed}"/>
    </button>
    <div v-if="!collapsed" :id="`checklist-${recordId}`" class="board-checklist-children">
      <button v-for="task in visible" :key="task.offset" type="button" class="board-checklist-item" :class="{checked:task.checked}" role="checkbox" :aria-checked="task.checked" :aria-label="task.label" :disabled="!editable" :title="editable?task.label:'Read-only checklist: '+task.label" @click="toggle(task.offset)">
        <span class="board-checklist-box" aria-hidden="true"><Check v-if="task.checked" :size="12"/></span><span class="board-checklist-label">{{task.label}}</span>
      </button>
      <button v-if="checklist.total>3" type="button" class="board-checklist-more" :aria-expanded="showAll" @click="showAll=!showAll">{{showAll?'Show fewer':`Show ${checklist.total-3} more`}}</button>
    </div>
  </section>
</template>

<style scoped>
.board-checklist{margin:0 13px 13px;padding-top:2px;min-width:0;cursor:default}
.board-checklist-heading{display:flex;align-items:center;gap:6px;width:100%;min-height:30px;text-align:left;font-size:11px;color:var(--muted);border-radius:4px}
.board-checklist-heading:hover{color:var(--text)}.board-checklist-heading:focus-visible,.board-checklist-item:focus-visible,.board-checklist-more:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.board-checklist-progress{margin-left:auto;font-variant-numeric:tabular-nums}.board-checklist-heading>svg.collapsed{transform:rotate(-90deg)}
.board-checklist-children{position:relative;margin:2px 0 0 6px;padding:0 0 0 12px;border-left:1px solid color-mix(in srgb,var(--primary) 35%,var(--border))}
.board-checklist-item{position:relative;display:flex;align-items:flex-start;gap:8px;width:100%;padding:7px 2px;text-align:left;font-size:12px;line-height:1.5;border-radius:4px;color:var(--text);cursor:pointer}
.board-checklist-item:before{content:'';position:absolute;left:-13px;top:16px;width:10px;border-top:1px solid color-mix(in srgb,var(--primary) 35%,var(--border))}
.board-checklist-item:not(:disabled):hover{background:var(--hover)}.board-checklist-item:disabled{cursor:default;opacity:1}
.board-checklist-box{width:16px;height:16px;margin-top:1px;flex-shrink:0;border:1.5px solid var(--muted);border-radius:4px;display:grid;place-items:center}
.board-checklist-label{min-width:0;overflow-wrap:anywhere}.board-checklist-item.checked .board-checklist-box{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.board-checklist-item.checked .board-checklist-label{text-decoration:line-through;color:var(--muted)}.board-checklist-item:disabled .board-checklist-box{opacity:.6}
.board-checklist-more{display:block;min-height:30px;padding:5px 2px;text-align:left;font-size:11px;color:var(--primary);border-radius:4px}
</style>
