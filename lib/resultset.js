// This is the master operation type for a set of documents.
//
// This is used for interpretting transactions sent to the server through
// mutate() and transactions sent to client subscriptions.
//
// It really just implements a collection and forwards the actual changes to
// child op types, which can be registered using the register function.
const typeRegistry = {}
const supportedTypes = new Set(['rm', 'set'])
function register(type) {
  typeRegistry[type.name] = type
  supportedTypes.add(type.name)
}

register(require('../common/rangeops'))
register(require('../common/setops'))

const type = module.exports = {
  name: 'resultset',
  create(data) {
    return new Map(data)
  },

  apply(snapshot, op) {
    return type.applyMut(new Map(snapshot), op)
  },

  // More efficient version of apply which edit the collection in-place.
  // Although I haven't actually benchmarked the code above - maybe its fine?
  applyMut(snapshot, op) {
    // An op is a map of key => {type, data} for how the value changes.
    for (const [key, docop] of op) {
      const successor = type.applyOne(snapshot.get(key), docop)
      if (successor === undefined) {
        snapshot.delete(key)
      } else {
        snapshot.set(key, successor)
      }
    }
    return snapshot
  },

  applyOne(snapshot, op) {
    const {type:typeName, data} = op

    switch (typeName) {
      case 'rm': return undefined
      case 'set': return data
      default: {
        const type = typeRegistry[typeName]
        if (!type) throw Error('Unsupported type ' + typeName)
        return type.apply(snapshot, data)
      }
    }
  },

  simplifyOp(op) {
    if (op.type === 'rm' || op.type === 'set') return op
    else return {type:'set', data: op.newVal}
  },

}

// The 'inc' type is a tiny dummy type.
register({
  name: 'inc',
  create(data) { return data|0 },
  apply(snapshot, op) { // Op is a number
    return snapshot + op
  },
})

// TODO: Register string, JSON, etc.

module.exports = {type, register, supportedTypes}


