import type {WorkspaceRecord,Collection,Workspace,RecordTag} from '@nextspace/contracts'
export function knownWorkspaceTags(records:WorkspaceRecord[], collections:Collection[], workspace:Workspace|undefined, assigned?:RecordTag[]):RecordTag[]
