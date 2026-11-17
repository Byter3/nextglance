import test from 'node:test'
import assert from 'node:assert/strict'
import {dragRecordDateDraft,recordDateDraft,recordDateGeometry,recordDatePayload,selectRecordDateRange} from '@nextspace/core/record-date-editor.mjs'

const task={id:'task',source:'tasks',kind:'task',title:'A task'}
const card={id:'card',source:'deck',kind:'card',title:'A card'}
const event={id:'event',source:'calendar',kind:'event',title:'An event'}

test('undated tasks and cards have an editable blank draft and explicit date removal payload',()=>{
  assert.deepEqual(recordDateDraft(task),{start:'',end:'',allDay:true})
  assert.deepEqual(recordDatePayload(task,recordDateDraft(task)),{start:'',due:''})
  assert.deepEqual(recordDatePayload(card,recordDateDraft(card)),{start:'',due:''})
  assert.deepEqual(recordDateDraft({...task,due:'2026-11-04'}),{start:'',end:'2026-11-04',allDay:true})
})

test('range selection supports forward and reverse spans, with due-only single-day VTODO',()=>{
  const blank=recordDateDraft(task)
  assert.deepEqual(selectRecordDateRange(task,blank,'2026-11-07','2026-11-04'),{start:'2026-11-04',end:'2026-11-07',allDay:true})
  const single=selectRecordDateRange(task,blank,'2026-11-04','2026-11-04')
  assert.deepEqual(recordDatePayload(task,single),{start:'',due:'2026-11-04'})
  const cardSingle=selectRecordDateRange(card,blank,'2026-11-04','2026-11-04')
  const cardPayload=recordDatePayload(card,cardSingle)
  assert.equal(new Date(cardPayload.start).getHours(),0)
  assert.equal(new Date(cardPayload.due).getHours(),23)
  assert.equal(new Date(cardPayload.due).getMinutes(),59)
})

test('event selection uses exclusive end dates while work deadlines include their day',()=>{
  const selected=selectRecordDateRange(event,{start:'',end:'',allDay:true},'2026-11-03','2026-11-05')
  assert.deepEqual(recordDatePayload(event,selected),{start:'2026-11-03',end:'2026-11-06',allDay:true})
  const geometry=recordDateGeometry({...event,...recordDatePayload(event,selected)},'2026-11-01',14)
  assert.equal(geometry.left,2/14*100)
  assert.equal(geometry.width,3/14*100)
  assert.equal(recordDateGeometry({...task,start:'2026-11-03',due:'2026-11-05'},'2026-11-01',14).width,3/14*100)
})

test('dragging due-only and start-only endpoints adds a valid opposite bound',()=>{
  assert.deepEqual(dragRecordDateDraft(task,{start:'',end:'2026-11-05',allDay:true},'start',-2),{start:'2026-11-03',end:'2026-11-05',allDay:true})
  assert.deepEqual(dragRecordDateDraft(task,{start:'2026-11-03',end:'',allDay:true},'end',2),{start:'2026-11-03',end:'2026-11-05',allDay:true})
  const range={start:'2026-11-03',end:'2026-11-05',allDay:true}
  assert.deepEqual(dragRecordDateDraft(task,range,'start',2),range,'Cannot invert or collapse DATE VTODO bounds')
  assert.deepEqual(dragRecordDateDraft(task,range,'move',3),{start:'2026-11-06',end:'2026-11-08',allDay:true})
})

test('timed movement preserves hours, minutes, seconds and unchanged native instants',()=>{
  const original={...card,start:new Date(2026,10,3,9,17,32).toISOString(),due:new Date(2026,10,5,17,47,52).toISOString()}
  const draft=recordDateDraft(original)
  assert.deepEqual(recordDatePayload(original,draft),{start:original.start,due:original.due})
  const moved=dragRecordDateDraft(original,draft,'move',2),payload=recordDatePayload(original,moved)
  assert.equal(new Date(payload.start).getDate(),5)
  assert.equal(new Date(payload.start).getHours(),9)
  assert.equal(new Date(payload.start).getSeconds(),32)
  assert.equal(new Date(payload.due).getHours(),17)
  assert.equal(new Date(payload.due).getSeconds(),52)
})

test('invalid dates and impossible ranges never yield a native save payload',()=>{
  assert.throws(()=>recordDatePayload(task,{start:'2026-02-30',end:'',allDay:true}),/valid dates/)
  assert.throws(()=>recordDatePayload(task,{start:'2026-11-05',end:'2026-11-05',allDay:true}),/one-day task/)
  assert.throws(()=>recordDatePayload(card,{start:'2026-11-05T10:00',end:'2026-11-05T09:00',allDay:false}),/after/)
  assert.throws(()=>recordDatePayload(event,{start:'2026-11-05',end:'',allDay:true}),/both/)
})

test('geometry clips context across the visible dates and omits out-of-range records',()=>{
  assert.deepEqual(recordDateGeometry({...task,start:'2026-10-28',due:'2026-11-18'},'2026-11-01',14),{left:0,width:100,clippedStart:true,clippedEnd:true})
  assert.equal(recordDateGeometry({...task,due:'2026-12-01'},'2026-11-01',14),null)
  assert.equal(recordDateGeometry(task,'2026-11-01',14),null)
})
