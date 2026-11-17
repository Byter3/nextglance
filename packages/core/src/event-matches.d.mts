import type {Relation, WorkspaceRecord} from '@nextspace/contracts'
export interface EventMatchSuggestion {
  id: string; fromId: string; toId: string; work: WorkspaceRecord; event: WorkspaceRecord
  titleSimilarity: number; dateDistanceDays: number|null; score: number
  reasons: string[]; warnings: string[]; ambiguous: boolean; recommended: boolean
}
export interface EventMatchSelection {fromId:string;toId:string}
export function normalizeMatchTitle(value: unknown): string
export function suggestEventMatches(records?: WorkspaceRecord[], relations?: Relation[]): EventMatchSuggestion[]
