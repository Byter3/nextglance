/** Calendar scheduling interactions using a test-only bridge and isolated data. */
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {plannerFixture} from './fixtures.mjs'
import {validateWorkspace} from '@nextspace/core/planner-schema.mjs'

process.env.TZ='Europe/Budapest'
await mkdir('artifacts',{recursive:true})
const browser=await chromium.launch({headless:true,channel:'msedge'})
const context=await browser.newContext({viewport:{width:1652,height:952},timezoneId:'Europe/Budapest'})
const page=await context.newPage(), errors=[], checked=[]
page.on('pageerror',error=>errors.push(error.message))
page.setDefaultTimeout(15000)
const fixture=plannerFixture(new Date(2026,10,2,9))
fixture.collections.push({id:'calendar-readonly',source:'calendar',title:'Shared read-only calendar',readonly:true,color:'#9054ca'})
const local=(day,hour,minute=0)=>new Date(2026,10,day,hour,minute).toISOString()
const event=(id,title,day,start,end,extra={})=>({id,title,kind:'event',source:'calendar',collectionId:'calendar-work',collectionTitle:'Freelance calendar',start:local(day,start),end:local(day,end),busy:true,readonly:false,...extra})
fixture.records=fixture.records.filter(record=>record.kind!=='event')
fixture.records.push(
  event('busy-meeting','Existing busy meeting',4,10,11,{start:local(4,10,30),end:local(4,11,30)}),
  event('free-reminder','Free reminder',4,10,12,{busy:false}),
  event('cancelled-meeting','Cancelled meeting',4,10,12,{busy:false,status:'CANCELLED'}),
  event('existing-session','Existing work session',4,15,16,{collectionId:'calendar-readonly',collectionTitle:'Shared read-only calendar',readonly:true}),
  event('adjacent-booking','Adjacent booking',5,10,11),
)
Object.assign(fixture.records.find(record=>record.id==='card-mine'),{start:'2026-11-03',due:'2026-11-05',stackId:'stack-progress',status:'In progress'})
Object.assign(fixture.records.find(record=>record.id==='task-today'),{start:'2026-11-03',due:'2026-11-05',readonly:true})
fixture.workspace.spaces[0].collectionIds.push('calendar-readonly')
fixture.pendingSchedules=[]

await page.addInitScript(initial=>{
  const clone=value=>structuredClone(value)
  let state=clone(initial)
  const saved=sessionStorage.getItem('scheduling-ui-fixture')
  if(saved)state=JSON.parse(saved)
  const remember=()=>sessionStorage.setItem('scheduling-ui-fixture',JSON.stringify(state))
  const log=JSON.parse(sessionStorage.getItem('scheduling-ui-log')||'[]')
  const record=(method,input)=>{log.push({method,input:clone(input)});sessionStorage.setItem('scheduling-ui-log',JSON.stringify(log))}
  window.__fixtureWrites=log
  window.__scheduleFailNext=false
  window.__schedulePreflightFailNext=false
  window.workspaceApi={
    getState:async()=>clone(state), refresh:async()=>clone(state),
    saveWorkspace:async(workspace,revision)=>{
      if(revision!==state.revision)throw new Error('Stale scheduling fixture revision')
      record('saveWorkspace',{workspace,revision});state.workspace=clone(workspace);state.revision++;remember()
      return {workspace:clone(state.workspace),revision:state.revision,storage:clone(state.storage)}
    },
    createLinkedEvent:async input=>{
      record('createLinkedEvent',input)
      const {expectedRevision,...payload}=input
      const pending=state.pendingSchedules.find(value=>value.requestId===payload.requestId)
      if(pending){
        const {created,...original}=pending
        const stable=value=>JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))))
        if(stable(original)!==stable(payload))throw new Error('Retry must preserve its original event payload')
      }else if(expectedRevision!==state.revision)throw new Error('Stale scheduling fixture revision')
      if(!state.collections.some(value=>value.id===payload.collectionId&&value.source==='calendar'&&!value.readonly))throw new Error('Calendar is not writable')
      if(!state.records.some(value=>value.id===payload.recordId&&['task','card'].includes(value.kind)))throw new Error('The selected work is unavailable')
      if(window.__schedulePreflightFailNext){
        window.__schedulePreflightFailNext=false
        throw new Error('Scheduling preflight failed before any event or pending request was saved.')
      }
      const id=`scheduled-${payload.requestId}`
      if(!state.records.some(value=>value.id===id))state.records.push({id,source:'calendar',kind:'event',title:payload.title,collectionId:payload.collectionId,collectionTitle:state.collections.find(value=>value.id===payload.collectionId).title,start:payload.start,end:payload.end,allDay:payload.allDay,busy:true,readonly:false})
      if(window.__scheduleFailNext){
        window.__scheduleFailNext=false
        if(!pending)state.pendingSchedules.push({...clone(payload),created:true})
        remember()
        throw new Error('The calendar event was created, but its planner link is waiting. Retry the same request to finish safely.')
      }
      if(!state.workspace.relations.some(value=>value.type==='scheduled_during'&&value.fromId===payload.recordId&&value.toId===id)){
        state.workspace.relations.push({id:`link-${payload.requestId}`,type:'scheduled_during',fromId:payload.recordId,toId:id});state.revision++
      }
      state.pendingSchedules=state.pendingSchedules.filter(value=>value.requestId!==payload.requestId)
      remember();return clone(state)
    },
    openExternal:async url=>record('openExternal',{url}),readPage:async()=>({body:''}),
    syncWorkspace:async()=>clone(state),exportWorkspace:async()=>({exported:true}),
  }
},fixture)

