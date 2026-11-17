import type {ViewPreferences} from '@nextspace/contracts'
import type {ScopePreferenceStore} from './scope-preferences.mjs'
export function emptyViewPreferences():ViewPreferences
export function checkedViewPreferences(value:unknown):ViewPreferences
export function viewPreferencesFromLocal(store:unknown):ViewPreferences
export function applyViewPreferences(store:unknown,preferences:ViewPreferences):ScopePreferenceStore
export function importViewPreferences(remote:ViewPreferences,local:unknown):ViewPreferences
export function mergeViewPreferences(base:ViewPreferences,local:ViewPreferences,remote:ViewPreferences,resolution?:'local'|'remote'):{preferences:ViewPreferences;conflicts:string[]}
