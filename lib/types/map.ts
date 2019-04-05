import * as I from '../interfaces'
import fieldOps from './field'

const mapMapEntry = <In, Out>(input: Map<I.Key, In>, fn: (key: I.Key, val: In) => [I.Key, Out] | null) => {
  const result = new Map<I.Key, Out>()
  for (const [k, val] of input) {
    const newEntry = fn(k, val)
    if (newEntry != null) result.set(newEntry[0], newEntry[1])
  }
  return result
}

// Could just write this in terms of mapMapEntry above.
const mapMapVal = <In, Out>(input: Map<I.Key, In>, fn: (val: In, key: I.Key) => Out) => {
  const result = new Map<I.Key, Out>()
  for (const [k, val] of input) result.set(k, fn(val, k))
  return result
}

const mapEntryAsync = <In, Out>(input: Map<I.Key, In>, fn: (key: I.Key, val: In) => Promise<[I.Key, Out] | null>) => {
  const entries = Array.from(input.entries())
  const mapped = entries.map(([k, v]) => fn(k, v))
  return Promise.all(mapped).then((results) => new Map(results.filter(e => e != null) as [I.Key, Out][]))
}

const mapAsync = <In, Out>(input: Map<I.Key, In>, fn: (val: In, key: I.Key) => Promise<Out>) => (
  mapEntryAsync(input, (k, v) => fn(v, k).then(v2 => ([k, v2] as [I.Key, Out])))
)

type Val = any
const type: I.ResultOps<Val, Map<I.Key, Val>, I.KVTxn<Val>> = {
  name: 'kv',
  type: I.ResultType.KV,

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
    const newdata = new Map<I.Key, Val>(snap)
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
    return {type: I.QueryType.KV, q: new Set(snap.keys())}
  },

  filterSupportedOps(op, values: Map<I.Key, Val>, supportedTypes) {
    // console.log('fso', op, values)
    return mapMapVal(op, (o, k) => (
      fieldOps.filterSupportedOps(o, values.get(k), supportedTypes))
    )
  },

  updateResults(s: Map<I.Key, Val>, q: I.ReplaceQuery, data: Map<I.Key, Val>) {
    if (q.type === I.QueryType.KV) {
      for (const k of q.q) {
        if (data.has(k)) s.set(k, data.get(k))
        else s.delete(k)
      }
      return s
    } else return data // allkv.
    // I'm not sure if we should look at q.q for this ??
    // } else return q.q ? data : s // allkv.
  },
}
export default type
