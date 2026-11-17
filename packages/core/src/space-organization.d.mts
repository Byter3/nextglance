import type {Workspace, Space, Category, Project} from '@nextspace/contracts'
export {sourceGroupPresets} from './source-groups.mjs'
export interface SpaceDraft {
  space:Omit<Space,'id'> & {id?:string}
  groups:(Omit<Category,'id'|'spaceId'> & {id?:string;spaceId?:string})[]
  baseline?:{space:Space;groups:Category[];projects:Project[]}
}
export interface SourceInclusion {collectionId:string;selected:boolean;groups:{id:string;name:string}[];projects:{id:string;name:string}[]}
export type SpaceDraftResult = {ok:true;workspace:Workspace;spaceId:string} | {ok:false;error:string;message:string;affectedProjects?:{id:string;name:string;collectionIds:string[]}[]}
export function spaceSourceInclusions(workspace:Workspace,spaceId:string):SourceInclusion[]
export function createSpaceDraft(workspace:Workspace,spaceId?:string):SpaceDraft
export function addPresetGroupsToDraft(draft:SpaceDraft,keys:string[]):SpaceDraft
export function removeDraftSourceGroup(draft:SpaceDraft,index:number):SpaceDraft
export function assignDraftSourceGroup(draft:SpaceDraft,collectionId:string,groupIndex:number|null):SpaceDraft
export function selectDraftSource(draft:SpaceDraft,collectionId:string,selected:boolean):SpaceDraft
export function saveSpaceDraft(workspace:Workspace,draft:SpaceDraft,options?:{projectSourceRemoval?:'update'|'cancel';newId?:()=>string}):SpaceDraftResult
export function removeSourceGroup(workspace:Workspace,groupId:string):Workspace
export function removeSpace(workspace:Workspace,spaceId:string):Workspace
