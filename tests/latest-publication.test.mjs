import test from 'node:test'
import assert from 'node:assert/strict'
import {createLatestPublication} from '../packages/ui/src/latest-publication.mjs'
const turn=()=>new Promise(resolve=>setTimeout(resolve,0))
function fixture(adopt,canAdopt=()=>true){const tasks=new Map();let id=0;const queue=createLatestPublication({schedule:run=>{tasks.set(++id,run);return id},cancelScheduled:id=>tasks.delete(id),canAdopt,adopt});return {queue,tasks,run(){const callbacks=[...tasks.values()];tasks.clear();callbacks.forEach(run=>run())}}}
test('a burst performs one adoption of the newest supplied snapshot',async()=>{const seen=[],f=fixture(value=>seen.push(value));for(let n=0;n<100;n++)f.queue.offer(n);assert.equal(f.tasks.size,1);f.run();await turn();assert.deepEqual(seen,[99])})
test('in-flight work retains only latest next publication and captures baseline on drain',async()=>{let release,baseline=0;const seen=[];const f=fixture(async value=>{seen.push([baseline,value]);if(value===1)await new Promise(resolve=>release=resolve);baseline=value});f.queue.offer(1);f.run();f.queue.offer(2);f.queue.offer(3);assert.equal(f.tasks.size,0);release();await turn();f.run();await turn();assert.deepEqual(seen,[[0,1],[1,3]])})
test('blocked operations keep latest publication until explicitly resumed',async()=>{let allowed=false;const seen=[],f=fixture(value=>seen.push(value),()=>allowed);f.queue.offer(1);f.queue.offer(2);assert.equal(f.tasks.size,0);allowed=true;f.queue.resume();f.run();await turn();assert.deepEqual(seen,[2])})
test('account replacement and disposal remove scheduled old snapshots',async()=>{const seen=[],f=fixture(value=>seen.push(value));f.queue.offer(1);f.queue.clear();f.run();f.queue.offer(2);f.queue.dispose();f.run();f.queue.offer(3);await turn();assert.deepEqual(seen,[])})
