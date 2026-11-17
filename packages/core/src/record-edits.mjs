/** Optimistic edits are serialized per item, while unrelated items stay usable.
 * Only an acknowledged item is reconciled; a stale whole-state response must
 * never erase another pending edit or freshly changed planner metadata. */
export function createRecordEdits({read, write, changed = () => {}, failed = () => {}}) {
  const queues = new Map(), failures = new Map(), waiters = []
  const clone = value => structuredClone(value)
  function signal() {
    changed([...queues.values()].reduce((count, queue) => count + queue.operations.length, 0))
    if (!queues.size) waiters.splice(0).forEach(resolve => resolve())
  }
  function visible(queue) {
    return queue.operations.reduce((record, operation) => ({...record, ...operation.patch}), clone(queue.acknowledged))
  }
  async function drain(id, queue) {
    while (queue.operations.length) {
      const operation = queue.operations[0]
      try {
        const acknowledged = await operation.save(clone(queue.acknowledged))
        if (!acknowledged || acknowledged.id !== id) throw new Error('Nextcloud did not return the updated item. Refresh to check the save.')
        queue.acknowledged = clone(acknowledged)
        queue.operations.shift()
        write(id, visible(queue))
        operation.resolve(true)
      } catch (error) {
        const operations = queue.operations.splice(0)
        failures.set(id, operations.map(({patch, save}) => ({patch, save})))
        write(id, clone(queue.acknowledged))
        operations.forEach(operation => operation.resolve(false))
        failed(id, error, operations.map(operation => clone(operation.patch)))
      }
      if (!queue.operations.length) queues.delete(id)
      signal()
    }
  }
  function enqueue(id, patch, save) {
    const current = read(id)
    if (!current) return Promise.resolve(false)
    failures.delete(id)
    let queue = queues.get(id), start = false
    if (!queue) { queue = {acknowledged: clone(current), operations: []}; queues.set(id, queue); start = true }
    const result = new Promise(resolve => queue.operations.push({patch: clone(patch), save, resolve}))
    write(id, visible(queue))
    signal()
    if (start) void drain(id, queue)
    return result
  }
  return {
    enqueue,
    protectedIds() { return [...new Set([...queues.keys(),...failures.keys()])] },
    retry(id) {
      const operations = failures.get(id)
      if (!operations?.length) return Promise.resolve(false)
      failures.delete(id)
      return Promise.all(operations.map(operation => enqueue(id, operation.patch, operation.save))).then(results => results.every(Boolean))
    },
    discard(id) { failures.delete(id) },
    idle() { return queues.size ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve() },
  }
}
