import * as I from '../interfaces'
import err from '../err'
import {queryTypes} from '../qrtypes'

const supportedOpTypes = new Set(['rm', 'set'])

export type MapFn = (v: I.Val, k: I.Key | null, version: I.FullVersion) => I.Val

const mapValues = <K, V1, V2>(map: Map<K, V1>, fn: (v: V1, k: K) => V2): Map<K, V2> => {
  const result = new Map<K, V2>()
  for (const [key, val] of map.entries()) {
    result.set(key, fn(val, key))
  }
  return result
}

const mapSingleOp = (op: I.SingleOp, key: I.Key | null, version: I.FullVersion, fn: MapFn) => {
  switch (op.type) {
    case 'rm': return op
    case 'set': return {type: 'set', data: fn(op.data, key, version)}
    default: throw Error('Map function cannot process operation with type ' + op.type)
  }
}

const mapTxnWithMetas = (type: I.ResultOps<any, I.Txn>, txn: I.TxnWithMeta[], fn: MapFn) => (
  txn.map(({versions, txn, meta}) => ({
    txn: type.mapTxn(txn, (op, k) => (
      Array.isArray(op)
        ? op.map(singleOp => mapSingleOp(singleOp, k, versions, fn))
        : mapSingleOp(op, k, versions, fn)
    )),
    versions,
    meta,
  }))
)

const resultingVersion = (v: I.FullVersionRange): I.FullVersion => {
  const result: I.FullVersion = {}
  for (const s in v) result[s] = v[s].to
  return result
}

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

      const version = resultingVersion(innerResults.versions)
      const outerResults: I.FetchResults = {
        // In the noDocs case, inner.fetch will have already stripped the documents.
        results: (opts && opts.noDocs)
          ? innerResults.results
          : qtype.resultType.map(innerResults.results, (v, k) => mapfn(v, k, version)),
        bakedQuery: innerResults.bakedQuery,
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
        ops: mapTxnWithMetas(queryTypes[query.type].resultType, r.ops, mapfn),
        versions: r.versions,
      }
    },

    // TODO: catchup.

    subscribe(q, opts) {
      const qtype = queryTypes[q.type]

      const innerSub = inner.subscribe(q, {
        ...opts,
        supportedTypes: supportedOpTypes,
      })

      const version: I.FullVersion = {}

      return (async function*() {
        for await (const innerUpdates of innerSub) {
          // Note that version contains the version *after* the whole catchup
          // is applied. I'm updating it here, but note that it is not used by
          // txns.
          for (const s in innerUpdates.toVersion) {
            version[s] = innerUpdates.toVersion[s]
          }

          // TODO: It'd be better to avoid calling the map function so often
          // here. We should really only call it at most once per object per
          // iteration.
          yield {
            ...innerUpdates,
            txns: mapTxnWithMetas(qtype.resultType, innerUpdates.txns, mapfn),
            replace: innerUpdates.replace ? {
              q: innerUpdates.replace.q,
              with: qtype.resultType.mapReplace(innerUpdates.replace.with, (v, k) => mapfn(v, k, version)),
              versions: innerUpdates.replace.versions,
            } : undefined,
          }
        }
      })() as I.AsyncIterableIteratorWithRet<I.CatchupData>
    },

    close() {},
  }
}

export default map
