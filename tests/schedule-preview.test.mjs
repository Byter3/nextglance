import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {schedulePreviewBounds,shiftSchedulePreview} from '../packages/core/src/schedule-preview.mjs'
const anchor='2026-11-02',timed={start:'2026-11-04T09:00',end:'2026-11-04T10:00',allDay:false}
test('preview move preserves local interval and snaps pointer displacement to 15 minutes',()=>{
  assert.deepEqual(schedulePreviewBounds(anchor,timed),{first:2.375,last:2+10/24})
  assert.deepEqual(shiftSchedulePreview(anchor,timed,'move',1+20/1440),{start:'2026-11-05T09:15',end:'2026-11-05T10:15',allDay:false})
})
test('start/end resize clamp to minimum 15 minutes; all-day end stays exclusive',()=>{
  assert.deepEqual(shiftSchedulePreview(anchor,timed,'start',2),{...timed,start:'2026-11-04T09:45'})
  assert.deepEqual(shiftSchedulePreview(anchor,timed,'end',-2),{...timed,end:'2026-11-04T09:15'})
  const allDay={start:'2026-11-04',end:'2026-11-06',allDay:true}
  assert.deepEqual(shiftSchedulePreview(anchor,allDay,'move',-1.2),{start:'2026-11-03',end:'2026-11-05',allDay:true})
  assert.deepEqual(shiftSchedulePreview(anchor,allDay,'end',-5),{...allDay,end:'2026-11-05'})
  assert.deepEqual(shiftSchedulePreview(anchor,allDay,'start',5),{...allDay,start:'2026-11-05'})
})
test('invalid ranges and offsets never yield an editable preview',()=>{
  assert.equal(schedulePreviewBounds(anchor,{...timed,end:timed.start}),null)
  assert.equal(shiftSchedulePreview(anchor,{...timed,start:'invalid'},'move',1),null)
  assert.equal(shiftSchedulePreview(anchor,timed,'move',Infinity),null)
})

test('spring gap rejects invalid normalized moves while 23/25-hour calendar days remain valid',()=>{
  const script=`
    import assert from 'node:assert/strict';
    import {shiftSchedulePreview} from ${JSON.stringify(new URL('../packages/core/src/schedule-preview.mjs',import.meta.url).href)};
    assert.equal(shiftSchedulePreview('2026-03-23',{start:'2026-03-29T01:45',end:'2026-03-29T03:00',allDay:false},'start',45/1440),null);
    assert.equal(shiftSchedulePreview('2026-03-23',{start:'2026-03-28T02:15',end:'2026-03-28T03:15',allDay:false},'move',1),null);
    for(const [anchor,start,end,nextStart,nextEnd,hours] of [
      ['2026-03-23','2026-03-28','2026-03-29','2026-03-29','2026-03-30',23],
      ['2026-10-19','2026-10-24','2026-10-25','2026-10-25','2026-10-26',25]
    ]){
      const actual=shiftSchedulePreview(anchor,{start,end,allDay:true},'move',1);
      assert.deepEqual(actual,{start:nextStart,end:nextEnd,allDay:true});
      assert.equal((new Date(actual.end+'T00:00:00')-new Date(actual.start+'T00:00:00'))/3600000,hours);
      assert.deepEqual(shiftSchedulePreview(anchor,{start:start+'T09:00',end:start+'T10:00',allDay:false},'move',1),{start:nextStart+'T09:00',end:nextStart+'T10:00',allDay:false});
    }
  `
  const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{env:{...process.env,TZ:'Europe/Budapest'},encoding:'utf8'})
  assert.equal(child.status,0,child.stderr||child.stdout)
})
