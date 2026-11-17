<script setup lang="ts">
import {RotateCcw} from 'lucide-vue-next'
defineProps<{size:{height:number;minimum:number;maximum:number;automatic:boolean};active?:boolean}>()
const emit=defineEmits<{begin:[event:PointerEvent];keyboard:[event:KeyboardEvent];reset:[]}>()
</script>
<template>
  <div class="calendar-all-day-divider" :class="{resizing:active}" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Resize all-day section" :aria-valuenow="Math.round(size.height)" :aria-valuemin="size.minimum" :aria-valuemax="Math.round(size.maximum)" :aria-valuetext="`${Math.round(size.height)} pixels${size.automatic?', automatic':''}`" title="Drag to resize all-day items. Arrow keys resize; Home or double-click restores automatic fit." @pointerdown="emit('begin',$event)" @keydown="emit('keyboard',$event)" @dblclick="emit('reset')"><span aria-hidden="true"></span><button class="all-day-auto" type="button" :aria-pressed="size.automatic" aria-label="Auto fit all-day section" title="Auto fit all-day section" @pointerdown.stop @keydown.stop @click.stop="emit('reset')"><RotateCcw :size="11"/></button></div>
</template>
<style scoped>
.calendar-all-day-divider{position:relative;flex:none;height:6px;z-index:11;cursor:row-resize;touch-action:none;background:var(--surface);outline:none}
.calendar-all-day-divider::before{content:'';position:absolute;inset:-6px 0;z-index:-1}
.calendar-all-day-divider>span{position:absolute;left:50%;top:2px;width:28px;height:2px;transform:translateX(-50%);border-radius:2px;background:var(--muted)}
.calendar-all-day-divider:hover>span,.calendar-all-day-divider:focus-visible>span,.calendar-all-day-divider.resizing>span{background:var(--primary)}
.all-day-auto{position:absolute;left:3px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:26px;height:20px;padding:0;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--muted)}
.all-day-auto:focus-visible{outline:2px solid var(--primary)}.all-day-auto[aria-pressed=false]{color:var(--primary)}
@media(pointer:coarse){.all-day-auto::before{content:'';position:absolute;inset:-6px -3px}}
</style>
