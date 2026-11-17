<script setup lang="ts">
import {ArrowRight,Diamond,Link2} from 'lucide-vue-next'
</script>
<template>
  <div class="timeline-key" aria-label="Timeline symbols"><span><span class="key-line" aria-hidden="true"></span>Work range</span><span><Diamond :size="14" aria-hidden="true"/>Due</span><span><Link2 :size="14" aria-hidden="true"/>Reserved time</span><span><ArrowRight :size="21" aria-hidden="true"/>Dependency</span></div>
</template>
<style scoped>
.timeline-key{display:flex;gap:8px 14px;flex-wrap:wrap;font-size:11px;color:var(--muted)}.timeline-key>span{display:flex;align-items:center;gap:6px}.key-line{height:8px;width:28px;border:1px solid color-mix(in srgb,var(--primary) 40%,var(--surface));border-radius:3px;background:color-mix(in srgb,var(--primary) 9%,var(--surface))}
</style>
