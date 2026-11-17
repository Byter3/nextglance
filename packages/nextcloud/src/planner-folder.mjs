/** Small, independently versioned planner files. Native source data never enters this folder. */
import {sha256} from './runtime.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {validateWorkspace, jsonValue} from '@nextspace/core/planner-schema.mjs'
import {deviceViewKeys, mergeWorkspaces} from '@nextspace/core/workspace-merge.mjs'
import {safeArrangementId} from '@nextspace/core/planning-order.mjs'

export const PLANNER_FOLDER = '/Workspace/Nextspace/'
const clone = value => structuredClone(value)
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const digest = value => sha256(stable(value))
const equal = (a,b) => stable(a) === stable(b)
const error = (message,code='FOLDER_FORMAT') => Object.assign(new Error(message),{code})
const strongEtag = value => typeof value === 'string' && /^"[^"\r\n]*"$/.test(value)
const directories = ['','links','plans','properties','workflow','arrangements']
const fixed = {core:'core.json',organization:'organization.json',settings:'settings.json',dependencies:'dependencies.json',identities:'identities.json'}
const groups = {relation:'links',plan:'plans',property:'properties',workflow:'workflow',arrangement:'arrangements'}
function documentPath(kind,key) {
  if (kind === 'arrangement' && !safeArrangementId(key)) throw error('A planner arrangement has an unsafe scope key.')
  if (Object.hasOwn(fixed,kind) && key === 'workspace') return fixed[kind]
  if (Object.hasOwn(groups,kind) && typeof key === 'string' && key.length && key.length <= 2048) return `${groups[kind]}/${digest(key)}.json`
  throw error('A planner file has an unsupported kind or key. Existing files were preserved.')
}
function envelope(kind,key,value) { return {format:'nextspace-planner-document',version:1,kind,key,value:clone(value)} }

/** Organization is one coherent document; unrelated links and attributes are independent files. */
export function splitWorkspace(input) {
  const workspace = validateWorkspace(input), result = new Map()
  const put = (kind,key,value) => result.set(documentPath(kind,key),envelope(kind,key,value))
  put('core','workspace',{id:workspace.id,name:workspace.name,schemaVersion:2})
  put('organization','workspace',{spaces:workspace.spaces,categories:workspace.categories||[],projects:workspace.projects})
  // The custom dependency graph must stay acyclic across devices. Keeping this
  // small graph atomic prevents two individually valid edges creating a cycle
  // in different files. Ordinary event/note/related links remain per-link files.
  put('dependencies','workspace',{relations:workspace.relations.filter(item=>item.type==='depends_on').sort((a,b)=>a.id.localeCompare(b.id))})
  const planner = clone(workspace.planner)
  for (const key of [...deviceViewKeys,'workflow','arrangements']) delete planner[key]
  put('settings','workspace',{appearance:workspace.appearance,planner})
  // Both native-key moves and independent UUID discovery must be atomic.
  // Splitting by key moves records between files; splitting by UUID lets two
  // PCs publish duplicate native identities. The registry changes on refresh,
  // not when adding a link, so one separate registry file is the safe boundary.
  put('identities','workspace',{identities:[...workspace.identities].sort((a,b)=>a.id.localeCompare(b.id))})
  for (const item of workspace.relations) if(item.type!=='depends_on')put('relation',item.id,item)
  for (const item of workspace.plans) put('plan',item.id,item)
  for (const [key,value] of Object.entries(workspace.properties)) put('property',key,value)
  for (const [key,value] of Object.entries(workspace.planner.workflow)) put('workflow',key,value)
  for (const [key,value] of Object.entries(workspace.planner.arrangements || {})) put('arrangement',key,value)
  return new Map([...result].sort(([a],[b])=>a.localeCompare(b)))
}
export function sharedFolderHash(workspace) { return digest([...splitWorkspace(workspace)]) }

