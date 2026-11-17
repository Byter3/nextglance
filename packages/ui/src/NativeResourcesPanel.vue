<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue'
import {ExternalLink,File,FolderOpen,LoaderCircle,Paperclip,Plus,RefreshCw,X} from 'lucide-vue-next'
import type {DeckAttachment,WorkspaceApi,WorkspaceRecord} from '@nextspace/contracts'
const props=withDefaults(defineProps<{record:WorkspaceRecord;records:WorkspaceRecord[];api:WorkspaceApi;canWrite:boolean;connected:boolean;canAttach?:boolean;canReadAttachments?:boolean;linkedNoteCount?:number}>(),{canReadAttachments:true})
const emit=defineEmits<{changed:[];busy:[value:boolean];attach:[];open:[record:WorkspaceRecord];external:[url:string]}>()
const attachments=ref<DeckAttachment[]>([]),related=ref<{providerId:string;itemId:string;title:string;subtitle?:string;url:string}[]>([])
const loading=ref(false),pending=ref(false),error=ref(''),relatedError=ref(''),relatedAvailable=ref(false)
let generation=0
const noteFileIds=computed(()=>new Set(props.records.filter(record=>record.kind==='note'&&record.fileId).map(record=>record.fileId)))
const noteFor=(file:DeckAttachment)=>Boolean(file.fileId&&noteFileIds.value.has(file.fileId))
const files=computed(()=>attachments.value.filter(file=>!noteFor(file)))
const noteCount=computed(()=>props.linkedNoteCount??attachments.value.filter(noteFor).length)
async function reload(){
  const token=++generation;error.value='';relatedError.value=''
  if(!props.connected){loading.value=false;return}
  loading.value=true
  const results=await Promise.allSettled([
    props.record.kind==='card'&&props.canReadAttachments!==false&&props.api.readDeckAttachments?props.api.readDeckAttachments({id:props.record.id}):Promise.resolve({attachments:[] as DeckAttachment[]}),
    props.api.readRelatedResources?props.api.readRelatedResources({id:props.record.id}):Promise.resolve({available:false,resources:[]}),
  ])
  if(token!==generation)return
  const [fileResult,relatedResult]=results
  if(fileResult.status==='fulfilled'){
    attachments.value=fileResult.value.attachments
    const loaded=new Set(attachments.value.map(file=>file.fileId).filter(Boolean)),known=new Set(props.record.attachmentFileIds||[])
    // Browsing an unchanged card must not fetch/merge the entire workspace.
    if(props.record.kind==='card'&&props.canReadAttachments!==false&&props.api.readDeckAttachments&&(loaded.size!==known.size||[...loaded].some(id=>!known.has(id!))))emit('changed')
  }
  else error.value=fileResult.reason instanceof Error?fileResult.reason.message:'Could not load attachments.'
  if(relatedResult.status==='fulfilled'){related.value=relatedResult.value.resources;relatedAvailable.value=relatedResult.value.available}
  else relatedError.value=relatedResult.reason instanceof Error?relatedResult.reason.message:'Could not load related resources.'
  loading.value=false
}
async function mutate(operation:()=>Promise<{attachments:DeckAttachment[];cancelled?:boolean}>){
  if(!props.canWrite||pending.value)return
  pending.value=true;emit('busy',true);error.value=''
  try{const result=await operation();if(!result.cancelled){attachments.value=result.attachments;emit('changed')}}catch(reason){error.value=reason instanceof Error?reason.message:'The attachment could not be updated.'}finally{pending.value=false;emit('busy',false)}
}
function remove(file:DeckAttachment){if(props.api.removeDeckAttachment)void mutate(()=>props.api.removeDeckAttachment!({id:props.record.id,attachmentId:file.id}))}
watch([()=>props.record.id,()=>props.connected,()=>props.canReadAttachments],()=>{attachments.value=[];related.value=[];void reload()},{immediate:true})
onBeforeUnmount(()=>{generation++})
defineExpose({reload})
</script>

<template>
  <section v-if="record.kind==='card'" class="inspector-section native-attachments linked-notes-section" aria-label="Attachments">
    <header><h3><Paperclip :size="15"/>Attachments <span v-if="files.length+noteCount">{{files.length+noteCount}}</span></h3><LoaderCircle v-if="loading||pending" :size="15" class="spinning"/><button class="text-button" aria-label="Attach" :disabled="!(canAttach??canWrite)||pending" @click="emit('attach')"><Plus :size="15"/>Attach</button></header>
    <slot name="notes"/>
    <div v-for="file in files" :key="file.id" class="native-file-row"><button :disabled="!file.url" @click="file.url&&emit('external',file.url)"><File :size="17"/><span><strong>{{file.name}}</strong><small>{{file.path||'Deck attachment'}}</small></span><ExternalLink :size="13"/></button><button class="icon-button" :disabled="!canWrite||pending||!api.removeDeckAttachment" :aria-label="'Remove attachment '+file.name" title="Remove attachment; keep the original file" @click="remove(file)"><X :size="14"/></button></div>
    <p v-if="!files.length&&!loading&&!noteCount&&!error" class="field-hint">Keep notes, briefs and files with this work.</p>
    <p v-if="error" class="inline-error" role="alert">{{error}} <button class="text-button" :disabled="loading||pending||!connected" @click="reload"><RefreshCw :size="13"/>Retry</button></p>
  </section>
  <section v-if="api.readRelatedResources" class="inspector-section related-resources" aria-label="Nextcloud related resources">
    <header><h3>Related resources</h3><LoaderCircle v-if="loading" :size="14" class="spinning"/></header>
    <p class="field-hint">Nextcloud suggestions based on shared access. These are not dependencies.</p>
    <button v-for="item in related" :key="item.providerId+':'+item.itemId" class="related-resource" @click="emit('external',item.url)"><FolderOpen :size="17"/><span><strong>{{item.title}}</strong><small v-if="item.subtitle">{{item.subtitle}}</small></span><ExternalLink :size="13"/></button>
    <p v-if="relatedError" class="inline-error">{{relatedError}} <button class="text-button" @click="reload">Retry</button></p>
    <p v-else-if="!related.length&&!loading" class="field-hint">{{!connected?'Connect to Nextcloud to load suggestions.':relatedAvailable?'No related resources suggested by Nextcloud.':'Related resources are not available for this item or server.'}}</p>
  </section>
</template>

<style scoped>
.native-attachments h3{display:flex;align-items:center;gap:7px}.native-file-actions{display:flex;gap:8px;flex-wrap:wrap}.native-file-actions .button{font-size:12px;min-height:34px}.native-file-row{display:flex;gap:6px;align-items:center;border:1px solid var(--border);border-radius:8px;margin:8px 0;padding:5px}.native-file-row>button:first-child,.related-resource{display:flex;align-items:center;gap:10px;border:0;background:none;color:var(--text);padding:8px;text-align:left;min-width:0;flex:1}.native-file-row span,.related-resource span{min-width:0;flex:1}.native-file-row strong,.related-resource strong{display:block;overflow-wrap:anywhere;font-size:13px}.native-file-row small,.related-resource small{display:block;color:var(--muted);font-size:11px;overflow-wrap:anywhere}.related-resource{width:100%;border-radius:8px}.related-resource:hover,.native-file-row>button:first-child:hover{background:var(--hover)}
</style>
