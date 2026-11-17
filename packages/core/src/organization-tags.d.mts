import type {Workspace,WorkspaceRecord,Collection} from '@nextspace/contracts'
export function organizationTagKey(name:unknown):string
export function normalizeOrganizationTags(names:unknown):string[]
export function organizationSourcePool(workspace:Pick<Workspace,'spaces'|'categories'|'projects'>,spaceId:string,availableIds?:string[]):string[]
export function organizationMembership(workspace:Pick<Workspace,'spaces'|'categories'|'projects'>,records:WorkspaceRecord[]):{scopes:Map<string,Set<string>>;projects:Map<string,Set<string>>;categories:Map<string,Set<string>>;pools:Map<string,string[]>}
export function organizationTagOptions(records:WorkspaceRecord[],collections:Collection[],selected?:string[]):{key:string;title:string;available:boolean;color?:string}[]
export function organizationRuleCount(workspace:Workspace,records:WorkspaceRecord[],spaceId:string,collectionIds?:string[],tagNames?:string[],recordIds?:string[]):number
