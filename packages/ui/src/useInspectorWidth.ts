import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const preferenceKey = 'nextspace.inspector-width'
const defaultWidth = 480

/** A device preference; never changes or syncs the user's Nextcloud data. */
export function useInspectorWidth() {
  const viewport = ref(window.innerWidth)
  let initial = defaultWidth
  try {
    const saved = Number(localStorage.getItem(preferenceKey))
    if (Number.isFinite(saved) && saved >= 320 && saved <= 860) initial = saved
  } catch { /* Storage can be disabled by the host. */ }
  const preferred = ref(initial)
  const minimum = computed(() => Math.min(360, viewport.value - 20))
  const maximum = computed(() => Math.max(minimum.value, Math.min(860, viewport.value <= 1100 ? viewport.value - 20 : viewport.value - 600)))
  const width = computed(() => Math.round(Math.min(maximum.value, Math.max(minimum.value, preferred.value))))
  const resizing = ref(false)
  let drag: { id:number; x:number; width:number } | null = null
  const persist = () => { try { localStorage.setItem(preferenceKey, String(preferred.value)) } catch { /* Keep the session preference. */ } }
  const clamp = (value:number) => Math.min(maximum.value, Math.max(minimum.value, value))
  function start(event:PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget as HTMLElement
    handle.focus()
    handle.setPointerCapture(event.pointerId)
    drag = {id:event.pointerId, x:event.clientX, width:width.value}
    resizing.value = true
  }
  function move(event:PointerEvent) {
    if (drag?.id !== event.pointerId) return
    preferred.value = clamp(drag.width + drag.x - event.clientX)
  }
  function finish(event:PointerEvent) {
    if (drag?.id !== event.pointerId) return
    drag = null
    resizing.value = false
    persist()
  }
  function reset() { preferred.value = defaultWidth; persist() }
  function keyboard(event:KeyboardEvent) {
    const step = event.shiftKey ? 80 : 20
    const values:Record<string,number> = {ArrowLeft:width.value + step, ArrowRight:width.value - step, Home:minimum.value, End:maximum.value}
    if (event.key === 'Enter') { event.preventDefault(); reset(); return }
    if (!(event.key in values)) return
    event.preventDefault()
    preferred.value = clamp(values[event.key])
    persist()
  }
  const resized = () => { viewport.value = window.innerWidth }
  onMounted(() => window.addEventListener('resize', resized))
  onBeforeUnmount(() => window.removeEventListener('resize', resized))
  return {width, minimum, maximum, resizing, start, move, finish, reset, keyboard}
}
