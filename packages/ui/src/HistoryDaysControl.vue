<script setup lang="ts">
import {computed} from 'vue'

const props=defineProps<{label:string;allLabel:string;zeroLabel:string;value:number|null;defaultDays:number;disabled?:boolean}>()
const emit=defineEmits<{change:[value:number|null]}>()
const mode=computed(()=>props.value===null?'all':props.value===0?'zero':'limited')
function changeMode(event:Event){
  const selected=(event.target as HTMLSelectElement).value
  emit('change',selected==='all'?null:selected==='zero'?0:props.defaultDays)
}
function changeDays(event:Event){
  const field=event.target as HTMLInputElement
  if(field.checkValidity())emit('change',field.valueAsNumber)
  else field.value=String(props.value)
}
</script>

<template>
  <div class="history-days-control">
    <label><span>{{label}}</span><select :aria-label="label" :value="mode" :disabled="disabled" @change="changeMode"><option value="all">{{allLabel}}</option><option value="limited">Limit by days</option><option value="zero">{{zeroLabel}}</option></select></label>
    <label v-if="mode==='limited'"><span>Days</span><input :aria-label="`${label} in days`" type="number" required min="1" max="36500" step="1" :value="value" :disabled="disabled" @change="changeDays"/></label>
  </div>
</template>

<style scoped>
.history-days-control{display:flex;flex-wrap:wrap;align-items:end;gap:8px 12px}
.history-days-control label{display:grid;gap:4px;font-size:var(--font-small,12px)}
.history-days-control select,.history-days-control input{min-height:36px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);padding:4px 8px}
.history-days-control input{width:7ch}
</style>
