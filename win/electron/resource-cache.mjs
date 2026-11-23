import {createHash} from 'node:crypto'
import {mkdir,readFile,readdir,lstat,unlink,rmdir} from 'node:fs/promises'
import path from 'node:path'
import {checkedResourceEntry,validResourceLocator,httpEtag} from '@nextspace/nextcloud-node/resource-cache-policy.mjs'

const MAX_BYTES=256*1024*1024,MAX_ENTRIES=50_000,hash=value=>createHash('sha256').update(value).digest('hex')
const invalid=()=>Object.assign(new Error('The private source cache request is invalid.'),{code:'VALIDATION'})
const missing=error=>error?.code==='ENOENT'

/** Account-private acceleration only. Native inventory/ETags remain authoritative. */
export function createResourceCache({directory,serverUrl,writeJson}) {
  const root=path.resolve(directory),indexes=new Map(),dirty=new Set()
  let queue=Promise.resolve(),sizes,closed=false
  const run=operation=>{const next=queue.then(()=>{if(closed)throw Object.assign(new Error('The source session changed.'),{code:'CANCELLED'});return operation()});queue=next.catch(()=>{});return next}
  const folder=(kind,collection)=>{
    const href=kind==='deck'?collection+'/stacks':collection+(collection.endsWith('/')?'':'/')+'cache-validation'
    if(!validResourceLocator({kind,collection,href},serverUrl))throw invalid()
    return path.join(root,kind,hash(collection))
  }
  const location=locator=>{
    if(!validResourceLocator(locator,serverUrl))throw invalid()
    return path.join(folder(locator.kind,locator.collection),hash(locator.href)+'.json')
  }
  async function directories(dir) {
    const parts=path.relative(root,dir).split(path.sep)
    if(parts.some(part=>part==='..')||path.isAbsolute(path.relative(root,dir)))throw invalid()
    for(const current of [root,...parts.filter(Boolean).map((_,i)=>path.join(root,...parts.slice(0,i+1)))]){
      await mkdir(current,{recursive:true,mode:0o700})
      const stat=await lstat(current)
      if(!stat.isDirectory()||stat.isSymbolicLink())throw invalid()
    }
  }
  async function checkedDirectory(dir){
    const relative=path.relative(root,dir),parts=relative.split(path.sep).filter(Boolean)
    if(path.isAbsolute(relative)||parts.includes('..'))throw invalid()
    try{for(const current of [root,...parts.map((_,i)=>path.join(root,...parts.slice(0,i+1)))]){const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw invalid()}return true}
    catch(error){if(missing(error))return false;throw error}
  }
  async function children(dir){try{return await checkedDirectory(dir)?await readdir(dir,{withFileTypes:true}):[]}catch(error){if(missing(error))return [];throw error}}
  async function readJson(file,maximum){
    try{if(!await checkedDirectory(path.dirname(file)))return null;const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)return null;return JSON.parse(await readFile(file,'utf8'))}
    catch(error){if(missing(error)||error instanceof SyntaxError)return null;throw error}
  }
  async function index(kind,collection){
    const dir=folder(kind,collection)
    if(indexes.has(dir))return indexes.get(dir)
    const saved=await readJson(path.join(dir,'index.json'),24*1024*1024),entries=new Map()
    if(saved?.version===1&&saved.kind===kind&&saved.collection===collection&&Array.isArray(saved.entries)&&saved.entries.length<=MAX_ENTRIES)for(const item of saved.entries){
      if(validResourceLocator({kind,collection,href:item?.href},serverUrl)&&httpEtag(item.etag)&&Number.isSafeInteger(item.bytes)&&item.bytes>=0)entries.set(item.href,{href:item.href,etag:item.etag,bytes:item.bytes})
    }
    const value={kind,collection,entries};indexes.set(dir,value);return value
  }
  async function usage(){
    if(sizes)return sizes
    const files=new Map()
    for(const kind of ['dav','deck'])for(const dir of await children(path.join(root,kind)))if(dir.isDirectory()&&!dir.isSymbolicLink()&&/^[a-f0-9]{64}$/.test(dir.name)){
      const parent=path.join(root,kind,dir.name)
      for(const file of await children(parent))if(file.isFile()&&!file.isSymbolicLink()&&/^[a-f0-9]{64}\.json$/.test(file.name)){
        const target=path.join(parent,file.name);try{files.set(target,(await lstat(target)).size)}catch(error){if(!missing(error))throw error}
      }
    }
    sizes={files,bytes:[...files.values()].reduce((total,size)=>total+size,0)};return sizes
  }
  async function removeFile(file){if(await checkedDirectory(path.dirname(file)))await unlink(file).catch(error=>{if(!missing(error))throw error});if(sizes){sizes.bytes-=sizes.files.get(file)||0;sizes.files.delete(file)}}
  async function get(locator){
    const file=location(locator),saved=await readJson(file,(locator.kind==='dav'?2:24)*1024*1024*6+65536)
    const checked=checkedResourceEntry(saved,locator,serverUrl)
    if(checked){const cached=await index(locator.kind,locator.collection);if(cached.entries.get(locator.href)?.etag!==checked.etag){cached.entries.set(locator.href,{href:checked.href,etag:checked.etag,bytes:checked.bytes});dirty.add(path.dirname(file))}}
    return checked
  }
  async function remove(locator){const file=location(locator);await removeFile(file);const cached=await index(locator.kind,locator.collection);cached.entries.delete(locator.href);dirty.add(path.dirname(file))}
  async function deleteFolder(dir){
    if(!path.resolve(dir).startsWith(root+path.sep))throw invalid()
    for(const entry of await children(dir))if(entry.isFile()||entry.isSymbolicLink())await removeFile(path.join(dir,entry.name))
    await rmdir(dir).catch(error=>{if(!missing(error)&&error.code!=='ENOTEMPTY')throw error});indexes.delete(dir);dirty.delete(dir)
  }
  return {
    get:locator=>run(()=>get(locator)),
    getMany:locators=>run(async()=>{
      if(!Array.isArray(locators)||locators.length>250)throw invalid()
      for(const locator of locators)await index(locator.kind,locator.collection)
      const values=[];for(let i=0;i<locators.length;i+=16)values.push(...await Promise.all(locators.slice(i,i+16).map(get)))
      return values
    }),
    list:({kind,collection})=>run(async()=>[...(await index(kind,collection)).entries.values()].map(({href,etag})=>({href,etag}))),
    put:value=>run(async()=>{
      const checked=checkedResourceEntry(value,value,serverUrl);if(!checked)throw invalid()
      const file=location(checked),dir=path.dirname(file),used=await usage(),bytes=Buffer.byteLength(JSON.stringify(checked,null,2)+'\n')
      if(used.bytes-(used.files.get(file)||0)+bytes>MAX_BYTES||!used.files.has(file)&&used.files.size>=MAX_ENTRIES)throw Object.assign(new Error('The private source cache reached its bounded storage limit.'),{code:'CACHE_WRITE_FAILED'})
      await directories(dir);await writeJson(file,checked,{backup:false})
      used.bytes+=bytes-(used.files.get(file)||0);used.files.set(file,bytes)
      const cached=await index(checked.kind,checked.collection);cached.entries.set(checked.href,{href:checked.href,etag:checked.etag,bytes:checked.bytes});dirty.add(dir)
    }),
    remove:locator=>run(()=>remove(locator)),
    prune:({kind,collection,hrefs})=>run(async()=>{
      if(!Array.isArray(hrefs)||hrefs.length>MAX_ENTRIES)throw invalid()
      const dir=folder(kind,collection),keep=new Set(hrefs.map(href=>path.basename(location({kind,collection,href}))))
      for(const entry of await children(dir))if(entry.isFile()&&/^[a-f0-9]{64}\.json$/.test(entry.name)&&!keep.has(entry.name))await removeFile(path.join(dir,entry.name))
      const cached=await index(kind,collection);cached.entries=new Map([...cached.entries].filter(([href])=>keep.has(hash(href)+'.json')));dirty.add(dir)
    }),
    retainCollections:({kind,collections})=>run(async()=>{
      if(!['dav','deck'].includes(kind)||!Array.isArray(collections))throw invalid()
      const keep=new Set(collections.map(collection=>path.basename(folder(kind,collection))))
      for(const entry of await children(path.join(root,kind)))if(entry.isDirectory()&&!entry.isSymbolicLink()&&/^[a-f0-9]{64}$/.test(entry.name)&&!keep.has(entry.name))await deleteFolder(path.join(root,kind,entry.name))
    }),
    clear:()=>run(async()=>{for(const kind of ['dav','deck'])for(const entry of await children(path.join(root,kind)))if(entry.isDirectory()&&!entry.isSymbolicLink()&&/^[a-f0-9]{64}$/.test(entry.name))await deleteFolder(path.join(root,kind,entry.name));indexes.clear();dirty.clear();sizes={files:new Map(),bytes:0}}),
    flush:()=>run(async()=>{for(const dir of [...dirty]){const cached=indexes.get(dir);if(cached){await directories(dir);await writeJson(path.join(dir,'index.json'),{version:1,kind:cached.kind,collection:cached.collection,entries:[...cached.entries.values()]},{backup:false})}dirty.delete(dir)}}),
    close:()=>{closed=true},
  }
}
