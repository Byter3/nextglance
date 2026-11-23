export const DEFAULT_BOARD_COMPLETED_DAYS: 14
export function normalizeCalendarHistoryDays(value: unknown): number | null
export function normalizeBoardCompletedDays(value: unknown): number | null
export function normalizeCalendarWindow(value: unknown): {from:number;to:number} | null
export function paddedCalendarWindow(from: number, to: number): {from:number;to:number} | null
export function boardCompletionVisible(record: {kind:string;status?:string;completed?:boolean;completedAt?:string}, days: number|null, now: number, showCancelled?: boolean): boolean
