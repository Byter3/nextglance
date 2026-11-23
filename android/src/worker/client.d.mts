import type {MobileWorkspaceApi} from '../adapter'
export function createWorkerApi(options: {
  createWorker: () => Worker
  effects: Record<string, (...args: any[]) => any>
  isNative: boolean
  hostAvailable?: boolean
  appVersion?: string
  timeZone?: string
  locale?: string
  hint?: unknown
  saveDiagnostics?: (report: string) => Promise<{saved:boolean;cancelled?:boolean;name?:string}>
  copyDiagnostics?: (report: string) => Promise<{copied:boolean}>
  onDiagnosticsChange?: () => void
}): MobileWorkspaceApi
