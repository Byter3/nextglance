<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { markdownTasks, toggleMarkdownTask, type MarkdownTask } from '@nextspace/core/markdown.mjs'

const props = withDefaults(defineProps<{body: string; editableTasks?:boolean; pageId?: string; readAsset?: (input:{id:string;path:string}) => Promise<{dataUrl:string}>}>(),{editableTasks:false})
const emit = defineEmits<{link: [url: string];toggleTask:[body:string]}>()
const container = ref<HTMLElement>()
const markdown = new MarkdownIt({html: false, linkify: true, breaks: true})
// Only parser-mapped list markers get controls. Code examples and arbitrary HTML
// never become controls, and read-only descriptions keep their controls disabled.
markdown.core.ruler.after('inline', 'description_task_lists', state => {
  for (let index=2;index<state.tokens.length;index++) {
    const inline=state.tokens[index],paragraph=state.tokens[index-1],item=state.tokens[index-2]
    if(inline.type!=='inline'||paragraph.type!=='paragraph_open'||item.type!=='list_item_open')continue
    const marker=/^\[([ xX])\](?:\s+|$)/.exec(inline.content),first=inline.children?.[0]
    const task=(state.env.tasks as MarkdownTask[]).find(task=>task.line===paragraph.map?.[0])
    if(!marker||!task||!first||first.type!=='text'||!first.content.startsWith(marker[0]))continue
    const checked=marker[1].toLowerCase()==='x'
    first.content=first.content.slice(marker[0].length)
    item.attrJoin('class','markdown-task-item')
    const checkbox=new state.Token('html_inline','',0)
    checkbox.content=`<button type="button" class="markdown-task-checkbox" data-task-offset="${task.offset}" role="checkbox" aria-checked="${checked}" aria-disabled="${!state.env.editableTasks}" aria-label="${markdown.utils.escapeHtml(task.text||'Checklist item')}"${state.env.editableTasks?'':' disabled'}>${checked?'✓':''}</button>`
    inline.children!.unshift(checkbox)
  }
})
// Nextcloud Text stores inserted attachments as literal <img> tags. Recognize
// only that inline syntax, without enabling HTML or inserting a remote image
// into even a detached DOM. All attributes except src and alt are discarded.
markdown.inline.ruler.before('html_inline', 'collectives_image', (state, silent) => {
  if (state.src[state.pos] !== '<') return false
  const match = /^<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(state.src.slice(state.pos, state.pos + 8192))
  if (!match) return false
  const attributes = match[0].slice(4, -1)
  const values = new Map<string, string>()
  const attributePattern = /([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  for (const attribute of attributes.matchAll(attributePattern)) {
    const name = attribute[1].toLowerCase()
    if ((name === 'src' || name === 'alt') && !values.has(name)) values.set(name, String(markdown.utils.unescapeAll(attribute[2] ?? attribute[3] ?? attribute[4] ?? '')))
  }
  const path = values.get('src')
  if (!path) return false
  if (!silent) {
    const token = state.push('image', 'img', 0)
    token.attrs = [['src', path]]
    token.content = values.get('alt') || 'Page image'
  }
  state.pos += match[0].length
  return true
})
// Images are resolved in the main process. Never send credentials or arbitrary remote
// requests from the renderer, even when a page contains a tracking image.
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]
  const path = markdown.utils.escapeHtml(String(token.attrGet('src') || ''))
  const alt = markdown.utils.escapeHtml(token.content || 'Page image')
  return `<span class="markdown-image" data-asset="${path}" role="img" aria-label="${alt}">${alt} <small>— image</small></span>`
}
const rendered = computed(() => DOMPurify.sanitize(markdown.render(props.body,{tasks:markdownTasks(props.body),editableTasks:props.editableTasks}), {USE_PROFILES:{html:true}, FORBID_TAGS:['img','iframe','style','form','input','video','audio'], FORBID_ATTR:['style']}))
let generation = 0
watch(() => [props.body, props.pageId], async () => {
  const current = ++generation
  await nextTick()
  if (!props.pageId || !props.readAsset) return
  const pageId = props.pageId
  const images = Array.from(container.value?.querySelectorAll<HTMLElement>('[data-asset]') || []).slice(0, 30)
  // Sequential fetching bounds server load and ensures cancellation on page navigation.
  for (const placeholder of images) {
    if (current !== generation) return
    try {
      const {dataUrl} = await props.readAsset({id: pageId, path: placeholder.dataset.asset || ''})
      if (current !== generation || !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(dataUrl)) continue
      const image = document.createElement('img'); image.src = dataUrl; image.alt = placeholder.getAttribute('aria-label') || 'Page image'; image.loading = 'lazy'
      placeholder.replaceChildren(image)
    } catch { placeholder.title = 'Image unavailable. Open the original page in Nextcloud to view it.' }
  }
}, {immediate:true, flush:'post'})
function clicked(event: MouseEvent) {
  const checkbox=(event.target as HTMLElement).closest<HTMLButtonElement>('.markdown-task-checkbox')
  if(checkbox){
    event.preventDefault()
    if(props.editableTasks&&!checkbox.disabled){
      const changed=toggleMarkdownTask(props.body,Number(checkbox.dataset.taskOffset))
      if(changed!==props.body)emit('toggleTask',changed)
    }
    return
  }
  const link = (event.target as HTMLElement).closest('a')
  if (!link) return
  event.preventDefault()
  const href = link.getAttribute('href')
  if (href) emit('link', href)
}
</script>

