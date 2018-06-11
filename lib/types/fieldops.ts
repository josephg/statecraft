import {SingleOp, Op} from './interfaces'
import {ResultOps} from './type'
import {typeOrThrow, supportedTypes, typeRegistry} from './registry'

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

const type: ResultOps<any, Op> = {
  name: 'doc',

  create(data) {
    // Remember, this is creating a document.
    return data
  },

  apply(snapshot: any, op: Op) {
    if (Array.isArray(op)) {
      // Multi operation.
      for (let i = 0; i < op.length; i++) {
        // Recurse.
        snapshot = type.apply(snapshot, op[i])
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

  // TODO: Add applyMut.

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

  asOp(snap: any) {
    return (snap == null) ? {type:'rm'} : {type:'set', data:snap}
  },

  from(type, data) {
    switch(type) {
      case 'single': return data
      case 'resultmap': return data.get('content')
    }
  },

  checkOp(op, snap) {
    type.apply(snap, op) // this will throw if invalid. TODO: use check on subtype if available.
  },

  map(data, fn) { return fn(data, null) },
  mapAsync(data, fn) { return fn(data, null) },
}
export default type