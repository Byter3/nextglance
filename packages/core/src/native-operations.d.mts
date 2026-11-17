export function canUseNativeOperation(input?: {
  operation?: string
  implemented?: boolean
  canMutateNative?: boolean
  hostOperations?: readonly string[]
  runtimeOperations?: readonly string[]
}): boolean
export function canWriteNativeSource(input?: {
  source?:import('@nextspace/contracts').Source
  connected?:boolean
  online?:boolean
  busy?:boolean
  loginWaiting?:boolean
  statuses?:{source:string;state:string;permissionDenied?:boolean}[]
  nativeWriteSources?:readonly import('@nextspace/contracts').Source[]
}):boolean
export function completionOperation(record:import('@nextspace/contracts').WorkspaceRecord,collections?:import('@nextspace/contracts').Collection[]):'setTaskCompleted'|'setCardCompleted'|null
export function eventDeleteOperation(record:import('@nextspace/contracts').WorkspaceRecord,collections?:import('@nextspace/contracts').Collection[]):'deleteEvent'|null
export function eventDeleteFingerprint(record?:import('@nextspace/contracts').WorkspaceRecord):string
export function eventEditOperation(record:import('@nextspace/contracts').WorkspaceRecord,collections?:import('@nextspace/contracts').Collection[]):'updateEvent'|null
export function eventRespondOperation(record:import('@nextspace/contracts').WorkspaceRecord,collections?:import('@nextspace/contracts').Collection[]):'respondToEvent'|null
export function deckAttachmentOperation(record:import('@nextspace/contracts').WorkspaceRecord,collections?:import('@nextspace/contracts').Collection[],operation?:'attachDeckFile'|'removeDeckAttachment'|'uploadDeckAttachment'):'attachDeckFile'|'removeDeckAttachment'|'uploadDeckAttachment'|null
