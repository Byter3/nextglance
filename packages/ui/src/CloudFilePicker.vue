<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue'
import {ArrowLeft,Check,ChevronRight,File,Folder,Home,Link2,LoaderCircle,Search,X} from 'lucide-vue-next'
import type {CloudFile,WorkspaceApi,WorkspaceRecord} from '@nextspace/contracts'

const props=defineProps<{record:WorkspaceRecord;api:WorkspaceApi;canWrite:boolean;busy?:boolean;error?:string;embedded?:boolean}>()
const emit=defineEmits<{changed:[];busy:[value:boolean];dirty:[value:boolean];cancel:[];done:[]}>()
const path=ref(''),files=ref<CloudFile[]>([]),query=ref(''),selected=ref<CloudFile[]>([]),loading=ref(false),saving=ref(false),localError=ref(''),progress=ref('')
let generation=0,alive=true
const locked=computed(()=>props.busy||loading.value||saving.value)
const canAttach=computed(()=>props.canWrite&&!props.record.readonly&&Boolean(props.api.attachDeckFile))
const results=computed(()=>files.value.filter(file=>file.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name)))
const crumbs=computed(()=>path.value.split('/').filter(Boolean).map((name,index,parts)=>({name,path:`/${parts.slice(0,index+1).join('/')}`})))
const fileKey=(file:CloudFile)=>file.id||file.path
const isSelected=(file:CloudFile)=>selected.value.some(item=>fileKey(item)===fileKey(file))
watch(()=>selected.value.length,value=>emit('dirty',value>0),{immediate:true})
watch(()=>props.record.id,()=>{selected.value=[];localError.value='';progress.value=''})
async function navigate(target=''){
  if(saving.value||!props.api.listFiles)return
  const request=++generation;loading.value=true;localError.value='';query.value=''
  try{const result=await props.api.listFiles({path:target||'/'});if(!alive||request!==generation)return;path.value=result.path;files.value=result.files}
  catch(error){if(alive&&request===generation)localError.value=error instanceof Error?error.message:'Could not load this folder.'}
  finally{if(alive&&request===generation)loading.value=false}
}
function up(){const parts=path.value.split('/').filter(Boolean);parts.pop();void navigate(parts.length?`/${parts.join('/')}`:'')}
function toggle(file:CloudFile){if(locked.value||file.directory||!canAttach.value)return;selected.value=isSelected(file)?selected.value.filter(item=>fileKey(item)!==fileKey(file)):[...selected.value,file]}
function remove(file:CloudFile){if(!saving.value)selected.value=selected.value.filter(item=>fileKey(item)!==fileKey(file))}
function size(bytes?:number){if(bytes===undefined)return '';if(bytes<1024)return `${bytes} B`;if(bytes<1024**2)return `${Math.round(bytes/1024)} KB`;return `${(bytes/1024**2).toFixed(1)} MB`}
async function attach(){
  if(locked.value||!canAttach.value||!selected.value.length||!props.api.attachDeckFile)return
  saving.value=true;emit('busy',true);localError.value=''
  const cardId=props.record.id,items=[...selected.value],failures:string[]=[];let successes=0
  try{
    for(let index=0;index<items.length;index++){
      if(!alive)break
      if(!props.canWrite||props.record.id!==cardId){failures.push('The card is no longer available for editing.');break}
      const file=items[index];progress.value=`Attaching ${index+1} of ${items.length}: ${file.name}`
      try{await props.api.attachDeckFile({id:cardId,path:file.path});successes++;selected.value=selected.value.filter(item=>fileKey(item)!==fileKey(file))}
      catch(error){failures.push(`${file.name}: ${error instanceof Error?error.message:'Could not attach this file.'}`)}
    }
    if(failures.length)localError.value=`${successes?`${successes} ${successes===1?'file attached':'files attached'}. `:''}${failures.join(' ')} Your remaining selections are kept for retry.`
  }finally{
    saving.value=false;progress.value='';emit('busy',false)
    if(successes)emit('changed')
    if(alive&&!failures.length&&!selected.value.length)emit('done')
  }
}
onMounted(()=>void navigate())
onBeforeUnmount(()=>{alive=false;generation++})
</script>

