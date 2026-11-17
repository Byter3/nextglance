import type {MarkdownTask} from './markdown.mjs'
export function checklistTaskLabel(text:string):string
export function boardChecklist(body:string):{tasks:(MarkdownTask & {label:string})[];completed:number;total:number}
