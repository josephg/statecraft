// Common API for interacting with queries and results
import * as I from './interfaces'
import field from './types/field'
import resultmap from './types/map'
import range, {findRangeStatic} from './types/range'
import err from './err'
import sel from './sel'



// import {inspect} from 'util'
// const ins = (x: any) => inspect(x, {depth: null, colors: true})


type SetOrMap<T> = Map<T, any> | Set<T>
function eachIntersect<T>(c1: SetOrMap<T>, c2: SetOrMap<T>, fn: (v:T) => void) {
  const [larger, smaller] = c1.size > c2.size ? [c1, c2] : [c2, c1]
  for (let k of smaller.keys()) if (larger.has(k)) fn(k)
}

const id = <T>(x: T) => x

type PartialQueryOPs = {
  [P in keyof I.QueryOps<any>]?: I.QueryOps<any>[P]
}

const mapSetKeys = <T, R>(q: Set<T>, fn: (k: T, i: number) => R | null): Set<R> => (
  new Set(Array.from(q.keys()).map(fn).filter(k => k != null) as R[])
)

// const defaultReplaceAll = <Q extends I.Query>(q: Q, data: I.ResultData): {q: I.ReplaceQuery, with: I.ReplaceData} => {
//   if (q.type === 'range' || q.type === 'static range') throw new err.InvalidDataError()
//   return {q: {type: q.type, q: q.q as any} as I.ReplaceQuery, with: data}
// }


const nyi = () => {throw Error('Not implemented')}
export const queryTypes: {[name: string]: I.QueryOps<any>} = {}
const registerQuery = (name: I.QueryType, resultType: I.ResultOps<any, I.Txn>, fields: PartialQueryOPs = {}) => {
  queryTypes[name] = {
    // createEmpty: () => null,
    toJSON: id, fromJSON: id,
    adaptTxn: id,
    composeCR: nyi,
    // fetchToReplace: defaultReplaceAll,
    fetchToReplace: (q, data) => ({q: {type: name, q}, with: data}),
    updateQuery: (q, op) => op,
    ...fields,
    name,
    resultType,
  }
}

// The query is a placeholder. The value is just a single field that you can
// mutate directly.
registerQuery('single', field, {
  composeCR(a, b) {
    return b
  },
})

// The query is a placeholder and the resulting value is a KV map of key -> value.
registerQuery('allkv', resultmap, {
  // createEmpty: () => new Set<I.Key>(),
  mapKeys: mapSetKeys,
  composeCR(a, b) {
    resultmap.copyInto!(a.with, b.with)
    return a
  },
})

// The query is a set of keys. The results are a KV map from key -> value.
registerQuery('kv', resultmap, {
  // createEmpty: () => new Set<I.Key>(),
  toJSON(s) { return Array.from(s) },
  fromJSON(data) { return new Set(data) },
  mapKeys: mapSetKeys,
  adaptTxn(txn: I.KVTxn, query: I.KVQuery): I.KVTxn | null {
    let result: I.KVTxn | null = null
    eachIntersect<I.Key>(txn, query, k => {
      if (result == null) result = new Map<I.Key, I.Op>()
      result.set(k, <I.Op>txn.get(k))
    })
    return result
  },
  composeCR(a, b) {
    for (const k of b.q.q) a.q.q.add(k)
    resultmap.copyInto!(a.with, b.with)
    return a
  },
  updateQuery(q: I.KVQuery | null, op: I.KVQuery) {
    if (q == null) q = new Set()
    for (const k of op) q.add(k)
    return q
  },
  // TODO: Consider making fetchToReplace return {type: 'allkv'} to save bandwidth.
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
      if (sel.kWithin(k, q.low, q.high)) {
        r.push(entry)
        empty = false
      }
    }
  }
  return empty ? null : result
}


const mapRangeKeys = (q: I.RangeQuery, fn: (k: I.Key, i: number) => I.Key | null): I.RangeQuery => (
  q.map((qc, i) => ({
    ...qc,
    low: {k: fn(qc.low.k, i), ...qc.low},
    high: {k: fn(qc.high.k, i), ...qc.high},
  }))
)

type CatchupRangeReplace = I.CatchupReplace<{type: 'static range', q: I.StaticRangeQuery[]}, I.RangeResult[]>

registerQuery('static range', range, {
  // createEmpty: (q) => new Array(q.length),
  mapKeys: mapRangeKeys,
  adaptTxn: adaptTxnToRange,
  composeCR(a: CatchupRangeReplace, b: CatchupRangeReplace) {
    const aqd = a.q.q, bqd = b.q.q
    if (aqd.length !== bqd.length) throw new err.InvalidDataError()

    for (let i = 0; i < aqd.length; i++) {
      const aq = aqd[i], bq = bqd[i]

      // TODO: This is totally not ideal, but its probably correct. And the
      // times when the difference matters are rare.
      aq.push(...bq)
      a.with[i].push(...b.with[i])
    }

    return a
  },

  fetchToReplace(q: I.StaticRangeQuery, data: I.RangeResult) {
    return {
      q: {type: 'static range', q: q.map(x => [x])},
      with: data.map(x => [x])
    }
  },

  updateQuery(q: I.StaticRangeQuery | null, op: I.StaticRangeQuery[]) {
    if (q == null) return op.map(x => x[0]) // TODO: Check that all the ranges have 1 item.
    else {
      if (q.length !== op.length) throw new err.InvalidDataError()

      for (let i = 0; i < q.length; i++) {
        nyi()
      }
      return q
    }
  },
})

registerQuery('range', range, {
  // createEmpty: (q) => new Array(q.length),
  mapKeys: mapRangeKeys,
  adaptTxn: () => {
    // TODO: Might be better to automatically try and convert the query
    // instead of bailing.
    throw Error('adaptTxn on full range query not supported')
  },

  fetchToReplace(q: I.RangeQuery, data: I.RangeResult) {
    return {
      q: {type: 'static range', q: q.map(x => [x])},
      with: data.map(x => [x])
    }
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
