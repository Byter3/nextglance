<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { FileText, FolderOpen, Link2, LoaderCircle, Plus, Search, Upload } from 'lucide-vue-next'
import type { RecordTag, Relation, WorkspaceApi, WorkspaceRecord } from '@nextspace/contracts'
import { excerpt } from './planner-ui'
import MarkdownEditor from './MarkdownEditor.vue'
import CloudFilePicker from './CloudFilePicker.vue'
import NotePickerRow from './NotePickerRow.vue'

const props = withDefaults(defineProps<{
  record:WorkspaceRecord; records:WorkspaceRecord[]; relations:Relation[]; busy?:boolean; error?:string
  canCreate?:boolean; categories?:string[]; tagsFor?:(record:WorkspaceRecord)=>RecordTag[]
  createdNote?:WorkspaceRecord; linkedIds?:string[]; api?:WorkspaceApi; canAttachFiles?:boolean; canUploadFile?:boolean; canBrowseFiles?:boolean; canAttachNotes?:boolean
}>(),{canUploadFile:undefined,canBrowseFiles:undefined,canAttachNotes:undefined})
const emit = defineEmits<{add:[ids:string[],options:{keepOpen:boolean}];create:[input:{title:string;content:string;category:string}];cancel:[];dirty:[value:boolean];changed:[];done:[];operationBusy:[value:boolean]}>()
const query=ref(''),selectedIds=ref<string[]>([]),tab=ref<'notes'|'create'|'files'>('notes'),title=ref(''),content=ref(''),category=ref('')
const searchInput=ref<HTMLInputElement>(),titleInput=ref<HTMLInputElement>()
const filesVisited=ref(false),fileSelectionDirty=ref(false),fileSaving=ref(false),uploading=ref(false),uploadMessage=ref(''),fileError=ref(''),advanceToFiles=ref(false)
const createVisited=ref(false),visibleLimit=ref(50)
const canBrowse=computed(()=>props.canBrowseFiles??Boolean(props.api?.listFiles))
const canUpload=computed(()=>props.canUploadFile??props.canAttachFiles)
const filesAvailable=computed(()=>props.record.kind==='card'&&(canBrowse.value&&Boolean(props.api?.listFiles)||canUpload.value&&Boolean(props.api?.uploadDeckAttachment)))
const locked=computed(()=>props.busy||fileSaving.value||uploading.value)
const creating=computed(()=>tab.value==='create')
const notesById=computed(()=>{
  const values=new Map<string,WorkspaceRecord>()
  for(const item of props.records)if((item.kind==='note'||item.kind==='page')&&item.id&&item.id!==props.record.id)values.set(item.id,item)
  if(props.createdNote&&props.createdNote.id!==props.record.id)values.set(props.createdNote.id,props.createdNote)
  return values
})
// Note references are bidirectional associations, not dependency graphs. Build
// their membership once rather than scanning all relations for every note.
const linkedNoteIds=computed(()=>{
  const ids=new Set(props.linkedIds||[]),id=props.record.id
  for(const edge of props.relations)if(edge.type==='reference'){
    if(edge.fromId===id)ids.add(edge.toId)
    else if(edge.toId===id)ids.add(edge.fromId)
  }
  return ids
})
const noteRows=computed(()=>[...notesById.value.values()].map(item=>{
  const tags=props.tagsFor?.(item)||[]
  return {item,tags,tagTitles:tags.map(tag=>tag.title).join(' '),excerpt:excerpt((item.body||'').slice(0,4096))}
}))
const sortedRows=computed(()=>[...noteRows.value].sort((a,b)=>Number(linkedNoteIds.value.has(a.item.id))-Number(linkedNoteIds.value.has(b.item.id))||a.item.title.localeCompare(b.item.title)))
const searchCache=new WeakMap<WorkspaceRecord,{title:string;collection:string;body:string;tags:string;text:string}>()
function searchable(row:typeof noteRows.value[number]){
  const item=row.item,title=item.title,collection=item.collectionTitle||'',body=item.body||'',tags=row.tagTitles,cached=searchCache.get(item)
  if(cached&&cached.title===title&&cached.collection===collection&&cached.body===body&&cached.tags===tags)return cached.text
  const text=`${title} ${collection} ${body} ${tags}`.toLocaleLowerCase()
  searchCache.set(item,{title,collection,body,tags,text})
  return text
}
const results=computed(()=>{
  const terms=query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return terms.length?sortedRows.value.filter(row=>{const text=searchable(row);return terms.every(term=>text.includes(term))}):sortedRows.value
})
const visibleRows=computed(()=>results.value.slice(0,visibleLimit.value))
const selectedSet=computed(()=>new Set(selectedIds.value))
function canLinkNote(id:string){const item=notesById.value.get(id);return Boolean(item&&!linkedNoteIds.value.has(id)&&!(props.record.kind==='card'&&item.kind==='note'&&props.canAttachNotes===false))}
const selectedValid=computed(()=>selectedIds.value.filter(canLinkNote))
function toggleNote(id:string){if(locked.value||!canLinkNote(id))return;selectedIds.value=selectedSet.value.has(id)?selectedIds.value.filter(selected=>selected!==id):[...selectedIds.value,id]}
const categoryChoices=computed(()=>[...new Set((props.categories||[]).filter(Boolean))].sort((a,b)=>a.localeCompare(b)))
const hasCreationDraft=computed(()=>Boolean(title.value.trim())||Boolean(content.value)||Boolean(category.value))
const dirty=computed(()=>selectedIds.value.length>0||hasCreationDraft.value||fileSelectionDirty.value)
watch(dirty,value=>emit('dirty',value),{immediate:true})
watch(query,()=>{visibleLimit.value=50},{flush:'sync'})
watch(()=>props.record.id,()=>{selectedIds.value=[];query.value='';tab.value='notes';title.value='';content.value='';category.value='';fileSelectionDirty.value=false;filesVisited.value=false;createVisited.value=false;visibleLimit.value=50;uploadMessage.value='';fileError.value=''})
watch(()=>props.createdNote,async note=>{if(!note)return;tab.value='notes';title.value='';content.value='';category.value='';query.value='';if(!selectedIds.value.includes(note.id))selectedIds.value.push(note.id);await nextTick();searchInput.value?.focus()})
// A successful subset may disappear from eligibility while the parent reports a
// failed native attachment. Keep the remaining selection available for retry.
watch(selectedValid,ids=>{if(ids.length!==selectedIds.value.length)selectedIds.value=ids;if(!ids.length&&advanceToFiles.value){advanceToFiles.value=false;if(fileSelectionDirty.value)showFiles()}})
onMounted(async()=>{await nextTick();searchInput.value?.focus()})
async function showCreate(){if(!props.canCreate||locked.value)return;createVisited.value=true;tab.value='create';await nextTick();titleInput.value?.focus()}
function showFiles(){if(!filesAvailable.value)return;filesVisited.value=true;tab.value='files'}
function submit(){if(!locked.value&&!hasCreationDraft.value&&selectedValid.value.length){advanceToFiles.value=fileSelectionDirty.value;emit('add',[...selectedValid.value],{keepOpen:fileSelectionDirty.value})}}
function discardCreation(){if(locked.value)return;title.value='';content.value='';category.value=''}
function create(){if(locked.value||!props.canCreate||!title.value.trim())return;emit('create',{title:title.value.trim(),content:content.value,category:category.value.trim()})}
function fileBusy(value:boolean){fileSaving.value=value;emit('operationBusy',value)}
function filesDone(){if(hasCreationDraft.value){tab.value='create';return}if(selectedValid.value.length){tab.value='notes';return}emit('done')}
async function upload(){
  if(locked.value||!canUpload.value||props.record.readonly||!props.api?.uploadDeckAttachment)return
  uploading.value=true;emit('operationBusy',true);fileError.value='';uploadMessage.value=''
  try{const result=await props.api.uploadDeckAttachment({id:props.record.id});if(!result.cancelled){uploadMessage.value='File uploaded and attached in Deck.';emit('changed')}}catch(error){fileError.value=error instanceof Error?error.message:'The file could not be uploaded.'}finally{uploading.value=false;emit('operationBusy',false)}
}
</script>

