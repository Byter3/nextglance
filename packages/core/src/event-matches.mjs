/** Read-only suggestions. Only a reviewed selection may become a planner link. */
const dayMs = 86400000
const genericWords = new Set('a an and at by for from in of on or the to with my your task event work session meeting call review admin reminder deadline todo to-do appointment preparation planning update follow up please done start end today tomorrow within days day week weeks month months due before after az a es és egy hogy kell napi emlekezteto emlékeztető megbeszeles megbeszélés hatarido határidő der die das ein eine und für fur mit von termin besprechung rappel reunion réunion'.split(/\s+/))
const fillerWords = new Set('a an and n the of to for with az es egy und der die das'.split(' '))
const months = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

export function normalizeMatchTitle(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}
function titleInfo(value) {
  const full = normalizeMatchTitle(value)
  const contextNotes = [...String(value || '').matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map(match => normalizeMatchTitle(match[1] || match[2]))
    .filter(note => note && !/\b(deadline|due|within|days?|weeks?|months?|hatarido|ig)\b/.test(note) && !new RegExp(`\\b(?:${months})\\b`, 'i').test(note) && !/\b\d{4}\s+\d{1,2}\s+\d{1,2}\b/.test(note))
  let core = String(value || '').replace(/^\s*(?:\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}|\d{1,2}:\d{2})\s*[:\-–]?\s*/, '')
  // Parenthetical notes often contain a reminder date or deadline. Keep the
  // full form as well so titles differing in meaningful notes remain reviewable.
  core = core.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  core = core.replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ')
    .replace(new RegExp(`\\b(?:${months})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'ig'), ' ')
  core = normalizeMatchTitle(core)
  const words = [...new Set(core.split(' ').filter(word => word && !fillerWords.has(word)))]
  const informative = words.filter(word => !genericWords.has(word) && !/^\d+$/.test(word))
  const specific = informative.length >= 2 && core.length >= 8 || informative.length === 1 && informative[0].length >= 9
  const numbers = [...new Set(core.match(/\d{2,}/g) || [])]
  const grams = new Set(Array.from({length: Math.max(0, core.length - 2)}, (_, index) => core.slice(index, index + 3)))
  return {full, core, words, informative, specific, numbers, grams, contextNotes}
}
function overlap(a, b) { const other = new Set(b); return a.filter(value => other.has(value)).length }
function similarity(a, b) {
  if (!a.specific || !b.specific) return 0
  // Similar invoice/order numbers must not turn distinct obligations into a match.
  if (a.numbers.length && b.numbers.length && (a.numbers.some(value => !b.numbers.includes(value)) || b.numbers.some(value => !a.numbers.includes(value)))) return 0
  if (a.full === b.full || a.core === b.core) return 1
  const common = overlap(a.words, b.words), union = new Set([...a.words, ...b.words]).size
  const tokenScore = common / union
  const gramScore = 2 * overlap([...a.grams], [...b.grams]) / (a.grams.size + b.grams.size || 1)
  const shorter = Math.min(a.words.length, b.words.length), longer = Math.max(a.words.length, b.words.length)
  const contains = common === shorter && shorter >= 2 && shorter / longer >= .6 && Math.min(a.core.length, b.core.length) >= 14 ? .85 : 0
  // A minor spelling change in one word must not discard an otherwise
  // distinctive shared name (for example Resurect/Rebuild ProjectBlueprints).
  const distinctiveOverlap = a.informative.some(word => word.length >= 5 && b.informative.includes(word))
  return Math.max(contains, tokenScore * .45 + gramScore * .55, distinctiveOverlap ? gramScore * .96 : 0)
}
function dayNumber(value, exclusive = false) {
  if (!value) return null
  // Date-only values represent local days, not UTC midnights.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts = value.split('-').map(Number)
    const timestamp = Date.UTC(parts[0], parts[1] - 1, parts[2])
    const date = new Date(timestamp)
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) return null
    return timestamp / dayMs - Number(exclusive)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  const date = new Date(timestamp - Number(exclusive))
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / dayMs
}
function bounds(record) {
  const start = dayNumber(record.start)
  const end = dayNumber(record.kind === 'event' ? record.end : record.due || record.end, record.kind === 'event')
  if (start === null && end === null) return null
  return [Math.min(start ?? end, end ?? start), Math.max(start ?? end, end ?? start)]
}
function closed(record) { return Boolean(record.completed) || ['COMPLETED', 'CANCELLED'].includes(String(record.status || '').toUpperCase()) }
function pairKey(fromId, toId) { return JSON.stringify([fromId, toId]) }

/** Scope comes from the caller's records. A work item may legitimately have several bookings. */
export function suggestEventMatches(records = [], relations = []) {
  const unique = [...new Map(records.map(record => [record.id, record])).values()]
  const works = unique.filter(record => ['task', 'card'].includes(record.kind) && ['tasks', 'deck'].includes(record.source)).map(record => ({record, title: titleInfo(record.title), dates: bounds(record)}))
  const events = unique.filter(record => record.kind === 'event' && record.source === 'calendar' && record.start && dayNumber(record.start) !== null && String(record.status || '').toUpperCase() !== 'CANCELLED').map(record => ({record, title: titleInfo(record.title), dates: bounds(record)}))
  const linked = new Set(relations.flatMap(edge => [pairKey(edge.fromId, edge.toId), pairKey(edge.toId, edge.fromId)]))
  const eventLinks = new Set(relations.filter(edge => ['scheduled_during', 'for_event'].includes(edge.type)).map(edge => edge.toId))
  const result = []
  for (const work of works) for (const event of events) {
    if (linked.has(pairKey(work.record.id, event.record.id))) continue
    const titleSimilarity = similarity(work.title, event.title)
    if (titleSimilarity < .73) continue
    const distance = work.dates && event.dates ? Math.max(0, work.dates[0] - event.dates[1], event.dates[0] - work.dates[1]) : null
    // Date proximity strengthens a name match; it can never create one.
    if (titleSimilarity < .96 && (distance === null ? titleSimilarity < .9 : distance > 14)) continue
    if (titleSimilarity < .85 && distance !== 0) continue
    const reasons = [work.title.full === event.title.full ? 'Same title' : work.title.core === event.title.core ? 'Same title without extra notes' : titleSimilarity >= .88 ? 'Very similar titles' : 'Similar titles']
    if (distance === null) reasons.push('Work item has no dates')
    else if (distance === 0) reasons.push(work.dates[0] === work.dates[1] ? 'Same day' : 'Event falls within work dates')
    else reasons.push(`Dates are ${distance} ${distance === 1 ? 'day' : 'days'} apart`)
    const warnings = []
    if (distance !== null && distance > 7) warnings.push('Dates are far apart')
    if (closed(work.record)) warnings.push('Work is already completed or cancelled')
    if (eventLinks.has(event.record.id)) warnings.push('Event is already linked to other work')
    // Parenthetical context can distinguish two clients/projects, even when the
    // main titles match. Surface the pair, but ask for deliberate confirmation.
    const extraNotesDiffer = titleSimilarity === 1 && work.title.full !== event.title.full && JSON.stringify(work.title.contextNotes) !== JSON.stringify(event.title.contextNotes)
    if (extraNotesDiffer) warnings.push('Extra title notes differ')
    const recommended = !warnings.length && (distance === null ? titleSimilarity >= .98 : titleSimilarity >= .9 && distance <= 3)
    result.push({id: pairKey(work.record.id, event.record.id), fromId: work.record.id, toId: event.record.id, work: work.record, event: event.record, titleSimilarity, dateDistanceDays: distance, score: Math.round(titleSimilarity * 85 + (distance === 0 ? 15 : distance !== null && distance <= 3 ? 10 : distance !== null && distance <= 7 ? 5 : 0)), reasons, warnings, ambiguous: false, recommended})
  }
  const byEvent = new Map(), byUndatedWork = new Map()
  for (const candidate of result) {
    byEvent.set(candidate.toId, [...(byEvent.get(candidate.toId) || []), candidate])
    if (candidate.dateDistanceDays === null) byUndatedWork.set(candidate.fromId, [...(byUndatedWork.get(candidate.fromId) || []), candidate])
  }
  for (const candidates of byEvent.values()) {
    const best = Math.max(...candidates.map(candidate => candidate.score))
    const competing = candidates.filter(candidate => candidate.score >= best - 12)
    if (competing.length > 1) for (const candidate of competing) {candidate.ambiguous = true; candidate.recommended = false; candidate.warnings.push('Several work items match this event')}
  }
  for (const candidates of byUndatedWork.values()) if (candidates.length > 1) for (const candidate of candidates) {candidate.ambiguous = true; candidate.recommended = false; candidate.warnings.push('Several events match this undated item')}
  return result.sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.score - a.score || a.work.title.localeCompare(b.work.title) || a.event.start.localeCompare(b.event.start) || a.id.localeCompare(b.id))
}
