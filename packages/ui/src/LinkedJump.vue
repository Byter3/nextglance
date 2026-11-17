<script setup lang="ts">
import {Crosshair,CalendarDays,GitBranch} from 'lucide-vue-next'
import type {PlannerView} from '@nextspace/contracts'
defineProps<{recordId:string;title:string;view:PlannerView}>()
const emit=defineEmits<{jump:[intent:{id:string;view?:'calendar'|'timeline'}]}>()
</script>
<template>
  <span class="linked-jump" @click.stop>
    <template v-if="view==='board'||view==='list'"><button class="text-button" :aria-label="`Jump to ${title} in Calendar`" title="Show in Calendar" @click="emit('jump',{id:recordId,view:'calendar'})"><CalendarDays :size="14"/>Calendar</button><button class="text-button" :aria-label="`Jump to ${title} in Timeline`" title="Show in Timeline" @click="emit('jump',{id:recordId,view:'timeline'})"><GitBranch :size="14"/>Timeline</button></template>
    <button v-else class="text-button" :aria-label="`Jump to ${title}`" title="Reveal in this view" @click="emit('jump',{id:recordId})"><Crosshair :size="14"/>Jump to</button>
  </span>
</template>
<style scoped>.linked-jump{display:flex;gap:8px;flex-wrap:wrap}.linked-jump .text-button{font-size:11px;min-height:30px;padding:3px 0}</style>