<template>
  <div class="cloud-file-picker">
    <template v-if="!embedded"><span class="eyebrow">NATIVE DECK ATTACHMENTS</span><h2>Attach from Nextcloud Files</h2>
    <p class="cloud-file-context"><Link2 :size="17"/><span>{{record.title}}</span></p>
    <p class="cloud-file-sharing">Attached files are shared with this Deck board’s members with read access, just like “Share from Files” in Deck.</p></template>
    <nav class="cloud-file-breadcrumbs" aria-label="File location"><button type="button" class="icon-button" :disabled="locked||!path||path==='/'" aria-label="Up one folder" @click="up"><ArrowLeft :size="16"/></button><button type="button" :disabled="locked" @click="navigate('')"><Home :size="15"/>Files</button><template v-for="crumb in crumbs" :key="crumb.path"><ChevronRight :size="13"/><button type="button" :disabled="locked" :aria-current="crumb.path===path?'location':undefined" @click="navigate(crumb.path)">{{crumb.name}}</button></template></nav>
    <label class="cloud-file-search"><Search :size="16"/><input v-model="query" :disabled="locked" placeholder="Find a file in this folder…" aria-label="Find files in current folder"/></label>
    <div class="cloud-file-results" role="group" aria-label="Choose files to attach" :aria-busy="loading">
      <div v-if="loading" class="cloud-file-empty"><LoaderCircle :size="23" class="spinning"/><span>Loading Files…</span></div>
      <template v-else><div v-for="file in results" :key="fileKey(file)" class="cloud-file-row" :class="{chosen:isSelected(file)}"><button v-if="file.directory" type="button" class="cloud-file-folder" :disabled="locked" @click="navigate(file.path)"><Folder :size="19"/><strong>{{file.name}}</strong><ChevronRight :size="16"/></button><label v-else><input type="checkbox" :checked="isSelected(file)" :disabled="locked||!canAttach" :aria-label="file.name" @change="toggle(file)"/><File :size="18"/><strong>{{file.name}}</strong><small>{{size(file.size)}}</small><Check v-if="isSelected(file)" :size="16" class="cloud-file-check"/></label></div><div v-if="!results.length" class="cloud-file-empty"><Folder :size="24"/><strong>{{query?'No matching files':'This folder is empty'}}</strong><span>{{query?'Try another file name.':'Choose another folder to find files.'}}</span></div></template>
    </div>
    <div v-if="selected.length" class="cloud-file-selection"><strong>{{selected.length}} {{selected.length===1?'file':'files'}} selected</strong><div><span v-for="file in selected" :key="fileKey(file)" :title="file.path"><File :size="12"/><span>{{file.name}}</span><button type="button" :disabled="saving" :aria-label="`Remove ${file.name} from selection`" @click="remove(file)"><X :size="12"/></button></span></div></div>
    <p v-if="progress" class="field-hint" aria-live="polite">{{progress}}</p>
    <p v-if="localError||error" class="inline-error" role="alert">{{localError||error}}</p>
    <p v-if="!canAttach" class="field-hint">Connect to Nextcloud and choose an editable Deck card to attach files.</p>
    <footer><button type="button" class="button quiet" :disabled="saving||busy" @click="emit('cancel')">Cancel</button><button type="button" class="button primary" :disabled="locked||!canAttach||!selected.length" @click="attach"><Link2 :size="16"/>{{saving?'Attaching…':`Attach ${selected.length||''} ${selected.length===1?'file':'files'}`}}</button></footer>
  </div>
</template>

<style scoped>
.cloud-file-picker h2{font-size:24px;margin:8px 0 16px}.cloud-file-context{display:flex;align-items:center;gap:9px;background:var(--primary-soft);color:var(--primary-soft-text);padding:11px 12px;border-radius:8px;margin:0 0 12px;overflow-wrap:anywhere}.cloud-file-context svg{flex:none}.cloud-file-sharing{font-size:13px;line-height:1.6;color:var(--muted);margin:0 0 15px}.cloud-file-breadcrumbs{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.cloud-file-breadcrumbs button{display:flex;gap:5px;align-items:center;color:var(--text);border:0;border-radius:5px;padding:5px 7px;background:transparent;cursor:pointer;font-size:12px;max-width:100%;overflow-wrap:anywhere}.cloud-file-breadcrumbs button:hover{background:var(--hover)}.cloud-file-breadcrumbs>svg{color:var(--muted);flex:none}.cloud-file-breadcrumbs button[aria-current]{font-weight:700;color:var(--primary)}.cloud-file-search{display:flex;flex-direction:row;align-items:center;gap:8px;border:1px solid var(--border);border-radius:8px;padding:0 11px;margin-bottom:12px}.cloud-file-search input{padding:10px 0;background:transparent;border:0;box-shadow:none;min-width:0}.cloud-file-results{max-height:38vh;min-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;overscroll-behavior:contain}.cloud-file-row{border-bottom:1px solid var(--border)}.cloud-file-row:last-child{border-bottom:0}.cloud-file-row:hover{background:var(--hover)}.cloud-file-row.chosen{background:var(--primary-soft)}.cloud-file-folder,.cloud-file-row>label{display:flex;flex-direction:row;gap:10px;align-items:center;padding:13px 12px;width:100%;background:transparent;border:0;color:var(--text);text-align:left;cursor:pointer;margin:0}.cloud-file-folder>svg:first-child{color:var(--primary)}.cloud-file-row strong{font-size:13px;font-weight:600;flex:1;min-width:0;overflow-wrap:anywhere}.cloud-file-row small{font-size:11px;color:var(--muted)}.cloud-file-row svg{flex:none;color:var(--muted)}.cloud-file-row input{width:17px;height:17px;accent-color:var(--primary);flex:none}.cloud-file-row .cloud-file-check{color:var(--primary)}.cloud-file-empty{display:flex;flex-direction:column;align-items:center;gap:9px;padding:40px 15px;font-size:13px;color:var(--muted);text-align:center}.cloud-file-empty strong{color:var(--text)}.cloud-file-selection{margin-top:14px}.cloud-file-selection>strong{font-size:12px}.cloud-file-selection>div{display:flex;flex-wrap:wrap;gap:7px;max-height:100px;overflow:auto;margin-top:8px}.cloud-file-selection>div>span{display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:6px;padding:5px 7px;max-width:100%;font-size:12px}.cloud-file-selection>div>span>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}.cloud-file-selection button{display:flex;border:0;background:transparent;color:var(--muted);padding:0;cursor:pointer;flex:none}.cloud-file-picker footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.cloud-file-picker button:disabled{opacity:.55;cursor:not-allowed}
</style>
