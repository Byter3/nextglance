/** Network reads/sync run beside native mutations and short local operations.
 * Account changes form a barrier so no operation can use a different account
 * halfway through its work. Mutation ordering stays intact for source edits. */
class OperationLanes {
  constructor() { this.mutations = Promise.resolve(); this.context = Promise.resolve(); this.sideJobs = new Set() }
  run(operation, { parallel = false, contextChange = false } = {}) {
    const gate = this.context
    let result
    if (contextChange) {
      const before = [...this.sideJobs]
      result = this.mutations.then(async () => { await Promise.allSettled(before); return operation() })
      this.context = result.catch(() => {})
      this.mutations = this.context
    } else if (parallel) {
      result = gate.then(operation)
      this.sideJobs.add(result)
      result.then(() => this.sideJobs.delete(result), () => this.sideJobs.delete(result))
    } else {
      result = this.mutations.then(() => gate).then(operation)
      this.mutations = result.catch(() => {})
    }
    return result
  }
  idle() { return Promise.allSettled([this.mutations, ...this.sideJobs]) }
}
module.exports = { OperationLanes }
