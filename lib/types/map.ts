import * as I from '../interfaces'
import fieldOps from './field'

const mapMapEntry = <T, R>(input: Map<I.Key, T>, fn: (key: I.Key, val: T) => [I.Key, R] | null) => {
  const result = new Map<I.Key, R>()
  for (const [k, val] of input) {
    const newEntry = fn(k, val)
    if (newEntry != null) result.set(newEntry[0], newEntry[1])
  }
  return result
}

// Could just write this in terms of mapMapEntry above.
const mapMapVal = <T, R>(input: Map<I.Key, T>, fn: (val: T, key: I.Key) => R) => {
  const result = new Map<I.Key, R>()
  for (const [k, val] of input) result.set(k, fn(val, k))
  return result
}

const mapEntryAsync = <T, R>(input: Map<I.Key, T>, fn: (key: I.Key, val: T) => Promise<[I.Key, R] | null>) => {
  const entries = Array.from(input.entries())
  const mapped = entries.map(([k, v]) => fn(k, v))
  return Promise.all(entries).then((results) => new Map(results.filter(e => e != null)))
}

const mapAsync = <T, R>(input: Map<I.Key, T>, fn: (val: T, key: I.Key) => Promise<R>) => (
  mapEntryAsync(input, (k, v) => fn(v, k).then(v2 => ([k, v2] as [I.Key, R])))
)

const type: I.ResultOps<Map<I.Key, I.Val>, I.KVTxn> = {
  name: 'kv',

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

  composeResultsMut(dest, src) {
    // For maps this is the same as copyInto.
    return type.copyInto!(dest, src)
  },

  copyInto(dest, src) {
    for (const [k, v] of src) dest.set(k, v)
    return dest
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

  mapEntries: mapMapEntry,
  mapEntriesAsync: mapEntryAsync,
  map: mapMapVal,
  mapAsync,
  mapTxn: mapMapVal,
  mapTxnAsync: mapAsync,

  mapReplace: mapMapVal,

  snapToJSON(snap) { return Array.from(snap) },
  snapFromJSON(data) { return new Map(data) },
  opToJSON(op) { return Array.from(op) },
  opFromJSON(data) { return new Map(data) },

  getCorrespondingQuery(snap) {
    return {type: 'kv', q: new Set(snap.keys())}
  },

  filterSupportedOps(op, view: Map<I.Key, I.Val>, supportedTypes) {
    return mapMapVal(op, (o, k) => (
      fieldOps.filterSupportedOps(o, view.get(k), supportedTypes))
    )
  },
}
export default type
