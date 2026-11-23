import {inject, onMounted, provide, ref, type InjectionKey, type Ref} from 'vue'
import {DEFAULT_WEEKEND_MASK, isWeekendDay, normalizeWeekendMask, setWeekendDay} from '@nextspace/core/weekend-days.mjs'
import {dateValue} from './planner-ui'

const storageKey = 'nextglance:appearance:weekend-mask.v1'
const weekendMaskKey: InjectionKey<Readonly<Ref<number>>> = Symbol('weekend days')

export interface WeekendPreferencesPort {
  read(): Promise<number>
  write(mask: number): Promise<void>
}

export function provideWeekendDays(host?: WeekendPreferencesPort) {
  const mask = ref(DEFAULT_WEEKEND_MASK)
  const pending = ref(Boolean(host))
  const error = ref('')
  provide(weekendMaskKey, mask)

  if (host) {
    onMounted(async () => {
      try { mask.value = normalizeWeekendMask(await host.read()) }
      catch { error.value = 'Weekend days could not be loaded. The default is shown.' }
      finally { pending.value = false }
    })
  } else {
    try { mask.value = normalizeWeekendMask(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) }
    catch { /* The default works when browser storage is unavailable. */ }
  }

  async function change(day: number, enabled: boolean) {
    if (pending.value) return
    const next = setWeekendDay(mask.value, day, enabled)
    if (next === mask.value) return
    pending.value = true
    error.value = ''
    try {
      if (host) await host.write(next)
      else localStorage.setItem(storageKey, JSON.stringify(next))
      mask.value = next
    } catch { error.value = 'Weekend days could not be saved. Please try again.' }
    finally { pending.value = false }
  }
  return {mask, pending, error, change, isWeekend: (value?: string | Date) => isWeekendFor(mask.value, value)}
}

function isWeekendFor(mask: number | undefined, value?: string | Date) {
  return isWeekendDay(mask, (value instanceof Date ? value : dateValue(value)).getDay())
}

export function useIsWeekend() {
  const mask = inject(weekendMaskKey, undefined)
  return (value?: string | Date) => isWeekendFor(mask?.value, value)
}
