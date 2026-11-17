import type {Relation, WorkspaceRecord} from '@nextspace/contracts';
export type DependencyPeer = Relation & {record?: WorkspaceRecord};
export function dependencyGroups(recordId: string, records: WorkspaceRecord[], relations: Relation[]): {incoming: DependencyPeer[]; outgoing: DependencyPeer[]};
