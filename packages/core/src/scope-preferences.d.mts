import type {PlannerSettings,PlannerView,Source} from '@nextspace/contracts'
import type {CalendarMode} from './calendar-period.mjs'

export interface ScopeViewExtras {
  query:string
  attention:'all'|'overdue'|'today'|'undated'|'blocked'
  listKind:'all'|Source
  calendarMode:CalendarMode
  timelineFloatingEvents:boolean
  timelineListCollapsed:boolean
  boardGroupTasks:boolean
  statusIds:string[]
}
export interface ScopeViewPreferences extends ScopeViewExtras {
  view:PlannerView
  assignment:'me'|'all'
  includeUnassigned:boolean
  unassignedBoardIds:string[]
  hiddenCollectionIds:string[]
  showCompleted:boolean
  showCompletedByView:Partial<Record<PlannerView,boolean>>
}
export type PageFilters=Omit<ScopeViewPreferences,'view'|'showCompletedByView'|'calendarMode'|'timelineFloatingEvents'|'timelineListCollapsed'|'boardGroupTasks'>
export interface ScopePages {view:PlannerView;pages:Partial<Record<PlannerView,PageFilters>>;calendarMode:CalendarMode;timelineFloatingEvents:boolean;timelineListCollapsed:boolean;boardGroupTasks:boolean}
export interface ScopePreferenceStore {version:2;scopes:Record<string,ScopePages>}
export function scopePreferenceStorageKey(connection?:{serverUrl?:string;username?:string}):string|null
export function captureScopePreferences(planner?:Partial<PlannerSettings>,extra?:{query?:string;attention?:string;listKind?:string;calendarMode?:string;timelineFloatingEvents?:boolean;timelineListCollapsed?:boolean;boardGroupTasks?:boolean;statusIds?:string[]}):ScopeViewPreferences
export function parseScopePreferences(serialized:unknown):ScopePreferenceStore
export function scopePreferencesFor(store:ScopePreferenceStore,scopeId:string,legacyPlanner?:Partial<PlannerSettings>,view?:PlannerView):ScopeViewPreferences
export function saveScopePreferences(store:ScopePreferenceStore,scopeId:string,snapshot:ScopeViewPreferences):ScopePreferenceStore
export function applyScopePreferences(planner:Partial<PlannerSettings>,scopeId:string,snapshot:ScopeViewPreferences):PlannerSettings
export function pruneScopePreferences(store:ScopePreferenceStore,validScopeIds:string[]):ScopePreferenceStore