function validateDocument(path,document) {
  jsonValue(document)
  if (!document || document.format !== 'nextspace-planner-document' || document.version !== 1 || documentPath(document.kind,document.key) !== path) throw error('A planner document has an invalid format or filename. Existing files were preserved.')
  const allowed = document.deleted === true ? ['format','version','kind','key','deleted'] : ['format','version','kind','key','value']
  if (Object.keys(document).some(key=>!allowed.includes(key)) || !allowed.every(key=>Object.hasOwn(document,key))) throw error('A planner document is incomplete. Existing files were preserved.')
  if (document.deleted && Object.hasOwn(fixed,document.kind)) throw error('A required planner settings file was deleted. Restore it in Nextcloud Files before retrying.')
  if (['property','workflow'].includes(document.kind)&&['__proto__','prototype','constructor'].includes(document.key))throw error('A planner property has an unsafe key.')
  if(!document.deleted&&Object.hasOwn(fixed,document.kind)){
    const fields={core:['id','name','schemaVersion'],organization:['spaces','categories','projects'],settings:['appearance','planner'],dependencies:['relations'],identities:['identities']}[document.kind]
    if(!document.value||Array.isArray(document.value)||Object.keys(document.value).length!==fields.length||!fields.every(key=>Object.hasOwn(document.value,key)))throw error('A planner settings document has unsupported fields.')
    if(document.kind==='settings'&&(!document.value.planner||Array.isArray(document.value.planner)||Object.keys(document.value.planner).some(key=>key!=='statusMapping')))throw error('A planner settings document contains device-local fields.')
  }
  return document
}
export function assembleWorkspace(documents,{updatedAt='2000-01-01T00:00:00.000Z'}={}) {
  const result = createPlannerWorkspace();result.updatedAt=updatedAt
  for (const path of Object.values(fixed)) if (!documents.has(path)) throw error('A required planner file is missing. Restore the missing file in Nextcloud Files before retrying.','FOLDER_MISSING')
  const seen = new Set()
  for (const [path,value] of [...documents].sort(([a],[b])=>a.localeCompare(b))) {
    const document = validateDocument(path,value)
    if (document.deleted) continue
    const {kind,key} = document, data = clone(document.value)
    if (kind === 'core') Object.assign(result,data)
    else if (kind === 'organization') Object.assign(result,data)
    else if (kind === 'dependencies') {if(!Array.isArray(data.relations)||data.relations.some(item=>item.type!=='depends_on'))throw error('A custom dependency graph is invalid.');result.relations.push(...data.relations)}
    else if (kind === 'settings') {result.appearance=data.appearance;Object.assign(result.planner,data.planner)}
    else if (kind === 'identities') {if(!Array.isArray(data.identities))throw error('The planner identity registry is invalid.');result.identities.push(...data.identities)}
    else if (kind === 'relation') {
      if (data?.id !== key || data.type==='depends_on') throw error('A planner link has an invalid identity or dependency storage location.')
      // Independent creation of the same relationship can produce two UUIDs.
      // The full values must agree; one canonical copy is used, then the writer
      // tombstones the duplicate without deleting source records.
      const signature=stable([data.type,data.fromId,data.toId,data.role||''])
      if (seen.has(signature)) {
        const previous=result.relations.find(item=>stable([item.type,item.fromId,item.toId,item.role||''])===signature)
        const {id:a,...left}=previous,{id:b,...right}=data
        if(!equal(left,right))throw error('Two copies of a planner link have different details. Both files were preserved.','FOLDER_CONFLICT')
      } else {seen.add(signature);result.relations.push(data)}
    } else if (kind === 'plan') {if(data?.id!==key)throw error('A planner session has an invalid identity.');result.plans.push(data)}
    else if (kind === 'property') result.properties[key]=data
    else if (kind === 'workflow') result.planner.workflow[key]=data
    else if (kind === 'arrangement') { result.planner.arrangements ||= {}; result.planner.arrangements[key]=data }
  }
  return validateWorkspace(result)
}
function validateManifest(value) {
  if(Array.isArray(value?.required)&&value.required.length>20000)throw error('This planner needs more than 20,000 initial metadata files. Migration was not activated; the local and legacy planners are preserved.')
  jsonValue(value)
  if (!value || value.format !== 'nextspace-planner-folder' || value.version !== 1 || !/^data-[a-f0-9-]{36}$/.test(value.generation) || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.required) || value.required.length > 60000 || value.required.some(path=>typeof path!=='string'||!validPath(path)) || new Set(value.required).size!==value.required.length || value.legacyHash!==null&&!/^[a-f0-9]{64}$/.test(value.legacyHash||'')) throw error('The cloud planner folder has an unsupported manifest. Existing files were preserved.')
  return value
}
function validPath(path) { return Object.values(fixed).includes(path) || /^(?:links|plans|properties|workflow|arrangements)\/[a-f0-9]{64}\.json$/.test(path) }

