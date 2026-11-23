import {createApp} from 'vue'
import type {WorkspaceApi, State} from '@nextspace/contracts'
import type {WidgetConfig,WidgetIntent} from '@nextspace/core/widgets.mjs'
import type {WeekendPreferencesPort} from './useWeekendDays'
import App from './App.vue'
import './style.css'
import './nextcloud.css'
import './approved-layout.css'
import './mobile-host.css'
import './glass-surfaces.css'
// Responsive header/control placement applies after the shared material rules.
import './compact-layout.css'
import './weekend-days.css'

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
  weekendPreferences?: WeekendPreferencesPort
  selectAccount?: () => Promise<State>
  subscribe?: (listener: (state: State) => void) => () => void
  /** Native widgets supply a validated planner destination and optional composer defaults. */
  takeWidgetAction?: () => Promise<{action:WidgetIntent;config:WidgetConfig;accountKey:string;state?:State}|null>
}
export function mountNextspace(api:WorkspaceApi, target:string|Element='#app', options:NextspaceHostOptions={}) {
  return createApp(App,{api,...options,nativeConnection:options.nativeConnection??true}).mount(target)
}
export {App as NextspaceApp}
