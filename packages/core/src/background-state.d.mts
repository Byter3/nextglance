import type {State} from '@nextspace/contracts'
export function mergeBackgroundState(before:State,current:State,incoming:State,protectedIds?:string[],options?:{reuseUnchanged?:boolean}):{state:State;conflicts:string[]}
export function reuseUnchangedState(previous:State,next:State):State
