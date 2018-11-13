import * as I from './interfaces'
import {ResultOps} from './type'
import fieldOps from './fieldops'

// This is interesting because there's sort of 3 levels going on here:
//
// - A result snapshot is a kv store, and an operation is a transaction
// -
const type: ResultOps<Map<I.Key, I.Val>, I.KVTxn> = {
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

  from(type, data) {
    switch(type) {
      case 'single': return new Map<I.Key, I.Val>([['content', data]])
      case 'resultmap': return data
    }
  },

  snapToJSON(snap) { return Array.from(snap) },
  opToJSON(op) { return Array.from(op) },
  opFromJSON(data) { return new Map(data) },

  map(snap, fn) {
    const result = new Map<I.Key, I.Val>()
    for (const [k, val] of snap) result.set(k, fn(val, k))
    return result
  },

  mapAsync(snap, fn) {
    const entries = Array.from(snap.entries())
    const mapped = entries.map(([k, v]) => fn(v, k))
    return Promise.all(entries).then((results) => {
      const result = new Map<I.Key, I.Val>()
      for (let i = 0; i < entries.length; i++) {
        result.set(entries[i][0], results[i])
      }
      return result
    })
  },

  getCorrespondingQuery(snap) {
    return {type: 'kv', q: new Set(snap.keys())}
  },
}
export default type
