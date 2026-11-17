import {Capacitor} from '@capacitor/core'
import {App} from '@capacitor/app'
import {Network} from '@capacitor/network'
import {createAndroidApi} from './adapter'
import {version} from '../package.json'
import {NATIVE_OPERATIONS} from './native-edits.mjs'

const api = createAndroidApi()
async function mount(){
  try {
    const [{mountNextspace}]=await Promise.all([import('@nextspace/ui'), api.getState()])
    mountNextspace(api, '#app', {
  appVersion: version,
  nativeConnection: true,
  canMutateNative: false,
  nativeOperations: [...NATIVE_OPERATIONS],
  manualConnection: false,
  canExportWorkspace: true,
  mobileHost: true,
  selectAccount: api.isNative ? () => api.selectAccount() : undefined,
  subscribe: listener => api.subscribe(listener),
    })
  }catch{
    const root=document.querySelector('#app')!
    const text=document.createElement('p'),retry=document.createElement('button')
    text.textContent='The interface could not load. Your saved data is preserved.'
    retry.textContent='Retry loading';retry.onclick=()=>{retry.disabled=true;void api.refresh().catch(()=>{});void mount()}
    root.replaceChildren(text,retry)
  }
}
void mount()

if (Capacitor.isNativePlatform()) {
  void App.addListener('appStateChange', ({isActive}) => {
    void api.setAppActive?.(isActive)
    if (isActive) window.dispatchEvent(new Event('nextspace:resume'))
  })
  void Network.addListener('networkStatusChange', ({connected}) => {
    window.dispatchEvent(new CustomEvent('nextspace:network', {detail: {connected}}))
    window.dispatchEvent(new Event(connected ? 'online' : 'offline'))
  })
  void Network.getStatus().then(({connected}) => {
    window.dispatchEvent(new CustomEvent('nextspace:network', {detail: {connected}}))
  })
  void App.addListener('backButton', () => {
    const unhandled = window.dispatchEvent(new CustomEvent('nextspace:back', {cancelable: true}))
    if (unhandled) void App.minimizeApp()
  })
}
