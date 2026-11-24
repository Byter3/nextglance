import {createPreviewAttachments} from './preview-attachments.mjs'
import {Capacitor, registerPlugin} from '@capacitor/core'
import {Browser} from '@capacitor/browser'
import type {State, Workspace, WorkspaceApi, DeviceSync, DeviceSyncSettings} from '@nextspace/contracts'
import {createBrowserCacheFiles} from './browser-cache-files.mjs'
import {createWorkerApi} from './worker/client.mjs'
import {Network} from '@capacitor/network'
import {createLaunchHints} from './launch-hints.mjs'
import packageInfo from '../package.json'
import {checkedPlannerExport, savePlannerInBrowser} from './planner-export.mjs'
import type {WidgetConfig,WidgetIntent} from '@nextspace/core/widgets.mjs'
let hintStorage: Storage | undefined
try {hintStorage = window.localStorage} catch { /* Disabled browser storage is optional. */ }
export const launchHints = createLaunchHints(hintStorage)

export interface MobileDeviceState {
  scopeId?: string
  scopePreferencesVersion?: 2
  scopes?: Record<string, Record<string, unknown> & {query?:string; source?:string; showClosed?:boolean}>
}
export interface MobileAccountIdentity {serverUrl: string; username: string}
export interface MobileState extends State {
  metadata: {ready: boolean}
  deviceState: MobileDeviceState
}
export interface MobileWorkspaceApi extends WorkspaceApi {
  takeWidgetAction():Promise<{action:WidgetIntent;config:WidgetConfig;accountKey:string;state?:State}|null>
  isNative: boolean
  subscribe(listener: (state: MobileState) => void): () => void
  dispose(): void
  getState(): Promise<MobileState>
  refresh(): Promise<MobileState>
  selectAccount(): Promise<MobileState>
  disconnect(): Promise<MobileState>
  syncWorkspace(): Promise<MobileState>
  saveWorkspace(workspace: Workspace, expectedRevision: number, expectedAccount?: MobileAccountIdentity, options?: {coalesceLaunch?: boolean}): Promise<{workspace: Workspace; revision: number; storage: State['storage']}>
  resolveWorkspaceConflict(choice: 'local'|'remote', expectedRevision: number, expectedAccount: MobileAccountIdentity): Promise<MobileState>
  saveDeviceState(deviceState: MobileDeviceState, expectedAccount?: MobileAccountIdentity): Promise<MobileState>
}
interface SsoAccount { name: string; serverUrl: string; username: string }
interface HostCapabilities {davReadMode: 'report'|'propfind-get'; nativeEdits?: 'notes-dates-scheduling'}
interface HostAccountResult {account: SsoAccount|null; capabilities?: HostCapabilities; authorizationMethod?: 'files'|'direct'}
interface SsoPlugin {
  cacheFile(options:Record<string,unknown>):Promise<Record<string,unknown>>
  chooseAttachment(options:{accountName:string}):Promise<unknown>
  uploadAttachment(options:Record<string,unknown>):Promise<unknown>
  saveDiagnostics(options:{report:string}):Promise<{saved:boolean;cancelled?:boolean;name?:string}>
  exportPlanner(options:{document:string}):Promise<{exported:boolean}>
  copyDiagnostics(options:{report:string}):Promise<{copied:boolean}>
  beginLogin(options: {serverUrl: string; expectedAccount?: SsoAccount}): Promise<{flowId: string; loginUrl: string}>
  pollLogin(options: {flowId: string}): Promise<{pending: true}|({pending: false} & HostAccountResult)>
  cancelLogin(options: {flowId?: string}): Promise<HostAccountResult>
  getAccount(): Promise<HostAccountResult & {reconnectRequired?: boolean; restoreError?: string; recoveryOnly?: boolean}>
  getSavedAccount(): Promise<HostAccountResult>
  resourceCache(options: {accountName: string; operation: string; [key: string]: unknown}): Promise<{entry?: unknown;entries?:unknown[]}>
  configureSync(options: {accountName: string; settings: DeviceSyncSettings}): Promise<{background: DeviceSync['background']}>
  getSyncState(options: {accountName: string}): Promise<{background: DeviceSync['background']}>
  confirmSourceReads(options: {accountName: string; sources: string[]}): Promise<unknown>
  selectAccount(): Promise<HostAccountResult>
  disconnect(): Promise<void>
  request(options: {accountName: string; url: string; method: string; headers: Record<string, string>; body?: string; maxBytes: number}): Promise<{status: number; url: string; headers: Record<string, string>; bodyBase64: string}>
}
const native = registerPlugin<SsoPlugin>('NextcloudSso')
const widgets=registerPlugin<{state(options:Record<string,unknown>):Promise<unknown>;publish(options:Record<string,unknown>):Promise<unknown>;consumeAction(options:Record<string,unknown>):Promise<unknown>}>('NextGlanceWidgets')

export function createAndroidApi(): MobileWorkspaceApi {
  const isNative=Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android'
  const cacheFiles = isNative ? {} : createBrowserCacheFiles()
  const previewAttachments=isNative?undefined:createPreviewAttachments()
  const effects:Record<string,(...args:any[])=>any>={
    ...Object.fromEntries(['state','publish','consumeAction'].map(name=>[`widgets.${name}`,(args:Record<string,unknown>)=>(widgets as any)[name](args)])),
    ...Object.fromEntries(['cacheFile','chooseAttachment','uploadAttachment','getAccount','getSavedAccount','selectAccount','disconnect','beginLogin','pollLogin','cancelLogin','request','resourceCache','configureSync','getSyncState','confirmSourceReads'].map(name=>[`native.${name}`,(...args:any[])=>(native as any)[name](...args)])),
    ...Object.fromEntries(Object.entries(cacheFiles).map(([name,operation])=>[`files.${name}`,operation])),
    ...(!isNative?{'native.chooseAttachment':(args:any)=>previewAttachments!.chooseAttachment(args),'native.uploadAttachment':(args:any)=>previewAttachments!.uploadAttachment(args)}:{}),
    'network.status':()=>isNative?Network.getStatus():Promise.resolve({connected:navigator.onLine,connectionType:'unknown'}),
    'browser.open':async(url:string)=>{if(isNative)await Browser.open({url});else window.open(url,'_blank','noopener,noreferrer')},
    'hints.save':(key:string,theme:unknown)=>launchHints.save(key,theme),
    'hints.clear':(key?:string)=>launchHints.clear(key),
    'planner.export':(document:string)=>isNative?native.exportPlanner({document:checkedPlannerExport(document)}):savePlannerInBrowser(document),
  }
  return createWorkerApi({createWorker:()=>new Worker(new URL('./controller.worker.ts',import.meta.url),{type:'module',name:'nextglance-data'}),
    effects,isNative,hostAvailable:isNative||import.meta.env.DEV,appVersion:packageInfo.version,hint:launchHints.snapshot(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,locale:navigator.language,
    onDiagnosticsChange:()=>window.dispatchEvent(new Event('nextspace:diagnostics')),
    saveDiagnostics:isNative?(report:string)=>native.saveDiagnostics({report}):async(report:string)=>{
      const url=URL.createObjectURL(new Blob([report],{type:'application/json'})),anchor=document.createElement('a'),name=`NextGlance-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}.json`
      anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return {saved:true,name}
    },
    copyDiagnostics:isNative?(report:string)=>native.copyDiagnostics({report}):async(report:string)=>{await navigator.clipboard.writeText(report);return {copied:true}},
  }) as MobileWorkspaceApi
}
