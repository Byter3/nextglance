import {createApp} from 'vue'
import type {WorkspaceApi, State} from '@nextspace/contracts'
import App from './App.vue'
import './style.css'
import './nextcloud.css'
import './approved-layout.css'
import './mobile-host.css'
import './glass-surfaces.css'
// Responsive header/control placement applies after the shared material rules.
import './compact-layout.css'

/** Hosts own authentication, storage, networking and native dialogs. */
export interface NextspaceHostOptions {
  /** Embedded Nextcloud session: host owns auth, theme, and private storage. */
  sessionHost?: boolean
  sessionReadOnly?: boolean
  portalTarget?: string
  sourceUrl?: string
  appVersion?: string
  nativeConnection?: boolean
  manualConnection?: boolean
  canMutateNative?: boolean
  nativeOperations?: readonly (keyof WorkspaceApi)[]
  canExportWorkspace?: boolean
  mobileHost?: boolean
  selectAccount?: () => Promise<State>
  subscribe?: (listener: (state: State) => void) => () => void
}
export function mountNextspace(api:WorkspaceApi, target:string|Element='#app', options:NextspaceHostOptions={}) {
  return createApp(App,{api,...options,nativeConnection:options.nativeConnection??true}).mount(target)
}
export {App as NextspaceApp}