<template>
  <div class="note-link-picker">
    <span class="eyebrow">ATTACHMENTS</span><h2>Attach to this work</h2>
    <p class="note-link-context"><Link2 :size="17"/><span>{{record.title}}</span></p>
    <p v-if="record.kind==='card'" class="field-hint note-native-explanation">Notes and files are attached in Nextcloud Deck and shared with this board’s members with read access. Collective pages stay linked in NextGlance.</p>
    <div class="note-picker-tabs" role="tablist" aria-label="Choose attachment type">
      <button role="tab" :aria-selected="tab==='notes'" :class="{active:tab==='notes'}" :disabled="locked" @click="tab='notes'"><FileText :size="16"/>Existing notes <small v-if="selectedIds.length">{{selectedIds.length}}</small></button>
      <button role="tab" :aria-selected="creating" :class="{active:creating}" :disabled="locked||!canCreate" :title="canCreate?'Create a note and link it':'Connect and refresh Notes to create a note'" @click="showCreate"><Plus :size="16"/>Create a note</button>
      <button v-if="filesAvailable" role="tab" :aria-selected="tab==='files'" :class="{active:tab==='files'}" :disabled="locked" @click="showFiles"><FolderOpen :size="16"/>Other files <small v-if="fileSelectionDirty">Selected</small></button>
    </div>
    <form v-show="tab==='notes'" @submit.prevent="submit">
      <label class="note-picker-search"><Search :size="17"/><input ref="searchInput" v-model="query" :disabled="locked" placeholder="Search notes and Collective pages…" aria-label="Find notes and pages"/><button v-if="query" class="text-button" type="button" :disabled="locked" @click="query=''">Clear</button></label>
      <div class="note-picker-count"><span>{{results.length}} {{results.length===1?'note or page':'notes and pages'}}</span><span aria-live="polite">{{selectedIds.length}} selected</span></div>
      <div class="note-picker-results" role="group" aria-label="Choose notes to link">
        <NotePickerRow v-for="row in visibleRows" :key="row.item.id" :item="row.item" :tags="row.tags" :excerpt="row.excerpt" :selected="selectedSet.has(row.item.id)" :disabled="Boolean(locked)" :eligible="canLinkNote(row.item.id)" :reason="linkedNoteIds.has(row.item.id)?'Already linked.':!canLinkNote(row.item.id)?'Native Deck attachments are not available.':undefined" @toggle="toggleNote"/>
        <div v-if="visibleRows.length<results.length" class="note-picker-more"><span>Showing {{visibleRows.length}} of {{results.length}}. Search includes every note.</span><button type="button" class="button quiet" :disabled="locked" @click="visibleLimit+=50">Show more notes</button></div>
        <div v-if="!results.length" class="note-picker-empty"><FileText :size="25"/><strong>{{query?'No matching notes':'No notes loaded'}}</strong><span>{{query?'Try another title, folder or tag.':'Refresh Notes or create one here.'}}</span><button v-if="canCreate" type="button" class="text-button" :disabled="locked" @click="showCreate"><Plus :size="15"/>Create a note</button></div>
      </div>
      <p class="field-hint">Select several notes at once. Their contents stay in Nextcloud.</p>
      <div v-if="hasCreationDraft" class="note-unfinished-draft"><p>Finish or discard your new note before linking this selection.</p><button type="button" class="text-button" :disabled="locked" @click="showCreate">Review draft</button><button type="button" class="text-button" :disabled="locked" @click="discardCreation">Discard new note draft</button></div>
      <p v-if="error" class="inline-error" role="alert">{{error}}</p>
      <div class="form-actions"><button type="button" class="button quiet" :disabled="locked" @click="emit('cancel')">Cancel</button><button type="submit" class="button primary" :disabled="locked||!selectedValid.length||hasCreationDraft"><Link2 :size="16"/>{{busy?'Linking…':`Link ${selectedValid.length||''} ${selectedValid.length===1?'note':'notes'}`}}</button></div>
    </form>
    <form v-if="createVisited" v-show="creating" class="note-create-form" @submit.prevent="create">
      <label>Title<input ref="titleInput" v-model="title" maxlength="500" required :disabled="locked" placeholder="Give your note a title" aria-label="New note title"/></label>
      <label>Save in folder<input v-model="category" list="note-create-categories" maxlength="200" :disabled="locked" placeholder="Default folder" aria-label="New note folder"/><datalist id="note-create-categories"><option v-for="name in categoryChoices" :key="name" :value="name"/></datalist></label>
      <MarkdownEditor v-model="content" label="New note content" placeholder="Write a brief, checklist or reference…" :rows="7" :disabled="locked"/>
      <p class="field-hint">Creates a real Nextcloud note and selects it for linking to {{record.title}}.</p>
      <p v-if="error" class="inline-error" role="alert">{{error}}</p>
      <div class="form-actions"><button type="button" class="button quiet" :disabled="locked" @click="tab='notes'">Back to notes</button><button type="submit" class="button primary" :disabled="locked||!canCreate||!title.trim()"><Plus :size="16"/>{{busy?'Creating…':'Create note'}}</button></div>
    </form>
    <div v-show="tab==='files'" class="other-files-tab">
      <div class="other-files-toolbar"><span>Choose existing files or upload from this device.</span><button type="button" class="button quiet" :disabled="locked||!canUpload||record.readonly||!api?.uploadDeckAttachment" @click="upload"><LoaderCircle v-if="uploading" :size="15" class="spinning"/><Upload v-else :size="15"/>{{uploading?'Uploading…':'Upload file'}}</button></div>
      <p v-if="uploadMessage" class="upload-success" role="status">{{uploadMessage}}</p>
      <p v-if="fileError" class="inline-error" role="alert">{{fileError}}</p>
      <p v-if="error" class="inline-error" role="alert">{{error}}</p>
      <CloudFilePicker v-if="api&&filesVisited&&canBrowse" :record="record" :api="api" :can-write="Boolean(canAttachFiles)" :busy="busy||uploading" embedded @changed="emit('changed')" @busy="fileBusy" @dirty="fileSelectionDirty=$event" @cancel="emit('cancel')" @done="filesDone"/>
      <p v-if="selectedValid.length||hasCreationDraft" class="field-hint">Your note selections and new-note draft stay available in the Notes tabs.</p>
    </div>
  </div>
