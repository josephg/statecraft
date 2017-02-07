
const typeRegistry = {}
const supportedTypes = new Set(['rm', 'set'])
function register(type) {
  typeRegistry[type.name] = type
  supportedTypes.add(type.name)
}

const type = module.exports = {
  name: 'resultset',
  create(data) {
    return new Map(data)
  },

  apply(snapshot, op) {
    const result = new Map(snapshot) // Immutable semantics. Is this the right idea here?

    // An op is a map of key => {type, data} for how the value changes.
    op.forEach(({type:typeName, data}, key) => {
      switch(typeName) {
        case 'rm':
          result.delete(key)
          break
        case 'set':
          result.set(key, data)
          break
        default: {
          const type = typeRegistry[typeName]
          if (!type) throw Error('Unsupported type ' + typeName)
          result.set(key, type.apply(result.get(key), data))
        }
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

module.exports = {type, register, supportedTypes}


