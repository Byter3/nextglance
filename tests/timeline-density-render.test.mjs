import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const require=createRequire(new URL('../packages/ui/package.json',import.meta.url))
const {createSSRApp,h}=require('vue'),{renderToString}=require('vue/server-renderer')

test('actual Timeline shares compact row geometry with dependency routes and has no grip gutter',async()=>{
  // Compile/render one component in middleware mode: no HTTP listener, browser,
  // bundled assets, account connection or native mutation.
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const {default:Timeline}=await server.ssrLoadModule('/src/PlannerTimeline.vue')
    const props={records:[
      {id:'first',kind:'task',source:'tasks',collectionId:'work',title:'Prepare draft',start:'2026-11-12',due:'2026-11-13'},
      {id:'second',kind:'task',source:'tasks',collectionId:'work',title:'Review draft',start:'2026-11-14',due:'2026-11-15'},
    ],collections:[{id:'work',source:'tasks',title:'Project tasks'}],relations:[{id:'dependency',type:'depends_on',fromId:'second',toId:'first'}],plans:[],anchor:new Date('2026-11-12T00:00:00'),colorFor:()=>'#123456',scopeId:'all',daysCount:7,canReorder:true}
    for(const compactControls of [false,true]){
      const html=await renderToString(createSSRApp({render:()=>h(Timeline,{...props,compactControls})}))
      const height=compactControls?40:44
      assert.match(html,new RegExp(`data-row-height="${height}"`))
      assert.match(html,new RegExp(`--row-height:${height}px;--row-center:${height/2}px;--header-height:${height+4}px`))
      assert.doesNotMatch(html,/list-order-handle|data-list-reorder-handle|lucide-grip/)
      assert.equal((html.match(/\btimeline-list-entry\b/g)||[]).length,3)
      const path=html.match(/<path[^>]*data-relation-id="dependency"[^>]*\bd="([^"]+)"/)?.[1]
      assert.ok(path,'Dependency remains visible')
      const start=path.match(/^M ([\d.-]+) ([\d.-]+)/),end=path.match(/L ([\d.-]+) ([\d.-]+)$/)
      assert.equal(Number(start?.[2]),height*1.5)
      assert.equal(Number(end?.[2]),height*2.5)
      assert.match(html,/timeline-row-label[^>]*title="[^"]*Drag to reorder/)
      assert.doesNotMatch(html,/Drag onto a day to set a deadline/)
    }
    const collapsedHtml=await renderToString(createSSRApp({render:()=>h(Timeline,{...props,listCollapsed:true})}))
    assert.match(collapsedHtml,/list-collapsed/)
    assert.match(collapsedHtml,/--list-width:40px/)
    assert.match(collapsedHtml,/aria-label="Expand work list"/)
    assert.match(collapsedHtml,/timeline-bar-title"[^>]*>Prepare draft/)
    let bindings
    const ClosedTimeline={...Timeline,setup(input,context){bindings=Timeline.setup(input,context);bindings.toggleGroup(bindings.groups.value[0].id);return bindings}}
    const closedHtml=await renderToString(createSSRApp({render:()=>h(ClosedTimeline,{...props,listCollapsed:true})}))
    assert.equal((closedHtml.match(/data-summary-record-id=/g)||[]).length,2)
    assert.match(closedHtml,/data-summary-record-id="first"[^>]*title="Prepare draft"[^>]*aria-label="Open Prepare draft"/)
    assert.equal((closedHtml.match(/\btimeline-list-entry\b/g)||[]).length,1)
    assert.equal(bindings.collapsed.value.size,1)
    bindings.openRecord(props.records[0])
    assert.equal(bindings.collapsed.value.size,1,'Opening a preview does not expand its group')

    const history=Array.from({length:10000},(_,index)=>{
      const start=new Date(Date.UTC(1950,0,1+index)).toISOString().slice(0,10)
      const end=new Date(Date.UTC(1950,0,2+index)).toISOString().slice(0,10)
      return {id:`history-${index}`,kind:'event',source:'calendar',collectionId:'calendar',title:`Archived booking ${index}`,allDay:true,start,end}
    })
    const event=(id,title,start,end)=>({id,kind:'event',source:'calendar',collectionId:'calendar',title,start,end})
    const retained=event('retained','Editing session','2026-11-16T09:00:00','2026-11-16T11:00:00')
    const incoming=event('incoming','Planning session','2026-11-28T09:00:00','2026-11-28T10:00:00')
    const linkedWork={id:'scheduled',kind:'task',source:'tasks',collectionId:'work',title:'Previously scheduled task'}
    const tagReads=new Map()
    const LargeTimeline={...Timeline,setup(input,context){bindings=Timeline.setup(input,context);return bindings}}
    const largeProps={
      ...props,
      allCalendarBands:true,
      records:[...history,retained,incoming,linkedWork],
      relations:[{id:'past-booking',type:'scheduled_during',fromId:linkedWork.id,toId:history[0].id}],
      tagsFor(record){tagReads.set(record.id,(tagReads.get(record.id)||0)+1);return []},
    }
    const largeHtml=await renderToString(createSSRApp({render:()=>h(LargeTimeline,largeProps)}))
    assert.match(largeHtml,/Editing session/)
    assert.doesNotMatch(largeHtml,/Archived booking|Planning session/)
    assert.ok(![...tagReads.keys()].some(id=>id.startsWith('history-')),'No historical presentation is computed')
    assert.ok(bindings.datedLinkedWork.value.has(linkedWork.id),'A booking outside the window still schedules linked work')
    const canvas=bindings.canvas
    canvas.pan(canvas.state.value.dayWidth*8)
    canvas.settle()
    assert.deepEqual(bindings.eventLayout.value.entries.map(entry=>entry.record.id),['retained','incoming'])
  }finally{await server.close()}
})
