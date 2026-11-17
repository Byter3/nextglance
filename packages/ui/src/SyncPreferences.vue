<script setup lang="ts">
import type {DeviceSync,DeviceSyncSettings} from '@nextspace/contracts'
defineProps<{sync:DeviceSync;busy:boolean;error:string}>()
const emit=defineEmits<{change:[settings:DeviceSyncSettings]}>()
const intervals=[{value:0,label:'Manual only'},{value:15,label:'Every 15 minutes'},{value:30,label:'Every 30 minutes'},{value:60,label:'Every hour'},{value:240,label:'Every 4 hours'}] as const
function timestamp(value?:string){return value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Not yet recorded'}
</script>
<template>
  <section class="settings-section sync-preferences">
    <h3>Background sync</h3>
    <div class="form-two">
      <label>Calendar &amp; Tasks<select :value="sync.settings.caldavMinutes" :disabled="busy||sync.restoring" @change="emit('change',{...sync.settings,caldavMinutes:Number(($event.target as HTMLSelectElement).value) as DeviceSyncSettings['caldavMinutes']})"><option v-for="choice in intervals" :key="choice.value" :value="choice.value">{{choice.label}}</option></select></label>
      <label>Deck<select :value="sync.settings.deckMinutes" :disabled="busy||sync.restoring" @change="emit('change',{...sync.settings,deckMinutes:Number(($event.target as HTMLSelectElement).value) as DeviceSyncSettings['deckMinutes']})"><option v-for="choice in intervals" :key="choice.value" :value="choice.value">{{choice.label}}</option></select></label>
    </div>
    <label class="sync-wifi"><input type="checkbox" :checked="sync.settings.wifiOnly" :disabled="busy||sync.restoring" @change="emit('change',{...sync.settings,wifiOnly:($event.target as HTMLInputElement).checked})"/>Automatic sync on Wi-Fi only</label>
    <p class="field-hint">Saved items open first. Automatic checks download changed files. Refresh sources checks immediately, including on mobile data.</p>
    <p v-if="sync.background?.supported" class="field-hint">{{sync.background.scheduled?'Background checks are scheduled.':'Background checks are not scheduled.'}} Android chooses the exact run time and may defer checks to save battery. Force-stopping the app pauses them until you reopen it.</p>
    <p v-else class="field-hint">This preview checks while it is open. Background checks require the Android app.</p>
    <p class="field-hint">Planner files check when you open or return to the app. Local changes upload automatically. Notes and Collectives check on opening and while the app is active.</p>
    <p v-if="sync.background?.lastAttemptAt" class="sync-diagnostic">Last background check: {{timestamp(sync.background.lastAttemptAt)}}<br/>Last successful background download: {{timestamp(sync.background.lastSuccessAt)}}</p>
    <p v-if="sync.background?.error" class="storage-message" role="status">{{sync.background.error}}</p>
    <p v-if="sync.background?.message" class="field-hint" role="status">{{sync.background.message}}</p>
    <p v-if="sync.background?.readGenerationAt" class="sync-diagnostic">Saved background planner: {{timestamp(sync.background.readGenerationAt)}}</p>
    <p v-if="error" class="storage-message" role="alert">{{error}}</p>
    <p v-if="busy" class="field-hint" role="status">Saving sync settings…</p>
  </section>
</template>
<style scoped>
.sync-wifi{display:flex;align-items:center;gap:8px;margin-top:12px}.sync-wifi input{width:auto;margin:0}.sync-preferences select{width:100%}
</style>
