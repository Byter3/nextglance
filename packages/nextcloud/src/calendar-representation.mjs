/** Compare complete iCalendar content without transport-only line formatting. */
export function calendarContentEquivalent(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const contentLines = value => value.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').replace(/\n$/, '');
  return contentLines(left) === contentLines(right);
}

/** Evaluate a successful conditional GET against the original strong DAV revision. */
export function calendarDeletePreflight({baseline, body, etag, responseEtag, davEtag}) {
  if (!calendarContentEquivalent(baseline, body)) return 'conflict';
  if (responseEtag === null || responseEtag === etag) return 'verified';
  if (davEtag === undefined) return 'check-dav';
  return davEtag === etag ? 'verified' : 'conflict';
}
