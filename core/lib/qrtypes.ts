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
export const queryTypes: I.QueryOps<any>[] = []
const registerQuery = (type: I.QueryType, resultType: I.ResultOps<any, any, I.Txn<any>>, fields: PartialQueryOPs = {}) => {
  queryTypes[type] = {
    // createEmpty: () => null,
    toJSON: id, fromJSON: id,
    adaptTxn: id,
    composeCR: nyi,
    // fetchToReplace: defaultReplaceAll,
    fetchToReplace: (q, data) => ({q: {type, q}, with: data}),
    updateQuery: (q, op) => op,
    ...fields,
    type,
    resultType,
  }
}

// The query is a placeholder. The value is just a single field that you can
// mutate directly.
registerQuery(I.QueryType.Single, field, {
  composeCR(a, b) {
    return b
  },
})

// The query is a placeholder and the resulting value is a KV map of key -> value.
registerQuery(I.QueryType.AllKV, resultmap, {
  // createEmpty: () => new Set<I.Key>(),
  mapKeys: mapSetKeys,
  composeCR(a, b) {
    resultmap.copyInto!(a.with, b.with)
    return a
  },
})

// The query is a set of keys. The results are a KV map from key -> value.
registerQuery(I.QueryType.KV, resultmap, {
  // createEmpty: () => new Set<I.Key>(),
  toJSON(s) { return Array.from(s) },
  fromJSON(data) { return new Set(data) },
  mapKeys: mapSetKeys,
  adaptTxn<Val>(txn: I.KVTxn<Val>, query: I.KVQuery): I.KVTxn<Val> | null {
    let result: I.KVTxn<Val> | null = null
    eachIntersect<I.Key>(txn, query, k => {
      if (result == null) result = new Map<I.Key, I.Op<Val>>()
      result.set(k, <I.Op<Val>>txn.get(k))
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

const adaptTxnToRange = <Val>(txn: I.KVTxn<Val>, query: I.StaticRangeQuery): I.RangeTxn<Val> | null => {
  let result: I.RangeTxn<Val> = []
  let empty = true
  for (let i = 0; i < query.length; i++) {
    const q = query[i]
    const r: [I.Key, I.Op<Val>][] = []
    result.push(r)

    // We have no idea where the limit bounds are. One solution here would
    // be to just ignore the limit. This is used in getOps, where the query
    // should be baked to a static query before being passed through.
    // if (q.limit || q.from.offset || q.to.offset) {
    //   throw Error('adaptTxn on range query with limit not supported')
    // }

    for (const k of Array.from(txn.keys()).sort()) {
      if (sel.kWithin(k, q.low, q.high)) {
        r.push([k, txn.get(k)!])
        empty = false
      }
    }
  }
  return empty ? null : result
}


const mapRangeKeys = (q: I.RangeQuery, fn: (k: I.Key, i: number) => I.Key | null): I.RangeQuery => {
  const result: I.RangeQuery = []
  q.forEach((qc, i) => {
    const lowK = fn(qc.low.k, i)
    const highK = fn(qc.high.k, i)
    
    if (lowK != null && highK != null) result.push({
      ...qc,
      low: {...qc.low, k: lowK},
      high: {...qc.high, k: highK},
    })
  })
  return result
}

type CatchupRangeReplace<Val> = I.CatchupReplace<Val, {
  type: I.QueryType.StaticRange,
  q: I.StaticRangeQuery[]
}, I.RangeResult<Val>[]>

registerQuery(I.QueryType.StaticRange, range, {
  // createEmpty: (q) => new Array(q.length),
  mapKeys: mapRangeKeys,
  adaptTxn: adaptTxnToRange,
  composeCR<Val>(a: CatchupRangeReplace<Val>, b: CatchupRangeReplace<Val>) {
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

  fetchToReplace<Val>(q: I.StaticRangeQuery, data: I.RangeResult<Val>) {
    return {
      // I'm wrapping each item in a list for a good but frustrating reason; but I can't
      // for the life of me remember why now :(
      q: {type: I.QueryType.StaticRange, q: q.map(x => [x])},
      with: data.map(x => [x])
    }
  },

  updateQuery(q: I.StaticRangeQuery | null, op: I.StaticRangeQuery[]) {
    // console.log('updateQuery', q, op)
    if (q == null) return op.map(x => x[0]) // TODO: Check that all the ranges have 1 item.
    else {
      if (q.length !== op.length) throw new err.InvalidDataError()

      for (let i = 0; i < q.length; i++) {
        let range = q[i]
        op[i].forEach(rop => {
          // Make range a union of range + rop
          // console.log('rop', rop)
          const result = sel.union(range.low, range.high, rop.low, rop.high)
          if (result == null) throw new err.InvalidDataError('Ranges do not overlap')
          range.low = result[0]; range.high = result[1]
        })
      }
      // console.log('-> q', q)
      return q
    }
  },
})

registerQuery(I.QueryType.Range, range, {
  // createEmpty: (q) => new Array(q.length),
  mapKeys: mapRangeKeys,
  adaptTxn: () => {
    // TODO: Might be better to automatically try and convert the query
    // instead of bailing.
    throw new Error('adaptTxn on full range query not supported')
  },

  fetchToReplace<Val>(q: I.RangeQuery, data: I.RangeResult<Val>) {
    return {
      q: {type: I.QueryType.StaticRange, q: q.map(x => [x])},
      with: data.map(x => [x])
    }
  },
})

export const resultTypes: I.ResultOps<any, any, I.Txn<any>>[] = []
// It'd be nice if there was syntax for this.
resultTypes[I.ResultType.Single] = field
resultTypes[I.ResultType.KV] = resultmap
resultTypes[I.ResultType.Range] = range

export const wrapQuery = (type: I.QueryType, data: I.QueryData): I.Query => (
  {type, q: data} as I.Query
)
