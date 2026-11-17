import type {Collection,Workspace,WorkspaceRecord,RecordTag} from '@nextspace/contracts'
export function createRecordPresentation(input:{collections:()=>Collection[];workspace:()=>Workspace|undefined;fallback:()=>string}):{sourceColorFor:(record:WorkspaceRecord)=>string;tagsFor:(record:WorkspaceRecord)=>RecordTag[]}
