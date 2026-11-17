import {mountNextspace} from '@nextspace/ui'
import type {WorkspaceApi} from '@nextspace/contracts'
import {createBrowserApi} from './browser'
import {version as appVersion} from '../package.json'

const missingBridge=window.location.protocol==='file:'&&!window.workspaceApi
const nativeConnection=Boolean(window.workspaceApi)||missingBridge
const api:WorkspaceApi=window.workspaceApi||(missingBridge
  ?new Proxy({} as WorkspaceApi,{get:()=>async()=>{throw new Error('The desktop connection bridge did not load. Your saved account is unchanged. Close and reopen NextGlance.')}})
  :createBrowserApi())
mountNextspace(api,'#app',{nativeConnection,appVersion})
