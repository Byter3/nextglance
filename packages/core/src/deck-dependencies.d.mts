import type { Relation, Workspace, WorkspaceRecord } from '@nextspace/contracts'
type Edge = Pick<Relation, 'fromId' | 'toId'>
export function deckDependencyPair(records: WorkspaceRecord[], edge: Edge): {from: WorkspaceRecord; to: WorkspaceRecord} | null
export function deckDependencyProblem(records: WorkspaceRecord[], edge: Edge, available?: boolean): string
export function pendingDeckDependencies(workspace: Workspace, records: WorkspaceRecord[]): Relation[]
