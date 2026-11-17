import {parentPort} from 'node:worker_threads'
import {installWorkerRuntime} from '../../src/worker/runtime.mjs'
const listeners=new Map()
installWorkerRuntime({postMessage:value=>parentPort.postMessage(value),addEventListener(_type,listener){const wrapped=data=>listener({data});listeners.set(listener,wrapped);parentPort.on('message',wrapped)},removeEventListener(_type,listener){parentPort.off('message',listeners.get(listener))}})
