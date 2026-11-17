/** Compare complete iCalendar content without transport-only line formatting. */
export function calendarContentEquivalent(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const contentLines = value => value.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').replace(/\n$/, '');
  return contentLines(left) === contentLines(right);
}
