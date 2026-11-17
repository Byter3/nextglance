/** Selection/hover cost on populated views; isolated records, no native writes. */
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
const url=specifier=>'/@fs/'+fileURLToPath(import.meta.resolve(specifier)).replaceAll('\\','/')
const baseline=process.argv.includes('--baseline')
const browser=await chromium.launch({headless:true,channel:'msedge'})
const page=await browser.newPage({viewport:{width:1600,height:1050},timezoneId:'Europe/Budapest'})
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(30000)
await page.route('**/view-performance-harness',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="${url('@nextspace/ui/style.css')}"/></head><body><div id="app" style="height:940px;overflow:auto"></div><script type="module">
import {createApp,h,reactive,nextTick} from '/node_modules/.vite/deps/vue.js'
import Timeline from '${url('@nextspace/ui/components/PlannerTimeline.vue')}'
import Calendar from '${url('@nextspace/ui/components/PlannerCalendar.vue')}'
const NativeDate=Date,stats={dates:0,locales:0};window.__viewStats=stats
window.Date=new Proxy(NativeDate,{construct(target,args){stats.dates++;return Reflect.construct(target,args)}})
for(const key of ['toLocaleDateString','toLocaleTimeString']){const old=NativeDate.prototype[key];NativeDate.prototype[key]=function(...args){stats.locales++;return old.apply(this,args)}}
const anchor=new Date(2026,10,2),iso=(day,hour=9)=>new NativeDate(2026,10,day,hour).toISOString()
const work=Array.from({length:350},(_,i)=>({id:'work-'+i,kind:i%2?'task':'card',source:i%2?'tasks':'deck',title:'Work '+i,collectionId:'work',collectionTitle:'Production',start:iso(2+i%7),due:iso(3+i%7,17),status:'To do'}))
const events=Array.from({length:140},(_,i)=>({id:'event-'+i,kind:'event',source:'calendar',title:'Booking '+i,collectionId:'calendar',collectionTitle:'Production calendar',start:iso(2+i%14,7+Math.floor(i/14)),end:iso(2+i%14,8+Math.floor(i/14))}))
const state=reactive({scene:'timeline',records:[...work,...events],relations:work.slice(0,140).map((r,i)=>({id:'booking-'+i,type:'scheduled_during',fromId:r.id,toId:'event-'+i})).concat(work.slice(1).map((r,i)=>({id:'dep-'+i,type:'depends_on',fromId:r.id,toId:'work-'+i}))),selectedId:null,hoveredId:null})
const days=Array.from({length:14},(_,i)=>new Date(2026,10,2+i)),plans=[]
window.__viewHarness={state,async measure(field,id){stats.dates=0;stats.locales=0;const start=performance.now();state[field]=id;await nextTick();const script=performance.now()-start;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return {scriptMs:script,paintMs:performance.now()-start,dates:stats.dates,locales:stats.locales}},async changeDate(){state.records[0].start=iso(2,12);state.records[0].due=iso(3,17);await nextTick()},async scene(value){state.scene=value;await nextTick();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)}}
const common=()=>({records:state.records,relations:state.relations,plans,selectedId:state.selectedId,hoveredId:state.hoveredId,colorFor:()=> '#3975ce',sourceColorFor:()=> '#329b75',tagsFor:()=>[],canEditRecord:()=>true,canEditPlans:true,canLink:true})
createApp({setup(){return()=>state.scene==='timeline'?h(Timeline,{...common(),anchor,daysCount:14,focused:false,spaces:[],categories:[],projects:[],collections:[],onOpen:r=>state.selectedId=r.id,onHover:id=>state.hoveredId=id}):h(Calendar,{...common(),days,onOpen:r=>state.selectedId=r.id,onHover:id=>state.hoveredId=id})}}).mount('#app')
</script></body></html>`}))
try{
 await page.goto('http://127.0.0.1:5173/view-performance-harness');await page.locator('.timeline-bar').first().waitFor()
 const metrics={}
 for(const scene of ['timeline','calendar']){
  await page.evaluate(value=>window.__viewHarness.scene(value),scene)
  metrics[scene]={}
  for(const field of ['selectedId','hoveredId']){
   const samples=[]
   for(let index=0;index<6;index++){
    const sample=await page.evaluate(({field,index})=>window.__viewHarness.measure(field,(field==='selectedId'?'work-':'event-')+index),{field,index})
    samples.push(sample)
    if(!baseline){
     // Operation counts catch data-layout work returning to hover/selection renders
     // without imposing flaky wall-clock thresholds on shared CI/developer PCs.
     // A small allowance accommodates the midnight-refresh timer firing in a sample.
     assert.ok(sample.dates<=(scene==='timeline'?1000:10),`${scene} ${field}: ${sample.dates} Date constructions`)
     assert.ok(sample.locales<=(scene==='timeline'?100:50),`${scene} ${field}: ${sample.locales} locale calls`)
    }
   }
   metrics[scene][field]={meanScriptMs:Math.round(samples.reduce((sum,item)=>sum+item.scriptMs,0)/samples.length),maxScriptMs:Math.round(Math.max(...samples.map(item=>item.scriptMs))),meanDateConstructions:Math.round(samples.reduce((sum,item)=>sum+item.dates,0)/samples.length),maxDateConstructions:Math.max(...samples.map(item=>item.dates)),meanLocaleCalls:Math.round(samples.reduce((sum,item)=>sum+item.locales,0)/samples.length),maxLocaleCalls:Math.max(...samples.map(item=>item.locales))}
  }
 }
 await page.evaluate(()=>window.__viewHarness.scene('timeline'))
 const bar=page.getByRole('button',{name:/^Work range: Work 0,/}),before=await bar.getAttribute('style')
 await page.evaluate(()=>window.__viewHarness.changeDate())
 assert.notEqual(await bar.getAttribute('style'),before,'Changing dates in place updates cached geometry')
 const event=page.locator('.timeline-event-chip[data-event-id="event-0"]'),eventTitle=await event.getAttribute('title')
 await page.evaluate(()=>{
  const event=window.__viewHarness.state.records.find(record=>record.id==='event-0')
  event.start='2026-11-02T06:15:00.000Z'
 })
 await page.waitForFunction(previous=>document.querySelector('.timeline-event-chip[data-event-id="event-0"]')?.getAttribute('title')!==previous,eventTitle)
 assert.notEqual(await event.getAttribute('title'),eventTitle,'Changing an event time in place updates its displayed time')
 assert.equal(await page.locator('.timeline-event-list').count(),0,'The closed calendar picker does not render hidden rows')
 await page.locator('.timeline-event-picker > summary').click()
 await page.getByRole('region',{name:'Calendar events in this period'}).waitFor()
 assert.equal(await page.locator('.timeline-event-list > button').count(),140,'Opening the calendar picker still includes all events')
 assert.deepEqual(errors,[])
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/view-performance-'+(baseline?'baseline':'after')+'.json',JSON.stringify(metrics,null,2))
 console.log(JSON.stringify({records:490,relations:489,metrics},null,2))
}finally{await browser.close()}
