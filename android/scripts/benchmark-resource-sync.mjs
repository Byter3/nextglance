// Synthetic desktop Node evidence, not Android disk/provider or device timing.
import {performance} from 'node:perf_hooks'
import {NextcloudClient} from '@nextspace/nextcloud-client'
const server='https://fixture.invalid', collection=`${server}/remote.php/dav/calendars/fixture/work/`, count=4962
const entries=Array.from({length:count},(_,index)=>{
  const body=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:fixture-${index}\r\nSUMMARY:Fixture work ${index}\r\nSTATUS:NEEDS-ACTION\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`
  return {version:1,kind:'dav',collection,href:`${collection}${index}.ics`,etag:'"v1"',body,bytes:Buffer.byteLength(body)}
})
const stored=new Map(entries.map(entry=>[entry.href,entry]))
const row=(href,props)=>`<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
const inventory=`<d:multistatus xmlns:d="DAV:">${row(collection,'<d:resourcetype><d:collection/></d:resourcetype>')}${entries.map(entry=>row(entry.href,'<d:resourcetype/><d:getetag>&quot;v1&quot;</d:getetag>')).join('')}</d:multistatus>`
const results=[]
for(const batched of [false,true]){
  let singles=0,batches=0,downloads=0,inventoryReads=0
  const port={get:async key=>{singles++;return structuredClone(stored.get(key.href)||null)},put:async()=>{},remove:async()=>{},prune:async()=>{},retainCollections:async()=>{},clear:async()=>{},...(batched?{getMany:async keys=>{batches++;return keys.map(key=>structuredClone(stored.get(key.href)||null))}}:{})}
  const client=new NextcloudClient({serverUrl:server,username:'fixture'},{authentication:'delegated',resourceCache:port,davReadMode:'propfind-get',now:()=>new Date('2026-11-12T12:00:00Z'),fetch:async(url,options)=>{
    if(options.method==='PROPFIND'){inventoryReads++;return new Response(inventory,{status:207})}
    downloads++;throw new Error('An unchanged warm resource must not download')
  }})
  const started=performance.now(),result=await client.readDav('tasks',[{href:collection,title:'Fixture work',components:['VTODO','VEVENT'],readonly:false}])
  if(result.records.length!==count||result.warning||downloads)throw new Error('Benchmark correctness failed')
  results.push({batchLookup:batched,resources:count,records:result.records.length,inventoryReads,singleCacheCalls:singles,batchCacheCalls:batches,unchangedBodyDownloads:downloads,elapsedMs:Math.round((performance.now()-started)*100)/100})
}
process.stdout.write(JSON.stringify({environment:'desktop Node synthetic in-memory cache; no device claim',results},null,2)+'\n')
