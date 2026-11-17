import type {DiagnosticInput, DiagnosticSummary} from '@nextspace/contracts'
export const DIAGNOSTIC_ENUMS: Readonly<Record<string, readonly string[]>>
export const DIAGNOSTIC_NUMBERS: readonly string[]
export function sanitizeDiagnosticInput(value: unknown): DiagnosticInput|null
export function createPerformanceDiagnostics(options?:{now?:()=>number; platform?:string; appVersion?:string; canSaveFile?:boolean}):{
 start():DiagnosticSummary; stop(reason?:string):DiagnosticSummary; clear():DiagnosticSummary; summary():DiagnosticSummary; record(event:unknown):void; read():string
}
