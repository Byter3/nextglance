import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
const require=createRequire(new URL('../packages/ui/package.json',import.meta.url))
const {createSSRApp,createRenderer,reactive,nextTick,h,ssrContextKey}=require('vue'),{renderToString}=require('vue/server-renderer')

test('actual calendar surfaces allocate visible lanes and share the accessible resize separator',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const {default:Calendar}=await server.ssrLoadModule('/src/PlannerCalendar.vue'),{default:Scheduling}=await server.ssrLoadModule('/src/SchedulingWeek.vue')
    const records=[{id:'near',kind:'event',source:'calendar',title:'Visible booking',start:'2026-11-08',end:'2026-11-11',allDay:true},...Array.from({length:50},(_,i)=>({id:`far${i}`,kind:'event',source:'calendar',title:'Distant buffered booking',start:'2026-11-25',end:'2026-11-27',allDay:true}))]
    const props={records,plans:[],collections:[],anchor:new Date(2026,10,1),scopeId:'all',colorFor:()=>'#123456',days:Array.from({length:30},(_,i)=>new Date(2026,10,i+1)),embedded:true,contextCollapsed:true,axis:{labelWidth:40,dayWidth:100,scrollLeft:700}}
    const html=await renderToString(createSSRApp({render:()=>h(Calendar,props)}))
    assert.match(html,/--all-day-height:34px/)
    assert.match(html,/Visible booking/);assert.doesNotMatch(html,/Distant buffered booking/)
    assert.match(html,/role="separator"[^>]*tabindex="0"[^>]*aria-orientation="horizontal"[^>]*aria-label="Resize all-day section"/)
    assert.match(html,/aria-valuenow="34"/);assert.match(html,/aria-label="Auto fit all-day section"/)
    const empty=await renderToString(createSSRApp({render:()=>h(Calendar,{...props,records:[]})}))
    assert.match(empty,/--all-day-height:24px/);assert.match(empty,/grid-template-rows:18px/)
    const scheduling=await renderToString(createSSRApp({render:()=>h(Scheduling,{records:[],collections:[],start:'2026-11-12T10:00',end:'2026-11-12T11:00',allDay:false})}))
    assert.match(scheduling,/--all-day-height:24px/);assert.match(scheduling,/aria-label="Resize all-day section"/)
    const draft=await renderToString(createSSRApp({render:()=>h(Scheduling,{records:[],collections:[],start:'2026-11-12',end:'2026-11-13',allDay:true})}))
    assert.match(draft,/--all-day-height:34px/);assert.match(draft,/all-day-draft/)
  }finally{await server.close()}
})

test('the themed page menu renders current scope/selection and handles keyboard, outside, Back and focus',async t=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  try{
    const {default:Selector}=await server.ssrLoadModule('/src/PageSelector.vue')
    const options=[{id:'overview',label:'Overview'},{id:'calendar',label:'Calendar'},{id:'timeline',label:'Timeline'},{id:'board',label:'Board'},{id:'list',label:'List'}]
    const input={modelValue:'calendar',options,scopeName:'Studio'}
    const html=await renderToString(createSSRApp({render:()=>h(Selector,input)}))
    assert.match(html,/<small[^>]*>Studio<\/small>/);assert.match(html,/<strong[^>]*>Calendar<\/strong>/);assert.match(html,/aria-haspopup="menu"/);assert.doesNotMatch(html,/<select\b/)
    const menuContext={},OpenSelector={...Selector,setup(props,context){const bindings=Selector.setup(props,context);bindings.open.value=true;return bindings}}
    await renderToString(createSSRApp({render:()=>h(OpenSelector,input)}),menuContext)
    assert.match(menuContext.teleports.body,/role="menu" aria-label="Planner pages"/)
    assert.equal((menuContext.teleports.body.match(/role="menuitemradio"/g)||[]).length,5)
    assert.equal((menuContext.teleports.body.match(/aria-checked="true"/g)||[]).length,1)
    const oldDocument=globalThis.document,oldWindow=globalThis.window
    const document=new EventTarget(),window=new EventTarget();Object.assign(window,{innerWidth:390,innerHeight:800});globalThis.document=document;globalThis.window=window
    let bindings,exposed,focused='none';const emitted=[]
    const props=reactive(input),trigger={getBoundingClientRect:()=>({left:100,top:8,bottom:52,width:180}),focus(){focused='trigger'},contains:value=>value===trigger}
    const buttons=options.map((_,index)=>({focus(){focused=index;bindings.active.value=index}})),menu={contains:value=>value===menu||buttons.includes(value),querySelector:selector=>buttons[Number(selector.match(/\d+/)?.[0])]}
    const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
    const app=renderer.createApp({setup(){bindings=Selector.setup(props,{emit:(name,value)=>emitted.push([name,value]),expose:value=>exposed=value});bindings.trigger.value=trigger;bindings.menu.value=menu;return()=>null}})
    try{
      app.provide(ssrContextKey,{})
      app.mount({})
      const key=key=>{const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:key});return event}
      await bindings.keyboard(key('ArrowDown'));assert.equal(bindings.open.value,true);assert.equal(focused,1)
      await bindings.keyboard(key('End'));assert.equal(focused,4)
      await bindings.keyboard(key('ArrowDown'));assert.equal(focused,0)
      await bindings.keyboard(key('Home'));assert.equal(focused,0)
      await bindings.keyboard(key('ArrowDown'));await bindings.keyboard(key('ArrowDown'));await bindings.keyboard(key('Enter'))
      assert.deepEqual(emitted.at(-1),['update:modelValue','timeline']);assert.equal(focused,'trigger');assert.equal(bindings.open.value,false)
      await bindings.reveal();await bindings.keyboard(key('Escape'));assert.equal(bindings.open.value,false);assert.equal(focused,'trigger')
      await bindings.reveal();document.dispatchEvent(new Event('pointerdown'));assert.equal(bindings.open.value,false)
      await bindings.reveal();exposed.close(true);assert.equal(bindings.open.value,false);assert.equal(focused,'trigger')
      await bindings.reveal();props.scopeName='Home';await nextTick();assert.equal(bindings.open.value,false)
      await bindings.reveal();await bindings.keyboard(key('Tab'));assert.equal(bindings.open.value,false)
      assert.equal(bindings.placement.value.left,'100px');assert.equal(bindings.placement.value.top,'56px')
      props.disabled=true;await nextTick();await bindings.reveal();assert.equal(bindings.open.value,false)
    }finally{app.unmount();globalThis.document=oldDocument;globalThis.window=oldWindow}
  }finally{await server.close()}
})
