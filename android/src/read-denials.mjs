import {mergeSourceRefresh} from '@nextspace/core/source-refresh.mjs'
import {SOURCES, problem} from './foundation.mjs'

/** Account-scoped denial fences apply before read data can be restored or published. */
export function applyReadDenials(snapshot, input, serverUrl) {
  if (input === undefined) return snapshot
  if (!Array.isArray(input) || input.length > 10000) throw problem('Saved source access restrictions could not be read.', 'CACHE_UNREADABLE')
  let result = snapshot
  for (const denial of input) {
    if (!denial || !SOURCES.includes(denial.source) || !['AUTH','PERMISSION'].includes(denial.code) || denial.collection !== null && (typeof denial.collection !== 'string' || !denial.collection.startsWith(`${serverUrl}/`))) throw problem('Saved source access restrictions could not be read.', 'CACHE_UNREADABLE')
    const revoked = result.collections.filter(item => item.source === denial.source && (item.remote?.href === denial.collection || item.source === 'deck' && `${serverUrl}/index.php/apps/deck/api/v1.0/boards/${item.remote?.nativeId}` === denial.collection)).map(item => item.id)
    // Public launch checkpoints intentionally omit native locators. Until the
    // private archive resolves the exact collection, hide this source's preview.
    const publicOnly = denial.collection !== null && result.collections.some(item=>item.source===denial.source) && !result.collections.some(item=>item.source===denial.source && item.remote)
    const status = {source:denial.source,state:'error',errorCode:denial.code,message:'Nextcloud denied access. Refresh to verify this source again.',...(denial.collection === null || publicOnly ? {permissionDenied:true} : {revokedCollectionIds:revoked})}
    result = {...result,...mergeSourceRefresh(result,{records:[],collections:[],statuses:[status]},[denial.source])}
  }
  if (input.some(item => ['tasks','calendar'].includes(item.source))) delete result.davCheckpoint
  return result
}
