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
  },


  // Split an op into two parts - the part that intersects with the snapshot
  // and the part that doesn't.
  split(op, snapshot) {
    const inner = {}, outer = {}

    if (op.remove) for (let i = 0; i < op.remove.length; i++) {
      const r = op.remove[i]
      if (snapshot.has(r)) {
        if (!inner.remove) inner.remove = []
        inner.remove.push(r)
      } else {
        if (!outer.remove) outer.remove = []
        outer.remove.push(r)
      }
    }
    if (op.add) for (let i = 0; i < op.add.length; i++) {
      const a = op.add[i]
      if (snapshot.has(a)) {
        if (!inner.add) inner.add = []
        inner.add.push(a)
      } else {
        if (!outer.add) outer.add = []
        outer.add.push(a)
      }
    }

    return [inner, outer]
  },

  asAddOp(snapshot) {
    return snapshot.size ? {add: Array.from(snapshot)} : {}
  },
  asRemoveOp(snapshot) {
    return snapshot.size ? {remove: Array.from(snapshot)} : {}
  },

  isEmpty(snapshot) { return snapshot.size === 0 },
  isNoop(op) {
    return (!op.remove || op.remove.length === 0) && (!op.add || op.add.length === 0)
  },

}
