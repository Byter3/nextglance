/** Isolated desktop diagnostic; no network, account files, build or timing gate. */
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {performance} from 'node:perf_hooks'
import {pathToFileURL} from 'node:url'
import {createMobileController} from '../src/controller.mjs'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {reconcileIdentities} from '@nextspace/core/identity.mjs'

// Replay the pre-optimization controller in memory by removing only its cache
// hit branch. All production identity, snapshot and controller code is retained.
const controllerUrl = new URL('../src/controller.mjs', import.meta.url)
const source = await readFile(controllerUrl, 'utf8')
const branch = /    if \(lastReconciliation\?\.store === store[\s\S]*?return false\n/
assert.ok(branch.test(source), 'Update this diagnostic if the cache guard changes')
const require = createRequire(controllerUrl)
const baselineSource = source.replace(branch, '').replace(/from (['"])([^'"]+)\1/g, (_match, _quote, name) => {
  const url = name.startsWith('.') ? new URL(name, controllerUrl) : pathToFileURL(require.resolve(name))
  return `from ${JSON.stringify(url.href)}`
})
const {createMobileController: uncachedController} = await import(`data:text/javascript;base64,${Buffer.from(baselineSource).toString('base64')}`)
const clone = value => structuredClone(value)
const sources = [['tasks',1947,'task'],['calendar',157,'event'],['deck',36,'card'],['notes',53,'note'],['collectives',81,'page']]
const records = sources.flatMap(([source,count,kind]) => Array.from({length:count}, (_,index) => ({
  id:`${source}-${index}`, source, kind, title:`Fixture ${index}`, collectionId:`${source}-list`,
  body:'Fixture description '.repeat(20), tags:['Fixture'],
  remote:{raw:'x'.repeat(4096),href:`/${source}/${index}`}, identity:{source,key:`${source}/${index}`},
})))
let sequence = 0
const makeId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`
const canonical = reconcileIdentities(createPlannerWorkspace(), records, makeId)
const workspace = canonical.workspace
const incoming = {records:canonical.records,collections:sources.map(([source])=>({id:`${source}-list`,source,title:source})),statuses:sources.map(([source,count])=>({source,state:'connected',count}))}
async function measure(factory) {
  let calls = 0, saved = {workspace:clone(workspace),revision:1,metadata:{ready:true},storage:{syncStatus:'synced'}}
  const values = new Map()
  const api = factory({
    native:{getAccount:async()=>({account:{name:'fixture',username:'fixture',serverUrl:'https://fixture.invalid'}})},
    cache:{load:async key=>clone(values.get(key)),save:async(key,value)=>values.set(key,clone(value)),remove:async key=>values.delete(key)},
    openExternal:async()=>{},
    makeClient:()=>({readAll:async()=>clone(incoming)}),
    makeMetadataStore:()=>({load:async()=>clone(saved),getState:()=>clone(saved),sync:async()=>{},reconcileRecords:async input=>{
      calls++; const result = reconcileIdentities(saved.workspace,input,makeId)
      saved = {...saved,workspace:result.workspace}
      return {...clone(saved),records:result.records,remap:result.remap}
    }}),
  })
  try {
    await api.refresh(); api.subscribe(()=>{})
    for(let index=0;index<3;index++) await api.syncWorkspace()
    const beforeCalls=calls,times=[]
    for(let index=0;index<20;index++){const start=performance.now();await api.syncWorkspace();times.push(performance.now()-start)}
    times.sort((a,b)=>a-b)
    return {state:await api.getState(),medianMs:times[10],maxMs:times.at(-1),identityPasses:calls-beforeCalls}
  } finally { api.dispose() }
}
const before=await measure(uncachedController),after=await measure(createMobileController)
assert.ok(JSON.stringify(after.state)===JSON.stringify(before.state), 'Before/after fixture snapshots must match')
assert.equal(before.identityPasses,20);assert.equal(after.identityPasses,0)
console.log(JSON.stringify({records:records.length,privateRawKiBPerRecord:4,polls:20,environment:'Desktop Node; fake transport/storage; one subscriber',before:{medianMs:before.medianMs,maxMs:before.maxMs,identityPasses:before.identityPasses},after:{medianMs:after.medianMs,maxMs:after.maxMs,identityPasses:after.identityPasses}},null,2))
