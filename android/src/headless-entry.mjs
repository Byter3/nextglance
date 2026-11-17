import 'fast-text-encoding'
import {URL, URLSearchParams} from 'whatwg-url'
import {prepareHeadlessReadStore} from './headless-read-store.mjs'

globalThis.URL ||= URL
globalThis.URLSearchParams ||= URLSearchParams
// All runtime input/output is validated JSON. No DOM, network, or Activity exists.
globalThis.structuredClone ||= value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
let timer = 0
const scheduled = new Set()
globalThis.setTimeout ||= (callback, delay = 0) => {const id = ++timer; scheduled.add(id); if (delay===0) Promise.resolve().then(()=>{if(scheduled.delete(id))callback()}); return id}
globalThis.clearTimeout ||= id => scheduled.delete(id)
globalThis.nextglanceBackground = async input => prepareHeadlessReadStore(input)
