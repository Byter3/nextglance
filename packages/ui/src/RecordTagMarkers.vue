<script setup lang="ts">
import type {RecordTag} from '@nextspace/contracts'
withDefaults(defineProps<{tags:RecordTag[];compact?:boolean;limit?:number}>(),{compact:true,limit:3})
</script>
<template>
  <span v-if="tags.length" class="record-tag-markers" :class="{compact}" :title="`Tags: ${tags.map(tag=>tag.title).join(', ')}`" role="img" :aria-label="`Tags: ${tags.map(tag=>tag.title).join(', ')}`">
    <span v-for="tag in tags.slice(0,limit)" :key="tag.id" class="record-tag-mark"><i :style="{backgroundColor:tag.color||'var(--muted)'}"/><span v-if="!compact">{{tag.title}}</span></span>
    <span v-if="tags.length>limit" class="record-tag-extra">+{{tags.length-limit}}</span>
  </span>
</template>
<style scoped>
.record-tag-markers{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:100%;vertical-align:middle;line-height:1.2;color:var(--muted);font-size:10px;white-space:nowrap;overflow:hidden}.record-tag-mark{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:90px}.record-tag-mark>i{width:7px;height:7px;border-radius:50%;display:inline-block;flex:0 0 7px;box-shadow:0 0 0 1px color-mix(in srgb,var(--surface) 40%,transparent)}.record-tag-mark>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.record-tag-extra{font-size:9px;flex:none}.record-tag-markers:not(.compact) .record-tag-mark{padding:2px 5px;border:1px solid var(--border);border-radius:7px;background:var(--surface)}.compact{flex-shrink:0}.compact .record-tag-mark>i{width:5px;height:9px;flex-basis:5px;border-radius:2px}
</style>
