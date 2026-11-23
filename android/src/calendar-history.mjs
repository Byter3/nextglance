import {normalizeCalendarHistoryDays} from '@nextspace/core/history.mjs'
import {normalizeSyncSettings} from '@nextspace/core/sync-policy.mjs'

/** Account-local preference metadata; native data and cloud schemas are unchanged. */
export const calendarPreferences = value => ({...normalizeSyncSettings(value),calendarHistoryDays:normalizeCalendarHistoryDays(value?.calendarHistoryDays)})
export const calendarHistoryEvidence = value => normalizeCalendarHistoryDays(value) === value ? value : undefined
export function checkedCalendarHistoryDays(value) {
  if (calendarHistoryEvidence(value) === undefined) throw Object.assign(new Error('Choose All history or a whole number of days from 0 through 36500.'),{code:'VALIDATION'})
  return normalizeCalendarHistoryDays(value)
}