export class FolderWorkspaceClient {
  constructor(client) {this.client=client;this.cache=new Map();this.last=null;this.checkpoint=null}
  setCheckpoint(value) {this.checkpoint=value||null}
  checkpointValue() {return this.last?.format==='folder'?{generation:this.last.manifest.generation,paths:[...this.last.documents.keys()].sort()}:this.checkpoint}
  async list(generation) {
    // The fresh parent inventory is authoritative for which optional child
    // folders exist. Do not send repeated 404 probes for every absent category.
    const root=await this.client.listPlannerFiles(generation)
    const present=new Set((root.files||[]).filter(file=>file.collection).map(file=>file.path))
    const children=directories.slice(1).filter(directory=>present.has(`${generation}/${directory}`))
    const results=[root,...await Promise.all(children.map(directory=>this.client.listPlannerFiles(`${generation}/${directory}`)))]
    const files=new Map()
    for (const result of results) for (const file of result.files||[]) {
      if(file.collection)continue
      const path=file.path.startsWith(`${generation}/`)?file.path.slice(generation.length+1):''
      if(['legacy-import.json','legacy-original.json'].includes(path))continue
      if(!validPath(path))throw error('An unexpected file was found inside the planner data folder. Existing files were preserved.')
      if(!strongEtag(file.etag))throw error('Nextcloud did not provide a strong version for a planner file. Check the server or proxy ETag headers, then retry. No unsafe overwrite was attempted.','ETAG_UNAVAILABLE')
      files.set(path,file.etag)
    }
    return new Map([...files].sort(([a],[b])=>a.localeCompare(b)))
  }
  async readWorkspace() {
    const marker=await this.client.readPlannerFile('manifest.json')
    if(marker.document===null) {
      if(this.checkpoint?.generation)throw error('The cloud planner folder manifest was removed. Your local changes are preserved. Restore it in Nextcloud Files before retrying.','FOLDER_MISSING')
      const legacy=await this.client.readWorkspace({requireVersion:false})
      const workspace=legacy.workspace===null?null:validateWorkspace(legacy.workspace)
      this.last={format:'legacy',workspace,etag:`legacy:${workspace?sharedFolderHash(workspace):'empty'}`}
      return {...this.last,migrate:true}
    }
    const manifest=validateManifest(marker.document)
    if(this.checkpoint?.generation&&this.checkpoint.generation!==manifest.generation)throw error('The cloud planner folder was replaced. Both copies are preserved; review the replacement before syncing.','FOLDER_CONFLICT')
    // Keep a separate import baseline for older PCs. Independent legacy edits
    // can be carried forward, but never turn an old snapshot into a replacement
    // for the newer folder. The original remote file is never written here.
    const [legacy,imported]=await Promise.all([this.client.readWorkspace({requireVersion:false}),this.client.readPlannerFile(`${manifest.generation}/legacy-import.json`)])
    if(imported.document?.format!=='nextspace-legacy-import'||imported.document.version!==1||!Object.hasOwn(imported.document,'workspace'))throw error('The legacy import baseline is missing or invalid. Existing files were preserved. Restore it in Nextcloud Files before retrying.','FOLDER_MISSING')
    const legacyBase=imported.document.workspace===null?null:validateWorkspace(imported.document.workspace)
    const legacyWorkspace=legacy.workspace===null?null:validateWorkspace(legacy.workspace)
    const legacyPending=legacyWorkspace!==null&&sharedFolderHash(legacyWorkspace)!==(legacyBase?sharedFolderHash(legacyBase):null)
    for(let attempt=0;attempt<3;attempt++) {
      const before=await this.list(manifest.generation)
      const required=new Set([...manifest.required,...(this.checkpoint?.paths||[])])
      if([...required].some(path=>!before.has(path)))throw error('A previously saved planner file is missing. Your local changes are preserved. Restore it in Nextcloud Files before retrying.','FOLDER_MISSING')
      const prior=this.last
      if(prior?.format==='folder'&&!prior.legacyPending&&!legacyPending&&equal(prior.manifest,manifest)&&equal([...prior.versions],[...before])){
        // This exact document set already passed a complete consistent read.
        // Fresh membership/version checks above still detect deletions and edits.
        this.last={...prior,manifest,versions:before,legacyWorkspace,legacyVersion:imported.etag}
        return {workspace:clone(prior.workspace),etag:prior.etag,format:'folder',migrate:false}
      }
      const documents=new Map()
      let changed=false
      // Bounded concurrency keeps first migration/reload practical without
      // sending hundreds of requests to the user's server at once.
      const entries=[...before]
      for(let index=0;index<entries.length;index+=6) await Promise.all(entries.slice(index,index+6).map(async([path,etag])=>{
        const full=`${manifest.generation}/${path}`,cached=this.cache.get(full)
        if(cached?.etag===etag){documents.set(path,clone(cached.document));return}
        const read=await this.client.readPlannerFile(full)
        if(read.document===null||read.etag!==etag){changed=true;return}
        validateDocument(path,read.document);this.cache.set(full,clone(read));documents.set(path,read.document)
      }))
      const after=await this.list(manifest.generation)
      if(changed||!equal([...before],[...after]))continue
      let workspace=assembleWorkspace(documents,{updatedAt:manifest.createdAt})
      if(legacyPending){
        const merged=mergeWorkspaces(legacyBase||createPlannerWorkspace(),workspace,legacyWorkspace)
        if(merged.conflicts.length)throw error(`An older Nextspace app and the folder both changed ${merged.conflicts.slice(0,3).join(', ')}. Both copies are preserved. Update every PC, export the older app’s planner, and review these conflicting fields.`,'LEGACY_CHANGED')
        try{workspace=validateWorkspace(merged.workspace)}catch{throw error('Older-app edits overlap with the folder’s organization or links. Both copies are preserved; review them before retrying.','LEGACY_CHANGED')}
      }
      this.last={format:'folder',manifest,documents,versions:before,workspace,etag:digest([...before]),legacyPending,legacyWorkspace,legacyVersion:imported.etag}
      return {workspace:clone(workspace),etag:this.last.etag,format:'folder',migrate:legacyPending}
    }
    throw error('Planner files changed while they were being read. Your local changes are preserved; retry sync.','CONFLICT')
  }
  async writeWorkspace(workspace,etag) {
    if(!this.last||this.last.etag!==etag)throw error('Refresh the planner files before saving.','CONFLICT')
    const wanted=splitWorkspace(workspace)
    if(this.last.format==='legacy') {
      const legacy=this.last.workspace,seed=digest({documents:[...wanted],legacy}).slice(0,32)
      const generation=`data-${seed.slice(0,8)}-${seed.slice(8,12)}-${seed.slice(12,16)}-${seed.slice(16,20)}-${seed.slice(20)}`
      const manifest=validateManifest({format:'nextspace-planner-folder',version:1,generation,createdAt:new Date().toISOString(),required:[...wanted.keys()],legacyHash:legacy?sharedFolderHash(legacy):null})
      const seedFile=async(path,document)=>{
        try{await this.client.writePlannerFile(path,document,null)}
        catch(reason){
          if(reason.status!==412&&reason.statusCode!==412&&reason.code!=='CONFLICT')throw reason
          const stored=await this.client.readPlannerFile(path)
          if(!equal(stored.document,document))throw reason
        }
      }
      // Identical retries, including after restart, resume the same seed folder.
      // Existing seed files are accepted only after exact content readback.
      for(const [path,document] of wanted)await seedFile(`${generation}/${path}`,document)
      if(legacy)await seedFile(`${generation}/legacy-original.json`,legacy)
      await seedFile(`${generation}/legacy-import.json`,{format:'nextspace-legacy-import',version:1,workspace:legacy})
      // Recheck the legacy file before publishing migration. A failed seed is
      // deliberately invisible: the marker only appears after every file saves.
      const latest=await this.client.readWorkspace({requireVersion:false})
      if((latest.workspace?sharedFolderHash(validateWorkspace(latest.workspace)):null)!==manifest.legacyHash)throw error('The legacy planner changed during migration. Retry to merge its newer changes.','CONFLICT')
      await this.client.writePlannerFile('manifest.json',manifest,null)
    } else {
      const current=this.last
      const changes=[]
      for(const [path,document] of wanted)if(!equal(document,current.documents.get(path)))changes.push([path,document])
      for(const [path,document] of current.documents)if(!wanted.has(path)&&!document.deleted)changes.push([path,{format:document.format,version:1,kind:document.kind,key:document.key,deleted:true}])
      // Publish stable native identities before their links; structural groups
      // and mapped statuses each remain atomic within their own document.
      changes.sort(([a],[b])=>Number(a!=='identities.json')-Number(b!=='identities.json')||a.localeCompare(b))
      for(const [path,document] of changes) {
        const full=`${current.manifest.generation}/${path}`,version=current.versions.get(path)||null
        await this.client.writePlannerFile(full,document,version)
        this.cache.delete(full)
      }
      if(current.legacyPending){
        if(!strongEtag(current.legacyVersion))throw error('Nextcloud did not provide a strong version for the legacy import baseline. Your planner edits remain saved locally; retry after checking server/proxy ETag headers.','ETAG_UNAVAILABLE')
        await this.client.writePlannerFile(`${current.manifest.generation}/legacy-import.json`,{format:'nextspace-legacy-import',version:1,workspace:current.legacyWorkspace},current.legacyVersion)
      }
    }
    const saved=await this.readWorkspace()
    if(saved.migrate)throw error('The legacy planner changed again while its edits were being imported. Retry to carry forward the newest changes.','CONFLICT')
    return {etag:saved.etag,workspace:saved.workspace}
  }
}
