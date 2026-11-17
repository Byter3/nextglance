import {computed} from 'vue'
import {sourceColor,recordTags} from '@nextspace/core/record-presentation.mjs'

/** Lazy presentation memoization. Vue tracks in-place native edits as well as
 * replacement snapshots; unopened records do not allocate tag projections. */
export function createRecordPresentation({collections,workspace,fallback}) {
  const colors=computed(()=>new Map(collections().map(collection=>[collection.id,sourceColor({collectionId:collection.id},[collection],fallback())])))
  const properties=computed(()=>workspace()?.properties)
  const tagWorkspace=computed(()=>properties.value?{properties:properties.value}:undefined)
  const tags=new WeakMap()
  return {
    sourceColorFor(record){return colors.value.get(record.collectionId)||sourceColor(record,[],fallback())},
    tagsFor(record){
      let projection=tags.get(record)
      if(!projection){projection=computed(()=>recordTags(record,tagWorkspace.value));tags.set(record,projection)}
      return projection.value
    },
  }
}
