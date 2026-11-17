import test from 'node:test'
import assert from 'node:assert/strict'
import {createPlannerWorkspace} from '@nextspace/core/planner.mjs'
import {plannerExportDocument, checkedPlannerExport, savePlannerInBrowser} from '../src/planner-export.mjs'

test('planner export uses the actual shared schema and rejects native cache/credential envelopes',()=>{
 const workspace=createPlannerWorkspace(),document=plannerExportDocument(workspace)
 assert.deepEqual(JSON.parse(checkedPlannerExport(document)),workspace)
 for(const value of [{...workspace,connection:{username:'fixture'}},{...workspace,records:[]},{...workspace,schemaVersion:1}])assert.throws(()=>plannerExportDocument(value))
 assert.throws(()=>checkedPlannerExport('x'.repeat(8*1024*1024+1)))
})

test('browser export succeeds only after writing and closing the chosen destination; cancel writes nothing',async()=>{
 const document=plannerExportDocument(createPlannerWorkspace()),calls=[]
 const result=await savePlannerInBrowser(document,async options=>{calls.push(options.suggestedName);return {createWritable:async()=>({write:async text=>calls.push(JSON.parse(text).schemaVersion),close:async()=>calls.push('closed')})}})
 assert.deepEqual(result,{exported:true});assert.deepEqual(calls,['NextGlance-planner.json',2,'closed'])
 assert.deepEqual(await savePlannerInBrowser(document,async()=>{throw Object.assign(new Error('cancel'),{name:'AbortError'})}),{exported:false})
 await assert.rejects(savePlannerInBrowser(document,null),{code:'UNAVAILABLE'})
 let aborted=false
 await assert.rejects(savePlannerInBrowser(document,async()=>({createWritable:async()=>({write:async()=>{},close:async()=>{throw new Error('Disk failed')},abort:async()=>{aborted=true}})})),/Disk failed/)
 assert.equal(aborted,true)
})
