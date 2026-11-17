import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const require=createRequire(new URL('../packages/ui/package.json',import.meta.url))
const {createSSRApp,h}=require('vue'),{renderToString}=require('vue/server-renderer')

test('actual Calendar/Month and Overview render pinned labels and the collapsed aligned 40px rail',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const {default:Calendar}=await server.ssrLoadModule('/src/PlannerCalendar.vue'),{default:Month}=await server.ssrLoadModule('/src/CalendarMonth.vue'),{default:Overview}=await server.ssrLoadModule('/src/OverviewSplit.vue')
    const props={records:[{id:'booking',kind:'event',source:'calendar',collectionId:'calendar',title:'Production window',start:'2026-11-09',end:'2026-11-15',allDay:true},{id:'work',kind:'task',source:'tasks',collectionId:'tasks',title:'Prepare draft',due:'2026-11-12'}],plans:[],relations:[],spaces:[],categories:[],projects:[],collections:[],anchor:new Date(2026,10,12),days:[new Date(2026,10,12),new Date(2026,10,13)],daysCount:2,scopeId:'all',colorFor:()=>'#123456',sourceColorFor:()=>'#abcdef',canCreate:false}
    const render=(component,extra={})=>renderToString(createSSRApp({render:()=>h(component,{...props,...extra})}))
    const calendar=await render(Calendar,{embedded:true,contextCollapsed:true,axis:{labelWidth:40,dayWidth:100,scrollLeft:0}})
    assert.match(calendar,/--calendar-label-width:40px/);assert.doesNotMatch(calendar,/class="calendar-context"|class="overview-agenda/)
    assert.match(calendar,/all-day-pinned-label/);assert.match(calendar,/calendar-source-edge/)
    assert.equal((calendar.match(/class="all-day-title"[^>]*>Production window/g)||[]).length,1)
    const month=await render(Month)
    assert.match(month,/month-pinned-label/);assert.match(month,/month-source-edge/)
    const overview=await render(Overview,{listCollapsed:true})
    assert.match(overview,/--list-width:40px/);assert.match(overview,/--calendar-label-width:40px/)
    assert.match(overview,/aria-label="Expand work list"/);assert.match(overview,/timeline-point-title/)
  }finally{await server.close()}
})
