<script setup lang="ts">
import {onBeforeUnmount,onMounted,ref} from 'vue'
import {ArrowLeft,FileText,Save} from 'lucide-vue-next'
import MarkdownEditor from './MarkdownEditor.vue'
type NoteDraft={id:string;title:string;content:string;etag?:string;category:string}
const props=defineProps<{modelValue:NoteDraft;busy?:boolean;error?:string;canReview?:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:NoteDraft];save:[];cancel:[];collapse:[];review:[];link:[url:string];tagsHost:[element:HTMLElement|null]}>()
const tagsHost=ref<HTMLElement|null>(null)
onMounted(()=>emit('tagsHost',tagsHost.value))
onBeforeUnmount(()=>emit('tagsHost',null))
function patch(value:Partial<NoteDraft>){emit('update:modelValue',{...props.modelValue,...value})}
</script>

<template>
  <div class="note-editor-dialog">
    <header><span class="eyebrow"><FileText :size="15"/>NEXTCLOUD NOTE</span><h2>Edit note</h2><p>More room to write. Your draft follows you back to the side panel.</p></header>
    <div id="expanded-note-tags" ref="tagsHost"/>
    <form @submit.prevent="emit('save')">
      <div class="note-editor-details"><label>Title<input :value="modelValue.title" required maxlength="500" :disabled="busy" aria-label="Note title" @input="patch({title:($event.target as HTMLInputElement).value})"/></label></div>
      <div class="note-editor-writing"><MarkdownEditor :model-value="modelValue.content" label="Note content" :disabled="busy" :rows="22" placeholder="Write your note…" @update:model-value="patch({content:$event})" @link="emit('link',$event)"/></div>
      <p v-if="error" class="inline-error" role="alert">{{error}}</p>
      <button v-if="error&&canReview" type="button" class="text-button" :disabled="busy" @click="emit('review')">Review Nextcloud version</button>
      <footer><button type="button" class="text-button" :disabled="busy" @click="emit('collapse')"><ArrowLeft :size="15"/>Back to side panel</button><div><button type="button" class="button quiet" :disabled="busy" @click="emit('cancel')">Cancel changes</button><button type="submit" class="button primary" :disabled="busy||!modelValue.title.trim()"><Save :size="16"/>{{busy?'Saving…':'Save note'}}</button></div></footer>
    </form>
  </div>
</template>

<style scoped>
.note-editor-dialog{height:min(82vh,900px);min-height:360px;display:flex;flex-direction:column}.note-editor-dialog>header{flex:none}.note-editor-dialog .eyebrow{display:flex;align-items:center;gap:7px}.note-editor-dialog h2{font-size:24px;margin:8px 0}.note-editor-dialog header p{font-size:13px;color:var(--muted);margin:0 0 19px}.note-editor-dialog form{display:flex;flex-direction:column;flex:1;min-height:0}.note-editor-details{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;flex:none;margin-bottom:16px}.note-editor-details label{min-width:0;font-size:12px}.note-editor-details input{margin-top:6px}.note-editor-writing{flex:1;min-height:120px;overflow:auto;overscroll-behavior:contain}.note-editor-writing :deep(.markdown-editor){height:100%;display:flex;flex-direction:column}.note-editor-writing :deep(.markdown-rich-text){min-height:310px}.note-editor-writing :deep(textarea){min-height:310px;flex:1;resize:none}.note-editor-dialog footer{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--border);padding-top:16px;margin-top:16px;flex:none}.note-editor-dialog footer>div{display:flex;gap:10px}.note-editor-dialog footer>.text-button{font-size:13px}@media(max-width:650px){.note-editor-details{grid-template-columns:1fr}.note-editor-dialog{height:82vh}.note-editor-dialog footer{flex-wrap:wrap}.note-editor-dialog footer>div{margin-left:auto}}
</style>
