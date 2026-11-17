export interface MarkdownTask {line:number;offset:number;checked:boolean;text:string}
export function markdownTasks(body:string):MarkdownTask[]
export function toggleMarkdownTask(body:string,offset:number):string
export function markdownVisualIssue(body:string):string
export function markdownEquivalent(first:string,second:string):boolean
