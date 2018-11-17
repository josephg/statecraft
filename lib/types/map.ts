import * as I from '../interfaces'
import fieldOps from './field'

const mapMap = <T, R>(input: Map<I.Key, T>, fn: (val: T, key: I.Key) => R) => {
  const result = new Map<I.Key, R>()
  for (const [k, val] of input) result.set(k, fn(val, k))
  return result
}

const mapAsync = <T, R>(input: Map<I.Key, T>, fn: (val: T, key: I.Key) => Promise<R>) => {
  const entries = Array.from(input.entries())
  const mapped = entries.map(([k, v]) => fn(v, k))
  return Promise.all(entries).then((results) => {
    const result = new Map<I.Key, I.Val>()
    for (let i = 0; i < entries.length; i++) {
      result.set(entries[i][0], results[i])
    }
    return result
  })
}

const type: I.ResultOps<Map<I.Key, I.Val>, I.KVTxn> = {
  name: 'resultmap',

  create(data) {
    return data instanceof Map ? data : new Map(data)
  },

  applyMut(snap, op) {
    for (var [k, docop] of op) {
      const oldval = snap.get(k)
      const newval = fieldOps.apply(oldval, docop)

      // Statecraft considers null / undefined to be the same as a document not existing.
      if (newval == null) snap.delete(k)
      else snap.set(k, newval)
    }
  },

  apply(snap, op) {
    const newdata = new Map<I.Key, I.Val>(snap)
    type.applyMut!(newdata, op)
    return newdata
  },

  composeMut(txn, other) {
    for (const [k, op] of other) {
      const orig = txn.get(k)
      if (orig == null) txn.set(k, op)
      else {
        txn.set(k, fieldOps.compose(orig, op))
      }
    }
  },

  compose(a, b) {
    const result = new Map(a)
    type.composeMut!(result, b)
    return result
  },

  filter<K, V>(snap: Map<K, V>, query: Set<K>): Map<K, V> {
    const result = new Map<K, V>()
    for (const k of query) {
      const v = snap.get(k)
      if (v !== undefined) result.set(k, v)
    }
    return result
  },

  // from(type, data) {
  //   switch(type) {
  //     case 'single': return new Map<I.Key, I.Val>([['content', data]])
  //     case 'resultmap': return data
  //   }
  // },

  snapToJSON(snap) { return Array.from(snap) },
  snapFromJSON(data) { return new Map(data) },
  opToJSON(op) { return Array.from(op) },
  opFromJSON(data) { return new Map(data) },

  map: mapMap,
  mapAsync,
  mapTxn: mapMap,
  mapTxnAsync: mapAsync,

  getCorrespondingQuery(snap) {
    return {type: 'kv', q: new Set(snap.keys())}
  },

  filterSupportedOps(op, view: Map<I.Key, I.Val>, supportedTypes) {
    return mapMap(op, (o, k) => (
      fieldOps.filterSupportedOps(o, view.get(k), supportedTypes))
    )
  },
}
export default type
