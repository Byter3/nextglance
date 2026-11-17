import type {WorkspaceRecord, Collection, Workspace} from '@nextspace/contracts'
export interface DisplayTag {id:string;title:string;color?:string;native:boolean}
export function normalizeColor(value: unknown): string | undefined
export function sourceColor(record: WorkspaceRecord, collections: Collection[], fallback?:string): string
export function itemColor(record: WorkspaceRecord, collections: Collection[], fallback?:string): string
export function tagColorKey(collectionId: string|undefined, title: string): string
export function recordTags(record: WorkspaceRecord, workspace?: Workspace): DisplayTag[]
