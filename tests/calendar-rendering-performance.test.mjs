import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const require=createRequire(new URL('../packages/ui/package.json',import.meta.url))
const {createSSRApp,createRenderer,reactive,nextTick,h,ssrContextKey}=require('vue'),{renderToString}=require('vue/server-renderer')
const makeRecords=()=>[
  ...Array.from({length:210},(_,i)=>{const start=new Date(2026,10,5+Math.floor(i/10),8+i%10);return {id:`event${i}`,kind:'event',source:'calendar',collectionId:'calendar',title:`Booking ${i}`,start:start.toISOString(),end:new Date(+start+3600000).toISOString(),allDay:false}}),
  ...Array.from({length:2000},(_,i)=>({id:`task${i}`,kind:'task',source:'tasks',collectionId:'tasks',title:`Work ${String(i).padStart(4,'0')}`,due:'2026-11-15',tags:['Example']}))
]
const base=()=>({records:makeRecords(),plans:[],relations:[],anchor:new Date(2026,10,12),scopeId:'all',colorFor:()=>'#123456',days:Array.from({length:7},(_,i)=>new Date(2026,10,12+i))})
const buttons=(html,name)=>(html.match(new RegExp(`<button[^>]*class="[^"]*\\b${name}\\b`,'g'))||[]).length

test('real Calendar SSR bounds 2,000 all-day controls and buffered timed controls without shrinking geometry',async t=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const {default:Calendar}=await server.ssrLoadModule('/src/PlannerCalendar.vue'),{default:Timeline}=await server.ssrLoadModule('/src/PlannerTimeline.vue'),{default:Scheduling}=await server.ssrLoadModule('/src/SchedulingWeek.vue')
    const props=base(),render=component=>renderToString(createSSRApp({render:()=>h(component,props)}))
    await render(Calendar);const started=performance.now(),html=await render(Calendar),duration=performance.now()-started
    assert.equal(buttons(html,'all-day-event'),8)
    assert.equal(buttons(html,'calendar-event'),90)
    assert.match(html,/grid-template-rows:repeat\(2000,28px\)/)
    assert.equal((html.match(/<div[^>]*class="[^"]*\bcalendar-day-track\b/g)||[]).length,21)
    assert.doesNotMatch(html,/class="calendar-hour-line/)
    t.diagnostic(`Calendar fixture: ${duration.toFixed(1)}ms SSR; ${html.length} HTML chars; 8/2000 all-day buttons; 90/210 timed buttons; zero decorative hour elements. This is not device latency.`)
    const timelineProps={...props,daysCount:7,spaces:[],categories:[],projects:[],collections:[{id:'tasks',source:'tasks',title:'Tasks'}],compactControls:true}
    const drawTimeline=()=>renderToString(createSSRApp({render:()=>h(Timeline,timelineProps)}))
    await drawTimeline();const timelineStart=performance.now(),timeline=await drawTimeline()
    t.diagnostic(`Timeline fixture: ${(performance.now()-timelineStart).toFixed(1)}ms SSR; ${timeline.length} HTML chars.`)
    const schedule=await renderToString(createSSRApp({render:()=>h(Scheduling,{...props,collections:[],start:'2026-11-12T10:00',end:'2026-11-12T11:00',allDay:false})}))
    assert.ok(buttons(schedule,'week-all-day-item')<=8)
    assert.match(schedule,/grid-template-rows:repeat\(2000,28px\)/)
  }finally{await server.close()}
})

