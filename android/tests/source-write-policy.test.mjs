import test from 'node:test'
import assert from 'node:assert/strict'
import {checkNativeWrite} from '../src/source-write-policy.mjs'
import {createSsoFetch, transportCapabilities} from '../src/transport.mjs'
import {checkedRequest, publicResponseHeaders} from '../dev/preview-policy.mjs'

const account = {name: 'fixture', serverUrl: 'https://cloud.example.test/nextcloud', username: 'tester'}
const base = account.serverUrl
const edits = {nativeEdits: 'notes-dates-scheduling'}
const json = {'content-type': 'application/json'}
const version = {...json, 'if-match': '"current"'}
const note = `${base}/index.php/apps/notes/api/v1/notes`
const calendar = `${base}/remote.php/dav/calendars/shared-owner/shared/event.ics`
const event = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fixture\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
const deck = `${base}/index.php/apps/deck/api/v1.0/boards/1/stacks/2/cards/3`
const card = {title: 'Card', type: 'plain', owner: 'tester', description: 'Text', order: 0, startdate: null, duedate: '2026-11-12T09:00:00Z', archived: false, done: null, color: null}
const check = (url, method, headers, body) => checkNativeWrite(account, url, method, headers, body)
const nativeResponse = (url, status = 200) => ({url, status, headers: {}, bodyBase64: ''})

test('native writes require explicit capability independent of REPORT support', async () => {
  const calls = [], native = {request: async input => {calls.push(input); return nativeResponse(input.url)}}
  const request = {method: 'PUT', headers: version, body: '{"content":"Edited"}'}
  for (const capabilities of [undefined, {}, {davReadMode: 'report'}, {nativeEdits: true}, {nativeEdits: 'all'}]) {
    assert.equal(transportCapabilities(capabilities).nativeEdits, undefined)
    await assert.rejects(createSsoFetch(native, account, capabilities)(`${note}/1`, request), {code: 'SECURITY'})
  }
  for (const davReadMode of ['report', 'propfind-get']) {
    const capabilities = transportCapabilities({...edits, davReadMode})
    assert.deepEqual(capabilities, {...edits, davReadMode})
    await createSsoFetch(native, account, capabilities)(`${note}/1`, request)
  }
  assert.equal(calls.length, 2)
})

test('Notes admit bounded creates and conditional field-only conflict retry patches', () => {
  check(note, 'POST', json, JSON.stringify({title: 'Note', content: '# Text', category: ''}))
  check(`${note}/1`, 'PUT', version, '{"content":"Field-only retry"}')
  check(`${note}/1`, 'PUT', version, '{"title":"Renamed","category":"Clients/Studio"}')
  for (const body of ['{}', '[]', '{"favorite":true}', '{"title":42}', '{"title":" "}', '{"category":"line\\nbreak"}', JSON.stringify({content: 'x'.repeat(500001)})]) assert.throws(() => check(`${note}/1`, 'PUT', version, body), {code: 'VALIDATION'})
  for (const headers of [json, {...version, 'if-match': 'W/"weak"'}, {...version, 'if-match': '*'}, {...version, 'if-none-match': '*'}]) assert.throws(() => check(`${note}/1`, 'PUT', headers, '{"content":"Text"}'), {code: 'VALIDATION'})
  for (const url of [`${note}/0`, `${note}/1/extra`, `${note}/1?force=1`, note.replace('cloud.example.test', 'other.example.test'), `${base}/outside/../index.php/apps/notes/api/v1/notes/1`]) assert.throws(() => check(url, 'PUT', version, '{"content":"Text"}'), {code: 'SECURITY'})
  assert.throws(() => check(`${note}/1`, 'DELETE', {}, undefined), {code: 'SECURITY'})
})

test('Files tags permit visible assignable creation and assignment-only deletion', () => {
  const tags = `${base}/remote.php/dav/systemtags/`, assignment = `${base}/remote.php/dav/systemtags-relations/files/12/34`
  check(tags, 'POST', json, JSON.stringify({name: 'Freelance', userVisible: true, userAssignable: true}))
  check(assignment, 'PUT', {}, ''); check(assignment, 'DELETE', {}, undefined)
  for (const value of [{name: 'Hidden', userVisible: false, userAssignable: true}, {name: 'é'.repeat(33), userVisible: true, userAssignable: true}, {name: 'Tag', userVisible: true, userAssignable: true, id: 3}]) assert.throws(() => check(tags, 'POST', json, JSON.stringify(value)), {code: 'VALIDATION'})
  for (const target of [`${tags}34`, `${base}/remote.php/dav/files/tester/Notes/a.md`, `${assignment}/extra`]) assert.throws(() => check(target, 'DELETE', {}, undefined), {code: 'SECURITY'})
  assert.throws(() => check(assignment, 'PUT', json, '{}'), {code: 'VALIDATION'})
})

