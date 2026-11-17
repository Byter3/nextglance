<script setup lang="ts">
import {BookOpen,Check,FileText} from 'lucide-vue-next'
import type {RecordTag,WorkspaceRecord} from '@nextspace/contracts'
defineProps<{item:WorkspaceRecord;tags:RecordTag[];excerpt:string;selected:boolean;disabled:boolean;eligible:boolean;reason?:string}>()
const emit=defineEmits<{toggle:[id:string]}>()
</script>
<template>
  <label class="note-picker-option" :class="{chosen:selected,unavailable:!eligible}">
    <input type="checkbox" :checked="selected" :disabled="disabled||!eligible" :aria-label="item.title" @change="emit('toggle',item.id)"/>
    <component :is="item.kind==='page'?BookOpen:FileText" :size="19"/>
    <span class="note-picker-item"><strong>{{item.title}}</strong><small>{{item.kind==='page'?'Collective page':'Nextcloud Notes'}}<template v-if="item.collectionTitle"> · {{item.collectionTitle}}</template></small><span v-if="tags.length" class="note-picker-tags"><span v-for="tag in tags" :key="tag.id"><i :style="{background:tag.color||'var(--primary)'}"/>{{tag.title}}</span></span><span v-if="excerpt" class="note-picker-excerpt">{{excerpt}}</span><small v-if="!eligible" class="note-picker-reason">{{reason}}</small></span>
    <Check v-if="selected" :size="17" class="note-picker-check"/>
  </label>
</template>
<style scoped>
.note-picker-option{display:flex;flex-direction:row;align-items:center;gap:11px;padding:13px 12px;border-bottom:1px solid var(--border);cursor:pointer;font-weight:400;margin:0}.note-picker-option:last-child{border-bottom:0}.note-picker-option:hover{background:var(--hover)}.note-picker-option.chosen{background:var(--primary-soft)}.note-picker-option.unavailable{opacity:.65;cursor:default}.note-picker-option:focus-within{outline:2px solid var(--primary);outline-offset:-2px}.note-picker-option input{width:17px;height:17px;accent-color:var(--primary);flex:none}.note-picker-option>svg{flex:none;color:var(--muted)}.note-picker-item{display:block;min-width:0;flex:1}.note-picker-item>strong{display:block;font-size:14px;line-height:1.45;overflow-wrap:anywhere}.note-picker-item>small,.note-picker-excerpt{display:block;font-size:12px;line-height:1.5;color:var(--muted);margin-top:3px}.note-picker-excerpt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.note-picker-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.note-picker-tags>span{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);border-radius:6px;font-size:11px;padding:3px 6px;background:var(--surface)}.note-picker-tags i{width:6px;height:6px;border-radius:50%}.note-picker-reason{font-style:italic}.note-picker-option>.note-picker-check{color:var(--primary)}
</style>
