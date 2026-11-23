import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {normalizeCalendarHistoryDays} from '@nextspace/core/history.mjs'

export async function readCalendarHistory(directory,{read=readFile}={}) {
  if(!directory)return null
  try {const value=JSON.parse(await read(path.join(directory,'calendar-history.json'),'utf8'));return value?.version===1?normalizeCalendarHistoryDays(value.days):null}
  catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error}
}
export async function saveCalendarHistory(directory,days,{writeJson}) {
  if(days!==normalizeCalendarHistoryDays(days))throw Object.assign(new Error('Calendar history must be All history or a whole number of days from 0 to 36500.'),{code:'VALIDATION'})
  await writeJson(path.join(directory,'calendar-history.json'),{version:1,days},{backup:false})
  return days
}

/** Serialize only publication/settings, not slow source reads or native edits. */
export class SourceHistorySession {
  constructor(days=null){this.days=normalizeCalendarHistoryDays(days);this.generation=0;this.queue=Promise.resolve();this.closed=false}
  ticket(){const generation=this.generation;return {days:this.days,current:()=>!this.closed&&this.generation===generation}}
  publish(operation){const result=this.queue.then(operation);this.queue=result.catch(()=>{});return result}
  set(days,persist){return this.publish(async()=>{if(this.closed)throw Object.assign(new Error('The source session changed.'),{code:'CANCELLED'});const value=await persist(days);this.days=value;this.generation++;return this.ticket()})}
  close(){this.closed=true;this.generation++}
}