test('calendar date writes preserve strong update/create conditions and shared-calendar locators', () => {
  const create = {'content-type': 'text/calendar; charset=utf-8', 'if-none-match': '*'}
  const update = {'content-type': 'text/calendar', 'if-match': '"current"'}
  check(calendar, 'PUT', create, event)
  check(calendar, 'PUT', update, event.replaceAll('VEVENT', 'VTODO'))
  for (const headers of [{'content-type': 'text/calendar'}, {...update, 'if-match': 'W/"weak"'}, {...create, 'if-match': '"current"'}, {...create, 'content-type': 'application/json'}]) assert.throws(() => check(calendar, 'PUT', headers, event), {code: 'VALIDATION'})
  assert.throws(() => check(calendar.replace('event.ics', ''), 'PUT', create, event), {code: 'SECURITY'})
  assert.throws(() => check(calendar, 'PUT', create, '{}'), {code: 'VALIDATION'})
  assert.throws(() => check(calendar, 'PUT', create, event + 'é'.repeat(4 * 1024 * 1024)), {code: 'LIMIT'})
  assert.throws(() => check(calendar, 'DELETE', {}, undefined), {code: 'VALIDATION'})
})

test('preview and SSO retain same-origin principal/outbox discovery without a mail-post endpoint',async()=>{
  const principal=`${base}/remote.php/dav/principals/users/tester/`,outbox=`${base}/remote.php/dav/calendars/tester/outbox/`
  const body='<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-user-address-set/><c:schedule-outbox-URL/><d:owner/><d:current-user-privilege-set/></d:prop></d:propfind>'
  for(const url of [principal,outbox]) {
    const input={accountName:account.name,url,method:'PROPFIND',headers:{Depth:'0','Content-Type':'application/xml'},body}
    assert.equal(checkedRequest(account,input).url,url)
    const calls=[],fetch=createSsoFetch({request:async value=>{calls.push(value);return nativeResponse(value.url,207)}},account,{...edits,davReadMode:'propfind-get'})
    await fetch(url,input);assert.equal(calls.length,1)
    assert.throws(()=>checkedRequest(account,{...input,url:url.replace('cloud.example.test','other.example.test')}),{code:'SECURITY'})
    await assert.rejects(fetch(url,{method:'POST',headers:{'Content-Type':'text/calendar'},body:event}),{code:'SECURITY'})
  }
})

test('Deck current-card representation leaves unrelated operations unavailable', () => {
  check(deck, 'PUT', json, JSON.stringify(card))
  check(deck, 'PUT', {...json, 'if-match': 'opaque-deck-version'}, JSON.stringify(card))
  for (const body of [{duedate: null}, {...card, archived: 1}, {...card, stackId: 4}]) assert.throws(() => check(deck, 'PUT', json, JSON.stringify(body)), {code: 'VALIDATION'})
  for (const suffix of ['/attachments', '/dependencies']) assert.throws(() => check(deck + suffix, 'PUT', json, JSON.stringify(card)), {code: 'SECURITY'})
  for (const suffix of ['/reorder', '/assignLabel']) assert.throws(() => check(deck + suffix, 'PUT', json, JSON.stringify(card)), {code: 'VALIDATION'})
  assert.throws(() => check(deck, 'DELETE', {}, undefined), {code: 'SECURITY'})
})

test('Deck dependency, stack and label endpoints accept only their exact bounded representation',()=>{
 for(const method of ['POST','DELETE'])check(deck+'/dependentCards/4',method,version,undefined)
 check(deck.replace('/stacks/2/','/stacks/6/')+'/reorder','PUT',version,'{"stackId":6,"order":99999}')
 assert.throws(()=>check(deck+'/reorder','PUT',version,'{"stackId":6,"order":99999}'),{code:'VALIDATION'})
 for(const suffix of ['assignLabel','removeLabel'])check(deck+'/'+suffix,'PUT',json,'{"labelId":20}')
 const labels=base+'/index.php/apps/deck/api/v1.0/boards/1/labels'
 check(labels,'POST',json,'{"title":"Project","color":"4488aa"}')
 for(const [target,method,body] of [[deck+'/dependentCards/4','POST','{}'],[deck+'/reorder','PUT','{"stackId":6,"order":1}'],[deck+'/assignLabel','PUT','{"labelId":"20"}'],[labels,'POST','{"title":"Project","color":"#4488aa"}']])assert.throws(()=>check(target,method,json,body),{code:'VALIDATION'})
 for(const suffix of ['/x/dependentCards/4','/x/reorder','/dependentCards/0','/dependentCards/4?force=1'])assert.throws(()=>check(deck+suffix,'POST',json,undefined),{code:'SECURITY'})
 for(const headers of [{...json,'if-match':'*'},{...json,'if-none-match':'*'}])assert.throws(()=>check(deck+'/dependentCards/4','DELETE',headers,undefined),{code:'VALIDATION'})
})

