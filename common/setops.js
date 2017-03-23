// This is a really simple little module for set operations.
//
// Set ops are simply an object with optional .remove and .add keys, which each
// contain lists of items to add and remove.
const type = module.exports = {
  name: 'set',
  create(data) {
    return new Set(data) // Handles another set, array or empty just fine.
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
