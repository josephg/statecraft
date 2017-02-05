
const type = module.exports = {
  name: 'set',
  create(data) {
    // TODO: Assert the data is a set.
    return Array.isArray(data) ? new Set(data) : data
  },

  apply(snapshot, op) {
    // Hm, sadly I want immutable semantics here, so I'm going to need to do a
    // shallow clone of the set.
    const result = new Set(snapshot)
    if (op.remove) for (let i = 0; i < op.remove.length; i++) {
      result.delete(op.remove[i])
    }
    if (op.add) for (let i = 0; i < op.add.length; i++) {
      result.add(op.add[i])
    }
    return result
  }
}
