import MarkdownIt from 'markdown-it'
import {markdownTasks} from './markdown.mjs'

const parser = new MarkdownIt({html:false})
function label(tokens) {
  return tokens.map(token => token.type === 'softbreak' || token.type === 'hardbreak' ? ' '
    : token.children ? label(token.children)
    : token.type === 'text' || token.type === 'code_inline' ? token.content : '').join('')
}

/** A display projection of native Markdown markers, never separate task records. */
export function checklistTaskLabel(text) {
  return label(parser.parseInline(text, {})).trim()
}

export function boardChecklist(body) {
  const tasks = markdownTasks(body).map(task => ({...task, label:checklistTaskLabel(task.text) || 'Checklist item'}))
  return {tasks, completed:tasks.filter(task => task.checked).length, total:tasks.length}
}
