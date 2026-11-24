import type {State} from '@nextspace/contracts'
export function isConnectionAuthorized(connection:State['connection']|null|undefined):boolean
export function connectionEntry(options?:{
  connection?:State['connection']|null
  mobileHost?:boolean
  nativeFilesAvailable?:boolean
  initialStartup?:boolean
}):{promptReconnect:boolean;primary:'files'|'browser';browserLabel:string;methodLabel?:string;canSwitchDirect?:boolean}
