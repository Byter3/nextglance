const CHUNK = 256 * 1024, MAX = 50 * 1024 * 1024
const fail = (message, code='CACHE_FORMAT') => Object.assign(new Error(message),{code})
const checkPath = path => {if(typeof path!=='string'||!/^cache\/[a-f0-9]{64}\.[01]\.json$/.test(path))throw fail('Invalid private cache path.','SECURITY')}
const encode = bytes => {let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value)}
const decode = text => {if(typeof text!=='string'||text.length>Math.ceil(CHUNK/3)*4||text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw fail('Invalid cache chunk.');return Uint8Array.from(atob(text),char=>char.charCodeAt(0))}
/** Runs in the data worker. Only bounded base64 chunks cross the UI/native bridge. */
export function createChunkCacheFiles(call){
  const operation=(operation,path,args={})=>{checkPath(path);return call({operation,path,...args})}
  return {
    async stat(path){
      const {size,revision,prefix}=await operation('size',path)
      if(size!==null&&(!Number.isSafeInteger(size)||size<0||size>MAX||typeof revision!=='string'))throw fail('Invalid cache revision.','CACHE_TOO_LARGE')
      // Native code exposes bounded bytes, not an authority over JSON semantics.
      // Unknown/legacy headers simply use the normal complete-slot inspection.
      const match=typeof prefix==='string'&&prefix.length<=256?prefix.match(/^\{"version":1,"generation":([1-9]\d*),"value":/):null
      const generation=match?Number(match[1]):undefined
      return {size,revision:size===null?null:revision,...(size!==null&&Number.isSafeInteger(generation)?{generation}:{})}
    },
    async size(path){const {size}=await operation('size',path);if(size!==null&&(!Number.isSafeInteger(size)||size<0||size>MAX))throw fail('The saved cache exceeds its limit.','CACHE_TOO_LARGE');return size},
    async read(path,expected){
      const {size,revision}=expected||await operation('size',path);if(size===null)return null
      if(!Number.isSafeInteger(size)||size<0||size>MAX||typeof revision!=='string')throw fail('Invalid cache size.')
      const decoder=new TextDecoder('utf-8',{fatal:true});let text=''
      for(let offset=0;offset<size;){const length=Math.min(CHUNK,size-offset),result=await operation('read',path,{offset,length,size,revision});const bytes=decode(result.chunk);if(bytes.length!==length)throw fail('The saved cache changed while being read.');text+=decoder.decode(bytes,{stream:true});offset+=length}
      return text+decoder.decode()
    },
    async write(path,text){
      if(typeof text!=='string')throw fail('Invalid private cache data.')
      const bytes=new TextEncoder().encode(text);if(bytes.length>MAX)throw fail('The saved cache exceeds its limit.','CACHE_TOO_LARGE')
      const {token}=await operation('beginWrite',path,{size:bytes.length})
      try{for(let offset=0;offset<bytes.length;offset+=CHUNK)await operation('append',path,{token,offset,chunk:encode(bytes.subarray(offset,offset+CHUNK))});await operation('commit',path,{token})}
      catch(error){await operation('abort',path,{token}).catch(()=>{});throw error}
    },
    async remove(path){await operation('remove',path)},
  }
}
