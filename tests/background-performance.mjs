/** CPU-only benchmark: synthetic notes, no server or profile access. */
import {performance} from 'node:perf_hooks'
import {createRequire} from 'node:module'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {mergeBackgroundState} from '@nextspace/core/background-state.mjs'
const require=createRequire(new URL('../win/package.json',import.meta.url))
const {reactive,toRaw}=require('vue')
const initial=createEmptyState()
initial.revision=1
initial.connection={connected:true,username:'fixture',serverUrl:'https://fixture.invalid'}
initial.records=Array.from({length:1600},(_,i)=>({id:`note-${i}`,kind:'note',source:'notes',title:`Note ${i}`,body:`${i}: `+'Fixture note content. '.repeat(400),collectionId:'notes',tags:[],etag:`v${i}`}))
initial.workspace.identities=initial.records.map(record=>({id:record.id,source:record.source,key:record.id}))
const before=structuredClone(initial),current=reactive(structuredClone(initial)),incoming=structuredClone(initial)
incoming.storage.lastSyncedAt=new Date().toISOString()
function measure(operation){const values=[];for(let i=0;i<5;i++){const start=performance.now();operation();values.push(performance.now()-start)}return +values.sort((a,b)=>a-b)[2].toFixed(2)}
console.log(JSON.stringify({records:initial.records.length,payloadMB:+(JSON.stringify(initial).length/1024/1024).toFixed(1),proxySnapshotMs:measure(()=>JSON.parse(JSON.stringify(current))),rawSnapshotMs:measure(()=>structuredClone(toRaw(current))),mergeMs:measure(()=>mergeBackgroundState(before,toRaw(current),incoming)),reuseMergeMs:measure(()=>mergeBackgroundState(before,toRaw(current),incoming,[],{reuseUnchanged:true}))},null,2))
