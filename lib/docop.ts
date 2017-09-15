// This is the master operation type documents.
//
// This is used for interpretting transactions sent to the server through
// mutate() and transactions sent to client subscriptions.
//
// It implements set and remove, and forwards the actual changes to
// child op types, which can be registered using the register function below.
import {SingleOp, Op} from '../common/interfaces'
import {OTType, AnyOTType, OTWithCompose} from '../common/type'

const typeRegistry: {[name: string]: AnyOTType} = {}
const supportedTypes = new Set(['rm', 'set'])

function register(type: AnyOTType) {
  typeRegistry[type.name] = type
  supportedTypes.add(type.name)
}

// register(require('../common/rangeops'))
// register(require('../common/setops'))



// The 'inc' type is a tiny dummy type.
register({
  name: 'inc',
  create(data) { return data|0 },
  apply(snapshot, op) { // Op is a number
    return snapshot + op
  },
})

function typeOrThrow(typeName: string): AnyOTType {
  const type = typeRegistry[typeName]
  if (!type) throw Error('Unsupported type ' + typeName)
  return type
}

function appendMut(a: Op, b: SingleOp) {
  const {type} = b
  // Rm and set override preceding data in the stream.
  if (type === 'rm'
    || type === 'set'
    || Array.isArray(b) && b.length === 0) return b

  // If we have a type with a compose function, use it.
  const last = Array.isArray(a) ? a[a.length - 1] : a
  if (type === last.type) {
    const t = typeRegistry[type]
    if (t && t.compose) {
      if (Array.isArray(a)) {
        a[a.length - 1] = t.compose(last.data, b.data)
        return a
      } else {
        return t.compose(last.data, b.data)
      }
    }
  }

  // Otherwise just turn it into a composite op.
  if (Array.isArray(a)) {
    a.push(b)
    return a
  } else return [a, b]
}

const fieldType: OTWithCompose<any, Op> = {
  name: 'sc',
  create(data) {
    // Remember, this is creating a document.
    return data
  },
  
  apply(snapshot: any, op: Op) {
    if (Array.isArray(op)) {
      // Multi operation.
      for (let i = 0; i < op.length; i++) {
        // Recurse.
        snapshot = this.apply(snapshot, op[i])
      }
      return snapshot
    }

    const {type:typeName, data} = op

    switch (typeName) {
      case 'rm': return undefined
      case 'set': return data
      default: {
        return typeOrThrow(typeName).apply(snapshot, data)
      }
    }
  },

  compose(op1, op2) {
    if (Array.isArray(op2)) {
      // This is textbook reduce territory.
      let comp = op1
      for (let i = 0; i < op2.length; i++) {
        // Recurse.
        appendMut(comp, op2[i])
      }
      return comp
    } else {
      // Now just the single case.
      return appendMut(op1, op2)
    }
  },
}


// TODO: + Register string, JSON, etc.


// I'm just going to export the utilities with the type. Its .. not ideal, but
// there's no clear line between what should be part of the result set type and
// what is just utility methods. This'll be fine for now.
export {fieldType, register, supportedTypes}
