import type {Workspace} from '@nextspace/contracts'
export const deviceViewKeys:string[]
export function withDeviceViewPreferences(workspace:Workspace,device:Workspace):Workspace
export function alignWorkspaceIdentities(workspace:Workspace,reference:Workspace):Workspace
export function mergeWorkspaces(base:Workspace,local:Workspace,remote:Workspace):{workspace:Workspace;conflicts:string[]}
