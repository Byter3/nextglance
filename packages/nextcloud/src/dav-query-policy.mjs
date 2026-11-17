import {XMLParser, XMLValidator} from 'fast-xml-parser'
import {byteLength} from './runtime.mjs'

const MAX_QUERY_BYTES = 1024 * 1024
const parser = new XMLParser({ignoreAttributes: false, parseTagValue: false, processEntities: false})
const failure = (code, message) => Object.assign(new Error(message), {code})

/** Permit only bounded calendar reads, never arbitrary WebDAV REPORT methods. */
export function checkCalendarQuery(headers, body) {
  if (typeof body !== 'string' || !body.trim()) throw failure('VALIDATION', 'A CalDAV calendar query is required.')
  if (byteLength(body) > MAX_QUERY_BYTES) throw failure('LIMIT', 'The CalDAV calendar query exceeds its size limit.')
  if (!/^(?:application|text)\/xml(?:\s*;|$)/i.test(headers?.['content-type'] || '')) throw failure('VALIDATION', 'CalDAV queries require an XML content type.')
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw failure('SECURITY', 'CalDAV queries cannot contain document types or entity declarations.')
  if (XMLValidator.validate(body) !== true) throw failure('VALIDATION', 'The CalDAV calendar query is not valid XML.')
  let document
  try { document = parser.parse(body) } catch { throw failure('VALIDATION', 'The CalDAV calendar query is not valid XML.') }
  const roots = Object.keys(document).filter(key => !key.startsWith('?'))
  const name = roots[0] || '', match = /^(?:([^:]+):)?(calendar-query|calendar-multiget|sync-collection)$/.exec(name)
  const root = document[name]
  const namespace = match && root?.[`@_xmlns${match[1] ? `:${match[1]}` : ''}`]
  if (roots.length !== 1 || !match || Array.isArray(root) || namespace !== (match[2]==='sync-collection'?'DAV:':'urn:ietf:params:xml:ns:caldav')) throw failure('VALIDATION', 'Only calendar query, multiget and collection sync REPORT reads are supported.')
  if(match[2]==='calendar-query')return
  const fields=new Map()
  for(const [key,value] of Object.entries(root)){
    if(key.startsWith('@_'))continue
    const part=/^(?:([^:]+):)?([^:]+)$/.exec(key),uri=part&&root[`@_xmlns${part[1]?`:${part[1]}`:''}`]
    if(!part||uri!=='DAV:'||fields.has(part[2]))throw failure('VALIDATION','Invalid calendar REPORT member.')
    fields.set(part[2],value)
  }
  const text=value=>typeof value==='string'?value:''
  if(match[2]==='sync-collection'){
    const token=text(fields.get('sync-token'))
    if([...fields.keys()].some(key=>!['sync-token','sync-level','prop'].includes(key))||!token.trim()||token.length>4096||/[\u0000-\u001f]/.test(token)||String(fields.get('sync-level'))!=='1'||!fields.has('prop'))throw failure('VALIDATION','Invalid collection sync REPORT.')
  }else{
    const values=fields.get('href'),hrefs=Array.isArray(values)?values:[values]
    if([...fields.keys()].some(key=>!['href','prop'].includes(key))||!fields.has('prop')||hrefs.length>4||!hrefs.length||hrefs.some(value=>!text(value)||value.length>16384||/[\\\u0000-\u001f]/.test(value))||new Set(hrefs).size!==hrefs.length)throw failure('VALIDATION','Invalid calendar multiget REPORT.')
  }
}
