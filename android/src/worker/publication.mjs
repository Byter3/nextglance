import {jsonEqual} from '@nextspace/nextcloud-client/runtime.mjs'
import {fail} from './protocol.mjs'
const copy=value=>structuredClone(value)
const identity=state=>JSON.stringify([state.connection?.serverUrl||'',state.connection?.username||''])
const isState=value=>Boolean(value&&Array.isArray(value.records)&&Array.isArray(value.collections)&&value.workspace&&value.connection)
export {isState}
function difference(previous,next){
  const old=new Map(previous.map(item=>[item.id,item])),current=new Set(next.map(item=>item.id))
  return {upserts:next.filter(item=>!jsonEqual(old.get(item.id),item)),removed:previous.filter(item=>!current.has(item.id)).map(item=>item.id),...(jsonEqual(previous.map(item=>item.id),next.map(item=>item.id))?{}:{order:next.map(item=>item.id)})}
}
export function createPublisher(){
  let previous,epoch=0,seq=0
  return {encode(state,forceFull=false){
    if(!isState(state))throw fail('Invalid public background state.','FORMAT')
    const changedAccount=!previous||identity(previous)!==identity(state)
    if(changedAccount)epoch++
    const sequence=++seq
    if(changedAccount||forceFull){previous=state;return {type:'state',epoch,seq:sequence,full:state}}
    const fields={},removed=[]
    for(const key of Object.keys(previous))if(!Object.hasOwn(state,key))removed.push(key)
    for(const [key,value] of Object.entries(state))if(!['records','collections'].includes(key)&&!jsonEqual(previous[key],value))fields[key]=value
    const message={type:'state',epoch,seq:sequence,fields,removed,records:difference(previous.records,state.records),collections:difference(previous.collections,state.collections)}
    previous=state;return message
  }}
}
export function createPublicState(){
  let state,epoch=0,seq=0
  function arrayPatch(previous,patch){
    if(!patch||!Array.isArray(patch.upserts)||!Array.isArray(patch.removed))throw fail('Invalid background state patch.','FORMAT')
    const values=new Map(previous.map(item=>[item.id,item]));for(const id of patch.removed)values.delete(id);for(const item of patch.upserts)values.set(item.id,item)
    const order=patch.order||previous.map(item=>item.id).filter(id=>values.has(id))
    if(new Set(order).size!==order.length||order.length!==values.size||order.some(id=>!values.has(id)))throw fail('Incomplete background record order.','FORMAT')
    return order.map(id=>values.get(id))
  }
  return {apply(message){
    if(!message||!Number.isSafeInteger(message.seq)||message.seq<=seq||!Number.isSafeInteger(message.epoch)||message.epoch<epoch)return false
    if(message.full){if(!isState(message.full))throw fail('Invalid full background state.','FORMAT');state=message.full}
    else{
      if(!state||message.seq!==seq+1||message.epoch!==epoch)throw fail('Background state is incomplete; requesting a fresh snapshot.','STATE_GAP')
      const next={...state,...message.fields,records:arrayPatch(state.records,message.records),collections:arrayPatch(state.collections,message.collections)}
      for(const key of message.removed||[])delete next[key]
      state=next
    }
    epoch=message.epoch;seq=message.seq;return true
  },read:()=>state?copy(state):undefined,peek:()=>state,get sequence(){return seq}}
}