test('actual Calendar reactive bindings retain focus/drag, refresh in-place tags and reuse same-pixel windows',async t=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  const previous={window:globalThis.window,document:globalThis.document,ResizeObserver:globalThis.ResizeObserver,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame}
  Object.assign(globalThis,{window:Object.assign(new EventTarget(),{innerWidth:900,innerHeight:700}),document:new EventTarget(),ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){}})
  let app
  try{
    const {default:Calendar}=await server.ssrLoadModule('/src/PlannerCalendar.vue')
    const input=reactive({...base(),days:Array.from({length:21},(_,i)=>new Date(2026,10,5+i)),embedded:true,contextCollapsed:true,contextRecordIds:[],relatedIds:[],highlightedIds:[],axis:{labelWidth:40,dayWidth:100,scrollLeft:700}})
    let bindings
    const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
    app=renderer.createApp({setup(){bindings=Calendar.setup(input,{emit(){},expose(){}});return()=>null}});app.provide(ssrContextKey,{});app.mount({});await nextTick()
    const initialLabels=bindings.dateLabels.value,initialBlocks=bindings.blocksByDay.value,initialRendered=bindings.renderedBlocks.value,initialAllDay=bindings.renderedAllDayItems.value
    input.axis.scrollLeft=701;await nextTick()
    assert.equal(bindings.blocksByDay.value,initialBlocks);assert.equal(bindings.dateLabels.value,initialLabels)
    // Boundary-aligned panning at 700 adds one partial day; further pixels keep the same window.
    const nextBlocks=bindings.renderedBlocks.value,nextAllDay=bindings.renderedAllDayItems.value;input.axis.scrollLeft=702;await nextTick();assert.equal(bindings.renderedBlocks.value,nextBlocks);assert.equal(bindings.renderedAllDayItems.value,nextAllDay)
    bindings.allDayScrollTop.value=310;await nextTick()
    assert.notEqual(bindings.renderedAllDayItems.value,initialAllDay);assert.equal(bindings.dateLabels.value,initialLabels)
    const first=bindings.allDayLayout.value.items[0];bindings.focusId.value=first.record.id;await nextTick()
    assert.ok(bindings.renderedAllDayItems.value.some(item=>item.id===first.id))
    bindings.focusId.value=null;bindings.drag.value={item:first,moved:false,valid:false};await nextTick()
    assert.ok(bindings.renderedAllDayItems.value.some(item=>item.id===first.id))
    bindings.drag.value=null;await nextTick();assert.ok(!bindings.renderedAllDayItems.value.some(item=>item.id===first.id))
    const timed=bindings.blocksByDay.value.get(+bindings.days.value[0])[0];bindings.focusId.value=timed.record.id;await nextTick()
    assert.ok([...bindings.renderedBlocks.value.values()].flat().some(item=>item.id===timed.id))
    bindings.focusId.value=null;await nextTick();assert.ok(![...bindings.renderedBlocks.value.values()].flat().some(item=>item.id===timed.id))
    bindings.focusId.value=first.record.id;input.axis.scrollLeft=0;await nextTick()
    assert.ok(bindings.renderedAllDayItems.value.some(item=>item.id===first.id),'horizontal pan retains the focused all-day control')
    bindings.focusId.value=null;await nextTick();assert.ok(!bindings.renderedAllDayItems.value.some(item=>item.id===first.id))
    const record=input.records.find(record=>record.kind==='task');assert.equal(bindings.itemTags(record)[0].title,'Example')
    record.tags.splice(0,1,'Updated');await nextTick();assert.equal(bindings.itemTags(record)[0].title,'Updated')
    assert.equal(bindings.dateLabels.value,initialLabels,'in-place tags do not reformat dates')
    assert.ok(initialRendered instanceof Map)
    app.unmount();app=undefined
    const {default:Month}=await server.ssrLoadModule('/src/CalendarMonth.vue')
    const monthProps=reactive({...base(),contextRecordIds:[]});let month
    app=renderer.createApp({setup(){month=Month.setup(monthProps,{emit(){},expose(){}});return()=>null}});app.provide(ssrContextKey,{});app.mount({});await nextTick()
    const monthLabels=month.dateLabels.value,booking=monthProps.records[0]
    let segment=month.weeks.value.flatMap(week=>week.items).find(item=>item.record.id===booking.id)
    assert.match(month.title(segment),/Booking 0/)
    booking.title='Revised booking';await nextTick()
    segment=month.weeks.value.flatMap(week=>week.items).find(item=>item.record.id===booking.id)
    assert.match(month.title(segment),/Revised booking/)
    assert.equal(month.dateLabels.value,monthLabels,'item title change preserves unchanged month headings')
  }finally{app?.unmount();Object.assign(globalThis,previous);await server.close()}
})
