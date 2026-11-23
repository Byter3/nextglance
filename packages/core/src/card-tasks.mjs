import {boardChecklist,checklistTaskLabel} from './board-checklist.mjs'
import {allRelations,canAddRelation} from './planner.mjs'

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const clone=value=>structuredClone(value)
export const normalizeTaskLabel=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim()
export function taskCreationOptions(input){
  const result={}
  if(input.requestId!==undefined){if(typeof input.requestId!=='string'||!UUID.test(input.requestId))throw new Error('Choose a valid task creation request.');result.requestId=input.requestId.toLowerCase()}
  if(input.completed!==undefined){if(typeof input.completed!=='boolean')throw new Error('Task completion must be true or false.');result.completed=input.completed}
  return result
}
async function hash(value){return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
export async function cardTaskRequestId(nativeKey,key){
  const value=await hash(JSON.stringify(['nextglance-card-task-v1',nativeKey,key]))
  const chars=value.slice(0,32).split('');chars[12]='8';chars[16]=((parseInt(chars[16],16)&3)|8).toString(16)
  const text=chars.join('');return `${text.slice(0,8)}-${text.slice(8,12)}-${text.slice(12,16)}-${text.slice(16,20)}-${text.slice(20)}`
}
function identity(workspace,record){return workspace.identities?.find(entry=>entry.id===record.id&&entry.source===record.source)?.key||record.identity?.key}
function receipts(workspace,id){return workspace.properties?.[id]?.cardTasks||{}}
function validDate(value){
  if(typeof value!=='string'||value.length>80||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)||!Number.isFinite(Date.parse(value)))return false
  const [year,month,day]=value.slice(0,10).split('-').map(Number),date=new Date(0);date.setUTCFullYear(year,month-1,day)
  const time=value.includes('T')?value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/):null
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day&&(!time||+time[1]<24&&+time[2]<60&&+(time[3]||0)<60&&+(time[6]||0)<24&&+(time[7]||0)<60)
}
export function validateCardTaskReceipts(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>200)throw new Error('A card supports at most 200 task creation receipts.')
  for(const [key,r]of Object.entries(value)){
    if(!/^(checklist-[a-f0-9]{64}|manual-[a-f0-9-]{36})$/.test(key)||!r||r.version!==1||Object.keys(r).some(k=>!['version','requestId','collectionId','title','description','completed','start','due','checklist','taskIdentityKey'].includes(k)))throw new Error('Invalid card task receipt.')
    taskCreationOptions(r)
    if(key.startsWith('manual-')&&(!UUID.test(key.slice(7))||key.slice(7)!==r.requestId||r.checklist!==undefined)||key.startsWith('checklist-')&&(!r.checklist||typeof r.checklist!=='object'||Array.isArray(r.checklist)))throw new Error('Invalid card task request identity.')
    if(!UUID.test(r.requestId)||typeof r.collectionId!=='string'||!r.collectionId||r.collectionId.length>2048||typeof r.title!=='string'||!r.title.trim()||r.title!==r.title.trim()||r.title.length>500||typeof r.description!=='string'||r.description.length>20000||typeof r.completed!=='boolean')throw new Error('Invalid card task draft.')
    for(const field of ['start','due'])if(r[field]!==undefined&&!validDate(r[field]))throw new Error('Invalid card task date.')
    if(r.start&&r.due&&(Date.parse(r.due)<=Date.parse(r.start)||/^\d{4}-\d{2}-\d{2}$/.test(r.start)!==/^\d{4}-\d{2}-\d{2}$/.test(r.due)))throw new Error('Choose a due date after the task starts, with matching date types.')
    if(r.checklist&&(!key.startsWith('checklist-')||Object.keys(r.checklist).some(k=>!['text','occurrence'].includes(k))||typeof r.checklist.text!=='string'||!r.checklist.text||r.checklist.text!==normalizeTaskLabel(r.checklist.text)||r.checklist.text.length>500||!Number.isInteger(r.checklist.occurrence)||r.checklist.occurrence<1||r.checklist.occurrence>200))throw new Error('Invalid checklist receipt.')
    if(r.taskIdentityKey!==undefined&&(typeof r.taskIdentityKey!=='string'||!r.taskIdentityKey||r.taskIdentityKey.length>4096))throw new Error('Invalid created task identity.')
  }
  return value
}
export async function checklistTaskCandidates({card,workspace,records,relations=allRelations(workspace,records)}){
  const source=boardChecklist(card.body||'').tasks.map(row=>({...row,label:checklistTaskLabel(row.text)})),seen=new Map(),counts=new Map()
  for(const row of source){const text=normalizeTaskLabel(row.label);counts.set(text,(counts.get(text)||0)+1)}
  const linkedIds=new Set(relations.filter(edge=>edge.type==='depends_on'&&[edge.fromId,edge.toId].includes(card.id)).map(edge=>edge.fromId===card.id?edge.toId:edge.fromId))
  return Promise.all(source.map(async row=>{
    const title=row.label.trim(),text=normalizeTaskLabel(title),occurrence=(seen.get(text)||0)+1;seen.set(text,occurrence)
    const key=`checklist-${await hash(JSON.stringify([text,occurrence]))}`,receipt=receipts(workspace,card.id)[key]
    const base={key,title,text,occurrence,completed:row.checked,state:'new'}
    if(!text||title.length>500||text.length>500||source.length>200)return {...base,state:'invalid',message:'Use 1–500 characters per title and at most 200 checklist rows.'}
    if(receipt?.taskIdentityKey){const task=records.find(item=>item.source==='tasks'&&identity(workspace,item)===receipt.taskIdentityKey);return {...base,state:task?'existing':'unavailable',taskIdentityKey:receipt.taskIdentityKey,message:task?'Task already created.':'Task already created but not loaded. Refresh Tasks; it will not be recreated.'}}
    if(receipt)return {...base,message:'Resume this saved creation request.'}
    const matches=records.filter(item=>item.kind==='task'&&linkedIds.has(item.id)&&normalizeTaskLabel(item.title)===text)
    if(matches.length>1||matches.length&&counts.get(text)>1)return {...base,state:'ambiguous',message:'Several checklist rows or linked tasks have this name. Link and review them individually.'}
    if(matches.length===1){const native=identity(workspace,matches[0]);if(native)return {...base,state:'existing',taskIdentityKey:native,message:'Already linked; reuse this task.'}}
    return base
  }))
}
export async function prepareCardTask({card,workspace,collectionId,title,description='',start,due,completed=false,candidate,requestId}){
  if(card?.kind!=='card'||card.source!=='deck')throw new Error('Choose an available Deck card.')
  const nativeKey=identity(workspace,card);if(!nativeKey)throw new Error('Refresh this card before creating its tasks.')
  if(candidate&&['invalid','ambiguous','unavailable'].includes(candidate.state))throw new Error(candidate.message||'Review this checklist row first.')
  const key=candidate?.key||`manual-${requestId||globalThis.crypto.randomUUID()}`
  const existing=receipts(workspace,card.id)[key];if(existing){validateCardTaskReceipts({[key]:existing});return {key,receipt:clone(existing)}}
  const receipt={version:1,requestId:candidate?await cardTaskRequestId(nativeKey,key):key.slice(7),collectionId,title:String(title??candidate?.title??'').trim(),description,completed:candidate?.completed??completed,...(start?{start}:{}),...(due?{due}:{}),...(candidate?{checklist:{text:candidate.text,occurrence:candidate.occurrence}}:{}),...(candidate?.taskIdentityKey?{taskIdentityKey:candidate.taskIdentityKey}:{})}
  validateCardTaskReceipts({[key]:receipt});return {key,receipt}
}
function canonical(value){return value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value}
function sameReservation(a,b){const draft=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='taskIdentityKey'));return JSON.stringify(canonical(draft(a)))===JSON.stringify(canonical(draft(b)))}
function account(state){return JSON.stringify([state.connection?.serverUrl,state.connection?.username])}