const details=()=>page.getByRole('complementary',{name:'Item details'})
const dialog=()=>page.getByRole('dialog')
const backend=()=>page.evaluate(()=>window.workspaceApi.getState())
const creationCalls=()=>page.evaluate(()=>window.__fixtureWrites.filter(value=>value.method==='createLinkedEvent'))
async function selectWork(title){
  // Reopened views use today's date; keep this historical fixture in its own week.
  await page.getByLabel('Choose calendar date').fill('2026-11-02')
  await page.getByLabel('Choose calendar date').dispatchEvent('change')
  const row=page.locator('.timeline-row-label').filter({hasText:title}).first()
  await row.click();await details().getByRole('heading',{name:title,exact:true}).waitFor()
}
async function showSchedule(){await details().getByRole('button',{name:'Schedule in calendar',exact:true}).click();await dialog().getByRole('heading',{name:'Schedule in calendar',exact:true}).waitFor()}
async function fillBooking(title,start,end){
  await dialog().getByRole('combobox',{name:/^Calendar/}).selectOption('calendar-work')
  await dialog().getByLabel('Event title',{exact:true}).fill(title)
  await dialog().locator('.schedule-exact').evaluate(element=>element.open=true)
  await dialog().getByLabel('Start',{exact:true}).fill(start)
  await dialog().getByLabel('End',{exact:true}).fill(end)
}
async function submitBooking(){await dialog().getByRole('button',{name:'Create & link',exact:true}).click();await dialog().waitFor({state:'hidden'})}
async function waitLink(fromId,toId,present=true){await page.waitForFunction(({fromId,toId,present})=>window.workspaceApi.getState().then(state=>state.workspace.relations.some(value=>value.type==='scheduled_during'&&value.fromId===fromId&&value.toId===toId)===present),{fromId,toId,present})}

