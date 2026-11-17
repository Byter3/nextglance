import type {Workspace} from '@nextspace/contracts'
export interface ScopeEditorDraft {
  kind: 'space' | 'project'
  id: string
  name: string
  color: string
  spaceId: string
  categoryId: string
  collectionIds: string[]
  recordIds: string[]
  tagNames?: string[]
  defaultCalendarId: string
  defaultTaskListId: string
  defaultBoardId: string
}
export function buildScopeDraft(workspace: Pick<Workspace, 'spaces' | 'projects' | 'categories'>, options: {
  kind: 'space' | 'project'; id?: string; parentSpaceId?: string; scopeId?: string; defaultColor?: string
}): ScopeEditorDraft | null