/** All effects are injected. Cloud reservations precede native writes; native IDs survive uncertain responses. */
export async function createCardTasks({api,cardId,entries,deferLinkSync=false,onState=()=>{},onProgress=()=>{}}){
  if(!Array.isArray(entries)||!entries.length||entries.length>200||new Set(entries.map(e=>e.key)).size!==entries.length)throw new Error('Choose 1–200 different task rows.')
  for(const entry of entries)validateCardTaskReceipts({[entry.key]:entry.receipt})
  let state=await api.getState();const owner=account(state),card=state.records.find(item=>item.id===cardId&&item.kind==='card'),cardKey=card&&identity(state.workspace,card)
  const {serverUrl,username}=state.connection||{},expectedAccount=deferLinkSync&&serverUrl&&username?{serverUrl,username}:undefined
  if(!state.connection?.connected)throw new Error('Connect to Nextcloud before creating tasks.')
  if(deferLinkSync&&!expectedAccount)throw new Error('Reconnect to Nextcloud before creating tasks.')
  if(!cardKey)throw new Error('Refresh this card before creating tasks.')
  for(const {key,receipt}of entries)if(receipt.checklist&&(key!==`checklist-${await hash(JSON.stringify([receipt.checklist.text,receipt.checklist.occurrence]))}`||receipt.requestId!==await cardTaskRequestId(cardKey,key)))throw new Error('This checklist request identity is invalid. Reopen the checklist before retrying.')
  function accept(next,publish=false){if(!next.connection?.connected||account(next)!==owner)throw new Error('The connected account changed. Reopen this card before retrying.');state=next;if(publish)onState(next);return next}
  async function fresh(){return accept(await api.getState())}
  async function synced(){const next=accept(await api.syncWorkspace(),true);if(next.storage.syncStatus!=='synced')throw new Error(next.storage.message||'Planner data is not synced. Retry before creating tasks.');return next}
  function currentCard(){const item=state.records.find(record=>record.kind==='card'&&identity(state.workspace,record)===cardKey);if(!item)throw new Error('The card is no longer available. Refresh before retrying.');return item}
  async function save(workspace,synchronize=true){
    const saved=await api.saveWorkspace(workspace,state.revision,expectedAccount,!synchronize&&deferLinkSync?{coalesceLaunch:true}:undefined)
    if(synchronize)await synced()
    else if(deferLinkSync)accept({...state,...saved})
    else await fresh()
  }
  cardId=currentCard().id
  let workspace=clone(state.workspace);workspace.properties[cardId]||={};const reserved=workspace.properties[cardId].cardTasks||={}
  for(const entry of entries){if(reserved[entry.key]&&!sameReservation(reserved[entry.key],entry.receipt))throw new Error('This task request changed on another device. Refresh and use its saved destination.');reserved[entry.key]||=clone(entry.receipt)}
  validateCardTaskReceipts(reserved)
  onProgress({completed:0,total:entries.length,title:'',phase:'reserve'})
  await save(workspace)
  let created=0,reused=0,linked=0,linksSaved=0,publicationAttempted=false
  try{
    for(let index=0;index<entries.length;index++){
      if(index>0)await fresh()
      cardId=currentCard().id
      const entry=entries[index],receipt=receipts(state.workspace,cardId)[entry.key]
      if(!receipt||!sameReservation(receipt,entry.receipt))throw new Error('The saved task request changed. Refresh before retrying.')
      onProgress({completed:index,total:entries.length,title:receipt.title,phase:'create'})
      if(receipt.taskIdentityKey){if(!state.records.some(item=>item.kind==='task'&&identity(state.workspace,item)===receipt.taskIdentityKey))throw new Error('This task was already created but is not loaded. Refresh Tasks and review it; it will not be recreated.');reused++;continue}
      const collection=state.collections.find(c=>c.id===receipt.collectionId&&c.source==='tasks'&&!c.readonly)
      if(!collection)throw new Error('The saved task list is unavailable or read-only. Restore access before retrying.')
      const {title,description,start,due,completed,requestId}=receipt
      const next=await api.createTask({collectionId:collection.id,title,description,...(start?{start}:{}),...(due?{due}:{}),...(expectedAccount?{expectedAccount}:{}),completed,requestId});accept(next)
      const task=state.records.find(record=>record.id===next.createdRecordId&&record.kind==='task'),taskKey=task&&identity(state.workspace,task)
      if(!taskKey)throw new Error('Task creation could not be verified. Retry the saved request; do not create another task.')
      created++;cardId=currentCard().id;workspace=clone(state.workspace)
      const current=receipts(workspace,cardId)[entry.key]
      if(!current||!sameReservation(current,receipt))throw new Error('Task created, but its saved link request changed. Refresh and review the task.')
      const relations=allRelations(workspace,state.records),has=relations.some(edge=>edge.type==='depends_on'&&edge.fromId===cardId&&edge.toId===task.id)
      if(!has){const check=canAddRelation(relations,cardId,task.id,'depends_on',state.records);if(!check.ok)throw new Error(check.message);workspace.relations.push({id:`card-task-${requestId}`,type:'depends_on',fromId:cardId,toId:task.id});linked++}
      current.taskIdentityKey=taskKey
      await save(workspace,false)
      linksSaved++
    }
    if(linksSaved&&!deferLinkSync){
      onProgress({completed:entries.length,total:entries.length,title:'',phase:'publish'})
      publicationAttempted=true
      await synced()
    }
  }catch(error){
    // Earlier rows are already durable. Publish their identities/links before
    // reporting a later failure on a host that requires a foreground sync.
    if(linksSaved&&!deferLinkSync&&!publicationAttempted)try{await synced()}catch{/* Keep the saved links for normal sync. */}
    const pending=Boolean(linksSaved&&state.storage.syncStatus!=='synced')
    if(linksSaved)onState(state)
    throw new Error(`${error.message}${created?` ${created} task(s) were created or recovered; ${pending?'their planner links are pending. ':''}retry will reuse their saved requests.`:''}`,{cause:error})
  }
  return {state,created,reused,linked,linksPending:Boolean(linksSaved&&state.storage.syncStatus!=='synced')}
}
