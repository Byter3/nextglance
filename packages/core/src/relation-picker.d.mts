import type { Relation, RelationType, WorkspaceRecord, Workspace } from '@nextspace/contracts'
export function dependencyCandidates(workspace:Workspace,records:WorkspaceRecord[],scopeId?:string):WorkspaceRecord[]
export type RelationPickerMode = 'dependency' | 'note' | 'related' | 'event-work'
export type DependencyDirection = 'incoming' | 'outgoing'
export interface RelationPickerIntent { fromId: string; toId: string; type: RelationType; role?: 'preparation' | 'during' | 'follow_up' }
export function relationPickerIntent(recordId: string, targetId: string, mode: RelationPickerMode, direction?: DependencyDirection, role?: 'preparation' | 'during' | 'follow_up'): RelationPickerIntent
export function relationPickerEligibility(record: WorkspaceRecord, target: WorkspaceRecord, mode: RelationPickerMode, direction: DependencyDirection, relations: Relation[], records: WorkspaceRecord[]): { ok: boolean; message?: string }
export function createRelationPickerIndex(records:WorkspaceRecord[],relations:Relation[]):{byId:Map<string,WorkspaceRecord>;eligibility(record:WorkspaceRecord,target:WorkspaceRecord,mode:RelationPickerMode,direction:DependencyDirection,options?:{deckAvailable?:boolean}):{ok:boolean;message?:string}}
