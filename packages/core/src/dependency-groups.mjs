/** One directional projection for every work kind; unavailable peers stay visible. */
export function dependencyGroups(recordId, records, relations) {
  const byId = new Map(records.map(record => [record.id, record]));
  const incoming = [], outgoing = [];
  for (const edge of relations) {
    if (edge.type !== 'depends_on') continue;
    if (edge.fromId === recordId) incoming.push({...edge, record: byId.get(edge.toId)});
    if (edge.toId === recordId) outgoing.push({...edge, record: byId.get(edge.fromId)});
  }
  return {incoming, outgoing};
}