<template><div ref="container" class="markdown-content" @click="clicked" v-html="rendered"></div></template>

<style scoped>
.markdown-content{min-width:0;max-width:100%;max-height:none;overflow:visible;font-size:15.5px;line-height:1.65;color:var(--text);overflow-wrap:anywhere}
.markdown-content :deep(p){margin:0 0 .9em}
.markdown-content :deep(h1),.markdown-content :deep(h2),.markdown-content :deep(h3),.markdown-content :deep(h4),.markdown-content :deep(h5),.markdown-content :deep(h6){font-weight:650;line-height:1.35;color:var(--heading);margin:1.3em 0 .55em;overflow-wrap:anywhere}
.markdown-content :deep(h1){font-size:1.6em}.markdown-content :deep(h2){font-size:1.35em}.markdown-content :deep(h3){font-size:1.15em}.markdown-content :deep(h4),.markdown-content :deep(h5),.markdown-content :deep(h6){font-size:1em}
.markdown-content :deep(ul),.markdown-content :deep(ol){padding-left:1.6em;margin:.75em 0 1em}
.markdown-content :deep(li){margin:.3em 0;padding-left:.15em}
.markdown-content :deep(li>p){margin:.35em 0}
.markdown-content :deep(li>ul),.markdown-content :deep(li>ol){margin:.35em 0}
.markdown-content :deep(a){color:var(--primary);text-decoration:underline;text-underline-offset:2px}
.markdown-content :deep(a:focus-visible){outline:2px solid var(--primary);outline-offset:3px;border-radius:2px}
.markdown-content :deep(blockquote){margin:1em 0;padding:.2em 0 .2em 1em;border-left:3px solid var(--border-strong);color:var(--muted)}
.markdown-content :deep(blockquote>p:last-child){margin-bottom:0}
.markdown-content :deep(code){font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88em;background:var(--canvas);border-radius:4px;padding:.15em .35em;overflow-wrap:anywhere}
.markdown-content :deep(pre){max-width:100%;overflow-x:auto;margin:1em 0;padding:14px;background:var(--canvas);border:1px solid var(--border);border-radius:6px;font-size:13.5px;line-height:1.55;white-space:pre;overflow-wrap:normal}
.markdown-content :deep(pre code){padding:0;border:0;border-radius:0;background:transparent;font-size:inherit;line-height:inherit;white-space:pre;overflow-wrap:normal}
.markdown-content :deep(table){display:block;width:max-content;max-width:100%;overflow-x:auto;margin:1em 0;border-collapse:collapse;font-size:14px;line-height:1.5}
.markdown-content :deep(th),.markdown-content :deep(td){min-width:72px;padding:9px 11px;border:1px solid var(--border);text-align:left;vertical-align:top}
.markdown-content :deep(th){font-weight:600;background:var(--canvas)}
.markdown-content :deep(hr){border:0;border-top:1px solid var(--border);margin:1.5em 0}
.markdown-content :deep(.markdown-task-item){position:relative;list-style:none}
.markdown-content :deep(.markdown-task-checkbox){position:absolute;left:-1.4em;top:.32em;display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;padding:0;margin:0;border:1.5px solid var(--border-strong);border-radius:3px;background:var(--surface);font-size:.9em;line-height:1;color:var(--muted);cursor:pointer}
.markdown-content :deep(.markdown-task-checkbox[aria-checked=true]){background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.markdown-content :deep(.markdown-task-checkbox:disabled){opacity:1;cursor:default}
.markdown-content :deep(.markdown-task-checkbox:hover:not(:disabled)){box-shadow:0 0 0 3px var(--primary-soft)}
.markdown-content :deep(.markdown-task-checkbox:focus-visible){outline:2px solid var(--primary);outline-offset:3px}
.markdown-content :deep(.markdown-image){display:block;max-width:100%;margin:1em 0;font-size:13px;color:var(--muted)}
.markdown-content :deep(.markdown-image img){display:block;max-width:100%;height:auto;border-radius:6px}
.markdown-content > :deep(:first-child){margin-top:0}
.markdown-content > :deep(:last-child){margin-bottom:0}
</style>
