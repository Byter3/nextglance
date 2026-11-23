export type Source = 'tasks' | 'calendar' | 'deck' | 'notes' | 'collectives'
export type PlannerView = 'overview' | 'calendar' | 'timeline' | 'board' | 'list'
export interface ViewPageFilters {
  assignment:'me'|'all';includeUnassigned:boolean;unassignedBoardIds:string[];hiddenCollectionIds:string[]
  showCompleted:boolean;query:string;attention:'all'|'overdue'|'today'|'undated'|'blocked';listKind:'all'|Source;statusIds:string[]
}
export interface ViewPreferences {format:'nextspace-view-preferences';version:1;scopes:Record<string,{pages:Partial<Record<PlannerView,ViewPageFilters>>}>}
export interface ViewPreferencesState {preferences:ViewPreferences;etag:string|null}
export interface ViewPreferencesInput extends ViewPreferencesState {base:ViewPreferences}
export type RelationType = 'depends_on' | 'for_event' | 'scheduled_during' | 'reference' | 'related'
export type WorkflowColumn = 'inbox' | 'planned' | 'doing' | 'done'
export interface NativeIdentity { source: Source; key: string; locator?: string; aliases?: string[] }
export interface RecordTag { id: string; title: string; color?: string }
export interface FileTag extends RecordTag { assignable: boolean }
export interface CloudFile { id: string; name: string; path: string; directory: boolean; size?: number; mimeType?: string }
export interface DeckAttachment { id: string; type: string; name: string; fileId?: string; path?: string; url: string; size?: number; mimeType?: string }
export interface RelatedResource { providerId: string; itemId: string; title: string; subtitle?: string; url: string }
export interface StatusMappingColumn { id: string; title: string; color: string }
export interface StatusMapping { columns: StatusMappingColumn[]; assignments: Record<string,string> }
export interface EventParticipantInput { email: string; name?: string }
export interface EventScheduling {
  role: 'none'|'organizer'|'attendee'|'unknown'
  organizer?: {uri: string; name?: string}
  attendees: {uri: string; name?: string; participation: string; role?: string; rsvp?: boolean; scheduleStatus?: string}[]
  ownAttendeeUri?: string
}
export interface EventAccess {
  editDetails: boolean; editReminders: boolean; editAttendees: boolean; respond: boolean; delete: boolean
  reason?: 'recurring'|'mixed-resource'|'read-only-calendar'|'missing-validator'|'unknown-identity'|'not-organizer'|'unsupported-scheduling'|'not-calendar-owner'
}
export interface CalendarScheduling {canInvite: boolean; organizer?: {uri: string; name?: string}; reason?: string}
export interface WorkspaceRecord {
  id: string; source: Source; kind: 'task'|'event'|'card'|'note'|'page'; title: string
  body?: string; url?: string; collectionId?: string; collectionTitle?: string
  due?: string; start?: string; end?: string; allDay?: boolean; busy?: boolean; completed?: boolean; completedAt?: string; priority?: number; percentComplete?: number
  tags?: string[]; tagDetails?: RecordTag[]; color?: string; status?: string; updatedAt?: string; readonly?: boolean; etag?: string
  assigneeIds?: string[]; assignmentKnown?: boolean; assignmentCount?: number; stackId?: string; nativeDependencies?: string[]; nativeDependents?: string[]; nativeRelatedIds?: string[]
  fileId?: string; attachmentFileIds?: string[]; fileTags?: FileTag[]
  location?: string; reminders?: number[]; unsupportedReminderCount?: number
  eventScheduling?: EventScheduling; eventAccess?: EventAccess
  identity?: NativeIdentity; remote?: Record<string, unknown>
}
export interface Collection { id: string; source: Source; title: string; readonly?: boolean; color?: string; labels?: RecordTag[]; stacks?: {id: string; title: string}[]; calendarScheduling?: CalendarScheduling }
export interface Space { id: string; name: string; color: string; collectionIds: string[]; defaultCalendarId?: string; defaultTaskListId?: string; defaultBoardId?: string; statusMapping?: StatusMapping }
export interface Category { id: string; spaceId: string; name: string; color: string; collectionIds: string[]; tagNames?: string[] }
export interface Project { id: string; spaceId: string; categoryId?: string; name: string; color?: string; collectionIds: string[]; recordIds: string[]; archived?: boolean; tagNames?: string[] }
export interface Relation { id: string; type: RelationType; fromId: string; toId: string; role?: 'preparation'|'during'|'follow_up'; label?: string; native?: boolean }
export interface PlanSession { id: string; recordId: string; start: string; end: string }
export interface OverviewAxis { labelWidth:number; dayWidth:number; scrollLeft:number; renderAnchor?:string; renderDays?:number }
export interface ScopeArrangement {timelineRows?:string[];timelineGroups?:string[];boardCards?:Record<string,string[]>}
export interface PlannerSettings {
  view: PlannerView; scopeId: string; assignment: 'me'|'all'; includeUnassigned: boolean
  unassignedBoardIds: string[]; hiddenCollectionIds: string[]; excludedSpaceIds: string[]
  showCompleted: boolean; showCompletedByView?: Partial<Record<PlannerView,boolean>>; scopeAssignments: Record<string, 'me'|'all'>; workflow: Record<string, WorkflowColumn>
  statusMapping?: StatusMapping
  arrangements?: Record<string,ScopeArrangement>
}
export interface Workspace {
  schemaVersion: 2; id: string; name: string; updatedAt: string
  spaces: Space[]; categories?: Category[]; projects: Project[]; relations: Relation[]; plans: PlanSession[]
  identities: (NativeIdentity & {id: string})[]; properties: Record<string, Record<string, unknown>>
  appearance: {mode: 'system'|'light'|'dark'; calendarColors: Record<string, string>}
  planner: PlannerSettings
}
export interface ThemePalette {
  surfaceColor?: string; textColor?: string; mutedColor?: string; hoverColor?: string; borderColor?: string
  primaryColor?: string; primaryTextColor?: string; primaryLightColor?: string; primaryLightTextColor?: string
}
export interface NextcloudTheme {
  name?: string; color?: string; textColor?: string; backgroundColor?: string; backgroundTextColor?: string
  logoUrl?: string; backgroundUrl?: string; backgroundDataUrl?: string; dark?: boolean; highContrast?: boolean
  mode?: 'light'|'dark'|'system'; light?: ThemePalette; darkPalette?: ThemePalette
}
export interface ScheduleRequest {
  requestId: string; recordId: string; title: string; collectionId: string; start: string; end: string
  allDay?: boolean; description?: string; location?: string; reminders?: number[]; attendees?: EventParticipantInput[]
}
export interface DeviceSyncSettings {caldavMinutes:0|15|30|60|240;deckMinutes:0|15|30|60|240;wifiOnly:boolean}
export interface BackgroundSourceSync {
  enabled:boolean; scheduled:boolean; lastAttemptAt?:string; downloadedAt?:string; readGenerationAt?:string
  projection?:'pending'|'ready'|'unavailable'|'incomplete'; message?:string; error?:string
}
export interface DeviceSync {
  settings:DeviceSyncSettings
  restoring:boolean
  foregroundError?:string
  plannerSyncing?:boolean
  plannerVerifiedAt?:string
  activity?:{sources:Source[];stage:'authorization'|'discovery'|'source-read'|'local-cache';startedAt:string;lastProgressAt:string;completed:number;total?:number;message:string}
  background?:{supported:boolean;scheduled:boolean;lastAttemptAt?:string;lastSuccessAt?:string;error?:string;projection?:'pending'|'ready'|'unavailable'|'incomplete';readGenerationAt?:string;message?:string;sources?:{caldav:BackgroundSourceSync;deck:BackgroundSourceSync}}
}
export interface PlannerConflict {
  revision: number
  paths: string[]
  organizationChoice?: boolean
  dependencyChoice?: boolean
}
export type PlannerConflictChoice = 'local'|'remote'
export interface State {
  calendarHistoryDays?: number | null
  plannerConflict?: PlannerConflict
  deviceSync?:DeviceSync
  nativeOperations?: string[]
  /** Ephemeral verified source prerequisites; independent of bulk data freshness. Never restored as authority. */
  nativeWriteSources?: Source[]
  recordIdAliases?:Record<string,string>
  createdRecordId?: string; creationWarning?: string
  mode: 'demo'|'live'|'disconnected'; workspace: Workspace; revision: number
  records: WorkspaceRecord[]; collections: Collection[]
  statuses: {source: Source; state: 'connected'|'error'|'unavailable'|'demo'; count: number; cached?:boolean; permissionDenied?:boolean; message?: string; lastSyncedAt?: string; metadataStale?: boolean; errorCode?: string; errorStage?: string}[]
  theme?: NextcloudTheme
  pendingSchedules?: (ScheduleRequest & {created?: boolean})[]
  connection: {connected: boolean; serverUrl?: string; username?: string; reconnectRequired?: boolean; restoreError?: string; recoveryOnly?: boolean}
  storage: {localPath?: string; remotePath?: string; syncStatus: string; message?: string; lastSyncedAt?: string; errorCode?: string; errorStage?: string}
}
export interface PlannerModel {
  records: WorkspaceRecord[]; actions: WorkspaceRecord[]; events: WorkspaceRecord[]; resources: WorkspaceRecord[]
  contextRecordIds?: string[]
  overdue: WorkspaceRecord[]; today: WorkspaceRecord[]; upcoming: WorkspaceRecord[]; undated: WorkspaceRecord[]
  spaces: (Space & {openCount: number})[]; categories: (Category & {openCount: number})[]; projects: (Project & {openCount: number})[]; relations: Relation[]
  hiddenAssignmentCount: number; unassignedCount: number; unknownAssignmentCount: number
  scope: {id: string; name: string; color?: string; kind: 'all'|'space'|'category'|'project'; unavailable?: boolean}
  counts: {actions: number; events: number; overdue: number; today: number; undated: number; blocked: number; records: number}
}
export interface DiagnosticSummary {recording:boolean;elapsedMs:number;eventCount:number;dropped:number;canSaveFile:boolean;stopReason?:'manual'|'duration'|'background'|'account-change'}
export interface DiagnosticInput {
  kind:'authorization'|'source'|'request'|'cache'|'projection'|'planner'|'restore'|'ui'
  source?:'tasks'|'calendar'|'deck'|'notes'|'collectives'|'caldav'|'planner'
  stage?:'start'|'finish'|'error'|'discovery'|'cache-read'|'cache-write'|'download'|'projection'|'local-cache'|'authorization'|'planner-read'|'planner-write'|'page'|'panel'|'frame'|'scroll'|'worker-ready'|'first-checkpoint'|'full-restore'|'publication'
  page?:'overview'|'calendar'|'timeline'|'board'|'list'|'settings'
  method?:'GET'|'HEAD'|'PROPFIND'|'REPORT'|'PUT'|'POST'|'DELETE'|'MKCOL'
  code?:string;durationMs?:number;count?:number;bytes?:number;completed?:number;total?:number;cacheHits?:number;cacheMisses?:number;downloads?:number;frames?:number;maxDelayMs?:number;status?:number;success?:boolean
}
export interface WorkspaceApi {
  setCalendarHistoryDays?(days:number|null):Promise<State>
  readCalendarWindow?(window:{from:number;to:number}):Promise<State>
  getViewPreferences?():Promise<ViewPreferencesState>
  saveViewPreferences?(input:ViewPreferencesInput):Promise<ViewPreferencesState>
  startDiagnostics?():DiagnosticSummary;stopDiagnostics?():DiagnosticSummary;getDiagnostics?():DiagnosticSummary;clearDiagnostics?():DiagnosticSummary
  readDiagnostics?():string;recordDiagnostic?(event:DiagnosticInput):void;saveDiagnostics?():Promise<{saved:boolean;cancelled?:boolean;name?:string}>;copyDiagnostics?():Promise<{copied:boolean}>
  getState(): Promise<State>; refresh(): Promise<State>; retryConnection?(): Promise<State>
  resolveWorkspaceConflict?(choice: PlannerConflictChoice, expectedRevision: number, expectedAccount: {serverUrl: string; username: string}): Promise<State>
  setSyncSettings?(settings:DeviceSyncSettings):Promise<State>
  resumeSync?(reason:'open'|'resume'|'timer'|'online'):Promise<State>
  setAppActive?(active:boolean):Promise<void>
  subscribeSync?(listener:(sync:DeviceSync)=>void):()=>void
  saveWorkspace(workspace: Workspace, expectedRevision: number, expectedAccount?: {serverUrl: string; username: string}, options?: {coalesceLaunch?: boolean}): Promise<{workspace: Workspace; revision: number; storage: State['storage']}>
  beginLogin(serverUrl: string): Promise<{flowId: string; loginUrl: string}>
  pollLogin(flowId: string): Promise<{pending: true}|{pending: false; state: State}>
  cancelLogin(flowId: string): Promise<State>
  connect(input: {serverUrl: string; username: string; appPassword: string}): Promise<State>
  disconnect(): Promise<State>
  createNote(input: {title: string; content: string; collectionId?: string; category?: string}): Promise<State>
  updateNote(input: {id: string; title: string; content: string; category?: string; etag?: string; base?: {title: string; content: string; category?: string}}): Promise<State>
  readNote?(input: {id: string}): Promise<{id: string; title: string; content: string; category: string; etag: string; readonly: boolean}>
  readNoteTags?(input: {id: string}): Promise<{tags: FileTag[]; availableTags: FileTag[]}>
  setNoteTags?(input: {id: string; tagIds: string[]; newTags?: string[]}): Promise<{tags: FileTag[]; availableTags: FileTag[]}>
  createDeckLabel?(input: {collectionId: string; title: string; color?: string}): Promise<{label: RecordTag; state: State}>
  listFiles?(input: {path?: string}): Promise<{path: string; files: CloudFile[]}>
  readDeckAttachments?(input: {id: string}): Promise<{attachments: DeckAttachment[]}>
  attachDeckFile?(input: {id: string; path?: string; noteId?: string}): Promise<{attachments: DeckAttachment[]}>
  removeDeckAttachment?(input: {id: string; attachmentId: string}): Promise<{attachments: DeckAttachment[]}>
  uploadDeckAttachment?(input: {id: string}): Promise<{attachments: DeckAttachment[]; cancelled?: boolean}>
  readRelatedResources?(input: {id: string}): Promise<{available: boolean; resources: RelatedResource[]}>
  migrateDeckNoteLinks?(input?: {limit?: number}): Promise<{state: State; converted: number; remaining: number; errors: {relationId: string; message: string}[]}>
  updateDescription?(input: {id: string; description: string; etag?: string}): Promise<State>
  updateRecordDates?(input: {id: string; start?: string; due?: string; end?: string; allDay?: boolean; etag?: string}): Promise<State>
  updateRecordAppearance?(input: {id: string; color?: string; tags?: string[]; tagIds?: string[]; etag?: string}): Promise<State>
  updateTaskStatus?(input: {id: string; status: string; etag?: string}): Promise<State>
  createTask(input: {title: string; collectionId: string; start?: string; due?: string; description?: string; requestId?: string; completed?: boolean; expectedAccount?: {serverUrl: string; username: string}}): Promise<State>
  createCard?(input: {title: string; collectionId: string; stackId: string; start?: string; due?: string; description?: string; assignToMe?: boolean}): Promise<State>
  setTaskCompleted(input: {id: string; completed: boolean}): Promise<State>
  setTaskDue?(input: {id: string; due?: string}): Promise<State>
  createEvent?(input: {title: string; collectionId: string; start: string; end: string; allDay?: boolean; description?: string; location?: string; reminders?: number[]; attendees?: EventParticipantInput[]}): Promise<State>
  createLinkedEvent?(input: ScheduleRequest & {expectedRevision: number}): Promise<State>
  updateEvent?(input: {id: string; start?: string; end?: string; allDay?: boolean; title?: string; description?: string; location?: string; reminders?: number[]; attendees?: EventParticipantInput[]; etag?: string}): Promise<State>
  respondToEvent?(input: {id: string; etag: string; participation: 'ACCEPTED'|'TENTATIVE'|'DECLINED'}): Promise<State>
  deleteEvent?(input: {id: string}): Promise<State>
  deleteTask?(input: {id: string; etag: string; expectedAccount: {serverUrl: string; username: string}}): Promise<State>
  setCardCompleted?(input: {id: string; completed: boolean}): Promise<State>
  moveCard?(input: {id: string; stackId: string}): Promise<State>
  setDeckDependency?(input: {fromId: string; toId: string; remove?: boolean}): Promise<State>
  readPage(input: {id: string}): Promise<{body: string; etag?: string}>
  readPageAsset?(input: {id: string; path: string}): Promise<{dataUrl: string}>
  syncWorkspace(): Promise<State>; exportWorkspace(): Promise<{path?: string; exported: boolean}>
  openExternal(url: string): Promise<void>
}
