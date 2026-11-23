<script setup lang="ts">
import {isWeekendDay} from '@nextspace/core/weekend-days.mjs'

const props = defineProps<{mask: number; pending: boolean; error: string}>()
const emit = defineEmits<{change: [day: number, enabled: boolean]}>()
const formatter = new Intl.DateTimeFormat(undefined, {weekday: 'long', timeZone: 'UTC'})
const days = [1, 2, 3, 4, 5, 6, 0].map(day => ({day, label: formatter.format(new Date(Date.UTC(2026, 0, 4 + day)))}))
function change(day: number, event: Event) {
  const input = event.target as HTMLInputElement
  const checked = input.checked
  input.checked = isWeekendDay(props.mask, day)
  emit('change', day, checked)
}
</script>

<template>
  <fieldset class="weekend-settings" :disabled="pending">
    <legend>Weekend days</legend>
    <div class="weekend-choices">
      <label v-for="{day, label} in days" :key="day" class="check-label">
        <input type="checkbox" :checked="isWeekendDay(mask, day)" @change="change(day, $event)" />
        {{label}}
      </label>
    </div>
    <p v-if="error" class="inline-error" role="status">{{error}}</p>
  </fieldset>
</template>

<style scoped>
.weekend-settings{min-width:0;margin:12px 0 0;padding:10px 12px;border:1px solid var(--border);border-radius:8px}
.weekend-settings legend{padding:0 4px;font-size:13px;font-weight:600}
.weekend-choices{display:flex;flex-wrap:wrap;gap:4px 14px}
.weekend-choices label{min-height:32px}
</style>
