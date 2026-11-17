const failure=(message,code='UNAVAILABLE')=>Object.assign(new Error(message),{code})
/** Explicit browser picker; binary data stays in this host closure, never in Worker state. */
export function createPreviewAttachments({pick=()=>new Promise(resolve=>{
  const input=document.createElement('input');input.type='file';input.style.display='none';document.body.append(input)
  const done=file=>{input.remove();resolve(file)};input.addEventListener('change',()=>done(input.files?.[0]),{once:true});input.addEventListener('cancel',()=>done(),{once:true});input.click()
}),fetchImpl=fetch,now=Date.now,newToken=()=>crypto.randomUUID()}={}){
  let selected, picking=false, generation=0
  return {
    clear(){selected=undefined;generation++},
    async chooseAttachment({accountName}){
      if(picking)throw failure('A file picker is already open.','LIMIT')
      selected=undefined;picking=true;const epoch=generation
      let file;try{file=await pick()}finally{picking=false}
      if(epoch!==generation)throw failure('Choose the attachment again; its selection expired.','CANCELLED')
      if(!file)return {cancelled:true}
      if(file.size>20*1024*1024||!file.name||file.name.length>255||/[\\/\u0000-\u001f\u007f]/.test(file.name))throw failure('Choose a file up to 20 MiB with a valid name.','LIMIT')
      const token=newToken();selected={token,file,accountName,created:now()};return {token,name:file.name,size:file.size}
    },
    async uploadAttachment({accountName,token,boardId,stackId,cardId}){
      const value=selected;selected=undefined
      if(!value||value.token!==token||value.accountName!==accountName||now()-value.created>300000)throw failure('Choose the attachment again; its selection expired.','CANCELLED')
      for(const id of [boardId,stackId,cardId])if(!/^[1-9]\d*$/.test(String(id))||!Number.isSafeInteger(Number(id)))throw failure('Choose a valid Deck card.','VALIDATION')
      const session=await (await fetchImpl('/__nextglance/session',{credentials:'same-origin',cache:'no-store'})).json()
      const form=new FormData();form.append('accountName',accountName);form.append('boardId',String(boardId));form.append('stackId',String(stackId));form.append('cardId',String(cardId));form.append('file',value.file,value.file.name)
      const response=await fetchImpl('/__nextglance/upload',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'X-NextGlance-Token':session.token},body:form}),result=await response.json()
      if(!response.ok)throw failure(result.error?.message||'Attachment upload failed.',result.error?.code||'NEXTCLOUD')
      return result
    },
  }
}
