import * as I from '../types/interfaces'
import err from '../err'
import {queryTypes} from '../types/queryops'

const supportedOpTypes = new Set(['rm', 'set'])

export type MapFn = (v: I.Val, k: I.Key | null) => I.Val

const mapValues = <K, V1, V2>(map: Map<K, V1>, fn: (v: V1, k: K) => V2): Map<K, V2> => {
  const result = new Map<K, V2>()
  for (const [key, val] of map.entries()) {
    result.set(key, fn(val, key))
  }
  return result
}

const mapSingleOp = (op: I.SingleOp, key: I.Key | null, fn: MapFn) => {
  switch (op.type) {
    case 'rm': return op
    case 'set': return {type: 'set', data: fn(op.data, key)}
    default: throw Error('Map function cannot process operation with type ' + op.type)
  }
}

const mapOp = (op: I.Op, key: I.Key | null, fn: MapFn) => (
  Array.isArray(op)
    ? op.map(singleOp => mapSingleOp(singleOp, key, fn))
    : mapSingleOp(op, key, fn)
)

const mapTxn = (txn: I.Txn, fn: MapFn) => {
  return (txn instanceof Map)
    ? mapValues(txn, (op, key) => mapOp(op, key, fn))
    : mapOp(txn, null, fn)
}

const mapTxnWithMetas = (txn: I.TxnWithMeta[], fn: MapFn) => (
  txn.map(({versions, txn}) => ({
    txn: mapTxn(txn, fn),
    versions,
  }))
)

// Syncronous map fn
const map = (inner: I.Store, mapfn: MapFn): I.Store => {
  return {
    storeInfo: {
      sources: inner.storeInfo.sources,

      capabilities: {
        // TODO: Filter these capabilities by the ones we support locally.
        queryTypes: inner.storeInfo.capabilities.queryTypes,
        mutationTypes: new Set(), // You cannot mutate through the mapping.
      },
    },

    async fetch(query, opts) {
      const qtype = queryTypes[query.type]
      if (qtype == null) throw Error('unknown query type')

      const innerResults = await inner.fetch(query, opts)

      const outerResults: I.FetchResults = {
        // In the noDocs case, inner.fetch will have already stripped the documents.
        results: (opts && opts.noDocs) ? innerResults.results : qtype.r.map(innerResults.results, mapfn),
        queryRun: innerResults.queryRun,
        versions: innerResults.versions,
      }

      return outerResults
    },

    mutate(mtype, txn, versions, opts) {
      return Promise.reject(new err.UnsupportedTypeError('You cannot modify through a map fn'))
    },

    async getOps(query, versions, opts): Promise<I.GetOpsResult> {
      const r = await inner.getOps(query, versions, {
        ...opts,
        supportedTypes: supportedOpTypes,
      })

      return {
        ops: mapTxnWithMetas(r.ops, mapfn),
        versions: r.versions,
      }
    },

    subscribe(q, opts) {
      const qtype = queryTypes[q.type]

      const innerSub = inner.subscribe(q, {
        ...opts,
        supportedTypes: supportedOpTypes,
      })

      return {
        ...innerSub,
        iter: (async function*() {
          for await (const innerUpdates of innerSub.iter) {
            yield {
              ...innerUpdates,
              replace: innerUpdates.replace ? qtype.r.map(innerUpdates.replace, mapfn) : undefined,
              txns: mapTxnWithMetas(innerUpdates.txns, mapfn)
            }
          }
        })() as I.AsyncIterableIteratorWithRet<I.CatchupData>
      }
    },

    close() {},
  }
}

export default map
