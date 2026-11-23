export const DEFAULT_WEEKEND_MASK: number
export function normalizeWeekendMask(value: unknown): number
export function isWeekendDay(mask: unknown, weekday: number): boolean
export function setWeekendDay(mask: unknown, weekday: number, enabled: boolean): number
export function isWeekendDateKey(mask: unknown, key?: string): boolean
