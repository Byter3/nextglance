import test from 'node:test'
import assert from 'node:assert/strict'
import {shortDate,clockTime,dayKey,dateValue} from '../packages/ui/src/planner-ui.ts'

test('cached planner labels retain native locale output and invalid/date-only behavior',()=>{
  for(const value of ['2035-03-25','2035-10-28T09:30:00Z','2035-01-02T18:05:00+01:00']){
    const date=dateValue(value)
    assert.equal(shortDate(value),dayKey(date)===dayKey(new Date())?'Today':date.toLocaleDateString(undefined,{month:'short',day:'numeric'}))
    assert.equal(clockTime(value),date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}))
  }
  assert.equal(shortDate(dayKey(new Date())),'Today')
  assert.equal(shortDate(undefined),'No date');assert.equal(shortDate('bad date'),'Invalid date')
  assert.equal(clockTime(undefined),'');assert.equal(clockTime('bad date'),'')
})

test('large label batches share formatters while long-running clients refresh the host time zone',()=>{
  const originalDateTimeFormat=Intl.DateTimeFormat,originalNow=Date.now,originalTimezone=process.env.TZ
  let constructors=0,now=0
  Intl.DateTimeFormat=new Proxy(originalDateTimeFormat,{construct(target,args){constructors++;return Reflect.construct(target,args)}})
  Date.now=()=>now
  try{
    process.env.TZ='Europe/Budapest'
    for(let index=0;index<1000;index++){shortDate('2035-01-02');clockTime('2035-01-02T10:30:00Z')}
    assert.equal(constructors,2,'One date and one time formatter serve the complete render batch')
    process.env.TZ='America/New_York';now+=60000
    assert.equal(clockTime('2035-01-02T10:30:00Z'),new Date('2035-01-02T10:30:00Z').toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}))
    assert.equal(constructors,4,'Later renders pick up a changed host time zone')
  }finally{
    Intl.DateTimeFormat=originalDateTimeFormat;Date.now=originalNow
    if(originalTimezone===undefined)delete process.env.TZ;else process.env.TZ=originalTimezone
  }
})
