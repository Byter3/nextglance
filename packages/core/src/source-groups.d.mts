import type {Workspace} from '@nextspace/contracts'
export const sourceGroupPresets:readonly Readonly<{key:string;name:string;color:string;description:string}>[]
export function sourceGroupNameKey(name?:string):string
export function nextSourceGroupDraftId(workspace:Workspace):string
export function commitSourceGroupIds(workspace:Workspace,spaceId:string,newId?:()=>string):Workspace
export function spaceSourceIds(workspace:Workspace,spaceId:string,availableIds?:string[]):string[]
export function sourceGroupNameError(workspace:Workspace,spaceId:string):string
export function reorderSourceGroups(workspace:Workspace,spaceId:string,id:string,delta:number):Workspace
export function addSuggestedGroups(workspace:Workspace,spaceId:string,keys:string[],newId?:()=>string):Workspace
