/** Framework-free account barrier. New operations wait for selection changes;
 * selection changes wait for the operations already issued to the old account. */
export function createOperationGate() {
  let barrier = Promise.resolve()
  const active = new Set()
  /** @template T @param {() => T | Promise<T>} operation @returns {Promise<T>} */
  const run = operation => {
    const prior = barrier
    const result = prior.then(operation)
    active.add(result)
    void result.finally(() => active.delete(result)).catch(() => {})
    return result
  }
  /** @template T @param {() => T | Promise<T>} operation @returns {Promise<T>} */
  const transition = operation => {
    const earlier = [...active]
    const result = barrier.then(() => Promise.allSettled(earlier)).then(operation)
    barrier = result.catch(() => {})
    return result
  }
  return {run, transition}
}
