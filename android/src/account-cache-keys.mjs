import {sha256} from '@nextspace/nextcloud-client/runtime.mjs'
// Established account-private locators, shared by foreground and headless hosts.
export const cacheKey = account => sha256(`${account.serverUrl}\0${account.username}\0${account.name}`)
export const metadataKey = account => sha256(`metadata\0${cacheKey(account)}`)
export const schedulingKey = account => sha256(`scheduling\0${cacheKey(account)}`)
export const launchKey = account => sha256(`launch\0${cacheKey(account)}`)
export const syncSettingsKey = account => sha256(`sync-settings\0${cacheKey(account)}`)
export const sourceEditsKey = account => sha256(`source-edits\0${cacheKey(account)}`)
