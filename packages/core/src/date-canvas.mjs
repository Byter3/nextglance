import {shiftTimelineDate} from './timeline-edit.mjs'

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback

/** A bounded date strip with room on both sides. Dates never grow the DOM. */
export function createDateCanvas({anchor, visibleDays, dayWidth}) {
  const count = Math.max(1, Math.min(90, Math.round(finite(visibleDays, 7))))
  const paddingDays = Math.max(7, count)
  const width = Math.max(1, finite(dayWidth, 80))
  return {anchor:shiftTimelineDate(anchor, -paddingDays), visibleDays:count,
    renderDays:count + paddingDays * 2, paddingDays, scrollLeft:paddingDays * width, dayWidth:width}
}

/** Rebase only near a buffer edge, retaining fractional pixels and the focal date. */
export function panDateCanvas(state, delta) {
  const scrollLeft = state.scrollLeft + finite(delta, 0)
  const position = scrollLeft / state.dayWidth
  const shift = position < state.paddingDays / 2 || position > state.paddingDays * 1.5
    ? Math.floor(position) - state.paddingDays : 0
  return {...state, anchor:shift ? shiftTimelineDate(state.anchor, shift) : state.anchor,
    scrollLeft:scrollLeft - shift * state.dayWidth}
}

export function dateCanvasAnchor(state) {
  return shiftTimelineDate(state.anchor, Math.floor(state.scrollLeft / state.dayWidth))
}

/** Position in a newly zoomed visible range; repeated frames are idempotent. */
export function positionDateCanvas(input, offset) {
  return panDateCanvas(createDateCanvas(input), offset)
}

/** Deterministic coast integration; adapters supply frame duration and preferences. */
export function touchCoastStep({vx, vy, elapsed = 0, dt, reducedMotion = false}) {
  const x = Math.max(-2.5, Math.min(2.5, finite(vx, 0)))
  const y = Math.max(-2.5, Math.min(2.5, finite(vy, 0)))
  const duration = Math.max(0, Math.min(finite(dt, 0), 600 - elapsed))
  if (reducedMotion || elapsed >= 600 || Math.hypot(x, y) < .02)
    return {dx:0, dy:0, vx:0, vy:0, elapsed, done:true}
  const decay = Math.exp(-.006 * duration)
  return {dx:x * (1 - decay) / .006, dy:y * (1 - decay) / .006,
    vx:x * decay, vy:y * decay, elapsed:elapsed + duration,
    done:elapsed + duration >= 600 || Math.hypot(x * decay, y * decay) < .02}
}
