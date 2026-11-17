<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref} from 'vue'
import type {DiagnosticSummary,WorkspaceApi} from '@nextspace/contracts'
const props=defineProps<{api:WorkspaceApi}>()
const summary=ref<DiagnosticSummary>(),message=ref(''),fallback=ref(''),working=ref(false)
let timer:ReturnType<typeof setTimeout>|undefined,alive=false
function refresh(){clearTimeout(timer);timer=undefined;summary.value=props.api.getDiagnostics?.();if(alive&&summary.value?.recording)timer=setTimeout(refresh,500)}
function start(){message.value='';fallback.value='';summary.value=props.api.startDiagnostics?.();window.dispatchEvent(new Event('nextspace:diagnostics'))}
function stop(){summary.value=props.api.stopDiagnostics?.();window.dispatchEvent(new Event('nextspace:diagnostics'))}
function clear(){fallback.value='';message.value='';summary.value=props.api.clearDiagnostics?.();window.dispatchEvent(new Event('nextspace:diagnostics'))}
async function copy(){working.value=true;message.value='';fallback.value='';try{let copied=false;if(props.api.copyDiagnostics){try{copied=(await props.api.copyDiagnostics()).copied}catch{/* Try the browser clipboard next. */}}if(!copied){if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(props.api.readDiagnostics?.()||'')}message.value='Log copied.'}catch{fallback.value=props.api.readDiagnostics?.()||'';message.value='Select and copy the log below.'}finally{working.value=false}}
async function save(){working.value=true;message.value='';try{const result=await props.api.saveDiagnostics?.();if(result?.saved)message.value='Log saved.'}catch{message.value='Could not save the log. Use Copy log instead.'}finally{working.value=false}}
onMounted(()=>{alive=true;window.addEventListener('nextspace:diagnostics',refresh);refresh()})
onBeforeUnmount(()=>{alive=false;window.removeEventListener('nextspace:diagnostics',refresh);clearTimeout(timer)})
</script>
<template>
  <section v-if="api.startDiagnostics" class="diagnostics-panel" aria-labelledby="diagnostics-title">
    <h3 id="diagnostics-title">Performance diagnostics</h3>
    <p class="muted">Start recording, reproduce the slow action, then stop and copy or save the log. Only timings, counts and error codes are recorded; no account details or item content.</p>
    <p v-if="summary" class="diagnostics-summary" role="status">{{summary.recording?'Recording':'Stopped'}} · {{Math.round(summary.elapsedMs/1000)}}s · {{summary.eventCount}} entries<span v-if="summary.dropped"> · {{summary.dropped}} older entries dropped</span><span v-if="summary.stopReason==='duration'"> · 10-minute limit reached</span><span v-if="summary.stopReason==='background'"> · app moved to background</span></p>
    <div class="diagnostics-actions">
      <button v-if="!summary?.recording" class="button primary" @click="start">Start recording</button><button v-else class="button primary" @click="stop">Stop recording</button>
      <button class="button" :disabled="working||!summary?.eventCount" @click="copy">Copy log</button>
      <button class="button" v-if="summary?.canSaveFile" :disabled="working||!summary?.eventCount" @click="save">Save log</button>
      <button class="button" :disabled="working||!summary?.eventCount" @click="clear">Clear</button>
    </div>
    <p v-if="message" role="status">{{message}}</p>
    <textarea v-if="fallback" :value="fallback" readonly aria-label="Diagnostic log to copy" @focus="($event.target as HTMLTextAreaElement).select()"/>
  </section>
</template>
<style scoped>
.diagnostics-panel{padding:14px 0;border-top:1px solid var(--border)}.diagnostics-panel h3{margin:0 0 8px}.diagnostics-panel p{font-size:13px;line-height:1.45;margin:8px 0}.diagnostics-actions{display:flex;gap:6px;flex-wrap:wrap}.diagnostics-actions button{min-height:40px;padding:7px 12px}.diagnostics-panel textarea{width:100%;min-height:160px;font:12px monospace;user-select:text}
</style>
