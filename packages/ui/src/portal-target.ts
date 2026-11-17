import {inject, type InjectionKey} from 'vue'
export const portalTargetKey: InjectionKey<string> = Symbol('nextglance-portal-target')
export const usePortalTarget = () => inject(portalTargetKey, 'body')
