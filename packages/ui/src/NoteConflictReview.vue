<script setup lang="ts">
import MarkdownContent from './MarkdownContent.vue'
const props=defineProps<{draft:{title:string;content:string;category:string};current:{title:string;content:string;category:string;readonly:boolean};busy?:boolean;error?:string}>()
const emit=defineEmits<{back:[];useCurrent:[];saveChanges:[];link:[url:string]}>()
</script>
<template>
  <div class="note-conflict-review">
    <span class="eyebrow">NOTE CHANGED IN NEXTCLOUD</span><h2>Review both versions</h2>
    <p class="field-hint">Your draft is kept here. Compare it with Nextcloud before deciding what to save.</p>
    <div class="note-version-columns"><section><h3>Your draft</h3><strong>{{draft.title}}</strong><small>Folder: {{draft.category||'Default folder'}}</small><MarkdownContent :body="draft.content" @link="emit('link',$event)"/></section><section><h3>Current Nextcloud version</h3><strong>{{current.title}}</strong><small>Folder: {{current.category||'Default folder'}}</small><MarkdownContent :body="current.content" @link="emit('link',$event)"/></section></div>
    <p v-if="error" class="inline-error" role="alert">{{error}}</p>
    <p class="field-hint">Save my changes replaces the fields you edited with your draft. Other changes from Nextcloud are kept.</p>
    <div class="form-actions"><button class="button quiet" :disabled="busy" @click="emit('back')">Back to my draft</button><button class="button" :disabled="busy" @click="emit('useCurrent')">Use Nextcloud version</button><button class="button primary" :disabled="busy||current.readonly" @click="emit('saveChanges')">Save my changes</button></div>
  </div>
</template>
<style scoped>
.note-version-columns{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:20px 0;max-height:60vh;overflow:auto}.note-version-columns>section{min-width:0;border:1px solid var(--border);border-radius:9px;padding:18px}.note-version-columns h3{color:var(--muted);font-size:13px;margin:0 0 12px}.note-version-columns strong{display:block;font-size:18px;overflow-wrap:anywhere}.note-version-columns small{display:block;margin:8px 0 20px;color:var(--muted)}@media(max-width:680px){.note-version-columns{grid-template-columns:1fr}}
</style>