</template>

<style scoped>
.other-files-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px}.other-files-toolbar>span{font-size:12px;color:var(--muted)}.other-files-toolbar>.button{flex:none;font-size:12px}.upload-success{font-size:13px;color:var(--primary);margin:0 0 12px}.note-picker-tabs{flex-wrap:wrap}

.note-unfinished-draft{background:var(--hover);border:1px solid var(--border);border-radius:8px;padding:11px 12px;margin-top:12px}.note-unfinished-draft p{font-size:12px;color:var(--muted);margin:0 0 8px}.note-unfinished-draft button{font-size:12px;margin-right:14px}
.note-link-picker h2{font-size:24px;margin:8px 0 16px}.note-link-context{display:flex;align-items:center;gap:9px;background:var(--primary-soft);color:var(--primary-soft-text);padding:11px 12px;border-radius:8px;margin:0 0 16px;overflow-wrap:anywhere}.note-link-context svg{flex:none}.note-picker-tabs{display:flex;gap:7px;border-bottom:1px solid var(--border);margin-bottom:16px;padding-bottom:10px}.note-picker-tabs button{display:flex;align-items:center;gap:7px;padding:9px 12px;border:0;border-radius:7px;background:transparent;color:var(--muted);cursor:pointer}.note-picker-tabs button.active{background:var(--primary-soft);color:var(--primary-soft-text)}.note-picker-tabs small{border-radius:20px;padding:1px 5px;background:var(--surface)}.note-picker-search{display:flex;flex-direction:row;align-items:center;gap:9px;border:1px solid var(--border);border-radius:8px;padding:0 12px}.note-picker-search input{border:0;background:transparent;padding:11px 0;box-shadow:none;min-width:0;flex:1}.note-picker-search:focus-within{outline:2px solid var(--primary)}.note-picker-count{display:flex;justify-content:space-between;margin:12px 0 8px;font-size:12px;color:var(--muted)}.note-picker-results{max-height:40vh;overflow:auto;overscroll-behavior:contain;border:1px solid var(--border);border-radius:9px;min-height:140px}.note-picker-more{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;color:var(--muted);font-size:12px}.note-picker-more .button{flex:none;font-size:12px}.note-picker-empty{display:flex;flex-direction:column;align-items:center;gap:9px;padding:28px 16px;text-align:center;color:var(--muted);font-size:13px}.note-picker-empty strong{color:var(--text)}.note-create-form>label{margin-bottom:14px}.note-create-form>label input{margin-top:6px}.form-actions{margin-top:18px}.note-link-picker button:disabled{cursor:not-allowed;opacity:.55}
</style>
