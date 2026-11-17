import {checkedViewPreferences,emptyViewPreferences,mergeViewPreferences} from '@nextspace/core/view-preferences.mjs'

const path='view-preferences.json'
const strong=value=>typeof value==='string'&&/^"[^"\r\n]*"$/.test(value)
const problem=(message,code)=>Object.assign(new Error(message),{code})
/** Independent document outside generation inventories; older v1 clients ignore it. */
export class ViewPreferencesClient{
  constructor(client){this.client=client}
  async read(){
    const value=await this.client.readPlannerFile(path)
    if(value.document===null)return {preferences:emptyViewPreferences(),etag:null}
    if(!strong(value.etag))throw problem('Saved filters did not include a safe server version. Existing filters were preserved.','ETAG_UNAVAILABLE')
    return {preferences:checkedViewPreferences(value.document),etag:value.etag}
  }
  async save({base,preferences,etag}){
    base=checkedViewPreferences(base);preferences=checkedViewPreferences(preferences)
    if(etag!==null&&!strong(etag))throw problem('Refresh saved filters before saving.','ETAG_UNAVAILABLE')
    for(let attempt=0;attempt<3;attempt++){
      const latest=await this.read(),merged=mergeViewPreferences(base,preferences,latest.preferences)
      if(merged.conflicts.length)throw problem('These filters changed on another device. Your choices are preserved; reload the shared filters before retrying.','PREFERENCES_CONFLICT')
      if(JSON.stringify(merged.preferences)===JSON.stringify(latest.preferences))return latest
      try{
        await this.client.writePlannerFile(path,merged.preferences,latest.etag)
        const saved=await this.read()
        // A concurrent edit after our acknowledged PUT is legitimate newer state.
        return saved
      }catch(error){if(![error.status,error.statusCode].includes(412)&&error.code!=='CONFLICT'||attempt===2)throw error}
    }
  }
}
