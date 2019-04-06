import {QueryType, ResultType, SingleOp, Op, ResultOps} from '../interfaces'
import {typeOrThrow, supportedTypes, typeRegistry} from '../typeregistry'

function appendMut<Val>(a: Op<Val>, b: SingleOp<Val>) {
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

const id = <T>(x: T) => x
const apply2 = <T, R>(x: T, fn: (x: T, y: null) => R) => fn(x, null)

const type: ResultOps<any, any, Op<any>> = {
  name: 'single',
  type: ResultType.Single,

  create(data) {
    // Remember, this is creating a document.
    return data
  },

  apply<Val>(snapshot: Val, op: Op<Val>) {
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

  // from(type, data) {
  //   switch(type) {
  //     case 'single': return data
  //     case 'kv': return data.get('content')
  //   }
  // },

  checkOp(op, snap) {
    type.apply(snap, op) // this will throw if invalid. TODO: use check on subtype if available.
  },

  mapEntries: (v, fn) => {
    const v2 = fn(null, v)
    return v2 != null ? v2[1] : null
  },
  mapEntriesAsync: (v, fn) => fn(null, v).then(x => x == null ? null : x[1]),
  
  map: apply2,
  mapAsync: apply2,
  mapTxn: apply2,
  mapTxnAsync: apply2,

  mapReplace: apply2,
  

  snapToJSON: id,
  snapFromJSON: id,
  opToJSON: id,
  opFromJSON: id,


  getCorrespondingQuery(data) { return {type: QueryType.Single, q: true} },

  filterSupportedOps(txn, view, supportedTypes) {
    if (Array.isArray(txn)) {
      let hasAll = true
      for (let i = 0; i < txn.length; i++) {
        if (!supportedTypes.has(txn[i].type)) hasAll = false
      }
      return hasAll ? txn : type.asOp(view)
    } else {
      return supportedTypes.has(txn.type) ? txn : type.asOp(view)
    }
  },

  composeResultsMut(a, b) { return b },

  updateResults: (s, q, data) => data,
}

export default type