export function chunkPort(files){
  const stages=new Map();let next=0
  return async args=>{
    const {operation,path}=args
    if(operation==='size'){const size=await files.size(path);return {size,revision:'fixture'}}
    if(operation==='read'){const text=await files.read(path),bytes=Buffer.from(text);return {chunk:bytes.subarray(args.offset,args.offset+args.length).toString('base64')}}
    if(operation==='beginWrite'){const token=String(++next);stages.set(token,{path,parts:[]});return {token}}
    if(operation==='append'){stages.get(args.token).parts.push(Buffer.from(args.chunk,'base64'));return {}}
    if(operation==='commit'){const stage=stages.get(args.token);await files.write(stage.path,Buffer.concat(stage.parts).toString('utf8'));stages.delete(args.token);return {}}
    if(operation==='abort'){stages.delete(args.token);return {}}
    if(operation==='remove'){await files.remove(path);return {}}
    throw new Error('Unknown fixture cache operation')
  }
}
