import test from 'node:test'
import assert from 'node:assert/strict'
import {calendarTimedLayout,calendarDateWindow,calendarLaneWindow} from '../packages/core/src/calendar-rendering.mjs'

const date=(day,hour=0,minute=0)=>new Date(2026,10,day,hour,minute)
const item=(id,start,end)=>({id,start:+start,end:+end,record:{id,title:id},allDay:false,point:+start===+end,label:'Event',planned:false})

test('indexed timed layout preserves overlapping lanes, minimum height, points and exclusive midnight',()=>{
  const days=[date(12),date(13),date(14)]
  const items=[item('outside',date(10,10),date(10,11)),item('long',date(12,9),date(12,11)),item('short',date(12,9),date(12,10)),item('adjacent',date(12,10),date(12,11)),item('point',date(12,12),date(12,12)),item('near-point',date(12,12,15),date(12,12,30)),item('overnight',date(12,23),date(14)),item('midnight-point',date(14),date(14))]
  const rows=calendarTimedLayout(items,days)
  assert.deepEqual(rows.get(+days[0]).map(({id,from,to,lane,lanes})=>({id,from,to,lane,lanes})),[
    {id:'long',from:540,to:660,lane:0,lanes:2},{id:'short',from:540,to:600,lane:1,lanes:2},{id:'adjacent',from:600,to:660,lane:1,lanes:2},
    {id:'point',from:720,to:720,lane:0,lanes:2},{id:'near-point',from:735,to:750,lane:1,lanes:2},{id:'overnight',from:1380,to:1440,lane:0,lanes:1}
  ])
  assert.deepEqual(rows.get(+days[1]).map(({id,from,to})=>({id,from,to})),[{id:'overnight',from:0,to:1440}])
  assert.deepEqual(rows.get(+days[2]).map(({id,from,to})=>({id,from,to})),[{id:'midnight-point',from:0,to:0}])
  assert.equal(rows.get(+days[0])[0].record,items[1].record,'original record identity stays intact for interaction/permissions')
})

test('scheduling retains its existing 20-minute display minimum while ordinary Calendar keeps actual ends',()=>{
  const days=[date(12)],items=[item('point',date(12,10),date(12,10)),item('next',date(12,10,20),date(12,11))]
  const scheduling=calendarTimedLayout(items,days,{minimumMinutes:20,minimumDuration:20}).get(+days[0])
  assert.deepEqual(scheduling.map(({to,lane,lanes})=>({to,lane,lanes})),[{to:620,lane:0,lanes:1},{to:660,lane:0,lanes:1}])
  assert.equal(calendarTimedLayout(items,days).get(+days[0])[0].to,600)
})

test('local-day indexing survives daylight-saving boundaries in positive and negative zones',()=>{
  const previous=process.env.TZ
  try{for(const zone of ['Europe/Budapest','America/New_York']){
    process.env.TZ=zone
    const first=zone==='Europe/Budapest'?new Date(2026,9,25):new Date(2026,10,1)
    const second=new Date(first);second.setDate(second.getDate()+1)
    const last=new Date(second);last.setDate(last.getDate()+1)
    const projected=calendarTimedLayout([item('span',first,last)],[first,second])
    assert.deepEqual([...projected.values()].map(rows=>rows.map(({from,to})=>[from,to])),[[[0,1440]],[[0,1440]]])
  }}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
})

test('presentation windows are bounded, exclusive and stable within a date/lane',()=>{
  assert.deepEqual(calendarDateWindow({first:7,last:14,days:21}),{first:6,last:15})
  assert.deepEqual(calendarDateWindow({first:0,last:0,days:270}),{first:0,last:8})
  assert.deepEqual(calendarDateWindow({first:269,last:270,days:270}),{first:268,last:270})
  assert.deepEqual(calendarLaneWindow({scrollTop:0,viewportHeight:0,lanes:2000}),{first:0,last:8})
  assert.deepEqual(calendarLaneWindow({scrollTop:310,viewportHeight:160,lanes:2000}),{first:7,last:18})
  assert.deepEqual(calendarLaneWindow({scrollTop:311,viewportHeight:160,lanes:2000}),calendarLaneWindow({scrollTop:310,viewportHeight:160,lanes:2000}))
  assert.deepEqual(calendarLaneWindow({scrollTop:0,viewportHeight:160,lanes:0}),{first:0,last:0})
})

test('date indexing does not rescan every item for every buffered day',()=>{
  const days=Array.from({length:270},(_,index)=>new Date(2026,0,index+1))
  let startReads=0
  const items=Array.from({length:1000},(_,index)=>{
    const start=+days[index%270]+10*3600000
    return {id:String(index),record:{id:String(index)},get start(){startReads++;return start},end:start+3600000}
  })
  const layout=calendarTimedLayout(items,days)
  assert.equal([...layout.values()].reduce((sum,rows)=>sum+rows.length,0),1000)
  assert.ok(startReads<20000,`Indexed one-day items should avoid 270,000 full date scans; observed ${startReads} start reads`)
})
