<script lang="ts">
import {defineComponent,h} from 'vue'
import {deferredComponent} from './deferred-component'

// Source editing remains usable while the formatted editor downloads or retries.
// Content belongs to the caller's draft; loading never replaces that draft.
const SourceFallback=defineComponent({inheritAttrs:false,setup(_,{attrs}){return()=>h('label',{class:'deferred-markdown-source'},[
  h('span',String(attrs.label||'Markdown')),
  h('textarea',{value:attrs.modelValue||'',disabled:attrs.disabled,rows:attrs.rows||12,placeholder:attrs.placeholder||'Write a description…',onInput:(event:Event)=>(attrs['onUpdate:modelValue'] as ((value:string)=>void)|undefined)?.((event.target as HTMLTextAreaElement).value)}),
])}})
export default deferredComponent(()=>import('./RichMarkdownEditor.vue'),'Formatted editor',SourceFallback)
</script>
<style>
.deferred-content-status{display:flex;align-items:center;gap:6px;min-height:36px;font-size:12px;color:var(--muted);padding:6px 0}.deferred-markdown-source{display:grid;gap:8px}.deferred-markdown-source textarea{width:100%;min-height:180px;resize:vertical}
</style>
