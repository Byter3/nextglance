import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createEmptyState} from '@nextspace/core/planner.mjs'
import {eventEditorDraft,eventEditorChanges,eventActionExplanation} from '@nextspace/core/event-editor.mjs'
const {renderToString}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue/server-renderer')
const {createRenderer,createSSRApp,reactive,nextTick,h,ssrContextKey}=createRequire(new URL('../packages/ui/package.json',import.meta.url))('vue')

test('existing event edits preserve omitted dates, alarms and native version',()=>{
  const record={id:'event',title:'Review',kind:'event',source:'calendar',start:'2026-10-25T01:30:00Z',end:'2026-10-25T02:30:00Z',body:'Brief',location:'Office',reminders:[15],unsupportedReminderCount:2,etag:'"one"'},draft=eventEditorDraft(record)
  draft.title='New review';assert.deepEqual(eventEditorChanges(record,draft),{id:'event',etag:'"one"',title:'New review'})
  draft.title=record.title;draft.reminders=[];draft.location='';assert.deepEqual(eventEditorChanges(record,draft),{id:'event',etag:'"one"',location:'',reminders:[]})
  assert.throws(()=>eventEditorChanges(record,{...draft,reminders:[15,15]}),/different reminders/)
})

test('actual calendar forms share defaults, validate edits and preserve frozen legacy retries',async()=>{
  const server=await createServer({root:fileURLToPath(new URL('../packages/ui',import.meta.url)),configFile:false,plugins:[vue()],server:{middlewareMode:true,ws:false},logLevel:'error',optimizeDeps:{noDiscovery:true}}),apps=[]
  const noop=()=>{},renderer=createRenderer({createElement:type=>({type,children:[]}),createText:text=>({text}),createComment:text=>({text}),setText:noop,setElementText:noop,parentNode:()=>null,nextSibling:()=>null,patchProp:noop,insert:noop,remove:noop})
  async function mount(name,props,event){const {default:Component}=await server.ssrLoadModule(`/src/${name}.vue`),Bare={...Component,render:()=>null,ssrRender:undefined};let child;const emitted=[];const app=renderer.createApp({setup:()=>()=>h(Bare,{...props,[event]:value=>emitted.push(structuredClone(value)),ref:value=>{child=value}})});app.provide(ssrContextKey,{modules:new Set()});app.mount({});apps.push(app);await nextTick();return {s:child.$.setupState,emitted}}
  try{
    const state=createEmptyState(),collections=[{id:'calendar',source:'calendar',title:'Calendar',calendarScheduling:{canInvite:true,organizer:{uri:'mailto:owner@example.test'}}}],record={id:'card',kind:'card',source:'deck',title:'Prepare review',collectionTitle:'Work board',url:'https://cloud.example.test/apps/deck/1'}
    const props=reactive({record,workspace:state.workspace,collections,records:[],relations:[],mode:'create',busy:false,submitted:false,calendarAvailable:true})
    const schedule=await mount('ScheduleEventForm',props,'onSchedule')
    assert.deepEqual([...schedule.s.draft.reminders],[15]);assert.match(schedule.s.draft.description,/Scheduled work: Prepare review\nSource: Work board/)
    schedule.s.draft.title='Focus session';schedule.s.draft.description='';schedule.s.draft.location='Studio';schedule.s.draft.reminders=[60,0];schedule.s.draft.attendees=[{email:'guest@example.test',name:'Guest'}];schedule.s.submit()
    const first=schedule.emitted[0];assert.equal(first.title,'Focus session');assert.equal(first.description,'');assert.equal(first.location,'Studio');assert.deepEqual(first.reminders,[0,60]);assert.deepEqual(first.attendees,[{email:'guest@example.test',name:'Guest'}]);assert.equal(record.title,'Prepare review')
    props.submitted=true;await nextTick();schedule.s.draft.title='Ignored';schedule.s.draft.reminders=[];schedule.s.draft.attendees[0].name='Ignored';schedule.s.submit();assert.deepEqual(schedule.emitted[1],first)
    const pending={requestId:'old',recordId:'card',title:'Original',collectionId:'calendar',start:'2026-10-25T01:30:00Z',end:'2026-10-25T02:30:00Z',description:''}
    const legacy=await mount('ScheduleEventForm',{...props,pending,submitted:false},'onSchedule');legacy.s.submit();assert.deepEqual(legacy.emitted[0],pending);assert.equal(Object.hasOwn(legacy.emitted[0],'reminders'),false);assert.equal(Object.hasOwn(legacy.emitted[0],'attendees'),false)
    const create=await mount('CreateItemForm',{collections,initialType:'event',availableTypes:['event'],destinations:{event:'calendar'},initialRange:{start:'2026-11-15',end:'2026-11-16',allDay:true}},'onSubmit')
    assert.deepEqual([...create.s.eventDetails.reminders],[15]);create.s.title='New event';create.s.eventDetails.location='Meeting room';create.s.submit();assert.deepEqual(create.emitted[0].reminders,[15]);assert.equal(create.emitted[0].location,'Meeting room')
    const current=reactive({id:'event',kind:'event',source:'calendar',title:'Existing',collectionId:'calendar',start:'2026-11-15T10:00:00Z',end:'2026-11-15T11:00:00Z',etag:'"v1"',reminders:[30],unsupportedReminderCount:1})
    const edit=await mount('EventDetailsEditor',{record:current,records:[],collections,workspace:state.workspace,busy:false},'onSave')
    edit.s.draft.location='New place';edit.s.submit();assert.deepEqual(edit.emitted[0],{id:'event',etag:'"v1"',location:'New place'})
    current.etag='"v2"';await nextTick();edit.s.submit();assert.equal(edit.emitted.length,1);assert.equal(edit.s.changed,true);assert.equal(edit.s.draft.location,'New place')
    const task=await mount('CreateItemForm',{collections:[{id:'tasks',source:'tasks',title:'Tasks'}],initialType:'task',availableTypes:['task','note'],destinations:{task:'tasks'}},'onSubmit')
    task.s.title='Prepare review';task.s.content='## Checklist\n- [ ] First\n- [x] Second';task.s.submit();assert.equal(task.emitted[0].content,task.s.content);task.s.type='note';await nextTick();task.s.type='task';await nextTick();assert.equal(task.s.content,'## Checklist\n- [ ] First\n- [x] Second')
    const {default:Create}=await server.ssrLoadModule('/src/CreateItemForm.vue');const html=await renderToString(createSSRApp(Create,{collections:[{id:'tasks',source:'tasks',title:'Tasks'}],availableTypes:['task'],initialType:'task',destinations:{task:'tasks'}}));assert.match(html,/formatted editor/);assert.match(html,/deferred-markdown-source/)
    const attendee=await mount('EventAttendees',{modelValue:[],disabled:false},'onUpdate:modelValue');attendee.s.email='guest@example.test';attendee.s.name='Guest';attendee.s.add();assert.deepEqual(attendee.emitted[0],[{email:'guest@example.test',name:'Guest'}]);assert.equal(attendee.s.email,'')
    const invitation={...current,readonly:true,eventScheduling:{role:'attendee',organizer:{uri:'mailto:owner@example.test',name:'Owner'},ownAttendeeUri:'mailto:guest@example.test',attendees:[{uri:'mailto:guest@example.test',name:'Guest <script>',participation:'NEEDS-ACTION',scheduleStatus:'1.2'}]},eventAccess:{editDetails:false,editReminders:true,editAttendees:false,respond:true,delete:false,reason:'not-organizer'},location:'Studio',reminders:[15]}
    const inviteEditor=await mount('EventDetailsEditor',{record:invitation,records:[],collections,workspace:state.workspace,busy:false},'onSave');assert.equal(inviteEditor.s.detailsAllowed,false);assert.equal(inviteEditor.s.remindersAllowed,true);inviteEditor.s.draft.reminders=[30];inviteEditor.s.submit();assert.deepEqual(inviteEditor.emitted[0],{id:'event',etag:'"v2"',reminders:[30]});inviteEditor.s.draft.title='Invalid edit';inviteEditor.s.submit();assert.equal(inviteEditor.emitted.length,1);assert.match(inviteEditor.s.validation,/organizer/)
    const {default:Summary}=await server.ssrLoadModule('/src/EventSummary.vue');const summary=await renderToString(createSSRApp(Summary,{record:invitation,canEdit:true,canRespond:true}));assert.match(summary,/Studio/);assert.match(summary,/15 minutes before/);assert.match(summary,/other native reminders/);assert.match(summary,/Guest &lt;script&gt;/);assert.match(summary,/NEEDS-ACTION/);assert.match(summary,/Accept/);assert.match(summary,/Decline/);assert.match(summary,/Native scheduling status: 1.2/)
    const reminders=await mount('EventReminders',{modelValue:[15],disabled:false},'onUpdate:modelValue');reminders.s.remove(0);assert.deepEqual(reminders.emitted[0],[])
  }finally{apps.forEach(app=>app.unmount());await server.close()}
})

