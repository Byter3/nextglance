import {deviceViewKeys} from './workspace-merge.mjs'

/** Device preference edits must not serialize the full planner/native cache.
 * Unknown or shared keys deliberately retain the normal durable save path. */
export function isDeviceViewPatch(patch){
  return Boolean(patch)&&typeof patch==='object'&&!Array.isArray(patch)&&Object.keys(patch).every(key=>deviceViewKeys.includes(key))
}