try{
  await page.goto('http://127.0.0.1:5173')
  await page.getByRole('region',{name:'Timeline',exact:true}).waitFor()
  await page.getByLabel('Choose calendar date').fill('2026-11-02')
  await page.getByLabel('Choose calendar date').dispatchEvent('change')
  await selectWork('Edit the opening sequence')
  await showSchedule()
  assert.equal(await dialog().getByLabel('Event title',{exact:true}).inputValue(),'Edit the opening sequence')
  await dialog().getByRole('region',{name:'Choose a calendar time',exact:true}).waitFor()
  assert.equal(await dialog().locator('.schedule-exact').evaluate(element=>element.open),false,'Precise date inputs remain secondary to the visual week')
  assert.equal(await dialog().getByRole('combobox',{name:/^Calendar/}).inputValue(),'','My overview requires an explicit calendar when multiple writable sources exist')
  assert.equal(await dialog().getByRole('combobox',{name:/^Calendar/}).locator('option[value="calendar-readonly"]').count(),0,'Read-only calendars cannot receive new bookings')
  await fillBooking('Opening edit session','2026-11-04T10:00','2026-11-04T12:00')
  await dialog().getByText('1 overlapping busy booking',{exact:true}).waitFor()
  assert.match(await dialog().locator('.booking-warning').innerText(),/Existing busy meeting/)
  assert.doesNotMatch(await dialog().locator('.booking-warning').innerText(),/Free reminder|Cancelled meeting|Prepare review notes/)
  await page.screenshot({path:'artifacts/scheduling-form.png',fullPage:true})
  await submitBooking()
  let state=await backend()
  const first=state.records.find(value=>value.title==='Opening edit session')
  await waitLink('card-mine',first.id)
  assert.equal(first.start,local(4,10));assert.equal(first.end,local(4,12))
  assert.equal(state.records.find(value=>value.id==='card-mine').due,'2026-11-05','Booking does not move native card deadline')
  const firstRow=details().locator('.linked-booking').filter({hasText:'Opening edit session'})
  await firstRow.getByText('Linked work session',{exact:true}).waitFor()
  assert.match(await firstRow.locator('.booking-collision').innerText(),/1 other busy booking/)
  checked.push('Create & link uses the explicitly selected calendar, excludes read-only targets, links the real event and retains genuine booking collisions')

  await showSchedule()
  await fillBooking('Second editing session','2026-11-05T09:00','2026-11-05T10:00')
  assert.equal(await dialog().locator('.booking-warning').count(),0,'Task ranges and touching calendar boundaries are not conflicts')
  await submitBooking()
  state=await backend()
  assert.equal(state.workspace.relations.filter(value=>value.type==='scheduled_during'&&value.fromId==='card-mine').length,2)
  const secondRow=details().locator('.linked-booking').filter({hasText:'Second editing session'})
  assert.equal(await secondRow.locator('.booking-collision').count(),0)
  await page.screenshot({path:'artifacts/scheduling-linked.png',fullPage:true})
  await details().getByRole('button',{name:'Link existing event',exact:true}).click()
  await dialog().getByLabel('Find calendar event').fill('Second editing session')
  await dialog().getByText('No matching unlinked events in the loaded calendar range.',{exact:true}).waitFor()
  assert.equal(await dialog().getByRole('radio').count(),0,'The picker excludes an event already linked to this work')
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  checked.push('Multiple calendar sessions per card, with no false warnings from task spans, self-overlap or adjacent bookings')

  await selectWork('Prepare review notes')
  assert.equal(await details().getByRole('button',{name:'Schedule in calendar',exact:true}).isEnabled(),true,'Read-only source work can be booked into a writable calendar without changing the source')
  const callsBeforeLink=(await creationCalls()).length
  await details().getByRole('button',{name:'Link existing event',exact:true}).click()
  await dialog().getByLabel('Find calendar event').fill('Existing work session')
  await dialog().getByRole('radio',{name:/Existing work session/}).check()
  await dialog().getByRole('button',{name:'Link work session',exact:true}).click()
  await dialog().waitFor({state:'hidden'});await waitLink('task-today','existing-session')
  assert.equal((await creationCalls()).length,callsBeforeLink,'Linking an existing event is metadata-only')
  await details().locator('.linked-booking').filter({hasText:'Existing work session'}).getByRole('button',{name:'Existing work session',exact:true}).click()
  await details().getByRole('heading',{name:'Existing work session',exact:true}).waitFor()
  await details().locator('.scheduled-task').getByRole('button',{name:/Prepare review notes/}).first().click()
  await details().getByRole('heading',{name:'Prepare review notes',exact:true}).waitFor()
  const existingRow=details().locator('.linked-booking').filter({hasText:'Existing work session'})
  await existingRow.hover()
  await existingRow.getByRole('button',{name:'Unlink work session Existing work session',exact:true}).click()
  await waitLink('task-today','existing-session',false)
  assert.ok((await backend()).records.some(value=>value.id==='existing-session'),'Unlink must retain the source calendar event')
  checked.push('Existing read-only events can be linked, followed in both directions and unlinked without a native event write')

  await showSchedule()
  await fillBooking('Retry all-day booking','2026-11-07T09:00','2026-11-08T09:00')
  await dialog().getByLabel('All day',{exact:true}).check()
  await dialog().getByLabel('Start',{exact:true}).fill('2026-11-07')
  await dialog().getByLabel('End',{exact:true}).fill('2026-11-08')
  await page.evaluate(()=>{window.__scheduleFailNext=true})
  await dialog().getByRole('button',{name:'Create & link',exact:true}).click()
  await dialog().getByRole('button',{name:'Retry create & link',exact:true}).waitFor()
  await dialog().getByRole('alert').filter({hasText:'The calendar event was created, but its planner link is waiting.'}).waitFor()
  assert.equal(await dialog().getByLabel('Event title',{exact:true}).isDisabled(),true)
  assert.equal(await dialog().getByLabel('Start',{exact:true}).isDisabled(),true)
  const failedCall=(await creationCalls()).at(-1)
  assert.equal(failedCall.input.allDay,true)
  assert.equal(failedCall.input.start,'2026-11-07')
  assert.equal(failedCall.input.end,'2026-11-08')
  await dialog().getByRole('button',{name:'Cancel',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  await page.reload()
  await page.getByRole('region',{name:'Timeline',exact:true}).waitFor()
  await selectWork('Prepare review notes')
  await details().getByRole('button',{name:'Resume scheduling',exact:true}).click()
  await dialog().getByRole('button',{name:'Retry create & link',exact:true}).waitFor()
  assert.equal(await dialog().getByLabel('Start',{exact:true}).inputValue(),'2026-11-07','All-day pending drafts restore valid DATE controls')
  assert.equal(await dialog().getByLabel('End',{exact:true}).inputValue(),'2026-11-08')
  assert.equal(await dialog().getByLabel('Event title',{exact:true}).isDisabled(),true)
  assert.equal(await dialog().locator('.booking-warning').count(),0,'Resume must not compare its already created event against itself')
  assert.equal(await dialog().getByText(/No overlapping busy bookings/).count(),0,'Resume must not claim freshly checked availability')
  await dialog().getByRole('button',{name:'Retry create & link',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  const retryCall=(await creationCalls()).at(-1)
  const withoutRevision=({expectedRevision,...payload})=>payload
  assert.deepEqual(withoutRevision(retryCall.input),withoutRevision(failedCall.input),'Retry uses the exact same request ID and booking payload')
  state=await backend()
  assert.equal(state.records.filter(value=>value.title==='Retry all-day booking').length,1)
  assert.equal(state.workspace.relations.filter(value=>value.type==='scheduled_during'&&value.fromId==='task-today'&&value.toId===`scheduled-${failedCall.input.requestId}`).length,1)
  assert.equal(state.pendingSchedules.length,0)
  checked.push('A partially created all-day event freezes its draft and resumes after reload with the same request ID, without duplicates')

  await showSchedule()
  await fillBooking('Preflight rejected booking','2026-11-09T09:00','2026-11-09T10:00')
  const countBeforePreflight=state.records.length
  await page.evaluate(()=>{window.__schedulePreflightFailNext=true})
  await dialog().getByRole('button',{name:'Create & link',exact:true}).click()
  await dialog().getByRole('button',{name:'Create & link',exact:true}).waitFor()
  await page.waitForFunction(()=>!document.querySelector('.schedule-form fieldset')?.disabled)
  await dialog().getByRole('alert').filter({hasText:'Scheduling preflight failed before any event or pending request was saved.'}).waitFor()
  assert.equal(await dialog().getByLabel('Event title',{exact:true}).isEnabled(),true,'Verified absence of a pending write keeps the form editable')
  state=await backend()
  assert.equal(state.records.length,countBeforePreflight)
  assert.equal(state.pendingSchedules.length,0)
  const rejectedCall=(await creationCalls()).at(-1)
  await fillBooking('Corrected after preflight','2026-11-09T11:00','2026-11-09T12:00')
  await submitBooking()
  const correctedCall=(await creationCalls()).at(-1)
  assert.notEqual(correctedCall.input.title,rejectedCall.input.title,'Editable retry uses the corrected title')
  assert.equal(correctedCall.input.start,local(9,11),'Editable retry uses the corrected time rather than a frozen old payload')
  state=await backend()
  assert.equal(state.records.filter(value=>value.title==='Corrected after preflight').length,1)
  assert.equal(state.records.filter(value=>value.title==='Preflight rejected booking').length,0)
  checked.push('A verified preflight failure leaves no event or pending operation and allows corrected dates and title before retry')

  const ambiguousPending={requestId:'11111111-2222-4333-8444-555555555555',recordId:'task-today',title:'Autumn DST pending session',collectionId:'calendar-work',start:'2026-10-25T01:30:00.123Z',end:'2026-10-25T02:30:00.456Z',allDay:false,description:'Preserve the second 02:30 and its milliseconds exactly'}
  await page.evaluate(async pending=>{
    const state=await window.workspaceApi.getState()
    state.pendingSchedules.push({...pending,created:true})
    state.records.push({id:`scheduled-${pending.requestId}`,kind:'event',source:'calendar',title:pending.title,collectionId:pending.collectionId,collectionTitle:'Freelance calendar',start:pending.start,end:pending.end,allDay:false,busy:true,readonly:false})
    sessionStorage.setItem('scheduling-ui-fixture',JSON.stringify(state))
  },ambiguousPending)
  await page.reload()
  await page.getByRole('region',{name:'Timeline',exact:true}).waitFor()
  await selectWork('Prepare review notes')
  await details().getByRole('button',{name:'Resume scheduling',exact:true}).click()
  await dialog().getByRole('button',{name:'Retry create & link',exact:true}).waitFor()
  assert.equal(await dialog().getByLabel('Start',{exact:true}).isDisabled(),true)
  assert.match(await dialog().getByLabel('Start',{exact:true}).inputValue(),/^2026-10-25T02:30/,'The local display is an ambiguous DST hour')
  assert.equal(await dialog().locator('.booking-warning').count(),0)
  assert.equal(await dialog().getByText(/No overlapping busy bookings/).count(),0)
  await dialog().getByRole('button',{name:'Retry create & link',exact:true}).click()
  await dialog().waitFor({state:'hidden'})
  const ambiguousRetry=(await creationCalls()).at(-1)
  assert.deepEqual(withoutRevision(ambiguousRetry.input),ambiguousPending,'Persisted UTC instants, seconds and milliseconds survive retry without reconstruction from datetime-local')
  state=await backend()
  assert.equal(state.records.filter(value=>value.id===`scheduled-${ambiguousPending.requestId}`).length,1)
  assert.equal(state.workspace.relations.filter(value=>value.type==='scheduled_during'&&value.fromId==='task-today'&&value.toId===`scheduled-${ambiguousPending.requestId}`).length,1)
  assert.equal(state.pendingSchedules.length,0)
  checked.push('An ambiguous autumn DST pending booking preserves its exact UTC instants and milliseconds, without self-conflict or a false availability claim')

  validateWorkspace(state.workspace)
  assert.deepEqual(errors,[])
  assert.ok((await creationCalls()).every(value=>value.input.requestId&&Number.isInteger(value.input.expectedRevision)))
  console.log(JSON.stringify({result:'PASS',checks:checked},null,2))
}catch(error){
  await page.screenshot({path:'artifacts/scheduling-ui-failure.png',fullPage:true}).catch(()=>{})
  console.error(JSON.stringify({result:'FAIL',checked,rendererErrors:errors,error:String(error)},null,2))
  throw error
}finally{await browser.close()}
