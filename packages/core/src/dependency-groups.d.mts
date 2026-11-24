import type {Relation, StatusMapping, StatusMappingColumn, WorkspaceRecord} from '@nextspace/contracts';
export type DependencyPeer = Relation & {record?: WorkspaceRecord; status?: StatusMappingColumn};
export function dependencyGroups(recordId: string, records: WorkspaceRecord[], relations: Relation[], statusMapping?: StatusMapping): {incoming: DependencyPeer[]; outgoing: DependencyPeer[]};