test('Deck file detach accepts only the typed v1.1 member through both JS transport boundaries', async () => {
  const attachments=deck.replace('/api/v1.0/','/api/v1.1/')+'/attachments'
  const file=`${attachments}/file/4`,calls=[]
  const fetch=createSsoFetch({request:async input=>{calls.push(input);return nativeResponse(input.url,204)}},account,edits)
  const input={accountName:account.name,url:file,method:'DELETE',headers:{}}
  assert.equal(checkedRequest(account,input).method,'DELETE')
  await fetch(file,input)
  assert.equal(calls.length,1)
  for(const target of [`${attachments}/4?type=file`,`${attachments}/deck_file/4`,`${file}?type=file`,`${file}/extra`,`${base}/remote.php/dav/files/tester/Notes/brief.md`]){
    assert.throws(()=>checkedRequest(account,{...input,url:target}),{code:'SECURITY'})
    await assert.rejects(fetch(target,input),{code:'SECURITY'})
  }
  assert.throws(()=>check(file,'DELETE',{},'{}'),{code:'VALIDATION'})
})

test('preview independently checks the same source writes and exposes tag creation location safely', () => {
  const input = {accountName: account.name, url: `${note}/1`, method: 'PUT', headers: {'Content-Type': 'application/json', 'If-Match': '"current"'}, body: '{"content":"Saved"}'}
  assert.equal(checkedRequest(account, input).method, 'PUT')
  assert.throws(() => checkedRequest(account, {...input, accountName: 'different'}), {code: 'CANCELLED'})
  assert.throws(() => checkedRequest(account, {...input, headers: {...input.headers, Authorization: 'private'}}), {code: 'SECURITY'})
  assert.throws(() => checkedRequest(account, {...input, method: 'DELETE'}), {code: 'SECURITY'})
  const headers = publicResponseHeaders(new Headers({Location: '/nextcloud/remote.php/dav/systemtags/34', 'Content-Location': '/nextcloud/remote.php/dav/systemtags/34', 'Set-Cookie': 'private'}))
  assert.equal(headers.location, '/nextcloud/remote.php/dav/systemtags/34')
  assert.equal(headers['content-location'], headers.location)
  assert.equal(headers['set-cookie'], undefined)
})

test('actual SSO error status survives without inventing a conflict response body', async () => {
  for (const status of [404, 409, 412]) {
    const fetch = createSsoFetch({request: async input => ({...nativeResponse(input.url, status), statusSource: 'sso-error'})}, account, edits)
    const response = await fetch(`${note}/1`, {method: 'PUT', headers: version, body: '{"content":"Edited"}'})
    assert.equal(response.status, status)
    assert.equal(await response.text(), '')
    assert.equal(response.headers.get('etag'), null)
  }
})


test('Deck creation permits only bounded native fields and optional self assignment on both transports',async()=>{
 const url=deck.slice(0,-2),body={title:'New card',type:'plain',order:99999,description:'- [ ] Native checklist',startdate:null,duedate:'2030-06-12T09:00:00.000Z',users:[{id:account.username,type:0}]}
 check(url,'POST',json,JSON.stringify(body));check(url,'POST',json,JSON.stringify({...body,users:[]}))
 for(const override of [{title:''},{title:'x'.repeat(256)},{description:'x'.repeat(500001)},{description:'bad\0body'},{type:'other'},{order:1},{startdate:'invalid'},{users:[{id:'another',type:0}]},{users:[{id:account.username,type:1}]},{users:[{id:account.username,type:0,extra:true}]},{users:null},{owner:'another'}])assert.throws(()=>check(url,'POST',json,JSON.stringify({...body,...override})),{code:'VALIDATION'})
 assert.throws(()=>check(url,'POST',version,JSON.stringify(body)),{code:'VALIDATION'})
 for(const target of [deck,url+'?force=1',url.replace('/boards/1/','/boards/0/')])assert.throws(()=>check(target,'POST',json,JSON.stringify(body)))
 assert.equal(checkedRequest(account,{accountName:account.name,url,method:'POST',headers:json,body:JSON.stringify(body)}).method,'POST')
 const calls=[],fetch=createSsoFetch({request:async input=>{calls.push(input);return nativeResponse(input.url)}},account,{...edits,davReadMode:'propfind-get'})
 await fetch(url,{method:'POST',headers:json,body:JSON.stringify(body)});assert.equal(calls.length,1)
})
