import type {Workspace,WorkspaceRecord,Relation,WorkspaceApi,State} from '@nextspace/contracts'
export interface CardTaskReceipt {version:1;requestId:string;collectionId:string;title:string;description:string;completed:boolean;start?:string;due?:string;checklist?:{text:string;occurrence:number};taskIdentityKey?:string}
export interface CardTaskEntry {key:string;receipt:CardTaskReceipt}
export interface ChecklistTaskCandidate {key:string;title:string;text:string;occurrence:number;completed:boolean;state:'new'|'existing'|'unavailable'|'ambiguous'|'invalid';taskIdentityKey?:string;message?:string}
export function normalizeTaskLabel(value:unknown):string
export function taskCreationOptions(input:{requestId?:unknown;completed?:unknown}):{requestId?:string;completed?:boolean}
export function cardTaskRequestId(nativeKey:string,key:string):Promise<string>
export function validateCardTaskReceipts(value:unknown):Record<string,CardTaskReceipt>
export function checklistTaskCandidates(input:{card:WorkspaceRecord;workspace:Workspace;records:WorkspaceRecord[];relations?:Relation[]}):Promise<ChecklistTaskCandidate[]>
export function prepareCardTask(input:{card:WorkspaceRecord;workspace:Workspace;collectionId:string;title?:string;description?:string;start?:string;due?:string;completed?:boolean;candidate?:ChecklistTaskCandidate;requestId?:string}):Promise<CardTaskEntry>
export function createCardTasks(input:{api:WorkspaceApi;cardId:string;entries:CardTaskEntry[];onState?:(state:State)=>void;onProgress?:(progress:{completed:number;total:number;title:string})=>void}):Promise<{state:State;created:number;reused:number;linked:number}>
