import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {readFile} from 'node:fs/promises'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createEmptyState} from '@nextspace/core/planner.mjs'
const {createRenderer,reactive,nextTick,h,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

// Execute the real component setup and shared pointer adapter. No HTTP listener,
// native account, browser or generated application bundle is involved.
test('scheduling preview uses real touch arbitration and changes only released drafts',async t=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}})
  t.after(()=>server.close())
  const {default:Week}=await server.ssrLoadModule('/src/SchedulingWeek.vue')
  async function fixture(t,{allDay=false}={}){
    const saved=new Map(),frames=new Map();let sequence=0,setup
    const replace=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})}
    const document=new EventTarget(),window=new EventTarget()
    window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}})
    class Element extends EventTarget{
      constructor(classes,parent,tag='DIV'){super();this.classes=new Set(classes.split(' '));this.parentElement=parent;this.tagName=tag;this.dataset={};this.captures=new Set();this.classList={toggle(){}};this.scrollTop=0;this.clientHeight=350;this.offsetWidth=this.clientWidth=744;this.maxTop=1000}
      closest(selector){return selector.split(',').some(part=>part.startsWith('.')?this.classes.has(part.slice(1)):part==='[data-planner-touch-surface]'?Object.hasOwn(this.dataset,'plannerTouchSurface'):part.toUpperCase()===this.tagName)?this:this.parentElement?.closest(selector)||null}
      contains(target){return target===this||Boolean(target?.parentElement&&this.contains(target.parentElement))}
      setPointerCapture(id){this.captures.add(id)}hasPointerCapture(id){return this.captures.has(id)}releasePointerCapture(id){this.captures.delete(id)}
      getBoundingClientRect(){return {left:0,top:0,width:744,height:1056,right:744,bottom:1056}}
    }
    for(const [key,value] of Object.entries({document,window,Element,HTMLElement:Element,ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:callback=>{frames.set(++sequence,callback);return sequence},cancelAnimationFrame:id=>frames.delete(id)}))replace(key,value)
    const root=new Element('scheduling-week'),viewport=new Element('week-times-scroll',root),timeGrid=new Element('week-time-grid',viewport),allDayViewport=new Element('week-all-day-scroll',root),allDayGrid=new Element('week-all-day',allDayViewport)
    const chip=new Element('week-draft',allDay?allDayGrid:timeGrid),body=new Element('draft-body',chip,'BUTTON'),edge=new Element('draft-edge',chip,'BUTTON')
    const changes=[],props=reactive({records:[],collections:[],plans:[],start:allDay?'2026-11-04':'2026-11-04T09:00',end:allDay?'2026-11-06':'2026-11-04T10:00',allDay,disabled:false,contextKey:'item:all'})
    const Component={...Week,ssrRender:undefined,render:()=>null,setup(input,context){const value=Week.setup(input,context);value.root.value=root;value.viewport.value=viewport;value.timeGrid.value=timeGrid;value.allDayViewport.value=allDayViewport;value.allDayGrid.value=allDayGrid;setup=value;return value}}
    const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
    const app=renderer.createApp({render:()=>h(Component,{...props,onChange:slot=>changes.push(slot)})})
    app.provide(ssrContextKey,{modules:new Set()});app.mount({});await nextTick()
    t.mock.timers.enable({apis:['setTimeout','Date'],now:1000})
    t.after(()=>{app.unmount();for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}})
    function event(type,target=body,{id=1,x=294,y=418,pointerType='touch'}={}){const e=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({target,currentTarget:target,pointerId:id,pointerType,button:0,clientX:x,clientY:y,detail:1}))Object.defineProperty(e,key,{value});return e}
    const send=(type,target,point)=>{const e=event(type,target,point);document.dispatchEvent(e);return e}
    const down=(mode='move',point={})=>{const target=mode==='move'?body:edge,e=send('pointerdown',target,point);setup.begin(e,!allDay,mode);return e}
    const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(performance.now()+16))}
    return {setup,props,root,viewport,body,edge,changes,send,down,flush,tick:ms=>t.mock.timers.tick(ms),event,app}
  }

  await t.test('timed body hold moves across days using stable capture; release alone emits',async t=>{
    const f=await fixture(t)
    f.down();f.tick(499);assert.equal(f.setup.gesture.value,null)
    f.tick(1);assert.equal(f.setup.touch.mode.value,'armed-edit');assert.ok(f.root.hasPointerCapture(1))
    f.send('pointermove',f.body,{x:394,y:462});f.flush()
    assert.deepEqual(f.setup.preview.value,{start:'2026-11-05T10:00',end:'2026-11-05T11:00',allDay:false});assert.deepEqual(f.changes,[])
    f.send('pointerup',f.body,{x:394,y:462})
    assert.deepEqual(f.changes,[{start:'2026-11-05T10:00',end:'2026-11-05T11:00',allDay:false}]);assert.equal(f.setup.gesture.value,null)
    assert.equal(f.send('click',f.body).defaultPrevented,true)
  })
  await t.test('early swipe scrolls and cannot become an edit or accidental click',async t=>{
    const f=await fixture(t);const before=f.viewport.scrollTop
    f.down();f.tick(50);f.send('pointermove',f.body,{y:380});f.flush();f.tick(600)
    assert.equal(f.setup.touch.mode.value,'pan');assert.equal(f.setup.gesture.value,null);assert.equal(f.viewport.scrollTop,before+38)
    f.send('pointerup',f.body,{y:380});assert.deepEqual(f.changes,[]);assert.equal(f.send('click',f.body).defaultPrevented,true)
  })
  await t.test('timed start and end grips use the same local snap and minimum duration',async t=>{
    const f=await fixture(t)
    f.down('start');f.tick(500);f.send('pointerup',f.edge,{y:429})
    assert.deepEqual(f.changes.pop(),{start:'2026-11-04T09:15',end:'2026-11-04T10:00',allDay:false})
    f.down('end');f.tick(500);f.send('pointerup',f.edge,{y:330})
    assert.deepEqual(f.changes.pop(),{start:'2026-11-04T09:00',end:'2026-11-04T09:15',allDay:false})
  })
  await t.test('all-day move and each edge preserve whole days and exclusive end',async t=>{
    const f=await fixture(t,{allDay:true})
    for(const [mode,x,expected] of [['move',394,{start:'2026-11-05',end:'2026-11-07',allDay:true}],['start',394,{start:'2026-11-05',end:'2026-11-06',allDay:true}],['end',394,{start:'2026-11-04',end:'2026-11-07',allDay:true}]]){
      f.down(mode);f.tick(500);f.send('pointerup',mode==='move'?f.body:f.edge,{x});assert.deepEqual(f.changes.pop(),expected)
    }
  })
  await t.test('DST-invalid pointer transform retains the last valid component preview',async t=>{
    const previous=process.env.TZ;process.env.TZ='Europe/Budapest';t.after(()=>{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous})
    const f=await fixture(t);f.props.start='2026-03-29T01:45';f.props.end='2026-03-29T03:00';await nextTick()
    f.down('start',{x:694,y:77});f.tick(500)
    f.send('pointermove',f.edge,{x:694,y:66});f.flush()
    const valid={start:'2026-03-29T01:30',end:'2026-03-29T03:00',allDay:false};assert.deepEqual(f.setup.preview.value,valid)
    f.send('pointermove',f.edge,{x:694,y:110});f.flush();assert.deepEqual(f.setup.preview.value,valid);assert.deepEqual(f.changes,[])
    f.send('pointerup',f.edge,{x:694,y:110});assert.deepEqual(f.changes,[valid])
  })
  await t.test('second finger, cancellation, lost capture, Escape and new locks revert without emission',async t=>{
    const f=await fixture(t)
    for(const reason of ['second','cancel','lost','escape','disabled','replace','remove','context']){
      f.props.disabled=false;f.props.start='2026-11-04T09:00';f.props.end='2026-11-04T10:00';await nextTick()
      f.down();f.tick(500);f.send('pointermove',f.body,{y:462});f.flush()
      if(reason==='second')f.send('pointerdown',f.body,{id:2,x:330})
      else if(reason==='cancel')f.send('pointercancel',f.body)
      else if(reason==='lost'){f.root.releasePointerCapture(1);f.send('lostpointercapture',f.body)}
      else if(reason==='escape')f.setup.key({key:'Escape',preventDefault(){},stopPropagation(){}})
      else if(reason==='disabled')f.props.disabled=true
      else if(reason==='replace')f.props.start='2026-11-05T09:00'
      else if(reason==='remove')f.props.end=''
      else f.props.contextKey='other-item:space'
      await nextTick();assert.equal(f.setup.gesture.value,null,reason);assert.deepEqual(f.changes,[],reason)
      assert.deepEqual(f.setup.preview.value,{start:f.props.start,end:f.props.end,allDay:false},`${reason}: cancellation restores the form's original draft`)
      f.send('pointerup',f.body);f.send('pointerup',f.body,{id:2});assert.deepEqual(f.changes,[],reason);f.setup.touch.cancel()
    }
  })
  await t.test('mouse and keyboard stay functional; disposal cancels a held preview',async t=>{
    const f=await fixture(t)
    f.setup.begin(f.event('pointerdown',f.body,{pointerType:'mouse'}),true,'move')
    f.setup.finish(f.event('pointerup',f.body,{pointerType:'mouse',y:462}));assert.equal(f.changes.pop().start,'2026-11-04T10:00')
    f.setup.keyboardShift({key:'ArrowDown',preventDefault(){},stopPropagation(){}},'move');assert.equal(f.changes.pop().start,'2026-11-04T09:15')
    f.down();f.tick(500);f.app.unmount();f.send('pointerup',f.body,{y:462});assert.deepEqual(f.changes,[])
  })
  await t.test('actual form keeps stale-source drafts editable and submitted journal payload immutable',async()=>{
    const {default:Form}=await server.ssrLoadModule('/src/ScheduleEventForm.vue'),state=createEmptyState(),schedules=[],props=reactive({record:{id:'card',kind:'card',source:'deck',title:'Prepare draft'},workspace:state.workspace,collections:[{id:'calendar',source:'calendar',title:'Work calendar'}],records:[],relations:[],mode:'create',busy:false,submitted:false,calendarAvailable:false})
    const renderer=createRenderer({insert(){},remove(){},patchProp(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null})
    let setup
    const Component={...Form,render:()=>null,ssrRender:undefined,setup(input,context){return setup=Form.setup(input,context)}}
    const app=renderer.createApp({render:()=>h(Component,{...props,onSchedule:value=>schedules.push(value)})});app.provide(ssrContextKey,{modules:new Set()});app.mount({})
    try{
      const slot={start:'2026-11-04',end:'2026-11-06',allDay:true};setup.chooseSlot(slot)
      assert.equal(setup.draft.value.start,slot.start,'stale availability does not freeze an unsaved local draft');assert.deepEqual(schedules,[])
      props.busy=true;await nextTick();setup.chooseSlot({...slot,start:'2026-11-05'});assert.equal(setup.draft.value.start,slot.start)
      props.busy=false;props.submitted=true;await nextTick();setup.chooseSlot({...slot,end:'2026-11-07'});assert.equal(setup.draft.value.end,slot.end)
      const pending={requestId:'pending',recordId:'card',title:'Saved booking',collectionId:'calendar',start:'2026-10-25T00:30:00.000Z',end:'2026-10-25T01:30:00.000Z',allDay:false,description:'Exact persisted instants'}
      props.submitted=false;props.pending=pending;await nextTick();setup.chooseSlot(slot);setup.submit()
      assert.deepEqual(schedules,[pending],'retry sends the exact journal payload, including repeated-hour instants')
    }finally{app.unmount()}
  })
  const source=await readFile(new URL('../packages/ui/src/SchedulingWeek.vue',import.meta.url),'utf8')
  assert.match(source,/\.week-draft,\.week-draft button\{touch-action:none;user-select:none/)
})
