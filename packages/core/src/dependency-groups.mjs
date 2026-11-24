import {unifiedStatus} from './status-mapping.mjs';

/** One directional projection for every work kind; unavailable peers stay visible. */
export function dependencyGroups(recordId, records, relations, statusMapping) {
  const byId = new Map(records.map(record => [record.id, record]));
  const incoming = [], outgoing = [];
  const peer = (edge, id) => {
    const record = byId.get(id);
    const status = statusMapping && record?.kind === 'task' ? unifiedStatus(record, statusMapping) : null;
    return {...edge, record, ...(status ? {status} : {})};
  };
  for (const edge of relations) {
    if (edge.type !== 'depends_on') continue;
    if (edge.fromId === recordId) incoming.push(peer(edge, edge.toId));
    if (edge.toId === recordId) outgoing.push(peer(edge, edge.fromId));
  }
  return {incoming, outgoing};
}
