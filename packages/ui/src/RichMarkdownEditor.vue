<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'
import { Bold, Italic, Heading2, List, ListOrdered, ListTodo, Quote, Code2, Link, Table2, Undo2, Redo2 } from 'lucide-vue-next'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import DOMPurify from 'dompurify'
import { markdownEquivalent, markdownVisualIssue } from '@nextspace/core/markdown.mjs'
import MarkdownContent from './MarkdownContent.vue'

const props=withDefaults(defineProps<{modelValue:string;label?:string;disabled?:boolean;placeholder?:string;rows?:number}>(),{label:'Markdown',disabled:false,placeholder:'Write a description…',rows:12})
const emit=defineEmits<{'update:modelValue':[value:string];link:[url:string]}>()
type Mode='visual'|'source'|'preview'
type Action='bold'|'italic'|'heading'|'bullet'|'numbered'|'task'|'quote'|'code'|'link'|'table'|'undo'|'redo'
const textarea=ref<HTMLTextAreaElement>(),mode=ref<Mode>('visual'),visualIssue=ref('')
const linkOpen=ref(false),linkUrl=ref(''),linkError=ref('')
const id=useId(),inputId=`markdown-input-${id}`,visualId=`markdown-visual-${id}`,sourceId=`markdown-source-${id}`,previewId=`markdown-preview-${id}`
let loading=false,lastVisualEmission:string|undefined,originalBody='',originalDocument=''
function safePastedHTML(html:string){
  // Remove media and URL-bearing image attributes before any HTML parser sees them.
  const defanged=html.replace(/<(?:img|image|svg|iframe|video|audio|source|object|embed|link|script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi,'').replace(/\s(?:src|srcset|poster|background|style)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')
  return DOMPurify.sanitize(defanged,{USE_PROFILES:{html:true},FORBID_TAGS:['img','iframe','video','audio','source','object','embed','link','script','style'],FORBID_ATTR:['style','src','srcset','poster','background']})
}
const richEditor=useEditor({
  extensions:[StarterKit.configure({underline:false,trailingNode:false,link:{openOnClick:false,autolink:false,linkOnPaste:false}}),TaskList,TaskItem.configure({nested:true,HTMLAttributes:{'data-type':'taskItem'}}),TableKit.configure({table:{resizable:false}}),Markdown.configure({markedOptions:{gfm:true,breaks:true}})],
  content:'',editable:!props.disabled,
  editorProps:{
    attributes:{class:'markdown-rich-text',role:'textbox','aria-label':`${props.label} formatted text`,'aria-multiline':'true',spellcheck:'true'},
    transformPastedHTML:safePastedHTML,
    handleClick:(_view,_pos,event)=>{
      const anchor=(event.target as HTMLElement).closest('a')
      if(anchor&&(event.ctrlKey||event.metaKey)){event.preventDefault();const href=anchor.getAttribute('href');if(href)emit('link',href);return true}
      return false
    },
  },
  onUpdate:({editor,transaction})=>{
    if(loading||props.disabled||mode.value!=='visual'||!transaction.docChanged)return
    const value=JSON.stringify(editor.getJSON())===originalDocument?originalBody:editor.getMarkdown()
    lastVisualEmission=value;emit('update:modelValue',value)
  },
})
function loadVisual(body:string){
  const editor=richEditor.value
  if(!editor)return
  loading=true
  try{
    let issue=markdownVisualIssue(body)
    if(!issue){
      editor.commands.setContent(body,{contentType:'markdown',emitUpdate:false})
      if(!markdownEquivalent(body,editor.getMarkdown()))issue='This description has formatting that needs Markdown source to preserve it.'
      originalDocument=JSON.stringify(editor.getJSON())
    }
    originalBody=body;visualIssue.value=issue
    if(issue&&mode.value==='visual')mode.value='source'
    editor.setEditable(!props.disabled&&!issue,false)
  }catch{
    visualIssue.value='This description needs Markdown source to preserve its formatting.'
    mode.value='source';editor.setEditable(false,false)
  }finally{loading=false}
}
watch([richEditor,()=>props.modelValue],([editor,body])=>{
  if(!editor)return
  if(body===lastVisualEmission){lastVisualEmission=undefined;return}
  loadVisual(body)
},{immediate:true,flush:'post'})
watch(()=>props.disabled,value=>richEditor.value?.setEditable(!value&&!visualIssue.value,false))
function selection(){
  const input=textarea.value,value=input?.value??props.modelValue
  return {value,start:input?.selectionStart??value.length,end:input?.selectionEnd??value.length}
}
async function edit(start:number,end:number,replacement:string,selectStart=start+replacement.length,selectEnd=selectStart){
  if(props.disabled)return
  const value=textarea.value?.value??props.modelValue
  emit('update:modelValue',value.slice(0,start)+replacement+value.slice(end))
  await nextTick()
  textarea.value?.focus()
  textarea.value?.setSelectionRange(selectStart,selectEnd)
}
function wrap(marker:string,placeholder:string){
  const {value,start,end}=selection(),chosen=value.slice(start,end)
  const exactMarker=(part:string)=>part.startsWith(marker)&&part.endsWith(marker)&&part.length>=marker.length*2&&(marker!=='*'||!part.startsWith('**')&&!part.endsWith('**'))
  if(exactMarker(chosen)){
    const text=chosen.slice(marker.length,-marker.length)
    void edit(start,end,text,start,start+text.length)
  }else if(value.slice(start-marker.length,start)===marker&&value.slice(end,end+marker.length)===marker&&(marker!=='*'||value[start-2]!=='*'&&value[end+1]!=='*')){
    void edit(start-marker.length,end+marker.length,chosen,start-marker.length,end-marker.length)
  }else{
    const text=chosen||placeholder
    void edit(start,end,marker+text+marker,start+marker.length,start+marker.length+text.length)
  }
}
function prefixLines(kind:'heading'|'bullet'|'numbered'|'task'|'quote'){
  const {value,start,end}=selection(),lineStart=start===0?0:value.lastIndexOf('\n',start-1)+1
  const edge=end>start&&value[end-1]==='\n'?end-1:end,nextBreak=value.indexOf('\n',edge),lineEnd=nextBreak<0?value.length:nextBreak
  const lines=value.slice(lineStart,lineEnd).split('\n')
  const marker={heading:/^##\s+/,bullet:/^[-*+]\s+(?!\[[ xX]\]\s)/,numbered:/^\d+[.)]\s+/,task:/^[-*+]\s+\[[ xX]\]\s+/,quote:/^>\s?/}[kind]
  const remove=lines.every(line=>marker.test(line.trimStart()))
  const changed=lines.map((line,index)=>{
    const indent=/^\s*/.exec(line)?.[0]||'',text=line.slice(indent.length)
    if(remove)return indent+text.replace(marker,'')
    const clean=kind==='heading'?text.replace(/^#{1,6}\s+/,''):kind==='quote'?text:text.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/,'')
    const prefix={heading:'## ',bullet:'- ',numbered:`${index+1}. `,task:'- [ ] ',quote:'> '}[kind]
    return indent+prefix+clean
  }).join('\n')
  void edit(lineStart,lineEnd,changed,start===end?lineStart+changed.length:lineStart,lineStart+changed.length)
}
function codeBlock(){
  const {value,start,end}=selection(),text=value.slice(start,end)||'code'
  const longest=Math.max(0,...(text.match(/`+/g)||[]).map(run=>run.length)),fence='`'.repeat(Math.max(3,longest+1))
  const before=start>0&&value[start-1]!=='\n'?'\n':'',after=end<value.length&&value[end]!=='\n'?'\n':''
  const replacement=`${before}${fence}\n${text}\n${fence}${after}`,contentStart=start+before.length+fence.length+1
  void edit(start,end,replacement,contentStart,contentStart+text.length)
}
function insertLink(){
  const {value,start,end}=selection(),chosen=value.slice(start,end),isUrl=/^https?:\/\/\S+$/i.test(chosen)
  const text=isUrl?'link text':chosen.replace(/\n/g,' ').replace(/]/g,'\\]')||'link text',url=isUrl?chosen:'https://'
  const replacement=`[${text}](${url})`,selectionStart=isUrl?start+1:start+text.length+3
  void edit(start,end,replacement,selectionStart,selectionStart+(isUrl?text.length:url.length))
}
const tools:{label:string;icon:typeof Bold;action:Action}[]=[
  {label:'Bold',icon:Bold,action:'bold'},{label:'Italic',icon:Italic,action:'italic'},
  {label:'Heading',icon:Heading2,action:'heading'},{label:'Bulleted list',icon:List,action:'bullet'},
  {label:'Numbered list',icon:ListOrdered,action:'numbered'},{label:'Task list',icon:ListTodo,action:'task'},
  {label:'Quote',icon:Quote,action:'quote'},{label:'Code block',icon:Code2,action:'code'},
  {label:'Insert link',icon:Link,action:'link'},{label:'Table',icon:Table2,action:'table'},
  {label:'Undo',icon:Undo2,action:'undo'},{label:'Redo',icon:Redo2,action:'redo'},
]
function active(action:Action){
  const names:Partial<Record<Action,string>>={bold:'bold',italic:'italic',heading:'heading',bullet:'bulletList',numbered:'orderedList',task:'taskList',quote:'blockquote',code:'codeBlock',link:'link',table:'table'}
  return mode.value==='visual'&&Boolean(names[action]&&richEditor.value?.isActive(names[action]!))
}
function run(action:Action){
  if(props.disabled||mode.value==='preview')return
  if(mode.value==='source'){
    if(action==='bold')wrap('**','bold text')
    else if(action==='italic')wrap('*','italic text')
    else if(action==='code')codeBlock()
    else if(action==='link')insertLink()
    else if(action==='table'){const {start,end}=selection();void edit(start,end,'\n| Column 1 | Column 2 |\n| --- | --- |\n| Content | Content |\n')}
    else if(action!=='undo'&&action!=='redo')prefixLines(action)
    return
  }
  const editor=richEditor.value
  if(!editor||visualIssue.value)return
  const chain=editor.chain().focus()
  if(action==='bold')chain.toggleBold().run()
  else if(action==='italic')chain.toggleItalic().run()
  else if(action==='heading')chain.toggleHeading({level:2}).run()
  else if(action==='bullet')chain.toggleBulletList().run()
  else if(action==='numbered')chain.toggleOrderedList().run()
  else if(action==='task')chain.toggleTaskList().run()
  else if(action==='quote')chain.toggleBlockquote().run()
  else if(action==='code')chain.toggleCodeBlock().run()
  else if(action==='table')chain.insertTable({rows:3,cols:3,withHeaderRow:true}).run()
  else if(action==='undo')chain.undo().run()
  else if(action==='redo')chain.redo().run()
  else {linkUrl.value=editor.getAttributes('link').href||'https://';linkError.value='';linkOpen.value=true}
}
function applyLink(){
  const href=linkUrl.value.trim()
  if(href&&!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)){linkError.value='Enter an https://, mailto:, or relative link.';return}
  const chain=richEditor.value?.chain().focus().extendMarkRange('link')
  if(href)chain?.setLink({href}).run();else chain?.unsetLink().run()
  linkOpen.value=false
}
function shortcuts(event:KeyboardEvent){
  if(props.disabled||event.altKey||!event.ctrlKey&&!event.metaKey)return
  if(event.key.toLowerCase()==='b'){event.preventDefault();wrap('**','bold text')}
  if(event.key.toLowerCase()==='i'){event.preventDefault();wrap('*','italic text')}
}
function tabKeys(event:KeyboardEvent){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
  event.preventDefault()
  const modes:Mode[]=visualIssue.value?['source','preview']:['visual','source','preview'],index=modes.indexOf(mode.value)
  mode.value=event.key==='Home'?modes[0]!:event.key==='End'?'preview':modes[(index+(event.key==='ArrowRight'?1:-1)+modes.length)%modes.length]!
  const tabs=event.currentTarget as HTMLElement
  void nextTick(()=>tabs.querySelector<HTMLButtonElement>(`[data-mode="${mode.value}"]`)?.focus())
}
</script>

<template>
  <section class="markdown-editor" :class="{'is-disabled':disabled}">
    <header class="markdown-editor-header">
      <label :for="mode==='source'?inputId:undefined">{{label}}</label>
      <div class="markdown-editor-tabs" role="tablist" :aria-label="`${label} mode`" @keydown="tabKeys">
        <button type="button" role="tab" data-mode="visual" :aria-selected="mode==='visual'" :aria-controls="visualId" :tabindex="mode==='visual'?0:-1" :disabled="Boolean(visualIssue)" @click="mode='visual'">Formatted</button>
        <button type="button" role="tab" data-mode="source" :aria-selected="mode==='source'" :aria-controls="sourceId" :tabindex="mode==='source'?0:-1" @click="mode='source'">Markdown</button>
        <button type="button" role="tab" data-mode="preview" :aria-selected="mode==='preview'" :aria-controls="previewId" :tabindex="mode==='preview'?0:-1" @click="mode='preview'">Preview</button>
      </div>
    </header>
    <p v-if="visualIssue" class="markdown-editor-notice">{{visualIssue}} Your original text is unchanged until you edit it.</p>
    <div class="markdown-editor-toolbar" role="toolbar" aria-label="Markdown formatting">
      <button v-for="tool in tools" :key="tool.label" type="button" :aria-label="tool.label" :aria-controls="mode==='visual'?visualId:inputId" :aria-pressed="active(tool.action)" :title="tool.label" :disabled="disabled||mode==='preview'||mode==='source'&&(tool.action==='undo'||tool.action==='redo')" @mousedown.prevent @click="run(tool.action)"><component :is="tool.icon" :size="17" aria-hidden="true"/></button>
    </div>
    <div v-if="linkOpen&&mode==='visual'" class="markdown-link-form">
      <label>Link URL<input v-model="linkUrl" type="text" inputmode="url" aria-label="Link URL" :disabled="disabled" @keydown.enter.prevent="applyLink" @keydown.esc="linkOpen=false"/></label>
      <button type="button" class="button small" :disabled="disabled" @click="applyLink">Apply link</button><button type="button" class="text-button" @click="linkOpen=false">Cancel</button>
      <p v-if="linkError" role="alert">{{linkError}}</p>
    </div>
    <div v-if="mode==='visual'&&richEditor?.isFocused&&richEditor.isActive('table')" class="markdown-table-tools">
      <button type="button" :disabled="disabled" @mousedown.prevent @click="richEditor?.chain().focus().addRowAfter().run()">Add row</button>
      <button type="button" :disabled="disabled" @mousedown.prevent @click="richEditor?.chain().focus().addColumnAfter().run()">Add column</button>
      <button type="button" :disabled="disabled" @mousedown.prevent @click="richEditor?.chain().focus().deleteTable().run()">Remove table</button>
    </div>
    <div v-show="mode==='visual'" :id="visualId" class="markdown-editor-visual" role="tabpanel" :aria-label="`${label} formatted editor`">
      <EditorContent :editor="richEditor"/>
    </div>
    <div v-show="mode==='source'" :id="sourceId" class="markdown-editor-source" role="tabpanel" :aria-label="`${label} source editor`">
      <textarea :id="inputId" ref="textarea" :value="modelValue" :aria-label="label" :rows="rows" :placeholder="placeholder" :disabled="disabled" spellcheck="true" @input="emit('update:modelValue',($event.target as HTMLTextAreaElement).value)" @keydown="shortcuts"></textarea>
    </div>
    <div v-show="mode==='preview'" :id="previewId" class="markdown-editor-preview" role="tabpanel" :aria-label="`${label} preview`">
      <MarkdownContent v-if="mode==='preview'&&modelValue.trim()" :body="modelValue" @link="emit('link',$event)"/>
      <p v-else class="markdown-editor-empty">Nothing to preview yet.</p>
    </div>
  </section>
</template>

<style scoped>
.markdown-editor{min-width:0;max-width:100%;border:1px solid var(--border-strong);border-radius:8px;background:var(--surface);overflow:hidden}
.markdown-editor-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:9px 11px;border-bottom:1px solid var(--border)}
.markdown-editor-header>label{font-size:13px;font-weight:550;color:var(--text)}
.markdown-editor-tabs{display:flex;gap:3px;border-radius:6px;background:var(--canvas);padding:3px}
.markdown-editor-tabs button{font-size:12px;padding:5px 10px;border-radius:4px;color:var(--muted)}
.markdown-editor-tabs button[aria-selected=true]{background:var(--primary-soft);color:var(--primary-soft-text,var(--primary));font-weight:550}
.markdown-editor-toolbar{display:flex;gap:2px;flex-wrap:wrap;padding:5px 7px;border-bottom:1px solid var(--border);background:var(--canvas)}
.markdown-editor-toolbar button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:5px;color:var(--text)}
.markdown-editor-toolbar button:hover:not(:disabled){background:var(--hover);color:var(--primary)}
.markdown-editor-toolbar button[aria-pressed=true]{background:var(--primary-soft);color:var(--primary-soft-text,var(--primary))}
.markdown-editor-toolbar button:focus-visible,.markdown-editor-tabs button:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
.markdown-editor-source textarea{display:block;width:100%;min-height:240px;resize:vertical;border:0;border-radius:0;margin:0;padding:14px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:15px;line-height:1.65;background:var(--surface);color:var(--text);tab-size:2}
.markdown-editor-source textarea:focus{outline:2px solid var(--primary);outline-offset:-2px;box-shadow:none}
.markdown-editor-source textarea:disabled{opacity:.7}
.markdown-editor-preview{min-height:240px;min-width:0;padding:16px}
.markdown-editor-empty{font-size:14px;line-height:1.65;color:var(--muted);margin:0}
.markdown-editor-notice{padding:10px 12px;margin:0;font-size:12px;line-height:1.5;color:var(--muted);background:var(--canvas);border-bottom:1px solid var(--border)}
.markdown-editor-visual :deep(.markdown-rich-text){min-height:260px;min-width:0;padding:16px;outline:0;font-size:15.5px;line-height:1.65;overflow-wrap:anywhere}
.markdown-editor-visual :deep(.markdown-rich-text:focus){box-shadow:inset 0 0 0 2px var(--primary)}
.markdown-editor-visual :deep(p){margin:0 0 .9em}
.markdown-editor-visual :deep(h1),.markdown-editor-visual :deep(h2),.markdown-editor-visual :deep(h3),.markdown-editor-visual :deep(h4),.markdown-editor-visual :deep(h5),.markdown-editor-visual :deep(h6){font-weight:650;line-height:1.35;margin:1.2em 0 .5em;color:var(--heading)}
.markdown-editor-visual :deep(h1){font-size:1.6em}.markdown-editor-visual :deep(h2){font-size:1.35em}.markdown-editor-visual :deep(h3){font-size:1.15em}
.markdown-editor-visual :deep(ul),.markdown-editor-visual :deep(ol){padding-left:1.5em;margin:.75em 0 1em}
.markdown-editor-visual :deep(li){margin:.25em 0}
.markdown-editor-visual :deep(li p){margin:.2em 0}
.markdown-editor-visual :deep(ul[data-type=taskList]){list-style:none;padding-left:0}
.markdown-editor-visual :deep(li[data-type=taskItem]){display:flex;align-items:flex-start;gap:9px}
.markdown-editor-visual :deep(li[data-type=taskItem]>label){display:flex;flex-direction:row;flex:none;align-items:center;padding-top:7px;user-select:none}
.markdown-editor-visual :deep(li[data-type=taskItem]>div){flex:1;min-width:0}
.markdown-editor-visual :deep(li[data-type=taskItem] input){width:15px;height:15px;margin:0;accent-color:var(--primary)}
.markdown-editor-visual :deep(blockquote){border-left:3px solid var(--border-strong);margin:1em 0;padding:.2em 0 .2em 1em;color:var(--muted)}
.markdown-editor-visual :deep(code){font-family:ui-monospace,Consolas,monospace;font-size:.88em;background:var(--canvas);border-radius:3px;padding:2px 4px}
.markdown-editor-visual :deep(pre){max-width:100%;overflow-x:auto;white-space:pre;padding:14px;margin:1em 0;background:var(--canvas);border:1px solid var(--border);border-radius:6px;font-size:13.5px;line-height:1.55}
.markdown-editor-visual :deep(pre code){padding:0;background:none;font-size:inherit}
.markdown-editor-visual :deep(a){color:var(--primary);text-decoration:underline;cursor:text}
.markdown-editor-visual :deep(table){border-collapse:collapse;table-layout:fixed;width:100%;margin:1em 0;font-size:14px}
.markdown-editor-visual :deep(th),.markdown-editor-visual :deep(td){border:1px solid var(--border-strong);padding:8px;vertical-align:top;position:relative;min-width:70px}
.markdown-editor-visual :deep(th){background:var(--canvas);font-weight:600}
.markdown-editor-visual :deep(.tableWrapper){max-width:100%;overflow-x:auto}
.markdown-editor-visual :deep(.selectedCell:after){content:'';position:absolute;inset:0;pointer-events:none;background:color-mix(in srgb,var(--primary) 10%,transparent)}
.markdown-editor-visual :deep(.markdown-rich-text>:first-child){margin-top:0}
.markdown-editor-visual :deep(.markdown-rich-text>:last-child){margin-bottom:0}
.markdown-link-form{display:flex;align-items:end;flex-wrap:wrap;gap:8px;padding:10px 12px;background:var(--canvas);border-bottom:1px solid var(--border)}
.markdown-link-form label{flex:1;min-width:150px;font-size:12px}.markdown-link-form input{font-size:13px}.markdown-link-form p{width:100%;font-size:12px;color:var(--red)}
.markdown-table-tools{display:flex;gap:12px;flex-wrap:wrap;padding:8px 12px;background:var(--canvas);border-bottom:1px solid var(--border)}
.markdown-table-tools button{font-size:12px;color:var(--primary);padding:2px 0}
</style>
