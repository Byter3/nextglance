/** Native event detail rules. Omitted fields are deliberately not defaulted. */
export function normalizeEventReminders(value) {
  if (!Array.isArray(value) || value.length > 5 || Array.from(value).some(minutes => !Number.isInteger(minutes) || minutes < 0 || minutes > 40320) || new Set(value).size !== value.length) throw new TypeError('Choose up to five different reminders, from 0 to 40320 whole minutes before the event.');
  return [...value].sort((left, right) => left - right);
}

export function normalizeEventDetails(input, {requireTitle = false} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Choose valid event details.');
  const result = {};
  for (const [key, limit] of [['title', 500], ['location', 2000], ['description', 500000]]) {
    if (input[key] === undefined && !(key === 'title' && requireTitle)) continue;
    const value = input[key];
    const normalized = typeof value === 'string' && key === 'title' ? value.trim() : value;
    if (typeof normalized !== 'string' || normalized.includes('\0') || normalized.length > limit || key === 'title' && !normalized) throw new TypeError(`Event ${key} is missing or too long.`);
    result[key] = normalized;
  }
  if (input.reminders !== undefined) result.reminders = normalizeEventReminders(input.reminders);
  return result;
}

export function linkedEventDescription(record) {
  const title = typeof record?.title === 'string' ? record.title : '';
  const source = typeof record?.collectionTitle === 'string' && record.collectionTitle ? record.collectionTitle : record?.source === 'deck' ? 'Deck' : 'Tasks';
  const lines = [`Scheduled work: ${title}`, `Source: ${source}`];
  if (typeof record?.url === 'string') {
    try {
      const url = new URL(record.url);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) lines.push(url.href);
    } catch { /* A missing safe native URL does not invent a reference. */ }
  }
  return lines.join('\n');
}

export function newEventDetails(record) {
  return {title: record?.title || '', location: '', description: record ? linkedEventDescription(record) : '', reminders: [15]};
}
