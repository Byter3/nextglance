/** Keep native Deck dependency storage separate from cross-application links. */
export function deckDependencyPair(records, edge) {
  const from = records.find(record => record.id === edge.fromId)
  const to = records.find(record => record.id === edge.toId)
  return from?.kind === 'card' && from.source === 'deck' && to?.kind === 'card' && to.source === 'deck' ? {from, to} : null
}

export function deckDependencyProblem(records, edge, available = true) {
  const pair = deckDependencyPair(records, edge)
  if (!pair) return 'Both Deck cards must be loaded before editing their dependency.'
  if (!available) return 'Connect and refresh Deck to save this dependency in Nextcloud.'
  if (pair.from.readonly) return 'The card that waits for this work is read only in Deck.'
  if (pair.from.id === pair.to.id) return 'A card cannot depend on itself.'
  return ''
}

/** Legacy directed links remain recoverable until Deck has acknowledged them. */
export function pendingDeckDependencies(workspace, records) {
  return (workspace?.relations || []).filter(edge => edge.type === 'depends_on' && deckDependencyPair(records, edge))
}
