/** CPU-only synthetic projection benchmark; no browser, account, cache or network. */
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {createRequire} from 'node:module'
import {countPlannerActions,selectPlanner} from '@nextspace/core/planner.mjs'
import {plannerFixture} from './fixtures.mjs'

const require=createRequire(new URL('../win/package.json',import.meta.url))
const {reactive}=require('vue')
const now=new Date(2026,10,12,12),state=plannerFixture(now)
const types=[['tasks','task',1947,'tasks-work'],['calendar','event',157,'calendar-work'],['deck','card',36,'deck-work'],['notes','note',53,'notes'],['collectives','page',81,'pages']]
state.records=types.flatMap(([source,kind,count,collectionId])=>Array.from({length:count},(_,i)=>({id:`${source}-${i}`,source,kind,collectionId,title:`Fixture ${i}`,collectionTitle:'Fixture collection',body:'Synthetic content. '.repeat(50),due:`2026-11-${String(1+i%28).padStart(2,'0')}`,start:kind==='event'?'2026-11-12T09:00:00Z':undefined,end:kind==='event'?'2026-11-12T10:00:00Z':undefined,completed:i%17===0,status:i%19===0?'CANCELLED':'NEEDS-ACTION',assignmentKnown:true,assigneeIds:i%3===0?['partner']:['fixture-user'],assignmentCount:1,tags:['Fixture'],etag:`etag-${i}`})))
state.workspace.projects[0].recordIds=['tasks-1','deck-1']
state.workspace.relations=[{id:'context',type:'scheduled_during',fromId:'deck-1',toId:'calendar-1'}]
state.workspace.identities=state.records.map(record=>({id:record.id,source:record.source,key:record.id}))
const proxy=reactive(structuredClone(state)),options={now,scopeId:'all',query:''}
const measure=(label,fn)=>{fn();const times=[];for(let i=0;i<20;i++){const start=performance.now();fn();times.push(performance.now()-start)}times.sort((a,b)=>a-b);return {label,medianMs:+times[10].toFixed(2),maxMs:+times.at(-1).toFixed(2)}}
const baselinePath=process.argv[2]
const metrics=[]
let compared=0
if(baselinePath){
  const baseline=await import(pathToFileURL(resolve(baselinePath)).href)
  for(const scopeId of ['all','space-work','space-personal','space-shared','project-gig','missing'])for(const filters of [{},{assignment:'all'},{showCompleted:true},{query:'1'},{hiddenCollectionIds:['tasks-work']},{assignment:'me',includeUnassigned:true}]){
    const overrides={now,scopeId,...filters},previous=baseline.selectPlanner(state,overrides)
    assert.deepEqual(selectPlanner(state,overrides),previous)
    assert.equal(countPlannerActions(state,overrides),previous.counts.actions)
    compared++
  }
  metrics.push(measure('before full model, plain',()=>baseline.selectPlanner(state,options)),measure('before model + overview count, reactive',()=>{baseline.selectPlanner(proxy,options);baseline.selectPlanner(proxy,options).counts.actions}))
}
metrics.push(measure('after full model, plain',()=>selectPlanner(state,options)),measure('after model + overview count, reactive',()=>{selectPlanner(proxy,options);countPlannerActions(proxy,options)}),measure('after count only, reactive',()=>countPlannerActions(proxy,options)))
console.log(JSON.stringify({records:state.records.length,baselineEquivalentCases:compared,metrics},null,2))
