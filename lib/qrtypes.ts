// Common API for interacting with queries and results
import * as I from './interfaces'
import field from './types/field'
import resultmap from './types/map'
import range from './types/range'

type SetOrMap<T> = Map<T, any> | Set<T>
function eachIntersect<T>(c1: SetOrMap<T>, c2: SetOrMap<T>, fn: (v:T) => void) {
  const [larger, smaller] = c1.size > c2.size ? [c1, c2] : [c2, c1]
  for (let k of smaller.keys()) if (larger.has(k)) fn(k)
}

const id = <T>(x: T) => x

type PartialQueryOPs = {
  [P in keyof I.QueryOps<any>]?: I.QueryOps<any>[P]
}

export const queryTypes: {[name: string]: I.QueryOps<any>} = {}
const registerQuery = (name: I.QueryType, resultType: I.ResultOps<any, I.Txn>, fields: PartialQueryOPs = {}) => {
  queryTypes[name] = {
    toJSON: id, fromJSON: id,
    adaptTxn: id,
    ...fields,
    name,
    resultType,
  }
}

// The query is a placeholder. The value is just a single field that you can
// mutate directly.
registerQuery('single', field)

// The query is a placeholder and the resulting value is a KV map of key -> value.
registerQuery('allkv', resultmap)

// The query is a set of keys. The results are a KV map from key -> value.
registerQuery('kv', resultmap, {
  toJSON(s) { return Array.from(s) },
  fromJSON(data) { return new Set(data) },
  adaptTxn(txn: I.KVTxn, query: I.KVQuery) {
    let result: I.KVTxn | null = null
    eachIntersect<I.Key>(txn, query, k => {
      if (result == null) result = new Map<I.Key, I.Op>()
      result.set(k, <I.Op>txn.get(k))
    })
    return result
  },
})


// The query is a list of ranges and the results are a corresponding list of
// lists of [key, value] pairs.

// TODO: Consider removing this by default from the web build, to save on
// bundle size. This will be especially important once we actually use binary
// search properly.

const adaptTxnToRange = (txn: I.KVTxn, query: I.StaticRangeQuery): I.RangeResult | null => {
  let result: I.RangeResult = []
  let empty = true
  for (let i = 0; i < query.length; i++) {
    const q = query[i]
    const r: [I.Key, I.Val][] = []
    result.push(r)

    // We have no idea where the limit bounds are. One solution here would
    // be to just ignore the limit. This is used in getOps, where the query
    // should be baked to a static query before being passed through.
    // if (q.limit || q.from.offset || q.to.offset) {
    //   throw Error('adaptTxn on range query with limit not supported')
    // }

    for (const entry of txn) {
      const [k, v] = entry
      if ((k > q.from.k || (!q.from.isAfter && k === q.from.k))
        && (k < q.to.k || (q.from.isAfter && k === q.to.k))
      ) {
        r.push(entry)
        empty = false
      }
    }
  }
  return empty ? null : result
}


registerQuery('static range', range, {
  adaptTxn: adaptTxnToRange,
})

registerQuery('range', range, {
  adaptTxn: () => {
    // TODO: Might be better to automatically try and convert the query
    // instead of bailing.
    throw Error('adaptTxn on full range query not supported')
  },
})

export const resultTypes: {[name: string]: I.ResultOps<any, I.Txn>} = {
  single: field,
  kv: resultmap,
  range,
}

export const wrapQuery = (type: I.QueryType, data: I.QueryData): I.Query => (
  {type, q: data} as I.Query
)