test('event guest edits preserve organizer self-attendance and availability reasons remain specific',()=>{
  const record={id:'event',kind:'event',source:'calendar',title:'Review',start:'2026-11-13T10:00:00Z',end:'2026-11-13T11:00:00Z',eventScheduling:{role:'organizer',organizer:{uri:'mailto:owner@example.test'},attendees:[{uri:'mailto:OWNER@example.test',participation:'ACCEPTED'},{uri:'mailto:guest@example.test',name:'Guest',participation:'ACCEPTED'}]},eventAccess:{editDetails:true,editReminders:true,editAttendees:true,respond:false,delete:true}}
  const draft=eventEditorDraft(record);assert.deepEqual(draft.attendees,[{email:'guest@example.test',name:'Guest'}]);draft.location='Room';assert.deepEqual(eventEditorChanges(record,draft),{id:'event',location:'Room'});draft.attendees.push({email:'second@example.test'});assert.deepEqual(eventEditorChanges(record,draft).attendees,[{email:'guest@example.test',name:'Guest'},{email:'second@example.test'}])
  assert.match(eventActionExplanation(record,{connected:false,implemented:true}),/Connect/)
  assert.match(eventActionExplanation(record,{sourceReady:false,implemented:true,runtimeReady:false}),/Refresh Calendar/)
  assert.match(eventActionExplanation(record,{runtimeReady:false}),/local-cache recovery/)
  assert.match(eventActionExplanation(record,{implemented:false}),/not available in this client/)
  assert.match(eventActionExplanation({...record,eventAccess:{reason:'recurring'}}),/recurring.*Nextcloud/)
})
