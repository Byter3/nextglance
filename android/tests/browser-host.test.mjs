import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createBrowserHost} from '../src/browser-host.mjs'

const account={name:'nextspace-direct:fixture',serverUrl:'https://cloud.example.test',username:'fixture'}
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})
function fixture(results){
  const calls=[];let hint=null
  const host=createBrowserHost({
    fetchImpl:async(url,options)=>{calls.push({url,options});return response(url.endsWith('/session')?{token:'x'.repeat(64)}:results.shift())},
    identityStore:{load:async()=>hint,save:async value=>{hint=structuredClone(value)},clear:async()=>{hint=null}},
  })
  return {host,calls,hint:()=>hint}
}
test('preview uses one same-origin session and a JSON token header without passwords',async()=>{
  const {host,calls}=fixture([{account:null},{flowId:'flow',loginUrl:'https://cloud.example.test/login'}])
  await host.getAccount();await host.beginLogin({serverUrl:account.serverUrl})
  assert.equal(calls.filter(call=>call.url.endsWith('/session')).length,1)
  for(const {url,options} of calls){assert.ok(url.startsWith('/__nextglance/'));assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store')}
  const request=calls[2].options
  assert.deepEqual(JSON.parse(request.body),{method:'beginLogin',args:{serverUrl:account.serverUrl}})
  assert.equal(request.headers['X-NextGlance-Token'],'x'.repeat(64))
  assert.equal(request.headers['Content-Type'],'application/json')
  assert.equal('selectAccount' in host,false)
})
test('only validated identity is remembered, and a lost host session retains a reconnect hint',async()=>{
  const {host,hint}=fixture([{account:{...account,appPassword:'must-not-persist'}},{account:null}])
  await host.pollLogin({flowId:'flow'})
  assert.deepEqual(hint(),account)
  assert.deepEqual(await host.getAccount(),{account,reconnectRequired:true})
})
test('explicit disconnect removes the selected identity hint',async()=>{
  const {host,hint}=fixture([{account},{account:null},{account:null}])
  await host.getAccount();await host.disconnect()
  assert.equal(hint(),null)
  assert.deepEqual(await host.getAccount(),{account:null})
})
test('invalid identities never enter storage',async()=>{
  const {host,hint}=fixture([{account:{...account,serverUrl:'file:///secret'}}])
  await assert.rejects(host.getAccount())
  assert.equal(hint(),null)
})
test('expired preview token invalidates next command bootstrap without retrying a mutation',async()=>{
  let sessions=0,commands=0
  const host=createBrowserHost({fetchImpl:async url=>{
    if(url.endsWith('/session')){sessions++;return response({token:String(sessions).repeat(64)})}
    commands++
    return commands===1?response({error:{code:'PREVIEW_SESSION_EXPIRED',message:'Expired token'}},403):response({account:null})
  }})
  await assert.rejects(host.disconnect(),error=>error.code==='PREVIEW_SESSION_EXPIRED'&&/restarted/.test(error.message))
  assert.equal(commands,1)
  await host.getAccount()
  assert.equal(commands,2);assert.equal(sessions,2)
})
test('remote permission failures do not retry or reset the bridge session',async()=>{
  let sessions=0,commands=0
  const host=createBrowserHost({fetchImpl:async url=>{
    if(url.endsWith('/session')){sessions++;return response({token:'x'.repeat(64)})}
    commands++;return response({error:{code:'PERMISSION',message:'Access denied'}},403)
  }})
  await assert.rejects(host.request({url:'/remote.php/dav/'}),error=>error.code==='PERMISSION')
  assert.equal(commands,1)
  await assert.rejects(host.getAccount())
  assert.equal(sessions,1)
})

test('unavailable preview startup restores only its saved identity as requiring authorization',async()=>{
  let saved=structuredClone(account),commands=0
  const host=createBrowserHost({fetchImpl:async()=>{commands++;throw new TypeError('Network unavailable')},identityStore:{load:async()=>saved,save:async()=>{throw new Error('Unexpected save')},clear:async()=>{saved=null}}})
  assert.deepEqual(await host.getAccount(),{account,reconnectRequired:true})
  assert.deepEqual(saved,account);assert.equal(commands,1)
})

test('session expiry restores identity and a subsequent user sign-in bootstraps a fresh token',async()=>{
  let sessions=0,commands=0
  const calls=[],host=createBrowserHost({fetchImpl:async(url,options)=>{
    calls.push({url,options})
    if(url.endsWith('/session'))return response({token:String(++sessions).repeat(64)})
    commands++
    if(commands===1)return response({error:{code:'PREVIEW_SESSION_EXPIRED'}},403)
    return response({flowId:'new-flow',loginUrl:account.serverUrl+'/login'})
  },identityStore:{load:async()=>account,save:async()=>{},clear:async()=>{throw new Error('Unexpected clear')}}})
  assert.deepEqual(await host.getAccount(),{account,reconnectRequired:true})
  assert.equal(commands,1,'No automatic authorization or replay')
  assert.equal((await host.beginLogin({serverUrl:account.serverUrl})).flowId,'new-flow')
  assert.equal(sessions,2);assert.equal(commands,2)
  assert.equal(calls.at(-1).options.headers['X-NextGlance-Token'],'2'.repeat(64))
})
