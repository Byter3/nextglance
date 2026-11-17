/** Synthetic in-memory profile. Does not open an account, disk cache or network. */
import {performance} from 'node:perf_hooks'
import {WorkspaceStore} from '@nextspace/nextcloud-node/workspace.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
const store=new WorkspaceStore(),workspace=createPlannerWorkspace()
const count=2000,body='Checklist entry and project notes. '.repeat(40),raw='BEGIN:VEVENT\nDESCRIPTION:cached native calendar resource\n'.repeat(175)
const records=Array.from({length:count},(_,i)=>({id:`item-${i}`,source:'calendar',kind:'event',title:`Event ${i}`,body,start:'2026-11-11T10:00:00Z',end:'2026-11-11T11:00:00Z',identity:{source:'calendar',key:`event-${i}`},remote:{raw,href:`https://fixture.invalid/${i}.ics`}}))
workspace.identities=records.map(record=>({id:record.id,...record.identity}))
store.value={schemaVersion:1,revision:0,workspace,cache:{records,collections:[],statuses:[]},sync:{baseWorkspace:structuredClone(workspace),initialWorkspace:structuredClone(workspace)}};store.recordAliases=new Map()
const measure=(name,fn,n=10)=>{const times=[];for(let i=0;i<n;i++){const start=performance.now();fn();times.push(performance.now()-start)}times.sort((a,b)=>a-b);return{name,medianMs:+times[Math.floor(n/2)].toFixed(2),maxMs:+times.at(-1).toFixed(2)}}
console.log(JSON.stringify({records:count,cacheMB:+(JSON.stringify(store.value.cache).length/1024/1024).toFixed(1),metrics:[measure('previous full read then discard native metadata',()=>{const value=store.snapshot();return value.cache.records.map(({remote,identity,...item})=>item)}),measure('previous selected record lookup',()=>store.snapshot().cache.records.find(record=>record.id==='item-1000')),measure('previous read metadata mapping',()=>records.map(item=>item.id===store.resolveRecordId('item-1000')?{...item,fileTags:[]}:item),3),measure('public projection snapshot',()=>store.publicSnapshot()),measure('targeted selected record lookup',()=>store.recordSnapshot('item-1000')),measure('indexed metadata mapping',()=>{const id=store.resolveRecordId('item-1000');return records.map(item=>item.id===id?{...item,fileTags:[]}:item)})]},null,2))
