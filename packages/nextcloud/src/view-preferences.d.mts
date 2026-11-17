import type {ViewPreferencesState,ViewPreferencesInput} from '@nextspace/contracts'
export class ViewPreferencesClient {
  constructor(client:any)
  read():Promise<ViewPreferencesState>
  save(input:ViewPreferencesInput):Promise<ViewPreferencesState>
}
