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

function applyOne(snapshot, op) {
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
}

const type = module.exports = {
  name: 'resultset',
  create(data) {
    return new Map(data)
  },

  apply(snapshot, op) {
    const result = new Map(snapshot) // Immutable semantics. Is this the right idea here?

    // An op is a map of key => {type, data} for how the value changes.
    op.forEach((op, key) => {
      const successor = applyOne(result.get(key), op)
      if (successor === undefined) {
        result.delete(key)
      } else {
        result.set(key, successor)
      }
    })

    return result
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

module.exports = {type, register, supportedTypes, applyOne}


