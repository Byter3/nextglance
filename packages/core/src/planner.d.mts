import type {State, Workspace, PlannerSettings, PlannerView, PlannerModel, WorkspaceRecord, Relation, RelationType, PlanSession, Collection, StatusMapping} from '@nextspace/contracts'
export function createPlannerWorkspace(): Workspace
export function createEmptyState(): State
export function isClosed(record: WorkspaceRecord): boolean
export function planningColumnForRecord(record: WorkspaceRecord, workflow?: Record<string,string>): 'inbox'|'planned'|'doing'|'done'|'cancelled'
export function plannerSettings(input?: Partial<PlannerSettings>): PlannerSettings
export function showCompletedForView(settings: Partial<PlannerSettings>, view?: PlannerView): boolean
export function filterCompletedWork(records:WorkspaceRecord[],relations?:Relation[],view?:PlannerView,showCompleted?:boolean):WorkspaceRecord[]
export function selectPlanner(state: State, overrides?: Partial<PlannerSettings> & {query?: string; now?: Date|string; statusIds?:string[];completedDays?:number|null;boardCompletedDays?:number|null}): PlannerModel
export function countPlannerActions(state: State, overrides?: Partial<PlannerSettings> & {query?: string;statusIds?:string[]}): number
export function scopeRecordIds(workspace: Workspace, records: WorkspaceRecord[], scopeId: string): Set<string>
export function boardCollectionsForScope(workspace: Workspace, records: WorkspaceRecord[], collections: Collection[], scopeId: string): Collection[]
export function scopeContextRecordIds(workspace: Workspace, records: WorkspaceRecord[], scopeId: string): Set<string>
export function allRelations(workspace: Workspace, records: WorkspaceRecord[]): Relation[]
export function relationsFor(recordId: string, relations: Relation[], records: WorkspaceRecord[]): {incoming: (Relation & {record: WorkspaceRecord|null})[]; outgoing: (Relation & {record: WorkspaceRecord|null})[]}
export function canAddRelation(relations: Relation[], fromId: string, toId: string, type: RelationType, records?: WorkspaceRecord[]): {ok: boolean; message?: string}
export function createRelationIndex(relations:Relation[],records?:WorkspaceRecord[]):{byId:Map<string,WorkspaceRecord>|null;has:(type:RelationType,fromId:string,toId:string)=>boolean;prepare:(id:string)=>void;canAdd:(fromId:string,toId:string,type:RelationType)=>{ok:boolean;message?:string}}
export function localDay(value: string|Date|number|undefined|null): string
export function weekDays(anchor?: Date|string): Date[]
export function dayItems(records: WorkspaceRecord[], date: Date|string, plans?: PlanSession[]): WorkspaceRecord[]
export function boardColumns(records: WorkspaceRecord[], collections: Collection[], options?: {mode?: 'source'|'planning'|'deck'|'mapped'; boardId?: string; workflow?: Record<string,string>;statusMapping?:StatusMapping}): {id: string; title: string; color?:string; records: WorkspaceRecord[]}[]
