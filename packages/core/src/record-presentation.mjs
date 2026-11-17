/** Only normalized colors reach CSS or native color inputs. */
export function normalizeColor(value) {
  if (typeof value !== 'string') return undefined;
  const color = value.trim();
  if (/^#?[a-f\d]{3}$/i.test(color)) return `#${color.replace('#', '').split('').map(c => c + c).join('')}`.toLowerCase();
  if (/^#?[a-f\d]{6}(?:[a-f\d]{2})?$/i.test(color)) return `#${color.replace('#', '').slice(0, 6)}`.toLowerCase();
  return undefined;
}

export function sourceColor(record, collections, fallback = '#0082c9') {
  return normalizeColor(collections?.find(collection => collection.id === record?.collectionId)?.color) || normalizeColor(fallback) || '#0082c9';
}

export function itemColor(record, collections, fallback = '#0082c9') {
  return normalizeColor(record?.color) || sourceColor(record, collections, fallback);
}

export function tagColorKey(collectionId, title) { return JSON.stringify([collectionId || '', title]); }

export function recordTags(record, workspace) {
  const details = Array.isArray(record?.tagDetails) ? record.tagDetails.filter(tag => typeof tag.title === 'string' && tag.title) : [];
  const names = [...new Set((record?.tags || []).filter(name => typeof name === 'string' && name && !details.some(tag => tag.title === name)))];
  return [...details, ...names.map(title => ({id:title,title}))].map(detail => {
    const title = detail.title;
    const nativeColor = normalizeColor(detail?.color);
    const customColor = record.source === 'tasks' ? normalizeColor(workspace?.properties?.['tag-colors']?.[tagColorKey(record.collectionId, title)]) : undefined;
    return {id: detail?.id || title, title, ...(nativeColor || customColor ? {color: nativeColor || customColor} : {}), native: Boolean(nativeColor) || record.source !== 'tasks'};
  });
}
